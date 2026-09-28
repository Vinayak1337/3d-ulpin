"""Checked schema examples and privacy-preserving profiles from retained originals."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any


TARGETS = ("building.sourceKey", "building.name", "building.geometry")
CORPUS_VERSION = "usp-field-mapping-corpus-v4"
SPLITS = ("train", "calibration", "evaluation", "diagnostic")


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


def field_values(path: str, features: list[dict[str, Any]]) -> tuple[list[Any], int]:
    """Return values with an explicit count of absent keys, distinct from present nulls."""
    if path == "geometry":
        return [item.get("geometry") for item in features], sum("geometry" not in item for item in features)
    if path.startswith("properties."):
        key = path.removeprefix("properties.")
        properties = [item.get("properties", {}) for item in features]
        return [item.get(key) for item in properties], sum(key not in item for item in properties)
    raise ValueError(f"unsupported source path: {path}")


def _wire_type(value: Any) -> str:
    if isinstance(value, str):
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, dict) and value.get("type") in ("Polygon", "MultiPolygon"):
        return "geojson:" + value["type"]
    if isinstance(value, dict):
        return "object"
    if isinstance(value, list):
        return "array"
    return type(value).__name__


def wire_observation(path: str, features: list[dict[str, Any]]) -> dict[str, Any]:
    values, absent = field_values(path, features)
    return {
        "presentCount": len(values) - absent,
        "nullCount": sum(value is None for value in values) - absent,
        "absentCount": absent,
        "nonNullTypes": sorted({_wire_type(value) for value in values if value is not None}),
    }


def wire_compatible_rows(target: str, path: str, features: list[dict[str, Any]]) -> int:
    """Shallow type compatibility only; neither semantic nor whole-row qualification."""
    values, _ = field_values(path, features)
    if target in ("building.sourceKey", "building.name"):
        return sum(isinstance(value, str) and bool(value) for value in values)
    if target == "building.geometry" and path == "geometry":
        return sum(isinstance(value, dict) and value.get("type") in ("Polygon", "MultiPolygon") for value in values)
    return 0


def field_profile(source: dict[str, Any], field: dict[str, Any], features: list[dict[str, Any]]) -> str:
    """Historical v2/v3 profile retained byte-for-byte for artifact replay."""
    path = field["path"]
    values, absent = field_values(path, features)
    if absent == len(features):
        raise ValueError(f"field absent from original: {source['id']}:{path}")
    if path == "geometry":
        present_values = [item["geometry"] for item in features if "geometry" in item]
    else:
        key = path.removeprefix("properties.")
        present_values = [item["properties"][key] for item in features if key in item.get("properties", {})]
    shape_counts: dict[str, int] = {}
    for value in present_values:
        shape = _value_shape(value)
        shape_counts[shape] = shape_counts.get(shape, 0) + 1
    shape_summary = ", ".join(f"{key} {count}/{len(features)}" for key, count in sorted(shape_counts.items()))
    return (
        f"field {path}; issuer declared type {field['declaredType']}; issuer definition {field['definition']}; "
        f"observed wire types {','.join(field['observedWire']['nonNullTypes']) or 'none'}; "
        f"observed value patterns {shape_summary}; absent {absent}/{len(values)}; "
        f"source representation {source.get('representation', 'GeoJSON building footprints')}"
    )


def _pointer(document: dict[str, Any], pointer: str) -> Any:
    if not pointer.startswith("/"):
        raise ValueError("metadata locator must be a JSON pointer")
    value: Any = document
    for token in pointer[1:].split("/"):
        key = token.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def _publisher_field(metadata: str, source: dict[str, Any], field: dict[str, Any]) -> tuple[str, str, str, str, str]:
    """Resolve only publisher-authored title/field text from a hash-checked original."""
    evidence = source["inputEvidence"]
    locator = field["inputEvidence"]
    if evidence["format"] == "nyc-markdown-table":
        lines = metadata.splitlines()
        title_line = lines[evidence["titleLine"] - 1]
        if not title_line.startswith("# "):
            raise ValueError("publisher markdown title locator changed")
        title = title_line.removeprefix("# ").strip()
        cells = [cell.strip() for cell in lines[locator["fieldLine"] - 1].strip().strip("|").split("|")]
        if len(cells) != 5:
            raise ValueError("publisher markdown field row changed")
        name, alias, description, declared_type, _notes = cells
    else:
        document = json.loads(metadata)
        title = _pointer(document, evidence["titlePointer"])
        if "geometryTypePointer" in locator:
            name, alias, description, declared_type = ("geometry", "", "", _pointer(document, locator["geometryTypePointer"]))
        else:
            entry = _pointer(document, locator["fieldPointer"])
            if evidence["format"] == "socrata-view-json":
                name, alias, description, declared_type = (entry["fieldName"], entry["name"],
                                                           entry.get("description") or "", entry["dataTypeName"])
            elif evidence["format"] == "arcgis-layer-json":
                name, alias, description, declared_type = (entry["name"], entry.get("alias") or "",
                                                           entry.get("description") or "", entry["type"])
            elif evidence["format"] == "opendatasoft-dataset-json":
                name, alias, description, declared_type = (entry["name"], entry.get("label") or "",
                                                           entry.get("description") or "", entry["type"])
            else:
                raise ValueError("unsupported publisher metadata format")
    if not all(isinstance(value, str) for value in (title, name, alias, description, declared_type)):
        raise ValueError("publisher metadata text/type must be strings")
    if name.casefold() != locator["sourceField"].casefold():
        raise ValueError("metadata locator does not match declared source field")
    path = field["path"]
    if path != "geometry" and name.casefold() != path.removeprefix("properties.").casefold():
        raise ValueError("metadata field does not match observed property path")
    if path == "geometry" and not ("geom" in declared_type.lower() or "polygon" in declared_type.lower() or
                                   declared_type in ("varies", "geo_shape")):
        raise ValueError("geometry metadata locator has a nongeometry type")
    if not title or not name or not declared_type:
        raise ValueError("publisher metadata title/field/type is empty")
    return title, name, alias, description, declared_type


def publisher_field_profile(source: dict[str, Any], field: dict[str, Any], features: list[dict[str, Any]], metadata: str) -> str:
    """Use verified publisher text and deterministic wire aggregates; no reviewer label prose."""
    title, name, alias, description, declared_type = _publisher_field(metadata, source, field)
    path = field["path"]
    values, absent = field_values(path, features)
    if absent == len(features):
        raise ValueError(f"field absent from original: {source['id']}:{path}")
    present_values = [value for value, feature in zip(values, features)
                      if (path == "geometry" and "geometry" in feature) or
                         (path != "geometry" and path.removeprefix("properties.") in feature.get("properties", {}))]
    shape_counts: dict[str, int] = {}
    for value in present_values:
        shape = _value_shape(value)
        shape_counts[shape] = shape_counts.get(shape, 0) + 1
    shape_summary = ", ".join(f"{key} {count}/{len(features)}" for key, count in sorted(shape_counts.items()))
    observed = wire_observation(path, features)
    return (
        f"publisher dataset title {title}; source field {name}; publisher alias {alias or 'none recorded'}; "
        f"publisher description {description or 'none recorded'}; publisher declared type {declared_type}; "
        f"observed wire types {','.join(observed['nonNullTypes']) or 'none'}; "
        f"observed value patterns {shape_summary}; absent {absent}/{len(values)}"
    )


def _features(sample: dict[str, Any], source: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize only the acquired OpenDataSoft records shape in memory."""
    if source["sample"].get("format", "geojson-feature-collection") == "geojson-feature-collection":
        features = sample.get("features")
        if sample.get("type") != "FeatureCollection" or not isinstance(features, list):
            raise ValueError(f"invalid GeoJSON collection: {source['id']}")
        return features
    if source["sample"]["format"] != "opendatasoft-records-v2" or not isinstance(sample.get("results"), list):
        raise ValueError(f"unsupported sample format: {source['id']}")
    features = []
    for record in sample["results"]:
        shape = record.get("geom")
        if not isinstance(shape, dict) or shape.get("type") != "Feature" or not isinstance(shape.get("geometry"), dict):
            raise ValueError(f"invalid nested GeoJSON feature: {source['id']}")
        features.append({"type": "Feature", "geometry": shape["geometry"],
                         "properties": {key: value for key, value in record.items() if key != "geom"}})
    return features


