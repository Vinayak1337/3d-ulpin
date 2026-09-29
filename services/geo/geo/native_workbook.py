"""Bounded OOXML workbook cells as source references, without spreadsheet evaluation."""

import posixpath
import re
import xml.etree.ElementTree as ET
from xml.parsers import expat

from .validation import InputError


SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CELL_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
MAX_XML_BYTES = 5 * 1024 * 1024
MAX_SHEETS = 16
MAX_ROWS = 2000
MAX_CELLS = 2000
MAX_SHARED_STRINGS = 10000
MAX_TEXT_CHARS = 250000
MAX_CELL_CHARS = 32767


def _tag(local):
    return f"{{{SHEET_NS}}}{local}"


def _xml(archive, name):
    try:
        info = archive.getinfo(name)
    except KeyError:
        raise InputError("NATIVE_WORKBOOK_INVALID") from None
    if info.file_size > MAX_XML_BYTES:
        raise InputError("NATIVE_WORKBOOK_LIMIT")
    with archive.open(info) as member:
        raw = member.read(MAX_XML_BYTES + 1)
    if len(raw) > MAX_XML_BYTES:
        raise InputError("NATIVE_WORKBOOK_LIMIT")
    # Expat recognizes DTDs in UTF-8 and UTF-16 before ElementTree can expand
    # their entities into a materialized workbook tree.
    guard = expat.ParserCreate()

    def reject_declaration(*_args):
        raise InputError("NATIVE_WORKBOOK_INVALID")

    guard.StartDoctypeDeclHandler = reject_declaration
    guard.EntityDeclHandler = reject_declaration
    guard.ExternalEntityRefHandler = reject_declaration
    try:
        guard.Parse(raw, True)
        return ET.fromstring(raw)
    except (expat.ExpatError, ET.ParseError):
        raise InputError("NATIVE_WORKBOOK_INVALID") from None


def _unsupported(code, warning):
    return {"format": "xlsx", "method": "native_reference", "status": "unsupported",
            "code": code, "parts": [], "warnings": [warning], "characterCount": 0}


def _target(value):
    if not value or "\\" in value or ":" in value or value.startswith("//") or ".." in value.split("/"):
        raise InputError("NATIVE_WORKBOOK_INVALID")
    path = posixpath.normpath(value.lstrip("/") if value.startswith("/") else posixpath.join("xl", value))
    if not path.startswith("xl/") or "/../" in f"/{path}/":
        raise InputError("NATIVE_WORKBOOK_INVALID")
    return path


def _stored_text(element):
    """Keep rich text runs in order; phonetic annotations are not the cell value."""
    if element is None:
        return ""
    pieces = []
    for child in element:
        if child.tag == _tag("t"):
            pieces.append(child.text or "")
        elif child.tag == _tag("r"):
            pieces.extend(text.text or "" for text in child.findall(_tag("t")))
    return "".join(pieces)


def _column(letters):
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - 64
    if value > 16384:
        raise InputError("NATIVE_WORKBOOK_INVALID")
    return value


