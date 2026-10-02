"""One fixed SFT LoRA candidate; all model/dependency work requires containment."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import random
import stat
import time

from .student import SETTINGS, SYSTEM_PROMPT, prompt_messages, run_local
from .validation import require, strict_json, validate_output

V1_SHA = "71e218b2a13ad26938f0b4ab5f4111125af8530dfbd0a01c0c3b9680f3bfefec"
V2_SHA = "7510a7040afb7bec2bba9422eb5e14bbf0664c927bd0c2b24989c1af6dc7674c"
FIT = {"method": "supervised_causal_LoRA", "targets": ["q_proj", "v_proj"], "rank": 8, "alpha": 16,
       "dropout": 0.05, "epochs": 6, "batchSize": 1, "gradientAccumulation": 1,
       "optimizer": "AdamW", "learningRate": 0.0002, "weightDecay": 0, "warmupSteps": 0,
       "gradientClipNorm": 1, "seed": 17, "maxSequenceTokens": 4096,
       "loss": "assistant JSON target plus EOS only; all prompt tokens masked",
       "gradientCheckpointing": True, "cacheDuringFit": False, "cpuThreads": 2}
NUMERICS = {"baseDtype": "float16", "adapterDtype": "float32", "lossDtype": "float32",
            "initialGradientScale": 128.0, "scaleGrowthInterval": 2000,
            "adamBetas": [0.9, 0.999], "adamEpsilon": 1e-8,
            "attention": "sdpa", "checkpointing": "non-reentrant", "shuffle": "Random(17), one permutation per epoch",
            "logits": "only positions predicting supervised assistant JSON plus EOS; prompt labels masked"}


def digest_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024**2), b""):
            digest.update(block)
    return digest.hexdigest()


def checked_teacher(v1_bytes, v2_bytes, contract, family_freeze):
    require(hashlib.sha256(v1_bytes).hexdigest() == V1_SHA, "teacher_v1_pin_drift")
    require(hashlib.sha256(v2_bytes).hexdigest() == V2_SHA, "teacher_v2_pin_drift")
    before = [strict_json(line) for line in v1_bytes.decode("utf-8").splitlines()]
    after = [strict_json(line) for line in v2_bytes.decode("utf-8").splitlines()]
    require(len(before) == len(after) == 11, "exactly_eleven_teacher_examples_required")
    added = 0
    for old, new in zip(before, after):
        require(old["input"] == new["input"], "teacher_input_or_source_lineage_changed")
        expected = copy.deepcopy(old["output"])
        marker = {"code": "no_canonical_targets", "citations": []}
        if marker not in expected["abstentions"]:
            expected["abstentions"].append(marker)
            added += 1
        require(new["output"] == expected, "teacher_change_exceeds_canonical_abstention")
        require(set(new) == set(old), "teacher_top_level_contract_changed")
        supervision = copy.deepcopy(new["supervision"])
        correction = supervision.pop("targetPolicyCorrection", None)
        require(supervision == old["supervision"], "original_supervision_or_lineage_changed")
        require(correction == {"authority": "ML coordinator TEACHER-02 training-target feedback",
            "method": "deterministic_contract_policy", "parentDataSha256": V1_SHA,
            "policy": marker, "scope": "No canonical targets/crosswalk in this frozen seed; not a new sourced fact.",
            "version": "ml-distill-target-policy-correction/2"}, "unexpected_correction_provenance")
        validate_output(new["output"], new["input"], contract, family_freeze, ("train",))
    return after, {"examples": 11, "addedCanonicalAbstentions": added,
                   "claimsUnchanged": sum(len(row["output"]["claims"]) for row in after),
                   "inputAndOutputDeltaChecked": True,
                   "metadataChanges": [{"exampleId": new["input"]["exampleId"], "keys": [key for key in old
                       if key not in ("input", "output") and old[key] != new[key]]} for old, new in zip(before, after)]}


def encode_training(tokenizer, rows):
    encoded, lengths = [], []
    for row in rows:
        prompt = tokenizer.apply_chat_template(prompt_messages(row["input"]), tokenize=False, add_generation_prompt=True)
        target = json.dumps(row["output"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        rendered = tokenizer.apply_chat_template(prompt_messages(row["input"]) + [{"role": "assistant", "content": target}],
                                                 tokenize=False, add_generation_prompt=False)
        require(rendered == prompt + target + tokenizer.eos_token + "\n", "chat_template_target_boundary_changed")
        prompt_ids = tokenizer.encode(prompt, add_special_tokens=False)
        ids = tokenizer.encode(prompt + target + tokenizer.eos_token, add_special_tokens=False)
        require(ids[:len(prompt_ids)] == prompt_ids and ids[-1] == tokenizer.eos_token_id, "prompt_or_eos_mask_alignment_failed")
        require(len(ids) > len(prompt_ids), "empty_assistant_target")
        labels = [-100] * len(prompt_ids) + ids[len(prompt_ids):]
        encoded.append({"exampleId": row["input"]["exampleId"], "inputIds": ids, "labels": labels, "promptTokens": len(prompt_ids)})
        lengths.append({"exampleId": row["input"]["exampleId"], "promptTokens": len(prompt_ids),
                        "assistantJsonPlusEosTokens": len(ids) - len(prompt_ids), "combinedTokens": len(ids),
                        "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(), "targetSha256": hashlib.sha256(target.encode()).hexdigest()})
    return encoded, lengths


def check_adapter_config(config):
    require(config.get("peft_type") == "LORA" and config.get("task_type") == "CAUSAL_LM", "wrong_adapter_type")
    require(config.get("r") == 8 and config.get("lora_alpha") == 16 and config.get("lora_dropout") == 0.05,
            "adapter_hyperparameter_drift")
    require(set(config.get("target_modules", [])) == {"q_proj", "v_proj"}, "adapter_target_drift")
    require(config.get("bias") == "none" and config.get("modules_to_save") is None,
            "adapter_contains_extra_trainable_modules")
    require(not config.get("use_dora") and not config.get("use_rslora") and not config.get("trainable_token_indices")
            and not config.get("loftq_config") and not config.get("auto_mapping")
            and not config.get("rank_pattern") and not config.get("alpha_pattern")
            and not config.get("layers_to_transform") and not config.get("layer_replication")
            and not config.get("fan_in_fan_out") and not config.get("lora_bias"), "unsupported_adapter_extension")


def verify_adapter_files(directory, manifest):
    directory = Path(directory)
    require(set(path.name for path in directory.iterdir()) == {"adapter_model.safetensors", "adapter_config.json", "README.md"},
            "unexpected_or_unsafe_adapter_file")
    require(all(path.is_file() and not path.is_symlink()
                and not (getattr(path.lstat(), "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)
                for path in directory.iterdir()), "adapter_file_redirect_or_directory")
    for name, digest in manifest["files"].items():
        require(Path(name).name == name and digest_file(directory / name) == digest, "adapter_file_pin_drift")
    require(set(manifest["files"]) == {"adapter_model.safetensors", "adapter_config.json", "README.md"}, "incomplete_adapter_manifest")
    check_adapter_config(strict_json((directory / "adapter_config.json").read_bytes()))


def _tensor_digest(named):
    digest = hashlib.sha256()
    count = 0
    for name, parameter in named:
        digest.update(json.dumps([name, str(parameter.dtype), list(parameter.shape)], separators=(",", ":")).encode())
        flat = parameter.detach().reshape(-1)
        chunk = max(1, 8 * 1024**2 // parameter.element_size())
        for start in range(0, flat.numel(), chunk):
            array = flat[start:start + chunk].cpu().contiguous().numpy()
            digest.update(memoryview(array))
        count += 1
    return {"sha256": digest.hexdigest(), "tensorCount": count}


def _gpu_runtime(output_dir):
    import torch
    torch.set_num_threads(2)
    torch.set_num_interop_threads(2)
    torch.manual_seed(17)
    torch.use_deterministic_algorithms(True)
    torch.backends.cuda.matmul.allow_tf32 = False
    require(torch.cuda.is_available(), "CUDA_unavailable")
    free, total = torch.cuda.mem_get_info()
    require(free >= SETTINGS["minimumFreeCudaBytes"] + 2 * 1024**3, "insufficient_initial_GPU_headroom")
    torch.cuda.set_per_process_memory_fraction(min(6 * 1024**3, free - SETTINGS["minimumFreeCudaBytes"]) / total)
    torch.cuda.reset_peak_memory_stats()
    samples = []
    sample_path = output_dir / "gpu-samples.jsonl"
    sample_path.touch(exist_ok=False)

    def check():
        available, _ = torch.cuda.mem_get_info()
        sample = {"allocatedBytes": torch.cuda.memory_allocated(), "reservedBytes": torch.cuda.memory_reserved(), "freeBytes": available}
        samples.append(sample)
        with sample_path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(sample, sort_keys=True) + "\n")
        require(sample["allocatedBytes"] <= 6 * 1024**3 and sample["reservedBytes"] <= 6 * 1024**3
                and available >= SETTINGS["minimumFreeCudaBytes"], "GPU_resource_boundary_exceeded")
        return sample

    def report():
        return {"gpu": torch.cuda.get_device_name(), "maxCudaAllocatedBytes": torch.cuda.max_memory_allocated(),
                "maxCudaReservedBytes": torch.cuda.max_memory_reserved(), "minimumSampledFreeCudaBytes": min(s["freeBytes"] for s in samples),
                "gpuSampleCount": len(samples)}
    check()
    return torch, check, report


def fit(rows, contract, family_freeze, model_path, output_dir, require_boundary, write):
    require_boundary()
    for row in rows:
        validate_output(row["output"], row["input"], contract, family_freeze, ("train",))
    import importlib.metadata as metadata
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import LoraConfig, get_peft_model, get_peft_model_state_dict
    from safetensors.torch import load_file

    started = time.perf_counter()
    require(metadata.version("peft") == "0.17.1" and metadata.version("accelerate") == "1.10.1", "isolated_dependency_version_drift")
    tokenizer = AutoTokenizer.from_pretrained(str(model_path), local_files_only=True, trust_remote_code=False)
    encoded, lengths = encode_training(tokenizer, rows)
    rng, orders = random.Random(17), []
    for _ in range(6):
        order = list(range(11)); rng.shuffle(order); orders.append(order)
    proof = {"lengths": lengths, "maximumCombinedTokens": max(row["combinedTokens"] for row in lengths),
             "sequenceLimit": 4096, "truncation": False, "excludedRows": [], "epochOrder": orders,
             "plannedUpdates": 66, "settings": FIT, "numerics": NUMERICS,
             "systemPromptSha256": hashlib.sha256(SYSTEM_PROMPT.encode()).hexdigest(), "tokenizationSeconds": time.perf_counter() - started}
    write(output_dir / "token-preflight.json", proof)
    require(proof["maximumCombinedTokens"] <= 4096, "teacher_sequence_exceeds_frozen_4096_bound")
    torch, gpu_check, gpu_report = _gpu_runtime(output_dir)
    load_started = time.perf_counter()
    base = AutoModelForCausalLM.from_pretrained(str(model_path), local_files_only=True, trust_remote_code=False,
        use_safetensors=True, torch_dtype=torch.float16, attn_implementation="sdpa").to("cuda")
    model = get_peft_model(base, LoraConfig(task_type="CAUSAL_LM", r=8, lora_alpha=16, lora_dropout=0.05,
                                          target_modules=["q_proj", "v_proj"], bias="none"))
    model.config.use_cache = False
    model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.enable_input_require_grads()
    trainable = [(name, p) for name, p in model.named_parameters() if p.requires_grad]
    expected = {f"base_model.model.model.layers.{layer}.self_attn.{projection}.lora_{part}.default.weight"
                for layer in range(24) for projection in ("q_proj", "v_proj") for part in ("A", "B")}
    require({name for name, _ in trainable} == expected and sum(p.numel() for _, p in trainable) == 540672, "unexpected_trainable_parameters")
    require(all(p.dtype == torch.float32 for _, p in trainable), "adapter_master_parameters_must_be_float32")
    frozen = [(name, p) for name, p in model.named_parameters() if not p.requires_grad]
    base_before = _tensor_digest(frozen)
    gpu_check()
    load_seconds = time.perf_counter() - load_started
    optimizer = torch.optim.AdamW([p for _, p in trainable], lr=0.0002, weight_decay=0, betas=(0.9, 0.999), eps=1e-8)
    scaler = torch.amp.GradScaler("cuda", init_scale=128.0, growth_interval=2000)
    model.train()
    updates, supervised_tokens, losses = 0, 0, []
    fit_started = time.perf_counter()
    with (output_dir / "fit-progress.jsonl").open("x", encoding="utf-8", newline="\n") as progress:
        for epoch, order in enumerate(orders):
            for index in order:
                row, before = encoded[index], time.perf_counter()
                ids = torch.tensor([row["inputIds"]], dtype=torch.long, device="cuda")
                labels = torch.tensor([row["labels"]], dtype=torch.long, device="cuda")
                selected = torch.arange(row["promptTokens"] - 1, ids.shape[1] - 1, device="cuda")
                target = labels[:, row["promptTokens"]:]
                require(bool((labels[:, :row["promptTokens"]] == -100).all()) and bool((target >= 0).all()), "assistant_mask_changed")
                optimizer.zero_grad(set_to_none=True)
                with torch.autocast("cuda", dtype=torch.float16):
                    logits = model(input_ids=ids, attention_mask=torch.ones_like(ids), use_cache=False,
                                   logits_to_keep=selected).logits
                    loss = torch.nn.functional.cross_entropy(logits.float().reshape(-1, logits.shape[-1]), target.reshape(-1))
                require(bool(torch.isfinite(loss)), "nonfinite_training_loss")
                gpu_check()
                scaler.scale(loss).backward()
                scaler.unscale_(optimizer)
                require(all(p.grad is not None and bool(torch.isfinite(p.grad).all()) for _, p in trainable), "missing_or_nonfinite_adapter_gradient")
                require(any(bool(torch.count_nonzero(p.grad)) for _, p in trainable), "all_adapter_gradients_zero")
                require(all(p.grad is None for _, p in frozen), "frozen_base_received_gradient")
                norm = torch.nn.utils.clip_grad_norm_([p for _, p in trainable], 1.0, error_if_nonfinite=True)
                scale_before = scaler.get_scale()
                scaler.step(optimizer); scaler.update()
                require(scaler.get_scale() >= scale_before, "optimizer_step_was_skipped")
                torch.cuda.synchronize()
                updates += 1; supervised_tokens += target.numel(); losses.append(float(loss.detach()))
                facts = {"update": updates, "epoch": epoch + 1, "exampleId": row["exampleId"], "loss": losses[-1],
                         "supervisedTokens": target.numel(), "combinedTokens": ids.shape[1], "gradientNormBeforeClip": float(norm),
                         "gradientScale": scaler.get_scale(), "seconds": time.perf_counter() - before, "gpu": gpu_check()}
                progress.write(json.dumps(facts, sort_keys=True) + "\n"); progress.flush()
                del ids, labels, target, selected, logits, loss
    require(updates == 66, "incomplete_frozen_fit")
    fit_seconds = time.perf_counter() - fit_started
    optimizer.zero_grad(set_to_none=True)
    base_after = _tensor_digest(frozen)
    require(base_before == base_after, "frozen_base_parameters_changed")
    model.eval(); model.gradient_checkpointing_disable()
    adapter_dir = output_dir / "adapter"
    model.save_pretrained(adapter_dir, safe_serialization=True, save_embedding_layers=False)
    state = get_peft_model_state_dict(model)
    saved = load_file(str(adapter_dir / "adapter_model.safetensors"), device="cpu")
    require(set(saved) == set(state) and all(torch.equal(saved[k], state[k].detach().cpu()) for k in saved), "saved_adapter_state_mismatch")
    manifest = {"files": {p.name: digest_file(p) for p in adapter_dir.iterdir()}, "trainableParameters": 540672,
                "tensorCount": len(saved), "baseParametersBefore": base_before, "baseParametersAfter": base_after,
                "savedStateMatchesTrainableAdapter": True, "updates": updates, "settings": FIT, "numerics": NUMERICS}
    verify_adapter_files(adapter_dir, manifest)
    write(output_dir / "adapter-manifest.json", manifest)
    gpu_check()
    result = {"version": "association-adapter-fit/1", "updates": updates, "supervisedTokens": supervised_tokens,
              "epochMeanLoss": [sum(losses[i:i + 11]) / 11 for i in range(0, 66, 11)], "stepLosses": losses,
              "modelAndBaseVerificationSeconds": load_seconds, "fitSeconds": fit_seconds,
              "elapsedSeconds": time.perf_counter() - started, "gpu": gpu_report(), "teacherExamples": 11,
              "baseUnchanged": base_before == base_after, "adapterManifestSha256": digest_file(output_dir / "adapter-manifest.json"),
              "runtime": {name: metadata.version(name) for name in ("torch", "transformers", "peft", "accelerate", "safetensors")},
              "evaluationOpened": False, "developmentOpened": False, "fitPerformed": True}
    write(output_dir / "fit-result.json", result)
    return result


def reload_and_compare(examples, contract, family_freeze, model_path, adapter_dir, manifest, require_boundary, preserve_raw):
    require_boundary()
    verify_adapter_files(adapter_dir, manifest)
    verified = {}

    def load_local(path):
        import torch
        from transformers import AutoModelForCausalLM
        from peft import PeftModel, get_peft_model_state_dict
        from safetensors.torch import load_file
        base = AutoModelForCausalLM.from_pretrained(str(path), local_files_only=True, trust_remote_code=False,
            use_safetensors=True, torch_dtype=torch.float16, attn_implementation="sdpa").to("cuda").eval()
        model = PeftModel.from_pretrained(base, str(adapter_dir), is_trainable=False, local_files_only=True)
        require(not any(p.requires_grad for p in model.parameters()), "reload_has_trainable_parameters")
        saved = load_file(str(Path(adapter_dir) / "adapter_model.safetensors"), device="cpu")
        state = get_peft_model_state_dict(model)
        require(set(saved) == set(state) and all(torch.equal(saved[k], state[k].detach().cpu()) for k in saved), "reloaded_adapter_tensor_mismatch")
        verified.update(tensorCount=len(saved), savedTensorsExact=True, explicitLocalBase=True, remoteBaseLookup=False)
        return model.eval()

    raw, result = run_local(examples, contract, family_freeze, model_path, require_boundary, preserve_raw, model_loader=load_local)
    result.update(adapterApplied=True, adapterReload=verified, teacherOutputsUsed=True, teacherInputsInReload=False,
                  adapterTrainingUpdates=manifest["updates"], fitPerformed=True, fitPerformedInThisProcess=False)
    return raw, result
