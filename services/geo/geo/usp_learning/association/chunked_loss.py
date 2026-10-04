"""Same supervised objective with bounded, recomputed vocabulary projections."""
from __future__ import annotations

import contextlib
import json
import math

from .validation import require

LOSS_POLICY = {
    "version": "association-checkpointed-head-loss/1", "headChunkTokens": 64,
    "decoderForwardsPerExample": 1, "hiddenSelection": "promptTokens-1 through sequenceTokens-2 inclusive",
    "reduction": "sum all chunk cross-entropies / exact supervised token count including EOS",
    "headRequiresGrad": False, "checkpointUseReentrant": False, "checkpointPreserveRngState": True,
    "productionLossDtype": "float32", "hiddenDetached": False,
    "control": {"sequenceTokens": 147, "promptTokens": 12, "supervisedTokens": 135,
                "hiddenSize": 32, "vocabularySize": 257, "lastChunkTokens": 7,
                "cpuFloat64": {"lossAtol": 1e-12, "lossRtol": 1e-12, "gradientAtol": 1e-12, "gradientRtol": 1e-11},
                "cudaFloat16Float32": {"lossAtol": 5e-5, "lossRtol": 5e-5, "gradientAtol": 2e-6, "gradientRtol": 3e-3,
                                       "gradientScale": 128.0},
                "toleranceReason": "CPU double checks algebra tightly; CUDA permits fp16 GEMM/reduction rounding while loss remains float32."}}


def supervised_positions(sequence_tokens, prompt_tokens):
    require(0 < prompt_tokens < sequence_tokens, "invalid_assistant_boundary")
    return range(prompt_tokens - 1, sequence_tokens - 1)


def checkpointed_head_loss(hidden, targets, head, *, loss_dtype=None):
    import torch
    from torch.utils.checkpoint import checkpoint
    require(hidden.ndim == 3 and targets.ndim == 2 and hidden.shape[:2] == targets.shape,
            "head_loss_shape_mismatch")
    require(hidden.requires_grad and not any(p.requires_grad for p in head.parameters()), "head_loss_gradient_boundary_changed")
    require(targets.numel() > 0 and bool((targets >= 0).all()), "head_loss_mask_or_denominator_invalid")
    dtype = torch.float32 if loss_dtype is None else loss_dtype

    def summed_chunk(chunk_hidden, chunk_targets):
        logits = head(chunk_hidden).to(dtype)
        return torch.nn.functional.cross_entropy(logits.reshape(-1, logits.shape[-1]), chunk_targets.reshape(-1), reduction="sum")

    sums = []
    for start in range(0, hidden.shape[1], LOSS_POLICY["headChunkTokens"]):
        stop = start + LOSS_POLICY["headChunkTokens"]
        sums.append(checkpoint(summed_chunk, hidden[:, start:stop, :], targets[:, start:stop],
                               use_reentrant=False, preserve_rng_state=True))
    return torch.stack(sums).sum() / targets.numel()


