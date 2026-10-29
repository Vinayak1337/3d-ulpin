"""Stream one XLSX or ODS sheet as JSON lines of row windows, without spreadsheet evaluation.

The sheet XML is never loaded whole: its member is read twice as a stream, once to hash it behind the DTD
guard and once through ElementTree iterparse (XLSX) or expat (an ODS's content.xml), each finished row
dropped. Lines on stdout, in order: one "sheet" line (headers and the member's SHA-256 and stored byte range),
one "window" line per window of rows, then one "end" line; a refusal is one "refused" line with its code and a
nonzero exit. An ODS row also names its row element's ordinal in the sheet and the SHA-256 of that element's
XML bytes as read: a row inside deflated XML has no byte range of its own in the original.
"""

import argparse
import hashlib
import json
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Callable
from xml.parsers import expat

from read_workbook_cells import MAX_ARCHIVE_MEMBERS

READ_BYTES = 1024 * 1024
# Measured with this reader on generated workbooks (docs/evidence/gf1/xw1/result.json): 100,000 shared strings of
# 34 characters peak at 43 MiB and 1,000,000 at 120 MiB, about 90 bytes a string; the character bound keeps longer
# strings near the same figure.
MAX_SHARED_STRINGS = 1_000_000
MAX_SHARED_CHARACTERS = 64 * 1024 * 1024
MARKS = ("formula_cached", "formula_uncached", "no_value", "error", "unsupported")
TABLE_COLUMNS = 256
# How an ODS cell's state reaches a window: a formula keeps its stored result and an error its stored text, both
# marked; a formula without a stored result and an unknown storage are null and marked.
ODS_MARKS = {"formula_cached": "formula_cached", "formula_uncached": "formula_uncached", "error": "error",
             "unsupported": "unsupported"}
CellValues = dict[int, tuple[str | None, str | None]]
RowLocator = dict[str, int | str]
# Repeated cells of empty text or only spaces are an ODS sheet's padding, as in the whole read.
ODS_PADDING = ("empty_string", "whitespace")
ODS_ROW_GROUPS = ("table-header-rows", "table-rows", "table-row-group")
ODS_VERSIONS = ("1.0", "1.1", "1.2", "1.3")


class Refused(Exception):
    def __init__(self, code, row=None):
        super().__init__(code)
        self.code, self.row = code, row


def native(services_geo_path):
    sys.path.insert(0, str(Path(services_geo_path).resolve()))
    import geo.native_ods as ods
    import geo.native_workbook as workbook
    return workbook, ods


class GuardedMember:
    """A member stream whose bytes pass the expat DTD guard, a byte bound and a hash before anyone reads them."""

    def __init__(self, archive, info, limit):
        self.member, self.limit, self.bytes = archive.open(info), limit, 0
        self.hash = hashlib.sha256()
        self.guard = expat.ParserCreate()

        def reject_declaration(*_args):
            raise Refused("NATIVE_WORKBOOK_INVALID")

        self.guard.StartDoctypeDeclHandler = reject_declaration
        self.guard.EntityDeclHandler = reject_declaration
        self.guard.ExternalEntityRefHandler = reject_declaration

    def read(self, size=-1):
        data = self.member.read(READ_BYTES if size is None or size < 0 else size)
        self.bytes += len(data)
        if self.bytes > self.limit:
            raise Refused("ZIP_EXPANDED_LIMIT")
        self.hash.update(data)
        try:
            self.guard.Parse(data, not data)
        except expat.ExpatError:
            raise Refused("NATIVE_WORKBOOK_INVALID") from None
        return data

    def drain(self):
        while self.read(READ_BYTES):
            pass
        return self.hash.hexdigest(), self.bytes

    def close(self):
        self.member.close()


def member_info(archive, path, limits):
    try:
        info = archive.getinfo(path)
    except KeyError:
        raise Refused("NATIVE_WORKBOOK_INVALID") from None
    if info.file_size > limits.member_bytes:
        raise Refused("ZIP_EXPANDED_LIMIT")
    if info.file_size > max(1, info.compress_size) * limits.ratio:
        raise Refused("ZIP_RATIO_LIMIT")
    return info


