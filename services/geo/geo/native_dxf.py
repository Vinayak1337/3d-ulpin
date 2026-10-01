"""Source-native ASCII DXF inspection, not geometry qualification or conversion.

Use inspect_dxf() at a trust boundary: it installs the existing OS memory
ceiling before importing ezdxf and bounds the entire parse in a child. The
in-process read_dxf() is for that child and focused offline checks only.
Original tag lexemes/line locators are authoritative; parser defaults, repaired
handles, synthesized layouts and transformed geometry never enter projections.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

PARSER_VERSION = "1.4.3"
MAX_INPUT_BYTES = 16 * 1024**2
MAX_RECORDS = 100_000
MAX_ENTITIES = 10_000
MAX_POINTS = 100_000
MAX_TAGS = 500_000
MAX_OUTPUT_BYTES = 16 * 1024**2
MAX_MEMORY_BYTES = 2 * 1024**3
MAX_SECONDS = 45


class DXFError(ValueError):
    def __init__(self, status, code, message, locator=None):
        super().__init__(message)
        self.status, self.code, self.locator = status, code, locator

    def as_dict(self):
        return {"status": self.status, "code": self.code,
                "message": str(self), "locator": self.locator}


def _fail(code, message, locator=None, status="malformed"):
    raise DXFError(status, code, message, locator)


class _Budget:
    def __init__(self):
        self.deadline = time.monotonic() + MAX_SECONDS
        self.points = 0
        self.output = 0

    def check(self):
        if time.monotonic() > self.deadline:
            _fail("TIME_LIMIT", "DXF inspection exceeded its deadline.", status="limit")

    def add(self, item):
        self.check()
        self.output += len(_encode(item))
        if self.output > MAX_OUTPUT_BYTES:
            _fail("OUTPUT_LIMIT", "DXF projection exceeds 16 MiB.", status="limit")


def _encode(item):
    return json.dumps(item, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def encode_dxf_result(result):
    encoded = _encode(result)
    if len(encoded) > MAX_OUTPUT_BYTES:
        _fail("OUTPUT_LIMIT", "DXF projection exceeds 16 MiB.", status="limit")
    return encoded


def _locator(index):
    return {"tagIndex": index, "codeLine": index * 2 + 1, "valueLine": index * 2 + 2}


def _codepage_declaration(text, budget):
    """Locate the original HEADER value before selecting any text decoder."""
    from ezdxf.lldxf.tagger import ascii_tags_loader
    header, section_name, pending, declaration = False, False, None, None
    for index, tag in enumerate(ascii_tags_loader(io.StringIO(text, newline=None), skip_comments=False)):
        if index >= MAX_TAGS:
            _fail("TAG_LIMIT", "DXF exceeds 500,000 source tags.", status="limit")
        if index % 512 == 0:
            budget.check()
        if tag.code == 0:
            if header and tag.value == "ENDSEC":
                if pending is not None:
                    _fail("CODEPAGE_DECLARATION", "Codepage declaration has no group-code 3 value.",
                          _locator(pending), status="unsupported")
                return declaration
            section_name = tag.value == "SECTION"
            header = False
        elif section_name and tag.code == 2:
            header, section_name = tag.value == "HEADER", False
        elif header:
            if pending is not None and tag.code != 999:
                if tag.code != 3:
                    _fail("CODEPAGE_DECLARATION", "Codepage declaration requires a group-code 3 value.",
                          _locator(index), status="unsupported")
                declaration = {"tagIndex": index, "rawValue": tag.value}
                pending = None
            elif tag.code == 9 and tag.value == "$DWGCODEPAGE":
                if declaration is not None:
                    _fail("HEADER", "Duplicate header variable.", _locator(index))
                pending = index
    return declaration


def _typed(tag):
    from ezdxf.lldxf.types import cast_tag_value
    try:
        value = cast_tag_value(tag["code"], tag["rawValue"])
    except (ValueError, OverflowError):
        _fail("TAG_VALUE", "Invalid source group-code value.", _locator(tag["tagIndex"]))
    if isinstance(value, float) and not math.isfinite(value):
        _fail("NONFINITE", "Nonfinite source numbers are not accepted.", _locator(tag["tagIndex"]))
    return value


def _field(tags, codes):
    selected = [t for t in tags if t["code"] in codes]
    return {"state": "supplied" if selected else "absent", "tags": [
        {"code": t["code"], "value": _typed(t), "rawValue": t["rawValue"],
         "locator": _locator(t["tagIndex"])} for t in selected]}


def _one(tags, code):
    selected = [t for t in tags if t["code"] == code]
    if len(selected) > 1:
        _fail("DUPLICATE_ATTRIBUTE", "Ambiguous repeated source attribute.", _locator(selected[1]["tagIndex"]))
    return _typed(selected[0]) if selected else None


def _semantic_tags(tags):
    # Application data, XDATA and embedded objects are retained opaque. Do not
    # mistake their group codes for the parent entity's geometry/attributes.
    output, app_depth = [], 0
    for t in tags:
        if t["code"] == 1001 or (t["code"] == 101 and t["rawValue"] == "Embedded Object"):
            break
        if t["code"] == 102:
            if t["rawValue"].startswith("{"):
                app_depth += 1
            elif t["rawValue"] == "}":
                app_depth -= 1
            if app_depth < 0:
                _fail("APPDATA", "Unbalanced application data.", _locator(t["tagIndex"]))
        elif not app_depth:
            output.append(t)
    if app_depth:
        _fail("APPDATA", "Unclosed application data.")
    return output


COMMON = {"handle": (5,), "ownerHandle": (330,), "layer": (8,),
          "paperSpaceFlag": (67,), "layoutName": (410,),
          "extrusion": (210, 220, 230), "thickness": (39,)}
FIELDS = {
    "LINE": {"start": (10, 20, 30), "end": (11, 21, 31)},
    "CIRCLE": {"center": (10, 20, 30), "radius": (40,)},
    "ARC": {"center": (10, 20, 30), "radius": (40,), "startAngleDegrees": (50,), "endAngleDegrees": (51,)},
    "TEXT": {"text": (1,), "insert": (10, 20, 30), "alignmentPoint": (11, 21, 31),
             "height": (40,), "widthFactor": (41,), "rotationDegrees": (50,),
             "obliqueDegrees": (51,), "style": (7,), "flags": (71,),
             "horizontalAlignment": (72,), "verticalAlignment": (73,)},
    "MTEXT": {"textChunks": (1, 3), "insert": (10, 20, 30), "direction": (11, 21, 31),
              "height": (40,), "referenceWidth": (41,), "rotationRadians": (50,),
              "attachment": (71,), "drawingDirection": (72,), "style": (7,)},
    "LWPOLYLINE": {"declaredVertexCount": (90,), "flags": (70,), "elevation": (38,), "constantWidth": (43,)},
    "POLYLINE": {"elevationPoint": (10, 20, 30), "flags": (70,), "defaultStartWidth": (40,),
                 "defaultEndWidth": (41,), "meshMCount": (71,), "meshNCount": (72,),
                 "smoothM": (73,), "smoothN": (74,), "smoothType": (75,)},
    "VERTEX": {"position": (10, 20, 30), "startWidth": (40,), "endWidth": (41,),
               "bulge": (42,), "flags": (70,), "tangent": (50,), "indices": (71, 72, 73, 74), "identifier": (91,)},
    "INSERT": {"blockName": (2,), "insert": (10, 20, 30), "scaleX": (41,), "scaleY": (42,),
               "scaleZ": (43,), "rotationDegrees": (50,), "columnCount": (70,), "rowCount": (71,),
               "columnSpacing": (44,), "rowSpacing": (45,), "attributesFollow": (66,)},
}
REQUIRED = {"LINE": (10, 20, 11, 21), "CIRCLE": (10, 20, 40),
            "ARC": (10, 20, 40, 50, 51), "TEXT": (1, 10, 20, 40),
            "MTEXT": (10, 20, 40), "INSERT": (2, 10, 20),
            "VERTEX": (10, 20), "LWPOLYLINE": (90,)}


def _space(record, tags):
    block = record["blockName"]
    paper = _one(tags, 67)
    layout = _one(tags, 410)
    if record["section"] == "BLOCKS":
        name = (block or "").upper()
        kind = "model" if name in ("$MODEL_SPACE", "*MODEL_SPACE") else "paper" if name.startswith(("$PAPER_SPACE", "*PAPER_SPACE")) else "block_definition"
        return {"kind": kind, "basis": "source_block_name", "blockName": block,
                "declaredPaperFlag": paper, "declaredLayout": layout}
    if paper not in (None, 0, 1):
        kind, basis = "unsupported", "invalid_source_paper_flag"
    elif layout is not None:
        kind, basis = ("model" if layout.upper() == "MODEL" else "paper"), "declared_layout_name"
        if paper is not None and paper != (0 if kind == "model" else 1):
            kind, basis = "conflicting", "source_layout_and_paper_flag_disagree"
    else:
        kind = "paper" if paper == 1 else "model"
        basis = "declared_paper_flag" if paper is not None else "DXF_default_not_source_declaration"
    return {"kind": kind, "basis": basis, "declaredPaperFlag": paper, "declaredLayout": layout}


def _project(record, budget):
    tags = _semantic_tags(record["sourceTags"])
    typ = record["type"]
    fields = {name: _field(tags, codes) for name, codes in {**COMMON, **FIELDS.get(typ, {})}.items()}
    result = {**record, "fields": fields,
              "status": "supported" if typ in FIELDS else "unsupported",
              "space": _space(record, tags),
              "coordinateSemantics": "source values; WCS for LINE/3D POLYLINE, OCS for CIRCLE/ARC/TEXT/2D polylines/INSERT; MTEXT follows supplied direction"}
    missing = [code for code in REQUIRED.get(typ, ()) if not any(t["code"] == code for t in tags)]
    if typ == "MTEXT" and not any(t["code"] in (1, 3) for t in tags):
        missing.append(1)
    result["missingRequiredGroupCodes"] = missing
    if missing:
        result["status"] = "needs_input"
    if typ == "LWPOLYLINE":
        vertices, current = [], None
        for t in tags:
            if t["code"] == 10:
                current = []
                vertices.append(current)
            if t["code"] in (10, 20, 40, 41, 42, 91):
                if current is None:
                    _fail("VERTEX_ORDER", "LWPOLYLINE vertex fields precede their X coordinate.", _locator(t["tagIndex"]))
                current.append(t)
        result["vertices"] = [{"index": i, "position": _field(v, (10, 20)),
                               "startWidth": _field(v, (40,)), "endWidth": _field(v, (41,)),
                               "bulge": _field(v, (42,)), "identifier": _field(v, (91,))}
                              for i, v in enumerate(vertices)]
        if any(_one(v, 20) is None for v in vertices):
            result["status"] = "needs_input"
            result["missingRequiredGroupCodes"].append(20)
        if _one(tags, 90) != len(vertices):
            _fail("VERTEX_COUNT", "LWPOLYLINE declared/source vertex counts differ.", record["locator"])
    if budget.points > MAX_POINTS:
        _fail("POINT_LIMIT", "DXF projection exceeds 100,000 points.", status="limit")
    flags = _one(tags, 70) if typ == "POLYLINE" else None
    reasons = []
    if flags is not None and flags & (2 | 4 | 16 | 64):
        result["status"] = "unsupported"
        reasons.append("Curve/spline-fit polylines and polygon/polyface meshes are retained without geometric interpretation.")
    if typ not in FIELDS:
        reasons.append("Entity type has no semantic projection in this profile; all original tags are retained.")
    if typ == "INSERT":
        reasons.append("Block transform values only; no block explosion, external-reference fetch or array expansion.")
    if missing:
        reasons.append("Required source fields are absent; parser defaults are not substituted.")
    if result["space"]["kind"] in ("conflicting", "unsupported"):
        reasons.append("Source space metadata is conflicting or unsupported; no layout is chosen.")
    if any(t["code"] in (101, 102, 1001) for t in record["sourceTags"]):
        reasons.append("Embedded/application/XDATA values are retained opaque; their semantics are unsupported.")
    if typ == "MTEXT":
        reasons.append("Text chunks and formatting codes retained; columns, font shaping and rich-text rendering unsupported.")
    result["limitations"] = reasons
    return result


def read_dxf(raw):
    """Read immutable bytes inside the supervised child; never recover/audit/save."""
    if not raw or len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_LIMIT", "DXF requires 1 byte to 16 MiB.", status="limit")
    if raw.startswith(b"AutoCAD Binary DXF"):
        _fail("BINARY_DXF", "Binary DXF is unsupported in this ASCII profile.", status="unsupported")
    import ezdxf
    from ezdxf.filemanagement import dxf_stream_info
    from ezdxf.lldxf.tagger import ascii_tags_loader
    from ezdxf.lldxf.types import POINT_CODES
    if ezdxf.__version__ != PARSER_VERSION:
        _fail("PARSER_VERSION", "DXF inspection requires ezdxf 1.4.3.", status="unavailable")
    budget = _Budget()
    # Latin-1 is a reversible initial scan of the ASCII header. Actual text is
    # decoded strictly with the parser's header encoding, never replacement.
    header_text = raw.decode("latin-1")
    info = dxf_stream_info(io.StringIO(header_text, newline=None))
    if info.version >= "AC1021":
        encoding = "utf-8"
    else:
        declaration = _codepage_declaration(header_text, budget)
        if declaration is None:
            encoding = "cp1252"
        else:
            from ezdxf.tools.codepage import codepage_to_encoding
            supported = {"ANSI_" + code: codec for code, codec in codepage_to_encoding.items()}
            encoding = supported.get(declaration["rawValue"])
            if encoding is None:
                # ezdxf.toencoding() silently defaults unknown values to cp1252.
                # Reject them before decoding; keep a bounded original locator.
                _fail("CODEPAGE_UNSUPPORTED", "Declared DXF codepage is unsupported; text was not decoded.",
                      {**_locator(declaration["tagIndex"]), "headerVariable": "$DWGCODEPAGE",
                       "rawValue": declaration["rawValue"][:128],
                       "rawValueTruncated": len(declaration["rawValue"]) > 128}, status="unsupported")
    try:
        text = raw.decode(encoding)
    except (UnicodeError, LookupError):
        _fail("ENCODING", "Source bytes do not decode strictly in the header-selected encoding.")
    stream = io.StringIO(text, newline=None)
    tags = []
    for index, tag in enumerate(ascii_tags_loader(stream, skip_comments=False)):
        if index >= MAX_TAGS:
            _fail("TAG_LIMIT", "DXF exceeds 500,000 source tags.", status="limit")
        if index % 512 == 0:
            budget.check()
        budget.points += tag.code in POINT_CODES
        if budget.points > MAX_POINTS:
            _fail("POINT_LIMIT", "DXF exceeds 100,000 source coordinate/vector starts.", status="limit")
        tags.append({"tagIndex": index, "code": tag.code, "rawValue": tag.value})
    if not tags or tags[-1]["code"] != 0 or tags[-1]["rawValue"] != "EOF" or stream.read().strip():
        _fail("EOF", "DXF requires a complete EOF record without trailing content.")
    sections, header, layers, blocks, records, opaque = [], {}, [], [], [], {}
    section, current, block_name, record_count, handles = None, None, None, 0, set()
    for t in tags:
        budget.check()
        if t["code"] == 0:
            if current is not None:
                current["locator"]["endTagExclusive"] = t["tagIndex"]
            typ = t["rawValue"]
            if typ == "SECTION":
                if section is not None:
                    _fail("SECTION", "Nested or unclosed DXF sections.", _locator(t["tagIndex"]))
                section, current = "awaiting_name", None
                continue
            if typ == "ENDSEC":
                if section in (None, "awaiting_name"):
                    _fail("SECTION", "Unexpected section end.", _locator(t["tagIndex"]))
                section, current, block_name = None, None, None
                continue
            if typ == "EOF":
                if section is not None:
                    _fail("SECTION", "Unclosed section before EOF.")
                current = None
                continue
            if section is None:
                _fail("SECTION", "Source record outside a DXF section.", _locator(t["tagIndex"]))
            record_count += 1
            if record_count > MAX_RECORDS:
                _fail("RECORD_LIMIT", "DXF exceeds 100,000 records.", status="limit")
            current = {"type": typ, "section": section, "blockName": block_name,
                       "locator": {"kind": "dxf_ascii_tags", **_locator(t["tagIndex"])}, "sourceTags": []}
            if section in ("BLOCKS", "ENTITIES"):
                if typ in ("BLOCK", "ENDBLK"):
                    blocks.append(current)
                else:
                    records.append(current)
            elif section == "TABLES" and typ == "LAYER":
                layers.append(current)
            else:
                key = section + "/" + typ
                if key not in opaque:
                    opaque[key] = {"section": section, "type": typ, "count": 0,
                                   "firstLocator": _locator(t["tagIndex"]), "status": "unsupported"}
                opaque[key]["count"] += 1
        elif section == "awaiting_name":
            if t["code"] != 2 or t["rawValue"] in sections:
                _fail("SECTION", "Missing or duplicate DXF section name.", _locator(t["tagIndex"]))
            section = t["rawValue"]
            sections.append(section)
            continue
        if section == "HEADER":
            if t["code"] == 9:
                name = t["rawValue"]
                if name in header:
                    _fail("HEADER", "Duplicate header variable.", _locator(t["tagIndex"]))
                header[name] = []
            elif t["code"] != 999:
                if not header:
                    _fail("HEADER", "Header value without a variable.", _locator(t["tagIndex"]))
                header[next(reversed(header))].append(t)
        if current is not None:
            current["sourceTags"].append(t)
            if t["code"] == 5 and t["rawValue"].strip():
                handle = t["rawValue"].strip().upper()
                if handle in handles:
                    _fail("DUPLICATE_HANDLE", "Duplicate original entity handle.", _locator(t["tagIndex"]))
                handles.add(handle)
            if section == "BLOCKS" and current["type"] == "BLOCK" and t["code"] == 2:
                block_name = t["rawValue"]
                current["blockName"] = block_name
    version = _one(header.get("$ACADVER", []), 1)
    if version not in {"AC1009", "AC1012", "AC1014", "AC1015", "AC1018", "AC1021", "AC1024", "AC1027", "AC1032"}:
        _fail("DXF_VERSION", "Only declared DXF R12 through R2018 versions are supported.", status="unsupported")
    if "ENTITIES" not in sections:
        _fail("ENTITIES_SECTION", "Missing original ENTITIES section.")
    if len(records) > MAX_ENTITIES:
        _fail("ENTITY_LIMIT", "DXF exceeds 10,000 projected entities including children.", status="limit")
    # Existing parser validates/loads the drawing. Projection exclusively uses
    # original tags: its R12 upgrades and generated defaults are discarded.
    try:
        ezdxf.read(io.StringIO(text, newline=None))
    except (ezdxf.DXFError, ValueError, IndexError, KeyError, OverflowError):
        _fail("PARSER", "The pinned DXF parser could not load this source; no recovery was attempted.")
    budget.check()
    units_tags = header.get("$INSUNITS", [])
    units_code = _one(units_tags, 70)
    units = {"state": "absent" if not units_tags else "unitless" if units_code == 0 else "declared",
             "code": units_code, "name": ezdxf.units.decode(units_code) if units_code in range(25) else None,
             "source": _field(units_tags, (70,)), "conversion": None}
    if units_tags and (units_code is None or units_code not in range(25)):
        units["state"] = "unsupported"
    projected, parent = [], None
    for r in records:
        entity = _project(r, budget)
        if r["type"] == "POLYLINE":
            if parent is not None:
                _fail("POLYLINE_SEQUENCE", "Unclosed POLYLINE sequence.", r["locator"])
            parent = entity
            parent["vertices"] = []
            projected.append(entity)
        elif r["type"] == "VERTEX":
            if parent is None or parent["section"] != r["section"] or parent["blockName"] != r["blockName"]:
                _fail("POLYLINE_SEQUENCE", "VERTEX without its source POLYLINE.", r["locator"])
            parent["vertices"].append(entity)
        elif r["type"] == "SEQEND" and parent is not None:
            parent["sequenceEnd"] = r
            parent = None
        else:
            if parent is not None:
                _fail("POLYLINE_SEQUENCE", "POLYLINE sequence lacks SEQEND.", r["locator"])
            projected.append(entity)
        budget.add(entity)
    if parent is not None:
        _fail("POLYLINE_SEQUENCE", "POLYLINE sequence lacks SEQEND.")
    layer_records = [{**r, "fields": {"name": _field(r["sourceTags"], (2,)),
                                      "flags": _field(r["sourceTags"], (70,)),
                                      "color": _field(r["sourceTags"], (62,)),
                                      "lineType": _field(r["sourceTags"], (6,))}} for r in layers]
    block_records = [{**r, "fields": {"name": _field(r["sourceTags"], (2,)),
                                      "basePoint": _field(r["sourceTags"], (10, 20, 30)),
                                      "flags": _field(r["sourceTags"], (70,)),
                                      "xrefPath": _field(r["sourceTags"], (1,)),
                                      "description": _field(r["sourceTags"], (4,))}} for r in blocks]
    for r in block_records:
        if r["type"] == "BLOCK":
            flags = _one(r["sourceTags"], 70)
            r["externalReference"] = None if flags is None else bool(flags & (4 | 8))
            r["expansion"] = "not_performed"
    unsupported = [{"type": r["type"], "status": r["status"], "locator": r["locator"], "limitations": r["limitations"]}
                   for r in projected if r["status"] != "supported" or r["limitations"]]
    result = {"schemaVersion": "dxf-native-inspection/1", "status": "available",
              "sourceSha256": hashlib.sha256(raw).hexdigest(), "sourceBytes": len(raw),
              "parser": {"name": "ezdxf", "version": PARSER_VERSION, "recovery": False},
              "dxfVersion": version, "encoding": {"name": encoding,
                  "basis": "DXF R2007+ UTF-8" if version >= "AC1021" else "declared_codepage" if "$DWGCODEPAGE" in header else "parser_default_cp1252_not_declared"},
              "units": units, "headerVariables": header, "sections": sections,
              "layers": layer_records, "blocks": block_records, "entities": projected,
              "opaqueRecordTypes": list(opaque.values()),
              "recordCount": record_count, "projectedEntityCountIncludingChildren": len(records),
              "pointCount": budget.points, "unsupportedFindings": unsupported,
              "pointCountBasis": "Source coordinate/vector group-code starts, including header/block/opaque records; no curve or INSERT expansion.",
              "qualification": {"scope": "source_local_inspection", "globalPlacement": "not_assessed",
                  "geometryValidity": "not_assessed", "analyticEligible": False,
                  "operationalRecords": False, "trainingLabels": False},
              "limitations": ["No DWG, inferred scale/CRS, room/floor/area reconstruction, curve flattening or block expansion.",
                  "Missing fields stay absent; raw tags preserve lexemes. Parser defaults are not source declarations.",
                  "Only HEADER, layer definitions, block definitions and drawing entities are projected; other tables/objects remain in the unchanged original."]}
    encode_dxf_result(result)
    return result


def inspect_dxf(raw, *, temporary_parent=None):
    """Run the pinned reader with the existing memory guard and a hard deadline."""
    if not raw or len(raw) > MAX_INPUT_BYTES:
        _fail("INPUT_LIMIT", "DXF requires 1 byte to 16 MiB.", status="limit")
    root = Path(__file__).resolve().parent.parent
    worker = ("import sys;sys.path.insert(0," + repr(str(root)) + ");"
              "from geo.native_dxf import _worker;_worker()")
    env = {k: os.environ[k] for k in ("SystemRoot", "WINDIR", "TEMP", "TMP") if k in os.environ}
    env.update({"OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
                "NUMEXPR_NUM_THREADS": "2", "CUDA_VISIBLE_DEVICES": ""})
    started = time.monotonic()
    try:
        with tempfile.TemporaryDirectory(prefix="dxf-inspection-", dir=temporary_parent) as scratch:
            # ezdxf imports consult XDG paths even without drawing/rendering.
            # Use owned empty configuration/cache and cwd, never user settings.
            env.update({"XDG_CONFIG_HOME": scratch, "XDG_CACHE_HOME": scratch,
                        "TEMP": scratch, "TMP": scratch})
            # Pinned ezdxf imports its font manager even for tag inspection.
            # An empty valid v2 cache prevents a recursive system font scan.
            cache_dir = Path(scratch) / "ezdxf"
            cache_dir.mkdir()
            (cache_dir / "font_manager_cache.json").write_text('{"version":2,"font-faces":[]}', encoding="utf-8")
            child = subprocess.run([sys.executable, "-I", "-c", worker], input=raw,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=MAX_SECONDS,
                cwd=scratch, env=env, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    except subprocess.TimeoutExpired:
        _fail("TIME_LIMIT", "DXF child exceeded 45 seconds and was stopped.", status="limit")
    if len(child.stdout) > MAX_OUTPUT_BYTES:
        _fail("OUTPUT_LIMIT", "DXF child output exceeded its bound.", status="limit")
    if child.returncode not in (0, 2):
        _fail("CHILD_FAILURE", "DXF child failed under its resource ceiling.", status="failed")
    try:
        payload = json.loads(child.stdout)
    except (ValueError, UnicodeError):
        _fail("CHILD_FAILURE", "DXF child returned no valid result.", status="failed")
    if "error" in payload:
        error = payload["error"]
        raise DXFError(error["status"], error["code"], error["message"], error["locator"])
    if child.returncode or payload.get("sourceSha256") != hashlib.sha256(raw).hexdigest():
        _fail("CHILD_LINEAGE", "DXF child returned inconsistent source lineage.", status="failed")
    payload["supervision"] = {"memoryLimitBytes": MAX_MEMORY_BYTES, "childDeadlineSeconds": MAX_SECONDS,
                              "parserProcesses": 1, "threadEnvironmentLimit": 2,
                              "observedSeconds": round(time.monotonic() - started, 6),
                              "memoryGuard": "geo.native_pdf._install_memory_limit"}
    encode_dxf_result(payload)
    return payload


def _worker():
    try:
        from geo.native_pdf import _install_memory_limit
        try:
            _install_memory_limit(MAX_MEMORY_BYTES)
        except (OSError, ValueError):
            _fail("ISOLATION", "Cannot enforce the native DXF process memory ceiling.", status="unavailable")
        result = read_dxf(sys.stdin.buffer.read(MAX_INPUT_BYTES + 1))
        sys.stdout.buffer.write(encode_dxf_result(result))
    except DXFError as error:
        sys.stdout.buffer.write(_encode({"error": error.as_dict()}))
        raise SystemExit(2)
    except MemoryError:
        sys.stdout.buffer.write(b'{"error":{"status":"limit","code":"MEMORY_LIMIT","message":"DXF memory ceiling exceeded.","locator":null}}')
        raise SystemExit(2)
    except ImportError:
        sys.stdout.buffer.write(b'{"error":{"status":"unavailable","code":"PARSER_UNAVAILABLE","message":"Pinned DXF parser dependencies are unavailable.","locator":null}}')
        raise SystemExit(2)
    except Exception:
        # Parser exceptions may contain source strings/paths; keep errors bounded.
        sys.stdout.buffer.write(b'{"error":{"status":"malformed","code":"PARSER","message":"DXF could not be read without recovery.","locator":null}}')
        raise SystemExit(2)
