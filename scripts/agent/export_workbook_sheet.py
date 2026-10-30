"""Write one candidate sheet as literal UTF-8 CSV, using the guarded streaming workbook readers."""

import argparse
import csv
import hashlib
import io
import json
import zipfile
from pathlib import Path

from profile_workbook import guard, marked_within
from read_workbook_cells import MAX_ARCHIVE_MEMBERS
from read_workbook_windows import OdsSheet, Refused, locate_sheet, native, read_sheet, shared_strings


class CsvRows:
    def __init__(self, output: Path, limits: argparse.Namespace) -> None:
        self.limits = limits
        self.target = output.open("xb")
        self.digest, self.bytes, self.records, self.width = hashlib.sha256(), 0, 0, 0
        self.previous = limits.header - 1
        self.headerless = getattr(limits, "headerless", False)
        self.columns = []
        self.body_cells, self.marked = 0, 0

    def write(self, cells: dict) -> None:
        text = io.StringIO(newline="")
        csv.writer(text, lineterminator="\r\n").writerow(
            cells.get(column, (None, None))[0] for column in self.columns)
        data = text.getvalue().encode("utf-8")
        if len(data) > self.limits.record_bytes:
            raise Refused("TABULAR_RECORD_BUDGET")
        self.bytes += len(data)
        if self.bytes > self.limits.bytes:
            raise Refused("SHEET_CSV_RECEIPT_BYTE_LIMIT")
        self.target.write(data)
        self.digest.update(data)

    def take(self, number: int, cells: dict, _locator: dict | None = None) -> None:
        if number < self.limits.header or not cells:
            return
        if not self.width:
            if number != self.limits.header:
                raise Refused("TABULAR_HEADER_REQUIRED")
            self.columns = list(range(1, max(cells) + 1))
            if self.headerless:
                self.columns = [int(column) for column in self.limits.columns.split(",")]
            self.width = len(self.columns)
            if max(self.columns) > 256 or (not self.headerless
                    and any(len(value or "") > 400 for value, _ in cells.values())):
                raise Refused("TABULAR_HEADER_REQUIRED")
            if self.headerless:
                self.write({column: (f"column_{index + 1}", None)
                            for index, column in enumerate(self.columns)})
        occupied = {column for column, (value, mark) in cells.items() if mark or (value or "").strip()}
        if self.headerless:
            if not occupied.issubset(self.columns):
                raise Refused("TABULAR_SCHEMA_DRIFT")
        elif max(cells) > self.width:
            raise Refused("TABULAR_SCHEMA_DRIFT")
        if (self.headerless or number > self.limits.header) and self.records >= self.limits.rows:
            raise Refused("TABULAR_STREAM_ROWS")
        for _ in range(self.previous + 1, number):
            self.write({})
        self.write(self.unmarked(number, cells, occupied))
        self.previous = number
        if self.headerless or number > self.limits.header:
            self.records += 1

    def unmarked(self, number: int, cells: dict, occupied: set[int]) -> dict:
        """A marked header cell refuses; a marked body cell is written empty and counted, never valued."""
        marked = {column for column, (_, mark) in cells.items() if mark is not None}
        if not self.headerless and number == self.limits.header:
            if marked:
                raise Refused("WORKBOOK_MARKED_CELLS_NOT_CSV")
            return cells
        self.body_cells += len(occupied)
        self.marked += len(marked)
        return {column: (None, None) if column in marked else cell for column, cell in cells.items()}

    def finish(self) -> None:
        if not self.width:
            raise Refused("TABULAR_HEADER_REQUIRED")
        if not marked_within(self.marked, self.body_cells):
            raise Refused("WORKBOOK_MARKED_CELLS_NOT_CSV")


def export(limits: argparse.Namespace, rows: CsvRows) -> None:
    workbook, ods = native(limits.services_geo_path)
    with zipfile.ZipFile(limits.file_path) as archive:
        if len(archive.infolist()) > MAX_ARCHIVE_MEMBERS:
            raise Refused("COLUMN_WORKBOOK_LIMIT")
        if ods.is_ods_archive(archive):
            refusal = ods.package_refusal(archive)
            if refusal:
                raise Refused(refusal["code"])
            guard(archive, "content.xml", limits)
            sheet = OdsSheet(ods, limits.sheet, rows, limits)
            with archive.open("content.xml") as member:
                while data := member.read(1024 * 1024):
                    sheet.feed(data)
                sheet.feed(b"", final=True)
            sheet.finish()
        else:
            path, strings = locate_sheet(workbook, archive, limits.sheet)
            guard(archive, path, limits)
            shared = shared_strings(workbook, archive, strings, limits)
            read_sheet(workbook, archive, path, shared, rows, limits)
        rows.finish()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("services_geo_path")
    parser.add_argument("file_path")
    parser.add_argument("output", type=Path)
    parser.add_argument("--sheet", required=True)
    parser.add_argument("--headerless", action="store_true")
    parser.add_argument("--columns", default="")
    for name in ("header", "rows", "record-bytes", "member-bytes", "ratio", "bytes"):
        parser.add_argument(f"--{name}", type=int, required=True)
    limits = parser.parse_args()
    rows = CsvRows(limits.output, limits)
    try:
        export(limits, rows)
        print(json.dumps({"bytes": rows.bytes, "sha256": rows.digest.hexdigest(), "rows": rows.records,
                          "markedCellsLeftEmpty": rows.marked}))
    except Refused as refusal:
        print(json.dumps({"skip": refusal.code}))
    finally:
        rows.target.close()


if __name__ == "__main__":
    main()
