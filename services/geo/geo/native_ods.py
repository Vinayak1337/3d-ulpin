"""Bounded OpenDocument cell references; repetitions remain source ranges, never expanded."""

import re

from .native_workbook import _xml, MAX_SHEETS, MAX_ROWS, MAX_CELLS, MAX_TEXT_CHARS, MAX_CELL_CHARS
from .validation import InputError

MIMETYPE = b"application/vnd.oasis.opendocument.spreadsheet"
OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
CALC = "urn:org:documentfoundation:names:experimental:calc:xmlns:calcext:1.0"
MAX_ROW = 1048576
MAX_COLUMN = 16384


def _tag(ns, name):
    return f"{{{ns}}}{name}"


def is_ods_archive(archive):
    """The actual bounded package mimetype selects this reader, not a file suffix."""
    try:
        info = archive.getinfo("mimetype")
    except KeyError:
        return False
    if info.flag_bits & 1 or info.file_size > 128:
        return False
    with archive.open(info) as member:
        return member.read(129) == MIMETYPE


def _result(code, warning, status="unsupported"):
    return {"format": "ods", "method": "native_reference", "status": status,
            "code": code, "parts": [], "warnings": [warning], "characterCount": 0}


def _repeat(element, name, maximum):
    lexical = element.get(_tag(TABLE, name), "1")
    if not re.fullmatch(r"[0-9]{1,8}", lexical):
        raise InputError("NATIVE_ODS_INVALID")
    count = int(lexical)
    if not 1 <= count <= maximum:
        raise InputError("NATIVE_ODS_LIMIT")
    return count


def _cell_ref(column, row):
    letters = ""
    while column:
        column, remainder = divmod(column - 1, 26)
        letters = chr(65 + remainder) + letters
    return f"{letters}{row}"


def _text(cell):
    """Decode only stored paragraphs, including explicit ODF spaces/tabs/line breaks."""
    pieces, size, supported = [], 0, True

    def add(value):
        nonlocal size
        size += len(value)
        if size > MAX_CELL_CHARS:
            raise InputError("NATIVE_ODS_LIMIT")
        pieces.append(value)

    def visit(node):
        nonlocal supported
        if node.tag == _tag(TEXT, "s"):
            lexical = node.get(_tag(TEXT, "c"), "1")
            if not re.fullmatch(r"[0-9]{1,5}", lexical) or not 1 <= int(lexical) <= MAX_CELL_CHARS - size:
                raise InputError("NATIVE_ODS_LIMIT")
            add(" " * int(lexical))
        elif node.tag == _tag(TEXT, "tab"):
            add("\t")
        elif node.tag == _tag(TEXT, "line-break"):
            add("\n")
        elif node.tag in (_tag(TEXT, "p"), _tag(TEXT, "span"), _tag(TEXT, "a")):
            add(node.text or "")
            for child in node:
                visit(child)
                add(child.tail or "")
        else:
            supported = False

    paragraphs = cell.findall(_tag(TEXT, "p"))
    for index, paragraph in enumerate(paragraphs):
        if index:
            add("\n")
        visit(paragraph)
    if any(child.tag not in (_tag(TEXT, "p"), _tag(OFFICE, "annotation")) for child in cell):
        supported = False
    return "".join(pieces), bool(paragraphs), supported


def _rows(table):
    for child in table:
        if child.tag == _tag(TABLE, "table-row"):
            yield child
        elif child.tag in tuple(_tag(TABLE, name) for name in ("table-header-rows", "table-rows", "table-row-group")):
            yield from _rows(child)


def _columns(table):
    for child in table:
        if child.tag == _tag(TABLE, "table-column"):
            yield child
        elif child.tag in tuple(_tag(TABLE, name) for name in ("table-header-columns", "table-columns", "table-column-group")):
            yield from _columns(child)


