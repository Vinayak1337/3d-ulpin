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