def stored_range(file_path, info):
    """The member's stored bytes in the original, after its local header for its compressed size, and the SHA-256
    of exactly those bytes, read once."""
    with open(file_path, "rb") as source:
        source.seek(info.header_offset)
        header = source.read(30)
        if len(header) != 30 or header[:4] != b"PK\x03\x04":
            raise Refused("NATIVE_WORKBOOK_INVALID")
        names, extra = struct.unpack("<HH", header[26:30])
        start = info.header_offset + 30 + names + extra
        source.seek(start)
        digest, left = hashlib.sha256(), info.compress_size
        while left:
            block = source.read(min(READ_BYTES, left))
            if not block:
                raise Refused("NATIVE_WORKBOOK_INVALID")
            digest.update(block)
            left -= len(block)
    return start, start + info.compress_size, digest.hexdigest()


def locate_sheet(workbook, archive, sheet_name):
    """The selected worksheet's member and the shared strings member, through the native reader's checks."""
    names = set(archive.namelist())
    if "[Content_Types].xml" not in names or "xl/_rels/workbook.xml.rels" not in names:
        raise Refused("WORKBOOK_STRUCTURE_UNSUPPORTED")
    if any("macroEnabled" in entry.get("ContentType", "") for entry in workbook._xml(archive, "[Content_Types].xml")):
        raise Refused("WORKBOOK_MACROS_UNSUPPORTED")
    if any(name.startswith(("xl/activeX/", "xl/embeddings/")) or name == "xl/vbaProject.bin" for name in names):
        raise Refused("WORKBOOK_EMBEDDED_UNSUPPORTED")
    root = workbook._xml(archive, "xl/workbook.xml")
    if root.tag != workbook._tag("workbook"):
        raise Refused("WORKBOOK_STRUCTURE_UNSUPPORTED")
    relations = {}
    for item in workbook._xml(archive, "xl/_rels/workbook.xml.rels").findall(
            f"{{{workbook.PACKAGE_REL_NS}}}Relationship"):
        if not item.get("Id") or item.get("Id") in relations:
            raise Refused("NATIVE_WORKBOOK_INVALID")
        relations[item.get("Id")] = item
    sheets = root.findall(f"{workbook._tag('sheets')}/{workbook._tag('sheet')}")
    if not sheets or len(sheets) > workbook.MAX_SHEETS:
        raise Refused("NATIVE_WORKBOOK_LIMIT")
    chosen = [sheet for sheet in sheets if sheet.get("name") == sheet_name]
    if len(chosen) != 1:
        raise Refused("WORKBOOK_SHEET_MISSING")
    relation = relations.get(chosen[0].get(f"{{{workbook.OFFICE_REL_NS}}}id"))
    if (relation is None or not relation.get("Type", "").endswith("/worksheet")
            or relation.get("TargetMode") == "External"):
        raise Refused("WORKBOOK_SHEET_UNSUPPORTED")
    sheet_path = workbook._target(relation.get("Target"))
    if not sheet_path.startswith("xl/worksheets/"):
        raise Refused("NATIVE_WORKBOOK_INVALID")
    shared_path = next((workbook._target(item.get("Target")) for item in relations.values()
                        if item.get("Type", "").endswith("/sharedStrings")
                        and item.get("TargetMode") != "External"), None)
    return sheet_path, shared_path


def shared_strings(workbook, archive, path, limits):
    """Read once, as a stream; the one table the reader holds whole, under its own bounds."""
    if not path:
        return []
    member = GuardedMember(archive, member_info(archive, path, limits), limits.member_bytes)
    strings, characters = [], 0
    try:
        events = ET.iterparse(member, events=("start", "end"))
        _, root = next(events)
        if root.tag != workbook._tag("sst"):
            raise Refused("NATIVE_WORKBOOK_INVALID")
        for event, element in events:
            if event != "end" or element.tag != workbook._tag("si"):
                continue
            text = workbook._stored_text(element)
            strings.append(text)
            characters += len(text)
            if len(strings) > MAX_SHARED_STRINGS or characters > MAX_SHARED_CHARACTERS:
                raise Refused("WORKBOOK_SHARED_STRINGS_LIMIT")
            root.clear()
    except ET.ParseError:
        raise Refused("NATIVE_WORKBOOK_INVALID") from None
    finally:
        member.close()
    return strings