def run_equivalence(torch, output_dir, write, phases):
    """One technical control, two declared dtypes; no source evidence or RNG draws."""
    spec = LOSS_POLICY["control"]
    positions = list(supervised_positions(spec["sequenceTokens"], spec["promptTokens"]))
    target_values = [(index * 37 + 5) % spec["vocabularySize"] for index in range(spec["supervisedTokens"])]
    target_values[-1] = 2  # Technical EOS label, not a property/model vocabulary assertion.
    cpu_rng, cuda_rng = torch.get_rng_state().clone(), torch.cuda.get_rng_state().clone()
    report = {"version": "association-loss-equivalence/1", "policy": LOSS_POLICY, "targetHiddenPositions": positions,
              "targetTokenPositions": list(range(spec["promptTokens"], spec["sequenceTokens"])),
              "targetValues": target_values, "denominator": len(target_values), "chunkSizes": [64, 64, 7],
              "qualification": "technical tensor objective-preservation control only", "cases": []}

    class FrozenHead(torch.nn.Module):
        def __init__(self, weight):
            super().__init__()
            self.weight = torch.nn.Parameter(weight, requires_grad=False)

        def forward(self, value):
            return torch.nn.functional.linear(value, self.weight)

    source = torch.tensor([math.cos(i * 0.17) * 0.25 for i in range(spec["sequenceTokens"] * spec["hiddenSize"])], dtype=torch.float64)
    weights = torch.tensor([math.sin(i * 0.013) / math.sqrt(spec["hiddenSize"])
                            for i in range(spec["vocabularySize"] * spec["hiddenSize"])], dtype=torch.float64)
    for label, device, dtype, loss_dtype in (("cpuFloat64", "cpu", torch.float64, torch.float64),
                                           ("cudaFloat16Float32", "cuda", torch.float16, torch.float32)):
        tolerance = spec[label]
        phases.sample("equivalence_" + label + "_before", torch)
        head = FrozenHead(weights.reshape(spec["vocabularySize"], spec["hiddenSize"]).to(device=device, dtype=dtype).clone())
        head_before = head.weight.detach().clone()
        reference = source.reshape(1, spec["sequenceTokens"], spec["hiddenSize"]).to(device=device, dtype=dtype).clone().requires_grad_()
        chunked = reference.detach().clone().requires_grad_()  # Independent technical control inputs only.
        targets = torch.tensor([target_values], device=device, dtype=torch.long)
        scale = tolerance.get("gradientScale", 1.0)
        with torch.autocast("cuda", dtype=torch.float16) if device == "cuda" else contextlib.nullcontext():
            full_logits = head(reference[:, positions, :]).to(loss_dtype)
            full_loss = torch.nn.functional.cross_entropy(full_logits.reshape(-1, spec["vocabularySize"]), targets.reshape(-1))
            chunk_loss = checkpointed_head_loss(chunked[:, positions, :], targets, head, loss_dtype=loss_dtype)
        full_gradient, = torch.autograd.grad(full_loss * scale, reference)
        chunk_gradient, = torch.autograd.grad(chunk_loss * scale, chunked)
        full_gradient, chunk_gradient = full_gradient / scale, chunk_gradient / scale
        finite = all(bool(torch.isfinite(value).all()) for value in (full_loss, chunk_loss, full_gradient, chunk_gradient))
        same_loss = bool(torch.isclose(full_loss, chunk_loss, atol=tolerance["lossAtol"], rtol=tolerance["lossRtol"]))
        same_gradient = bool(torch.allclose(full_gradient, chunk_gradient, atol=tolerance["gradientAtol"], rtol=tolerance["gradientRtol"]))
        frozen_head = not head.weight.requires_grad and head.weight.grad is None and torch.equal(head.weight, head_before)
        outside_zero = all(not bool(value[:, :spec["promptTokens"] - 1, :].count_nonzero())
                           and not bool(value[:, -1, :].count_nonzero()) for value in (full_gradient, chunk_gradient))
        case = {"dtype": label, "fullLoss": float(full_loss.detach()), "chunkLoss": float(chunk_loss.detach()),
                "lossAbsoluteDifference": abs(float(full_loss.detach()) - float(chunk_loss.detach())),
                "maxHiddenGradientAbsoluteDifference": float((full_gradient.double() - chunk_gradient.double()).abs().max()),
                "maxReferenceHiddenGradientMagnitude": float(full_gradient.abs().max()),
                "finite": finite, "lossWithinTolerance": same_loss, "hiddenGradientWithinTolerance": same_gradient,
                "frozenHeadUnchanged": frozen_head, "unselectedHiddenGradientsZero": outside_zero,
                "passed": finite and same_loss and same_gradient and frozen_head and outside_zero}
        report["cases"].append(case)
        with (output_dir / "objective-control.jsonl").open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(case, sort_keys=True) + "\n")
        phases.sample("equivalence_" + label + "_after", torch, control=case)
        require(case["passed"], "chunked_loss_equivalence_failed_" + label)
        del head, head_before, reference, chunked, targets, full_logits, full_loss, chunk_loss, full_gradient, chunk_gradient
    require(torch.equal(cpu_rng, torch.get_rng_state()) and torch.equal(cuda_rng, torch.cuda.get_rng_state()), "equivalence_consumed_training_rng")
    report.update(passed=True, rngUnchanged=True)
    write(output_dir / "loss-equivalence.json", report)
    torch.cuda.empty_cache()  # Release only finished technical fixture buffers, before loading the model.
    return report
