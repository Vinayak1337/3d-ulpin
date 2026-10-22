"""The streamed workbook reader on one real public workbook and one generated test_only workbook above 16 MiB."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
READER = Path(__file__).with_name("read_workbook_windows.py")
WHOLE_READER = Path(__file__).with_name("read_workbook_cells.py")
REAL = Path("E:/BhuAayam-data/datasets/messy-india/rbi-development-table-18/original.xlsx")
REAL_SHA256 = "fc3f75eafdb7b954348ac182d1db3c3a558fc08aecf072d6a3807735d15e38a2"
# TABULAR_STREAM_LIMITS and the intake ZIP bounds, as the server passes them.
LIMITS = ["--rows", "1000000", "--window-rows", "10000", "--window-bytes", str(16 * 1024 * 1024),
          "--record-bytes", str(1024 * 1024), "--windows", "4096", "--member-bytes", str(7 * 1024 ** 3),
          "--ratio", "100"]
MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


# A venv's python.exe starts the base interpreter as a child, so the peak is read inside the reader's process.
MEASURED = """
import atexit, ctypes, os, runpy, sys
class Counters(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong), ("peak", ctypes.c_size_t)] + [
        (f"field{n}", ctypes.c_size_t) for n in range(7)]
def report():
    counters = Counters(cb=ctypes.sizeof(Counters))
    ctypes.windll.kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    ctypes.windll.psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong]
    ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.windll.kernel32.GetCurrentProcess(), ctypes.byref(counters),
                                             counters.cb)
    sys.stderr.write(f"peak={counters.peak}\\n")
if sys.platform == "win32":
    atexit.register(report)
