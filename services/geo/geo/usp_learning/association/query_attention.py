"""Fit-only query scheduling around the pinned SDPA primitive; full causal context."""
from __future__ import annotations

from contextlib import contextmanager
import json
from types import SimpleNamespace

from .reclamation import release_unused_cache, state_digest
from .validation import require

ATTENTION_CONTROL = {
    "qualification": "Technical objective-preservation fixture only, never source truth or model quality.",
    "sequenceTokens": 263, "queryHeads": 14, "keyValueHeads": 2, "headDimension": 64,
    "queryChunkSizes": [128, 128, 7], "attentionDropout": 0, "causal": True, "scale": 0.125,
    "scaledGradientMultiplier": 128.0,
    "reference": "Original pinned Transformers SDPA causal route, same Q/K/V and scalar objective, no candidate-derived reference.",
    "cpuFloat64": {"outputAtol": 1e-10, "outputRtol": 1e-10, "lossAtol": 1e-10, "lossRtol": 1e-10,
                   "gradientAtol": 1e-10, "gradientRtol": 1e-9},
    "cudaFloat16Float32": {"outputAtol": 5e-4, "outputRtol": 5e-3, "lossAtol": 5e-5, "lossRtol": 5e-4,
                           "gradientAtol": 2e-5, "gradientRtol": 5e-3},
    "toleranceReason": "Tight double-precision algebra check; CUDA permits fp16 GEMM/reduction and grouped K/V gradient-accumulation rounding with unchanged float32 math/loss. No bitwise equality claim for the full fit.",
    "requirements": ["all Q/K/V gradients finite and within tolerances", "all query outputs preserved in order",
                     "absolute causal offsets and final short block covered", "RNG unchanged/restored",
                     "no model parameter or optimizer/precision changes", "no cumulative resource breach"]}

ATTENTION_POLICY = {
    "version": "association-checkpointed-query-sdpa/1", "queryChunkTokens": 128,
    "primitive": "torch.nn.functional.scaled_dot_product_attention", "backend": "MATH",
    "productionInputDtype": "float16", "mathIntermediates": "float32; reduced precision disabled and unchanged",
    "batchSize": 1, "queryHeads": 14, "keyValueHeads": 2, "headDimension": 64, "scale": 0.125,
    "keyValueContext": "complete original K/V for every query block; enable_gqa=True",
    "mask": "boolean key_position <= absolute_query_position; is_causal=False",
    "supportedIncomingMask": "None (unpadded complete causal sequence); other masks rejected",
    "checkpointUseReentrant": False, "checkpointPreserveRngState": True,
    "scope": "exact loaded Qwen2 instances in fit only; Qwen-local interface restored in finally",
    "baselineAndReloadUnchanged": True, "control": ATTENTION_CONTROL}


def query_blocks(length):
    require(type(length) is int and 0 < length <= 4096, "unsupported_attention_sequence_length")
    return [(start, min(start + 128, length)) for start in range(0, length, 128)]


def validate_options(attention_mask, dropout, scaling, kwargs):
    require(attention_mask is None, "unsupported_attention_mask")
    require(dropout == 0.0 and scaling == 0.125, "attention_dropout_or_scale_changed")
    require(set(kwargs) <= {"sliding_window", "position_ids", "use_cache", "output_attentions"},
            "unsupported_attention_kwargs")
    require(kwargs.get("sliding_window") is None and kwargs.get("use_cache", False) is False
            and kwargs.get("output_attentions", False) is False, "attention_cache_sliding_or_weights_unsupported")


