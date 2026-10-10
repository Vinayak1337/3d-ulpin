"""Return bounded native spreadsheet/HTML cells without evaluating source code."""

import json
from html.parser import HTMLParser
from pathlib import Path
import sys
from typing import Any
import zipfile

MAX_ARCHIVE_MEMBERS = 512
MAX_EXPANDED_BYTES = 20_000_000


class TableSelector(HTMLParser):
    """Locate an explicit HTML id in the native reader's source-order numbering."""

    def __init__(self, table_id: str, text: str) -> None:
        super().__init__()
        self.table_id = table_id
        self.text = text
        self.line_offsets = [0]
        for line in text.splitlines(keepends=True):
            self.line_offsets.append(self.line_offsets[-1] + len(line))
        self.table_count = 0
        self.depth = 0
        self.selected_depth: int | None = None
        self.start: int | None = None
        self.end: int | None = None
        self.matches: list[str] = []

    def position(self) -> int:
        line, column = self.getpos()
        return self.line_offsets[line - 1] + column

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "table":
            return
        self.table_count += 1
        self.depth += 1
        if dict(attrs).get("id") == self.table_id:
            self.matches.append(f"table-{self.table_count}")
            self.start = self.position()
            self.selected_depth = self.depth

    def handle_endtag(self, tag: str) -> None:
        if tag != "table":
            return
        if self.depth == self.selected_depth:
            self.end = self.text.index(">", self.position()) + 1
        self.depth -= 1

    def selected_html(self) -> str:
        if len(self.matches) != 1 or self.start is None or self.end is None:
            raise ValueError("COLUMN_HTML_TABLE_UNAVAILABLE")
        return self.text[self.start:self.end]


def read_html_cells(services_geo_path: Path, file_path: Path, table_id: str | None) -> dict[str, Any]:
    sys.path.insert(0, str(services_geo_path.resolve()))
    from geo.native_html_table import _decode_html, extract_native_html_tables

    raw = file_path.read_bytes()
    if not table_id:
        return extract_native_html_tables(raw)
    text = _decode_html(raw)
    selector = TableSelector(table_id, text)
    selector.feed(text)
    selector.close()
    # Select source bytes before cell extraction; unrelated tables cannot consume the cell budget.
    selected = selector.selected_html()
    result = extract_native_html_tables(selected.encode("utf-8"))
    result["parts"] = [part for part in result["parts"] if part["locator"]["sheet"] == "table-1"]
    source_sheet = selector.matches[0]
    source_index = int(source_sheet.removeprefix("table-"))
    for part in result["parts"]:
        locator = part["locator"]
        locator["sheet"] = source_sheet
        locator["sheetIndex"] = source_index
        locator["label"] = f"HTML table {source_index} ({source_sheet}), cell {locator['cell']}"
        if "nestedSheet" in locator:
            locator["nestedSheet"] = remap_nested_sheet(locator["nestedSheet"], source_index)
        if "nestedSheets" in locator:
            locator["nestedSheets"] = [remap_nested_sheet(sheet, source_index) for sheet in locator["nestedSheets"]]
    return result


def remap_nested_sheet(sheet: str, source_index: int) -> str:
    return f"table-{int(sheet.removeprefix('table-')) + source_index - 1}"


def read_workbook_cells(services_geo_path: Path, file_path: Path) -> dict[str, Any]:
    """Reuse the application's native readers and their XML/cell limits."""
    sys.path.insert(0, str(services_geo_path.resolve()))
    from geo.native_ods import extract_native_ods, is_ods_archive
    from geo.native_workbook import extract_native_workbook

    with zipfile.ZipFile(file_path) as archive:
        members = archive.infolist()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise ValueError("COLUMN_WORKBOOK_LIMIT")
        if sum(member.file_size for member in members) > MAX_EXPANDED_BYTES:
            raise ValueError("COLUMN_WORKBOOK_LIMIT")
        if is_ods_archive(archive):
            return extract_native_ods(archive)
        return extract_native_workbook(archive)


def main() -> None:
    if len(sys.argv) not in (3, 4):
        raise SystemExit("Usage: read_workbook_cells.py <services-geo-path> <file-path> [html-table-id]")
    services_geo_path, file_path = Path(sys.argv[1]), Path(sys.argv[2])
    if file_path.suffix.lower() in (".html", ".htm"):
        result = read_html_cells(services_geo_path, file_path, sys.argv[3] if len(sys.argv) == 4 else None)
    else:
        result = read_workbook_cells(services_geo_path, file_path)
    # ASCII JSON transport round-trips source Unicode even with Windows cp1252 stdout.
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
