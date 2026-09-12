from __future__ import annotations

import csv
import io
import json
import math
import warnings
from typing import Any

from PIL import Image
from pypdf import PdfReader

from .validation import InputError, MAX_FEATURES, frame, number, polygon, text

MAX_BYTES = 16 * 1024 * 1024
PROFILES = {"parcel-local-json-v1", "levels-csv-v1", "control-csv-v1", "plan-png-v1", "plan-pdf-v1"}


def _issue(code: str, message: str, field: str, severity: str = "warning") -> dict:
    return {"code": code, "message": message, "field": field, "severity": severity}


def _result(profile: str, summary: str, issues: list[dict] | None = None, **data: Any) -> dict:
    issues = issues or []
    return {"profile": profile, "status": "needs_input" if any(i["severity"] == "warning" for i in issues) else "ready", "issues": issues, "summary": summary, **data}


def _reject_constant(value: str) -> None:
    raise InputError(f"JSON contains unsupported nonfinite value {value}.")


def _unique_object(pairs: list[tuple]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise InputError(f"JSON contains duplicate field {key}.")
        result[key] = value
    return result


def _spatial(raw: bytes) -> dict:
    data = json.loads(raw.decode("utf-8-sig"), parse_constant=_reject_constant, object_pairs_hook=_unique_object)
    if not isinstance(data, dict) or data.get("profile") != "parcel-local-json-v1":
        raise InputError("Expected profile parcel-local-json-v1 with a declared local frame and feature list.")
    reference = frame(data.get("frame"))
    features = data.get("features")
    if not isinstance(features, list) or not 1 <= len(features) <= MAX_FEATURES:
        raise InputError(f"features: provide 1–{MAX_FEATURES} polygon features.")
    aliases = set()
    inspected = []
    for index, feature in enumerate(features):
        prefix = f"features[{index}]"
        if not isinstance(feature, dict):
            raise InputError(f"{prefix}: expected a feature object.")
        if set(feature) - {"alias", "name", "kind", "footprint", "levelLabel", "draftLower", "draftUpper", "frame"}:
            raise InputError(f"{prefix}: unsupported feature fields; this profile accepts only single-ring footprints and constant draft elevations.")
        alias = text(feature.get("alias"), f"{prefix}.alias")
        if alias in aliases:
            raise InputError(f"{prefix}: duplicate alias {alias}.")
        aliases.add(alias)
        kind = feature.get("kind")
        if kind not in ("unit", "common", "basement", "parcel", "building"):
            raise InputError(f"{prefix}.kind: unsupported feature kind.")
        if "frame" in feature and frame(feature["frame"]) != reference:
            raise InputError(f"{prefix}.frame: feature reference does not match the source frame.")
        points, _ = polygon(feature.get("footprint"), f"{prefix}.footprint")
        item = {"alias": alias, "name": text(feature.get("name"), f"{prefix}.name"), "kind": kind, "footprint": points}
        if "levelLabel" in feature:
            item["levelLabel"] = text(feature["levelLabel"], f"{prefix}.levelLabel")
        for component in ("draftLower", "draftUpper"):
            if component in feature:
                item[component] = number(feature[component], f"{prefix}.{component}")
        if "draftLower" in item and "draftUpper" in item and item["draftLower"] >= item["draftUpper"]:
            raise InputError(f"{prefix}: draft lower elevation must be below upper elevation.")
        inspected.append(item)
    issues = []
    if any("draftLower" in f or "draftUpper" in f for f in inspected):
        issues.append(_issue("UNVERIFIED_DRAFT_HINTS", "Draft elevations are operator scaffolding, not supported evidence.", "features", "info"))
    return _result("parcel-local-json-v1", f"{len(inspected)} valid local polygon features in {reference['id']}; elevations require separate evidence or explicit unverified input.", issues, frame=reference, features=inspected)


def _csv_rows(raw: bytes, required: list[str]) -> list[tuple[int, dict]]:
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
    if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise InputError("CSV requires unique header names.")
    missing = set(required) - set(reader.fieldnames)
    if missing:
        raise InputError(f"CSV missing required headers: {', '.join(sorted(missing))}.")
    rows = []
    for row in reader:
        line = reader.line_num
        if None in row or any(value is None for value in row.values()):
            raise InputError(f"CSV row {line}: number of columns does not match headers.")
        rows.append((line, {key: value.strip() for key, value in row.items()}))
        if len(rows) > MAX_FEATURES:
            raise InputError(f"CSV exceeds {MAX_FEATURES} records.")
    if not rows:
        raise InputError("CSV contains no data records.")
    return rows


def _csv_number(value: str, field: str, optional: bool = False) -> float | None:
    if value == "" and optional:
        return None
    try:
        parsed = float(value)
    except (ValueError, OverflowError):
        raise InputError(f"{field}: expected a finite decimal number.") from None
    return number(parsed, field)


def _levels(raw: bytes) -> dict:
    levels, issues = [], []
    aliases, benchmarks = set(), set()
    for line, row in _csv_rows(raw, ["alias", "lower", "upper", "unit", "benchmark", "method"]):
        locator = f"csv row {line}"
        alias = text(row["alias"], f"{locator}.alias")
        if alias in aliases:
            raise InputError(f"{locator}: duplicate alias {alias}.")
        aliases.add(alias)
        if row["unit"] != "m":
            raise InputError(f"{locator}: level unit must be m; no implicit conversion is performed.")
        benchmark = text(row["benchmark"], f"{locator}.benchmark")
        benchmarks.add(benchmark)
        method = text(row["method"], f"{locator}.method")
        lower = _csv_number(row["lower"], f"{locator}.lower", optional=True)
        upper = _csv_number(row["upper"], f"{locator}.upper", optional=True)
        if lower is not None and upper is not None and lower >= upper:
            raise InputError(f"{locator}: lower elevation must be below upper elevation.")
        for component, value in (("lower", lower), ("upper", upper)):
            if value is None:
                issues.append(_issue("MISSING_LEVEL", f"{alias} has no supported {component} elevation; explicit unverified input or revised evidence is required.", f"{locator}.{component}"))
        levels.append({"alias": alias, "lower": lower, "upper": upper, "benchmark": benchmark, "unit": "m", "method": method, "locator": locator})
    if len(benchmarks) != 1:
        raise InputError("CSV mixes vertical benchmarks; split or explicitly convert references before import.")
    return _result("levels-csv-v1", f"{len(levels)} level records; {len(issues)} missing elevation components.", issues, levels=levels)


def _controls(raw: bytes) -> dict:
    controls, ids, benchmarks = [], set(), set()
    for line, row in _csv_rows(raw, ["id", "x", "y", "unit", "benchmark"]):
        locator = f"csv row {line}"
        identity = text(row["id"], f"{locator}.id")
        if identity in ids:
            raise InputError(f"{locator}: duplicate control id {identity}.")
        ids.add(identity)
        if row["unit"] != "m":
            raise InputError(f"{locator}: horizontal control unit must be m.")
        benchmark = text(row["benchmark"], f"{locator}.benchmark")
        benchmarks.add(benchmark)
        controls.append({"id": identity, "x": _csv_number(row["x"], f"{locator}.x"), "y": _csv_number(row["y"], f"{locator}.y"), "benchmark": benchmark, "locator": locator})
    if len(benchmarks) != 1:
        raise InputError("Control CSV mixes benchmarks; a calibration must use one declared reference.")
    issues = []
    if len({(p["x"], p["y"]) for p in controls}) < 2:
        issues.append(_issue("INSUFFICIENT_CONTROLS", "At least two distinct control points are needed for plan calibration.", "controls"))
    return _result("control-csv-v1", f"{len(controls)} local metric control points; select matching image points for calibration.", issues, controls=controls)


def _png(raw: bytes) -> dict:
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG":
                raise InputError("Expected a PNG image; convert the reference or choose the correct profile.")
            width, height = image.size
            if width * height > 25_000_000:
                raise InputError("PNG exceeds 25 million pixels; use a reduced reference image.")
            image.verify()
    return _result("plan-png-v1", f"PNG plan reference, {width} × {height} pixels. Calibration and manual tracing are required.", [_issue("CALIBRATION_REQUIRED", "No geometry was extracted. Calibrate with two controls, then trace outlines.", "image")], image={"width": width, "height": height})


def _pdf(raw: bytes) -> dict:
    reader = PdfReader(io.BytesIO(raw), strict=True)
    if reader.is_encrypted:
        raise InputError("Encrypted PDFs are unsupported; provide an unlocked reference.")
    pages = len(reader.pages)
    if not 1 <= pages <= 100:
        raise InputError("PDF must contain between 1 and 100 pages.")
    first = reader.pages[0]
    width, height = float(first.cropbox.width), float(first.cropbox.height)
    if not all(math.isfinite(v) and 0 < v <= 100000 for v in (width, height)):
        raise InputError("PDF page dimensions are invalid or unsupported.")
    if first.rotation % 180:
        width, height = height, width
    return _result("plan-pdf-v1", f"PDF plan reference, {pages} page(s). Select a page, calibrate and trace; no geometry was extracted.", [_issue("CALIBRATION_REQUIRED", "Use the selected page's rendered coordinates for calibration; dimensions are first-page points at scale 1.", "image")], image={"width": math.ceil(width), "height": math.ceil(height), "pages": pages})


def inspect_bytes(profile: str, raw: bytes) -> dict:
    if profile not in PROFILES:
        raise InputError(f"Unsupported source profile: {profile}.")
    if not raw or len(raw) > MAX_BYTES:
        raise InputError("Source must be nonempty and at most 16 MiB.")
    processor = {"parcel-local-json-v1": _spatial, "levels-csv-v1": _levels, "control-csv-v1": _controls, "plan-png-v1": _png, "plan-pdf-v1": _pdf}[profile]
    try:
        return processor(raw)
    except InputError as error:
        message = str(error)
    except (UnicodeError, json.JSONDecodeError, csv.Error):
        message = "Source could not be parsed as the selected UTF-8 JSON/CSV profile. Check file contents and encoding."
    except Exception:
        if profile not in ("plan-png-v1", "plan-pdf-v1"):
            raise
        message = "Plan reference could not be decoded. Provide a valid, unlocked PNG or PDF matching the selected profile."
    return {"profile": profile, "status": "failed", "issues": [_issue("INVALID_SOURCE", message, "source", "error")], "summary": message}
