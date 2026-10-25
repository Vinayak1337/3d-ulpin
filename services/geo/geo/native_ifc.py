"""Source-native IFC metadata and storey plan outlines using pinned IfcOpenShell.

Call through desktop-ifc-read.py for the mandatory external native-process bounds.
The lexical index only supplies original-byte locators and integrity checks; IFC
schema interpretation and every decoded attribute come from IfcOpenShell.
The pass 1 structure scan is separate: it streams the STEP statements and keeps
only spatial-structure entities, their relations and the project length unit.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
import hashlib
import io
import json
import math
import re
from pathlib import Path
import tempfile
import time
from typing import NamedTuple

PARSER_VERSION = "0.8.5"


@dataclass(frozen=True)
class Limits:
    input_bytes: int = 32 * 1024**2
    entities: int = 100_000
    records: int = 10_000
    output_bytes: int = 16 * 1024**2
    memory_bytes: int = 2 * 1024**3
    seconds: float = 60
    threads: int = 2
    depth: int = 64
    # Pass 1 structure scan; IFC_LIMITS states the same entity, byte, time and output ceilings.
    structure_entities: int = 10_000
    structure_bytes: int = 32 * 1024**2
    structure_statement_bytes: int = 4 * 1024**2
    structure_output_bytes: int = 48 * 1024
    structure_seconds: float = 20
    # test_only apartment: 99,766 entities, 7,670 meshes, 276,120 triangle vertices in 8.30 s.
    # Evidence records margins against the remaining 60 s / 2 GiB reader budget.
    outline_elements: int = 100_000
    outline_vertices: int = 1_000_000
    outline_output_bytes: int = 4 * 1024**2
    outline_seconds: float = 25

    def __post_init__(self):
        if any(not math.isfinite(v) or v <= 0 for v in asdict(self).values()):
            raise ValueError("Limits must be positive and finite.")
        if any(type(v) is not int for k, v in asdict(self).items() if not k.endswith("seconds")):
            raise ValueError("Count/byte limits must be integers.")
        if "DEFAULT_LIMITS" in globals() and any(v > asdict(DEFAULT_LIMITS)[k] for k, v in asdict(self).items()):
            raise ValueError("Lane limits may only be reduced.")


DEFAULT_LIMITS = Limits()


class IFCError(ValueError):
    def __init__(self, code, message, status="malformed", locator=None):
        super().__init__(message)
        self.code, self.status, self.locator = code, status, locator

    def as_dict(self):
        return {"status": self.status, "code": self.code,
                "message": str(self), "locator": self.locator}


def fail(code, message, status="malformed", locator=None):
    raise IFCError(code, message, status, locator)


def lexical_index(raw: bytes, limits: Limits):
    """Mask strings/comments, index declarations/argument spans, check # references.

    No STEP values are decoded here. Exact literal slices supplement parser values
    so decimal spelling, $, * and escape sequences remain recoverable.
    """
    if len(raw) > limits.input_bytes:
        fail("INPUT_LIMIT", "IFC input exceeds the byte limit.", "limit")
    if not raw.startswith(b"ISO-10303-21;"):
        fail("FORMAT", "Only uncompressed IFC STEP input is supported.", "unsupported")
    masked = bytearray(raw)
    pos = 0
    while pos < len(raw):
        start = pos
        if raw[pos:pos+2] == b"/*":
            end = raw.find(b"*/", pos+2)
            if end < 0:
                fail("COMMENT", "Unterminated STEP comment.")
            pos = end + 2
        elif raw[pos] == 39:
            pos += 1
            while True:
                end = raw.find(b"'", pos)
                if end < 0:
                    fail("STRING", "Unterminated STEP string.")
                pos = end + 1
                if raw[pos:pos+1] != b"'":
                    break
                pos += 1
        else:
            pos += 1
            continue
        masked[start:pos] = b" " * (pos-start)
    if not re.search(rb"END-ISO-10303-21\s*;\s*\Z", masked):
        fail("STEP_END", "Missing STEP closing marker or trailing data.")
    definitions, starts = {}, set()
    declaration = rb"#([0-9]+)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\("
    for match in re.finditer(declaration, masked):
        ident = int(match[1])
        if ident == 0 or ident in definitions:
            fail("DUPLICATE_STEP_ID", "Invalid or duplicate STEP entity ID.", locator={"stepId": ident})
        if len(definitions) >= limits.entities:
            fail("ENTITY_LIMIT", "IFC exceeds the entity limit.", "limit")
        start, cursor, depth = match.end(), match.end(), 1
        spans = []
        while cursor < len(masked):
            char = masked[cursor]
            if char == 40:
                depth += 1
                if depth > limits.depth:
                    fail("DEPTH_LIMIT", "STEP aggregate exceeds the nesting limit.", "limit")
            elif char == 41:
                depth -= 1
                if depth == 0:
                    spans.append((start, cursor))
                    break
            elif char == 44 and depth == 1:
                spans.append((start, cursor))
                start = cursor+1
            cursor += 1
        if depth != 0 or not re.match(rb"\s*;", masked[cursor+1:cursor+128]):
            fail("ENTITY_SYNTAX", "Incomplete STEP entity declaration.", locator={"stepId": ident})
        definitions[ident] = {"type": match[2].decode("ascii"), "span": (match.start(), cursor+1), "attributes": spans,
                              "markers": [bytes(masked[a:b]).strip() for a, b in spans]}
        starts.add(match.start())
    for match in re.finditer(rb"#([0-9]+)", masked):
        if match.start() not in starts and int(match[1]) not in definitions:
            fail("DANGLING_REFERENCE", "STEP reference has no declared target.", locator={"byteStart": match.start(), "stepId": int(match[1])})
    return definitions


def check_cycles(graph, limits: Limits, kind: str):
    """Linear, iterative DFS; no recursive expansion of shared subgraphs."""
    done = set()
    for root in graph:
        if root in done:
            continue
        active = {root}
        stack = [(root, iter(graph.get(root, ())))]
        while stack:
            node, children = stack[-1]
            child = next(children, None)
            if child is None:
                stack.pop()
                active.remove(node)
                done.add(node)
            elif child in active:
                fail("CYCLE", f"Cycle in IFC {kind} links.", locator={"stepId": child})
            elif child not in done:
                if len(stack) >= limits.depth:
                    fail("DEPTH_LIMIT", f"IFC {kind} exceeds traversal depth.", "limit")
                active.add(child)
                stack.append((child, iter(graph.get(child, ()))))


SPATIAL_TYPES = {"IfcProject": None, "IfcSite": None, "IfcBuilding": "building",
                 "IfcBuildingStorey": "level", "IfcSpace": "space"}
# Every IfcNamedUnit subtype is kept, so a project length unit is either read or truly absent.
NAMED_UNITS = ("IfcSIUnit", "IfcConversionBasedUnit", "IfcConversionBasedUnitWithOffset", "IfcContextDependentUnit")
# Attribute counts and the GlobalId, Name, LongName indexes are the same in IFC2X3 and IFC4.
ARITY = {"IfcProject": 9, "IfcSite": 14, "IfcBuilding": 12, "IfcBuildingStorey": 10, "IfcSpace": 11,
         "IfcRelAggregates": 6, "IfcRelContainedInSpatialStructure": 6, "IfcUnitAssignment": 1,
         "IfcSIUnit": 4, "IfcConversionBasedUnit": 4, "IfcConversionBasedUnitWithOffset": 5,
         "IfcContextDependentUnit": 3}
STRUCTURE_TYPES = {name.upper(): name for name in ARITY}
NAMED = {"IfcProject": (0, 2, 5), "IfcSite": (0, 2, 7), "IfcBuilding": (0, 2, 7), "IfcBuildingStorey": (0, 2, 7),
         "IfcSpace": (0, 2, 7)}
STATEMENT_SPECIAL = re.compile(rb"['/;]")
HEAD_SPECIAL = re.compile(rb"['/;(]")
STATEMENT_HEAD = re.compile(rb"\s*#([0-9]+)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\Z")
STEP_VALUE = re.compile(rb"""\s*(?:'(?P<string>(?:[^']|'')*)'|\#(?P<ref>[0-9]+)|\.(?P<enum>[A-Za-z0-9_]+)\.
    |(?P<number>[-+]?[0-9]+(?:\.[0-9]*)?(?:[Ee][-+]?[0-9]+)?)|(?P<null>\$)|(?P<derived>\*)
    |(?P<typed>[A-Za-z][A-Za-z0-9_]*)\s*\(|(?P<open>\())""", re.X)
STEP_AFTER = re.compile(rb"\s*([,)])")
STEP_CLOSE = re.compile(rb"\s*\)")
STEP_ESCAPE = re.compile(r"\\X2\\((?:[0-9A-F]{4})+)\\X0\\|\\X4\\((?:[0-9A-F]{8})+)\\X0\\"
                         r"|\\X\\([0-9A-F]{2})|\\S\\(.)|\\P[A-I]\\|\\\\")


class Ref(NamedTuple):
    step_id: int


class Enum(NamedTuple):
    name: str


class Number(NamedTuple):
    value: float
    literal: str


class Typed(NamedTuple):
    name: str
    value: object


DERIVED = object()


def step_string(raw: bytes):
    """Decode a STEP string by ISO 10303-21 escapes; other bytes as UTF-8, else Latin-1."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    def escape(match):
        if match[1]:
            return bytes.fromhex(match[1]).decode("utf-16-be")
        if match[2]:
            return bytes.fromhex(match[2]).decode("utf-32-be")
        if match[3]:
            return chr(int(match[3], 16))
        if match[4]:
            return chr(ord(match[4]) + 128)
        return "\\" if match[0] == "\\\\" else ""
    try:
        return STEP_ESCAPE.sub(escape, text.replace("''", "'"))
    except (UnicodeDecodeError, ValueError):
        fail("STRUCTURE_SYNTAX", "Undecodable STEP string escape.", "unsupported")


def step_arguments(body: bytes, limits: Limits):
    """Parse one statement's parenthesised attribute list into plain values."""
    stack, names, pos = [], [], 0

    def close():
        items, name = stack.pop(), names.pop()
        if name is None:
            return items
        if len(items) != 1:
            fail("STRUCTURE_SYNTAX", "A typed STEP value holds one value.", "unsupported")
        return Typed(name.decode("ascii").upper(), items[0])
    while True:
        match = STEP_VALUE.match(body, pos)
        if match is None or (not stack and match["open"] is None):
            fail("STRUCTURE_SYNTAX", "Unreadable STEP attribute list.", "unsupported")
        pos = match.end()
        if match["open"] is not None or match["typed"] is not None:
            if len(stack) >= limits.depth:
                fail("DEPTH_LIMIT", "STEP aggregate exceeds the nesting limit.", "limit")
            stack.append([])
            names.append(match["typed"])
            empty = STEP_CLOSE.match(body, pos)
            if not empty:
                continue
            pos, value = empty.end(), close()
        elif match["string"] is not None:
            value = step_string(match["string"])
        elif match["ref"] is not None:
            value = Ref(int(match["ref"]))
        elif match["enum"] is not None:
            value = Enum(match["enum"].decode("ascii").upper())
        elif match["number"] is not None:
            literal = match["number"].decode("ascii")
            value = Number(float(literal) if re.search(r"[.Ee]", literal) else int(literal), literal)
        else:
            value = None if match["null"] is not None else DERIVED
        while True:
            if not stack:
                if body[pos:].strip():
                    fail("STRUCTURE_SYNTAX", "Trailing bytes after a STEP attribute list.", "unsupported")
                return value
            stack[-1].append(value)
            after = STEP_AFTER.match(body, pos)
            if after is None:
                fail("STRUCTURE_SYNTAX", "Unreadable STEP attribute list.", "unsupported")
            pos = after.end()
            if after[1] == b",":
                break
            value = close()


def step_statements(stream, limits: Limits, chunk=1 << 16):
    """Yield (step id, type, attribute list bytes) for structure statements, in file order.

    The stream is read in chunks; skipped statements are dropped as they are read,
    and only one kept statement is held at a time. Strings and comments are passed
    by their delimiters, and comments inside kept statements are removed.
    """
    started, buf, pos, start, wanted, total = time.monotonic(), bytearray(), 0, 0, None, 0
    step_id = entity = body_start = None
    while True:
        match = (HEAD_SPECIAL if wanted is None else STATEMENT_SPECIAL).search(buf, pos)
        found = match.start() if match else None
        if found is not None and buf[found] == 39:
            close = found + 1
            while (close := buf.find(b"'", close)) >= 0 and buf[close+1:close+2] == b"'":
                close += 2
            if close >= 0 and close + 1 < len(buf):
                pos = close + 1
                continue
            found = None
        elif found is not None and buf[found] == 47:
            if found + 1 >= len(buf):
                found = None
            elif buf[found+1] != 42:
                pos = found + 1
                continue
            elif (close := buf.find(b"*/", found + 2)) >= 0:
                if wanted is False:
                    pos = close + 2
                else:
                    del buf[found:close+2]
                    pos = found
                continue
            else:
                found = None
        elif found is not None and buf[found] == 40:
            head = STATEMENT_HEAD.match(buf, start, found + 1)
            entity = head and STRUCTURE_TYPES.get(head[2].decode("ascii").upper())
            wanted, step_id, body_start, pos = entity is not None, head and int(head[1]), found, found + 1
            continue
        elif found is not None:
            if wanted:
                yield step_id, entity, bytes(buf[body_start:found])
            if time.monotonic() - started > limits.structure_seconds:
                fail("STRUCTURE_TIME_LIMIT", "The structure scan exceeded its time ceiling.", "limit")
            del buf[:found+1]
            pos, start, wanted = 0, 0, None
            continue
        if wanted is False:
            del buf[:len(buf) if match is None else match.start()]
            pos, start = 0, 0
        if len(buf) - start > limits.structure_statement_bytes:
            fail("STRUCTURE_STATEMENT_LIMIT", "A structure statement exceeds its byte ceiling.", "limit")
        data = stream.read(chunk)
        if not data:
            if wanted is not None or buf[start:].strip():
                fail("STRUCTURE_SYNTAX", "The IFC ends inside a STEP statement.", "unsupported")
            return
        total += len(data)
        if total > limits.structure_bytes:
            fail("STRUCTURE_INPUT_LIMIT", "The IFC exceeds the structure scan byte ceiling.", "limit")
        buf.extend(data)


def stated_elevation(value):
    value = value.value if isinstance(value, Typed) else value
    if value is None:
        return {"state": "absent"}
    if not isinstance(value, Number) or not math.isfinite(value.value) or len(value.literal) > 64:
        fail("STRUCTURE_SYNTAX", "Storey elevation is not a stated number.", "unsupported")
    return {"state": "supplied", "value": value.value, "literal": value.literal}


def stated_text(value):
    value = value.value if isinstance(value, Typed) else value
    if value is not None and not isinstance(value, str):
        fail("STRUCTURE_SYNTAX", "A structure label is not a STEP string.", "unsupported")
    return value


def stated_enum(value):
    if value is not None and not isinstance(value, Enum):
        fail("STRUCTURE_SYNTAX", "A unit prefix or name is not a STEP enumeration.", "unsupported")
    return value and value.name


def length_unit(projects, assignments, units):
    """The project's stated length unit, copied as stated; never converted or assumed."""
    stated = set()
    for project in projects:
        assignment = assignments.get(project["unitsStepId"])
        stated.update(ref for ref in (assignment or ()) if ref in units)
    if not stated:
        return {"state": "absent"}
    if len(stated) > 1:
        return {"state": "conflicting", "stepIds": sorted(stated)}
    return {"state": "supplied", **units[stated.pop()]}


def scan_structure(stream, limits: Limits = DEFAULT_LIMITS):
    """Pass 1: building, storeys and spaces with their relations, read as stated; no geometry."""
    nodes, relations, projects, assignments, units, kept = {}, [], [], {}, {}, 0
    for step_id, entity, body in step_statements(stream, limits):
        kept += 1
        if kept > limits.structure_entities:
            fail("STRUCTURE_ENTITY_LIMIT", "The IFC holds more structure entities than the scan keeps.", "limit")
        values = step_arguments(body, limits)
        if len(values) != ARITY[entity]:
            fail("STRUCTURE_SYNTAX", "A structure entity has an unexpected attribute count.", "unsupported")
        if entity in NAMED:
            global_id, name, long_name = (stated_text(values[i]) for i in NAMED[entity])
            node = {"stepId": step_id, "entityType": entity, "candidate": SPATIAL_TYPES[entity],
                    "globalId": global_id, "name": name, "longName": long_name,
                    "parentStepIds": set(), "relationStepIds": set()}
            if entity == "IfcBuildingStorey":
                node["elevation"] = stated_elevation(values[9])
            if entity == "IfcProject":
                projects.append({"unitsStepId": values[8].step_id if isinstance(values[8], Ref) else None})
            nodes[step_id] = node
        elif entity == "IfcUnitAssignment":
            listed = values[0] if isinstance(values[0], list) else []
            assignments[step_id] = [v.step_id for v in listed if isinstance(v, Ref)]
        elif entity in NAMED_UNITS:
            if values[1] == Enum("LENGTHUNIT"):
                si = entity == "IfcSIUnit"
                units[step_id] = {"stepId": step_id, "entityType": entity,
                                  "prefix": stated_enum(values[2]) if si else None,
                                  "name": stated_enum(values[3]) if si else stated_text(values[2])}
        else:
            contained = entity == "IfcRelContainedInSpatialStructure"
            parent, children = (values[5], values[4]) if contained else (values[4], values[5])
            if isinstance(parent, Ref) and isinstance(children, list):
                relations.append((step_id, parent.step_id, [v.step_id for v in children if isinstance(v, Ref)]))
    for step_id, parent, children in relations:
        if parent in nodes:
            for child in children:
                if child in nodes:
                    nodes[child]["parentStepIds"].add(parent)
                    nodes[child]["relationStepIds"].add(step_id)
    for node in nodes.values():
        node["parentStepIds"], node["relationStepIds"] = sorted(node["parentStepIds"]), sorted(node["relationStepIds"])
    structure = {"state": "read", "lengthUnit": length_unit(projects, assignments, units),
                 "nodes": [nodes[k] for k in sorted(nodes)]}
    size = len(json.dumps(structure, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
    if size > limits.structure_output_bytes:
        fail("STRUCTURE_OUTPUT_LIMIT", "The structure exceeds its bounded output.", "limit")
    return structure


def structure_or_reason(raw: bytes, limits: Limits):
    """A file above a structure ceiling keeps its metadata and states why the structure was not read."""
    try:
        return scan_structure(io.BytesIO(raw), limits)
    except IFCError as error:
        return {"state": "not_read", "code": error.code, "reason": str(error)}


def outline_rounding(model) -> dict:
    contexts = model.by_type("IfcGeometricRepresentationContext", include_subtypes=False)
    precisions = [c.Precision for c in contexts]
    if not precisions or any(p is None or not math.isfinite(p) or p <= 0 for p in precisions):
        fail("OUTLINE_PRECISION_UNSTATED", "A positive plan precision is not stated in every context.")
    precision = max(precisions)
    return {"decimalPlaces": -math.ceil(math.log10(precision)), "sourcePrecision": precision,
            "contextStepIds": sorted(c.id() for c in contexts),
            "method": "decimal_rounding_not_finer_than_context_precision"}


def outline_polygons(geometry, places: int) -> list:
    from shapely import set_precision
    from shapely.geometry import Polygon

    # Topology-aware rounding avoids ring crossings caused by rounding each coordinate in isolation.
    geometry = set_precision(geometry, 10.0 ** -places)

    def ring(coords):
        points = []
        for x, y in coords:
            if not math.isfinite(x) or not math.isfinite(y):
                fail("OUTLINE_GEOMETRY", "A plan coordinate is not finite.")
            point = [round(x, places), round(y, places)]
            if not points or point != points[-1]:
                points.append(point)
        return points

    polygons = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
    result = []
    for polygon in polygons:
        exterior = ring(polygon.exterior.coords)
        interiors = [ring(r.coords) for r in polygon.interiors]
        rounded = Polygon(exterior, interiors)
        if rounded.is_empty or not rounded.is_valid or rounded.area <= 0:
            fail("OUTLINE_GEOMETRY", "A rounded plan polygon is empty or invalid.")
        result.append({"exterior": exterior, "interiors": interiors})
    if not result:
        fail("OUTLINE_GEOMETRY", "No polygon could be read from the selected elements.")
    return result


def outline_triangles(settings, elements: dict, limits: Limits, counts: dict, check_time) -> list:
    import ifcopenshell.geom
    from shapely.geometry import Polygon
    triangles = []
    for ident in sorted(elements):
        counts["elements"] += 1
        if counts["elements"] > limits.outline_elements:
            fail("OUTLINE_ELEMENT_LIMIT", "Too many elements to mesh for storey outlines.", "limit")
        check_time()
        shape = ifcopenshell.geom.create_shape(settings, elements[ident])
        check_time()
        vertices, faces = shape.geometry.verts, shape.geometry.faces
        if counts["vertices"] + max(len(faces), len(vertices) // 3) > limits.outline_vertices:
            fail("OUTLINE_VERTEX_LIMIT", "Storey meshes exceed the triangle vertex ceiling.", "limit")
        counts["vertices"] += len(faces)
        for i in range(0, len(faces), 3):
            check_time()
            triangle = Polygon([(vertices[faces[k]*3], vertices[faces[k]*3+1]) for k in range(i, i+3)])
            if triangle.area == 0:
                continue  # Vertical triangles project to lines, not plan area.
            if not triangle.is_valid:
                fail("OUTLINE_GEOMETRY", "A projected triangle is invalid.")
            triangles.append(triangle)
    return triangles


def read_storey_outlines(model, structure: dict, limits: Limits, check_time) -> dict:
    import ifcopenshell.geom
    from shapely.ops import unary_union
    check_time()
    unit = structure["lengthUnit"]
    if unit["state"] != "supplied" or unit["entityType"] not in ("IfcSIUnit", "IfcConversionBasedUnit"):
        fail("OUTLINE_LENGTH_UNIT", "The file does not state one supported length unit.")
    rounding = outline_rounding(model)
    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    # IfcOpenShell 0.8.5 convert-back-units stops the default conversion to metres.
    # World placements are IFC-local only; no IfcMapConversion/global transform is applied.
    settings.set("convert-back-units", True)
    result = {"state": "read", "frame": "source_local", "globalTransformApplied": False,
              "lengthUnit": unit, "rounding": rounding, "storeys": [], "withoutOutline": []}
    counts = {"elements": 0, "vertices": 0}
    for storey in sorted(model.by_type("IfcBuildingStorey"), key=lambda e: e.id()):
        check_time()
        slabs = {e.id(): e for r in storey.ContainsElements for e in r.RelatedElements if e.is_a("IfcSlab")}
        spaces = {e.id(): e for r in storey.IsDecomposedBy if r.is_a("IfcRelAggregates")
                  for e in r.RelatedObjects if e.is_a("IfcSpace")}
        elements = slabs or spaces
        if not elements:
            result["withoutOutline"].append({"stepId": storey.id(), "reason": "no_slab_or_space"})
            continue
        triangles = outline_triangles(settings, elements, limits, counts, check_time)
        rings = outline_polygons(unary_union(triangles), rounding["decimalPlaces"])
        check_time()
        result["storeys"].append({"stepId": storey.id(), "elementSource": "IfcSlab" if slabs else "IfcSpace",
                                  "elementStepIds": sorted(elements), "polygons": rings})
    size = len(json.dumps(result, ensure_ascii=True, allow_nan=False, separators=(",", ":")))
    if size > limits.outline_output_bytes:
        fail("OUTLINE_OUTPUT_LIMIT", "Storey outlines exceed their output byte ceiling.", "limit")
    check_time()
    return result


def storey_outlines(model, structure: dict, limits: Limits) -> dict:
    """Pass 2 is all-or-nothing; native calls also retain the external worker's hard bounds."""
    if structure["state"] != "read":
        return {"state": "not_read", "code": "OUTLINE_STRUCTURE_NOT_READ",
                "reason": "Storey outlines require a read structure."}
    started = time.monotonic()

    def check_time():
        if time.monotonic() - started > limits.outline_seconds:
            fail("OUTLINE_TIME_LIMIT", "The storey outline pass exceeded its time ceiling.", "limit")

    try:
        return read_storey_outlines(model, structure, limits, check_time)
    except IFCError as error:
        return {"state": "not_read", "code": error.code, "reason": str(error)}
    except Exception:
        return {"state": "not_read", "code": "OUTLINE_GEOMETRY", "reason": "Storey plan geometry could not be read."}


def extract(raw: bytes, limits: Limits = DEFAULT_LIMITS):
    """Runs only inside an externally bounded worker; preserves original values."""
    index = lexical_index(raw, limits)
    try:
        import ifcopenshell
    except ImportError:
        fail("PARSER_UNAVAILABLE", "Install the lane's pinned parser environment.", "unavailable")
    if ifcopenshell.version != PARSER_VERSION:
        fail("PARSER_VERSION", "Unexpected IfcOpenShell version.", "unavailable")
    # Admission check only, not schema interpretation: unknown declared schemas
    # should be unsupported even if the installed native parser cannot open them.
    declared = re.search(rb"(?im)^\s*FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'\s*\)\s*\)\s*;", raw)
    if declared and declared[1].decode("ascii", errors="replace").upper() not in ("IFC2X3", "IFC4"):
        fail("SCHEMA", "This profile supports IFC2X3 and IFC4 only.", "unsupported")
    try:
        # Give the native parser exact bytes, without a Python text transcoding.
        ifcopenshell.get_log()
        with tempfile.TemporaryDirectory(prefix="ulpin-ifc-parser-") as directory:
            original = Path(directory)/"original.ifc"
            original.write_bytes(raw)
            model = ifcopenshell.open(str(original))
    except Exception:
        fail("PARSER_REJECTED", "IfcOpenShell rejected this IFC STEP input.")
    schema = model.schema_identifier
    if schema not in ("IFC2X3", "IFC4"):
        fail("SCHEMA", "This profile supports IFC2X3 and IFC4 only.", "unsupported")
    parser_diagnostics = bool(ifcopenshell.get_log().strip())
    entities = {e.id(): e for e in model}
    if entities.keys() != index.keys():
        fail("PARSER_ENTITY_LOSS", "Parser entities differ from the source declarations.")

    def locator(e, name=None, idx=None):
        span = index[e.id()]["span"] if idx is None else index[e.id()]["attributes"][idx]
        return {"stepId": e.id(), "entityType": e.is_a(), "attribute": name,
                "attributeIndex": idx, "byteStart": span[0], "byteEnd": span[1]}

    def decoded(value, depth=0):
        if depth > limits.depth:
            fail("DEPTH_LIMIT", "Attribute aggregate exceeds the nesting limit.", "limit")
        if isinstance(value, ifcopenshell.entity_instance):
            if value.id():
                if value.id() not in entities:
                    fail("DANGLING_REFERENCE", "Parsed reference has no source target.")
                return {"stepId": value.id(), "entityType": value.is_a()}
            return {"valueType": value.is_a(), "value": decoded(value.wrappedValue, depth+1)}
        if isinstance(value, (tuple, list)):
            return [decoded(v, depth+1) for v in value]
        if isinstance(value, float) and not math.isfinite(value):
            fail("NONFINITE", "Nonfinite IFC numeric value is unsupported.")
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        fail("VALUE_TYPE", "Unsupported parser attribute type.", "unsupported")

    # Inspect all declarations so malformed references/identities outside selected
    # spatial objects do not disappear silently. Values still come from parser.
    identities = {}
    from ifcopenshell.validate import assert_valid, ValidationError
    schema_definition = ifcopenshell.ifcopenshell_wrapper.schema_by_name(schema)
    declarations = {}
    for ident, e in entities.items():
        if e.is_a().upper() != index[ident]["type"] or len(e) != len(index[ident]["attributes"]):
            fail("PARSER_STRUCTURE", "Parser type/attribute count differs from source.", locator=locator(e))
        for i, value in enumerate(e):
            start, end = index[ident]["attributes"][i]
            token = index[ident]["markers"][i]
            if value is None and token not in (b"$", b"*"):
                fail("PARSER_VALUE_LOSS", "Parser lost a supplied attribute.", locator=locator(e, e.attribute_name(i), i))
            if value is not None and token != b"*":
                if e.is_a() not in declarations:
                    declarations[e.is_a()] = schema_definition.declaration_by_name(e.is_a()).all_attributes()
                declaration = declarations[e.is_a()]
                try:
                    assert_valid(declaration[i].type_of_attribute(), value, schema_definition)
                    decoded(value)  # finite values and bounded nested references
                except ValidationError:
                    fail("ATTRIBUTE_TYPE", "Attribute value/reference does not match the IFC schema type.", locator=locator(e, e.attribute_name(i), i))
        if e.is_a("IfcRoot") and e.GlobalId is not None:
            if e.GlobalId in identities:
                fail("DUPLICATE_GLOBAL_ID", "Duplicate IFC GlobalId in this source.", locator=locator(e, "GlobalId", 0))
            identities[e.GlobalId] = ident
    if parser_diagnostics:
        fail("PARSER_DIAGNOSTIC", "Parser reported diagnostics; no lossy projection is published.")

    relations = [e for e in entities.values() if e.is_a("IfcRelAggregates") or e.is_a("IfcRelNests") or e.is_a("IfcRelContainedInSpatialStructure")]
    decomposition, containment, placements = {}, {}, {}
    for e in relations:
        if e.is_a("IfcRelContainedInSpatialStructure"):
            parent, children = e.RelatingStructure, e.RelatedElements
            graph = containment
        else:
            parent, children = e.RelatingObject, e.RelatedObjects
            graph = decomposition
        if parent is None or not children:
            fail("RELATION_ENDPOINT", "Spatial relationship has missing endpoints.", locator=locator(e))
        graph.setdefault(parent.id(), set()).update(c.id() for c in children)
    for e in model.by_type("IfcLocalPlacement"):
        if e.PlacementRelTo is not None:
            placements[e.id()] = [e.PlacementRelTo.id()]
    combined = {k: set(v) for k, v in decomposition.items()}
    for parent, children in containment.items():
        combined.setdefault(parent, set()).update(children)
    for graph, kind in ((combined, "spatial hierarchy"), (placements, "placement")):
        check_cycles(graph, limits, kind)

    projected = {}

    def record(e):
        if e.id() in projected:
            return
        if len(projected) >= limits.records:
            fail("RECORD_LIMIT", "IFC projection exceeds the record limit.", "limit")
        fields = {}
        for i, value in enumerate(e):
            name = e.attribute_name(i)
            start, end = index[e.id()]["attributes"][i]
            literal = raw[start:end].decode("latin-1")
            token = index[e.id()]["markers"][i]
            state = "null" if token == b"$" else "unsupported" if token == b"*" else "supplied"
            fields[name] = {"state": state, "value": decoded(value), "rawLiteral": literal, "locator": locator(e, name, i)}
            if token == b"*":
                fields[name]["reason"] = "derived_attribute_not_evaluated"
        if e.is_a("IfcBuilding") or e.is_a("IfcBuildingStorey") or e.is_a("IfcSpace"):
            for name in ("GlobalId", "Name", "LongName", "Elevation", "ObjectPlacement", "Representation"):
                if name not in fields:
                    fields[name] = {"state": "absent", "value": None, "rawLiteral": None,
                                    "locator": {"stepId": e.id(), "attribute": name}, "reason": "not_in_schema_entity"}
        projected[e.id()] = {"stepId": e.id(), "entityType": e.is_a(), "locator": locator(e), "attributes": fields}

    def graph_records(roots, allowed):
        queue = [(e, 0) for e in roots if e is not None]
        seen = set()
        edges = {}
        while queue:
            e, depth = queue.pop()
            if e.id() in seen:
                continue
            if depth > limits.depth:
                fail("DEPTH_LIMIT", "Metadata graph exceeds the depth limit.", "limit")
            seen.add(e.id())
            if not allowed(e):
                continue
            record(e)
            for value in e:
                values = value if isinstance(value, tuple) else (value,)
                for ref in values:
                    if isinstance(ref, ifcopenshell.entity_instance) and ref.id():
                        queue.append((ref, depth+1))
                        if allowed(ref):
                            edges.setdefault(e.id(), set()).add(ref.id())
        check_cycles(edges, limits, "metadata")

    spatial = [e for e in entities.values() if e.is_a("IfcProject") or e.is_a("IfcSite") or e.is_a("IfcBuilding") or e.is_a("IfcBuildingStorey") or e.is_a("IfcSpace")]
    for e in (*spatial, *relations):
        record(e)
    units = [p.UnitsInContext for p in model.by_type("IfcProject") if p.UnitsInContext is not None]
    graph_records(units, lambda e: e.is_a() in ("IfcUnitAssignment", "IfcMeasureWithUnit", "IfcDimensionalExponents") or e.is_a("IfcNamedUnit") or e.is_a("IfcDerivedUnit") or e.is_a("IfcDerivedUnitElement") or e.is_a("IfcMonetaryUnit"))
    graph_records([getattr(e, "ObjectPlacement", None) for e in spatial], lambda e: e.is_a("IfcObjectPlacement") or e.is_a() in ("IfcAxis2Placement3D", "IfcAxis2Placement2D", "IfcCartesianPoint", "IfcDirection"))
    geo = [e for e in entities.values() if e.is_a() in ("IfcMapConversion", "IfcProjectedCRS", "IfcGeometricRepresentationContext", "IfcGeometricRepresentationSubContext")]
    geo_ids = {e.id() for e in geo}
    graph_records(geo, lambda e: e.id() in geo_ids or e.is_a("IfcNamedUnit") or e.is_a() in ("IfcAxis2Placement3D", "IfcAxis2Placement2D", "IfcCartesianPoint", "IfcDirection"))
    unknown_placement = [e.id() for e in entities.values() if e.is_a("IfcObjectPlacement") and not e.is_a("IfcLocalPlacement")]
    referenced_units = [p.id() for p in model.by_type("IfcProject") if p.UnitsInContext is None]
    result = {
        "schemaVersion": "ulpin-native-ifc/1", "status": "available", "scope": "source_native_metadata",
        "source": {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "schema": schema,
                   "locatorConvention": "zero-based byte spans [start,end); STEP ID and schema attribute index",
                   "literalEncoding": "latin-1 reversible byte mapping; decoded values from IfcOpenShell"},
        "parser": {"name": "IfcOpenShell", "version": ifcopenshell.version}, "limits": asdict(limits),
        "counts": {"sourceEntities": len(entities), "projectedRecords": len(projected),
                   "sourceEntityTypes": dict(sorted(Counter(e.is_a() for e in entities.values()).items()))},
        "records": [projected[k] for k in sorted(projected)],
        "structure": structure_or_reason(raw, limits),
        "projectUnits": [{"projectStepId": p.id(), "unitAssignmentStepId": p.UnitsInContext.id() if p.UnitsInContext else None,
                          "state": "supplied" if p.UnitsInContext else "null"} for p in model.by_type("IfcProject")],
        "georeference": {"state": "supplied_unqualified" if any(e.is_a() == "IfcMapConversion" for e in geo) else "missing_or_unqualified",
                         "inspectionFrame": "source_local", "globalTransformApplied": False,
                         "mapConversionStepIds": [e.id() for e in geo if e.is_a() == "IfcMapConversion"]},
        "findings": [{"code": "GEOMETRY_NOT_INTERPRETED", "status": "unsupported",
                      "message": "Only storey plan outlines in the file's own frame are produced; "
                                 "no measurement is produced."},
                     {"code": "GLOBAL_PLACEMENT_NOT_QUALIFIED", "status": "not_assessed", "message": "Supplied reference fields do not qualify global placement; inspect in the source-local frame."}],
        "semantics": {"storeysAreLegalUnits": False, "rights": "not_assessed", "propertyRegistration": "not_assessed",
                      "unitConversionApplied": False, "unprojectedContent": "retained_in_unchanged_original"},
    }
    if unknown_placement:
        result["findings"].append({"code": "PLACEMENT_UNSUPPORTED", "status": "unsupported", "stepIds": unknown_placement})
    if referenced_units:
        result["findings"].append({"code": "PROJECT_UNITS_MISSING", "status": "needs_input", "stepIds": referenced_units})
    result["storeyOutlines"] = storey_outlines(model, result["structure"], limits)
    if result["storeyOutlines"]["state"] == "read":
        try:
            encode_result(result, limits)
        except IFCError as error:
            if error.code != "OUTPUT_LIMIT":
                raise
            result["storeyOutlines"] = {"state": "not_read", "code": "OUTLINE_OUTPUT_LIMIT",
                                       "reason": "Storey outlines exceed the remaining artifact byte budget."}
    return result


def encode_result(result, limits=DEFAULT_LIMITS):
    encoded = bytearray()
    for piece in json.JSONEncoder(ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":")).iterencode(result):
        data = piece.encode("utf-8")
        if len(encoded) + len(data) + 1 > limits.output_bytes:
            fail("OUTPUT_LIMIT", "IFC projection exceeds the output byte limit.", "limit")
        encoded.extend(data)
    return bytes(encoded) + b"\n"
