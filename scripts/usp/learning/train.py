#!/usr/bin/env python3
"""Run the bounded AI-06A E5 experiment; never publish or activate its model."""

from __future__ import annotations

import argparse
import json
import os
import random
import resource
import signal
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F

from geo.usp_learning.corpus import CORPUS_VERSION, lexical_prediction, load_examples, sha256_file
from geo.usp_learning.model import (
    BASE_CONFIG_SHA256,
    BASE_REVISION,
    BASE_WEIGHT_SHA256,
    choose_train_threshold,
    freeze_except_last_layer,
    last_layer,
    load_adapter,
    load_base,
    metrics,
    save_adapter,
    score_matrix,
)


def _peak_rss_bytes() -> int:
    amount = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return amount if sys.platform == "darwin" else amount * 1024


def _alarm(_signum: int, _frame: Any) -> None:
    raise TimeoutError("bounded fit reached its wall-clock alarm")


def _frozen_config(path: Path, corpus_path: Path, examples: list[dict[str, Any]]) -> dict[str, Any]:
    config = json.loads(path.read_text())
    if config.get("schemaVersion") != "usp-e5-fit-freeze-v1" or config.get("corpusSha256") != sha256_file(corpus_path):
        raise ValueError("freeze does not match the checked v3 corpus")
    if config.get("base") != {"revision": BASE_REVISION, "weightSha256": BASE_WEIGHT_SHA256, "configSha256": BASE_CONFIG_SHA256}:
        raise ValueError("freeze does not match the pinned base model")
    actual_splits = {split: sorted({item["family"] for item in examples if item["split"] == split})
                     for split in ("train", "calibration", "evaluation", "diagnostic")}
    if config.get("splits") != actual_splits:
        raise ValueError("freeze source-family roles differ from the corpus")
    fit = config["fit"]
    if not 1 <= fit["steps"] <= 256 or fit["cpuThreads"] != 2 or fit["maxFitSeconds"] > 600 or fit["maxPeakProcessRssBytes"] > 6 * 1024**3:
        raise ValueError("fit exceeds the authorized resource budget")
    if fit["thresholdPolicy"] != "independent-calibration-exact-fields-v1" or fit["learningRate"] != 2e-5:
        raise ValueError("unexpected fit/threshold policy")
    return config


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--originals-dir", type=Path, required=True)
    parser.add_argument("--base-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--freeze-file", type=Path, required=True)
    args = parser.parse_args()
    if args.output_dir.exists():
        parser.error("output directory already exists; candidate artifacts are immutable")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    started = time.monotonic()

    corpus, examples = load_examples(args.corpus, args.originals_dir)
    if corpus["schemaVersion"] != CORPUS_VERSION:
        raise ValueError("new fit requires the frozen v3 corpus")
    config = _frozen_config(args.freeze_file, args.corpus, examples)
    fit = config["fit"]
    torch.set_num_threads(fit["cpuThreads"])
    torch.manual_seed(fit["seed"])
    random.seed(fit["seed"])
    np.random.seed(fit["seed"])
    splits = {split: [item for item in examples if item["split"] == split]
              for split in ("train", "calibration", "evaluation", "diagnostic")}
    train = splits["train"]
    if any(len(items) > 128 for items in splits.values()):
        raise ValueError("bounded research corpus limit exceeded")
    tokenizer, model = load_base(args.base_dir)
    with torch.no_grad():
        base_scores = {split: score_matrix(tokenizer, model, items, corpus["targets"])
                       for split, items in splits.items()}
    base_threshold = choose_train_threshold(splits["calibration"], base_scores["calibration"])
    lexical = {split: metrics(items, None, None, [lexical_prediction(item) for item in items])
               for split, items in splits.items()}
    base = {split: metrics(items, base_scores[split], base_threshold) for split, items in splits.items()}

    trainable_parameters = freeze_except_last_layer(model)
    initial_layer = {key: value.detach().clone() for key, value in last_layer(model).state_dict().items()}
    model.train()
    optimizer = torch.optim.AdamW((param for param in model.parameters() if param.requires_grad), lr=fit["learningRate"], weight_decay=0.01)
    label_indices = {target["id"]: index for index, target in enumerate(corpus["targets"])}
    labels = torch.zeros((len(train), len(label_indices)), dtype=torch.float32)
    for row, item in enumerate(train):
        if item["target"] is not None:
            labels[row, label_indices[item["target"]]] = 1.0
    positive_pairs = int(labels.sum().item())
    negative_pairs = labels.numel() - positive_pairs
    if positive_pairs < 2 or negative_pairs < 2:
        raise ValueError("insufficient checked mapping pairs")
    positive_weight = torch.tensor(min(negative_pairs / positive_pairs, 8.0))
    train_anchor = choose_train_threshold(train, base_scores["train"])
    losses: list[float] = []
    fit_started = time.monotonic()
    previous_alarm = signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(fit["maxFitSeconds"])
    try:
        for _ in range(fit["steps"]):
            optimizer.zero_grad(set_to_none=True)
            scores = score_matrix(tokenizer, model, train, corpus["targets"])
            logits = (scores - train_anchor) * 20.0
            loss = F.binary_cross_entropy_with_logits(logits, labels, pos_weight=positive_weight)
            loss.backward()
            torch.nn.utils.clip_grad_norm_((param for param in model.parameters() if param.requires_grad), 1.0)
            optimizer.step()
            losses.append(float(loss.detach()))
            if time.monotonic() - fit_started > fit["maxFitSeconds"]:
                raise TimeoutError("bounded fit exceeded its wall-clock budget")
            if _peak_rss_bytes() > fit["maxPeakProcessRssBytes"]:
                raise MemoryError("bounded fit exceeded its process RSS budget")
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_alarm)
    fit_seconds = time.monotonic() - fit_started
    model.eval()
    max_weight_change = max(
        float((value.detach() - initial_layer[key]).abs().max())
        for key, value in last_layer(model).state_dict().items()
    )
    if max_weight_change <= 0:
        raise RuntimeError("encoder fine-tuning did not change the last layer")
    del initial_layer
    with torch.no_grad():
        tuned_calibration_pre_save = score_matrix(tokenizer, model, splits["calibration"], corpus["targets"])

    args.output_dir.mkdir(parents=True)
    adapter_path = args.output_dir / "candidate.safetensors"
    adapter_sha = save_adapter(model, adapter_path)
    del model
    _, reloaded = load_base(args.base_dir)
    load_adapter(reloaded, adapter_path, adapter_sha)
    with torch.no_grad():
        tuned_scores = {split: score_matrix(tokenizer, reloaded, items, corpus["targets"])
                        for split, items in splits.items()}
    max_reload_delta = float((tuned_scores["calibration"] - tuned_calibration_pre_save).abs().max())
    if max_reload_delta > 1e-5:
        raise RuntimeError(f"adapter reload changed inference scores: {max_reload_delta}")
    tuned_threshold = choose_train_threshold(splits["calibration"], tuned_scores["calibration"])
    tuned = {split: metrics(items, tuned_scores[split], tuned_threshold) for split, items in splits.items()}
    calibration_coverage = {target["id"]: {"positiveFields": sum(item["target"] == target["id"] for item in splits["calibration"]),
                                           "wireCompatibleSampleRows": sum(item["wireCompatibleRows"] or 0 for item in splits["calibration"]
                                                                           if item["target"] == target["id"])}
                            for target in corpus["targets"]}
    peak_rss = _peak_rss_bytes()
    if peak_rss > fit["maxPeakProcessRssBytes"]:
        raise MemoryError("candidate evaluation exceeded process RSS budget")
    report = {
        "status": "offline_candidate_only",
        "promotion": "blocked_offline_experiment",
        "evaluationInterpretation": "DC was originally reserved in v3 but has now been observed; this one fixed source-profile correction is diagnostic, not a fresh holdout. Calgary has one geometry positive but no sourceKey/name positive calibration fields. SF was previously inspected and is diagnostic only. Five-row samples do not establish population accuracy or production readiness.",
        "previousProfileIssue": "Immutable v3/run07 feature text included reviewer-authored target explanations and cannot establish realistic unseen-input performance; this v4 run uses only hash-pinned publisher metadata and observed wire aggregates.",
        "freeze": {"file": args.freeze_file.name, "sha256": sha256_file(args.freeze_file), "configuration": config},
        "base": {"repo": "intfloat/multilingual-e5-small", "revision": BASE_REVISION, "weightSha256": BASE_WEIGHT_SHA256, "configSha256": BASE_CONFIG_SHA256, "license": "MIT", "fileSha256": {name: sha256_file(args.base_dir / name) for name in ("config.json", "model.safetensors", "sentencepiece.bpe.model", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "README.md")}},
        "candidate": {"file": adapter_path.name, "sha256": adapter_sha, "fineTunedModule": "BertModel.encoder.layer.11", "trainableParameters": trainable_parameters, "maximumAbsoluteWeightChange": max_weight_change, "steps": fit["steps"], "seed": fit["seed"], "optimizer": "AdamW", "learningRate": fit["learningRate"], "reloadMaxCosineDelta": max_reload_delta},
        "corpus": {"fileSha256": sha256_file(args.corpus), "featureVersion": corpus["featureVersion"],
                   "splits": {split: {"families": config["splits"][split], "fields": len(items),
                                      "positiveFields": sum(item["target"] is not None for item in items)}
                              for split, items in splits.items()},
                   "trainPairs": labels.numel(), "trainPositivePairs": positive_pairs,
                   "sourceOriginals": {source["id"]: {kind: {key: source[kind][key] for key in ("sha256", "bytes", "url")}
                                                      for kind in ("sample", "metadata")}
                                       for source in corpus["sources"]}},
        "comparison": {"thresholdSource": "independent Calgary calibration exact-field decisions; sourceKey/name positive calibration absent",
                       "calibrationTargetCoverage": calibration_coverage,
                       "lexical": lexical, "base": base, "savedReloadedTuned": tuned},
        "resources": {"fitSeconds": round(fit_seconds, 3), "elapsedSeconds": round(time.monotonic() - started, 3), "peakProcessRssBytes": peak_rss, "torchThreads": torch.get_num_threads()},
        "loss": {"first": round(losses[0], 6), "last": round(losses[-1], 6)},
        "limitations": ["Foreign schema learning only; Indian source and permission gap remains", "No production conversion, candidate promotion or runtime routing", "Metadata and five-row responses qualify field labels, not whole-record performance", "MassGIS centroid-derived STRUCT_ID and Vancouver numeric object_id remain unknown for literal stable sourceKey"],
    }
    report_path = args.output_dir / "run.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "run": str(report_path), "adapterSha256": adapter_sha,
        "trainFields": len(train), "calibrationFields": len(splits["calibration"]), "evaluationFields": len(splits["evaluation"]),
        "lexicalEvaluationExact": lexical["evaluation"]["exactFields"],
        "baseEvaluationExact": base["evaluation"]["exactFields"], "tunedEvaluationExact": tuned["evaluation"]["exactFields"],
        "promotion": report["promotion"],
        "fitSeconds": report["resources"]["fitSeconds"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
