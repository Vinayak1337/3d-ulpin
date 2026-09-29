#!/usr/bin/env python3
"""One frozen, resource-bounded offline E5 fit; no production activation."""

from __future__ import annotations

import argparse
import gc
import importlib.metadata
import json
import os
import platform
import random
import sys
import time
from pathlib import Path
from typing import Any

from geo.usp_learning.corpus import lexical_prediction, load_examples, sha256_file
from geo.usp_learning.experiment import validate_freeze
from geo.usp_learning.resources import guarded_run, write_json_once


def run_candidate(args: argparse.Namespace, config: dict[str, Any], corpus: dict[str, Any],
                  examples: list[dict[str, Any]]) -> None:
    import numpy as np
    import torch
    import torch.nn.functional as F

    from geo.usp_learning.model import (
        BASE_CONFIG_SHA256, BASE_REVISION, BASE_WEIGHT_SHA256, choose_calibration_threshold,
        choose_train_threshold, freeze_except_last_layer, last_layer, load_adapter, load_base,
        metrics, predict, save_adapter, score_matrix,
    )

    started = time.monotonic()
    fit = config["fit"]
    torch.set_num_threads(fit["cpuThreads"])
    torch.set_num_interop_threads(1)
    torch.manual_seed(fit["seed"])
    random.seed(fit["seed"])
    np.random.seed(fit["seed"])
    torch.use_deterministic_algorithms(True)
    device = torch.device(fit["device"])
    cuda = device.type == "cuda"
    if cuda:
        if not torch.cuda.is_available():
            raise ValueError("frozen CUDA device is unavailable")
        free, total = torch.cuda.mem_get_info(device)
        if free < fit["maxCudaReservedBytes"] + fit["cudaHeadroomBytes"]:
            raise MemoryError("insufficient GPU headroom for frozen allocator budget")
        torch.cuda.set_per_process_memory_fraction(fit["maxCudaReservedBytes"] / total, device)
        torch.cuda.reset_peak_memory_stats(device)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False

    def check_cuda() -> None:
        if cuda:
            torch.cuda.synchronize(device)
            if torch.cuda.max_memory_reserved(device) > fit["maxCudaReservedBytes"]:
                raise MemoryError("CUDA allocator exceeded frozen reserved-memory limit")

    splits = {split: [item for item in examples if item["split"] == split]
              for split in ("train", "calibration", "evaluation", "diagnostic")}
    train, calibration = splits["train"], splits["calibration"]
    tokenizer, model = load_base(args.base_dir)
    model.to(device=device, dtype=torch.float32)
    with torch.no_grad():
        # Evaluation is not encoded or scored until selection.json is closed.
        base_train = score_matrix(tokenizer, model, train, corpus["targets"])
        base_calibration = score_matrix(tokenizer, model, calibration, corpus["targets"])
    if not torch.isfinite(base_train).all() or not torch.isfinite(base_calibration).all():
        raise ValueError("nonfinite base scores")
    base_threshold = choose_calibration_threshold(calibration, base_calibration)
    train_anchor = choose_train_threshold(train, base_train)
    trainable_parameters = freeze_except_last_layer(model)
    initial_layer = {key: value.detach().cpu().clone() for key, value in last_layer(model).state_dict().items()}
    model.train()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad),
                                 lr=fit["learningRate"], weight_decay=fit["weightDecay"])
    label_indices = {target["id"]: index for index, target in enumerate(corpus["targets"])}
    labels = torch.zeros((len(train), len(label_indices)), dtype=torch.float32, device=device)
    for row, item in enumerate(train):
        if item["target"] is not None:
            labels[row, label_indices[item["target"]]] = 1.0
    positive_pairs = int(labels.sum().item())
    negative_pairs = labels.numel() - positive_pairs
    if positive_pairs < 2 or negative_pairs < 2:
        raise ValueError("insufficient checked training pairs")
    positive_weight = torch.tensor(min(negative_pairs / positive_pairs, 8.0), dtype=torch.float32, device=device)
    losses = []
    fit_started = time.monotonic()
    write_json_once(args.output_dir / "fit-started.json", {"monotonic": fit_started})
    for _ in range(fit["steps"]):
        optimizer.zero_grad(set_to_none=True)
        scores = score_matrix(tokenizer, model, train, corpus["targets"])
        loss = F.binary_cross_entropy_with_logits((scores - train_anchor) * 20.0, labels, pos_weight=positive_weight)
        if not torch.isfinite(loss):
            raise ValueError("nonfinite training loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_((p for p in model.parameters() if p.requires_grad), 1.0,
                                     error_if_nonfinite=True)
        optimizer.step()
        losses.append(float(loss.detach().cpu()))
        check_cuda()
        if time.monotonic() - fit_started > fit["maxFitSeconds"]:
            raise TimeoutError("fit exceeded frozen wall-clock limit")
    fit_finished = time.monotonic()
    write_json_once(args.output_dir / "fit-completed.json", {"monotonic": fit_finished})
    model.eval()
    max_weight_change = max(float((value.detach().cpu() - initial_layer[key]).abs().max())
                            for key, value in last_layer(model).state_dict().items())
    if not max_weight_change > 0:
        raise RuntimeError("encoder fit did not change the last layer")
    with torch.no_grad():
        before_save = score_matrix(tokenizer, model, calibration, corpus["targets"]).cpu()
    adapter_path = args.output_dir / "candidate.safetensors"
    adapter_sha = save_adapter(model, adapter_path)
    del optimizer, initial_layer, model, scores, loss
    gc.collect()
    if cuda:
        torch.cuda.empty_cache()
    _, reloaded = load_base(args.base_dir)
    reloaded.to(device=device, dtype=torch.float32)
    load_adapter(reloaded, adapter_path, adapter_sha)
    with torch.no_grad():
        tuned_calibration = score_matrix(tokenizer, reloaded, calibration, corpus["targets"]).cpu()
    max_reload_delta = float((tuned_calibration - before_save).abs().max())
    if not torch.isfinite(tuned_calibration).all() or max_reload_delta > fit["reloadTolerance"]:
        raise RuntimeError(f"saved adapter reload changed scores: {max_reload_delta}")
    tuned_threshold = choose_calibration_threshold(calibration, tuned_calibration)
    if tuned_threshold is not None and predict(calibration, before_save, tuned_threshold) != predict(calibration, tuned_calibration, tuned_threshold):
        raise RuntimeError("adapter reload changed calibration decisions")

    def decision_metrics(items: list[dict[str, Any]], scores: Any, threshold: float | None) -> dict[str, Any]:
        if threshold is None:
            result = metrics(items, scores, None, [None] * len(items))
            result.update(calibrationStatus="no_useful_operating_point", decisionThreshold=None)
            return result
        return metrics(items, scores, threshold)

    selection = {
        "freezeSha256": sha256_file(args.freeze_file), "adapterSha256": adapter_sha,
        "baseThreshold": base_threshold, "tunedThreshold": tuned_threshold,
        "reloadMaxCosineDelta": max_reload_delta,
        "calibration": {"base": decision_metrics(calibration, base_calibration, base_threshold),
                        "tuned": decision_metrics(calibration, tuned_calibration, tuned_threshold)},
        # Retain scores for a failed operating point without another model run.
        "calibrationScores": {
            "targets": list(label_indices),
            "fields": [{"source": item["source"], "path": item["path"]} for item in calibration],
            "base": base_calibration.detach().cpu().tolist(),
            "savedReloadedTuned": tuned_calibration.tolist(),
        },
        "evaluationMayOpen": tuned_threshold is not None,
        "acceptance": config["acceptance"],
    }
    # Freeze weights and thresholds before computing even lexical evaluation predictions.
    write_json_once(args.output_dir / "selection.json", selection)
    comparison = {"thresholdSource": fit["thresholdPolicy"], "lexical": {}, "base": {}, "savedReloadedTuned": {}}
    comparison["base"]["train"] = decision_metrics(train, base_train, base_threshold)
    comparison["base"]["calibration"] = selection["calibration"]["base"]
    comparison["savedReloadedTuned"]["calibration"] = selection["calibration"]["tuned"]
    with torch.no_grad():
        tuned_train = score_matrix(tokenizer, reloaded, train, corpus["targets"])
    comparison["savedReloadedTuned"]["train"] = decision_metrics(train, tuned_train, tuned_threshold)
    for split in ("train", "calibration"):
        comparison["lexical"][split] = metrics(splits[split], None, None, [lexical_prediction(item) for item in splits[split]])
    if selection["evaluationMayOpen"]:
        write_json_once(args.output_dir / "evaluation-opened.json", {
            "selectionSha256": sha256_file(args.output_dir / "selection.json"),
            "evaluationFamilies": config["splits"]["evaluation"],
            "rule": "One final comparison; subsequent use is diagnostic only",
        })
        with torch.no_grad():
            for split in ("evaluation", "diagnostic"):
                comparison["savedReloadedTuned"][split] = decision_metrics(
                    splits[split], score_matrix(tokenizer, reloaded, splits[split], corpus["targets"]), tuned_threshold)
        del reloaded
        gc.collect()
        if cuda:
            torch.cuda.empty_cache()
        _, unchanged = load_base(args.base_dir)
        unchanged.to(device=device, dtype=torch.float32)
        with torch.no_grad():
            for split in ("evaluation", "diagnostic"):
                comparison["base"][split] = decision_metrics(
                    splits[split], score_matrix(tokenizer, unchanged, splits[split], corpus["targets"]), base_threshold)
                comparison["lexical"][split] = metrics(splits[split], None, None, [lexical_prediction(item) for item in splits[split]])
    check_cuda()
    improvement = {}
    if selection["evaluationMayOpen"]:
        candidate = comparison["savedReloadedTuned"]["evaluation"]
        for baseline in ("lexical", "base"):
            reference = comparison[baseline]["evaluation"]
            improvement[baseline] = (candidate["correctPositive"] > reference["correctPositive"]
                                     and candidate["incorrectMappings"] <= reference["incorrectMappings"])
    report = {
        "status": "offline_candidate_only", "promotion": "blocked_offline_experiment",
        "evaluationStatus": "observed_once" if selection["evaluationMayOpen"] else "unopened_calibration_not_useful",
        "evaluationInterpretation": config["acceptance"]["scope"],
        "freeze": {"sha256": sha256_file(args.freeze_file), "configuration": config},
        "inputProofSha256": sha256_file(args.input_proof),
        "selectionSha256": sha256_file(args.output_dir / "selection.json"),
        "base": {"repo": "intfloat/multilingual-e5-small", "revision": BASE_REVISION,
                 "weightSha256": BASE_WEIGHT_SHA256, "configSha256": BASE_CONFIG_SHA256, "license": "MIT",
                 "fileSha256": {p.name: sha256_file(p) for p in args.base_dir.iterdir() if p.is_file()}},
        "candidate": {"file": adapter_path.name, "sha256": adapter_sha, "fineTunedModule": "BertModel.encoder.layer.11",
                      "trainableParameters": trainable_parameters, "maximumAbsoluteWeightChange": max_weight_change,
                      "steps": fit["steps"], "seed": fit["seed"], "learningRate": fit["learningRate"],
                      "reloadMaxCosineDelta": max_reload_delta},
        "corpus": {"fileSha256": sha256_file(args.corpus), "featureVersion": corpus["featureVersion"],
                   "coverage": config["coverage"], "splits": config["splits"],
                   "sourceOriginals": {source["id"]: {kind: source[kind] for kind in ("sample", "metadata")}
                                       for source in corpus["sources"]}},
        "comparison": comparison, "improvementOver": improvement,
        "resources": {"fitSeconds": round(fit_finished - fit_started, 3),
                      "workerElapsedSeconds": round(time.monotonic() - started, 3),
                      "device": str(device), "precision": "float32", "torchThreads": torch.get_num_threads(),
                      "deviceName": torch.cuda.get_device_name(device) if cuda else platform.processor(),
                      "peakCudaAllocatedBytes": torch.cuda.max_memory_allocated(device) if cuda else 0,
                      "peakCudaReservedBytes": torch.cuda.max_memory_reserved(device) if cuda else 0,
                      "cudaMemoryScope": "PyTorch allocator only; driver/context and other processes excluded"},
        "dependencies": {name: importlib.metadata.version(name) for name in
                         ("torch", "transformers", "huggingface-hub", "safetensors", "numpy", "psutil")},
        "python": platform.python_version(), "platform": platform.platform(),
        "loss": {"first": losses[0], "last": losses[-1]},
    }
    write_json_once(args.output_dir / "candidate-result.json", report)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("corpus", "originals-dir", "base-dir", "output-dir", "freeze-file", "input-proof"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--_worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    os.environ.update(TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2",
                      CUBLAS_WORKSPACE_CONFIG=":4096:8", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    repo = Path(__file__).resolve().parents[3]
    corpus, examples = load_examples(args.corpus, args.originals_dir)
    try:
        config = validate_freeze(args.freeze_file, args.corpus, args.input_proof, corpus, examples, repo)
    except ValueError as error:
        parser.error(str(error))
    if args.preflight_only:
        print(json.dumps({"status": "fit_eligible_no_model_run", "coverage": config["coverage"]}))
        return
    if args._worker:
        import psutil

        supervisor = int(os.environ.get("USP_LEARNING_SUPERVISOR_PID", "0"))
        if supervisor not in {parent.pid for parent in psutil.Process().parents()}:
            parser.error("worker requires a live resource supervisor")
        attempt = json.loads(args.freeze_file.with_suffix(".attempt.json").read_text(encoding="utf-8"))
        if (attempt["outputDir"] != str(args.output_dir.resolve())
                or attempt["freezeSha256"] != sha256_file(args.freeze_file)):
            parser.error("worker has no matching supervised attempt")
        run_candidate(args, config, corpus, examples)
        return
    if args.output_dir.exists():
        parser.error("output directory exists; runs and failed attempts are immutable")
    write_json_once(args.freeze_file.with_suffix(".attempt.json"), {
        "freezeSha256": sha256_file(args.freeze_file), "outputDir": str(args.output_dir.resolve()),
        "rule": "One candidate attempt only, including failures. A further fit needs a new assignment.",
    })
    args.output_dir.mkdir(parents=True)
    guard = guarded_run([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], "--_worker"],
                        args.output_dir, config["fit"])
    if guard["exitCode"]:
        raise SystemExit(guard["exitCode"])
    report = json.loads((args.output_dir / "candidate-result.json").read_text(encoding="utf-8"))
    report["resources"]["supervisor"] = guard
    write_json_once(args.output_dir / "run.json", report)
    print(json.dumps({"run": str(args.output_dir / "run.json"), "adapterSha256": report["candidate"]["sha256"],
                      "evaluationStatus": report["evaluationStatus"], "promotion": report["promotion"]}))


if __name__ == "__main__":
    main()
