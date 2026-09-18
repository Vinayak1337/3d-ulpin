"""The bounded planar/prism kernel; no native parser, inferred geometry or repairs."""
import math
from .core_contract import bundled_schema, fail, index_records, parse_core, ref_key, require_revision, version_key
from .core_identity import validate_core_identity_graph
from .core_sources import is_precise_core_locator, unique, validate_core_source_catalog
from .core_frames import _horizontal, validate_core_frame_catalog


def _inline(rep):
    profile = rep["geometry"]
    return profile["geometry"] if profile["profile"] == "planar" else profile["footprint"] if profile["profile"] == "prism" else None


def _polygons(g):
    return [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []


def _points(g):
    if g["type"] == "Point":
        return [g["coordinates"]]
    if g["type"] == "LineString":
        return g["coordinates"]
    return [point for polygon in _polygons(g) for ring in polygon for point in ring]


def _normalise(g, frame, factors):
    def point(p):
        return list(_horizontal(frame, p, factors))
    if g["type"] == "Point":
        coords = point(g["coordinates"])
    elif g["type"] == "LineString":
        coords = [point(p) for p in g["coordinates"]]
    elif g["type"] == "Polygon":
        coords = [[point(p) for p in ring] for ring in g["coordinates"]]
    else:
        coords = [[[point(p) for p in ring] for ring in polygon] for polygon in g["coordinates"]]
    return {"type": g["type"], "coordinates": coords}


def _ring_area(ring):
    ox, oy = ring[0]
    total = 0
    for a, b in zip(ring, ring[1:]):
        total += (a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy)
    return total / 2


def _polygon_area(p):
    return abs(_ring_area(p[0])) - sum(abs(_ring_area(r)) for r in p[1:])


def _topology_work(g):
    polygons = _polygons(g)
    total = 0
    for polygon in polygons:
        for i, ring in enumerate(polygon):
            n = len(ring) - 1
            total += n * (n - 3) // 2
            total += sum(n * (len(other) - 1) for other in polygon[:i])
    for i, polygon in enumerate(polygons):
        total += sum(sum(len(r) - 1 for r in polygon) * sum(len(r) - 1 for r in other) for other in polygons[:i])
    return total


def _topology_issue(g, epsilon):
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def on_segment(a, b, p):
        return (abs(orient(a, b, p)) <= epsilon
                and min(a[0], b[0]) - epsilon <= p[0] <= max(a[0], b[0]) + epsilon
                and min(a[1], b[1]) - epsilon <= p[1] <= max(a[1], b[1]) + epsilon)

    def touches(a, b, c, d):
        u, v, w, x = orient(a, b, c), orient(a, b, d), orient(c, d, a), orient(c, d, b)
        crossing = ((u > epsilon and v < -epsilon or u < -epsilon and v > epsilon)
                    and (w > epsilon and x < -epsilon or w < -epsilon and x > epsilon))
        return crossing or on_segment(a, b, c) or on_segment(a, b, d) or on_segment(c, d, a) or on_segment(c, d, b)

    def contains(ring, p):
        inside = False
        for a, b in zip(ring, ring[1:]):
            if on_segment(a, b, p):
                return 0
            if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
                inside = not inside
        return 1 if inside else -1

    def rings_touch(a, b):
        return any(touches(a[i], a[i + 1], b[j], b[j + 1]) for i in range(len(a) - 1) for j in range(len(b) - 1))

    def in_polygon(rings, p):
        return contains(rings[0], p) == 1 and not any(contains(r, p) >= 0 for r in rings[1:])

    polygons = _polygons(g)
    for polygon in polygons:
        for ring in polygon:
            n = len(ring) - 1
            for i in range(n):
                if math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]) <= epsilon:
                    return "Repeated polygon vertex"
                for j in range(i + 1, n):
                    if j == i + 1 or i == 0 and j == n - 1:
                        continue
                    if touches(ring[i], ring[i + 1], ring[j], ring[j + 1]):
                        return "Self-intersecting or self-touching ring"
        for h in range(1, len(polygon)):
            if contains(polygon[0], polygon[h][0]) != 1 or rings_touch(polygon[0], polygon[h]):
                return "Hole is not strictly inside shell"
            for k in range(1, h):
                if rings_touch(polygon[k], polygon[h]) or contains(polygon[k], polygon[h][0]) >= 0 or contains(polygon[h], polygon[k][0]) >= 0:
                    return "Overlapping or nested holes"
    for a in range(len(polygons)):
        for b in range(a + 1, len(polygons)):
            if any(rings_touch(r, s) for r in polygons[a] for s in polygons[b]):
                return "Touching multipart boundaries require worker validation"
            if in_polygon(polygons[a], polygons[b][0][0]) or in_polygon(polygons[b], polygons[a][0][0]):
                return "Overlapping polygon parts"
    return None


