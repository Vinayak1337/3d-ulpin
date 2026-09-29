"""Pinned E5 encoder and bounded last-layer adapter for field/target scoring."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F
from safetensors.torch import load_file, save_file
from transformers import AutoModel, AutoTokenizer

from .corpus import TARGETS, sha256_file


BASE_REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
BASE_WEIGHT_SHA256 = "1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477"
BASE_CONFIG_SHA256 = "69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959"
BASE_TOKENIZER_SHA256 = {
    "tokenizer.json": "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    "tokenizer_config.json": "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
    "special_tokens_map.json": "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
    "sentencepiece.bpe.model": "cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865",
}
MAX_TOKENS = 128


def load_base(base_dir: Path) -> tuple[Any, Any]:
    if sha256_file(base_dir / "model.safetensors") != BASE_WEIGHT_SHA256:
        raise ValueError("base E5 weights do not match the pinned revision")
    if sha256_file(base_dir / "config.json") != BASE_CONFIG_SHA256:
        raise ValueError("base E5 config does not match the pinned revision")
    for name, digest in BASE_TOKENIZER_SHA256.items():
        if sha256_file(base_dir / name) != digest:
            raise ValueError(f"base E5 tokenizer file does not match the pinned revision: {name}")
    config = json.loads((base_dir / "config.json").read_text())
    if config.get("model_type") != "bert" or config.get("hidden_size") != 384:
        raise ValueError("unexpected E5 architecture")
    tokenizer = AutoTokenizer.from_pretrained(base_dir, local_files_only=True, trust_remote_code=False)
    model = AutoModel.from_pretrained(base_dir, local_files_only=True, trust_remote_code=False, use_safetensors=True)
    model.eval()
    return tokenizer, model


def last_layer(model: Any) -> Any:
    layers = model.encoder.layer
    if len(layers) != 12:
        raise ValueError("unexpected E5 encoder depth")
    return layers[-1]


def freeze_except_last_layer(model: Any) -> int:
    for param in model.parameters():
        param.requires_grad = False
    layer = last_layer(model)
    for param in layer.parameters():
        param.requires_grad = True
    return sum(param.numel() for param in layer.parameters())


def embed(tokenizer: Any, model: Any, texts: list[str]) -> torch.Tensor:
    batch = tokenizer(texts, padding=True, truncation=True, max_length=MAX_TOKENS, return_tensors="pt")
    device = next(model.parameters()).device
    batch = {key: value.to(device) for key, value in batch.items()}
    hidden = model(**batch).last_hidden_state
    mask = batch["attention_mask"].unsqueeze(-1)
    pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
    return F.normalize(pooled, p=2, dim=1)


def score_matrix(tokenizer: Any, model: Any, examples: list[dict[str, Any]], targets: list[dict[str, str]]) -> torch.Tensor:
    source_texts = ["query: " + item["text"] for item in examples]
    target_texts = ["passage: " + target["description"] for target in targets]
    vectors = embed(tokenizer, model, source_texts + target_texts)
    return vectors[: len(examples)] @ vectors[len(examples) :].T


def save_adapter(model: Any, path: Path) -> str:
    tensors = {f"last_layer.{key}": value.detach().cpu().contiguous() for key, value in last_layer(model).state_dict().items()}
    save_file(tensors, path, metadata={"base_revision": BASE_REVISION, "scope": "offline_candidate"})
    return sha256_file(path)


def load_adapter(model: Any, path: Path, expected_sha256: str) -> None:
    if sha256_file(path) != expected_sha256:
        raise ValueError("candidate adapter checksum mismatch")
    tensors = load_file(path)
    prefix = "last_layer."
    if any(not key.startswith(prefix) for key in tensors):
        raise ValueError("adapter includes parameters outside the last encoder layer")
    state = {key[len(prefix) :]: value for key, value in tensors.items()}
    last_layer(model).load_state_dict(state, strict=True)
    model.eval()


def allowed_target_indices(example: dict[str, Any]) -> tuple[int, ...]:
    """Constrain schema proposals by wire shape; row execution is checked separately."""
    wire_types = example["observedWire"]["nonNullTypes"]
    if "string" in wire_types or (not wire_types and example["declaredType"] == "text"):
        return (0, 1)
    if example["path"] == "geometry" and any(kind in ("geojson:Polygon", "geojson:MultiPolygon") for kind in wire_types):
        return (2,)
    return ()


def predict(examples: list[dict[str, Any]], scores: torch.Tensor, threshold: float) -> list[str | None]:
    if scores.shape != (len(examples), len(TARGETS)):
        raise ValueError("score shape does not match fixed target vocabulary")
    result: list[str | None] = []
    for example, row in zip(examples, scores.detach().cpu().tolist()):
        allowed = allowed_target_indices(example)
        if not allowed:
            result.append(None)
            continue
        best = max(allowed, key=row.__getitem__)
        result.append(TARGETS[best] if row[best] >= threshold else None)
    return result


def choose_train_threshold(examples: list[dict[str, Any]], scores: torch.Tensor) -> float:
    """Historical threshold, retained for replay and the training loss anchor only."""
    top_scores = [
        max(row[index] for index in allowed)
        for example, row in zip(examples, scores.detach().cpu().tolist())
        if (allowed := allowed_target_indices(example))
    ]
    if not top_scores:
        raise ValueError("training families have no executable field candidates")
    options = sorted(set([min(top_scores) - 1e-6, max(top_scores) + 1e-6] + top_scores))
    best_threshold = options[0]
    best_key = (-1, -1, float("-inf"))
    for threshold in options:
        guesses = predict(examples, scores, threshold)
        exact = sum(guess == item["target"] for guess, item in zip(guesses, examples))
        false_mapped = sum(guess is not None for guess, item in zip(guesses, examples) if item["target"] is None)
        key = (exact, -false_mapped, threshold)
        if key > best_key:
            best_key, best_threshold = key, threshold
    return float(best_threshold)


def choose_calibration_threshold(examples: list[dict[str, Any]], scores: torch.Tensor) -> float | None:
    """Maximize positive recall with zero incorrect accepts and coverage of every target.

    A missing useful operating point is explicit, never an all-abstention success.
    Call only on the frozen calibration families. No evaluation feedback is used.
    """
    if not examples or any(item["split"] != "calibration" for item in examples):
        raise ValueError("threshold selection requires calibration inputs only")
    if scores.shape != (len(examples), len(TARGETS)) or not torch.isfinite(scores).all():
        raise ValueError("invalid calibration scores")
    top_scores = [max(row[index] for index in allowed)
                  for item, row in zip(examples, scores.detach().cpu().tolist())
                  if (allowed := allowed_target_indices(item))]
    if not top_scores:
        return None
    best: tuple[float, float] | None = None
    for threshold in sorted(set([min(top_scores) - 1e-6] + top_scores)):
        guesses = predict(examples, scores, threshold)
        if any(guess is not None and guess != item["target"] for item, guess in zip(examples, guesses)):
            continue
        recall = []
        for target in TARGETS:
            positives = [guess for item, guess in zip(examples, guesses) if item["target"] == target]
            correct = positives.count(target)
            if not correct:
                break
            recall.append(correct / len(positives))
        if len(recall) == len(TARGETS):
            key = (sum(recall) / len(recall), float(threshold))
            if best is None or key > best:
                best = key
    return best[1] if best is not None else None


def metrics(examples: list[dict[str, Any]], scores: torch.Tensor | None, threshold: float | None, guesses: list[str | None] | None = None) -> dict[str, Any]:
    if guesses is None:
        if scores is None or threshold is None:
            raise ValueError("scores and threshold required")
        guesses = predict(examples, scores, threshold)
    def counts(rows: list[tuple[dict[str, Any], str | None]]) -> dict[str, Any]:
        positives = [(item, guess) for item, guess in rows if item["target"] is not None]
        negatives = [(item, guess) for item, guess in rows if item["target"] is None]
        correct = sum(guess == item["target"] for item, guess in positives)
        accepted = sum(guess is not None for _, guess in rows)
        return {
            "fields": len(rows), "positiveFields": len(positives), "negativeFields": len(negatives),
            "exactFields": sum(guess == item["target"] for item, guess in rows),
            "correctPositive": correct,
            "abstainedPositive": sum(guess is None for _, guess in positives),
            "wrongTargetPositive": sum(guess is not None and guess != item["target"] for item, guess in positives),
            "falseMappedNegative": sum(guess is not None for _, guess in negatives),
            "acceptedFields": accepted, "incorrectMappings": accepted - correct,
            "precision": correct / accepted if accepted else None,
            "recall": correct / len(positives) if positives else None,
        }
    pairs = list(zip(examples, guesses))
    result: dict[str, Any] = counts(pairs)
    result["byTarget"] = {target: counts([(item, guess) for item, guess in pairs if item["target"] == target])
                          for target in TARGETS}
    for target in TARGETS:
        accepted = sum(guess == target for _, guess in pairs)
        correct = result["byTarget"][target]["correctPositive"]
        result["byTarget"][target].update(predictedAsTarget=accepted, falsePositive=accepted - correct,
                                         precision=correct / accepted if accepted else None)
    result["byFamily"] = {family: counts([(item, guess) for item, guess in pairs if item["family"] == family])
                          for family in sorted({item["family"] for item in examples})}
    if threshold is not None:
        result["decisionThreshold"] = float(threshold)
    rows = scores.detach().cpu().tolist() if scores is not None else [None] * len(examples)
    result["decisions"] = [
        {"source": item["source"], "field": item["path"], "expected": item["target"], "predicted": guess,
         "topAllowedCosine": round(max(row[index] for index in allowed_target_indices(item)), 5) if row is not None and allowed_target_indices(item) else None,
         "wireCompatibleRows": item["wireCompatibleRows"], "observedWire": item["observedWire"]}
        for item, guess, row in zip(examples, guesses, rows)
    ]
    return result
