from __future__ import annotations

from copy import deepcopy
import uuid

import shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union

from .validation import EPSILON, MAX_FEATURES, InputError, clean_number, frame, number, polygon, source_ids, text

METHOD = f"polygon-prism-v1/shapely-{shapely.__version__}"


def _bindings(unit: dict, prefix: str) -> None:
    bindings = unit.get("bindings")
    if not isinstance(bindings, dict) or set(bindings) - {"footprint", "lower", "upper", "alignment"}:
        raise InputError(f"{prefix}.bindings: expected footprint/lower/upper/alignment source bindings.")
    for component, binding in bindings.items():
        if not isinstance(binding, dict):
            raise InputError(f"{prefix}.bindings.{component}: expected a source locator.")
        text(binding.get("sourceId"), f"{prefix}.bindings.{component}.sourceId")
        text(binding.get("locator"), f"{prefix}.bindings.{component}.locator")
    for component in ("lower", "upper"):
        verified = unit.get(f"{component}Verified")
        if not isinstance(verified, bool):
            raise InputError(f"{prefix}.{component}Verified: explicitly declare whether this component has supporting evidence.")
        if verified and component not in bindings:
            raise InputError(f"{prefix}.{component}: a verified component requires a supporting source locator.")


def _calibration(value: dict, prefix: str) -> None:
    if not isinstance(value, dict):
        raise InputError(f"{prefix}: expected two image and two world control points.")
    text(value.get("sourceId"), f"{prefix}.sourceId")
    if isinstance(value.get("page"), bool) or not isinstance(value.get("page"), int) or value["page"] < 1:
        raise InputError(f"{prefix}.page: select a positive, one-based page number.")
    for key in ("imagePoints", "worldPoints"):
        points = value.get(key)
        if not isinstance(points, list) or len(points) != 2:
            raise InputError(f"{prefix}.{key}: exactly two points are required.")
        for index, point in enumerate(points):
            if not isinstance(point, list) or len(point) != 2:
                raise InputError(f"{prefix}.{key}[{index}]: expected an [x, y] pair.")
            for coordinate in point:
                number(coordinate, f"{prefix}.{key}[{index}]")
        if sum((points[0][axis] - points[1][axis]) ** 2 for axis in (0, 1)) <= EPSILON:
            raise InputError(f"{prefix}.{key}: controls must be distinct.")


def _polygon_parts(shape) -> list[Polygon]:
    if shape.geom_type == "Polygon":
        return [shape] if shape.area > EPSILON else []
    if hasattr(shape, "geoms"):
        return [part for child in shape.geoms for part in _polygon_parts(child)]
    return []


