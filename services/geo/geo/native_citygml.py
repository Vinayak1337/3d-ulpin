"""Bounded literal CityGML 2.0 inspection; not a GML validator or converter.

Use desktop-citygml-read.py for externally supervised, original-first reads.
Expat is imported only when extraction starts, after the CLI's process gate.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
import hashlib
import json
import math
import re

CORE = "http://www.opengis.net/citygml/2.0"
BUILDING = "http://www.opengis.net/citygml/building/2.0"
BOUNDARY_SURFACES = {"GroundSurface", "WallSurface", "RoofSurface", "ClosureSurface",
                     "OuterCeilingSurface", "OuterFloorSurface", "CeilingSurface", "FloorSurface"}
GML = "http://www.opengis.net/gml"
XLINK = "http://www.w3.org/1999/xlink"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
XML = "http://www.w3.org/XML/1998/namespace"
COORDINATES = {"pos", "posList", "lowerCorner", "upperCorner"}
REFERENCE_ATTRIBUTES = {"srsName", "srsDimension", "axisLabels", "uomLabels", "uom"}
# Other GML geometries remain literal inventory, never silently converted.
GEOMETRY = {"Envelope", "Solid", "CompositeSurface", "MultiSurface", "Polygon",
            "LinearRing", "LineString", "Point", "OrientableSurface", "Surface",
            "TriangulatedSurface", "Triangle", "MultiSolid", "MultiCurve", "Curve",
            "MultiPoint", "CompositeSolid", "CompositeCurve", "Tin", "Ring",
            "MultiGeometry", "PolyhedralSurface", "RectifiedGrid", "Grid"}
SUPPORTED_GEOMETRY = {"Envelope", "Solid", "CompositeSurface", "MultiSurface",
                      "Polygon", "LinearRing", "LineString", "Point"}
LITERAL_GML = {"name", "description", "boundedBy", "exterior", "interior", "surfaceMember",
               "baseSurface", "pointMember", "curveMember", "solidMember", "trianglePatches",
               "metaDataProperty", "EngineeringCRS", "EngineeringDatum", "CartesianCS",
               "CoordinateSystemAxis", "srsName", "scope", "usesCS", "usesAxis", "axisID",
               "axisAbbrev", "axisDirection", "csName", "usesEngineeringDatum", "datumName",
               "anchorPoint"}
ATTRIBUTE = re.compile(rb"([^\s=<>/]+)\s*=\s*([\"'])(.*?)\2", re.DOTALL)
NUMBER = re.compile(rb"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\Z")


@dataclass(frozen=True)
class Limits:
    input_bytes: int = 32 * 1024**2
    output_bytes: int = 16 * 1024**2
    memory_bytes: int = 2 * 1024**3
    seconds: float = 60
    threads: int = 2
    elements: int = 25_000
    depth: int = 64
    string_bytes: int = 64 * 1024
    coordinate_values: int = 100_000

    def __post_init__(self):
        if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in asdict(self).values()):
            raise ValueError("Limits must be positive and finite.")
        if any(type(v) is not int for k, v in asdict(self).items() if k != "seconds"):
            raise ValueError("Count/byte limits must be integers.")
        if "DEFAULT_LIMITS" in globals() and any(v > asdict(DEFAULT_LIMITS)[k] for k, v in asdict(self).items()):
            raise ValueError("Lane limits may only be reduced.")


DEFAULT_LIMITS = Limits()


class CityGMLError(ValueError):
    def __init__(self, code, message, status="malformed", locator=None):
        super().__init__(message)
        self.code, self.status, self.locator = code, status, locator

    def as_dict(self):
        return {"code": self.code, "status": self.status, "message": str(self), "locator": self.locator}


def fail(code, message, status="malformed", locator=None):
    raise CityGMLError(code, message, status, locator)


def expanded(name):
    uri, _, local = name.rpartition("|")
    return (uri, local) if uri else ("", name)


def key(uri, local):
    return f"{{{uri}}}{local}" if uri else local


def extract(raw: bytes, limits=DEFAULT_LIMITS):
    if len(raw) > limits.input_bytes:
        fail("INPUT_LIMIT", "CityGML input exceeds the byte limit.", "limit")
    # Harden before XML parsing. Only uncompressed UTF-8 XML (optional BOM).
    try:
        raw.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        fail("ENCODING", "This profile supports UTF-8 XML only.", "unsupported")
    if b"\0" in raw or not raw.lstrip(b"\xef\xbb\xbf \r\n\t").startswith(b"<"):
        fail("FORMAT", "Select uncompressed UTF-8 CityGML XML.", "unsupported")
    if b"<!DOCTYPE" in raw or b"<!ENTITY" in raw:
        fail("XML_RESOURCE_DENIED", "DTDs and entity declarations are not accepted.", "denied")
    declaration = re.match(rb"(?:\xef\xbb\xbf)?<\?xml\s+[^?]*?encoding\s*=\s*(['\"])([^'\"]+)\1", raw[:512], re.I)
    if declaration and declaration[2].lower() not in (b"utf-8", b"utf8"):
        fail("ENCODING", "Declared encoding is outside the UTF-8 profile.", "unsupported")
    from xml.parsers import expat
    if tuple(map(int, expat.EXPAT_VERSION.removeprefix("expat_").split("."))) < (2, 6, 0):
        fail("PARSER_VERSION", "Expat 2.6.0 or newer is required for bounded token parsing.", "unavailable")
    parser = expat.ParserCreate(namespace_separator="|")
    parser.buffer_text = False
    parser.SetParamEntityParsing(expat.XML_PARAM_ENTITY_PARSING_NEVER)
    nodes, stack, namespaces, references, coordinates, buildings = [], [], [], [], [], []
    building_index = {}
    identifiers, findings = {}, []
    coordinate_count = 0

    def locator(node, start=None, end=None, kind="element"):
        return {"element": node["ordinal"], "byteStart": node["locator"]["byteStart"] if start is None else start,
                "byteEnd": node["locator"]["byteEnd"] if end is None else end, "kind": kind}

    def namespace(prefix, uri):
        if len(namespaces) >= limits.elements or len((uri or "").encode()) > limits.string_bytes:
            fail("NAMESPACE_LIMIT", "Namespace declarations exceed the limit.", "limit")
        namespaces.append({"prefix": prefix, "uri": uri, "startTagByte": parser.CurrentByteIndex})

    def start(name, attributes):
        if len(nodes) >= limits.elements or len(stack) >= limits.depth:
            fail("STRUCTURE_LIMIT", "XML element/depth limit exceeded.", "limit")
        offset = parser.CurrentByteIndex
        # Bounded quote-aware lexical scan for exact attribute and element spans.
        quote, cursor = None, offset
        while cursor < min(len(raw), offset + limits.string_bytes):
            char = raw[cursor]
            if quote is not None:
                if char == quote:
                    quote = None
            elif char in (34, 39):
                quote = char
            elif char == 62:
                break
            cursor += 1
        else:
            fail("STRING_LIMIT", "XML start tag exceeds the string limit.", "limit")
        tag_end = cursor + 1
        uri, local = expanded(name)
        ordinal = len(nodes)
        node = {"ordinal": ordinal, "name": key(uri, local), "namespace": uri, "localName": local,
                "parent": stack[-1]["node"]["ordinal"] if stack else None,
                "locator": {"byteStart": offset, "byteEnd": None}, "attributes": [],
                "interpretation": "literal_inventory", "text": None}
        if not stack and name != CORE + "|CityModel":
            fail("VERSION_PROFILE", "Only CityGML 2.0 CityModel documents are supported.", "unsupported", locator(node))
        bindings = dict(stack[-1]["bindings"]) if stack else {"xml": XML}
        lexical = []
        for match in ATTRIBUTE.finditer(raw[offset:tag_end]):
            qname = match[1].decode("utf-8")
            if qname == "xmlns" or qname.startswith("xmlns:"):
                # Namespace values cannot contain arbitrary entity declarations;
                # Expat resolves their legal character references for us.
                prefix = qname.split(":", 1)[1] if ":" in qname else ""
                declaration_uri = next((n["uri"] for n in reversed(namespaces)
                                        if n["prefix"] == (prefix or None)), None)
                bindings[prefix] = declaration_uri
                value = declaration_uri
                canonical = qname
            else:
                prefix, separator, attr_local = qname.partition(":")
                attr_uri = bindings.get(prefix, "") if separator else ""
                attr_local = attr_local if separator else prefix
                canonical = key(attr_uri, attr_local)
                parser_key = f"{attr_uri}|{attr_local}" if attr_uri else attr_local
                value = attributes.get(parser_key)
            entry = {"name": canonical, "qname": qname, "value": value,
                     "rawLiteral": match[3].decode("utf-8"),
                     "locator": locator(node, offset+match.start(3), offset+match.end(3), "attribute_value")}
            lexical.append(entry)
        # XML permits prefix declarations after their use in the same start tag.
        # Rebind ordinary attributes from Expat's namespace-expanded keys.
        for entry in lexical:
            qname = entry["qname"]
            if qname != "xmlns" and not qname.startswith("xmlns:"):
                prefix, separator, attr_local = qname.partition(":")
                attr_uri = bindings.get(prefix, "") if separator else ""
                attr_local = attr_local if separator else prefix
                entry["name"] = key(attr_uri, attr_local)
                entry["value"] = attributes.get(f"{attr_uri}|{attr_local}" if attr_uri else attr_local)
            if entry["value"] is None and not qname.startswith("xmlns"):
                fail("ATTRIBUTE_LOCATOR", "Cannot map XML attribute to its original span.")
        node["attributes"] = lexical
        nodes.append(node)
        if stack:
            stack[-1]["children"] += 1
        # Only these structural paths admit typed associations. Everything else
        # is opaque to this projection, even when its descendants reuse known
        # namespaces. Literal inventory and coordinate opacity are independent.
        parent_context = stack[-1]["semantic_context"] if stack else None
        context = None
        if not stack:
            context = "model"
        elif parent_context == "model" and uri == CORE and local == "cityObjectMember":
            context = "member"
        elif uri == BUILDING:
            if (parent_context, local) in (("member", "Building"), ("part_member", "BuildingPart")):
                context = "building"
            elif parent_context == "building" and local == "consistsOfBuildingPart":
                context = "part_member"
            elif parent_context == "building" and local == "boundedBy":
                context = "boundary_member"
            elif parent_context == "boundary_member" and local in BOUNDARY_SURFACES:
                context = "boundary_surface"
        owner = stack[-1]["owner"] if stack else None
        if context == "building":
            parent_owner, owner = owner, ordinal
            ident = attributes.get(GML + "|id")
            buildings.append({"element": ordinal, "type": local, "id": ident,
                              "idState": "supplied" if ident is not None else "absent",
                              "parentBuildingElement": parent_owner, "properties": [], "lodDeclarations": []})
            building_index[ordinal] = buildings[-1]
        elif uri not in (CORE, BUILDING, GML):
            node["interpretation"] = "unsupported_module_or_ADE"
        geometry_supported = stack[-1]["geometry_supported"] if stack else True
        if uri == GML and local in GEOMETRY:
            node["interpretation"] = "declaration_only" if local in SUPPORTED_GEOMETRY else "unsupported_geometry"
            geometry_supported = geometry_supported and local in SUPPORTED_GEOMETRY
        elif uri == GML and local not in LITERAL_GML | COORDINATES:
            node["interpretation"] = "unsupported_gml_profile"
            geometry_supported = False
        if uri not in (CORE, BUILDING, GML):
            geometry_supported = False
        ident = attributes.get(GML + "|id")
        if ident is not None:
            identifiers.setdefault(ident, []).append(ordinal)
        for entry in lexical:
            if entry["name"] == key(XLINK, "href") or entry["name"] == "srsName" and (entry["value"] or "").startswith("#"):
                base_declarations = [a for s in stack for a in s["node"]["attributes"] if a["name"] == key(XML, "base")]
                base_declarations.extend(a for a in lexical if a["name"] == key(XML, "base"))
                references.append({"element": ordinal, "attribute": entry["name"], "literal": entry["value"],
                                   "locator": entry["locator"], "xmlBaseDeclarations": base_declarations,
                                   "state": "pending_inventory"})
        reference_fields = {e["name"]: e for e in lexical if e["name"] in REFERENCE_ATTRIBUTES or e["name"] == key(GML, "uom")}
        stack.append({"node": node, "bindings": bindings, "owner": owner, "children": 0,
                      "semantic_context": context, "semantic_parent_context": parent_context,
                      "text": [], "text_bytes": 0, "tag_end": tag_end,
                      "self_closing": raw[offset:tag_end].rstrip().endswith(b"/>"),
                      "geometry_supported": geometry_supported, "reference_fields": reference_fields})

    def text(value):
        if stack:
            frame = stack[-1]
            frame["text_bytes"] += len(value.encode("utf-8"))
            if frame["text_bytes"] > limits.string_bytes:
                fail("STRING_LIMIT", "XML element text exceeds the string limit.", "limit")
            frame["text"].append(value)

    def end(name):
        nonlocal coordinate_count
        frame = stack[-1]
        node = frame["node"]
        text_end = frame["tag_end"] if frame["self_closing"] else parser.CurrentByteIndex
        element_end = frame["tag_end"] if frame["self_closing"] else raw.find(b">", text_end, text_end+limits.string_bytes)+1
        if element_end <= 0:
            fail("END_TAG", "Cannot locate complete XML closing tag.")
        node["locator"]["byteEnd"] = element_end
        literal = raw[frame["tag_end"]:text_end]
        if not frame["children"]:
            if len(literal) > limits.string_bytes:
                fail("STRING_LIMIT", "XML literal text exceeds the string limit.", "limit")
            nil = next((a["value"] for a in node["attributes"] if a["name"] == key(XSI, "nil")), None)
            nil_reason = next((a["value"] for a in node["attributes"] if a["name"] in ("nilReason", key(GML, "nilReason"))), None)
            decoded = "".join(frame["text"])
            nil_state = nil_reason if nil_reason in ("unknown", "withheld") else "null"
            state = "conflicting" if nil in ("true", "1") and decoded.strip() else nil_state if nil in ("true", "1") else "explicit_empty" if not decoded else "supplied"
            node["text"] = {"state": state, "nilReasonLiteral": nil_reason,
                            "value": decoded, "rawLiteral": literal.decode("utf-8"),
                            "locator": locator(node, frame["tag_end"], text_end, "element_content")}
        if node["namespace"] == GML and node["localName"] in COORDINATES:
            reference = {}
            for field in REFERENCE_ATTRIBUTES:
                declarations = [s["reference_fields"][field] for s in stack if field in s["reference_fields"]]
                reference[field] = {"state": "supplied" if declarations else "absent", "declarations": declarations,
                                    "nearestAncestorDeclaration": declarations[-1] if declarations else None}
            supported = frame["geometry_supported"] and not frame["children"]
            coordinate = {"element": node["ordinal"], "buildingElement": frame["owner"],
                          "kind": node["localName"], "state": "available" if supported else "unsupported",
                          "locator": locator(node, frame["tag_end"], text_end, "element_content"),
                          "referenceDeclarations": reference, "values": None,
                          "tupleDimension": None, "tupleDimensionState": "absent", "globalPlacement": "not_assessed"}
            if supported:
                values = []
                for token in re.finditer(rb"\S+", literal):
                    if coordinate_count >= limits.coordinate_values:
                        fail("COORDINATE_LIMIT", "Coordinate value count exceeds the limit.", "limit")
                    if not NUMBER.fullmatch(token[0]):
                        fail("COORDINATE_NUMBER", "Coordinates must be finite literal numeric tokens.", locator=coordinate["locator"])
                    value = float(token[0])
                    if not math.isfinite(value):
                        fail("COORDINATE_NUMBER", "Nonfinite coordinate is not supported.", locator=coordinate["locator"])
                    values.append({"literal": token[0].decode("ascii"), "value": value,
                                   "locator": locator(node, frame["tag_end"]+token.start(), frame["tag_end"]+token.end(), "numeric_token")})
                    coordinate_count += 1
                coordinate["values"] = values
                if not values:
                    coordinate["state"] = node["text"]["state"] if node["text"]["state"] in ("null", "unknown", "withheld") else "needs_input"
                    coordinate["reason"] = "empty_coordinate_declaration" if coordinate["state"] == "needs_input" else "nil_coordinate_declaration"
                elif node["text"]["state"] in ("null", "unknown", "withheld", "conflicting"):
                    coordinate["state"], coordinate["reason"] = "malformed", "nil_with_coordinate_content"
                dimension = reference["srsDimension"]["nearestAncestorDeclaration"]
                if dimension is not None:
                    value = dimension["value"]
                    if not re.fullmatch(r"[23]", value or ""):
                        coordinate["state"], coordinate["reason"] = "unsupported", "dimension_outside_2_or_3_profile"
                        coordinate["tupleDimensionState"] = "unsupported"
                    else:
                        coordinate["tupleDimension"], coordinate["tupleDimensionState"] = int(value), "declared"
                        if len(values) % int(value) or node["localName"] != "posList" and len(values) != int(value):
                            coordinate["state"], coordinate["reason"] = "malformed", "declared_dimension_count_conflict"
            else:
                coordinate["reason"] = "unsupported_geometry_or_module_or_mixed_content"
            coordinates.append(coordinate)
        stack.pop()
        if frame["owner"] is not None:
            owner = building_index.get(frame["owner"])
            if owner is not None:
                if (frame["semantic_parent_context"] == "building" and node["parent"] == owner["element"]
                        and node["text"] is not None and not node["interpretation"].startswith("unsupported")):
                    owner["properties"].append(node["ordinal"])
                if (frame["semantic_parent_context"] in ("building", "boundary_surface")
                        and node["namespace"] == BUILDING and re.match(r"lod[0-4]", node["localName"])):
                    owner["lodDeclarations"].append({"element": node["ordinal"], "name": node["localName"],
                                                     "lodLiteral": node["localName"][3], "locator": locator(node)})

    def deny(*args):
        fail("XML_RESOURCE_DENIED", "XML external resources, DTDs and entities are denied.", "denied")

    parser.StartNamespaceDeclHandler = namespace
    parser.StartElementHandler, parser.EndElementHandler = start, end
    parser.CharacterDataHandler = text
    parser.StartDoctypeDeclHandler = deny
    parser.EntityDeclHandler = deny
    parser.ExternalEntityRefHandler = deny
    def xml_declaration(version, encoding, standalone):
        if version != "1.0" or encoding is not None and encoding.lower() not in ("utf-8", "utf8"):
            fail("ENCODING", "Only XML 1.0 with UTF-8 encoding is supported.", "unsupported")
    parser.XmlDeclHandler = xml_declaration
    try:
        for offset in range(0, len(raw), 64 * 1024):
            parser.Parse(raw[offset:offset+64*1024], False)
        parser.Parse(b"", True)
    except expat.ExpatError:
        fail("XML_MALFORMED", "XML is not well formed; no projection is published.", locator={"byteStart": parser.ErrorByteIndex})
    if not nodes:
        fail("XML_MALFORMED", "Empty XML input.")
    # Reference graph follows actual XML containment and unique local XLinks.
    # Inventory only: no expansion, geometry composition or external I/O.
    graph = {n["ordinal"]: [] for n in nodes}
    for node in nodes:
        if node["parent"] is not None:
            graph[node["parent"]].append(node["ordinal"])
    for ref in references:
        literal = ref["literal"] or ""
        if ref["xmlBaseDeclarations"]:
            ref["state"], ref["targetElements"] = "unsupported_xml_base_context", []
        elif literal.startswith("#") and len(literal) > 1:
            targets = identifiers.get(literal[1:], [])
            ref["targetElements"] = targets
            ref["state"] = "unresolved" if not targets else "duplicate_target" if len(targets) > 1 else "local_target_inventory"
            if len(targets) == 1:
                graph[ref["element"]].append(targets[0])
        else:
            ref["state"], ref["targetElements"] = "external_not_resolved", []
    # Iterative SCC inventory includes containment edges, so a reference to an
    # ancestor or a cross-sibling cycle is visible on every participating link.
    colors, finishing = {}, []
    for root in graph:
        if colors.get(root):
            continue
        colors[root] = 1
        work = [(root, iter(graph[root]))]
        while work:
            origin, edges = work[-1]
            target = next(edges, None)
            if target is None:
                colors[origin] = 2
                finishing.append(origin)
                work.pop()
            elif not colors.get(target):
                if len(work) >= limits.depth:
                    fail("REFERENCE_DEPTH_LIMIT", "Reference graph exceeds the traversal depth limit.", "limit")
                colors[target] = 1
                work.append((target, iter(graph[target])))
    reverse = {n: [] for n in graph}
    for origin, targets in graph.items():
        for target in targets:
            reverse[target].append(origin)
    components, sizes = {}, {}
    for root in reversed(finishing):
        if root in components:
            continue
        queue = [root]
        components[root] = root
        size = 0
        while queue:
            node = queue.pop()
            size += 1
            for parent in reverse[node]:
                if parent not in components:
                    components[parent] = root
                    queue.append(parent)
        sizes[root] = size
    cycles = False
    for ref in references:
        cycle = ref["state"] == "local_target_inventory" and any(
            components[ref["element"]] == components[t] and (sizes[components[t]] > 1 or ref["element"] == t)
            for t in ref["targetElements"])
        ref["cycleState"] = "cycle_member" if cycle else "not_detected"
        cycles = cycles or cycle
    duplicates = [{"id": ident, "elements": ordinals} for ident, ordinals in identifiers.items() if len(ordinals) > 1]
    unsupported = [n["ordinal"] for n in nodes if n["interpretation"].startswith("unsupported")]
    if unsupported:
        findings.append({"code": "UNSUPPORTED_CONTENT", "status": "unsupported", "elements": unsupported,
                         "message": "Non-building modules, ADEs and unsupported geometries remain literal inventory only."})
    if duplicates or cycles or any(r["state"] != "local_target_inventory" for r in references):
        findings.append({"code": "REFERENCES_NOT_COMPOSED", "status": "needs_input",
                         "message": "Unresolved, duplicate, external or cyclic references remain unexpanded."})
    if any(c["tupleDimensionState"] == "absent" for c in coordinates if c["state"] == "available"):
        findings.append({"code": "DIMENSION_ABSENT", "status": "needs_input", "message": "Flat coordinate values are retained; tuple dimension is not guessed."})
    incomplete_coordinates = [c["element"] for c in coordinates if c["state"] not in ("available", "unsupported")]
    if incomplete_coordinates:
        findings.append({"code": "COORDINATE_DECLARATION_INCOMPLETE", "status": "needs_input",
                         "elements": incomplete_coordinates,
                         "message": "Null, empty or dimension-conflicting coordinates remain explicit and unusable."})
    result = {"schemaVersion": "ulpin-native-citygml/1", "status": "partial" if findings else "available",
              "scope": "source_native_literal_inventory", "source": {"sha256": hashlib.sha256(raw).hexdigest(),
              "bytes": len(raw), "citygmlVersion": "2.0", "encodingProfile": "XML 1.0 UTF-8",
              "locatorConvention": "zero-based byte spans [start,end); element ordinals in XML start order"},
              "parser": {"name": "CPython Expat", "version": expat.EXPAT_VERSION}, "limits": asdict(limits),
              "namespaces": namespaces, "elements": nodes, "buildings": buildings,
              "identifiers": [{"id": ident, "elements": ids, "state": "duplicate" if len(ids) > 1 else "supplied"}
                              for ident, ids in identifiers.items()],
              "references": references, "coordinates": sorted(coordinates, key=lambda c: c["element"]),
              "counts": {"elements": len(nodes), "buildingsAndParts": len(buildings),
                         "coordinateDeclarations": len(coordinates), "decodedCoordinateValues": coordinate_count,
                         "references": len(references), "elementTypes": dict(sorted(Counter(n["name"] for n in nodes).items()))},
              "findings": findings, "semantics": {"globalTransformApplied": False, "measurement": "not_assessed",
              "validity": "not_assessed", "canonicalIdentity": "not_assessed", "rights": "not_assessed",
              "floorsOrUnitsInferred": False, "externalResourcesResolved": False,
              "referencePolicy": "literal declarations only; XML ancestor fields listed without qualification; no CRS/dimension/unit defaults or sibling-envelope inheritance",
              "unprojectedContent": "retained_in_unchanged_original"}}
    return result


def encode_result(result, limits=DEFAULT_LIMITS):
    data = bytearray()
    for piece in json.JSONEncoder(ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(",", ":")).iterencode(result):
        encoded = piece.encode("utf-8")
        if len(data) + len(encoded) + 1 > limits.output_bytes:
            fail("OUTPUT_LIMIT", "CityGML projection exceeds the output byte limit.", "limit")
        data.extend(encoded)
    return bytes(data) + b"\n"