def cell_value(workbook, cell, shared):
    """The stored text of one cell and its mark; nothing is calculated or reformatted."""
    cell_type = cell.get("t", "n")
    if not 1 <= len(cell_type) <= 20 or any(ord(letter) < 32 for letter in cell_type):
        raise Refused("NATIVE_WORKBOOK_INVALID")
    formula, stored = cell.find(workbook._tag("f")), cell.find(workbook._tag("v"))
    lexical = stored.text if stored is not None and stored.text is not None else None
    if formula is not None and not lexical:
        return None, "formula_uncached"
    if cell_type == "s":
        try:
            index = int(lexical) if lexical is not None else -1
        except ValueError:
            index = -1
        if not 0 <= index < len(shared):
            raise Refused("NATIVE_WORKBOOK_INVALID")
        value = shared[index]
    elif cell_type == "inlineStr":
        inline = cell.find(workbook._tag("is"))
        value = workbook._stored_text(inline) if inline is not None else None
    elif cell_type in ("n", "b", "str", "d", "e"):
        value = lexical
    else:
        return None, "unsupported"
    if value is None:
        return None, "no_value"
    if "\x00" in value or len(value) > workbook.MAX_CELL_CHARS:
        raise Refused("NATIVE_WORKBOOK_LIMIT")
    if cell_type == "e":
        return value, "error"
    return value, "formula_cached" if formula is not None else None


def row_cells(workbook, row, row_number, shared):
    """Column number to (text, mark) for each cell element of a row, its references checked."""
    cells = {}
    for cell in row.findall(workbook._tag("c")):
        match = workbook.CELL_RE.fullmatch(cell.get("r", ""))
        if not match or int(match.group(2)) != row_number:
            raise Refused("NATIVE_WORKBOOK_INVALID", row_number)
        column = workbook._column(match.group(1))
        if column in cells:
            raise Refused("NATIVE_WORKBOOK_INVALID", row_number)
        cells[column] = cell_value(workbook, cell, shared)
    return cells


def header_texts(header_rows, wanted):
    """As the whole read: the width is the last header cell; a column's header joins its plain texts."""
    width = max((max(cells) for cells in header_rows.values() if cells), default=0)
    if len(header_rows) != len(wanted) or not 1 <= width <= 256:
        raise Refused("TABULAR_HEADER_REQUIRED")
    return [" / ".join(cells[column][0] for _, cells in sorted(header_rows.items())
                       if column in cells and cells[column][1] is None and (cells[column][0] or "").strip())
            for column in range(1, width + 1)]


class Windows:
    """Rows after the last header row, written as windows; each window is flushed before the next is read."""

    def __init__(self, limits):
        self.limits, self.rows, self.bytes, self.index, self.records = limits, [], 0, 0, 0
        self.marks = {mark: 0 for mark in MARKS}

    def add(self, row_number, cells, width, locator=None):
        if max(cells, default=0) > width:
            raise Refused("TABULAR_SCHEMA_DRIFT", row_number)
        record = {"row": row_number, **(locator or {}),
                  "cells": [cells.get(column, (None, None))[0] for column in range(1, width + 1)]}
        marks = [[column - 1, mark] for column, (_, mark) in sorted(cells.items()) if mark]
        if marks:
            record["marks"] = marks
        text = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        size = len(text.encode("utf-8"))
        if size > self.limits.record_bytes:
            raise Refused("TABULAR_RECORD_BUDGET", row_number)
        self.records += 1
        if self.records > self.limits.rows:
            raise Refused("TABULAR_STREAM_ROWS", row_number)
        for _, mark in marks:
            self.marks[mark] += 1
        if self.rows and self.window_size(size) > self.limits.window_bytes:
            self.flush()
        if self.window_size(size) > self.limits.window_bytes:
            raise Refused("TABULAR_RECORD_BUDGET", row_number)
        self.rows.append(text)
        self.bytes += size + 1
        if len(self.rows) >= self.limits.window_rows:
            self.flush()

    def prefix(self) -> str:
        return f'{{"kind":"window","index":{self.index},"rows":['

    def window_size(self, next_size: int) -> int:
        # bytes counts one separator per existing record; the new record adds its text and the two closing bytes.
        return len(self.prefix()) + self.bytes + next_size + 2

    def flush(self):
        if not self.rows:
            return
        if self.index >= self.limits.windows:
            raise Refused("TABULAR_STREAM_WINDOWS")
        emit(self.prefix() + ",".join(self.rows) + "]}")
        self.index, self.rows, self.bytes = self.index + 1, [], 0


