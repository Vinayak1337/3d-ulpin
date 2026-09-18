"""Bounded engineering registrations and explicit WGS84 ENU/ECEF placement.

The generated schema is the structural authority. This module executes only the
declared profiles; source coordinate records are never modified in place.
"""
import math
from .core_contract import bundled_schema, fail, index_records, parse_core, require_revision, version_key


def _east_west(axis):
    return axis in ("east", "west")


def _sign(axis):
    return -1 if axis in ("west", "south", "down") else 1


def _known_vertical(frame):
    return frame["kind"] != "geocentric" and frame["vertical"]["kind"] in ("benchmark", "datum")


def _same_vertical(a, b):
    return (_known_vertical(a) and _known_vertical(b)
            and a["vertical"]["kind"] == b["vertical"]["kind"]
            and version_key(a["vertical"]["reference"]) == version_key(b["vertical"]["reference"]))


def validate_core_frame_catalog(value):
    catalog = parse_core("frame-catalog", value)
    frames = index_records(catalog["frames"], "frame")
    index_records(catalog["operations"], "transform")
    for frame in catalog["frames"]:
        if frame["kind"] in ("engineering", "projected") and _east_west(frame["axes"][0]) == _east_west(frame["axes"][1]):
            fail("FRAME_AXES", "A planar frame requires independent east/west and north/south axes")
    for operation in catalog["operations"]:
        source = require_revision(frames, operation["from"], "source frame")
        target = require_revision(frames, operation["to"], "target frame")
        if version_key(operation["from"]) == version_key(operation["to"]):
            fail("TRANSFORM_SELF", "Use an empty path for an unchanged frame")
        if operation["kind"] == "unsupported":
            continue
        if source["kind"] != "engineering":
            fail("FRAME_PROFILE", "Engineering source required")
        domain = operation["sourceDomain"]
        if domain and (domain["minEast"] > domain["maxEast"] or domain["minNorth"] > domain["maxNorth"]):
            fail("FRAME_BOUNDS", "Transform source bounds are reversed")
        if operation["kind"] == "local_rigid":
            if target["kind"] != "engineering":
                fail("FRAME_PROFILE", "Engineering target required")
            tie = operation["verticalTie"]
            if tie["kind"] != "unavailable":
                if not _known_vertical(source) or not _known_vertical(target):
                    fail("VERTICAL_UNRESOLVED", "Constant ties cannot establish unknown/surface-relative height")
                if tie["kind"] == "same_reference" and not _same_vertical(source, target):
                    fail("VERTICAL_MISMATCH", "Declared vertical references differ")
                if tie["kind"] == "constant_offset" and _same_vertical(source, target) and tie["offsetMetres"] != 0:
                    fail("VERTICAL_MISMATCH", "One exact reference cannot have two elevation zeros")
        else:
            if target["kind"] != "geocentric":
                fail("FRAME_PROFILE", "WGS84 ENU requires WGS84 ECEF target")
            if source["vertical"]["kind"] != "benchmark" or version_key(source["vertical"]["reference"]) != version_key(operation["benchmark"]):
                fail("VERTICAL_MISMATCH", "Ellipsoidal origin must tie the exact local benchmark")
    return catalog


def _horizontal(frame, point, factors):
    factor = factors[frame["horizontalUnit"]]
    first = point[0] * factor * _sign(frame["axes"][0])
    second = point[1] * factor * _sign(frame["axes"][1])
    return (first, second) if _east_west(frame["axes"][0]) else (second, first)


def _up(frame, value, factors):
    return value * factors[frame["verticalUnit"]] * _sign(frame["verticalDirection"])


def _encode(frame, east, north, up, factors):
    factor = factors[frame["horizontalUnit"]]
    result = [(east if _east_west(frame["axes"][i]) else north) * _sign(frame["axes"][i]) / factor for i in range(2)]
    if up is not None:
        result.append(up * _sign(frame["verticalDirection"]) / factors[frame["verticalUnit"]])
    return result


def _domain(operation, east, north):
    bounds = operation["sourceDomain"]
    if bounds and (east < bounds["minEast"] or east > bounds["maxEast"] or north < bounds["minNorth"] or north > bounds["maxNorth"]):
        fail("OUTSIDE_DOMAIN", "Point is outside the declared source-domain bounds")


