from __future__ import annotations

import math
from typing import Any

from shapely.geometry import Polygon
from shapely.validation import explain_validity

EPSILON = 1e-9
MAX_FEATURES = 2000
MAX_VERTICES = 10000


class InputError(ValueError):
    """An actionable, safe-to-display input rejection."""


def number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{field}: expected a finite number in metres.")
    if not math.isfinite(value):
        raise InputError(f"{field}: nonfinite numbers are unsupported.")
    return float(value)


def text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InputError(f"{field}: a nonempty string is required.")
    if len(value) > 512:
        raise InputError(f"{field}: text exceeds 512 characters.")
    return value


def frame(value: Any) -> dict:
    if not isinstance(value, dict):
        raise InputError("frame: declare the local coordinate frame and benchmark.")
    text(value.get("id"), "frame.id")
    text(value.get("benchmark"), "frame.benchmark")
    if value.get("horizontalUnit") != "m" or value.get("verticalUnit") != "m":
        raise InputError("frame: only canonical horizontal and vertical metres are supported; convert explicitly before import.")
    return {key: value[key] for key in ("id", "horizontalUnit", "verticalUnit", "benchmark")}


def polygon(value: Any, field: str) -> tuple[list[list[float]], Polygon]:
    if not isinstance(value, list) or not 3 <= len(value) <= MAX_VERTICES:
        raise InputError(f"{field}: a simple ring of 3–{MAX_VERTICES} vertices is required; holes are unsupported.")
    points = []
    for index, point in enumerate(value):
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise InputError(f"{field}[{index}]: expected an [x, y] pair; holes and Z coordinates are unsupported.")
        points.append([number(point[0], f"{field}[{index}].x"), number(point[1], f"{field}[{index}].y")])
    if points[0] == points[-1]:
        points.pop()
    if len(points) < 3 or len({tuple(p) for p in points}) != len(points):
        raise InputError(f"{field}: at least three distinct vertices are required; repeated vertices are unsupported.")
    shape = Polygon(points)
    if not shape.is_valid:
        raise InputError(f"{field}: invalid polygon ({explain_validity(shape)}).")
    if not math.isfinite(shape.area):
        raise InputError(f"{field}: polygon area exceeds supported finite numeric range.")
    if shape.is_empty or shape.area <= EPSILON:
        raise InputError(f"{field}: polygon has zero or negligible area.")
    return points, shape


def source_ids(units: list[dict]) -> list[str]:
    return sorted({binding["sourceId"] for unit in units for binding in unit.get("bindings", {}).values() if binding})


def clean_number(value: float) -> float:
    # Keep submillimetre precision while removing ordinary floating-point noise.
    return round(float(value), 9)