class SheetRows:
    """Header rows first, then every row after the last of them into windows; the sheet line goes out when the
    first such row arrives, or at the end."""

    def __init__(self, wanted: set[int], windows: Windows, head: Callable[[list[str]], list[str]]) -> None:
        self.wanted, self.last_header, self.windows, self.head = wanted, max(wanted), windows, head
        self.header_rows, self.width = {}, 0

    def take(self, row_number: int, cells: CellValues, locator: RowLocator | None = None) -> None:
        if not cells:
            return
        if row_number in self.wanted:
            self.header_rows[row_number] = cells
        elif row_number > self.last_header:
            if self.head is not None:
                self.width, self.head = len(self.head(header_texts(self.header_rows, self.wanted))), None
            self.windows.add(row_number, cells, self.width, locator)

    def finish(self) -> None:
        if self.head is not None:
            self.head(header_texts(self.header_rows, self.wanted))
        self.windows.flush()


def emit(line):
    sys.stdout.buffer.write(line.encode("utf-8") + b"\n")
    sys.stdout.buffer.flush()


def read_sheet(workbook, archive, sheet_path, shared, rows, limits):
    """One pass of iterparse over the sheet; each row goes to `rows` as it closes. True when it merges cells."""
    member = archive.open(member_info(archive, sheet_path, limits))
    previous, merged, depth, sheet_data = 0, False, 0, None
    try:
        events = ET.iterparse(member, events=("start", "end"))
        _, root = next(events)
        if root.tag != workbook._tag("worksheet"):
            raise Refused("NATIVE_WORKBOOK_INVALID")
        for event, element in events:
            if event == "start":
                depth += 1
                if depth == 1 and element.tag == workbook._tag("sheetData"):
                    sheet_data = element
                continue
            depth -= 1
            if depth == 0:
                merged = merged or element.tag == workbook._tag("mergeCells")
                sheet_data = None
                # Pending events hold their own elements; clearing a parent drops only its references to them.
                root.clear()
            elif depth == 1 and sheet_data is not None and element.tag == workbook._tag("row"):
                row_number = row_reference(element, previous)
                previous = row_number
                cells = row_cells(workbook, element, row_number, shared)
                if hasattr(rows, "take_typed"):
                    text_columns = {workbook._column(workbook.CELL_RE.fullmatch(cell.get("r")).group(1))
                                    for cell in element.findall(workbook._tag("c"))
                                    if cell.get("t") in ("s", "inlineStr", "str")
                                    and cell.find(workbook._tag("f")) is None}
                    rows.take_typed(row_number, cells, text_columns)
                else:
                    rows.take(row_number, cells)
                sheet_data.clear()
    except ET.ParseError:
        raise Refused("NATIVE_WORKBOOK_INVALID") from None
    finally:
        member.close()
    rows.finish()
    return merged


def row_reference(row, previous):
    """Rows are read once, in the order the sheet states them; a row out of order is refused, not sorted."""
    try:
        row_number = int(row.get("r", ""))
    except ValueError:
        raise Refused("NATIVE_WORKBOOK_INVALID") from None
    if not previous < row_number <= 1048576:
        raise Refused("WORKBOOK_ROW_ORDER", row_number)
    return row_number


def qualified(name: str) -> str:
    """Expat's "namespace}local" as ElementTree's "{namespace}local"."""
    return "{" + name if "}" in name else name


def ods_cell_text(state: str, value: str, storage: str | None) -> tuple[str | None, str | None]:
    """The stored text of one ODS cell and its mark; a reader's placeholder is never a value."""
    if state == "empty_string":
        return "", None
    return (value if storage != "none" else None), ODS_MARKS.get(state)