def checkpointed_query_attention(query, key, value, *, record=None):
    import torch
    from torch.nn.attention import SDPBackend, sdpa_kernel
    from torch.utils.checkpoint import checkpoint

    require(query.ndim == key.ndim == value.ndim == 4, "attention_rank_changed")
    length = query.shape[2]
    blocks = query_blocks(length)
    require(tuple(query.shape) == (1, 14, length, 64)
            and tuple(key.shape) == tuple(value.shape) == (1, 2, length, 64), "attention_full_context_or_heads_changed")
    require(all(t.device == query.device and t.dtype == query.dtype and t.requires_grad for t in (query, key, value)),
            "attention_dtype_device_or_gradient_changed")
    require((query.device.type, query.dtype) in (("cuda", torch.float16), ("cpu", torch.float64)), "unsupported_attention_precision")
    require(not torch.backends.cuda.fp16_bf16_reduction_math_sdp_allowed(), "reduced_precision_attention_math_refused")

    def block(q, k, v, start):
        if record is not None:
            record(start, q.shape[2], k.shape[2])
        allowed = torch.arange(k.shape[2], device=q.device)[None, :] <= torch.arange(start, start + q.shape[2], device=q.device)[:, None]
        with sdpa_kernel(SDPBackend.MATH):
            return torch.nn.functional.scaled_dot_product_attention(q, k, v, attn_mask=allowed,
                dropout_p=0.0, is_causal=False, scale=0.125, enable_gqa=True)

    outputs = [checkpoint(block, query[:, :, start:stop, :], key, value, start,
                          use_reentrant=False, preserve_rng_state=True) for start, stop in blocks]
    return torch.cat(outputs, dim=2).transpose(1, 2).contiguous()


class FitAttention:
    def __init__(self, decoder, qwen, path):
        self.decoder, self.qwen, self.path = decoder, qwen, path
        self.modules = {id(layer.self_attn): layer.self_attn for layer in decoder.layers}
        self.current = None
        self.restored = False

    def begin(self, context, tokens):
        self.current = {**context, "tokens": tokens, "blockSizes": [b - a for a, b in query_blocks(tokens)],
                        "layerCalls": {}, "primitiveCallsStarted": 0, "maxQueryBlockTokens": 0,
                        "fullKeyTokens": tokens, "minimumBlockStart": None, "maximumBlockStart": None}

    def record(self, start, count, keys):
        row = self.current
        require(row is not None and keys == row["tokens"] and (start, start + count) in query_blocks(keys),
                "attention_block_bounds_changed")
        row["primitiveCallsStarted"] += 1
        row["maxQueryBlockTokens"] = max(row["maxQueryBlockTokens"], count)
        row["minimumBlockStart"] = min(start, row["minimumBlockStart"] if row["minimumBlockStart"] is not None else start)
        row["maximumBlockStart"] = max(start, row["maximumBlockStart"] if row["maximumBlockStart"] is not None else start)

    def snapshot(self, boundary):
        row = {"boundary": boundary, **self.current}
        with self.path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(row, sort_keys=True) + "\n")
        return row

    def pre_forward(self, module, args, kwargs):
        import torch
        require(not args and set(kwargs) <= {"hidden_states", "position_embeddings", "attention_mask", "past_key_values",
                    "cache_position", "position_ids", "use_cache", "output_attentions"}, "unsupported_Qwen_attention_call")
        require(kwargs.get("past_key_values") is None and kwargs.get("use_cache", False) is False
                and kwargs.get("output_attentions", False) is False, "attention_cache_or_weights_refused")
        hidden = kwargs["hidden_states"]
        require(hidden.shape[0] == 1 and hidden.shape[1] == self.current["tokens"], "attention_example_shape_changed")
        position = torch.arange(hidden.shape[1], device=hidden.device)
        require(torch.equal(kwargs["cache_position"], position) and torch.equal(kwargs["position_ids"], position.unsqueeze(0)),
                "attention_absolute_positions_changed")

    def forward(self, module, query, key, value, attention_mask, dropout=0.0, scaling=None, **kwargs):
        import torch
        require(self.modules.get(id(module)) is module and type(module) is self.qwen.Qwen2Attention
                and module.training and self.decoder.training and module.config._attn_implementation == "sdpa"
                and not module.config.use_cache and module.is_causal and module.num_key_value_groups == 7
                and module.head_dim == 64 and module.sliding_window is None, "attention_fit_scope_changed")
        require(query.device.type == "cuda" and query.dtype == torch.float16, "production_attention_precision_changed")
        validate_options(attention_mask, dropout, scaling, kwargs)
        calls = self.current["layerCalls"]
        key_name = str(module.layer_idx)
        calls[key_name] = calls.get(key_name, 0) + 1
        return checkpointed_query_attention(query, key, value, record=self.record), None