def load_examples(corpus_path: Path, originals_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    corpus = json.loads(corpus_path.read_text())
    version = corpus.get("schemaVersion")
    if version not in ("usp-field-mapping-corpus-v2", "usp-field-mapping-corpus-v3", CORPUS_VERSION):
        raise ValueError("unknown corpus version")
    targets = tuple(target["id"] for target in corpus["targets"])
    if targets != TARGETS:
        raise ValueError("target vocabulary changed")
    allowed_splits = ("train", "holdout") if version.endswith("-v2") else SPLITS
    split_families: dict[str, set[str]] = {split: set() for split in allowed_splits}
    examples: list[dict[str, Any]] = []
    for source in corpus["sources"]:
        permission = source["permission"]
        if not permission["trainingEligible"] or permission["sarvamDerived"]:
            raise ValueError(f"source not eligible for this experiment: {source['id']}")
        if permission["productionEligible"]:
            raise ValueError("foreign experiment must not be marked production eligible")
        split = source["split"]
        if split not in allowed_splits:
            raise ValueError(f"unsupported split: {split}")
        split_families[split].add(source["family"])
        sample_path = _checked_file(originals_dir, source["sample"])
        metadata_path = _checked_file(originals_dir, source["metadata"])
        if "descriptionPdf" in source:
            _checked_file(originals_dir, source["descriptionPdf"])
        sample = json.loads(sample_path.read_text())
        metadata = metadata_path.read_text() if version == CORPUS_VERSION else ""
        features = _features(sample, source)
        if len(features) != source["sample"]["rows"]:
            raise ValueError(f"sample row count mismatch: {source['id']}")
        if source["id"] == "nyc-building-footprints" and any(
            str(feature.get("properties", {}).get("doitt_id")) == source["sample"]["excludesExistingBenchmarkDoittId"]
            for feature in features
        ):
            raise ValueError("protected NYC benchmark feature entered training sample")
        seen_paths: set[str] = set()
        for field in source["fields"] + source["excludedFields"]:
            path = field["path"]
            if path in seen_paths:
                raise ValueError(f"duplicate field label: {source['id']}:{path}")
            seen_paths.add(path)
            if wire_observation(path, features) != field.get("observedWire"):
                raise ValueError(f"observed wire shape contradicts retained original: {source['id']}:{path}")
        for field in source["fields"]:
            path = field["path"]
            target = field["target"]
            publisher_type = _publisher_field(metadata, source, field)[4] if version == CORPUS_VERSION else field["declaredType"]
            if target is not None and target not in TARGETS:
                raise ValueError(f"unsupported mapping label: {target}")
            if field.get("decision") != ("positive" if target is not None else "negative"):
                raise ValueError(f"mapping label decision mismatch: {source['id']}:{path}")
            if not field.get("evidence") or not field.get("definition"):
                raise ValueError("label lacks independent issuer evidence")
            compatible_rows = wire_compatible_rows(target, path, features) if target is not None else None
            if target is not None and field.get("wireCompatibleRows") != compatible_rows:
                raise ValueError(f"operation wire compatibility contradicts retained original: {source['id']}:{path}")
            examples.append({
                "source": source["id"], "family": source["family"], "split": split,
                "path": path, "text": (publisher_field_profile(source, field, features, metadata)
                                         if version == CORPUS_VERSION else field_profile(source, field, features)),
                "declaredType": publisher_type, "observedWire": field["observedWire"],
                "wireCompatibleRows": compatible_rows, "target": target,
                "originalSha256": source["sample"]["sha256"],
            })
        for field in source["excludedFields"]:
            if field.get("decision") != "unknown" or not field.get("evidence") or not field.get("reason"):
                raise ValueError(f"unknown field lacks reason/evidence: {source['id']}")
    required_splits = ("train", "holdout") if version.endswith("-v2") else ("train", "calibration", "evaluation")
    if any(not split_families[split] for split in required_splits):
        raise ValueError("required source family split is empty")
    if any(split_families[a] & split_families[b] for a in allowed_splits for b in allowed_splits if a < b):
        raise ValueError("source families must be disjoint across splits")
    if not any(item["target"] for item in examples if item["split"] == "train"):
        raise ValueError("no positive training labels")
    return corpus, examples


def lexical_prediction(example: dict[str, Any]) -> str | None:
    """Cheap, generic typed/header heuristic for the same three allowlisted targets."""
    name = example["path"].rsplit(".", 1)[-1].lower()
    wire_types = example["observedWire"]["nonNullTypes"]
    text_compatible = "string" in wire_types or (not wire_types and example["declaredType"] == "text")
    if example["path"] == "geometry" and any(kind.startswith("geojson:") for kind in wire_types):
        return "building.geometry"
    if text_compatible and "name" in name:
        return "building.name"
    if text_compatible and (name.endswith("id") or "bldgid" in name):
        return "building.sourceKey"
    return None
