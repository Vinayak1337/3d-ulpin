"""Choose candidate table headers with the existing bounded workbook stream readers; never evaluate cells."""

import argparse
import json
import zipfile
from types import ModuleType

from read_workbook_cells import MAX_ARCHIVE_MEMBERS
from read_workbook_windows import (
    GuardedMember, OdsSheet, Refused, locate_sheet, member_info, native, read_sheet, shared_strings,
)


class HeaderRows:
    """First pass: used columns. Second pass: the earliest header and up to two following shapes."""

    def __init__(self, limits: argparse.Namespace, used: set[int] | None = None) -> None:
        self.limits, self.sample, self.used, self.count = limits, [], set(), 0
        self.known, self.header, self.before = used, None, 0

    def take_ods(self, number: int, cells: dict, element, ods) -> None:
        column, text = 1, set()
        for cell in element:
            repeat = ods._repeat(cell, "number-columns-repeated", ods.MAX_COLUMN)
            if cell.get(ods._tag(ods.OFFICE, "value-type")) == "string":
                text.update(range(column, min(column + repeat, 257)))
            column += repeat
        self.take_typed(number, cells, text)

    def take_typed(self, number: int, cells: dict, text_columns: set[int]) -> None:
        occupied = {column for column, (value, mark) in cells.items() if mark or (value or "").strip()}
        if not occupied:
            return
        self.count += 1
        # Up to 2,000 physical rows may precede the body under the existing header selection bound.
        if self.count > self.limits.rows + 2000:
            raise Refused("TABULAR_STREAM_ROWS")
        if max(occupied) > 256:
            raise Refused("TABULAR_SCHEMA_DRIFT", number)
        if sum(len((value or "").encode("utf-8")) for value, _ in cells.values()) > self.limits.record_bytes:
            raise Refused("TABULAR_RECORD_BUDGET", number)
        self.used.update(occupied)
        if self.known is not None and self.header is None:
            text = {column for column, (value, mark) in cells.items()
                    if column in text_columns and mark is None and (value or "").strip()}
            self.sample.append((number, occupied, text, self.count))
            if len(self.sample) == 3:
                self.choose()
                self.sample.pop(0)
        if self.header is not None and self.count - self.before > self.limits.rows:
            raise Refused("TABULAR_STREAM_ROWS")

    def finish(self) -> None:
        pass

    def choose(self) -> None:
        if self.header is not None or len(self.sample) < 2:
            return
        number, shape, text, ordinal = self.sample[0]
        if (len(text & self.known) > len(self.known) / 2 and max(shape) == max(self.known)
                and all(other == shape for _, other, _, _ in self.sample[1:])):
            self.header, self.before = number, ordinal

    def result(self, name: str, skip: str | None = None) -> dict:
        self.choose()
        return {"name": name, "headerRow": self.header, "rows": None if skip else self.count - self.before,
                "skip": skip or ("empty" if not self.count else None)}


def guard(archive: zipfile.ZipFile, path: str, limits: argparse.Namespace) -> None:
    member = GuardedMember(archive, member_info(archive, path, limits), limits.member_bytes)
    try:
        member.drain()
    finally:
        member.close()


def xlsx_profile(workbook: ModuleType, archive: zipfile.ZipFile, limits: argparse.Namespace) -> list[dict]:
    root = workbook._xml(archive, "xl/workbook.xml")
    sheets = root.findall(f"{workbook._tag('sheets')}/{workbook._tag('sheet')}")
    if not sheets or len(sheets) > workbook.MAX_SHEETS:
        raise Refused("NATIVE_WORKBOOK_LIMIT")
    results, shared = [], None
    for sheet in sheets:
        name = sheet.get("name")
        rows = HeaderRows(limits)
        if sheet.get("state", "visible") != "visible":
            results.append(rows.result(name, "hidden"))
            continue
        try:
            path, strings = locate_sheet(workbook, archive, name)
        except Refused as refusal:
            if refusal.code != "WORKBOOK_SHEET_UNSUPPORTED":
                raise
            results.append(rows.result(name, "chart-only or unsupported sheet"))
            continue
        if shared is None:
            shared = shared_strings(workbook, archive, strings, limits)
        try:
            guard(archive, path, limits)
            read_sheet(workbook, archive, path, shared, rows, limits)
            choice = HeaderRows(limits, rows.used)
            read_sheet(workbook, archive, path, shared, choice, limits)
            results.append(choice.result(name))
        except Refused as refusal:
            results.append(rows.result(name, refusal.code))
    return results


class OdsInventory(OdsSheet):
    def __init__(self, ods: ModuleType, limits: argparse.Namespace) -> None:
        super().__init__(ods, "", HeaderRows(limits), limits)
        self.sheets, self.hidden_styles, self.style = [], set(), None

    def open_table(self, attributes: dict) -> None:
        super().open_table(attributes)
        self.sheets.append(attributes)

    def structure(self, tag: str, attributes: dict) -> None:
        super().structure(tag, attributes)
        style = "{urn:oasis:names:tc:opendocument:xmlns:style:1.0}"
        if tag == style + "style":
            self.style = attributes.get(style + "name")
        if tag == style + "table-properties" and attributes.get(self.table("display")) == "false":
            self.hidden_styles.add(self.style)


def feed_ods(archive: zipfile.ZipFile, sheet: OdsSheet) -> None:
    with archive.open("content.xml") as member:
        while data := member.read(1024 * 1024):
            sheet.feed(data)
        sheet.feed(b"", final=True)


def ods_profile(ods: ModuleType, archive: zipfile.ZipFile, limits: argparse.Namespace) -> list[dict]:
    refusal = ods.package_refusal(archive)
    if refusal is not None:
        raise Refused(refusal["code"])
    if any(name.startswith(("Scripts/", "Basic/")) for name in archive.namelist()):
        raise Refused("ODS_SCRIPTS_UNSUPPORTED")
    guard(archive, "content.xml", limits)
    inventory = OdsInventory(ods, limits)
    feed_ods(archive, inventory)
    results = []
    for attributes in inventory.sheets:
        name, rows = attributes[inventory.table("name")], HeaderRows(limits)
        if (attributes.get(inventory.table("display")) == "false"
                or attributes.get(inventory.table("style-name")) in inventory.hidden_styles):
            results.append(rows.result(name, "hidden"))
            continue
        try:
            sheet = OdsSheet(ods, name, rows, limits)
            feed_ods(archive, sheet)
            sheet.finish()
            choice = HeaderRows(limits, rows.used)
            sheet = OdsSheet(ods, name, choice, limits)
            feed_ods(archive, sheet)
            sheet.finish()
            results.append(choice.result(name))
        except Refused as refusal:
            results.append(rows.result(name, refusal.code))
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("services_geo_path")
    parser.add_argument("file_path")
    for name in ("rows", "record-bytes", "member-bytes", "ratio"):
        parser.add_argument(f"--{name}", type=int, required=True)
    limits = parser.parse_args()
    workbook, ods = native(limits.services_geo_path)
    try:
        with zipfile.ZipFile(limits.file_path) as archive:
            if len(archive.infolist()) > MAX_ARCHIVE_MEMBERS:
                raise Refused("COLUMN_WORKBOOK_LIMIT")
            result = ods_profile(ods, archive, limits) if ods.is_ods_archive(archive) else xlsx_profile(
                workbook, archive, limits)
        print(json.dumps(result, ensure_ascii=False))
    except (Refused, workbook.InputError, zipfile.BadZipFile, EOFError):
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
