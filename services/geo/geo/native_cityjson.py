"""Bounded, loss-aware source reader; no registry, mesh or CRS conversion.

The parsed source document is retained verbatim at the JSON-value level. All
projections refer into it with RFC 6901 pointers and bind to the original SHA.
Supported means structural reading of Solid/MultiSurface, never solid validity.
"""
from __future__ import annotations

import hashlib
import json
import math
import time

MAX_INPUT_BYTES = 8 * 1024 * 1024
MAX_OBJECTS = 1000
MAX_VERTICES = 100000
MAX_BOUNDARY_INDICES = 500000
MAX_DEPTH = 64
MAX_NODES = 1000000
MAX_OUTPUT_BYTES = 32 * 1024 * 1024
MAX_SECONDS = 15


class CityJSONError(ValueError):
    def __init__(self, status: str, code: str, pointer: str, message: str):
        super().__init__(message)
        self.status, self.code, self.pointer = status, code, pointer

    def as_dict(self):
        return {"status": self.status, "code": self.code,
                "pointer": self.pointer, "message": str(self)}


def _fail(code, pointer, message, status="malformed"):
    raise CityJSONError(status, code, pointer, message)


def _pointer(parent, key):
    return parent + "/" + str(key).replace("~", "~0").replace("/", "~1")


class _Budget:
    def __init__(self):
        self.deadline = time.monotonic() + MAX_SECONDS
        self.indices = 0

    def check(self):
        if time.monotonic() > self.deadline:
            _fail("TIME_LIMIT", "", "CityJSON reader exceeded its time limit.", "limit")


def _preflight(raw, budget):
    # Bound JSON nesting before the standard-library decoder allocates a tree.
    depth, string, escape = 0, False, False
    for offset, byte in enumerate(raw):
        if offset % 4096 == 0:
            budget.check()
        if string:
            if escape:
                escape = False
            elif byte == 92:
                escape = True
            elif byte == 34:
                string = False
        elif byte == 34:
            string = True
        elif byte in (91, 123):
            depth += 1
            if depth > MAX_DEPTH:
                _fail("DEPTH_LIMIT", "", "JSON nesting exceeds the reader limit.", "limit")
        elif byte in (93, 125):
            depth -= 1


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail("DUPLICATE_KEY", "", "Duplicate JSON keys are not accepted.")
        result[key] = value
    return result


def _number(value, pointer):
    if type(value) not in (int, float):
        _fail("NUMBER", pointer, "Expected a finite numeric coordinate.")
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        _fail("NONFINITE_NUMBER", pointer, "Nonfinite numbers are not accepted.")
    return value


def _tree_check(root, budget):
    stack, count = [(root, "", 0)], 0
    while stack:
        value, pointer, depth = stack.pop()
        count += 1
        if count % 1024 == 0:
            budget.check()
        if count > MAX_NODES or depth > MAX_DEPTH:
            _fail("TREE_LIMIT", pointer, "JSON tree exceeds the reader limit.", "limit")
        if isinstance(value, dict):
            if count + len(stack) + len(value) > MAX_NODES:
                _fail("TREE_LIMIT", pointer, "JSON tree exceeds the reader limit.", "limit")
            for key in value:
                try:
                    key.encode("utf-8")
                except UnicodeEncodeError:
                    _fail("UNICODE", pointer, "Unpaired Unicode surrogate in a key is not accepted.")
            stack.extend((v, _pointer(pointer, k), depth + 1) for k, v in value.items())
        elif isinstance(value, list):
            if count + len(stack) + len(value) > MAX_NODES:
                _fail("TREE_LIMIT", pointer, "JSON tree exceeds the reader limit.", "limit")
            stack.extend((v, _pointer(pointer, i), depth + 1) for i, v in enumerate(value))
        elif isinstance(value, float):
            _number(value, pointer)
        elif isinstance(value, str):
            # Escaped lone surrogates cannot be emitted as interoperable UTF-8.
            try:
                value.encode("utf-8")
            except UnicodeEncodeError:
                _fail("UNICODE", pointer, "Unpaired Unicode surrogate is not accepted.")


def _array(value, pointer, *, nonempty=False):
    if not isinstance(value, list) or (nonempty and not value):
        _fail("ARRAY", pointer, "Expected a" + (" nonempty" if nonempty else "") + " array.")
    return value


def _index(value, pointer, maximum, budget):
    budget.indices += 1
    if budget.indices > MAX_BOUNDARY_INDICES:
        _fail("BOUNDARY_LIMIT", pointer, "Boundary index count exceeds the limit.", "limit")
    if type(value) is not int or not 0 <= value < maximum:
        _fail("VERTEX_INDEX", pointer, "Boundary index must be an integer in the vertex range.")


