"""Source-native IFC metadata projection using pinned IfcOpenShell, without geometry.

Call through desktop-ifc-read.py for the mandatory external native-process bounds.
The lexical index only supplies original-byte locators and integrity checks; IFC
schema interpretation and every decoded attribute come from IfcOpenShell.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
import hashlib
import json
import math
import re
from pathlib import Path
import tempfile

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

    def __post_init__(self):
        if any(not math.isfinite(v) or v <= 0 for v in asdict(self).values()):
            raise ValueError("Limits must be positive and finite.")
        if any(type(v) is not int for k, v in asdict(self).items() if k != "seconds"):
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
        "projectUnits": [{"projectStepId": p.id(), "unitAssignmentStepId": p.UnitsInContext.id() if p.UnitsInContext else None,
                          "state": "supplied" if p.UnitsInContext else "null"} for p in model.by_type("IfcProject")],
        "georeference": {"state": "supplied_unqualified" if any(e.is_a() == "IfcMapConversion" for e in geo) else "missing_or_unqualified",
                         "inspectionFrame": "source_local", "globalTransformApplied": False,
                         "mapConversionStepIds": [e.id() for e in geo if e.is_a() == "IfcMapConversion"]},
        "findings": [{"code": "GEOMETRY_NOT_INTERPRETED", "status": "unsupported", "message": "Representation references and type inventory retained; no geometry, tessellation or measurement is produced."},
                     {"code": "GLOBAL_PLACEMENT_NOT_QUALIFIED", "status": "not_assessed", "message": "Supplied reference fields do not qualify global placement; inspect in the source-local frame."}],
        "semantics": {"storeysAreLegalUnits": False, "rights": "not_assessed", "propertyRegistration": "not_assessed",
                      "unitConversionApplied": False, "unprojectedContent": "retained_in_unchanged_original"},
    }
    if unknown_placement:
        result["findings"].append({"code": "PLACEMENT_UNSUPPORTED", "status": "unsupported", "stepIds": unknown_placement})
    if referenced_units:
        result["findings"].append({"code": "PROJECT_UNITS_MISSING", "status": "needs_input", "stepIds": referenced_units})
    return result


def encode_result(result, limits=DEFAULT_LIMITS):
    encoded = bytearray()
    for piece in json.JSONEncoder(ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":")).iterencode(result):
        data = piece.encode("utf-8")
        if len(encoded) + len(data) + 1 > limits.output_bytes:
            fail("OUTPUT_LIMIT", "IFC projection exceeds the output byte limit.", "limit")
        encoded.extend(data)
    return bytes(encoded) + b"\n"