def extract_native_ods(archive):
    names = set(archive.namelist())
    if not is_ods_archive(archive) or "content.xml" not in names or "META-INF/manifest.xml" not in names:
        return _result("ODS_STRUCTURE_UNSUPPORTED", "OpenDocument spreadsheet mimetype, content or manifest is missing.")
    if "xl/workbook.xml" in names or "word/document.xml" in names:
        return _result("ODS_STRUCTURE_AMBIGUOUS", "The package also declares another document family; no cell parser was selected.")
    manifest = _xml(archive, "META-INF/manifest.xml")
    if manifest.tag != _tag(MANIFEST, "manifest"):
        raise InputError("NATIVE_ODS_INVALID")
    entries = manifest.findall(_tag(MANIFEST, "file-entry"))
    roots = [entry for entry in entries if entry.get(_tag(MANIFEST, "full-path")) == "/"]
    contents = [entry for entry in entries if entry.get(_tag(MANIFEST, "full-path")) == "content.xml"]
    if (len(roots) != 1 or roots[0].get(_tag(MANIFEST, "media-type")) != MIMETYPE.decode()
            or len(contents) != 1 or contents[0].get(_tag(MANIFEST, "media-type")) != "text/xml"):
        raise InputError("NATIVE_ODS_INVALID")
    if manifest.find(f".//{_tag(MANIFEST, 'encryption-data')}") is not None:
        return _result("DOCUMENT_ENCRYPTED", "Encrypted OpenDocument content remains unavailable.", "encrypted")
    root = _xml(archive, "content.xml")
    if root.tag != _tag(OFFICE, "document-content") or root.get(_tag(OFFICE, "version")) not in ("1.0", "1.1", "1.2", "1.3"):
        return _result("ODS_STRUCTURE_UNSUPPORTED", "No supported OpenDocument 1.0–1.3 content root was found.")
    bodies = root.findall(_tag(OFFICE, "body"))
    if len(bodies) != 1 or len(list(bodies[0])) != 1 or bodies[0][0].tag != _tag(OFFICE, "spreadsheet"):
        return _result("ODS_STRUCTURE_UNSUPPORTED", "No unambiguous spreadsheet body was found.")
    sheets = bodies[0][0].findall(_tag(TABLE, "table"))
    if not sheets or len(sheets) > MAX_SHEETS:
        raise InputError("NATIVE_ODS_LIMIT")
    scripts = root.find(_tag(OFFICE, "scripts"))
    if (scripts is not None and (len(scripts) or (scripts.text or "").strip())) or any(name.startswith(("Scripts/", "Basic/")) for name in names):
        return _result("ODS_SCRIPTS_UNSUPPORTED", "Script-bearing spreadsheets are retained without native extraction.")

    parts, warnings, seen_names = [], [], set()
    text_chars = rows_seen = cells_seen = literal_cells = 0
    counts = {}
    partial = False
    for sheet_index, sheet in enumerate(sheets, 1):
        # ODF external cache tables are not independently supported literal source sheets.
        if sheet.find(_tag(TABLE, "table-source")) is not None:
            partial = True
            warnings.append(f"Table {sheet_index} is externally linked; its stored cache was not interpreted and no link was followed.")
            continue
        name = sheet.get(_tag(TABLE, "name"))
        if not name or len(name) > 128 or any(ord(letter) < 32 for letter in name) or name in seen_names:
            raise InputError("NATIVE_ODS_INVALID")
        seen_names.add(name)
        declared_columns = column_elements = 0
        for column in _columns(sheet):
            column_elements += 1
            declared_columns += _repeat(column, "number-columns-repeated", MAX_COLUMN)
            if column_elements > MAX_CELLS or declared_columns > MAX_COLUMN:
                raise InputError("NATIVE_ODS_LIMIT")
        row_number = 1
        for row_element, row in enumerate(_rows(sheet), 1):
            rows_seen += 1
            if rows_seen > MAX_ROWS:
                raise InputError("NATIVE_ODS_LIMIT")
            row_repeat = _repeat(row, "number-rows-repeated", MAX_ROW)
            if row_number + row_repeat - 1 > MAX_ROW:
                raise InputError("NATIVE_ODS_LIMIT")
            column_number = 1
            for cell_element, cell in enumerate(row, 1):
                if cell.tag not in (_tag(TABLE, "table-cell"), _tag(TABLE, "covered-table-cell")):
                    return _result("ODS_STRUCTURE_UNSUPPORTED", "A row contains unsupported cell structure; no partial table was returned.")
                cells_seen += 1
                if cells_seen > MAX_CELLS:
                    raise InputError("NATIVE_ODS_LIMIT")
                column_repeat = _repeat(cell, "number-columns-repeated", MAX_COLUMN)
                if column_number + column_repeat - 1 > MAX_COLUMN:
                    raise InputError("NATIVE_ODS_LIMIT")
                value_type = cell.get(_tag(OFFICE, "value-type"), "none")
                if not 1 <= len(value_type) <= 20 or any(ord(letter) < 32 for letter in value_type):
                    raise InputError("NATIVE_ODS_INVALID")
                formula = cell.get(_tag(TABLE, "formula"))
                if formula is not None and (not formula or len(formula) > 4096):
                    raise InputError("NATIVE_ODS_LIMIT")
                display, has_text, supported = _text(cell)
                storage = {"float": "value", "percentage": "value", "currency": "value", "boolean": "boolean-value",
                           "date": "date-value", "time": "time-value", "string": "string-value"}.get(value_type)
                value = cell.get(_tag(OFFICE, storage)) if storage else None
                if value is None and value_type in ("string", "none", "error") and has_text:
                    value, storage = display, "text"
                state = "literal"
                stored_attributes = [key for key in ("value", "boolean-value", "date-value", "time-value", "string-value")
                                     if cell.get(_tag(OFFICE, key)) is not None]
                ambiguous_storage = len(stored_attributes) > 1 or bool(stored_attributes and stored_attributes[0] != storage)
                if cell.tag == _tag(TABLE, "covered-table-cell"):
                    state, value, storage = "unsupported", "[Covered cell; no value copied]", "none"
                elif ambiguous_storage or not supported or value_type not in ("float", "percentage", "currency", "boolean", "date", "time", "string", "none", "error"):
                    state, value, storage = "unsupported", "[Unsupported cell content or storage type]", "none"
                elif value_type == "error" or cell.get(_tag(CALC, "value-type")) == "error":
                    state = "error"
                    if value is None:
                        value, storage = "[Stored formula error; value unavailable]", "none"
                elif formula is not None:
                    if value is None:
                        state, value, storage = "formula_uncached", "[Formula result unavailable; not calculated]", "none"
                    else:
                        state = "formula_cached"
                elif value is None:
                    if value_type != "none":
                        state, value, storage = "unsupported", "[Declared cell type has no stored value]", "none"
                    else:
                        state, value, storage = "empty", "[Explicit cell with no stored value]", "none"
                elif value == "":
                    state, value = "empty_string", "[Stored empty string]"
                elif not value.strip():
                    state = "whitespace"
                # An empty cached string needs a visible marker but keeps its formula state.
                if state == "formula_cached" and value == "":
                    value = "[Stored empty cached formula string; unverified]"
                if "\x00" in value or len(value) > MAX_CELL_CHARS:
                    raise InputError("NATIVE_ODS_LIMIT")
                text_chars += len(value) + len(formula or "")
                if text_chars > MAX_TEXT_CHARS:
                    raise InputError("NATIVE_ODS_LIMIT")
                counts[state] = counts.get(state, 0) + 1
                literal_cells += state == "literal"
                partial |= state in ("formula_cached", "formula_uncached", "error", "unsupported")
                cell_ref = _cell_ref(column_number, row_number)
                locator = {"sheet": name, "sheetIndex": sheet_index, "cell": cell_ref, "row": row_number,
                           "column": column_number, "cellState": state, "cellType": value_type,
                           "ods": {"rowElement": row_element, "cellElement": cell_element, "rowRepeat": row_repeat,
                                   "columnRepeat": column_repeat, "valueSource": storage or "none",
                                   **({"formula": formula} if formula is not None else {})},
                           "label": f"ODS table {sheet_index} ({name}), cell {cell_ref}, source repeat {row_repeat} x {column_repeat}"}
                parts.append({"id": f"part-{len(parts) + 1}", "text": value, "locator": locator})
                column_number += column_repeat
            row_number += row_repeat
    if any(node.tag in (_tag(TABLE, "cell-range-source"), _tag(TABLE, "dde-link"), _tag(TABLE, "database-range")) for node in root.iter()):
        partial = True
        warnings.append("External links or database ranges were not followed or interpreted.")
    if any(name.startswith(("Object", "Pictures/")) for name in names):
        partial = True
        warnings.append("Embedded objects and drawings remain in the original without interpretation.")
    warnings.extend([
        "Stored lexical values only: no calculation, cache verification, styles, inferred headers, units, joins or geometry.",
        "One citation per XML cell element; explicit repeated rows/columns are source ranges, not expanded cells. Unrepresented XML cells remain unknown.",
        "Cell states (source elements): " + ", ".join(f"{state}={count}" for state, count in sorted(counts.items())) + ".",
    ])
    return {"format": "ods", "method": "native_reference", "status": "ready" if literal_cells else "unsupported",
            "code": ("NATIVE_PARTIAL_TEXT" if partial else None) if literal_cells else "ODS_NO_LITERAL_VALUES",
            "parts": parts, "warnings": warnings, "characterCount": text_chars}