def _unsupported_boundaries(value, pointer, maximum, budget):
    # Unknown geometry remains opaque; never flatten it into supported faces.
    # If supplied, its boundary tree must still have valid integer leaves.
    stack = [(value, pointer)]
    while stack:
        item, location = stack.pop()
        budget.check()
        if isinstance(item, list):
            stack.extend((v, _pointer(location, i)) for i, v in enumerate(item))
        else:
            _index(item, location, maximum, budget)


def _geometry(geometry, pointer, vertex_count, budget):
    if not isinstance(geometry, dict) or not isinstance(geometry.get("type"), str):
        _fail("GEOMETRY", pointer, "Geometry requires a string type.")
    kind = geometry["type"]
    projection = {"pointer": pointer, "type": kind,
                  "lodState": "present" if "lod" in geometry else "absent"}
    if "lod" in geometry:
        projection["lod"] = geometry["lod"]
    if kind not in ("Solid", "MultiSurface"):
        if "boundaries" in geometry:
            _unsupported_boundaries(geometry["boundaries"], pointer + "/boundaries", vertex_count, budget)
        return {**projection, "status": "unsupported", "reason": "GEOMETRY_TYPE",
                "message": "Geometry retained at its source pointer; no interpretation performed."}
    boundaries = _array(geometry.get("boundaries"), pointer + "/boundaries", nonempty=True)
    shells = boundaries if kind == "Solid" else [boundaries]
    semantics = geometry.get("semantics")
    semantic_surfaces = None
    values = None
    if "semantics" in geometry:
        if not isinstance(semantics, dict):
            _fail("SEMANTICS", pointer + "/semantics", "Semantics must be an object when supplied.")
        semantic_surfaces = _array(semantics.get("surfaces"), pointer + "/semantics/surfaces")
        for i, surface in enumerate(semantic_surfaces):
            if not isinstance(surface, dict) or not isinstance(surface.get("type"), str):
                _fail("SEMANTIC_SURFACE", f"{pointer}/semantics/surfaces/{i}", "Semantic surface requires a string type.")
        values = _array(semantics.get("values"), pointer + "/semantics/values")
        if len(values) != len(boundaries):
            _fail("SEMANTIC_SHAPE", pointer + "/semantics/values", "Semantic values must match boundary nesting.")
    faces = []
    holes = 0
    for shell_index, shell in enumerate(shells):
        shell_pointer = pointer + "/boundaries" + (f"/{shell_index}" if kind == "Solid" else "")
        _array(shell, shell_pointer, nonempty=True)
        shell_values = values[shell_index] if values is not None and kind == "Solid" else values
        if shell_values is not None:
            _array(shell_values, pointer + "/semantics/values")
            if len(shell_values) != len(shell):
                _fail("SEMANTIC_SHAPE", pointer + "/semantics/values", "Semantic values must match each shell's surfaces.")
        elif values is not None:
            _fail("SEMANTIC_SHAPE", pointer + "/semantics/values", "A Solid shell requires an array of surface values.")
        for surface_index, surface in enumerate(shell):
            budget.check()
            face_pointer = _pointer(shell_pointer, surface_index)
            _array(surface, face_pointer, nonempty=True)
            ring_pointers = []
            for ring_index, ring in enumerate(surface):
                ring_pointer = _pointer(face_pointer, ring_index)
                _array(ring, ring_pointer)
                if len(ring) < 3:
                    _fail("RING", ring_pointer, "A surface ring requires at least three indices.")
                for position, index in enumerate(ring):
                    _index(index, _pointer(ring_pointer, position), vertex_count, budget)
                ring_pointers.append(ring_pointer)
            holes += len(surface) - 1
            face = {"pointer": face_pointer, "ringPointers": ring_pointers,
                    "semanticState": "absent" if values is None else "present"}
            if shell_values is not None:
                value = shell_values[surface_index]
                value_pointer = pointer + "/semantics/values" + (f"/{shell_index}" if kind == "Solid" else "") + f"/{surface_index}"
                face["semanticValuePointer"] = value_pointer
                face["semanticValue"] = value
                if value is None:
                    face["semanticState"] = "null"
                elif type(value) is not int or not 0 <= value < len(semantic_surfaces):
                    _fail("SEMANTIC_INDEX", value_pointer, "Semantic value must be null or an integer surface index.")
                else:
                    face["semanticSurfacePointer"] = f"{pointer}/semantics/surfaces/{value}"
            faces.append(face)
    return {**projection, "status": "supported", "shellCount": len(shells) if kind == "Solid" else None,
            "surfaceCount": len(faces), "holeRingCount": holes, "surfaces": faces}


