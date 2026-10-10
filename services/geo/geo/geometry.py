from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import NamedTuple
import uuid

import shapely
from shapely.geometry import LinearRing, Polygon
from shapely.ops import unary_union
from shapely.validation import explain_validity

from .validation import EPSILON, MAX_FEATURES, MAX_VERTICES, InputError, clean_number, frame, number, polygon, source_ids, text

METHOD = f"polygon-prism-v1/shapely-{shapely.__version__}"
PRISM_METHOD = "prism/2"
ENCLOSURES = ("closed", "open")


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


def build_model(data: dict, *, allow_duplicate_aliases: bool = False) -> dict:
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
        if identity in ids or (alias in aliases and not allow_duplicate_aliases):
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


Point = tuple[Fraction, Fraction]


class _Unsupported(Exception):
    """An input the prism engine refuses to turn into geometry; carries the reason code."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class _ExactPolygon(NamedTuple):
    """Normalised rings (exterior counter-clockwise, holes clockwise), their exact area and a validity witness."""

    exterior: list[Point]
    holes: list[list[Point]]
    area: Fraction
    witness: Polygon


def _exact_number(value: object, reason: str) -> Fraction:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise _Unsupported(reason)
    try:
        parsed = Decimal(str(value).strip())
    except InvalidOperation:
        raise _Unsupported(reason) from None
    if not parsed.is_finite():
        raise _Unsupported(reason)
    return Fraction(parsed)


def _exact_text(value: Fraction) -> str:
    """Write a rational whose denominator has only the factors 2 and 5 as a plain decimal string."""
    scaled, digits = value, 0
    while scaled.denominator != 1:
        scaled *= 10
        digits += 1
    if digits == 0:
        return str(scaled.numerator)
    sign = "-" if scaled < 0 else ""
    padded = str(abs(scaled.numerator)).rjust(digits + 1, "0")
    return f"{sign}{padded[:-digits]}.{padded[-digits:]}"


def _ring_points(raw: object) -> list[Point]:
    if not isinstance(raw, list) or len(raw) > MAX_VERTICES:
        raise _Unsupported("ring_invalid")
    points = []
    for pair in raw:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            raise _Unsupported("coordinate_invalid")
        points.append((_exact_number(pair[0], "coordinate_invalid"), _exact_number(pair[1], "coordinate_invalid")))
    if len(points) > 1 and points[0] == points[-1]:
        points.pop()
    if len(set(points)) < 3:
        raise _Unsupported("ring_too_few_vertices")
    return points


def _signed_area(points: list[Point]) -> Fraction:
    twice_area = Fraction(0)
    for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
        twice_area += x1 * y2 - x2 * y1
    return twice_area / 2


def _is_collinear(points: list[Point]) -> bool:
    origin_x, origin_y = points[0]
    anchor_x, anchor_y = next(point for point in points if point != points[0])
    run, rise = anchor_x - origin_x, anchor_y - origin_y
    return all(run * (y - origin_y) - rise * (x - origin_x) == 0 for x, y in points)


def _oriented(points: list[Point], counter_clockwise: bool) -> list[Point]:
    if (_signed_area(points) > 0) == counter_clockwise:
        return points
    return [points[0]] + points[:0:-1]


def _floats(points: list[Point]) -> list[tuple[float, float]]:
    try:
        return [(float(x), float(y)) for x, y in points]
    except OverflowError:
        raise _Unsupported("coordinate_invalid") from None


def _check_ring(points: list[Point]) -> None:
    if _is_collinear(points):
        raise _Unsupported("ring_zero_area")
    if not LinearRing(_floats(points)).is_simple:
        raise _Unsupported("ring_self_intersecting")


def _check_polygon(witness: Polygon) -> None:
    if witness.is_valid:
        return
    reason = explain_validity(witness)
    if "Hole lies outside" in reason:
        raise _Unsupported("hole_outside_exterior")
    raise _Unsupported("rings_intersect" if "Self-intersection" in reason else "polygon_invalid")


def _parse_polygon(rings: object) -> _ExactPolygon:
    if not isinstance(rings, list) or not rings:
        raise _Unsupported("footprint_invalid")
    parsed = [_ring_points(raw) for raw in rings]
    for ring in parsed:
        _check_ring(ring)
    witness = Polygon(_floats(parsed[0]), [_floats(ring) for ring in parsed[1:]])
    _check_polygon(witness)
    exterior = _oriented(parsed[0], True)
    holes = [_oriented(ring, False) for ring in parsed[1:]]
    area = _signed_area(exterior) + sum((_signed_area(hole) for hole in holes), Fraction(0))
    return _ExactPolygon(exterior, holes, area, witness)


def _check_disjoint(polygons: list[_ExactPolygon]) -> None:
    for index, first in enumerate(polygons):
        for second in polygons[index + 1:]:
            if first.witness.relate_pattern(second.witness, "2********"):
                raise _Unsupported("polygons_overlap")


def _parse_footprint(raw: object) -> list[_ExactPolygon]:
    if not isinstance(raw, dict):
        raise _Unsupported("footprint_invalid")
    kind, coordinates = raw.get("type"), raw.get("coordinates")
    if kind == "Polygon":
        members = [coordinates]
    elif kind == "MultiPolygon" and isinstance(coordinates, list) and coordinates:
        members = coordinates
    else:
        raise _Unsupported("footprint_invalid")
    polygons = [_parse_polygon(rings) for rings in members]
    _check_disjoint(polygons)
    return polygons


def _parse_limits(component: dict) -> tuple[Fraction, Fraction] | None:
    """Return the exact level limits, or None when a limit is unknown; never substitute a typical height."""
    raw_lower, raw_upper = component.get("lowerM"), component.get("upperM")
    if raw_lower is None or raw_upper is None:
        return None
    lower = _exact_number(raw_lower, "level_limit_invalid")
    upper = _exact_number(raw_upper, "level_limit_invalid")
    if lower >= upper:
        raise _Unsupported("level_limits_not_increasing")
    return lower, upper


def _required_text(value: object, reason: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _Unsupported(reason)
    return value


def _parse_enclosure(component: dict) -> str | None:
    enclosure = component.get("enclosure")
    if enclosure is not None and enclosure not in ENCLOSURES:
        raise _Unsupported("enclosure_invalid")
    return enclosure


def _ring_json(points: list[Point]) -> list[list[str]]:
    return [[_exact_text(x), _exact_text(y)] for x, y in points + points[:1]]


def _footprint_json(polygons: list[_ExactPolygon]) -> list[list[list[list[str]]]]:
    return [[_ring_json(polygon.exterior)] + [_ring_json(hole) for hole in polygon.holes] for polygon in polygons]


def _prism_json(limits: tuple[Fraction, Fraction], area: Fraction, reference: str) -> tuple[dict, Fraction]:
    lower, upper = limits
    volume = area * (upper - lower)
    prism = {
        "lowerM": _exact_text(lower),
        "upperM": _exact_text(upper),
        "heightM": _exact_text(upper - lower),
        "verticalReference": reference,
        "volumeM3": float(volume),
        "volumeM3Exact": _exact_text(volume),
    }
    return prism, volume


def _prism_component(component: dict) -> tuple[dict, Fraction | None]:
    identity = {
        "componentId": _required_text(component.get("componentId"), "identifier_missing"),
        "levelId": _required_text(component.get("levelId"), "identifier_missing"),
    }
    polygons = _parse_footprint(component.get("footprint"))
    limits = _parse_limits(component)
    area = sum((polygon.area for polygon in polygons), Fraction(0))
    result = {
        **identity,
        "state": "ok",
        "enclosure": _parse_enclosure(component),
        "footprint": _footprint_json(polygons),
        "areaM2": float(area),
        "areaM2Exact": _exact_text(area),
    }
    if limits is None:
        return {**result, "heightState": "unknown", "reason": "level_limit_unknown", "prism": None}, None
    reference = _required_text(component.get("verticalReference"), "vertical_reference_missing")
    prism, volume = _prism_json(limits, area, reference)
    return {**result, "heightState": "known", "prism": prism}, volume


def _build_component(component: object) -> tuple[dict, Fraction | None]:
    try:
        if not isinstance(component, dict):
            raise _Unsupported("component_invalid")
        return _prism_component(component)
    except _Unsupported as problem:
        named = component if isinstance(component, dict) else {}
        failure = {
            "componentId": named.get("componentId"),
            "levelId": named.get("levelId"),
            "state": "unsupported",
            "reason": problem.reason,
        }
        return failure, None


def _summarise(built: list[tuple[dict, Fraction | None]]) -> dict:
    failures = [component for component, _ in built if component["state"] == "unsupported"]
    if failures:
        return {"state": "unsupported", "reason": failures[0]["reason"]}
    volumes = [volume for _, volume in built]
    if any(volume is None for volume in volumes):
        return {"state": "ok", "heightState": "unknown", "totalVolumeM3": None, "totalVolumeM3Exact": None}
    total = sum(volumes, Fraction(0))
    return {
        "state": "ok",
        "heightState": "known",
        "totalVolumeM3": float(total),
        "totalVolumeM3Exact": _exact_text(total),
    }


def _space_problem(space: object) -> str | None:
    if not isinstance(space, dict):
        return "space_invalid"
    if not isinstance(space.get("spaceId"), str) or not space["spaceId"].strip():
        return "identifier_missing"
    components = space.get("components")
    if not isinstance(components, list) or not components:
        return "components_missing"
    return None


def build_prisms(space: dict) -> dict:
    """Build one prism per level component of a reviewed space, with exact area and volume.

    Components are GeoJSON polygons or multipolygons (holes allowed) with decimal-string metres. Unknown level
    limits give heightState "unknown" with no prism and no volume; invalid input gives state "unsupported".
    """
    problem = _space_problem(space)
    if problem:
        return {"spaceId": None, "method": PRISM_METHOD, "state": "unsupported", "reason": problem}
    built = [_build_component(component) for component in space["components"]]
    return {
        "spaceId": space["spaceId"],
        "method": PRISM_METHOD,
        **_summarise(built),
        "components": [component for component, _ in built],
    }