def build_model(data: dict) -> dict:
    if not isinstance(data, dict):
        raise InputError("Build input must be an object.")
    reference = frame(data.get("frame"))
    fingerprint = text(data.get("inputFingerprint"), "inputFingerprint")
    inputs = data.get("units")
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= MAX_FEATURES:
        raise InputError(f"units: provide 1–{MAX_FEATURES} units before building.")
    contexts = data.get("context", [])
    if not isinstance(contexts, list) or len(contexts) > MAX_FEATURES:
        raise InputError("context: expected a list of parcel/building polygons.")
    context, context_shapes = [], {"parcel": [], "building": []}
    for index, feature in enumerate(contexts):
        prefix = f"context[{index}]"
        if not isinstance(feature, dict) or feature.get("kind") not in context_shapes:
            raise InputError(f"{prefix}: only parcel and building context is supported.")
        if "frame" in feature and frame(feature["frame"]) != reference:
            raise InputError(f"{prefix}: context reference does not match canonical build frame.")
        if "holes" in feature or "geometry" in feature:
            raise InputError(f"{prefix}: only the declared single-ring footprint profile is supported.")
        text(feature.get("alias"), f"{prefix}.alias")
        points, shape = polygon(feature.get("footprint"), f"{prefix}.footprint")
        context.append({**deepcopy(feature), "footprint": points})
        context_shapes[feature["kind"]].append(shape)

    units, shapes, ids, aliases = [], [], set(), set()
    for index, unit in enumerate(inputs):
        prefix = f"units[{index}]"
        if not isinstance(unit, dict):
            raise InputError(f"{prefix}: expected a unit object.")
        identity = text(unit.get("id"), f"{prefix}.id")
        alias = text(unit.get("alias"), f"{prefix}.alias")
        text(unit.get("name"), f"{prefix}.name")
        if identity in ids or alias in aliases:
            raise InputError(f"{prefix}: duplicate unit ID or alias.")
        ids.add(identity)
        aliases.add(alias)
        if unit.get("kind") not in ("unit", "common", "basement"):
            raise InputError(f"{prefix}.kind: only unit, common and basement prisms are supported.")
        if "holes" in unit or "geometry" in unit:
            raise InputError(f"{prefix}: only single-ring, constant-elevation prisms are supported.")
        if isinstance(unit.get("revision"), bool) or not isinstance(unit.get("revision"), int) or unit["revision"] < 1:
            raise InputError(f"{prefix}.revision: expected a positive revision number.")
        if "frame" in unit and frame(unit["frame"]) != reference:
            raise InputError(f"{prefix}: unit reference does not match canonical build frame.")
        points, shape = polygon(unit.get("footprint"), f"{prefix}.footprint")
        lower, upper = number(unit.get("lower"), f"{prefix}.lower"), number(unit.get("upper"), f"{prefix}.upper")
        if upper - lower <= EPSILON:
            raise InputError(f"{prefix}: upper elevation must be above lower elevation.")
        number(upper - lower, f"{prefix}.height")
        number(shape.area * (upper - lower), f"{prefix}.volume")
        _bindings(unit, prefix)
        if "calibration" in unit:
            _calibration(unit["calibration"], f"{prefix}.calibration")
        computed = {**deepcopy(unit), "footprint": points, "lower": lower, "upper": upper, "area": clean_number(shape.area), "height": clean_number(upper - lower), "volume": clean_number(shape.area * (upper - lower))}
        units.append(computed)
        shapes.append(shape)

    findings = []

    def finding(code: str, severity: str, title: str, description: str, affected: list[dict], overlap: dict | None = None, salt: str = "") -> None:
        unit_ids = [unit["id"] for unit in affected]
        stable_key = f"{fingerprint}:{code}:{','.join(sorted(unit_ids))}:{salt}"
        item = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, stable_key)), "code": code, "severity": severity, "title": title, "description": description, "unitIds": unit_ids, "sourceIds": source_ids(affected)}
        if overlap is not None:
            item["overlap"] = overlap
        findings.append(item)

    for unit in units:
        for component in ("lower", "upper"):
            if not unit[f"{component}Verified"]:
                finding(f"UNVERIFIED_{component.upper()}", "warning", f"{unit['alias']}: unverified {component} elevation", f"{unit[component]:g} m is an explicit draft value. Bind supporting level evidence before treating it as verified.", [unit])

    for left in range(len(units)):
        for right in range(left + 1, len(units)):
            a, b = units[left], units[right]
            low, high = max(a["lower"], b["lower"]), min(a["upper"], b["upper"])
            if high < low - EPSILON or not shapes[left].intersects(shapes[right]):
                continue
            intersection = shapes[left].intersection(shapes[right])
            parts = _polygon_parts(intersection)
            if high - low > EPSILON and parts:
                for part_index, part in enumerate(sorted(parts, key=lambda shape: shape.bounds)):
                    if part.interiors:
                        raise InputError("An intersection contains holes outside the supported single-ring highlight profile.")
                    volume = clean_number(part.area * (high - low))
                    overlap = {"footprint": [[clean_number(x), clean_number(y)] for x, y in list(part.exterior.coords)[:-1]], "lower": low, "upper": high, "volume": volume}
                    finding("OVERLAP", "error", f"{a['alias']} / {b['alias']}: {volume:g} m³ overlap", f"Positive interior intersection occupies {clean_number(part.area):g} m² from {low:g} to {high:g} m. Correct the contributing boundary or elevation evidence, then rebuild.", [a, b], overlap, str(part_index))
            else:
                finding("BOUNDARY_CONTACT", "info", f"{a['alias']} / {b['alias']}: boundary contact", "These spaces touch at a face, edge or point. Their positive interior intersection volume is zero.", [a, b])

    for kind, members in context_shapes.items():
        if not members:
            continue
        envelope = unary_union(members)
        contained = []
        for unit, shape in zip(units, shapes):
            if shape.difference(envelope).area > EPSILON:
                finding(f"OUTSIDE_{kind.upper()}", "warning", f"{unit['alias']}: footprint extends outside {kind} context", "The footprint exceeds the supplied horizontal context. Confirm its geometry and source alignment; context is not an ownership volume.", [unit])
            else:
                contained.append(unit)
        if contained and kind == "building":
            finding("CONTEXT_CONTAINMENT", "info", f"{len(contained)} spaces within building context", "The building footprint supplies horizontal context. Containment by this envelope is not a competing-unit overlap.", contained)

    findings.sort(key=lambda item: ({"error": 0, "warning": 1, "info": 2}[item["severity"]], item["code"], item["title"]))
    return {"frame": reference, "units": units, "context": context, "findings": findings, "inputFingerprint": fingerprint, "method": METHOD}