sys.argv = sys.argv[1:]
sys.path.insert(0, os.path.dirname(sys.argv[0]))
runpy.run_path(sys.argv[0], run_name="__main__")
"""


def run(path: Path, sheet: str, header_rows: str, *extra: str):
    command = [sys.executable, "-c", MEASURED, str(READER), str(REPO / "services/geo"), str(path), "--sheet", sheet,
               "--header-rows", header_rows, *LIMITS, *extra]
    result = subprocess.run(command, capture_output=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    peak = [int(line[5:]) for line in result.stderr.decode().splitlines() if line.startswith("peak=")]
    return result.returncode, [json.loads(line) for line in result.stdout.splitlines()], peak[0] if peak else None


def whole_read(path: Path):
    result = subprocess.run([sys.executable, str(WHOLE_READER), str(REPO / "services/geo"), str(path)],
                            capture_output=True, check=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    return json.loads(result.stdout)


@pytest.mark.skipif(not REAL.exists(), reason="the RBI table 18 original is on the data drive")
def test_real_workbook_rows_match_the_whole_read():
    assert hashlib.sha256(REAL.read_bytes()).hexdigest() == REAL_SHA256
    parts = whole_read(REAL)["parts"]
    sheet = parts[0]["locator"]["sheet"]
    header = min(part["locator"]["row"] for part in parts if part["locator"]["sheet"] == sheet)
    code, lines, _ = run(REAL, sheet, str(header))
    assert code == 0, lines
    head, *windows, end = lines
    assert head["kind"] == "sheet" and end["kind"] == "end" and end["windows"] == len(windows) == 1
    with zipfile.ZipFile(REAL) as archive:
        assert head["memberSha256"] == hashlib.sha256(archive.read(head["member"])).hexdigest()
    rows = windows[0]["rows"]
    assert [row["row"] for row in rows] == sorted({part["locator"]["row"] for part in parts
                                                  if part["locator"]["sheet"] == sheet
                                                  and part["locator"]["row"] > header})
    for part in parts:
        locator = part["locator"]
        if locator["sheet"] != sheet or locator["row"] <= header:
            continue
        row = next(row for row in rows if row["row"] == locator["row"])
        cell = row["cells"][locator["column"] - 1]
        if locator["cellState"] in ("literal", "whitespace", "formula_cached", "error"):
            assert cell == part["text"]
        elif locator["cellState"] == "empty_string":
            assert cell == ""
        else:
            assert cell is None


def control_workbook(path: Path, rows: int) -> dict[str, int]:
    """test_only: generated XML controls, not source records. Written as a stream, deflated at level 1."""
    shared = ["Ward", "Plot", "Area", "Doubled", "Tripled", "Note", "Hash", ""] + [f"ward-{n:03d}" for n in range(500)]
    empty = shared.index("")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns='
                         '"http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" '
                         'ContentType="application/xml"/></Types>')
        archive.writestr("xl/workbook.xml", f'<workbook xmlns="{MAIN}" xmlns:r="{RELS}"><sheets>'
                         '<sheet name="Notes" sheetId="1" r:id="rId1"/><sheet name="Register" sheetId="2" '
                         'r:id="rId2"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/'
                         'package/2006/relationships">' + "".join(
                             f'<Relationship Id="rId{n}" Type="{RELS}/worksheet" Target="worksheets/sheet{n}.xml"/>'
                             for n in (1, 2)) + f'<Relationship Id="rId3" Type="{RELS}/sharedStrings" '
                         'Target="sharedStrings.xml"/></Relationships>')
        archive.writestr("xl/sharedStrings.xml", f'<sst xmlns="{MAIN}">' + "".join(
            f"<si><t>{text}</t></si>" if text else "<si><t/></si>" for text in shared) + "</sst>")
        archive.writestr("xl/worksheets/sheet1.xml", f'<worksheet xmlns="{MAIN}"><sheetData><row r="1">'
                         '<c r="A1" t="inlineStr"><is><t>notes</t></is></c></row></sheetData></worksheet>')
        with archive.open("xl/worksheets/sheet2.xml", "w", force_zip64=True) as sheet:
            sheet.write(f'<worksheet xmlns="{MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'
                        'Register of plots</t></is></c></row><row r="2">'.encode())
            sheet.write("".join(f'<c r="{letter}2" t="s"><v>{n}</v></c>' for n, letter in
                                enumerate("ABCDEFG")).encode() + b"</row>")
            batch = []
            for row in range(3, rows + 3):
                digest = hashlib.sha256(str(row).encode()).hexdigest()
                missing = row % 7 == 0
                inline = f'<c r="F{row}" t="inlineStr"><is><t xml:space="preserve"> lot {row} </t></is></c>'
                note = f'<c r="F{row}" t="s"><v>{empty}</v></c>' if row % 5 == 0 else ("" if missing else inline)
                batch.append(f'<row r="{row}"><c r="A{row}" t="s"><v>{8 + row % 500}</v></c>'
                             f'<c r="B{row}"><v>{row}.50</v></c><c r="C{row}"><v>{int(digest[:8], 16)}</v></c>'
                             f'<c r="D{row}"><f>C{row}*2</f><v>{int(digest[:8], 16) * 2}</v></c>'
                             f'<c r="E{row}"><f>C{row}*3</f></c>{note}'
                             f'<c r="G{row}" t="inlineStr"><is><t>{digest}</t></is></c></row>')
                if len(batch) == 1000:
                    sheet.write("".join(batch).encode())
                    batch = []
            sheet.write(("".join(batch) + '</sheetData><mergeCells count="1"><mergeCell ref="A1:G1"/>'
                         "</mergeCells></worksheet>").encode())
    return {"empty": empty}


@pytest.fixture(scope="module")
def large(tmp_path_factory):
    path = tmp_path_factory.mktemp("xw1") / "control.xlsx"
    control_workbook(path, 160_000)
    return path


def test_generated_workbook_above_16_mib_streams_in_windows(large: Path):
    size = large.stat().st_size
    assert size > 16 * 1024 * 1024
    started = time.perf_counter()
    code, lines, peak = run(large, "Register", "2")
    elapsed = time.perf_counter() - started
    assert code == 0, lines[-1]
    head, *windows, end = lines
    assert head["headers"] == ["Ward", "Plot", "Area", "Doubled", "Tripled", "Note", "Hash"]
    with zipfile.ZipFile(large) as archive:
        info = archive.getinfo("xl/worksheets/sheet2.xml")
        assert head["memberSha256"] == hashlib.sha256(archive.read(info)).hexdigest()
        assert head["memberBytes"] == info.file_size and head["byteEnd"] - head["byteStart"] == info.compress_size
    stored = large.read_bytes()[head["byteStart"]:head["byteEnd"]]
    assert head["storedSha256"] == hashlib.sha256(stored).hexdigest(), "the range's SHA-256 is of exactly its bytes"
    assert end["records"] == 160_000 and end["windows"] == len(windows) == 16 and end["mergedRanges"] is True
    assert [len(window["rows"]) for window in windows] == [10_000] * 16
    assert [window["index"] for window in windows] == list(range(16))
    first = windows[0]["rows"]
    assert first[0]["row"] == 3 and first[0]["cells"][:2] == ["ward-003", "3.50"]
    digest = hashlib.sha256(b"3").hexdigest()
    assert first[0]["cells"][3] == str(int(digest[:8], 16) * 2) and first[0]["cells"][4] is None
    assert first[0]["cells"][5] == " lot 3 " and first[0]["cells"][6] == digest
    assert first[0]["marks"] == [[3, "formula_cached"], [4, "formula_uncached"]]
    assert first[2]["row"] == 5 and first[2]["cells"][5] == ""
    assert first[4]["row"] == 7 and first[4]["cells"][5] is None
    assert end["marks"]["formula_cached"] == end["marks"]["formula_uncached"] == 160_000
    print(json.dumps({"xw1_measure": {"bytes": size, "records": end["records"], "windows": end["windows"],
                                      "elapsedSeconds": round(elapsed, 2),
                                      "peakWorkingSetMiB": peak and round(peak / 1024 ** 2, 1)}}))
    if peak is not None:
        assert peak < 256 * 1024 ** 2


def test_refusals_carry_codes(tmp_path: Path, large: Path):
    code, lines, _ = run(large, "Missing", "1")
    assert code == 2 and lines == [{"kind": "refused", "code": "WORKBOOK_SHEET_MISSING", "row": None}]
    code, lines, _ = run(large, "Register", "2", "--rows", "25000")
    assert code == 2 and lines[-1] == {"kind": "refused", "code": "TABULAR_STREAM_ROWS", "row": 25003}
    assert [line["kind"] for line in lines[:-1]] == ["sheet", "window", "window"]
    code, lines, _ = run(large, "Register", "2", "--ratio", "2")
    assert code == 2 and lines[-1]["code"] == "ZIP_RATIO_LIMIT"
    doctype = tmp_path / "doctype.xlsx"
    with zipfile.ZipFile(large) as source, zipfile.ZipFile(doctype, "w") as target:
        for info in source.infolist():
            if info.filename != "xl/worksheets/sheet2.xml":
                target.writestr(info, source.read(info))
        target.writestr("xl/worksheets/sheet2.xml", f'<!DOCTYPE x [<!ENTITY a "aaaa">]><worksheet xmlns="{MAIN}">'
                        '<sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>&a;</t></is></c></row></sheetData>'
                        "</worksheet>")
    code, lines, _ = run(doctype, "Register", "2")
    assert code == 2 and lines == [{"kind": "refused", "code": "NATIVE_WORKBOOK_INVALID", "row": None}]


ODS_NAMESPACES = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
                  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
                  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"')
ODS_TYPE = "application/vnd.oasis.opendocument.spreadsheet"


def ods_text(text: str, repeat: int = 1) -> str:
    repeated = f' table:number-columns-repeated="{repeat}"' if repeat > 1 else ""
    return f'<table:table-cell{repeated} office:value-type="string"><text:p>{text}</text:p></table:table-cell>'


def ods_float(value: str, formula: str | None = None) -> str:
    formula = f' table:formula="{formula}"' if formula else ""
    return (f'<table:table-cell{formula} office:value-type="float" office:value="{value}">'
            f"<text:p>{value}</text:p></table:table-cell>")


def ods_rows(blocks: int) -> list[str]:
    """test_only: blocks of ten typed rows, one written once and one repeated nine times; block 3's total is a
    formula with its stored result."""
    rows = [f"<table:table-row>{ods_text('id')}{ods_text('ward')}{ods_text('zone')}{ods_text('total')}"
            "</table:table-row>"]
    for block in range(blocks):
        total = ods_float("6", "of:=[.D2]*2") if block == 3 else ods_float(str(block))
        rows.append(f"<table:table-row>{ods_text(f'R{block * 10 + 1}')}{ods_text(f'W{block}')}"
                    f"{ods_text(f'Z{block % 7}')}{total}</table:table-row>")
        rows.append(f'<table:table-row table:number-rows-repeated="9">{ods_text(f"B{block}")}'
                    f"{ods_text(f'W{block}', 2)}{ods_float(str(block))}</table:table-row>")
    return rows


def ods_workbook(path: Path, blocks: int) -> list[str]:
    """A Notes sheet, then Wards with its typed rows and LibreOffice's trailing block of empty padding."""
    rows = ods_rows(blocks)
    padding = (f'<table:table-row table:number-rows-repeated="{1048576 - 1 - blocks * 10}">'
               '<table:table-cell table:number-columns-repeated="1024"/></table:table-row>')
    content = (f'<?xml version="1.0" encoding="UTF-8"?><office:document-content {ODS_NAMESPACES} '
               'office:version="1.3"><office:body><office:spreadsheet>'
               f'<table:table table:name="Notes"><table:table-row>{ods_text("notes")}</table:table-row></table:table>'
               f'<table:table table:name="Wards">{"".join(rows)}{padding}</table:table>'
               "</office:spreadsheet></office:body></office:document-content>")
    write_ods(path, content)
    return rows