def ods_row_cells(ods: ModuleType, row: ET.Element, row_repeat: int) -> CellValues:
    """Column number to (text, mark) of one row element, expanded as the whole read expands it: a cell with no stored
    value is absent, repeated padding writes nothing, and any other repeated cell holds its stored text in every
    column it covers, up to one column past the widest table, which is enough to refuse it."""
    cells, column = {}, 1
    for cell in row:
        if cell.tag not in (ods._tag(ods.TABLE, "table-cell"), ods._tag(ods.TABLE, "covered-table-cell")):
            raise Refused("ODS_STRUCTURE_UNSUPPORTED")
        repeat = ods._repeat(cell, "number-columns-repeated", ods.MAX_COLUMN)
        if column + repeat - 1 > ods.MAX_COLUMN:
            raise Refused("NATIVE_WORKBOOK_LIMIT")
        state, value, storage, _, _ = ods.cell_reading(cell)
        if "\x00" in value or len(value) > ods.MAX_CELL_CHARS:
            raise Refused("NATIVE_WORKBOOK_LIMIT")
        if state != "empty" and not (row_repeat * repeat > 1 and state in ODS_PADDING):
            text = ods_cell_text(state, value, storage)
            for covered in range(column, min(column + repeat, TABLE_COLUMNS + 2)):
                cells[covered] = text
        column += repeat
    return cells


class RowBytes:
    """The bytes of content.xml fed so far, kept only from the open row's start tag, or from the last tag that may be
    unfinished, so that a row's own XML is hashed exactly as read and no more than one row is held."""

    def __init__(self, limit: int) -> None:
        self.kept, self.start, self.limit = bytearray(), 0, limit
        self.open, self.close, self.empty = b"<", b">", b"/>"

    def add(self, data: bytes) -> None:
        if self.start == 0 and not self.kept:
            if data.startswith((b"\xff\xfe", b"<\x00")):
                self.open, self.close, self.empty = b"<\x00", b">\x00", b"/\x00>\x00"
            elif data.startswith((b"\xfe\xff", b"\x00<")):
                self.open, self.close, self.empty = b"\x00<", b"\x00>", b"\x00/\x00>"
        self.kept += data

    def trim(self, keep_from: int | None, row_number: int) -> None:
        if keep_from is None:
            last = self.kept.rfind(self.open)
            keep_from = self.start + (last if last >= 0 else len(self.kept))
        elif len(self.kept) - (keep_from - self.start) > self.limit:
            raise Refused("TABULAR_RECORD_BUDGET", row_number)
        del self.kept[:keep_from - self.start]
        self.start = keep_from

    def element(self, start: int, end_event: int, empty: bool) -> bytes:
        """From the start tag to the end of the end tag; expat reports an empty-element tag's end after its "/>"."""
        if start < self.start:
            raise Refused("NATIVE_WORKBOOK_INVALID")
        at = end_event - self.start
        if empty and self.kept[at - len(self.empty):at] == self.empty:
            end = at
        else:
            end = self.kept.index(self.close, at) + len(self.close)
        if self.start + end - start > self.limit:
            raise Refused("TABULAR_RECORD_BUDGET")
        return bytes(self.kept[start - self.start:end])


@dataclass
class OpenRow:
    start: int
    depth: int
    builder: ET.TreeBuilder
    content: bool = False


