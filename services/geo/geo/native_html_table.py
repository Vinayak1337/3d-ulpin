"""Bounded HTML table cells as source references, without semantic or layout inference."""

from __future__ import annotations

import codecs
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any

from .native_ods import _cell_ref
from .native_workbook import MAX_CELL_CHARS, MAX_CELLS, MAX_ROWS, MAX_TEXT_CHARS
from .validation import InputError

MAX_HTML_BYTES = 10 * 1024 * 1024
MAX_TABLES = 200
HEADINGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
ROW_GROUPS = frozenset({"thead", "tbody", "tfoot"})
Attributes = list[tuple[str, str | None]]
Part = dict[str, Any]


class _CharsetCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.charset: str | None = None

    def handle_starttag(self, tag: str, attrs: Attributes) -> None:
        if tag != "meta" or self.charset is not None:
            return
        values = dict(attrs)
        charset = values.get("charset")
        if not charset and (values.get("http-equiv") or "").lower() == "content-type":
            match = re.search(r"(?:^|;)\s*charset\s*=\s*[\"']?([^\s;\"']+)",
                              values.get("content") or "", re.IGNORECASE)
            if match:
                charset = match.group(1)
        if charset:
            self.charset = charset.strip()


def _decode_html(raw: bytes) -> str:
    if len(raw) > MAX_HTML_BYTES:
        raise InputError("NATIVE_HTML_LIMIT")
    encoding = None
    for marker, name in ((codecs.BOM_UTF32_LE, "utf-32"), (codecs.BOM_UTF32_BE, "utf-32"),
                         (codecs.BOM_UTF8, "utf-8-sig"), (codecs.BOM_UTF16_LE, "utf-16"),
                         (codecs.BOM_UTF16_BE, "utf-16")):
        if raw.startswith(marker):
            encoding = name
            break
    if encoding is None:
        collector = _CharsetCollector()
        collector.feed(raw.decode("latin-1"))
        collector.close()
        encoding = collector.charset or "utf-8"
    try:
        text = raw.decode(encoding)
    except (LookupError, UnicodeError, ValueError):
        raise InputError("NATIVE_HTML_ENCODING_UNSUPPORTED") from None
    if "\x00" in text:
        raise InputError("NATIVE_HTML_ENCODING_UNSUPPORTED")
    return text


@dataclass
class _Text:
    pieces: list[str | None] = field(default_factory=list)
    size: int = 0

    def add(self, value: str | None) -> None:
        self.size += len(value) if value is not None else 1
        if self.size > MAX_CELL_CHARS:
            raise InputError("NATIVE_HTML_LIMIT")
        self.pieces.append(value)

    def value(self) -> str:
        # Only explicit <br> boundaries survive; source whitespace is collapsed.
        lines: list[list[str]] = [[]]
        for piece in self.pieces:
            if piece is None:
                lines.append([])
            else:
                lines[-1].append(piece)
        return "\n".join(" ".join("".join(line).split()) for line in lines)


@dataclass
class _Cell:
    cell_type: str
    row_span: int = 1
    column_span: int = 1
    text: _Text = field(default_factory=_Text)
    nested_sheets: list[str] = field(default_factory=list)


@dataclass
class _Row:
    group: int
    cells: list[_Cell] = field(default_factory=list)


@dataclass
class _Table:
    index: int
    heading: str | None
    rows: list[_Row] = field(default_factory=list)
    caption: _Text = field(default_factory=_Text)
    caption_active: bool = False
    group: int = 0
    row: _Row | None = None
    cell: _Cell | None = None


def _span(value: str | None, maximum: int, allow_zero: bool = False) -> int:
    lexical = (value or "1").strip()
    if not re.fullmatch(r"[0-9]+", lexical):
        return 1
    if len(lexical) > 6 or int(lexical) > maximum:
        raise InputError("NATIVE_HTML_LIMIT")
    count = int(lexical)
    if count == 0 and not allow_zero:
        return 1
    return count


