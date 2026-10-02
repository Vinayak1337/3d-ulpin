"""STUDENT-07: two pinned training inputs; targets remain on the host."""
from __future__ import annotations

import hashlib
import json
import time

from .student import SETTINGS, prompt_messages
from .validation import project_raw, require, validate_input

VERSION = "association-training-generation/1"
CASE_IDS = ("teacher-haryana-floor02", "teacher-bihar-unusable-approval-date")
QUALIFICATION = "train-only in-sample reconstruction against provisional supervision; no independent accuracy or generalization"


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def checked_batch(batch, assignment, contract, family):
    require(set(batch) == {"version", "split", "examples"} and batch["version"] == VERSION
            and batch["split"] == "train", "training_diagnostic_batch_scope_changed")
    require(assignment["task"] == "STUDENT-07" and len(assignment["cases"]) == len(batch["examples"]) == 2
            and tuple(row["exampleId"] for row in assignment["cases"]) == CASE_IDS, "training_diagnostic_selection_changed")
    for example, case in zip(batch["examples"], assignment["cases"]):
        validate_input(example, contract, family, ("train",))
        require(example["exampleId"] == case["exampleId"] and example["familyId"] == case["familyId"]
                and canonical_sha(example) == case["inputCanonicalJsonSha256"]
                and sorted({f["sourceSha256"] for f in example["evidence"]}) == sorted(case["sourceSha256"]),
                "training_diagnostic_input_pin_changed")
    return batch["examples"]


def run_training(examples, contract, family_freeze, model_path, require_boundary, preserve_raw, *, model_loader, cases):
    # Same initialization and generation as the immutable student.run_local.
    # Only split validation, pre-generation pins and result scope differ.
    require_boundary()
    for example in examples:
        validate_input(example, contract, family_freeze, ("train",))
    import torch
    import transformers
    from transformers import AutoTokenizer, StoppingCriteria, StoppingCriteriaList

    started = time.perf_counter()
    torch.set_num_threads(SETTINGS["cpuThreads"])
    torch.set_num_interop_threads(SETTINGS["cpuThreads"])
    torch.manual_seed(SETTINGS["seed"])
    torch.use_deterministic_algorithms(True)
    torch.backends.cuda.matmul.allow_tf32 = False
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable inside the accepted containment boundary")
    free, total = torch.cuda.mem_get_info()
    minimum = SETTINGS["minimumFreeCudaBytes"]
    if free < minimum + 2 * 1024**3:
        raise RuntimeError("insufficient GPU headroom for this frozen small baseline")
    torch.cuda.set_per_process_memory_fraction(min(6 * 1024**3, free - minimum) / total)
    torch.cuda.reset_peak_memory_stats()
    samples = []

    def gpu_check():
        free_now, total_now = torch.cuda.mem_get_info()
        sample = {"freeBytes": free_now, "totalBytes": total_now,
                  "allocatedBytes": torch.cuda.memory_allocated(), "reservedBytes": torch.cuda.memory_reserved()}
        samples.append(sample)
        if (sample["allocatedBytes"] > SETTINGS["maxCudaAllocatedBytes"]
                or sample["reservedBytes"] > SETTINGS["maxCudaReservedBytes"] or free_now < minimum):
            raise RuntimeError("GPU allocation/reservation/headroom boundary exceeded")
        return sample

    class ResourceCheck(StoppingCriteria):
        def __call__(self, input_ids, scores, **kwargs):
            gpu_check()
            return False

    gpu_check()
    tokenizer = AutoTokenizer.from_pretrained(str(model_path), local_files_only=True, trust_remote_code=False)
    # Check both original prompt hashes/counts before generating either case.
    require(tuple(e["exampleId"] for e in examples) == tuple(c["exampleId"] for c in cases) == CASE_IDS,
            "training_generation_order_changed")
    for example, case in zip(examples, cases):
        prompt = tokenizer.apply_chat_template(prompt_messages(example), tokenize=False, add_generation_prompt=True)
        require(hashlib.sha256(prompt.encode()).hexdigest() == case["promptSha256"]
                and len(tokenizer.encode(prompt, add_special_tokens=False)) == case["promptTokens"],
                "training_generation_prompt_changed")
    model = model_loader(model_path)
    torch.cuda.synchronize()
    loaded_seconds = time.perf_counter() - started
    gpu_check()
    raw_outputs, results = [], []
    for example in examples:
        prompt = tokenizer.apply_chat_template(prompt_messages(example), tokenize=False, add_generation_prompt=True)
        encoded = tokenizer(prompt, return_tensors="pt", add_special_tokens=False)
        input_tokens = int(encoded["input_ids"].shape[1])
        if input_tokens > SETTINGS["maxInputTokens"]:
            raise RuntimeError("frozen input token bound exceeded; no truncation")
        encoded = {key: value.to("cuda") for key, value in encoded.items()}
        before = time.perf_counter()
        with torch.inference_mode():
            generated = model.generate(**encoded, max_new_tokens=SETTINGS["maxNewTokens"], do_sample=False,
                use_cache=True, pad_token_id=tokenizer.eos_token_id,
                stopping_criteria=StoppingCriteriaList([ResourceCheck()]))
        torch.cuda.synchronize()
        seconds = time.perf_counter() - before
        output_ids = generated[0, input_tokens:]
        raw = tokenizer.decode(output_ids, skip_special_tokens=True)
        raw_record = {"exampleId": example["exampleId"], "rawText": raw,
                      "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                      "inputTokens": input_tokens, "outputTokens": len(output_ids),
                      "generationSeconds": seconds, "reachedTokenLimit": len(output_ids) == SETTINGS["maxNewTokens"]}
        preserve_raw(len(raw_outputs), raw_record)
        checked = project_raw(raw, example, contract, family_freeze, ("train",))
        raw_outputs.append(raw_record)
        results.append({"exampleId": example["exampleId"], **checked})
        del generated, output_ids, encoded
        gpu_check()
    return raw_outputs, {"version": VERSION, "task": "STUDENT-07", "split": "train", "results": results,
        "modelOutputValidCount": sum(row["modelOutputValid"] for row in results), "exampleCount": len(results),
        "settings": SETTINGS, "loadSeconds": loaded_seconds, "elapsedSeconds": time.perf_counter() - started,
        "runtime": {"torch": torch.__version__, "transformers": transformers.__version__, "cuda": torch.version.cuda,
                    "gpu": torch.cuda.get_device_name(), "gpuSampleCount": len(samples),
                    "maxCudaAllocatedBytes": torch.cuda.max_memory_allocated(), "maxCudaReservedBytes": torch.cuda.max_memory_reserved(),
                    "minimumSampledFreeCudaBytes": min(s["freeBytes"] for s in samples)},
        "evaluationOpened": False, "developmentOpened": False, "teacherTargetsInPrompt": False,
        "qualification": QUALIFICATION,
        "legacyCompletionQualification": "source_native_development_only is fixed supervisor metadata, not this diagnostic's scope"}
