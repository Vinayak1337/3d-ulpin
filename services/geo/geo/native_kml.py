"""Bounded, source-native KML inspection. No network, rendering or admission.

XML character data is decoded by defusedxml; locators identify unchanged XML
elements, not reserialized byte offsets. Altitudes and source text remain literal.
Public callers use inspect_kml(), which always runs the parser in a gated child.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import re
import stat
import struct
import time
import unicodedata
import zipfile
import zlib

MAX_INPUT_BYTES = 16 * 1024**2
MAX_OUTPUT_BYTES = 16 * 1024**2
MAX_EXPANDED_BYTES = 64 * 1024**2
MAX_MEMBERS = 256
MAX_RATIO = 100
MAX_FEATURES = 10000
MAX_COORDINATES = 100000
MAX_NODES = 100000
MAX_DEPTH = 64
MAX_SECONDS = 45
MEMORY_BYTES = 2 * 1024**3
KML_NAMESPACES = frozenset(("http://www.opengis.net/kml/2.2", "http://earth.google.com/kml/2.2"))
GX = "http://www.google.com/kml/ext/2.2"
FEATURES = frozenset(("Document", "Folder", "Placemark", "NetworkLink", "GroundOverlay", "PhotoOverlay", "ScreenOverlay"))
GEOMETRIES = frozenset(("Point", "LineString", "LinearRing", "Polygon", "MultiGeometry"))
NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\Z")


class KMLError(ValueError):
    def __init__(self, code, message, status="malformed", locator=None):
        super().__init__(message)
        self.code, self.status, self.locator = code, status, locator

    def as_dict(self):
        return {"status": self.status, "code": self.code, "message": str(self), "locator": self.locator}


def _fail(code, message, status="malformed", locator=None):
    raise KMLError(code, message, status, locator)


class _Budget:
    def __init__(self):
        self.deadline = time.monotonic() + MAX_SECONDS
        self.coordinates = 0

    def check(self):
        if time.monotonic() > self.deadline:
            _fail("TIME_LIMIT", "KML inspection exceeded its deadline.", "limit")


def _select_xml(raw, member, budget):
    """Check actual expanded bytes/CRC for every member, without disk extraction."""
    if not raw.startswith(b"PK"):
        if member is not None:
            _fail("MEMBER_ON_XML", "Member selection applies only to KMZ.")
        return raw, None, [], None
    # Bound central-directory allocation before ZipFile builds its entry objects.
    end = raw.rfind(b"PK\x05\x06", max(0, len(raw) - 65557))
    if end < 0 or end + 22 > len(raw):
        _fail("KMZ_DIRECTORY", "KMZ has no supported central directory.")
    _, disk, directory_disk, on_disk, count, _, _, comment = struct.unpack_from("<4s4H2LH", raw, end)
    if disk or directory_disk or on_disk != count or count == 65535 or end + 22 + comment != len(raw):
        _fail("KMZ_DIRECTORY_PROFILE", "Multi-disk, ZIP64 and trailing-data KMZ are unsupported.", "unsupported")
    if count > MAX_MEMBERS:
        _fail("MEMBER_LIMIT", "KMZ exceeds 256 members.", "limit")
    inventory, seen, expanded, selected = [], set(), 0, None
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if len(entries) != count:
                _fail("KMZ_DIRECTORY", "KMZ member count disagrees with its directory.")
            declared = sum(info.file_size for info in entries)
            if declared > MAX_EXPANDED_BYTES:
                _fail("EXPANSION_LIMIT", "KMZ exceeds 64 MiB expanded bytes.", "limit")
            for info in entries:
                budget.check()
                name = info.orig_filename
                key = unicodedata.normalize("NFC", name.rstrip("/")).casefold()
                if (not name or len(name) > 1024 or name.startswith(("/", "\\"))
                        or "\\" in name or ":" in name
                        or any(ord(ch) < 32 or ord(ch) == 127 for ch in name)
                        or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))):
                    _fail("UNSAFE_MEMBER_PATH", "KMZ contains an unsafe member path.")
                if key in seen:
                    _fail("DUPLICATE_MEMBER", "KMZ contains ambiguous duplicate member names.")
                seen.add(key)
                mode = stat.S_IFMT(info.external_attr >> 16)
                if mode not in (0, stat.S_IFREG, stat.S_IFDIR):
                    _fail("SPECIAL_MEMBER", "KMZ symlinks and special entries are refused.")
                if mode == stat.S_IFDIR and not info.is_dir():
                    _fail("DIRECTORY_MEMBER", "KMZ directory metadata disagrees with its name.")
                if info.flag_bits & (1 | 64):
                    _fail("ENCRYPTED_MEMBER", "Encrypted KMZ members are refused.", "unsupported")
                if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    _fail("COMPRESSION_PROFILE", "KMZ compression is unsupported.", "unsupported")
                if (info.file_size > max(1, info.compress_size) * MAX_RATIO
                        or (info.is_dir() and info.file_size)):
                    _fail("EXPANSION_LIMIT", "KMZ member expansion exceeds the profile.", "limit")
            candidates = [info.filename for info in entries if not info.is_dir() and info.filename.lower().endswith(".kml")]
            if member is not None and member not in candidates:
                _fail("MEMBER_NOT_FOUND", "Select an exact KML member from the KMZ inventory.", "needs_input")
            choice = member if member is not None else candidates[0] if len(candidates) == 1 else None
            for ordinal, info in enumerate(entries):
                budget.check()
                digest, actual, data = hashlib.sha256(), 0, bytearray()
                with archive.open(info) as stream:
                    while chunk := stream.read(65536):
                        budget.check()
                        actual += len(chunk)
                        expanded += len(chunk)
                        if (actual > info.file_size or actual > max(1, info.compress_size) * MAX_RATIO
                                or expanded > MAX_EXPANDED_BYTES
                                or (info.filename == choice and actual > MAX_INPUT_BYTES)):
                            _fail("EXPANSION_LIMIT", "Actual KMZ decompression exceeds the profile.", "limit")
                        digest.update(chunk)
                        if info.filename == choice:
                            data.extend(chunk)
                if actual != info.file_size:
                    _fail("MEMBER_SIZE", "KMZ member size does not match its directory.")
                record = {"ordinal": ordinal, "path": info.filename, "bytes": actual,
                          "compressedBytes": info.compress_size, "sha256": digest.hexdigest(),
                          "crc32": f"{info.CRC:08x}", "crc": "match",
                          "kind": "directory" if info.is_dir() else "kml" if info.filename in candidates else "inert_asset",
                          "selected": info.filename == choice}
                inventory.append(record)
                if record["selected"]:
                    selected = (bytes(data), record)
            if choice is None:
                return None, None, inventory, {"code": "KML_MEMBER_SELECTION_REQUIRED" if candidates else "NO_KML_MEMBER",
                                             "candidates": candidates, "status": "needs_input"}
            return selected[0], selected[1], inventory, None
    except (zipfile.BadZipFile, RuntimeError, EOFError, OSError, zlib.error, NotImplementedError) as error:
        raise KMLError("KMZ_CORRUPT", "KMZ could not be safely read.") from error


class _Node:
    def __init__(self, tag, attrs, locator):
        self.tag, self.attrs, self.locator = tag, attrs, locator
        self.children, self.content, self.counts = [], [], {}

    def text(self):
        # Preserve decoded character order even for inert HTML nested in fields.
        return "".join(item if isinstance(item, str) else item.text() for item in self.content)


def _xml_tree(raw, budget):
    # Import the pinned dependency only inside the supervised worker.
    from defusedxml.expatreader import DefusedExpatParser
    from defusedxml.common import DefusedXmlException
    from xml.sax.handler import ContentHandler, feature_namespaces
    from xml.sax import SAXException

    class Handler(ContentHandler):
        def __init__(self):
            super().__init__()
            self.stack, self.root, self.nodes = [], None, 0

        def setDocumentLocator(self, locator):
            self.position = locator

        def startElementNS(self, name, qname, attrs):
            budget.check()
            self.nodes += 1
            if len(self.stack) >= MAX_DEPTH or self.nodes > MAX_NODES:
                _fail("XML_TREE_LIMIT", "XML depth or element count exceeds the profile.", "limit")
            tag = (name[0] or "", name[1])
            parent = self.stack[-1] if self.stack else None
            ordinal = parent.counts.get(tag, 0) + 1 if parent else 1
            if parent:
                parent.counts[tag] = ordinal
            path = (parent.locator["path"] if parent else "") + f"/Q{{{tag[0]}}}{tag[1]}[{ordinal}]"
            node = _Node(tag, [{"namespace": key[0] or "", "name": key[1], "text": value}
                               for key, value in attrs.items()],
                         {"path": path, "line": self.position.getLineNumber(),
                          "column": self.position.getColumnNumber(), "columnBase": 0})
            if parent:
                parent.children.append(node)
                parent.content.append(node)
            else:
                self.root = node
            self.stack.append(node)

        def characters(self, text):
            if self.stack:
                self.stack[-1].content.append(text)

        def endElementNS(self, name, qname):
            self.stack.pop()

    handler = Handler()
    parser = DefusedExpatParser(forbid_dtd=True, forbid_entities=True, forbid_external=True)
    parser.setFeature(feature_namespaces, True)
    parser.setContentHandler(handler)
    try:
        parser.parse(io.BytesIO(raw))
    except DefusedXmlException as error:
        raise KMLError("XML_FORBIDDEN", "DTD, entities and external XML references are refused.") from error
    except SAXException as error:
        raise KMLError("XML_MALFORMED", "XML is malformed or uses an unsupported XML profile.") from error
    if handler.root is None:
        _fail("XML_EMPTY", "XML has no root element.")
    return handler.root


def _attribute(node, name):
    matches = [value["text"] for value in node.attrs if not value["namespace"] and value["name"] == name]
    return {"state": "present" if matches else "absent", "text": matches[0] if matches else None,
            "locator": {**node.locator, "attribute": name} if matches else None}


def _field(node):
    text = node.text()
    return {"name": node.tag[1], "namespace": node.tag[0], "text": text,
            "state": "empty" if text == "" else "present", "attributes": node.attrs,
            "locator": node.locator, "textKind": "decoded_xml_character_data", "executed": False}


def _declaration(node, name):
    # Extension altitudeMode stays separate, never silently wins a conflict.
    matches = [child for child in node.children if child.tag[1] == name
               and (child.tag[0] == node.tag[0] or (name == "altitudeMode" and child.tag[0] == GX))]
    return {"state": "conflicting" if len(matches) > 1 else "present" if matches else "absent",
            "values": [_field(child) for child in matches]}


def _coordinates(node, budget):
    fields = [child for child in node.children if child.tag == (node.tag[0], "coordinates")]
    state = "conflicting" if len(fields) > 1 else "present" if fields else "absent"
    result = {"state": state, "sequences": []}
    for field in fields:
        tuples = []
        text = field.text()
        # Token iterator avoids allocating a large split list before count checks.
        for token in re.finditer(r"\S+", text):
            budget.check()
            budget.coordinates += 1
            if budget.coordinates > MAX_COORDINATES:
                _fail("COORDINATE_LIMIT", "KML exceeds 100,000 coordinate tuples.", "limit", field.locator)
            parts = token.group().split(",")
            if len(parts) not in (2, 3) or any(not NUMBER.fullmatch(part) for part in parts):
                _fail("COORDINATE_SYNTAX", "Expected longitude,latitude[,altitude] tuples.", locator=field.locator)
            values = [float(part) for part in parts]
            if any(not math.isfinite(value) for value in values):
                _fail("NONFINITE_COORDINATE", "Coordinate values must be finite.", locator=field.locator)
            if not -180 <= values[0] <= 180 or not -90 <= values[1] <= 90:
                _fail("COORDINATE_RANGE", "Longitude/latitude exceeds the supported KML range.", locator=field.locator)
            tuples.append({"lexemes": parts, "longitude": values[0], "latitude": values[1],
                           "altitude": values[2] if len(values) == 3 else None,
                           "altitudeState": "present" if len(values) == 3 else "absent",
                           "textStart": token.start(), "textEnd": token.end()})
        result["sequences"].append({"source": _field(field), "tuples": tuples})
    return result


def _geometry(node, budget, conformant, projected):
    kind = node.tag[1]
    projected.add(node)
    projection = {"type": kind, "locator": node.locator, "sourceId": _attribute(node, "id"),
                  "status": "inspected", "issues": []}
    expected = (GEOMETRIES if kind == "MultiGeometry" else
                frozenset(("outerBoundaryIs", "innerBoundaryIs", "altitudeMode", "extrude", "tessellate")) if kind == "Polygon" else
                frozenset(("coordinates", "altitudeMode", "extrude")) if kind == "Point" else
                frozenset(("coordinates", "altitudeMode", "extrude", "tessellate")))
    unsupported = [child.locator for child in node.children if child.tag[0] != node.tag[0] or child.tag[1] not in expected]
    projection["unsupportedChildren"] = unsupported
    if unsupported:
        projection["issues"].append("UNSUPPORTED_GEOMETRY_CONTENT")
    projected.update(child for child in node.children if child.tag[0] == node.tag[0] and child.tag[1] in expected)
    if kind == "MultiGeometry":
        projection["geometries"] = [_geometry(child, budget, conformant, projected)
                                    for child in node.children if child.tag[0] == node.tag[0]
                                    and child.tag[1] in GEOMETRIES]
        if not projection["geometries"]:
            projection["issues"].append("EMPTY_MULTIGEOMETRY")
    else:
        declarations = {name: _declaration(node, name) for name in ("altitudeMode", "extrude", "tessellate")}
        projection["declarations"] = declarations
        projection["specificationDefaults"] = ({"altitudeMode": "clampToGround", "extrude": "0",
                                                   **({"tessellate": "0"} if kind != "Point" else {}),
                                                   "omittedTupleAltitude": "0",
                                                   "basis": "KML 2.2 semantics only; no terrain/elevation evaluated"}
                                                  if conformant else None)
        projection["verticalReference"] = {"state": "not_assessed", "qualifiedDatum": None, "evaluatedElevations": False,
                                            "note": "Mode and tuple Z are source declarations; no vertical transform or terrain lookup."}
        for name, declaration in declarations.items():
            if declaration["state"] == "conflicting":
                projection["issues"].append("CONFLICTING_" + name.upper())
            for value in declaration["values"]:
                allowed = ("absolute", "relativeToGround", "clampToGround") if name == "altitudeMode" else ("0", "1", "true", "false")
                if value["namespace"] == GX or value["text"].strip() not in allowed:
                    projection["issues"].append("UNSUPPORTED_" + name.upper())
        if kind == "Polygon":
            rings = []
            for boundary in node.children:
                if boundary.tag[0] == node.tag[0] and boundary.tag[1] in ("outerBoundaryIs", "innerBoundaryIs"):
                    native = [child for child in boundary.children if child.tag == (node.tag[0], "LinearRing")]
                    rings.append({"role": boundary.tag[1], "locator": boundary.locator,
                                  "rings": [_geometry(child, budget, conformant, projected) for child in native]})
                    if len(native) != 1:
                        projection["issues"].append("MISSING_OR_CONFLICTING_RING")
            projection["boundaries"] = rings
            if sum(ring["role"] == "outerBoundaryIs" for ring in rings) != 1:
                projection["issues"].append("MISSING_OR_CONFLICTING_OUTER_BOUNDARY")
        else:
            coordinates = _coordinates(node, budget)
            projection["coordinates"] = coordinates
            if coordinates["state"] != "present":
                projection["issues"].append("MISSING_OR_CONFLICTING_COORDINATES")
            for sequence in coordinates["sequences"]:
                values = sequence["tuples"]
                if ((kind == "Point" and len(values) != 1) or (kind == "LineString" and len(values) < 2)
                        or (kind == "LinearRing" and (len(values) < 4 or
                            any(values[0][key] != values[-1][key] for key in ("longitude", "latitude", "altitude"))))):
                    projection["issues"].append("INCOMPLETE_COORDINATE_SEQUENCE")
    nested = projection.get("geometries", []) + [ring for boundary in projection.get("boundaries", []) for ring in boundary["rings"]]
    if projection["issues"] or any(child["status"] != "inspected" for child in nested):
        projection["status"] = "partial"
    return projection


def _read_kml(raw, *, member=None):
    """Worker-only pure inspection, also exposed to focused safety regressions."""
    if type(raw) is not bytes or not raw or len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_LIMIT", "Original must be nonempty and at most 16 MiB.", "limit")
    budget = _Budget()
    original_hash = hashlib.sha256(raw).hexdigest()
    xml, selected, inventory, selection = _select_xml(raw, member, budget)
    result = {"schemaVersion": "kml-native-inspection/1", "sourceSha256": original_hash,
              "sourceBytes": len(raw), "container": "kmz" if inventory or raw.startswith(b"PK") else "kml",
              "member": selected, "memberInventory": inventory,
              "qualification": {"profile": "local_source_inspection", "accuracy": "not_assessed",
                                "analyticEligible": False, "registryAdmission": False, "learningLabels": False},
              "features": [], "unsupported": [], "references": [], "coordinateCount": 0}
    if selection:
        return {**result, "status": "needs_input", "selection": selection, "xmlSha256": None, "document": None}
    xml_hash = hashlib.sha256(xml).hexdigest()
    root = _xml_tree(xml, budget)
    namespace = root.tag[0]
    conformant = namespace in KML_NAMESPACES and root.tag[1] == "kml"
    if not conformant and not (namespace == "" and root.tag[1] in FEATURES):
        _fail("KML_ROOT_PROFILE", "Expected a KML 2.2 root or an explicitly incomplete unnamespaced feature fragment.", "unsupported")
    result.update({"xmlSha256": xml_hash, "document": {"root": root.tag[1], "namespace": namespace,
                   "attributes": root.attrs,
                   "sourceId": _attribute(root, "id"), "locator": root.locator,
                   "profile": "kml_2_2" if conformant else "unnamespaced_feature_fragment",
                   "horizontalReference": {"basis": "KML specification" if conformant else None,
                                             "axisOrder": ["longitude", "latitude"] if conformant else None,
                                             "accuracy": "not_assessed"}}})
    # A bounded inventory makes every unimplemented subtree visible. Known fields
    # are literal inspection only; style content and embedded HTML are never run.
    handled = FEATURES | GEOMETRIES | frozenset(("kml", "coordinates", "outerBoundaryIs", "innerBoundaryIs",
                     "name", "description", "address", "phoneNumber", "visibility", "open", "Snippet",
                     "styleUrl", "altitudeMode", "extrude", "tessellate", "ExtendedData", "Data", "value",
                     "displayName", "SchemaData", "SimpleData"))
    stack, projected = [(root, None)], set()
    while stack:
        budget.check()
        node, parent_feature = stack.pop()
        is_native = node.tag[0] == namespace
        if is_native and node.tag[1] in FEATURES:
            if len(result["features"]) >= MAX_FEATURES:
                _fail("FEATURE_LIMIT", "KML exceeds 10,000 features.", "limit", node.locator)
            feature_index = len(result["features"])
            fields = [_field(child) for child in node.children if not (child.tag[0] == namespace and child.tag[1] in FEATURES | GEOMETRIES)]
            # Keep ExtendedData names, attributes and locators individually,
            # rather than reducing an attribute table to concatenated text.
            extended = [child for child in node.children if child.tag == (namespace, "ExtendedData")]
            pending = list(reversed(extended))
            while pending:
                field = pending.pop()
                if field not in extended:
                    fields.append(_field(field))
                pending.extend(reversed(field.children))
            geometries = [_geometry(child, budget, conformant, projected) for child in node.children
                          if child.tag[0] == namespace and child.tag[1] in GEOMETRIES]
            result["features"].append({"ordinal": feature_index, "type": node.tag[1], "parentFeature": parent_feature,
                  "attributes": node.attrs,
                  "sourceId": _attribute(node, "id"), "name": _declaration(node, "name"),
                  "sourceFields": fields, "locator": node.locator, "geometries": geometries,
                  "geometryState": "present" if geometries else "absent",
                  "status": "partial" if (node.tag[1] == "Placemark" and not geometries) or
                                          any(g["status"] != "inspected" for g in geometries) else "inspected"})
            parent_feature = feature_index
        unprojected = is_native and node.tag[1] in GEOMETRIES | frozenset(("coordinates", "outerBoundaryIs", "innerBoundaryIs")) and node not in projected
        if not is_native or node.tag[1] not in handled or unprojected:
            result["unsupported"].append({"namespace": node.tag[0], "name": node.tag[1],
                       "sourceId": _attribute(node, "id"), "locator": node.locator,
                       "status": "unsupported", "reason": "UNPROJECTED_GEOMETRY_CONTENT" if unprojected else "NOT_INTERPRETED"})
        if node.tag[1] in ("href", "styleUrl", "sourceHref", "targetHref"):
            result["references"].append({**_field(node), "resolution": "not_resolved"})
        stack.extend((child, parent_feature) for child in reversed(node.children))
    result["coordinateCount"] = budget.coordinates
    result["status"] = "partial" if (not conformant or result["unsupported"] or
                         any(f["status"] != "inspected" for f in result["features"])) else "inspected"
    budget.check()
    return result


def encode_kml_result(result):
    output = bytearray()
    for part in json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":")).iterencode(result):
        chunk = part.encode("utf-8")
        if len(output) + len(chunk) > MAX_OUTPUT_BYTES:
            _fail("OUTPUT_LIMIT", "KML result exceeds 16 MiB.", "limit")
        output.extend(chunk)
    return bytes(output)


def inspect_kml(source, expected_sha256, *, member=None):
    """Run through the companion CLI's supervisor; never an in-process fallback."""
    from pathlib import Path
    import importlib.util
    cli = Path(__file__).resolve().parents[3] / "scripts/usp/desktop-kml-read.py"
    spec = importlib.util.spec_from_file_location("_kml_supervisor", cli)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.run_supervised(Path(source), expected_sha256, member=member)