def extract_native_workbook(archive):
    names = set(archive.namelist())
    if "[Content_Types].xml" not in names or "xl/_rels/workbook.xml.rels" not in names:
        return _unsupported("WORKBOOK_STRUCTURE_UNSUPPORTED", "OOXML workbook relationships or content types are missing.")
    content_types = _xml(archive, "[Content_Types].xml")
    if any("macroEnabled" in entry.get("ContentType", "") for entry in content_types):
        return _unsupported("WORKBOOK_MACROS_UNSUPPORTED", "Macro-enabled workbooks are retained without native extraction.")
    if any(name.startswith(("xl/activeX/", "xl/embeddings/")) or name == "xl/vbaProject.bin" for name in names):
        return _unsupported("WORKBOOK_EMBEDDED_UNSUPPORTED", "Embedded executable or linked objects were not interpreted.")
    workbook = _xml(archive, "xl/workbook.xml")
    if workbook.tag != _tag("workbook"):
        return _unsupported("WORKBOOK_STRUCTURE_UNSUPPORTED", "The archive has no supported SpreadsheetML workbook root.")
    relationships = {}
    for item in _xml(archive, "xl/_rels/workbook.xml.rels").findall(f"{{{PACKAGE_REL_NS}}}Relationship"):
        relation_id = item.get("Id")
        if not relation_id or relation_id in relationships:
            raise InputError("NATIVE_WORKBOOK_INVALID")
        relationships[relation_id] = item
    sheets = workbook.findall(f"{_tag('sheets')}/{_tag('sheet')}")
    if not sheets or len(sheets) > MAX_SHEETS:
        raise InputError("NATIVE_WORKBOOK_LIMIT")

    shared_path = next((_target(item.get("Target")) for item in relationships.values()
                        if item.get("Type", "").endswith("/sharedStrings") and item.get("TargetMode") != "External"), None)
    shared = []
    if shared_path:
        root = _xml(archive, shared_path)
        if root.tag != _tag("sst"):
            raise InputError("NATIVE_WORKBOOK_INVALID")
        strings = root.findall(_tag("si"))
        if len(strings) > MAX_SHARED_STRINGS:
            raise InputError("NATIVE_WORKBOOK_LIMIT")
        shared = [_stored_text(item) for item in strings]
        if sum(len(value) for value in shared) > MAX_TEXT_CHARS:
            raise InputError("NATIVE_WORKBOOK_LIMIT")

    parts, warnings, seen_sheets, seen_sheet_ids = [], [], set(), set()
    counts = {key: 0 for key in ("empty", "empty_string", "whitespace", "formula_cached", "formula_uncached", "error", "unsupported")}
    rows_seen = cells_seen = text_chars = literal_cells = 0
    partial = False
    for sheet_index, sheet in enumerate(sheets, 1):
        name, relation_id = sheet.get("name"), sheet.get(f"{{{OFFICE_REL_NS}}}id")
        try:
            sheet_id = int(sheet.get("sheetId", ""))
        except ValueError:
            raise InputError("NATIVE_WORKBOOK_INVALID") from None
        if (not name or len(name) > 128 or any(ord(letter) < 32 for letter in name)
                or name.casefold() in seen_sheets or relation_id not in relationships
                or not 1 <= sheet_id <= 4294967295 or sheet_id in seen_sheet_ids):
            raise InputError("NATIVE_WORKBOOK_INVALID")
        seen_sheets.add(name.casefold())
        seen_sheet_ids.add(sheet_id)
        relation = relationships[relation_id]
        if not relation.get("Type", "").endswith("/worksheet") or relation.get("TargetMode") == "External":
            partial = True
            warnings.append(f"Sheet {sheet_index} ({name}) has no supported internal worksheet; no cells were inferred.")
            continue
        sheet_path = _target(relation.get("Target"))
        if not sheet_path.startswith("xl/worksheets/"):
            raise InputError("NATIVE_WORKBOOK_INVALID")
        root = _xml(archive, sheet_path)
        if root.tag != _tag("worksheet"):
            raise InputError("NATIVE_WORKBOOK_INVALID")
        if sheet.get("state", "visible") != "visible":
            warnings.append(f"Sheet {sheet_index} ({name}) is marked {sheet.get('state')}; its native cell references remain private.")
        if root.find(_tag("mergeCells")) is not None:
            warnings.append(f"Sheet {sheet_index} ({name}) has merged ranges; values were not copied into other cells.")
        sheet_data = root.find(_tag("sheetData"))
        seen_rows, seen_cells = set(), set()
        for row in sheet_data.findall(_tag("row")) if sheet_data is not None else []:
            try:
                row_number = int(row.get("r", ""))
            except ValueError:
                raise InputError("NATIVE_WORKBOOK_INVALID") from None
            if not 1 <= row_number <= 1048576 or row_number in seen_rows:
                raise InputError("NATIVE_WORKBOOK_INVALID")
            seen_rows.add(row_number)
            rows_seen += 1
            if rows_seen > MAX_ROWS:
                raise InputError("NATIVE_WORKBOOK_LIMIT")
            for cell in row.findall(_tag("c")):
                ref = cell.get("r", "")
                match = CELL_RE.fullmatch(ref)
                if not match or int(match.group(2)) != row_number or ref in seen_cells:
                    raise InputError("NATIVE_WORKBOOK_INVALID")
                seen_cells.add(ref)
                column = _column(match.group(1))
                cells_seen += 1
                if cells_seen > MAX_CELLS:
                    raise InputError("NATIVE_WORKBOOK_LIMIT")
                cell_type = cell.get("t", "n")
                if not 1 <= len(cell_type) <= 20 or any(ord(letter) < 32 for letter in cell_type):
                    raise InputError("NATIVE_WORKBOOK_INVALID")
                formula = cell.find(_tag("f"))
                stored = cell.find(_tag("v"))
                lexical = stored.text if stored is not None and stored.text is not None else None
                state = "literal"
                if formula is not None and not lexical:
                    state, value = "formula_uncached", "[Formula result unavailable; not calculated]"
                elif cell_type == "s":
                    if lexical is None:
                        value = None
                    else:
                        try:
                            index = int(lexical)
                            value = shared[index] if 0 <= index < len(shared) else None
                        except ValueError:
                            value = None
                        if value is None:
                            raise InputError("NATIVE_WORKBOOK_INVALID")
                elif cell_type == "inlineStr":
                    inline = cell.find(_tag("is"))
                    value = _stored_text(inline) if inline is not None else None
                elif cell_type in ("n", "b", "str", "d", "e"):
                    value = lexical
                else:
                    state, value = "unsupported", "[Unsupported cell storage type]"
                if state == "literal":
                    if cell_type == "e" and value is not None:
                        state = "error"
                    elif value is None:
                        state, value = "empty", "[Explicit cell with no stored value]"
                    elif value == "":
                        state, value = "empty_string", "[Stored empty string]"
                    elif formula is not None:
                        state = "formula_cached"
                    elif not value.strip():
                        state = "whitespace"
                if "\x00" in value or len(value) > MAX_CELL_CHARS:
                    raise InputError("NATIVE_WORKBOOK_LIMIT")
                text_chars += len(value)
                if text_chars > MAX_TEXT_CHARS:
                    raise InputError("NATIVE_WORKBOOK_LIMIT")
                if state == "literal":
                    literal_cells += 1
                elif state in counts:
                    counts[state] += 1
                parts.append({"id": f"part-{len(parts) + 1}", "text": value,
                              "locator": {"sheet": name, "sheetIndex": sheet_index, "sheetId": sheet_id, "cell": ref,
                                          "row": row_number, "column": column, "cellState": state,
                                          "cellType": cell_type,
                                          "label": f"XLSX sheet {sheet_index} ({name}), cell {ref}"}})
    if counts["empty"]:
        warnings.append(f"{counts['empty']} source cell elements have no stored value; they are cited as empty, not inferred as null.")
    if counts["empty_string"] or counts["whitespace"]:
        warnings.append(f"{counts['empty_string']} stored empty strings and {counts['whitespace']} whitespace-only strings retain distinct cell states.")
    if counts["formula_cached"]:
        warnings.append(f"{counts['formula_cached']} formula cells have stored cached values; no formula was calculated or cache freshness verified.")
    if counts["formula_uncached"]:
        warnings.append(f"{counts['formula_uncached']} formula cells have no usable cached result; their values remain unavailable.")
    if counts["error"] or counts["unsupported"]:
        warnings.append(f"{counts['error']} cached errors and {counts['unsupported']} unsupported cell storage types remain unresolved.")
    if any(counts[state] for state in ("formula_cached", "formula_uncached", "error", "unsupported")):
        partial = True
    if any(name.startswith("xl/externalLinks/") or name == "xl/connections.xml" for name in names):
        partial = True
        warnings.append("External workbook links/connections were not followed or interpreted.")
    if any(name.startswith("xl/printerSettings/") for name in names):
        warnings.append("Printer settings were retained in the original but not interpreted.")
    if any(name.startswith(("xl/drawings/", "xl/charts/", "xl/pivotTables/")) for name in names):
        partial = True
        warnings.append("Drawings, charts or pivot tables were retained but not interpreted.")
    warnings.append("Cell text is the stored lexical value; styles, number/date display formats and inferred headers are not applied. Unrepresented cells are unknown, not explicit blanks or nulls.")
    if not literal_cells:
        return {"format": "xlsx", "method": "native_reference", "status": "unsupported",
                "code": "WORKBOOK_NO_LITERAL_VALUES", "parts": parts,
                "warnings": warnings + ["No usable stored literal cells were found; formulas and empty cells were not converted into facts."],
                "characterCount": text_chars}
    return {"format": "xlsx", "method": "native_reference", "status": "ready",
            "code": "NATIVE_PARTIAL_TEXT" if partial else None, "parts": parts,
            "warnings": warnings, "characterCount": text_chars}
