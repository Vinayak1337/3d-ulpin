#!/usr/bin/env python3
"""One frozen retained-Qwen comparison on V7 train/calibration; evaluation stays closed."""

from __future__ import annotations

import argparse
import ast
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import sys
import time
from typing import Any

from geo.usp_learning.corpus import input_proof, load_examples, sha256_file
from geo.usp_learning.resources import guarded_run, write_json_once


REVISION = "e61197ed45024b0ed8a2d74b80b4d909f1255473"
CORPUS_SHA = "81773eaf350d96778bc59c8f0f61a0d66e66cf335edb1ec167dd2ce1efd718c7"
PROOF_SHA = "b801b049abdea3f8c88bab8f5c72ef2916acf026ad5168fe45518e5c73259559"
E5_RESULT_SHA = "8be41670ad63cb99102e1472fdf529302530d8697b1214c61ae8f4023ef3eab2"
PRIOR_FILES = {
    "reranker_smoke.py": "e9638336b5d39eed0f056aaad5f001bc536ec6bfb5cf7f0cd0dde32fae777caf",
    "reranker-smoke-freeze.json": "362473be31229279d88b981fb3ba1adc114577d11a8e4f87b84e34055a6a1df9",
    "reranker-download-receipt.json": "31c9508464aae1ca28ed63a1302323c2a9f5eab281fc6d5a909e735df51b66de",
    "requirements-resolved.txt": "c27e534e121858d96dfa531e14374642a43bed9544aeef0426b39353280ab4e3",
}
CODE_PATHS = (
    "scripts/usp/learning/compare_reranker.py", "services/geo/geo/usp_learning/corpus.py",
    "services/geo/geo/usp_learning/model.py", "services/geo/geo/usp_learning/resources.py",
    "services/geo/geo/usp_learning/experiment.py",
)
INSTRUCTION = "Match the supplied source-field profile to the proposed building-field definition. Reject profiles for unrelated concepts or with insufficient supporting evidence."
PREFIX = "<|im_start|>system\nDecide whether the Document satisfies the Query under the given Instruct. Respond with only yes or no.<|im_end|>\n<|im_start|>user\n"
SUFFIX = "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
SETTINGS = {
    "seed": 17, "cpuThreads": 2, "device": "cuda", "dtype": "float16", "attention": "sdpa",
    "batchSize": 3, "maxTokens": 1024, "truncation": False, "useCache": False,
    "maxCudaAllocatedBytes": 3 * 1024**3, "maxCudaReservedBytes": 3 * 1024**3,
    "minimumFreeCudaBytes": 1536 * 1024**2, "maxPeakProcessRssBytes": 6 * 1024**3,
    "maxRunSeconds": 600, "maxFitSeconds": 600, "fixedDiagnosticThreshold": 0.5,
    "evaluationAllowed": False, "diagnosticSplitAllowed": False, "fittingAllowed": False,
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def prompts_for(items: list[dict], targets: list[dict]) -> list[str]:
    # Only publisher-derived text and the unchanged target definitions enter inference.
    return [PREFIX + "<Instruct>: " + INSTRUCTION + "\n<Query>: " + target["description"]
            + "\n<Document>: " + item["text"] + SUFFIX for item in items for target in targets]


def checked_context(args: argparse.Namespace, *, check_model: bool = False) -> tuple[dict, list[dict], dict, dict]:
    for name, digest in PRIOR_FILES.items():
        require(sha256_file(args.retained_dir / name) == digest, f"prior smoke evidence changed: {name}")
    require(sha256_file(args.corpus) == CORPUS_SHA and sha256_file(args.input_proof) == PROOF_SHA,
            "requires the unchanged V7 corpus and input proof")
    corpus, all_items = load_examples(args.corpus, args.originals_dir)
    require(input_proof(args.corpus, all_items) == read_json(args.input_proof), "publisher input proof does not replay")
    items = [item for item in all_items if item["split"] in ("train", "calibration")]
    require(len(items) == 65 and sum(item["split"] == "train" for item in items) == 40,
            "requires exactly 40 training and 25 calibration fields")
    old = read_json(args.retained_dir / "reranker-smoke-freeze.json")
    require(old["modelRevision"] == REVISION and old["candidateTargets"] == corpus["targets"]
            and old["instruction"] == INSTRUCTION, "prior prompt or target vocabulary changed")
    constants = {node.targets[0].id: node.value.value for node in ast.parse(
        (args.retained_dir / "reranker_smoke.py").read_text(encoding="utf-8")).body
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
        and isinstance(node.value, ast.Constant)}
    require([constants[name] for name in ("instruction", "prefix", "suffix")] == [INSTRUCTION, PREFIX, SUFFIX],
            "prompt construction differs from the retained smoke")
    receipt = read_json(args.retained_dir / "reranker-download-receipt.json")
    require(receipt["revision"] == REVISION and receipt["license"] == "apache-2.0"
            and not receipt["remoteCodeDownloaded"], "unexpected retained model")
    model_dir = Path(receipt["path"])
    if check_model:
        for evidence in receipt["files"]:
            path = model_dir / evidence["file"]
            require(path.stat().st_size == evidence["bytes"] and sha256_file(path) == evidence["sha256"],
                    f"retained model bytes changed: {path.name}")
    versions = {}
    for line in (args.retained_dir / "requirements-resolved.txt").read_text(encoding="utf-8").splitlines():
        if "==" in line:
            name, version = line.split("==")
            versions[name] = importlib.metadata.version(name)
            require(versions[name] == version, f"locked dependency mismatch: {name}")
    require(sha256_file(args.e5_result) == E5_RESULT_SHA, "saved E5 result changed")
    e5 = read_json(args.e5_result)
    require(e5["corpus"]["fileSha256"] == CORPUS_SHA, "E5 used a different corpus")
    for split in ("train", "calibration"):
        expected = [(item["source"], item["path"], item["target"]) for item in items if item["split"] == split]
        for route in ("base", "savedReloadedTuned", "lexical"):
            require([(row["source"], row["field"], row["expected"])
                     for row in e5["comparison"][route][split]["decisions"]] == expected,
                    "saved E5 labels/order differ from the selected V7 split")
    return corpus, items, receipt, versions


def selected_inputs(items: list[dict], targets: list[dict]) -> dict:
    return {"fields": [{key: item[key] for key in ("source", "family", "split", "path", "text")}
                       for item in items], "targets": targets, "prompts": prompts_for(items, targets)}


def frozen_config(args: argparse.Namespace, inputs: dict, receipt: dict, versions: dict, token_lengths: list[int]) -> dict:
    from geo.usp_learning.experiment import ACCEPTANCE, FIT

    repo = Path(__file__).resolve().parents[3]
    return {
        "schemaVersion": "usp-qwen-v7-comparison-freeze-v1", "corpusSha256": CORPUS_SHA,
        "inputProofSha256": PROOF_SHA, "priorFileSha256": PRIOR_FILES, "model": receipt,
        "selectedInputsSha256": sha256_file(args.output_dir / "selected-inputs.json"),
        "promptSha256": [hashlib.sha256(text.encode("utf-8")).hexdigest() for text in inputs["prompts"]],
        "codeSha256": {name: sha256_file(repo / name) for name in CODE_PATHS},
        "pythonExecutable": str(Path(sys.executable).resolve()), "pythonVersion": platform.python_version(),
        "dependencies": versions, "settings": SETTINGS,
        "prompt": {"instruction": INSTRUCTION, "prefix": PREFIX, "suffix": SUFFIX,
                   "query": "unchanged target description", "document": "publisher-only source profile"},
        "selectionPolicy": {"name": FIT["thresholdPolicy"], "rule": ACCEPTANCE["calibration"],
                            "thresholdScope": "one global threshold from calibration only",
                            "evaluationMayOpen": False, "diagnosticSplitMayOpen": False},
        "scoreDefinition": "Final-token logits [no, yes], cast float32, softmax, yes probability",
        "tokenLengths": token_lengths, "fields": 65, "candidatePairs": 195,
        "savedE5ResultSha256": E5_RESULT_SHA,
    }


def prepare(args: argparse.Namespace) -> None:
    import psutil
    import torch
    from transformers import AutoTokenizer

    corpus, items, receipt, versions = checked_context(args, check_model=True)
    require(torch.cuda.is_available(), "CUDA unavailable")
    torch.set_num_threads(SETTINGS["cpuThreads"])
    free, total = torch.cuda.mem_get_info()
    require(free >= SETTINGS["maxCudaReservedBytes"] + SETTINGS["minimumFreeCudaBytes"], "insufficient GPU headroom")
    memory, disk = psutil.virtual_memory(), shutil.disk_usage(args.originals_dir)
    require(memory.available > SETTINGS["maxPeakProcessRssBytes"] + 1024**3, "insufficient RAM headroom")
    require(disk.free > 256 * 1024**2, "insufficient artifact disk space")
    inputs = selected_inputs(items, corpus["targets"])
    tokenizer = AutoTokenizer.from_pretrained(receipt["path"], padding_side="left", local_files_only=True, trust_remote_code=False)
    lengths = [len(tokenizer.encode(text, add_special_tokens=False)) for text in inputs["prompts"]]
    require(max(lengths) <= SETTINGS["maxTokens"], "refuse to truncate any source profile")
    args.output_dir.mkdir(parents=True, exist_ok=False)
    write_json_once(args.output_dir / "selected-inputs.json", inputs)
    config = frozen_config(args, inputs, receipt, versions, lengths)
    write_json_once(args.output_dir / "freeze.json", config)
    repo = Path(__file__).resolve().parents[3]
    for name in CODE_PATHS:
        destination = args.output_dir / "code" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as stream:
            stream.write((repo / name).read_bytes())
    write_json_once(args.output_dir / "preflight.json", {
        "gpuName": torch.cuda.get_device_name(), "gpuFreeBytes": free, "gpuTotalBytes": total,
        "availableRamBytes": memory.available, "diskFreeBytes": disk.free, "maxInputTokens": max(lengths),
        "freezeSha256": sha256_file(args.output_dir / "freeze.json"), "modelInference": "not_run",
    })
    print(json.dumps({"status": "prepared_without_inference", "fields": 65, "pairs": 195, "maxInputTokens": max(lengths)}))


def validate(args: argparse.Namespace, *, check_model: bool = False) -> tuple[dict, list[dict], dict]:
    corpus, items, receipt, versions = checked_context(args, check_model=check_model)
    frozen = read_json(args.output_dir / "freeze.json")
    inputs = selected_inputs(items, corpus["targets"])
    require(inputs == read_json(args.output_dir / "selected-inputs.json"), "selected source inputs changed")
    require(frozen == frozen_config(args, inputs, receipt, versions, frozen["tokenLengths"]),
            "frozen code, inputs, model, dependencies or policy changed")
    return corpus, items, frozen


def worker(args: argparse.Namespace) -> None:
    import psutil

    supervisor = int(os.environ.get("USP_LEARNING_SUPERVISOR_PID", "0"))
    require(supervisor in {proc.pid for proc in psutil.Process().parents()}, "worker requires its live supervisor")
    attempt = read_json(args.output_dir / "attempt.json")
    require(attempt["freezeSha256"] == sha256_file(args.output_dir / "freeze.json")
            and attempt["outputDir"] == str(args.output_dir.resolve()), "supervised attempt does not match")
    started = time.monotonic()
    corpus, items, frozen = validate(args, check_model=True)
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from geo.usp_learning.model import allowed_target_indices, choose_calibration_threshold, metrics, predict

    torch.set_num_threads(SETTINGS["cpuThreads"])
    torch.manual_seed(SETTINGS["seed"])
    require(torch.cuda.is_available(), "CUDA unavailable")
    free, total = torch.cuda.mem_get_info()
    require(free >= SETTINGS["maxCudaReservedBytes"] + SETTINGS["minimumFreeCudaBytes"], "insufficient GPU headroom")
    torch.cuda.set_per_process_memory_fraction(SETTINGS["maxCudaReservedBytes"] / total)
    torch.cuda.reset_peak_memory_stats()
    minimum_free = free

    def check_gpu() -> None:
        nonlocal minimum_free
        torch.cuda.synchronize()
        current_free, _ = torch.cuda.mem_get_info()
        minimum_free = min(minimum_free, current_free)
        require(torch.cuda.max_memory_allocated() <= SETTINGS["maxCudaAllocatedBytes"]
                and torch.cuda.max_memory_reserved() <= SETTINGS["maxCudaReservedBytes"], "GPU allocation/reservation budget exceeded")
        require(current_free >= SETTINGS["minimumFreeCudaBytes"], "GPU free headroom breached")

    tokenizer = AutoTokenizer.from_pretrained(frozen["model"]["path"], padding_side="left", local_files_only=True, trust_remote_code=False)
    texts = prompts_for(items, corpus["targets"])
    lengths = [len(tokenizer.encode(text, add_special_tokens=False)) for text in texts]
    require(lengths == frozen["tokenLengths"] and max(lengths) <= SETTINGS["maxTokens"], "tokenized inputs differ or need truncation")
    yes, no = tokenizer.convert_tokens_to_ids("yes"), tokenizer.convert_tokens_to_ids("no")
    require(yes != no and yes != tokenizer.unk_token_id and no != tokenizer.unk_token_id, "invalid answer tokens")
    model = AutoModelForCausalLM.from_pretrained(
        frozen["model"]["path"], torch_dtype=torch.float16, attn_implementation="sdpa",
        local_files_only=True, trust_remote_code=False, use_safetensors=True).to("cuda").eval()
    require(next(model.parameters()).dtype == torch.float16 and model.config._attn_implementation == "sdpa",
            "loaded model precision/attention differs from freeze")
    check_gpu()
    run_dir = args.output_dir / "run"
    write_json_once(run_dir / "inference-started.json", {"monotonic": time.monotonic(), "pairs": len(texts)})
    scores = []
    inference_started = time.monotonic()
    with torch.inference_mode():
        for at in range(0, len(texts), SETTINGS["batchSize"]):
            batch = tokenizer(texts[at:at + SETTINGS["batchSize"]], padding=True, truncation=False,
                              add_special_tokens=False, return_tensors="pt").to("cuda")
            logits = model(**batch, use_cache=False, logits_to_keep=1).logits[:, -1, [no, yes]].float()
            score = torch.softmax(logits, dim=-1)[:, 1]
            require(bool(torch.isfinite(score).all()), "nonfinite reranker scores")
            scores.extend(score.cpu().tolist())
            check_gpu()
    inference_seconds = time.monotonic() - inference_started
    resource = {"device": torch.cuda.get_device_name(), "dtype": "float16", "attention": "sdpa",
                "gpuPeakAllocatedBytes": torch.cuda.max_memory_allocated(), "gpuPeakReservedBytes": torch.cuda.max_memory_reserved(),
                "minimumSampledFreeGpuBytes": minimum_free, "inferenceSeconds": round(inference_seconds, 6),
                "torchThreads": torch.get_num_threads(), "maxInputTokens": max(lengths),
                "gpuScope": "PyTorch allocator peaks include model load; free device memory sampled after load and every batch"}
    matrix = torch.tensor(scores).reshape(len(items), len(corpus["targets"]))
    write_json_once(run_dir / "scores.json", {"targets": [target["id"] for target in corpus["targets"]],
                    "fields": [{key: item[key] for key in ("source", "path", "split")} for item in items],
                    "scores": matrix.tolist(), "scoreDefinition": frozen["scoreDefinition"]})
    del model, batch, logits, score
    gc.collect()
    torch.cuda.empty_cache()
    # All subsequent decisions use only the saved matrix. No evaluation branch exists.
    matrix = torch.tensor(read_json(run_dir / "scores.json")["scores"])
    indexes = {split: [i for i, item in enumerate(items) if item["split"] == split] for split in ("train", "calibration")}
    calibration = [items[i] for i in indexes["calibration"]]
    threshold = choose_calibration_threshold(calibration, matrix[indexes["calibration"]])
    selection = {"scoresSha256": sha256_file(run_dir / "scores.json"), "freezeSha256": sha256_file(args.output_dir / "freeze.json"),
                 "fixedDiagnosticThreshold": 0.5, "calibratedGlobalThreshold": threshold,
                 "policy": frozen["selectionPolicy"], "evaluationOpened": False, "diagnosticSplitOpened": False}
    write_json_once(run_dir / "selection.json", selection)
    comparison: dict[str, Any] = {"qwenFixedDiagnostic": {}, "qwenCalibrated": {}}
    for route, cutoff in (("qwenFixedDiagnostic", 0.5), ("qwenCalibrated", threshold)):
        for split, indices in indexes.items():
            subset, values = [items[i] for i in indices], matrix[indices]
            guesses = predict(subset, values, cutoff) if cutoff is not None else [None] * len(subset)
            result = metrics(subset, None, None, guesses)
            result.update(decisionThreshold=cutoff, scoreKind="final-token yes probability",
                          calibrationStatus="fixed_uncalibrated_diagnostic" if route == "qwenFixedDiagnostic"
                          else "useful_operating_point" if cutoff is not None else "no_useful_operating_point")
            for row, example, probabilities in zip(result["decisions"], subset, values.tolist()):
                row.pop("topAllowedCosine")
                allowed = allowed_target_indices(example)
                row["topAllowedYesProbability"] = max(probabilities[i] for i in allowed) if allowed else None
            comparison[route][split] = result
    saved = read_json(args.e5_result)["comparison"]
    comparison.update({name: saved[route] for name, route in (("savedE5Base", "base"), ("savedE5Tuned", "savedReloadedTuned"), ("savedLexical", "lexical"))})
    require(all(set(sections) == {"train", "calibration"} for sections in comparison.values()), "closed split appeared in output")
    write_json_once(run_dir / "result.json", {
        "status": "offline_development_comparison_only", "trained": False, "promoted": False,
        "evaluationOpened": False, "diagnosticSplitOpened": False, "selection": selection,
        "comparison": comparison, "resources": {**resource, "workerElapsedSeconds": round(time.monotonic() - started, 3)},
        "modelRevision": REVISION, "modelWeightSha256": next(item["sha256"] for item in frozen["model"]["files"] if item["file"] == "model.safetensors"),
        "savedE5ResultSha256": E5_RESULT_SHA,
    })


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "run"))
    for name in ("corpus", "input-proof", "originals-dir", "retained-dir", "e5-result", "output-dir"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2")
    if args._worker:
        worker(args)
    elif args.action == "prepare":
        prepare(args)
    else:
        _, _, frozen = validate(args)
        require(not (args.output_dir / "run").exists(), "run exists; previous attempts must stay unchanged")
        write_json_once(args.output_dir / "attempt.json", {"freezeSha256": sha256_file(args.output_dir / "freeze.json"),
                        "outputDir": str(args.output_dir.resolve()), "rule": "One pass only, including failures; any further pass needs a new assignment"})
        (args.output_dir / "run").mkdir()
        guard = guarded_run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], "--_worker"],
                            args.output_dir / "run", frozen["settings"])
        if guard["exitCode"]:
            raise SystemExit(guard["exitCode"])
        result = read_json(args.output_dir / "run/result.json")
        write_json_once(args.output_dir / "run/run.json", {**result, "supervisor": guard})
        print(json.dumps({"run": str(args.output_dir / "run/run.json"), "threshold": result["selection"]["calibratedGlobalThreshold"],
                          "evaluationOpened": False, "promoted": False}))


if __name__ == "__main__":
    main()