def _local(operation, source, target, point, inverse, factors):
    input_frame, output_frame = (target, source) if inverse else (source, target)
    east, north = _horizontal(input_frame, point, factors)
    dx, dy = operation["translationMetres"]
    angle = operation["rotationDegrees"] * math.pi / 180
    c, s = math.cos(angle), math.sin(angle)
    if inverse:
        output_east = (east - dx) * c + (north - dy) * s
        output_north = -(east - dx) * s + (north - dy) * c
        _domain(operation, output_east, output_north)
    else:
        _domain(operation, east, north)
        output_east, output_north = east * c - north * s + dx, east * s + north * c + dy
    up = None
    if len(point) == 3:
        tie = operation["verticalTie"]
        if tie["kind"] == "unavailable":
            fail("VERTICAL_UNRESOLVED", "No qualified vertical tie supplied")
        offset = tie["offsetMetres"] if tie["kind"] == "constant_offset" else 0
        up = _up(input_frame, point[2], factors) + (-offset if inverse else offset)
    return _encode(output_frame, output_east, output_north, up, factors)


def _enu(operation, source, point, inverse, policy):
    if len(point) != 3:
        fail("POINT_DIMENSION", "World placement requires explicit three-dimensional coordinates")
    origin = operation["origin"]
    lon, lat = origin["longitude"] * math.pi / 180, origin["latitude"] * math.pi / 180
    sl, cl, sp, cp = math.sin(lon), math.cos(lon), math.sin(lat), math.cos(lat)
    flattening = 1 / policy["wgs84"]["inverseFlattening"]
    e2 = flattening * (2 - flattening)
    n = policy["wgs84"]["semiMajorMetres"] / math.sqrt(1 - e2 * sp * sp)
    h = origin["ellipsoidHeightMetres"]
    translation = [(n + h) * cp * cl, (n + h) * cp * sl, (n * (1 - e2) + h) * sp]
    east_axis, north_axis, up_axis = [-sl, cl, 0], [-sp * cl, -sp * sl, cp], [cp * cl, cp * sl, sp]
    factors = policy["lengthMetres"]
    if inverse:
        delta = [point[i] - translation[i] for i in range(3)]
        east, north, up = [sum(delta[i] * axis[i] for i in range(3)) for axis in (east_axis, north_axis, up_axis)]
        _domain(operation, east, north)
        return _encode(source, east, north, up, factors)
    east, north = _horizontal(source, point, factors)
    up = _up(source, point[2], factors)
    _domain(operation, east, north)
    return [east * east_axis[i] + north * north_axis[i] + up * up_axis[i] + translation[i] for i in range(3)]


def transform_core_point(catalog_value, request_value):
    catalog = validate_core_frame_catalog(catalog_value)
    request = parse_core("point-transform", request_value)
    policy = bundled_schema("frame-catalog")[0]["x-ulpin-frame-policy"]
    frames, operations = index_records(catalog["frames"], "frame"), index_records(catalog["operations"], "transform")
    source = require_revision(frames, request["from"], "request source")
    target = require_revision(frames, request["to"], "request target")
    if any(frame["kind"] == "geocentric" for frame in (source, target)) and len(request["point"]) != 3:
        fail("POINT_DIMENSION", "ECEF points require three coordinates")
    if len(request["point"]) == 3 and any(frame["kind"] != "geocentric" and not _known_vertical(frame) for frame in (source, target)):
        fail("VERTICAL_UNRESOLVED", "Unknown or surface-relative height does not establish a 3D tie")
    point, cursor, accuracies = request["point"], request["from"], []
    visited = {version_key(cursor)}
    for step in request["steps"]:
        operation = require_revision(operations, step["operation"], "requested transform")
        inverse = step["direction"] == "inverse"
        input_frame, output_frame = (operation["to"], operation["from"]) if inverse else (operation["from"], operation["to"])
        if version_key(input_frame) != version_key(cursor):
            fail("TRANSFORM_PATH", "Operation path is not frame/revision continuous")
        if version_key(output_frame) in visited:
            fail("TRANSFORM_CYCLE", "Operation path repeats a frame")
        if operation["kind"] == "unsupported":
            fail("TRANSFORM_PROFILE", "Transform profile has no qualified executor")
        source = require_revision(frames, operation["from"], "operation source")
        target = require_revision(frames, operation["to"], "operation target")
        if operation["kind"] == "local_rigid":
            point = _local(operation, source, target, point, inverse, policy["lengthMetres"])
        else:
            point = _enu(operation, source, point, inverse, policy)
        if not all(math.isfinite(value) for value in point):
            fail("NON_FINITE_RESULT", "Coordinate arithmetic overflowed the supported profile")
        visited.add(version_key(output_frame))
        cursor = output_frame
        accuracies.append(operation["accuracyMetres"])
    if version_key(cursor) != version_key(request["to"]):
        fail("TRANSFORM_PATH", "Operation path does not reach the requested frame revision")
    return {"point": point, "frame": request["to"], "steps": request["steps"], "declaredAccuraciesMetres": accuracies}
