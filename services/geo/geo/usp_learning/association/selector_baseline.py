"""Future contained pretrained selector baseline; no adapter or training path."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import time
import unicodedata
import sys

from .student import SETTINGS
from .selectors import POLICY, PROMPT_VERSION, PROMPT_SHA, SCHEMA_SHA, SYSTEM_PROMPT, canonical, checked_schema, context, project
from .validation import require, strict_json, validate_input

FREEZE_VERSION = "association-selector-baseline-freeze/1"
ASSIGNMENT_VERSION = "association-selector-baseline-assignment/1"
MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
AUXILIARY_NAMES = {"selector-assignment.json", "selector-schema-v1.json", "selector-prompt.txt"}


def checked_assignment(assignment):
    require(assignment.get("version") == ASSIGNMENT_VERSION and assignment.get("task") == "STUDENT-09-BASELINE",
            "separate_selector_baseline_assignment_required")
    allowance = assignment.get("executionAllowance", {})
    require(allowance.get("stageModelRun") is True and allowance.get("inference") is True
            and allowance.get("fit") is False and allowance.get("evaluation") is False
            and allowance.get("promotion") is False and type(allowance.get("freshBaselinePhases")) is int
            and allowance["freshBaselinePhases"] == 1, "selector_baseline_execution_not_authorized")
    require(canonical(assignment.get("settings")) == canonical(SETTINGS)
            and assignment.get("model") == MODEL and assignment.get("revision") == REVISION,
            "selector_baseline_model_or_settings_drift")
    require(assignment.get("promptVersion") == PROMPT_VERSION and assignment.get("systemPromptSha256") == PROMPT_SHA
            and assignment.get("selectorSchemaCanonicalLfSha256") == SCHEMA_SHA
            and canonical(assignment.get("lexicalPolicy")) == canonical(POLICY), "selector_baseline_codec_or_prompt_drift")
    require(isinstance(assignment.get("studentCodeCommit"), str)
            and re.fullmatch(r"[a-f0-9]{40}", assignment["studentCodeCommit"]), "selector_baseline_code_commit_required")
    require(isinstance(assignment.get("inputBatchSha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", assignment["inputBatchSha256"]), "selector_baseline_input_pin_required")
    cases = assignment.get("cases")
    require(type(cases) is list and len(cases) == 2, "selector_baseline_two_frozen_cases_required")
    require(all(type(case) is dict and set(case) == {"exampleId", "inputCanonicalJsonSha256"}
                and type(case["exampleId"]) is str and type(case["inputCanonicalJsonSha256"]) is str
                and re.fullmatch(r"[a-f0-9]{64}", case["inputCanonicalJsonSha256"]) for case in cases)
            and len({case["exampleId"] for case in cases}) == 2, "selector_baseline_case_pins_invalid")
    return assignment


def checked_batch(batch, cases, contract, family, allowed_splits=("development",)):
    require(type(batch) is dict and set(batch) == {"version", "examples"}
            and batch["version"] == "association-development/1" and len(batch["examples"]) == len(cases) == 2,
            "selector_baseline_batch_scope_drift")
    sources = []
    for example, case in zip(batch["examples"], cases):
        require(example["exampleId"] == case["exampleId"], "selector_baseline_example_order_drift")
        sources.append(context(example, contract, family, allowed_splits,
                               expected_input_sha256=case["inputCanonicalJsonSha256"]))
    return sources


def checked_run_inputs(freeze, inputs):
    require(freeze["version"] == FREEZE_VERSION
            and set(freeze.get("inputSha256", {})) == {"input_batch", "schema", "family_freeze", "model_receipt"}
            and set(freeze.get("auxiliaryInputSha256", {})) == AUXILIARY_NAMES,
            "selector_baseline_freeze_or_auxiliary_set_drift")
    auxiliary = {}
    for name, digest in freeze["auxiliaryInputSha256"].items():
        raw = (Path(inputs) / name).read_bytes()
        require(hashlib.sha256(raw).hexdigest() == digest, "selector_baseline_auxiliary_pin_drift:" + name)
        auxiliary[name] = raw
    assignment = checked_assignment(strict_json(auxiliary["selector-assignment.json"]))
    require(auxiliary["selector-prompt.txt"] == SYSTEM_PROMPT.encode("utf-8"), "selector_baseline_prompt_bytes_drift")
    require(freeze.get("sourceCommit") == assignment["studentCodeCommit"]
            and freeze.get("promptVersion") == PROMPT_VERSION and freeze.get("systemPromptSha256") == PROMPT_SHA
            and canonical(freeze.get("lexicalPolicy")) == canonical(POLICY)
            and canonical(freeze.get("cases")) == canonical(assignment["cases"])
            and freeze.get("selectorSchemaCanonicalLfSha256") == SCHEMA_SHA
            and freeze.get("model") == MODEL and freeze.get("modelRevision") == REVISION
            and canonical(freeze.get("settings")) == canonical(SETTINGS)
            and freeze["inputSha256"]["input_batch"] == assignment["inputBatchSha256"]
            and freeze.get("fitPerformed") is False and freeze.get("evaluationAllowed") is False,
            "selector_baseline_frozen_assignment_drift")
    return checked_schema(auxiliary["selector-schema-v1.json"]), assignment


def run_selectors(examples, contract, family_freeze, model_path, require_boundary, preserve_raw, *,
                  selector_contract, cases, preserve_preflight):
    require_boundary()  # before dependencies, model bytes or GPU initialization
    for example in examples:
        validate_input(example, contract, family_freeze, ("development",))
    batch = {"version": "association-development/1", "examples": examples}
    sources = checked_batch(batch, cases, contract, family_freeze)
    import torch
    import transformers
    from transformers import AutoModelForCausalLM, AutoTokenizer, StoppingCriteria, StoppingCriteriaList

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
    prompts, preflight = {}, []
    for example, source in zip(examples, sources):
        prompt = tokenizer.apply_chat_template(source.messages(), tokenize=False, add_generation_prompt=True)
        tokens = len(tokenizer.encode(prompt, add_special_tokens=False))
        prompts[example["exampleId"]] = prompt
        preflight.append({"exampleId": example["exampleId"], "inputCanonicalJsonSha256": source.input_sha256,
                          "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(), "inputTokens": tokens,
                          "privateLexicalView": source.private_view()})
    preserve_preflight({"version": FREEZE_VERSION, "promptVersion": PROMPT_VERSION, "systemPromptSha256": PROMPT_SHA,
                        "selectorSchemaCanonicalLfSha256": SCHEMA_SHA, "lexicalPolicy": POLICY,
                        "examples": preflight, "truncation": False, "teacherTargetsInPrompt": False,
                        "lexicalPythonVersion": sys.version, "unicodeVersion": unicodedata.unidata_version})
    require(all(row["inputTokens"] <= SETTINGS["maxInputTokens"] for row in preflight),
            "selector_input_token_bound_exceeded_no_truncation")
    model = AutoModelForCausalLM.from_pretrained(str(model_path), local_files_only=True, trust_remote_code=False,
        use_safetensors=True, torch_dtype=torch.float16, attn_implementation=SETTINGS["attention"]).to("cuda").eval()

    torch.cuda.synchronize()
    loaded_seconds = time.perf_counter() - started
    gpu_check()
    raw_outputs, results = [], []
    for example, source in zip(examples, sources):
        prompt = prompts[example["exampleId"]]
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
        raw_record = {"exampleId": example["exampleId"], "rawText": raw, "representation": "evidence-association-selectors/1",
                      "inputCanonicalJsonSha256": source.input_sha256,
                      "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                      "inputTokens": input_tokens, "outputTokens": len(output_ids),
                      "generationSeconds": seconds, "reachedTokenLimit": len(output_ids) == SETTINGS["maxNewTokens"]}
        preserve_raw(len(raw_outputs), raw_record)
        checked = project(raw, source, selector_contract, contract, family_freeze, ("development",))
        raw_outputs.append(raw_record)
        results.append({"exampleId": example["exampleId"], **checked})
        del generated, output_ids, encoded
        gpu_check()
    return raw_outputs, {"version": "association-selector-baseline-result/1", "results": results,
        "jsonSyntaxValidCount": sum(row["jsonSyntaxValid"] for row in results),
        "selectorSchemaValidCount": sum(row["selectorSchemaValid"] for row in results),
        "rawSelectorValidCount": sum(row["rawSelectorValid"] for row in results),
        "expandedOutputValidCount": sum(row["expandedOutputValid"] for row in results),
        "acceptedClaimCount": sum(row["acceptedClaimCount"] for row in results),
        "correctExpectedClaims": None, "expectedClaimsEvaluated": False,
        "promptVersion": PROMPT_VERSION, "systemPromptSha256": PROMPT_SHA, "lexicalPolicy": POLICY,
        "selectorSchemaCanonicalLfSha256": SCHEMA_SHA,
        "modelOutputValidCount": sum(row["modelOutputValid"] for row in results), "exampleCount": len(results),
        "settings": SETTINGS, "loadSeconds": loaded_seconds, "elapsedSeconds": time.perf_counter() - started,
        "runtime": {"torch": torch.__version__, "transformers": transformers.__version__, "cuda": torch.version.cuda,
                    "gpu": torch.cuda.get_device_name(), "gpuSampleCount": len(samples),
                    "maxCudaAllocatedBytes": torch.cuda.max_memory_allocated(), "maxCudaReservedBytes": torch.cuda.max_memory_reserved(),
                    "minimumSampledFreeCudaBytes": min(s["freeBytes"] for s in samples)},
        "evaluationOpened": False, "teacherOutputsUsed": False, "fitPerformed": False,
        "teacherTargetsInPrompt": False, "qualification": "span copying is source-exact, not semantic correctness; two related development examples, no canonical association or generalization qualification"}