class OdsSheet:
    """One expat pass over content.xml with the whole read's structure checks; only the chosen table's rows are built,
    one row element at a time within the record budget, expanded by their repeats and passed to `rows`."""

    def __init__(self, ods: ModuleType, sheet_name: str, rows: SheetRows, limits: argparse.Namespace) -> None:
        self.ods, self.sheet_name, self.rows, self.bytes = ods, sheet_name, rows, RowBytes(limits.record_bytes)
        self.stack, self.names, self.found, self.merged = [], set(), False, False
        self.bodies, self.spreadsheets = 0, 0
        self.sheet_depth, self.row, self.row_number, self.row_element = None, None, 1, 0
        self.parser = expat.ParserCreate(namespace_separator="}")
        self.parser.StartElementHandler = self.start
        self.parser.EndElementHandler = self.end
        self.parser.CharacterDataHandler = self.data

    def office(self, name: str) -> str:
        return self.ods._tag(self.ods.OFFICE, name)

    def table(self, name: str) -> str:
        return self.ods._tag(self.ods.TABLE, name)

    def feed(self, data: bytes, final: bool = False) -> None:
        self.bytes.add(data)
        try:
            self.parser.Parse(data, final)
        except expat.ExpatError:
            raise Refused("NATIVE_WORKBOOK_INVALID") from None
        self.bytes.trim(self.row.start if self.row else None, self.row_number)

    def finish(self) -> None:
        if self.bodies != 1 or self.spreadsheets != 1:
            raise Refused("ODS_STRUCTURE_UNSUPPORTED")
        if not self.found:
            raise Refused("WORKBOOK_SHEET_MISSING")

    def start(self, name: str, attributes: dict[str, str]) -> None:
        tag = qualified(name)
        attributes = {qualified(key): value for key, value in attributes.items()}
        if self.row is not None:
            self.row.content = True
            self.merged = self.merged or tag == self.table("covered-table-cell")
            self.row.builder.start(tag, attributes)
        else:
            self.structure(tag, attributes)
        self.stack.append(tag)

    def structure(self, tag: str, attributes: dict[str, str]) -> None:
        """The content root, one body holding one spreadsheet, no scripts; then the tables and the chosen one's rows."""
        depth, parent = len(self.stack), self.stack[-1] if self.stack else None
        if depth == 0 and (tag != self.office("document-content")
                           or attributes.get(self.office("version")) not in ODS_VERSIONS):
            raise Refused("ODS_STRUCTURE_UNSUPPORTED")
        if depth == 1 and tag == self.office("body"):
            self.bodies += 1
        elif depth == 2 and parent == self.office("scripts"):
            raise Refused("ODS_SCRIPTS_UNSUPPORTED")
        elif depth == 2 and parent == self.office("body"):
            self.spreadsheets += 1 if tag == self.office("spreadsheet") else 2
        elif depth == 3 and parent == self.office("spreadsheet") and tag == self.table("table"):
            self.open_table(attributes)
        elif self.sheet_depth is not None:
            self.inside_table(tag, attributes, depth)

    def open_table(self, attributes: dict[str, str]) -> None:
        name = attributes.get(self.table("name"))
        if not name or len(name) > 128 or any(ord(letter) < 32 for letter in name) or name in self.names:
            raise Refused("NATIVE_WORKBOOK_INVALID")
        self.names.add(name)
        if len(self.names) > self.ods.MAX_SHEETS:
            raise Refused("NATIVE_WORKBOOK_LIMIT")
        if name == self.sheet_name:
            self.found, self.sheet_depth = True, 4

    def inside_table(self, tag: str, attributes: dict[str, str], depth: int) -> None:
        """A row directly in the chosen table, or in its row groups, is opened; an externally linked table is not."""
        if depth == self.sheet_depth and tag == self.table("table-source"):
            raise Refused("WORKBOOK_SHEET_UNSUPPORTED")
        groups = tuple(self.table(name) for name in ODS_ROW_GROUPS)
        if tag == self.table("table-row") and all(parent in groups for parent in self.stack[self.sheet_depth:]):
            self.row_element += 1
            self.row = OpenRow(self.parser.CurrentByteIndex, depth, ET.TreeBuilder())
            self.row.builder.start(tag, attributes)

    def end(self, _name: str) -> None:
        tag = self.stack.pop()
        if self.row is not None and len(self.stack) == self.row.depth:
            self.close_row(tag)
        elif self.row is not None:
            self.row.builder.end(tag)
        elif self.sheet_depth is not None and len(self.stack) == self.sheet_depth - 1:
            self.sheet_depth = None

    def data(self, text: str) -> None:
        if self.row is not None:
            self.row.content = True
            self.row.builder.data(text)
        elif self.stack[1:] == [self.office("scripts")] and text.strip():
            raise Refused("ODS_SCRIPTS_UNSUPPORTED")

    def close_row(self, tag: str) -> None:
        """A row element and its repeats: each covered row number with cells is one row, citing the element."""
        row, self.row = self.row, None
        row.builder.end(tag)
        element = row.builder.close()
        raw = self.bytes.element(row.start, self.parser.CurrentByteIndex, not row.content)
        repeat = self.ods._repeat(element, "number-rows-repeated", self.ods.MAX_ROW)
        if self.row_number + repeat - 1 > self.ods.MAX_ROW:
            raise Refused("NATIVE_WORKBOOK_LIMIT", self.row_number)
        cells = ods_row_cells(self.ods, element, repeat)
        locator = {"rowElement": self.row_element, "rowSha256": hashlib.sha256(raw).hexdigest()}
        for offset in range(repeat if cells else 0):
            if hasattr(self.rows, "take_ods"):
                self.rows.take_ods(self.row_number + offset, cells, element, self.ods)
            else:
                self.rows.take(self.row_number + offset, cells, locator)
        self.row_number += repeat