def read_cityjson(raw: bytes) -> dict:
    """Read UTF-8 JSON bytes or raise a pointer-bearing, recoverable error.

    No external references are fetched. A standalone CityJSONFeature can lack
    header/transform/CRS; that absence is explicit, with no inherited guesses.
    """
    budget = _Budget()
    if not isinstance(raw, bytes) or not raw:
        _fail("INPUT", "", "Expected nonempty original JSON bytes.")
    if len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_LIMIT", "", "Original exceeds 8 MiB.", "limit")
    _preflight(raw, budget)
    try:
        root = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: _fail("NONFINITE_NUMBER", "", "Nonfinite numbers are not accepted."))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        if isinstance(exc, CityJSONError):
            raise
        _fail("JSON", "", "Original is not valid bounded UTF-8 JSON.")
    _tree_check(root, budget)
    if not isinstance(root, dict):
        _fail("DOCUMENT", "", "Expected a CityJSON object.")
    if root.get("type") in ("CityJSON", "CityJSONFeature"):
        document, base, header, header_pointer = root, "", root, ""
        if root["type"] == "CityJSONFeature":
            header, header_pointer = None, None
    elif "feature" in root and "metadata" in root:
        document, base = root["feature"], "/feature"
        header, header_pointer = root["metadata"], "/metadata"
        if not isinstance(document, dict) or document.get("type") != "CityJSONFeature":
            _fail("ENVELOPE", base, "API envelope requires a CityJSONFeature.")
        if not isinstance(header, dict) or header.get("type") != "CityJSON":
            _fail("ENVELOPE", header_pointer, "API envelope requires a CityJSON metadata header.")
        if header.get("CityObjects") or header.get("vertices"):
            _fail("ENVELOPE_DATA", header_pointer, "Nonempty header geometry is unsupported; it cannot be silently ignored.", "unsupported")
    else:
        _fail("DOCUMENT_TYPE", "/type", "Supported documents are CityJSON 2.0, CityJSONFeature or the 3DBAG API envelope.", "unsupported")
    if header is not None and header.get("version") != "2.0":
        _fail("VERSION", header_pointer + "/version", "Only CityJSON 2.0 headers are supported.", "unsupported")
    if header is None and "version" in document and document["version"] != "2.0":
        _fail("VERSION", base + "/version", "Only the CityJSON 2.0 feature profile is supported.", "unsupported")
    if document["type"] == "CityJSONFeature" and not isinstance(document.get("id"), str):
        _fail("FEATURE_ID", base + "/id", "CityJSONFeature requires an exact string source ID.")
    vertices = _array(document.get("vertices"), base + "/vertices")
    if len(vertices) > MAX_VERTICES:
        _fail("VERTEX_LIMIT", base + "/vertices", "More than 100000 vertices.", "limit")
    objects = document.get("CityObjects")
    if not isinstance(objects, dict):
        _fail("OBJECTS", base + "/CityObjects", "CityObjects must be an object.")
    if len(objects) > MAX_OBJECTS:
        _fail("OBJECT_LIMIT", base + "/CityObjects", "More than 1000 CityObjects.", "limit")
    # Features do not carry their sequence header in the standard profile. If
    # a producer supplies a feature-local transform, retain and apply it only
    # when there is no conflicting envelope transform.
    transform_owner, transform_pointer = header, (header_pointer + "/transform" if header is not None else None)
    if "transform" in document and document is not header:
        if header is not None and "transform" in header and header["transform"] != document["transform"]:
            _fail("TRANSFORM_CONFLICT", base + "/transform", "Feature and header transforms conflict.")
        transform_owner, transform_pointer = document, base + "/transform"
    has_transform = transform_owner is not None and "transform" in transform_owner
    transform = transform_owner["transform"] if has_transform else None
    if has_transform:
        if not isinstance(transform, dict):
            _fail("TRANSFORM", transform_pointer, "Supplied transform must be an object.")
        for field in ("scale", "translate"):
            vector = _array(transform.get(field), transform_pointer + "/" + field)
            if len(vector) != 3:
                _fail("TRANSFORM", transform_pointer + "/" + field, "Transform vectors require three numbers.")
            for i, value in enumerate(vector):
                _number(value, f"{transform_pointer}/{field}/{i}")
    decoded = []
    for i, vertex in enumerate(vertices):
        budget.check()
        pointer = f"{base}/vertices/{i}"
        _array(vertex, pointer)
        if len(vertex) != 3:
            _fail("VERTEX", pointer, "Vertex requires three coordinates.")
        row = []
        for axis, value in enumerate(vertex):
            _number(value, _pointer(pointer, axis))
            if has_transform and type(value) is not int:
                _fail("ENCODED_VERTEX", _pointer(pointer, axis), "Transformed vertices require encoded integer coordinates.")
            try:
                number = value * transform["scale"][axis] + transform["translate"][axis] if has_transform else value
            except OverflowError:
                _fail("NONFINITE_NUMBER", pointer, "Decoded coordinate exceeds finite numeric range.")
            row.append(_number(number, _pointer(pointer, axis)))
        decoded.append(row)
    projections = []
    hierarchy_issues = []
    for object_id, item in objects.items():
        budget.check()
        pointer = _pointer(base + "/CityObjects", object_id)
        if not isinstance(item, dict) or not isinstance(item.get("type"), str):
            _fail("CITY_OBJECT", pointer, "CityObject requires a string type.")
        for field in ("parents", "children"):
            if field in item:
                links = _array(item[field], pointer + "/" + field)
                for i, linked in enumerate(links):
                    if not isinstance(linked, str):
                        _fail("HIERARCHY_ID", f"{pointer}/{field}/{i}", "Hierarchy links require exact string source IDs.")
                    if linked not in objects:
                        hierarchy_issues.append({"code": "UNRESOLVED_SOURCE_LINK", "pointer": f"{pointer}/{field}/{i}", "id": linked})
        if "attributes" in item and not isinstance(item["attributes"], dict):
            _fail("ATTRIBUTES", pointer + "/attributes", "Supplied attributes must be an object; values may be null.")
        geometries = _array(item["geometry"], pointer + "/geometry") if "geometry" in item else []
        projections.append({"id": object_id, "pointer": pointer, "type": item["type"],
                            "geometryState": "present" if "geometry" in item else "absent",
                            "geometries": [_geometry(g, f"{pointer}/geometry/{i}", len(vertices), budget) for i, g in enumerate(geometries)]})
    metadata_owner = header if header is not None else document
    metadata_base = header_pointer if header is not None else base
    metadata = metadata_owner.get("metadata")
    if "metadata" in metadata_owner and not isinstance(metadata, dict):
        _fail("METADATA", metadata_base + "/metadata", "Supplied metadata must be an object.")
    if metadata is not None and "referenceSystem" in metadata and metadata["referenceSystem"] is not None and not isinstance(metadata["referenceSystem"], str):
        _fail("REFERENCE_SYSTEM", metadata_base + "/metadata/referenceSystem", "A declared reference system must be a string or explicit null.")
    reference_state = "absent" if metadata is None or "referenceSystem" not in metadata else "null" if metadata["referenceSystem"] is None else "declared"
    result = {
        "schemaVersion": "source-native-cityjson/1", "status": "supported" if all(g["status"] == "supported" for o in projections for g in o["geometries"]) else "partial_unsupported",
        "sourceSha256": hashlib.sha256(raw).hexdigest(), "sourceBytes": len(raw),
        "sourceDocument": root, "documentPointer": base, "headerPointer": header_pointer,
        "verticesPointer": base + "/vertices", "vertexCount": len(vertices),
        "transformState": "supplied" if has_transform else "absent", "transformPointer": transform_pointer if has_transform else None,
        "coordinateMode": "supplied_transform_only" if has_transform else "source_coordinates_untransformed",
        "decodedVertices": decoded,
        "decodedBounds": {"minimum": [min(v[i] for v in decoded) for i in range(3)], "maximum": [max(v[i] for v in decoded) for i in range(3)]} if decoded else None,
        "frame": {"referenceSystemState": reference_state,
                  "referenceSystem": metadata.get("referenceSystem") if metadata else None,
                  "metadataPointer": metadata_base + "/metadata" if metadata is not None else None,
                  "verticalReferenceState": "not_interpreted",
                  "verticalMetadata": "retain_source_metadata_without_crs_lookup",
                  "globalPlacement": "not_qualified"},
        "objectCount": len(objects), "objects": projections, "hierarchyIssues": hierarchy_issues,
        "boundaryIndexCount": budget.indices,
        "qualification": {"structuralReadingOnly": True, "triangulation": "not_performed",
                          "watertightSolid": "not_qualified", "interiorFloors": "not_established_by_reader",
                          "units": "not_established_by_reader", "rights": "not_assessed"},
    }
    encode_cityjson_result(result, _budget=budget)
    return result


def encode_cityjson_result(result: dict, *, _budget=None) -> bytes:
    """Serialize with a hard output-byte ceiling and cooperative deadline."""
    budget = _budget or _Budget()
    output = bytearray()
    for i, chunk in enumerate(json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":")).iterencode(result)):
        if i % 1024 == 0:
            budget.check()
        encoded = chunk.encode("utf-8")
        if len(output) + len(encoded) > MAX_OUTPUT_BYTES:
            _fail("OUTPUT_LIMIT", "", "Reader output exceeds 32 MiB.", "limit")
        output.extend(encoded)
    budget.check()
    return bytes(output)
