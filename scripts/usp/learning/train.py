#!/usr/bin/env python3
"""Run the bounded AI-06A E5 experiment; never publish or activate its model."""

from __future__ import annotations

import argparse
import json
import os
import random
import resource
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from geo.usp_learning.corpus import lexical_prediction, load_examples, sha256_file
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--originals-dir", type=Path, required=True)
    parser.add_argument("--base-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=24)
    parser.add_argument("--seed", type=int, default=17)
    args = parser.parse_args()
    if not 1 <= args.steps <= 64:
        parser.error("--steps must be in 1..64")
    if args.output_dir.exists():
        parser.error("output directory already exists; candidate artifacts are immutable")
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    torch.set_num_threads(2)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    started = time.monotonic()

    corpus, examples = load_examples(args.corpus, args.originals_dir)
    train = [item for item in examples if item["split"] == "train"]
    holdout = [item for item in examples if item["split"] == "holdout"]
    if len(train) > 128 or len(holdout) > 128:
        raise ValueError("bounded research corpus limit exceeded")
    tokenizer, model = load_base(args.base_dir)
    with torch.no_grad():
        base_train_scores = score_matrix(tokenizer, model, train, corpus["targets"])
        base_holdout_scores = score_matrix(tokenizer, model, holdout, corpus["targets"])
    base_threshold = choose_train_threshold(train, base_train_scores)
    base_train = metrics(train, base_train_scores, base_threshold)
    base_holdout = metrics(holdout, base_holdout_scores, base_threshold)
    lexical_holdout = metrics(holdout, None, None, [lexical_prediction(item) for item in holdout])

    trainable_parameters = freeze_except_last_layer(model)
    initial_layer = {key: value.detach().clone() for key, value in last_layer(model).state_dict().items()}
    model.train()
    optimizer = torch.optim.AdamW((param for param in model.parameters() if param.requires_grad), lr=2e-5, weight_decay=0.01)
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
    losses: list[float] = []
    for _ in range(args.steps):
        optimizer.zero_grad(set_to_none=True)
        scores = score_matrix(tokenizer, model, train, corpus["targets"])
        logits = (scores - base_threshold) * 20.0
        loss = F.binary_cross_entropy_with_logits(logits, labels, pos_weight=positive_weight)
        loss.backward()
        torch.nn.utils.clip_grad_norm_((param for param in model.parameters() if param.requires_grad), 1.0)
        optimizer.step()
        losses.append(float(loss.detach()))
    model.eval()
    max_weight_change = max(
        float((value.detach() - initial_layer[key]).abs().max())
        for key, value in last_layer(model).state_dict().items()
    )
    if max_weight_change <= 0:
        raise RuntimeError("encoder fine-tuning did not change the last layer")
    del initial_layer
    with torch.no_grad():
        tuned_train_scores = score_matrix(tokenizer, model, train, corpus["targets"])
        tuned_holdout_scores = score_matrix(tokenizer, model, holdout, corpus["targets"])
    tuned_threshold = choose_train_threshold(train, tuned_train_scores)
    tuned_train = metrics(train, tuned_train_scores, tuned_threshold)
    tuned_holdout = metrics(holdout, tuned_holdout_scores, tuned_threshold)

    args.output_dir.mkdir(parents=True)
    adapter_path = args.output_dir / "candidate.safetensors"
    adapter_sha = save_adapter(model, adapter_path)
    del model
    _, reloaded = load_base(args.base_dir)
    load_adapter(reloaded, adapter_path, adapter_sha)
    with torch.no_grad():
        reloaded_scores = score_matrix(tokenizer, reloaded, holdout, corpus["targets"])
    max_reload_delta = float((reloaded_scores - tuned_holdout_scores).abs().max())
    if max_reload_delta > 1e-5:
        raise RuntimeError(f"adapter reload changed inference scores: {max_reload_delta}")
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform != "darwin":
        peak_rss *= 1024
    report = {
        "status": "offline_candidate_only",
        "promotion": "blocked_offline_experiment",
        "evaluationInterpretation": "SF family is excluded from corrected training and threshold choice but was observed during prior development; this is a diagnostic comparison, not fresh generalization.",
        "base": {"repo": "intfloat/multilingual-e5-small", "revision": BASE_REVISION, "weightSha256": BASE_WEIGHT_SHA256, "configSha256": BASE_CONFIG_SHA256, "license": "MIT", "fileSha256": {name: sha256_file(args.base_dir / name) for name in ("config.json", "model.safetensors", "sentencepiece.bpe.model", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "README.md")}},
        "candidate": {"file": adapter_path.name, "sha256": adapter_sha, "fineTunedModule": "BertModel.encoder.layer.11", "trainableParameters": trainable_parameters, "maximumAbsoluteWeightChange": max_weight_change, "steps": args.steps, "seed": args.seed, "optimizer": "AdamW", "learningRate": 2e-5, "reloadMaxCosineDelta": max_reload_delta},
        "corpus": {"fileSha256": sha256_file(args.corpus), "featureVersion": corpus["featureVersion"], "trainFamilies": sorted({item["family"] for item in train}), "holdoutFamilies": sorted({item["family"] for item in holdout}), "trainFields": len(train), "trainPositiveFields": sum(item["target"] is not None for item in train), "trainPairs": labels.numel(), "trainPositivePairs": positive_pairs, "holdoutFields": len(holdout), "holdoutPositiveFields": sum(item["target"] is not None for item in holdout)},
        "comparison": {"lexicalHoldout": lexical_holdout, "baseTrain": base_train, "baseHoldout": base_holdout, "tunedTrain": tuned_train, "tunedHoldout": tuned_holdout},
        "resources": {"elapsedSeconds": round(time.monotonic() - started, 3), "peakProcessRssBytes": peak_rss, "torchThreads": torch.get_num_threads()},
        "loss": {"first": round(losses[0], 6), "last": round(losses[-1], 6)},
        "limitations": ["Three foreign building footprint schema families only; no Indian production qualification", "SF diagnostic family was previously observed during development", "No runtime conversion or candidate promotion", "Training rows represent checked fields, not repeated building features"],
    }
    report_path = args.output_dir / "run.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "run": str(report_path), "adapterSha256": adapter_sha,
        "trainFields": len(train), "holdoutFields": len(holdout),
        "lexicalHoldoutExact": lexical_holdout["exactFields"],
        "baseHoldoutExact": base_holdout["exactFields"], "tunedHoldoutExact": tuned_holdout["exactFields"],
        "promotion": report["promotion"],
        "elapsedSeconds": report["resources"]["elapsedSeconds"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