def _prepare(value, identity_value, sources_value, frames_value):
    identity = validate_core_identity_graph(identity_value)
    sources = validate_core_source_catalog(sources_value, identity)
    frames = validate_core_frame_catalog(frames_value)
    catalog = parse_core("geometry-catalog", value)
    policy = bundled_schema("geometry-catalog")[0]["x-ulpin-geometry-policy"]
    factors = bundled_schema("frame-catalog")[0]["x-ulpin-frame-policy"]["lengthMetres"]
    entities = index_records(identity["entities"], "entity")
    frame_index = index_records(frames["frames"], "frame")
    parts, assets = index_records(sources["parts"], "source part"), index_records(sources["assets"], "asset")
    reps = index_records(catalog["representations"], "representation")
    reported = index_records(catalog["reportedQuantities"], "reported quantity")
    positions, comparisons = 0, 0
    for rep in catalog["representations"]:
        if ref_key(rep["entity"]) not in entities:
            fail("MISSING_TARGET", "Representation entity is absent")
        frame = require_revision(frame_index, rep["frame"], "representation frame") if rep["frame"] else None
        unique([version_key(link) for link in rep["sourceParts"]], "source parts")
        for link in rep["sourceParts"]:
            require_revision(parts, link, "representation source part")
        g = _inline(rep)
        if g:
            for link in rep["sourceParts"]:
                part = require_revision(parts, link, "geometry source part")
                if not any(is_precise_core_locator(locator) for locator in part["locators"]):
                    fail("LOCATOR_NOT_QUALIFIED", "Inline geometry needs an exact source locator")
            positions += len(_points(g))
            if positions > policy["maximumPositions"]:
                fail("GEOMETRY_BUDGET", "Catalog exceeds inline position profile")
            for polygon in _polygons(g):
                for ring in polygon:
                    if ring[0] != ring[-1]:
                        fail("GEOMETRY_RING", "Polygon rings must be explicitly closed")
            if frame and frame["kind"] == "engineering":
                metric = _normalise(g, frame, factors)
                comparisons += _topology_work(metric)
                if comparisons > policy["maximumTopologyComparisons"]:
                    fail("GEOMETRY_BUDGET", "Catalog exceeds bounded topology comparisons")
                if not all(math.isfinite(v) for p in _points(metric) for v in p):
                    fail("GEOMETRY_NUMERIC", "Metre normalization overflowed")
                for polygon in _polygons(metric):
                    for ring in polygon:
                        area = abs(_ring_area(ring))
                        if not math.isfinite(area) or area <= policy["areaFloorMetres2"]:
                            fail("GEOMETRY_DEGENERATE", "Ring has no qualified positive area")
                if _polygons(metric):
                    issue = _topology_issue(metric, policy["epsilonMetres"])
                    if issue:
                        fail("GEOMETRY_TOPOLOGY", issue)
                elif metric["type"] == "LineString" and all(p == metric["coordinates"][0] for p in metric["coordinates"]):
                    fail("GEOMETRY_DEGENERATE", "Line has no distinct positions")
        profile = rep["geometry"]
        if profile["profile"] == "asset":
            require_revision(assets, profile["asset"], "geometry asset")
        if profile["profile"] == "prism" and profile["interval"] is not None:
            interval = profile["interval"]
            if interval["upperMetres"] < interval["lowerMetres"]:
                fail("GEOMETRY_INTERVAL", "Positive-up metre elevations are reversed")
            if not math.isfinite(interval["upperMetres"] - interval["lowerMetres"]):
                fail("GEOMETRY_NUMERIC", "Vertical extent overflowed")
            if not frame or frame["kind"] == "geocentric" or frame["vertical"]["kind"] not in ("benchmark", "datum"):
                fail("VERTICAL_UNRESOLVED", "Prism requires its exact named vertical reference")
            if version_key(interval["reference"]) != version_key(frame["vertical"]["reference"]):
                fail("VERTICAL_MISMATCH", "Prism bounds do not use frame vertical reference")
    for quantity in catalog["reportedQuantities"]:
        if ref_key(quantity["entity"]) not in entities:
            fail("MISSING_TARGET", "Reported quantity entity is absent")
        require_revision(parts, quantity["sourcePart"], "reported quantity source part")
        if quantity["unit"] not in policy["reportedUnits"][quantity["definition"]]:
            fail("QUANTITY_UNIT", "Reported definition and unit dimensions differ")
        if quantity["amount"]["state"] == "conflicting":
            unique([version_key(link) for link in quantity["amount"]["candidates"]], "quantity candidates")
            values = set()
            for link in quantity["amount"]["candidates"]:
                other = require_revision(reported, link, "quantity candidate")
                if (ref_key(other["entity"]) != ref_key(quantity["entity"]) or other["definition"] != quantity["definition"]
                        or other["unit"] != quantity["unit"] or other["amount"]["state"] != "known"):
                    fail("QUANTITY_CONFLICT", "Conflict candidates must be known comparable quantities")
                values.add(other["amount"]["value"])
            if len(values) < 2:
                fail("QUANTITY_CONFLICT", "Equal reported values do not form a numeric disagreement")
    return catalog, entities, frame_index, reps, policy, factors


