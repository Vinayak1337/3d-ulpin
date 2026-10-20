"""Stream one XLSX sheet as JSON lines of row windows, without spreadsheet evaluation.

The sheet XML is never loaded whole: its member is read twice as a stream, once to hash it behind the DTD
guard and once through ElementTree iterparse, each finished row cleared. Lines on stdout, in order: one
"sheet" line (headers and the member's SHA-256 and stored byte range), one "window" line per window of rows,
then one "end" line; a refusal is one "refused" line with its code and a nonzero exit.
"""

import argparse
import hashlib
import json
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from xml.parsers import expat

from read_workbook_cells import MAX_ARCHIVE_MEMBERS

READ_BYTES = 1024 * 1024
# Measured with this reader on generated workbooks (docs/evidence/gf1/xw1/result.json): 100,000 shared strings of
# 34 characters peak at 43 MiB and 1,000,000 at 120 MiB, about 90 bytes a string; the character bound keeps longer
# strings near the same figure.
MAX_SHARED_STRINGS = 1_000_000
MAX_SHARED_CHARACTERS = 64 * 1024 * 1024
MARKS = ("formula_cached", "formula_uncached", "no_value", "error", "unsupported")


class Refused(Exception):
    def __init__(self, code, row=None):
        super().__init__(code)
        self.code, self.row = code, row


def native(services_geo_path):
    sys.path.insert(0, str(Path(services_geo_path).resolve()))
    import geo.native_workbook as workbook
    return workbook


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
    """The member's stored bytes in the original: after its local header, for its compressed size."""
    with open(file_path, "rb") as source:
        source.seek(info.header_offset)
        header = source.read(30)
    if len(header) != 30 or header[:4] != b"PK\x03\x04":
        raise Refused("NATIVE_WORKBOOK_INVALID")
    names, extra = struct.unpack("<HH", header[26:30])
    start = info.header_offset + 30 + names + extra
    return start, start + info.compress_size


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

    def add(self, row_number, cells, width):
        if max(cells, default=0) > width:
            raise Refused("TABULAR_SCHEMA_DRIFT", row_number)
        record = {"row": row_number, "cells": [cells.get(column, (None, None))[0] for column in range(1, width + 1)]}
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
        self.rows.append(text)
        self.bytes += size + 1
        if len(self.rows) >= self.limits.window_rows or self.bytes >= self.limits.window_bytes:
            self.flush()

    def flush(self):
        if not self.rows:
            return
        if self.index >= self.limits.windows:
            raise Refused("TABULAR_STREAM_WINDOWS")
        emit(f'{{"kind":"window","index":{self.index},"rows":[{",".join(self.rows)}]}}')
        self.index, self.rows, self.bytes = self.index + 1, [], 0


def emit(line):
    sys.stdout.buffer.write(line.encode("utf-8") + b"\n")
    sys.stdout.buffer.flush()


def read_sheet(workbook, archive, sheet_path, shared, wanted, limits, head):
    """One pass of iterparse over the sheet; header rows first, then every row after them in windows."""
    member = archive.open(member_info(archive, sheet_path, limits))
    header_rows, last_header, previous, windows, merged = {}, max(wanted), 0, Windows(limits), False
    depth, sheet_data, width = 0, None, 0
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
                if row_number in wanted and cells:
                    header_rows[row_number] = cells
                elif row_number > last_header and cells:
                    if head is not None:
                        width, head = len(head(header_texts(header_rows, wanted))), None
                    windows.add(row_number, cells, width)
                sheet_data.clear()
    except ET.ParseError:
        raise Refused("NATIVE_WORKBOOK_INVALID") from None
    finally:
        member.close()
    if head is not None:
        head(header_texts(header_rows, wanted))
    windows.flush()
    return windows, merged


def row_reference(row, previous):
    """Rows are read once, in the order the sheet states them; a row out of order is refused, not sorted."""
    try:
        row_number = int(row.get("r", ""))
    except ValueError:
        raise Refused("NATIVE_WORKBOOK_INVALID") from None
    if not previous < row_number <= 1048576:
        raise Refused("WORKBOOK_ROW_ORDER", row_number)
    return row_number


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("services_geo_path")
    parser.add_argument("file_path")
    parser.add_argument("--sheet", required=True)
    parser.add_argument("--header-rows", required=True)
    for name in ("rows", "window-rows", "window-bytes", "record-bytes", "windows", "member-bytes", "ratio"):
        parser.add_argument(f"--{name}", type=int, required=True)
    limits = parser.parse_args()
    wanted = [int(row) for row in limits.header_rows.split(",")]
    workbook = native(limits.services_geo_path)
    try:
        with zipfile.ZipFile(limits.file_path) as archive:
            if len(archive.infolist()) > MAX_ARCHIVE_MEMBERS:
                raise Refused("COLUMN_WORKBOOK_LIMIT")
            sheet_path, shared_path = locate_sheet(workbook, archive, limits.sheet)
            info = member_info(archive, sheet_path, limits)
            member = GuardedMember(archive, info, limits.member_bytes)
            try:
                member_sha256, member_bytes = member.drain()
            finally:
                member.close()
            byte_start, byte_end = stored_range(limits.file_path, info)
            shared = shared_strings(workbook, archive, shared_path, limits)

            def head(headers):
                emit(json.dumps({"kind": "sheet", "sheet": limits.sheet, "member": sheet_path,
                                 "memberSha256": member_sha256, "memberBytes": member_bytes,
                                 "byteStart": byte_start, "byteEnd": byte_end, "headers": headers},
                                ensure_ascii=False, separators=(",", ":")))
                return headers

            windows, merged = read_sheet(workbook, archive, sheet_path, shared, set(wanted), limits, head)
            emit(json.dumps({"kind": "end", "records": windows.records, "windows": windows.index,
                             "marks": windows.marks, "mergedRanges": merged, "sharedStrings": len(shared)},
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