def write_ods(path: Path, content: str | bytes) -> None:
    manifest = ('<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:'
                'opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" '
                f'manifest:media-type="{ODS_TYPE}"/><manifest:file-entry manifest:full-path="content.xml" '
                'manifest:media-type="text/xml"/></manifest:manifest>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(zipfile.ZipInfo("mimetype"), ODS_TYPE)
        archive.writestr("content.xml", content)
        archive.writestr("META-INF/manifest.xml", manifest)


def expanded_whole_read(path: Path, sheet: str) -> dict[tuple[int, int], dict]:
    """The whole read's cell elements, expanded by their repeats as the server's whole read expands them."""
    cells = {}
    for part in whole_read(path)["parts"]:
        locator = part["locator"]
        repeat = locator["ods"]["rowRepeat"] * locator["ods"]["columnRepeat"]
        if locator["sheet"] != sheet or locator["cellState"] == "empty" or (
                repeat > 1 and locator["cellState"] in ("empty_string", "whitespace")):
            continue
        for row in range(locator["row"], locator["row"] + locator["ods"]["rowRepeat"]):
            for column in range(locator["column"], locator["column"] + locator["ods"]["columnRepeat"]):
                cells[row, column] = part
    return cells


def test_ods_sheet_streams_in_windows_as_the_whole_read_gives_it(tmp_path: Path) -> None:
    path = tmp_path / "wards.ods"
    written = ods_workbook(path, 250)
    code, lines, _ = run(path, "Wards", "1", "--window-rows", "1000")
    assert code == 0, lines[-1]
    head, *windows, end = lines
    assert head["member"] == "content.xml" and head["headers"] == ["id", "ward", "zone", "total"]
    with zipfile.ZipFile(path) as archive:
        info = archive.getinfo("content.xml")
        assert head["memberSha256"] == hashlib.sha256(archive.read(info)).hexdigest()
    assert head["byteEnd"] - head["byteStart"] == info.compress_size
    assert end["records"] == 2500 and end["windows"] == len(windows) == 3 and end["sharedStrings"] == 0
    assert [len(window["rows"]) for window in windows] == [1000, 1000, 500]
    rows = [row for window in windows for row in window["rows"]]
    assert [row["row"] for row in rows] == list(range(2, 2502)), "the trailing padding writes no row"
    cells = expanded_whole_read(path, "Wards")
    for row in rows:
        for column, cell in enumerate(row["cells"], 1):
            part = cells.get((row["row"], column))
            assert cell == (part["text"] if part else None)
    formula = rows[30]
    assert formula["cells"] == ["R31", "W3", "Z3", "6"] and formula["marks"] == [[3, "formula_cached"]]
    assert end["marks"]["formula_cached"] == 1
    # Each row cites its row element: the ordinal in the sheet (the header is 1) and the SHA-256 of its XML.
    assert [rows[1]["rowElement"], rows[9]["rowElement"], rows[10]["rowElement"]] == [3, 3, 4]
    assert rows[1]["rowSha256"] == rows[9]["rowSha256"] == hashlib.sha256(written[2].encode()).hexdigest()
    assert rows[1]["cells"] == ["B0", "W0", "W0", "0"]


def test_ods_refusals_carry_codes(tmp_path: Path) -> None:
    path = tmp_path / "wards.ods"
    ods_workbook(path, 3)
    code, lines, _ = run(path, "wards", "1")
    assert code == 2 and lines == [{"kind": "refused", "code": "WORKBOOK_SHEET_MISSING", "row": None}]
    code, lines, _ = run(path, "Wards", "1", "--rows", "25")
    assert code == 2 and lines[-1] == {"kind": "refused", "code": "TABULAR_STREAM_ROWS", "row": 27}
    code, lines, _ = run(path, "Wards", "1", "--record-bytes", "64")
    assert code == 2 and lines[-1]["code"] == "TABULAR_RECORD_BUDGET"
    code, lines, _ = run(path, "Wards", "1", "--window-rows", "10", "--windows", "1")
    assert code == 2 and lines[-1]["code"] == "TABULAR_STREAM_WINDOWS"
    code, lines, _ = run(path, "Wards", "1", "--member-bytes", "1000")
    assert code == 2 and lines[-1]["code"] == "ZIP_EXPANDED_LIMIT"
    code, lines, _ = run(path, "Wards", "1", "--ratio", "1")
    assert code == 2 and lines[-1]["code"] == "ZIP_RATIO_LIMIT"


def test_ods_windows_never_cross_the_byte_budget(tmp_path: Path) -> None:
    path = tmp_path / "wards.ods"
    ods_workbook(path, 3)
    code, lines, _ = run(path, "Wards", "1", "--window-bytes", "600")
    assert code == 0, lines[-1]
    windows = [line for line in lines if line["kind"] == "window"]
    assert sum(len(window["rows"]) for window in windows) == 30
    assert all(len(json.dumps(window, ensure_ascii=False, separators=(",", ":")).encode()) <= 600
               for window in windows)


def test_ods_stored_types_and_text_controls_share_the_native_cell_rules(tmp_path: Path) -> None:
    path = tmp_path / "types.ods"
    cells = [
        '<table:table-cell office:value-type="date" office:date-value="2026-10-22"/>',
        '<table:table-cell office:value-type="boolean" office:boolean-value="false"/>',
        '<table:table-cell office:value-type="string"><text:p>A<text:s text:c="2"/>B<text:tab/>C'
        '<text:line-break/>D</text:p><text:p>E</text:p></table:table-cell>',
        ods_float("0", "of:=2-2"),
        '<table:table-cell table:formula="of:=1+1" office:value-type="float"/>',
        '<table:table-cell office:value-type="error"><text:p>#VALUE!</text:p></table:table-cell>',
        '<table:covered-table-cell/>',
        '<table:table-cell office:value-type="string" office:string-value=""/>',
    ]
    header = ''.join(ods_text(f"column-{number}") for number in range(len(cells)))
    content = (f'<office:document-content {ODS_NAMESPACES} office:version="1.3"><office:body>'
               f'<office:spreadsheet><table:table table:name="Wards"><table:table-row>{header}</table:table-row>'
               f'<table:table-row>{"".join(cells)}</table:table-row></table:table>'
               '</office:spreadsheet></office:body></office:document-content>')
    write_ods(path, content)
    code, lines, _ = run(path, "Wards", "1")
    assert code == 0, lines[-1]
    row = lines[1]["rows"][0]
    assert row["cells"] == ["2026-10-22", "false", "A  B\tC\nD\nE", "0", None, "#VALUE!", None, ""]
    assert row["marks"] == [[3, "formula_cached"], [4, "formula_uncached"], [5, "error"], [6, "unsupported"]]
    assert lines[-1]["mergedRanges"] is True


def test_ods_raw_row_budget_and_split_tag_hash(tmp_path: Path) -> None:
    path = tmp_path / "row.ods"
    # test_only: XML overhead exceeds the record bound although the row's stored value is small.
    header = f"<table:table-row>{ods_text('name')}</table:table-row>"
    row = f"<table:table-row><!--{'x' * 800}-->{ods_text('value')}</table:table-row>"
    content = (f'<office:document-content {ODS_NAMESPACES} office:version="1.3"><office:body>'
               f'<office:spreadsheet><table:table table:name="Wards">{header}{row}</table:table>'
               '</office:spreadsheet></office:body></office:document-content>')
    write_ods(path, content)
    code, lines, _ = run(path, "Wards", "1", "--record-bytes", "500")
    assert code == 2 and lines[-1]["code"] == "TABULAR_RECORD_BUDGET"
    # Put the start tag across the incremental parser's 1 MiB read boundary.
    start = content.index(row)
    padding = '<!--' + 'x' * (1024 * 1024 - start - 12) + '-->'
    write_ods(path, content[:start] + padding + content[start:])
    code, lines, _ = run(path, "Wards", "1", "--ratio", "10000")
    assert code == 0, lines[-1]
    assert lines[1]["rows"][0]["rowSha256"] == hashlib.sha256(row.encode()).hexdigest()
    # Expat reports byte offsets, not character offsets, for UTF-16 originals too.
    for encoding, bom in (("utf-16-le", b"\xff\xfe"), ("utf-16-be", b"\xfe\xff")):
        write_ods(path, bom + content.encode(encoding))
        code, lines, _ = run(path, "Wards", "1")
        assert code == 0, lines[-1]
        assert lines[1]["rows"][0]["rowSha256"] == hashlib.sha256(row.encode(encoding)).hexdigest()
