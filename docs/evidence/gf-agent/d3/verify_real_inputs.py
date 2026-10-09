"""Read two retained development originals; print counts and non-personal headers only."""

from __future__ import annotations

import base64
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
SELECTION = (
    ("registered-page-3.html", "good", "Small project list with a nested pagination table and missing address cells."),
    ("RERAP01282025205138-1.html", "difficult", "Full building page with layout tables, row/column spans and nesting."),
)


def _main_header(parts: list[dict[str, Any]], expected: list[str]) -> dict[str, Any]:
    rows: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    for part in parts:
        locator = part["locator"]
        if locator["cellType"] == "header" and locator["cellState"] != "spanned":
            rows[(locator["sheet"], locator["row"])].append(part)
    matches = []
    for (sheet, row), cells in rows.items():
        cells.sort(key=lambda cell: cell["locator"]["column"])
        text = [cell["text"] for cell in cells]
        if text == expected:
            matches.append({"sheet": sheet, "row": row, "text": text})
    assert len(matches) == 1, "Expected exactly one publisher-documented development header row."
    return matches[0]


def _span_invariant(parts: list[dict[str, Any]]) -> None:
    cells = {(part["locator"]["sheet"], part["locator"]["cell"]): part for part in parts}
    for part in parts:
        locator = part["locator"]
        if locator["cellState"] == "spanned":
            assert part["text"] == "", "Covered positions must not repeat source values."
            source = cells[(locator["sheet"], locator["spanOf"])]
            assert source["locator"]["cellState"] != "spanned", "Spans must cite a source cell."


def _summary(asset: dict[str, Any], role: str, reason: str) -> dict[str, Any]:
    from geo.area import extract_document
    from geo.native_html_table import _decode_html, _TableCollector

    assert asset["split"] == "dev" and asset["family"] in ("mi-d02", "mi-d03")
    path = Path(asset["original"]["externalPath"])
    raw = path.read_bytes()
    source_hash = hashlib.sha256(raw).hexdigest()
    assert source_hash == asset["original"]["sha256"]
    result = extract_document({"format": "html", "base64": base64.b64encode(raw).decode("ascii")})
    assert result["status"] == "ready" and result["sourceSha256"] == source_hash
    assert hashlib.sha256(path.read_bytes()).hexdigest() == source_hash, "Original bytes changed."
    _span_invariant(result["parts"])
    collector = _TableCollector()
    collector.feed(_decode_html(raw))
    collector.close()
    counts = Counter(part["locator"]["sheet"] for part in result["parts"])
    states = Counter(part["locator"]["cellState"] for part in result["parts"])
    main_header = _main_header(result["parts"], [column["name"] for column in asset["columns"]])
    return {
        "family": asset["family"], "split": "dev", "purpose": asset["purpose"],
        "permissionState": asset["permission"]["state"], "role": role, "selectionReason": reason,
        "file": str(path), "sourceSha256": source_hash, "sourceBytes": len(raw),
        "status": result["status"], "tableCount": len(collector.tables),
        "cellsPerTable": [counts[f"table-{table.index}"] for table in collector.tables],
        "cellStates": dict(sorted(states.items())), "characterCount": result["characterCount"],
        "mainTableHtmlId": asset["sourceTable"]["htmlId"], "mainTableHeader": main_header,
        "warnings": result["warnings"], "sourceUnchanged": True, "spanInvariant": "passed",
    }


def main() -> None:
    sys.path.insert(0, str(ROOT / "services" / "geo"))
    manifest_path = ROOT / "fixtures" / "usp" / "D8-messy-india" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assets = {asset["id"]: asset for asset in manifest["assets"]}
    summaries = [_summary(assets[name], role, reason) for name, role, reason in SELECTION]
    print(json.dumps({"task": "D3", "gate": "GF-AGENT", "inputs": summaries}, separators=(",", ":")))


if __name__ == "__main__":
    main()