def member_head(archive: zipfile.ZipFile, path: str, limits: argparse.Namespace) -> dict:
    """The sheet line's citation of one member: its SHA-256 and size as read, and its stored bytes in the original."""
    info = member_info(archive, path, limits)
    member = GuardedMember(archive, info, limits.member_bytes)
    try:
        member_sha256, member_bytes = member.drain()
    finally:
        member.close()
    byte_start, byte_end, stored_sha256 = stored_range(limits.file_path, info)
    return {"kind": "sheet", "sheet": limits.sheet, "member": path, "memberSha256": member_sha256,
            "memberBytes": member_bytes, "byteStart": byte_start, "byteEnd": byte_end, "storedSha256": stored_sha256}


def sheet_line(fields: dict) -> Callable[[list[str]], list[str]]:
    def head(headers: list[str]) -> list[str]:
        emit(json.dumps({**fields, "headers": headers}, ensure_ascii=False, separators=(",", ":")))
        return headers

    return head


def stream_xlsx(workbook: ModuleType, archive: zipfile.ZipFile, limits: argparse.Namespace,
                wanted: set[int]) -> tuple[Windows, bool, int]:
    sheet_path, shared_path = locate_sheet(workbook, archive, limits.sheet)
    head = sheet_line(member_head(archive, sheet_path, limits))
    shared = shared_strings(workbook, archive, shared_path, limits)
    rows = SheetRows(wanted, Windows(limits), head)
    merged = read_sheet(workbook, archive, sheet_path, shared, rows, limits)
    return rows.windows, merged, len(shared)


def stream_ods(ods: ModuleType, archive: zipfile.ZipFile, limits: argparse.Namespace,
               wanted: set[int]) -> tuple[Windows, bool, int]:
    """content.xml holds every sheet of an ODS; it is read once to hash it and once to stream the chosen table."""
    for path in ("mimetype", "META-INF/manifest.xml"):
        member_info(archive, path, limits)
    refusal = ods.package_refusal(archive)
    if refusal is not None:
        raise Refused(refusal["code"])
    if any(name.startswith(("Scripts/", "Basic/")) for name in archive.namelist()):
        raise Refused("ODS_SCRIPTS_UNSUPPORTED")
    rows = SheetRows(wanted, Windows(limits), sheet_line(member_head(archive, "content.xml", limits)))
    sheet = OdsSheet(ods, limits.sheet, rows, limits)
    member = archive.open(member_info(archive, "content.xml", limits))
    try:
        while data := member.read(READ_BYTES):
            sheet.feed(data)
        sheet.feed(b"", final=True)
    finally:
        member.close()
    sheet.finish()
    rows.finish()
    return rows.windows, sheet.merged, 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("services_geo_path")
    parser.add_argument("file_path")
    parser.add_argument("--sheet", required=True)
    parser.add_argument("--header-rows", required=True)
    for name in ("rows", "window-rows", "window-bytes", "record-bytes", "windows", "member-bytes", "ratio"):
        parser.add_argument(f"--{name}", type=int, required=True)
    limits = parser.parse_args()
    wanted = {int(row) for row in limits.header_rows.split(",")}
    workbook, ods = native(limits.services_geo_path)
    try:
        with zipfile.ZipFile(limits.file_path) as archive:
            if len(archive.infolist()) > MAX_ARCHIVE_MEMBERS:
                raise Refused("COLUMN_WORKBOOK_LIMIT")
            if ods.is_ods_archive(archive):
                windows, merged, shared = stream_ods(ods, archive, limits, wanted)
            else:
                windows, merged, shared = stream_xlsx(workbook, archive, limits, wanted)
            emit(json.dumps({"kind": "end", "records": windows.records, "windows": windows.index,
                             "marks": windows.marks, "mergedRanges": merged, "sharedStrings": shared},
                            separators=(",", ":")))
    except Refused as refusal:
        emit(json.dumps({"kind": "refused", "code": refusal.code, "row": refusal.row}))
        raise SystemExit(2) from None
    except workbook.InputError as refusal:
        emit(json.dumps({"kind": "refused", "code": str(refusal), "row": None}))
        raise SystemExit(2) from None
    except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError):
        emit(json.dumps({"kind": "refused", "code": "NATIVE_WORKBOOK_INVALID", "row": None}))
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