@contextmanager
def fit_attention_scope(decoder, output_dir):
    from transformers.models.qwen2 import modeling_qwen2 as qwen
    from transformers.modeling_utils import AttentionInterface, ALL_ATTENTION_FUNCTIONS
    from transformers.integrations.sdpa_attention import sdpa_attention_forward

    require(type(decoder) is qwen.Qwen2Model and len(decoder.layers) == 24
            and decoder.config._attn_implementation == "sdpa" and not decoder.config.use_cache
            and not decoder.has_sliding_layers and not decoder.config.use_sliding_window
            and decoder.config.num_attention_heads == 14 and decoder.config.num_key_value_heads == 2
            and decoder.config.hidden_size == 896 and decoder.config.attention_dropout == 0,
            "unsupported_Qwen_attention_configuration")
    previous = qwen.ALL_ATTENTION_FUNCTIONS
    require(previous["sdpa"] is sdpa_attention_forward, "Qwen_attention_already_overridden")
    global_before = dict(ALL_ATTENTION_FUNCTIONS)
    attention = FitAttention(decoder, qwen, output_dir / "attention-blocks.jsonl")
    local = AttentionInterface()
    local["sdpa"] = attention.forward  # __setitem__ writes only the new instance's local mapping.
    hooks = []
    try:
        for module in attention.modules.values():
            require(type(module) is qwen.Qwen2Attention and module.sliding_window is None, "unexpected_attention_instance")
            hooks.append(module.register_forward_pre_hook(attention.pre_forward, with_kwargs=True))
        qwen.ALL_ATTENTION_FUNCTIONS = local
        yield attention
    finally:
        qwen.ALL_ATTENTION_FUNCTIONS = previous
        for hook in hooks:
            hook.remove()
        attention.restored = qwen.ALL_ATTENTION_FUNCTIONS is previous and dict(ALL_ATTENTION_FUNCTIONS) == global_before
        # Restore first; evidence write failure must not replace a training exception.
        import sys
        active_error = sys.exc_info()[0] is not None
        try:
            if attention.current is not None:
                attention.snapshot("scope_exit")
            with (output_dir / "attention-scope.json").open("x", encoding="utf-8", newline="\n") as stream:
                json.dump({"restored": attention.restored, "globalRegistryUnchanged": dict(ALL_ATTENTION_FUNCTIONS) == global_before,
                           "fitOnly": True, "layers": len(hooks)}, stream, sort_keys=True)
                stream.write("\n")
            require(attention.restored, "attention_scope_not_restored")
        except Exception:
            if not active_error:
                raise


