"""Checked schema examples and privacy-preserving profiles from retained originals."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


TARGETS = ("building.sourceKey", "building.name", "building.geometry")
CORPUS_VERSION = "usp-field-mapping-corpus-v1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _checked_file(root: Path, receipt: dict[str, Any]) -> Path:
    name = receipt["file"]
    if Path(name).name != name:
        raise ValueError(f"source file must be a basename: {name}")
    path = root / name
    if path.stat().st_size != receipt["bytes"] or sha256_file(path) != receipt["sha256"]:
        raise ValueError(f"source hash/size mismatch: {name}")
    return path


def _value_shape(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        if re.fullmatch(r"[0-9a-fA-F-]{32,38}", value):
            return "uuid-like text"
        if value.isdigit():
            return "digit text"
        return "text"
    if isinstance(value, dict) and value.get("type") in ("Polygon", "MultiPolygon"):
        return str(value["type"]) + " geometry"
    return type(value).__name__


def field_profile(source: dict[str, Any], field: dict[str, Any], features: list[dict[str, Any]]) -> str:
    """Returns aggregate shapes only; never feeds raw source values to the model."""
    path = field["path"]
    if path == "geometry":
        values = [item.get("geometry") for item in features]
    elif path.startswith("properties."):
        key = path.removeprefix("properties.")
        if not any(key in item.get("properties", {}) for item in features):
            raise ValueError(f"field missing from original: {source['id']}:{path}")
        values = [item.get("properties", {}).get(key) for item in features]
    else:
        raise ValueError(f"unsupported source path: {path}")
    shape_counts: dict[str, int] = {}
    for value in values:
        shape = _value_shape(value)
        shape_counts[shape] = shape_counts.get(shape, 0) + 1
    shape_summary = ", ".join(f"{key} {count}/{len(values)}" for key, count in sorted(shape_counts.items()))
    return (
        f"field {path}; declared type {field['type']}; issuer definition {field['definition']}; "
        f"observed shape {shape_summary}; source representation GeoJSON building footprints"
    )


def load_examples(corpus_path: Path, originals_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    corpus = json.loads(corpus_path.read_text())
    if corpus.get("schemaVersion") != CORPUS_VERSION:
        raise ValueError("unknown corpus version")
    targets = tuple(target["id"] for target in corpus["targets"])
    if targets != TARGETS:
        raise ValueError("target vocabulary changed")
    train_families: set[str] = set()
    holdout_families: set[str] = set()
    examples: list[dict[str, Any]] = []
    for source in corpus["sources"]:
        permission = source["permission"]
        if not permission["trainingEligible"] or permission["sarvamDerived"]:
            raise ValueError(f"source not eligible for this experiment: {source['id']}")
        if permission["productionEligible"]:
            raise ValueError("foreign experiment must not be marked production eligible")
        split = source["split"]
        if split not in ("train", "holdout"):
            raise ValueError(f"unsupported split: {split}")
        (train_families if split == "train" else holdout_families).add(source["family"])
        sample_path = _checked_file(originals_dir, source["sample"])
        _checked_file(originals_dir, source["metadata"])
        if "descriptionPdf" in source:
            _checked_file(originals_dir, source["descriptionPdf"])
        sample = json.loads(sample_path.read_text())
        features = sample.get("features")
        if sample.get("type") != "FeatureCollection" or not isinstance(features, list):
            raise ValueError(f"invalid GeoJSON collection: {source['id']}")
        if len(features) != source["sample"]["rows"]:
            raise ValueError(f"sample row count mismatch: {source['id']}")
        if source["id"] == "nyc-building-footprints" and any(
            str(feature.get("properties", {}).get("doitt_id")) == source["sample"]["excludesExistingBenchmarkDoittId"]
            for feature in features
        ):
            raise ValueError("protected NYC benchmark feature entered training sample")
        seen_paths: set[str] = set()
        for field in source["fields"]:
            path = field["path"]
            if path in seen_paths:
                raise ValueError(f"duplicate field label: {source['id']}:{path}")
            seen_paths.add(path)
            target = field["target"]
            if target is not None and target not in TARGETS:
                raise ValueError(f"unsupported mapping label: {target}")
            if field.get("decision") != ("positive" if target is not None else "negative"):
                raise ValueError(f"mapping label decision mismatch: {source['id']}:{path}")
            if not field.get("evidence") or not field.get("definition"):
                raise ValueError("label lacks independent issuer evidence")
            examples.append({
                "source": source["id"], "family": source["family"], "split": split,
                "path": path, "text": field_profile(source, field, features),
                "declaredType": field["type"], "target": target,
                "originalSha256": source["sample"]["sha256"],
            })
        for field in source["excludedFields"]:
            if field.get("decision") != "unknown" or not field.get("evidence") or not field.get("reason"):
                raise ValueError(f"unknown field lacks reason/evidence: {source['id']}")
            if field["path"] in seen_paths:
                raise ValueError(f"unknown field also labelled: {source['id']}:{field['path']}")
    if not train_families or not holdout_families or train_families & holdout_families:
        raise ValueError("source families must be disjoint across train and holdout")
    if not any(item["target"] for item in examples if item["split"] == "train"):
        raise ValueError("no positive training labels")
    return corpus, examples


def lexical_prediction(example: dict[str, Any]) -> str | None:
    """Cheap, generic typed/header heuristic for the same three allowlisted targets."""
    name = example["path"].rsplit(".", 1)[-1].lower()
    declared = example["declaredType"]
    if declared in ("polygon", "multipolygon") and example["path"] == "geometry":
        return "building.geometry"
    if declared == "text" and "name" in name:
        return "building.name"
    if declared == "text" and (name.endswith("id") or "bldgid" in name):
        return "building.sourceKey"
    return None