class _TableCollector(HTMLParser):
    """Collect source elements only; grid placement and part creation stay separate."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[_Table] = []
        self.stack: list[_Table] = []
        self.heading: _Text | None = None
        self.heading_tag: str | None = None
        self.last_heading: str | None = None
        self.ignored_tag: str | None = None
        self.row_count = 0
        self.cell_count = 0
        self.text_size = 0

    def _finish_heading(self) -> None:
        if self.heading is not None:
            self.last_heading = self.heading.value() or None
        self.heading = None
        self.heading_tag = None

    def _start_table(self) -> None:
        self._finish_heading()
        if len(self.tables) >= MAX_TABLES:
            raise InputError("NATIVE_HTML_LIMIT")
        table = _Table(len(self.tables) + 1, self.last_heading)
        if self.stack and self.stack[-1].cell is not None:
            self.stack[-1].cell.nested_sheets.append(f"table-{table.index}")
        self.tables.append(table)
        self.stack.append(table)

    def _start_row(self, table: _Table) -> None:
        self.row_count += 1
        if self.row_count > MAX_ROWS:
            raise InputError("NATIVE_HTML_LIMIT")
        table.row = _Row(table.group)
        table.rows.append(table.row)
        table.cell = None

    def _start_cell(self, table: _Table, tag: str, attrs: Attributes) -> None:
        if table.row is None:
            return
        self.cell_count += 1
        if self.cell_count > MAX_CELLS:
            raise InputError("NATIVE_HTML_LIMIT")
        values = dict(attrs)
        table.cell = _Cell("header" if tag == "th" else "data",
                           _span(values.get("rowspan"), MAX_ROWS, allow_zero=True),
                           _span(values.get("colspan"), MAX_CELLS))
        table.row.cells.append(table.cell)

    def handle_starttag(self, tag: str, attrs: Attributes) -> None:
        if self.ignored_tag is not None:
            return
        if tag in ("script", "style"):
            self.ignored_tag = tag
        elif tag in HEADINGS:
            self._finish_heading()
            self.heading = _Text()
            self.heading_tag = tag
        elif tag == "table":
            self._start_table()
        elif tag == "br":
            self._add_text(None)
        elif self.stack:
            table = self.stack[-1]
            if tag in ROW_GROUPS:
                table.group += 1
                table.row = table.cell = None
            elif tag == "caption":
                table.caption_active = True
            elif tag == "tr":
                self._start_row(table)
            elif tag in ("td", "th"):
                self._start_cell(table, tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if self.ignored_tag is not None:
            if tag == self.ignored_tag:
                self.ignored_tag = None
            return
        if tag == self.heading_tag:
            self._finish_heading()
        if not self.stack:
            return
        table = self.stack[-1]
        if tag == "table":
            self.stack.pop()
        elif tag == "caption":
            table.caption_active = False
        elif tag in ("td", "th"):
            table.cell = None
        elif tag == "tr" or tag in ROW_GROUPS:
            table.row = table.cell = None
            if tag in ROW_GROUPS:
                table.group += 1

    def handle_startendtag(self, tag: str, attrs: Attributes) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def _add_text(self, value: str | None) -> None:
        targets = []
        if self.heading is not None:
            targets.append(self.heading)
        if self.stack:
            table = self.stack[-1]
            if table.caption_active:
                targets.append(table.caption)
            elif table.cell is not None:
                targets.append(table.cell.text)
        if targets:
            self.text_size += len(value) if value is not None else 1
            if self.text_size > MAX_TEXT_CHARS:
                raise InputError("NATIVE_HTML_LIMIT")
        for target in targets:
            target.add(value)

    def handle_data(self, data: str) -> None:
        if self.ignored_tag is None:
            self._add_text(data)


@dataclass(frozen=True)
class _GridCell:
    source: _Cell
    span_of: str | None = None


Grid = dict[tuple[int, int], _GridCell]


def _place_cells(rows: list[_Row]) -> Grid:
    grid: Grid = {}
    group_ends = {row.group: index for index, row in enumerate(rows, 1)}
    for row_number, row in enumerate(rows, 1):
        column = 1
        for cell in row.cells:
            while (row_number, column) in grid:
                column += 1
            available_rows = group_ends[row.group] - row_number + 1
            row_span = min(cell.row_span or available_rows, available_rows)
            if column + cell.column_span - 1 > MAX_CELLS:
                raise InputError("NATIVE_HTML_LIMIT")
            source_ref = _cell_ref(column, row_number)
            for covered_row in range(row_number, row_number + row_span):
                for covered_column in range(column, column + cell.column_span):
                    position = (covered_row, covered_column)
                    if position in grid:
                        raise InputError("NATIVE_HTML_INVALID")
                    span_of = None if position == (row_number, column) else source_ref
                    grid[position] = _GridCell(cell, span_of)
                    if len(grid) > MAX_CELLS:
                        raise InputError("NATIVE_HTML_LIMIT")
            column += cell.column_span
    return grid


def _cell_value(cell: _GridCell) -> tuple[str, str]:
    if cell.span_of is not None:
        return "", "spanned"
    text = cell.source.text.value()
    if cell.source.nested_sheets:
        return text, "nested_table"
    if text.strip():
        return text, "literal"
    if cell.source.text.size:
        return text, "whitespace"
    return "", "empty_string"


def _grid_parts(grid: Grid, sheet: str, caption: str | None) -> list[Part]:
    parts: list[Part] = []
    sheet_index = int(sheet.removeprefix("table-"))
    for (row, column), cell in sorted(grid.items()):
        ref = _cell_ref(column, row)
        text, state = _cell_value(cell)
        locator: dict[str, Any] = {
            "sheet": sheet, "sheetIndex": sheet_index, "caption": caption, "cell": ref,
            "row": row, "column": column, "cellState": state, "cellType": cell.source.cell_type,
            "label": f"HTML table {sheet_index} ({sheet}), cell {ref}",
        }
        if cell.span_of is not None:
            locator["spanOf"] = cell.span_of
        elif cell.source.nested_sheets:
            locator["nestedSheet"] = cell.source.nested_sheets[0]
            if len(cell.source.nested_sheets) > 1:
                locator["nestedSheets"] = list(cell.source.nested_sheets)
        parts.append({"id": f"part-{len(parts) + 1}", "text": text, "locator": locator})
    return parts


def extract_native_html_tables(raw: bytes) -> dict[str, Any]:
    collector = _TableCollector()
    collector.feed(_decode_html(raw))
    collector.close()
    parts: list[Part] = []
    for table in collector.tables:
        caption = table.caption.value() or table.heading
        parts.extend(_grid_parts(_place_cells(table.rows), f"table-{table.index}", caption))
        if len(parts) > MAX_CELLS:
            raise InputError("NATIVE_HTML_LIMIT")
    for index, part in enumerate(parts, 1):
        part["id"] = f"part-{index}"
    character_count = sum(len(part["text"]) for part in parts)
    if character_count > MAX_TEXT_CHARS:
        raise InputError("NATIVE_HTML_LIMIT")
    warnings = [
        "Native cell text only: headers, units and types are not inferred; source th/td cell kinds are retained.",
        "Span values are not expanded or copied; covered positions have empty text "
        "and cite the top-left source cell.",
        "Page layout tables may be included; nested tables are separate sheets.",
        "Unrepresented cells remain unknown, not explicit blanks, nulls or zero. "
        "CSS and page layout are not evaluated.",
    ]
    if not collector.tables:
        warnings.append("No HTML table elements were found; no cells were inferred.")
    return {
        "format": "html", "method": "native_reference", "status": "ready" if collector.tables else "unsupported",
        "code": None if collector.tables else "HTML_NO_TABLES", "parts": parts,
        "warnings": warnings, "characterCount": character_count,
    }