def run_attention_control(torch, output_dir, write, phases):
    from transformers.integrations.sdpa_attention import sdpa_attention_forward

    before_cpu, before_cuda = torch.get_rng_state().clone(), torch.cuda.get_rng_state().clone()
    report = {"version": "association-query-attention-control/1", "policy": ATTENTION_POLICY, "cases": [], "passed": False}
    try:
        with torch.random.fork_rng(devices=[torch.cuda.current_device()]):
            for label, device, dtype, loss_dtype in (("cpuFloat64", "cpu", torch.float64, torch.float64),
                                                    ("cudaFloat16Float32", "cuda", torch.float16, torch.float32)):
                phases.sample("attention_control_" + label + "_before", torch)
                tolerance = ATTENTION_CONTROL[label]
                def inputs(heads, offset):
                    values = torch.arange(heads * 263 * 64, dtype=torch.float64).reshape(1, heads, 263, 64)
                    return (torch.sin(values * 0.017 + offset) * 0.3 + torch.cos(values * 0.031) * 0.1).to(device=device, dtype=dtype)
                reference = [inputs(heads, offset).requires_grad_() for heads, offset in ((14, 0.1), (2, 0.7), (2, 1.3))]
                candidate = [tensor.detach().clone().requires_grad_() for tensor in reference]
                before = state_digest(reference + candidate)
                full, _ = sdpa_attention_forward(SimpleNamespace(num_key_value_groups=7, is_causal=True),
                                                 *reference, None, dropout=0.0, scaling=0.125)
                calls = []
                chunked = checkpointed_query_attention(*candidate, record=lambda s, q, k: calls.append([s, q, k]))
                weights = torch.sin(torch.arange(full.numel(), device=device, dtype=loss_dtype).reshape(full.shape) * 0.013)
                full_loss, chunk_loss = [(tensor.to(loss_dtype) * weights).sum() / 263 for tensor in (full, chunked)]
                full_grads = torch.autograd.grad(full_loss * 128.0, reference)
                chunk_grads = torch.autograd.grad(chunk_loss * 128.0, candidate)
                gradient_results = []
                for name, actual, expected in zip(("Q", "K", "V"), chunk_grads, full_grads):
                    actual, expected = actual / 128.0, expected / 128.0
                    gradient_results.append({"input": name, "finite": bool(torch.isfinite(actual).all() and torch.isfinite(expected).all()),
                        "nonzero": bool(torch.count_nonzero(actual)) and bool(torch.count_nonzero(expected)),
                        "withinTolerance": bool(torch.allclose(actual, expected, atol=tolerance["gradientAtol"], rtol=tolerance["gradientRtol"])),
                        "maxAbsoluteDifference": float((actual.double() - expected.double()).abs().max())})
                output_ok = bool(torch.allclose(chunked, full, atol=tolerance["outputAtol"], rtol=tolerance["outputRtol"]))
                loss_ok = bool(torch.isclose(chunk_loss, full_loss, atol=tolerance["lossAtol"], rtol=tolerance["lossRtol"]))
                bounds_ok = bool(calls) and all(call in [[0, 128, 263], [128, 128, 263], [256, 7, 263]] for call in calls)
                bounds_ok = bounds_ok and calls[:3] == [[0, 128, 263], [128, 128, 263], [256, 7, 263]]
                same_inputs = before == state_digest(reference + candidate)
                case = {"dtype": label, "outputWithinTolerance": output_ok, "lossWithinTolerance": loss_ok,
                        "fullLoss": float(full_loss.detach()), "chunkLoss": float(chunk_loss.detach()),
                        "maxOutputAbsoluteDifference": float((chunked.double() - full.double()).abs().max()),
                        "qkvGradients": gradient_results, "inputsUnchanged": same_inputs, "blockBoundsPassed": bounds_ok,
                        "actualBlockCalls": calls, "passed": output_ok and loss_ok and bounds_ok and same_inputs
                            and all(row["finite"] and row["nonzero"] and row["withinTolerance"] for row in gradient_results)}
                report["cases"].append(case)
                with (output_dir / "attention-control-progress.jsonl").open("a", encoding="utf-8", newline="\n") as stream:
                    stream.write(json.dumps(case, sort_keys=True) + "\n")
                phases.sample("attention_control_" + label + "_after", torch, controlPassed=case["passed"])
                require(case["passed"], "query_attention_equivalence_failed_" + label)
                del reference, candidate, full, chunked, weights, full_loss, chunk_loss, full_grads, chunk_grads, actual, expected
            report["rngUnchangedInsideControl"] = torch.equal(before_cpu, torch.get_rng_state()) and torch.equal(before_cuda, torch.cuda.get_rng_state())
        report["trainingRngRestored"] = torch.equal(before_cpu, torch.get_rng_state()) and torch.equal(before_cuda, torch.cuda.get_rng_state())
        report["passed"] = report["rngUnchangedInsideControl"] and report["trainingRngRestored"] and all(row["passed"] for row in report["cases"])
        require(report["passed"], "attention_control_rng_changed")
    finally:
        import sys
        active_error = sys.exc_info()[0] is not None
        try:
            report["trainingRngRestored"] = torch.equal(before_cpu, torch.get_rng_state()) and torch.equal(before_cuda, torch.cuda.get_rng_state())
            write(output_dir / "attention-control.json", report)
        except Exception as error:
            if not active_error:
                raise
            print("Attention control receipt failed: " + str(error), file=sys.stderr, flush=True)
    release_unused_cache(torch)
    phases.sample("attention_control_complete", torch, controlPassed=True)
    return report
