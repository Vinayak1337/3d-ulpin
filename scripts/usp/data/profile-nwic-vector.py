#!/usr/bin/env python3
"""Stream and profile the pinned NWIC projected district GeoJSON without rewriting it."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import sys
import time

import numpy as np
import pyproj
from pyproj import CRS
from pyproj.enums import TransformDirection
from pyproj import network as pyproj_network
from pyproj.transformer import TransformerGroup
import shapely
from shapely.geometry import shape
from shapely.validation import explain_validity


SOURCE_SHA256 = "2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201"
SOURCE_BYTES = 168_356_689
EXPECTED_FEATURES = 733
EXPECTED_POSITIONS = 3_125_505
EXPECTED_CRS_URN = "urn:ogc:def:crs:EPSG::7755"
GEOMETRY_IMAGE = "sha256:91683e358f3fa8d8a132b8d02548d588343fbdb38c902e473512ce9c84ecefd2"
REQUIREMENTS_SHA256 = "118eb43f0bf7ad98af17e4676c32a0eadbf0748f917e623c3316ada646aefa1d"
SPECIAL = re.compile(rb'["{}\\]')


class ProfileError(RuntimeError):
    pass


class JSONObject(dict):
    def __init__(self, pairs):
        super().__init__()
        self.duplicate_keys = []
        for key, value in pairs:
            if key in self:
                self.duplicate_keys.append(key)
            self[key] = value


def object_hook(pairs):
    return JSONObject(pairs)


class ByteReader:
    """Chunked reader with an absolute offset and a hash of every fetched byte."""

    def __init__(self, path: Path, chunk_size: int = 1024 * 1024):
        self.file = path.open("rb")
        self.chunk_size = chunk_size
        self.buffer = b""
        self.pos = 0
        self.base = 0
        self.eof = False
        self.digest = hashlib.sha256()
        self.bytes_fetched = 0

    @property
    def offset(self) -> int:
        return self.base + self.pos

    def fill(self) -> bool:
        if self.pos < len(self.buffer):
            return True
        if self.eof:
            return False
        self.base += len(self.buffer)
        self.buffer = self.file.read(self.chunk_size)
        self.pos = 0
        if not self.buffer:
            self.eof = True
            return False
        self.digest.update(self.buffer)
        self.bytes_fetched += len(self.buffer)
        return True

    def peek(self) -> int | None:
        if not self.fill():
            return None
        return self.buffer[self.pos]

    def consume(self, count: int) -> None:
        if count < 0 or self.pos + count > len(self.buffer):
            raise ProfileError("internal reader consume crossed an unfetched chunk")
        self.pos += count

    def available(self) -> memoryview | None:
        if not self.fill():
            return None
        return memoryview(self.buffer)[self.pos:]

    def close(self) -> None:
        self.file.close()


def locate_features(reader: ByteReader) -> tuple[int, dict]:
    """Find the root FeatureCollection array in its bounded JSON header."""
    if not reader.fill():
        raise ProfileError("empty source")
    header = reader.buffer
    search_from = 0
    while True:
        key_at = header.find(b'"features"', search_from)
        if key_at < 0:
            raise ProfileError("root features member was not found in the first 1 MiB")
        colon = key_at + len(b'"features"')
        while colon < len(header) and header[colon] in b" \t\r\n":
            colon += 1
        if colon >= len(header) or header[colon] != ord(":"):
            search_from = key_at + 1
            continue
        array_at = colon + 1
        while array_at < len(header) and header[array_at] in b" \t\r\n":
            array_at += 1
        if array_at >= len(header) or header[array_at] != ord("["):
            search_from = key_at + 1
            continue
        try:
            root = json.loads(header[:array_at] + b"[]}", object_pairs_hook=object_hook)
        except (json.JSONDecodeError, UnicodeDecodeError):
            search_from = key_at + 1
            continue
        if not isinstance(root, dict) or root.get("type") != "FeatureCollection" or root.get("features") != []:
            search_from = key_at + 1
            continue
        reader.consume(array_at + 1)
        return array_at, root


def skip_ws(reader: ByteReader) -> None:
    while (value := reader.peek()) in (9, 10, 13, 32):
        reader.consume(1)


def read_feature(reader: ByteReader) -> tuple[bytes, int, int]:
    start = reader.offset
    raw = bytearray()
    depth = 0
    in_string = False
    escaped = False
    saw_object = False
    while True:
        available = reader.available()
        if available is None:
            raise ProfileError(f"unterminated feature object at byte {start}")
        match = SPECIAL.search(available)
        if match is None:
            raw.extend(available)
            reader.consume(len(available))
            continue
        relative = match.start()
        raw.extend(available[:relative + 1])
        token = available[relative]
        reader.consume(relative + 1)
        if in_string:
            if escaped:
                escaped = False
            elif token == ord("\\"):
                escaped = True
            elif token == ord('"'):
                in_string = False
            continue
        if token == ord('"'):
            in_string = True
        elif token == ord("{"):
            depth += 1
            saw_object = True
        elif token == ord("}"):
            depth -= 1
            if depth < 0:
                raise ProfileError(f"unexpected closing brace in feature at byte {start}")
            if saw_object and depth == 0:
                return bytes(raw), start, reader.offset


def json_kind(value) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def canonical_scalar(value) -> str:
    return json.dumps([json_kind(value), value], ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=True)


class TransformAccumulator:
    def __init__(self, transformer, batch_size: int = 50_000):
        self.transformer = transformer
        self.batch_size = batch_size
        self.xs = []
        self.ys = []
        self.input_count = 0
        self.output_count = 0
        self.failures = []
        self.extent = [math.inf, math.inf, -math.inf, -math.inf]
        self.sum_error = 0.0
        self.sum_sq_error = 0.0
        self.max_error = 0.0
        self.feature_sum_error = 0.0
        self.feature_sum_sq_error = 0.0
        self.feature_max_error = 0.0
        self.feature_transformed = 0
        self.feature_failure = None

    def begin_feature(self):
        self.feature_sum_error = 0.0
        self.feature_sum_sq_error = 0.0
        self.feature_max_error = 0.0
        self.feature_transformed = 0
        self.feature_failure = None

    def add(self, x, y):
        self.xs.append(float(x))
        self.ys.append(float(y))
        self.input_count += 1
        if len(self.xs) >= self.batch_size:
            self.flush()

    def flush(self):
        if not self.xs:
            return
        x = np.asarray(self.xs, dtype=np.float64)
        y = np.asarray(self.ys, dtype=np.float64)
        try:
            lon, lat = self.transformer.transform(x, y, errcheck=True)
            lon = np.asarray(lon, dtype=np.float64)
            lat = np.asarray(lat, dtype=np.float64)
            finite = np.isfinite(lon) & np.isfinite(lat)
            if not bool(np.all(finite)):
                raise ValueError(f"{int((~finite).sum())} transformed positions are non-finite")
            self.extent[0] = min(self.extent[0], float(lon.min()))
            self.extent[1] = min(self.extent[1], float(lat.min()))
            self.extent[2] = max(self.extent[2], float(lon.max()))
            self.extent[3] = max(self.extent[3], float(lat.max()))
            back_x, back_y = self.transformer.transform(
                lon, lat, direction=TransformDirection.INVERSE, errcheck=True
            )
            errors = np.hypot(np.asarray(back_x, dtype=np.float64) - x,
                              np.asarray(back_y, dtype=np.float64) - y)
            if not bool(np.isfinite(errors).all()):
                raise ValueError("inverse transform produced non-finite residuals")
            self.output_count += int(errors.size)
            batch_sum = float(errors.sum(dtype=np.float64))
            batch_sq = float(np.dot(errors, errors))
            batch_max = float(errors.max(initial=0.0))
            self.sum_error += batch_sum
            self.sum_sq_error += batch_sq
            self.max_error = max(self.max_error, batch_max)
            self.feature_sum_error += batch_sum
            self.feature_sum_sq_error += batch_sq
            self.feature_max_error = max(self.feature_max_error, batch_max)
            self.feature_transformed += int(errors.size)
        except Exception as exc:  # recorded against the active feature by caller
            self.feature_failure = f"{type(exc).__name__}: {exc}"
            self.failures.append(self.feature_failure)
        finally:
            self.xs.clear()
            self.ys.clear()

    def finish_feature(self):
        self.flush()


def add_extent(bounds, x, y):
    bounds[0] = min(bounds[0], float(x))
    bounds[1] = min(bounds[1], float(y))
    bounds[2] = max(bounds[2], float(x))
    bounds[3] = max(bounds[3], float(y))


def inspect_geometry(geometry, transformer, source_bounds, dimensions, dispositions):
    """Count native coordinate structure, transform finite XY, and validate without repair."""
    result = {
        "positionCount": 0, "finiteXYCount": 0, "polygonCount": 0,
        "ringCount": 0, "ringPositionMax": 0, "extraDimensionPositions": 0,
        "structurallyEvaluable": False, "ringClosureFailures": 0,
        "shortRings": 0, "malformedPositions": 0, "nonFinitePositions": 0,
        "emptyPolygons": 0, "emptyRings": 0,
    }
    if not isinstance(geometry, dict):
        dispositions["geometry-null" if geometry is None else "geometry-not-object"] += 1
        return result, None
    geometry_type = geometry.get("type")
    coords = geometry.get("coordinates")
    if geometry_type not in ("MultiPolygon", "Polygon"):
        dispositions[f"geometry-type-{geometry_type or 'missing'}"] += 1
        return result, None
    if "coordinates" not in geometry:
        dispositions["coordinates-absent"] += 1
        return result, None
    if coords is None:
        dispositions["coordinates-null"] += 1
        return result, None
    if not isinstance(coords, list):
        dispositions["coordinates-not-array"] += 1
        return result, None
    if not coords:
        dispositions["coordinates-empty"] += 1
        return result, None

    structural_ok = True
    polygons = coords if geometry_type == "MultiPolygon" else [coords]
    for polygon in polygons:
        if not isinstance(polygon, list):
            structural_ok = False
            result["malformedPositions"] += 1
            dispositions["malformed-polygon"] += 1
            continue
        result["polygonCount"] += 1
        if not polygon:
            structural_ok = False
            result["emptyPolygons"] += 1
            dispositions["empty-polygon"] += 1
        for ring in polygon:
            if not isinstance(ring, list):
                structural_ok = False
                result["malformedPositions"] += 1
                dispositions["malformed-ring"] += 1
                continue
            result["ringCount"] += 1
            result["ringPositionMax"] = max(result["ringPositionMax"], len(ring))
            if not ring:
                structural_ok = False
                result["emptyRings"] += 1
                dispositions["empty-ring"] += 1
            if len(ring) < 4:
                structural_ok = False
                result["shortRings"] += 1
                dispositions["short-ring"] += 1
            if not ring or ring[0] != ring[-1]:
                structural_ok = False
                result["ringClosureFailures"] += 1
                dispositions["unclosed-ring"] += 1
            for position in ring:
                result["positionCount"] += 1
                if not isinstance(position, list):
                    structural_ok = False
                    result["malformedPositions"] += 1
                    dispositions["malformed-position"] += 1
                    continue
                dimensions[str(len(position))] += 1
                if len(position) > 2:
                    result["extraDimensionPositions"] += 1
                    structural_ok = False
                    dispositions["extra-dimension-position"] += 1
                if len(position) < 2 or any(
                    isinstance(position[index], bool)
                    or not isinstance(position[index], (int, float))
                    for index in range(min(2, len(position)))
                ):
                    structural_ok = False
                    result["malformedPositions"] += 1
                    dispositions["malformed-position"] += 1
                    continue
                if not math.isfinite(position[0]) or not math.isfinite(position[1]):
                    structural_ok = False
                    result["nonFinitePositions"] += 1
                    dispositions["non-finite-position"] += 1
                    continue
                result["finiteXYCount"] += 1
                add_extent(source_bounds, position[0], position[1])
                transformer.add(position[0], position[1])
    transformer.finish_feature()
    result["structurallyEvaluable"] = structural_ok and result["positionCount"] > 0
    if not structural_ok:
        dispositions["geometry-structure-not-evaluable"] += 1
        return result, None
    dispositions["geometry-structure-evaluable"] += 1
    try:
        native = shape(geometry)
        valid = bool(shapely.is_valid(native))
        reason = explain_validity(native)
        return result, {"valid": valid, "reason": reason, "geometryType": native.geom_type}
    except Exception as exc:
        dispositions["topology-validation-error"] += 1
        return result, {"error": f"{type(exc).__name__}: {exc}"}


def add_property_values(stats, props, feature_index, offset, feature):
    if not isinstance(props, dict):
        stats["malformedPropertiesCount"] += 1
        return
    if getattr(props, "duplicate_keys", None):
        for key in props.duplicate_keys:
            stats["duplicatePropertyKeyCounts"][key] += 1
    for key, value in props.items():
        item = stats["properties"].setdefault(key, {
            "count": 0, "nullCount": 0, "types": Counter(), "values": Counter(),
        })
        item["count"] += 1
        kind = json_kind(value)
        item["types"][kind] += 1
        if value is None:
            item["nullCount"] += 1
        if kind not in ("array", "object"):
            encoded = canonical_scalar(value)
            item["values"][encoded] += 1
            if key in ("id", "objectid", "dtcode"):
                ref = {
                    "featureIndex": feature_index,
                    "byteOffset": offset,
                    "properties.id": props.get("id"),
                    "properties.objectid": props.get("objectid"),
                }
                stats["keyRefs"][key][encoded].append(ref)
    if "id" in props and json_kind(props["id"]) not in ("array", "object"):
        stats["nativeIds"]["properties.id"] += 1
    if "objectid" in props and json_kind(props["objectid"]) not in ("array", "object"):
        stats["nativeIds"]["properties.objectid"] += 1
    if "id" in feature:
        stats["featureIdTypes"][json_kind(feature["id"])] += 1
    else:
        stats["featureIdAbsent"] += 1


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def create_transformer():
    pyproj_network.set_network_enabled(False)
    source_crs = CRS.from_epsg(7755)
    target_crs = CRS.from_epsg(4326)
    group = TransformerGroup(source_crs, target_crs, always_xy=True, allow_ballpark=False)
    if not group.transformers:
        raise ProfileError("no offline non-ballpark EPSG:7755 to EPSG:4326 operation is available")
    if len(group.transformers) != 1 or not group.best_available or group.unavailable_operations:
        raise ProfileError("offline CRS operation inventory differs from the pinned preflight")
    transformer = group.transformers[0]
    if not transformer.definition or "proj=lcc" not in transformer.definition:
        raise ProfileError("unexpected projected CRS operation definition")
    operation = {
        "description": transformer.description,
        "definition": transformer.definition,
        "accuracyReportedByPROJMetres": transformer.accuracy,
        "bestAvailable": group.best_available,
        "availableOperationCount": len(group.transformers),
        "unavailableOperationCount": len(group.unavailable_operations),
        "alwaysXY": True,
        "ballparkAllowed": False,
        "grids": [],
        "interpretation": "This is the mathematical CRS operation metadata, not a positional-accuracy claim.",
    }
    return transformer, source_crs, target_crs, operation


def normalize_bounds(bounds):
    return None if not math.isfinite(bounds[0]) else [float(v) for v in bounds]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--container-image-digest", required=True)
    parser.add_argument("--source-host-path", required=True)
    parser.add_argument("--expected-source-sha256", default=SOURCE_SHA256)
    parser.add_argument("--expected-source-bytes", type=int, default=SOURCE_BYTES)
    parser.add_argument("--expected-features", type=int, default=EXPECTED_FEATURES)
    parser.add_argument("--expected-positions", type=int, default=EXPECTED_POSITIONS)
    args = parser.parse_args()
    if args.container_image_digest != GEOMETRY_IMAGE:
        raise ProfileError("geometry image digest does not match the approved local image")
    if args.input.stat().st_size != args.expected_source_bytes:
        raise ProfileError("input byte count differs from the accepted unchanged member")

    started = time.perf_counter()
    transformer, source_crs, target_crs, operation = create_transformer()
    reader = ByteReader(args.input)
    feature_array_offset, root_header = locate_features(reader)
    actual_crs = ((root_header.get("crs") or {}).get("properties") or {}).get("name")
    if actual_crs != EXPECTED_CRS_URN:
        reader.close()
        raise ProfileError(f"source CRS literal changed: {actual_crs!r}")
    source_bounds = [math.inf, math.inf, -math.inf, -math.inf]
    dimensions = Counter()
    dispositions = Counter()
    geometry_type_counts = Counter()
    for disposition in (
        "geometry-null", "geometry-not-object", "coordinates-absent",
        "coordinates-null", "coordinates-not-array", "coordinates-empty",
        "empty-polygon", "empty-ring", "short-ring", "unclosed-ring",
        "malformed-polygon", "malformed-ring", "malformed-position",
        "non-finite-position", "extra-dimension-position",
        "geometry-structure-evaluable", "geometry-structure-not-evaluable",
        "topology-validation-error",
    ):
        dispositions[disposition] = 0
    validity = Counter()
    invalid_details = []
    validation_errors = []
    structure_failures = []
    top_spans = []
    largest_positions = []
    largest_rings = []
    largest_ring_positions = []
    max_ring_count = -1
    max_polygon_count = -1
    max_feature_span = -1
    max_feature_positions = -1
    max_feature_span_record = None
    max_feature_positions_record = None
    max_feature_polygons_record = None
    max_feature_rings_record = None
    max_ring_positions_record = None
    feature_count = 0
    raw_position_count = 0
    finite_xy_count = 0
    polygon_count = 0
    ring_count = 0
    per_feature_ring_position_max = 0
    key_stats = {
        "properties": {}, "keyRefs": defaultdict(lambda: defaultdict(list)),
        "duplicatePropertyKeyCounts": Counter(), "featureIdTypes": Counter(),
        "featureIdAbsent": 0, "nativeIds": Counter(), "malformedPropertiesCount": 0,
    }
    transform = TransformAccumulator(transformer)

    try:
        first = True
        while True:
            skip_ws(reader)
            next_byte = reader.peek()
            if next_byte == ord("]"):
                if first:
                    raise ProfileError("FeatureCollection has an empty features array")
                reader.consume(1)
                break
            if next_byte is None:
                raise ProfileError("unexpected EOF in features array")
            if not first:
                if next_byte != ord(","):
                    raise ProfileError(f"expected feature separator at byte {reader.offset}")
                reader.consume(1)
                skip_ws(reader)
                if reader.peek() == ord("]"):
                    raise ProfileError("trailing comma in features array")
            elif next_byte != ord("{"):
                raise ProfileError(f"expected Feature object at byte {reader.offset}")
            raw, start, end = read_feature(reader)
            feature_count += 1
            first = False
            try:
                feature = json.loads(raw, object_pairs_hook=object_hook)
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                raise ProfileError(f"feature {feature_count} at byte {start} is malformed JSON: {exc}") from exc
            if not isinstance(feature, dict) or feature.get("type") != "Feature":
                raise ProfileError(f"object at byte {start} is not a GeoJSON Feature")
            props = feature.get("properties")
            add_property_values(key_stats, props, feature_count, start, feature)
            geometry_value = feature.get("geometry")
            if geometry_value is None:
                geometry_type_counts["null"] += 1
            elif isinstance(geometry_value, dict):
                geometry_type_counts[str(geometry_value.get("type", "<missing>"))] += 1
            else:
                geometry_type_counts["<non-object>"] += 1
            transform.begin_feature()
            geometry_summary, topology = inspect_geometry(
                feature.get("geometry"), transform, source_bounds, dimensions, dispositions
            )
            count = geometry_summary["positionCount"]
            raw_position_count += count
            finite_xy_count += geometry_summary["finiteXYCount"]
            polygon_count += geometry_summary["polygonCount"]
            ring_count += geometry_summary["ringCount"]
            per_feature_ring_position_max = max(per_feature_ring_position_max,
                                                geometry_summary["ringPositionMax"])
            if transform.feature_failure:
                validation_errors.append({
                    "featureIndex": feature_count, "byteOffset": start,
                    "properties.id": props.get("id") if isinstance(props, dict) else None,
                    "properties.objectid": props.get("objectid") if isinstance(props, dict) else None,
                    "error": transform.feature_failure,
                })
            if topology is None:
                validity["not-evaluable-structure"] += 1
                geometry_value = feature.get("geometry")
                geometry_type = geometry_value.get("type") if isinstance(geometry_value, dict) else None
                structure_failures.append({
                    "featureIndex": feature_count, "byteOffset": start,
                    "byteEndExclusive": end,
                    "properties.id": props.get("id") if isinstance(props, dict) else None,
                    "properties.objectid": props.get("objectid") if isinstance(props, dict) else None,
                    "geometryType": geometry_type,
                    "geometrySummary": geometry_summary,
                })
            elif "error" in topology:
                validity["validation-error"] += 1
                validation_errors.append({
                    "featureIndex": feature_count, "byteOffset": start,
                    "properties.id": props.get("id") if isinstance(props, dict) else None,
                    "properties.objectid": props.get("objectid") if isinstance(props, dict) else None,
                    "error": topology["error"],
                })
            elif topology["valid"]:
                validity["valid"] += 1
            else:
                validity["invalid"] += 1
                validity[topology["reason"]] += 1
                invalid_details.append({
                    "featureIndex": feature_count, "byteOffset": start,
                    "byteEndExclusive": end, "byteLength": end - start,
                    "properties.id": props.get("id") if isinstance(props, dict) else None,
                    "properties.objectid": props.get("objectid") if isinstance(props, dict) else None,
                    "reason": topology["reason"],
                })
            if (geometry_summary["nonFinitePositions"] or geometry_summary["malformedPositions"]
                    or geometry_summary["ringClosureFailures"] or geometry_summary["shortRings"]
                    or geometry_summary["extraDimensionPositions"] or geometry_summary["emptyPolygons"]
                    or geometry_summary["emptyRings"]):
                validation_errors.append({
                    "featureIndex": feature_count, "byteOffset": start,
                    "properties.id": props.get("id") if isinstance(props, dict) else None,
                    "properties.objectid": props.get("objectid") if isinstance(props, dict) else None,
                    "nonFinitePositions": geometry_summary["nonFinitePositions"],
                    "malformedPositions": geometry_summary["malformedPositions"],
                })
            record = {
                "featureIndex": feature_count, "byteOffset": start,
                "byteEndExclusive": end, "byteLength": end - start,
                "properties.id": props.get("id") if isinstance(props, dict) else None,
                "properties.objectid": props.get("objectid") if isinstance(props, dict) else None,
                "positionCount": count,
                "polygonCount": geometry_summary["polygonCount"],
                "ringCount": geometry_summary["ringCount"],
                "maxRingPositions": geometry_summary["ringPositionMax"],
            }
            top_spans.append(record)
            top_spans.sort(key=lambda item: (-item["byteLength"], item["featureIndex"]))
            del top_spans[10:]
            largest_positions.append(record)
            largest_positions.sort(key=lambda item: (-item["positionCount"], item["featureIndex"]))
            del largest_positions[10:]
            if geometry_summary["ringPositionMax"] > (max_ring_positions_record or {}).get("maxRingPositions", -1):
                max_ring_positions_record = record
            largest_rings.append(record)
            largest_rings.sort(key=lambda item: (-item["ringCount"], item["featureIndex"]))
            del largest_rings[10:]
            largest_ring_positions.append(record)
            largest_ring_positions.sort(key=lambda item: (-item["maxRingPositions"], item["featureIndex"]))
            del largest_ring_positions[10:]
            if geometry_summary["ringCount"] > max_ring_count:
                max_ring_count = geometry_summary["ringCount"]
                max_feature_rings_record = record
            if geometry_summary["polygonCount"] > max_polygon_count:
                max_polygon_count = geometry_summary["polygonCount"]
                max_feature_polygons_record = record
            if end - start > max_feature_span:
                max_feature_span = end - start
                max_feature_span_record = record
            if count > max_feature_positions:
                max_feature_positions = count
                max_feature_positions_record = record
            del feature, raw

        skip_ws(reader)
        if reader.peek() != ord("}"):
            raise ProfileError("expected the root FeatureCollection close after its features array")
        reader.consume(1)
        skip_ws(reader)
        if reader.peek() is not None:
            raise ProfileError("unexpected trailing non-whitespace bytes after FeatureCollection")
        reader.close()
    except Exception:
        reader.close()
        raise

    input_hash = reader.digest.hexdigest()
    input_bytes = reader.bytes_fetched
    if input_bytes != args.expected_source_bytes or input_hash != args.expected_source_sha256:
        raise ProfileError("streamed input bytes/hash differ from the accepted unchanged member")
    if feature_count != args.expected_features or raw_position_count != args.expected_positions:
        raise ProfileError(
            f"observed feature/position counts {feature_count}/{raw_position_count} differ from accepted "
            f"{args.expected_features}/{args.expected_positions}"
        )
    transformed_extent = normalize_bounds(transform.extent)
    if transform.output_count != finite_xy_count or transform.failures:
        raise ProfileError("not every finite XY position completed forward and inverse CRS transforms")
    if dimensions and set(dimensions) != {"2"}:
        raise ProfileError("source dimensions changed from the accepted 2D coordinate profile")

    data_dir = Path(pyproj.datadir.get_data_dir())
    proj_db = data_dir / "proj.db"
    proj_db_sha256 = digest_file(proj_db)
    script_hash = digest_file(Path(__file__))
    property_profile = {}
    for key in sorted(key_stats["properties"]):
        item = key_stats["properties"][key]
        total_unique = len(item["values"])
        duplicates = sum(count - 1 for count in item["values"].values() if count > 1)
        property_profile[key] = {
            "count": item["count"], "nullCount": item["nullCount"],
            "jsonTypes": dict(sorted(item["types"].items())),
            "distinctScalarValues": total_unique,
            "duplicateScalarOccurrences": duplicates,
        }
    duplicate_key_details = {}
    for key in ("id", "objectid", "dtcode"):
        groups = []
        item = key_stats["properties"].get(key)
        if item:
            for encoded, count in item["values"].items():
                if count > 1:
                    refs = key_stats["keyRefs"][key][encoded]
                    value = json.loads(encoded)[1]
                    groups.append({"value": value, "count": count, "features": refs})
        duplicate_key_details[key] = groups

    profile = {
        "schemaVersion": "nwic-vector-admission-profile/1",
        "source": {
            "outsideGitPath": args.source_host_path,
            "containerPath": str(args.input), "bytes": input_bytes,
            "sha256": input_hash, "unchangedSourceMember": True,
            "featureCollectionHeader": {
                "type": root_header.get("type"), "name": root_header.get("name"),
                "crs": root_header.get("crs"),
                "featuresArrayByteOffset": feature_array_offset,
            },
        },
        "runtime": {
            "containerImageDigest": args.container_image_digest,
            "python": sys.version.split()[0], "platform": sys.platform,
            "numpy": np.__version__, "shapely": shapely.__version__,
            "geos": shapely.geos_version_string,
            "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
            "projNetworkEnabled": False,
            "projDataDirectory": str(data_dir),
            "projDatabase": {"bytes": proj_db.stat().st_size, "sha256": proj_db_sha256},
            "requirementsFileSha256": REQUIREMENTS_SHA256,
            "profilerSha256": script_hash,
        },
        "crsDiagnostic": {
            "source": {"authority": "EPSG:7755", "name": source_crs.name,
                       "axes": [{"name": axis.name, "abbreviation": axis.abbrev,
                                 "direction": axis.direction, "unit": axis.unit_name}
                                for axis in source_crs.axis_info]},
            "target": {"authority": "EPSG:4326", "name": target_crs.name,
                       "axisOrderUsed": "longitude, latitude (always_xy=True)"},
            "operation": operation,
            "finiteTransformedExtentLongitudeLatitude": transformed_extent,
            "inverseRoundTripResidualInSourceMetres": {
                "coordinateCount": transform.output_count,
                "maximum": transform.max_error,
                "mean": transform.sum_error / transform.output_count,
                "rms": math.sqrt(transform.sum_sq_error / transform.output_count),
                "interpretation": "Numerical forward/inverse round-trip residual only; not source positional accuracy.",
            },
        },
        "geometry": {
            "featureCount": feature_count, "featureIdTypes": dict(sorted(key_stats["featureIdTypes"].items())),
            "featureIdAbsentCount": key_stats["featureIdAbsent"],
            "geometryTypeCounts": dict(sorted(geometry_type_counts.items())),
            "geometryDispositions": dict(sorted(dispositions.items())),
            "polygonCount": polygon_count, "ringCount": ring_count,
            "rawCoordinatePositionCount": raw_position_count,
            "finiteXYPositionCount": finite_xy_count,
            "coordinateDimensions": dict(sorted(dimensions.items())),
            "nativeProjectedExtent": normalize_bounds(source_bounds),
            "maximumPositionsInFeature": max_feature_positions,
            "maximumRingsInFeature": max_ring_count,
            "maximumPolygonsInFeature": max_polygon_count,
            "maximumPositionsInRing": per_feature_ring_position_max,
            "maximumsWithSourceOffsets": {
                "featureByteSpan": max_feature_span_record,
                "positionsInFeature": max_feature_positions_record,
                "polygonsInFeature": max_feature_polygons_record,
                "ringsInFeature": max_feature_rings_record,
                "positionsInRing": max_ring_positions_record,
            },
            "topology": {
                "method": "Shapely native is_valid/explain_validity on unchanged source coordinates; no repair or rewrite",
                "featureCounts": {key: value for key, value in validity.items()
                                  if key in ("valid", "invalid", "not-evaluable-structure", "validation-error")},
                "invalidReasonCounts": {key: value for key, value in validity.items()
                                        if key not in ("valid", "invalid", "not-evaluable-structure", "validation-error")},
                "invalidFeatures": invalid_details,
                "notEvaluableFeatures": structure_failures,
                "validationErrors": validation_errors,
            },
            "largestFeatureSpans": top_spans,
            "largestPositionFeatures": largest_positions,
            "largestRingFeatures": largest_rings,
            "largestRingPositionFeatures": largest_ring_positions,
        },
        "properties": {
            "malformedPropertiesFeatureCount": key_stats["malformedPropertiesCount"],
            "duplicatePropertyKeyCounts": dict(sorted(key_stats["duplicatePropertyKeyCounts"].items())),
            "fields": property_profile,
            "duplicateGroups": duplicate_key_details,
            "nativeIdInterpretation": "Source property ids are attributes only; no value is promoted as an application or ULPIN identity.",
        },
        "execution": {
            "elapsedSeconds": time.perf_counter() - started,
            "peakResidentBytes": int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                                      * (1 if sys.platform == "darwin" else 1024)),
            "readerChunkBytes": reader.chunk_size,
            "positionsPerTransformBatch": 50_000,
            "network": "disabled by docker --network none and PROJ_NETWORK=OFF",
            "sourceBytesRewritten": False,
            "geometryRepaired": False,
            "providerCalls": False,
        },
        "limitations": [
            "This profile records source structure and native topology only; it establishes no legal boundary correctness, currentness, survey accuracy, or positional accuracy.",
            "The inverse round-trip residual measures numerical behavior of the selected CRS operation, not the accuracy of the NWIC/GSI coordinates.",
            "The profile does not qualify semantic ingestion, publication, tiles, GF-STREAM, GF-SCALE, runtime budgets, or DATA qualification.",
            "Source attributes and geometries are not parcel identifiers, ownership evidence, building facts, or vertical measurements.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temp = args.output.with_suffix(args.output.suffix + ".tmp")
    temp.write_text(json.dumps(profile, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    os.replace(temp, args.output)
    print(json.dumps({
        "profile": str(args.output), "sourceBytes": input_bytes, "sourceSha256": input_hash,
        "features": feature_count, "positions": raw_position_count,
        "elapsedSeconds": profile["execution"]["elapsedSeconds"],
        "peakResidentBytes": profile["execution"]["peakResidentBytes"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ProfileError as exc:
        print(f"profile error: {exc}", file=sys.stderr)
        raise SystemExit(2)