def validate_core_geometry_catalog(value, identity, sources, frames):
    return _prepare(value, identity, sources, frames)[0]


def evaluate_core_geometry(value, identity, sources, frames):
    catalog, entities, frame_index, _, policy, factors = _prepare(value, identity, sources, frames)
    def available(value, reason):
        return {"available": bool(value), "reasonCode": None if value else reason}
    result = []
    for rep in catalog["representations"]:
        frame = require_revision(frame_index, rep["frame"], "frame") if rep["frame"] else None
        g = _inline(rep)
        polygon = bool(g and _polygons(g))
        profile = rep["geometry"]
        interval = profile["interval"] if profile["profile"] == "prism" else None
        horizontal = _compute_quantity(rep, frame, "planar_length" if g and g["type"] == "LineString" else "horizontal_area", policy, factors)
        volume = _compute_quantity(rep, frame, "prism_volume", policy, factors)
        kind = entities[ref_key(rep["entity"])]["kind"]
        caps = {
            "source_reference": available(bool(rep["sourceParts"]), "NO_SOURCE_PART"),
            "local_preview": available(g is not None, "NO_INLINE_GEOMETRY"),
            "horizontal_measurement": available(horizontal["value"] is not None, horizontal["reasonCode"] or "QUANTITY_GEOMETRY"),
            "prism_volume": available(volume["value"] is not None, volume["reasonCode"] or "QUANTITY_GEOMETRY_ROLE"),
            "exterior_render": available(volume["value"] is not None and interval is not None and interval["upperMetres"] > interval["lowerMetres"], "NO_POSITIVE_QUALIFIED_PRISM"),
            "interior_selection": available(polygon and (kind == "space" and rep["role"] == "unit_boundary" or kind == "level" and rep["role"] == "floor_boundary"), "NO_IDENTIFIED_INTERIOR"),
        }
        result.append({"representation": {"ref": rep["ref"], "revision": rep["revision"]}, "capabilities": caps})
    return result


def measure_core_representation(value, identity, sources, frames, request_value):
    _, _, frame_index, reps, policy, factors = _prepare(value, identity, sources, frames)
    request = parse_core("measure-request", request_value)
    rep = require_revision(reps, request["representation"], "measurement representation")
    frame = require_revision(frame_index, rep["frame"], "frame") if rep["frame"] else None
    definition = request["definition"]
    base = {"definition": definition, "unit": {"horizontal_area": "m2", "prism_volume": "m3", "planar_length": "m"}[definition],
            "representation": request["representation"], "frame": rep["frame"], "method": policy["method"], "sourceParts": rep["sourceParts"]}
    return {**base, **_compute_quantity(rep, frame, definition, policy, factors)}


def _compute_quantity(rep, frame, definition, policy, factors):
    g = _inline(rep)
    def unavailable(reason):
        return {"value": None, "reasonCode": reason}
    if not g:
        return unavailable("NO_INLINE_GEOMETRY")
    if not frame or frame["kind"] != "engineering":
        return unavailable("ENGINEERING_FRAME_REQUIRED")
    if rep["role"] in policy["nonAnalyticalRoles"]:
        return unavailable("NON_ANALYTICAL_ROLE")
    metric = _normalise(g, frame, factors)
    if definition == "planar_length":
        if metric["type"] != "LineString":
            return unavailable("LINE_REQUIRED")
        result = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(metric["coordinates"], metric["coordinates"][1:]))
    else:
        polygons = _polygons(metric)
        if not polygons:
            return unavailable("POLYGON_REQUIRED")
        result = sum(_polygon_area(p) for p in polygons)
        if definition == "prism_volume":
            if rep["role"] not in policy["volumeRoles"]:
                return unavailable("QUANTITY_GEOMETRY_ROLE")
            if rep["geometry"]["profile"] != "prism" or rep["geometry"]["interval"] is None:
                return unavailable("UNKNOWN_VERTICAL_INTERVAL")
            interval = rep["geometry"]["interval"]
            result *= interval["upperMetres"] - interval["lowerMetres"]
    if not math.isfinite(result) or result < 0:
        return unavailable("QUANTITY_NUMERIC")
    return {"value": result, "reasonCode": None}
