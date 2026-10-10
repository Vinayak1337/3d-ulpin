"""Evaluator-only publisher truth freeze. Never imports teacher, memory or learner code."""

from __future__ import annotations

import argparse
import hashlib
import html
import importlib.util
import json
import re
import subprocess
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
ROOT = Path("E:/BhuAayam-data/task-data/a3")
MANIFEST = REPO / "fixtures/usp/D8-messy-india/heldout.json"
Row = dict[str, Any]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pinned_file(pin: Row) -> Path:
    path = Path(pin["externalPath"])
    if path.name.startswith(".env") or digest(path) != pin["sha256"]:
        raise ValueError("A3_PUBLISHER_HASH_MISMATCH")
    return path


def native_parts(asset: Row) -> list[Row]:
    spec = importlib.util.spec_from_file_location("a3_native", REPO / "scripts/agent/read_workbook_cells.py")
    if spec is None or spec.loader is None:
        raise ValueError("A3_NATIVE_READER_UNAVAILABLE")
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    return reader.read_workbook_cells(REPO / "services/geo", Path(asset["original"]["externalPath"]))["parts"]


def column_number(cell: str) -> int:
    letters = re.match(r"[A-Z]+", cell)
    if letters is None:
        raise ValueError("A3_DICTIONARY_LOCATOR_INVALID")
    number = 0
    for letter in letters.group():
        number = number * 26 + ord(letter) - ord("A") + 1
    return number


def quote_header(column: Row, position: int) -> str:
    # Parent quotes identify the documented hierarchy but are not copied into merged child cells.
    return " / ".join(quote["text"] for quote in column.get("publisherQuotes", [])
                      if column_number(quote["locator"]) == position)


def dictionary_citation(asset: Row, column: Row, schema: Row | None = None) -> Row:
    citation = {"url": column.get("documentationUrl", asset["dictionary"]["url"]),
                "locator": column.get("documentationLocator"),
                "dictionarySha256": asset["dictionary"]["sha256"],
                "originalSha256": asset["original"]["sha256"],
                "strength": column.get("documentationStrength"),
                "quotes": column.get("publisherQuotes", [])}
    if schema:
        citation["contextQuotes"] = schema.get("contextQuotes", [])
    return citation


def truth_line(asset: Row, sheet: str, source_field: str, header: str, column: Row,
               schema: Row | None = None) -> Row:
    meaning = column.get("publisherMeaning")
    supported = bool(meaning and column.get("evaluationEligible") is True)
    expanded = column.get("expandedDefinition")
    if expanded == "undocumented" or not schema:
        supported = False
    # These documented statistical schemas describe non-property aggregates, not canonical building facts.
    # Undifferentiated years remain non-comparable, as in the development literal-only agreement method.
    year = bool(meaning and re.match(r"^year\b", meaning.strip(), re.IGNORECASE))
    target = "unknown" if supported and not year else "truth_absent"
    return {"family": asset["family"], "file": asset["id"], "sheet": sheet,
            "sourceField": source_field, "header": header, "expectedTarget": target,
            "operation": {"kind": "copy"} if target == "unknown" else None,
            "publisherMeaning": meaning, "dictionaryCitation": dictionary_citation(asset, column, schema)}


def gis_truth(asset: Row) -> list[Row]:
    dictionary = json.loads(pinned_file(asset["dictionary"]).read_text(encoding="utf-8"))
    fields = dictionary["fields"]
    columns = {column["name"]: column for column in asset["columns"]}
    result = []
    for field in fields:
        column = columns[field["name"]]
        if column["publisherMeaning"] != field["alias"] or column["sourceType"] != field["type"]:
            raise ValueError("A3_PUBLISHER_ALIAS_CHANGED")
        result.append(truth_line(asset, "attributes", field["name"], field["name"], column))
    return result


def check_quotes(parts: list[Row], schema: Row) -> None:
    cells = {part["locator"]["cell"]: part["text"] for part in parts
             if part["locator"]["sheet"] == schema["worksheetName"]}
    quotes = [quote for column in schema["columns"] for quote in column.get("publisherQuotes", [])]
    for quote in [*quotes, *schema.get("contextQuotes", [])]:
        if cells.get(quote["locator"]) != quote["text"]:
            raise ValueError("A3_PUBLISHER_QUOTE_CHANGED")


def check_census_document(asset: Row) -> None:
    raw = pinned_file(asset["dictionary"]).read_text(encoding="utf-8")
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", raw)))
    for excerpt in asset["publisherMetadataDefinitionExcerpts"]:
        for literal in excerpt.splitlines()[2:]:
            if re.sub(r"\s+", " ", literal) not in text:
                raise ValueError("A3_PUBLISHER_DESCRIPTION_ABSENT")


def workbook_truth(asset: Row) -> list[Row]:
    # Census is beyond the existing native expanded/XML bounds. Use its retained publisher description,
    # not a relaxed parser or a fabricated sample; the later evaluator must record reader abstention.
    census = asset["family"] == "mi-h03"
    parts = [] if census else native_parts(asset)
    if census:
        check_census_document(asset)
    result = []
    for schema in asset["sourceSchemas"]:
        if not census:
            check_quotes(parts, schema)
        documented = {column["position"]: column for column in schema["columns"]}
        for position in range(1, max(documented) + 1):
            column = documented.get(position, {})
            result.append(truth_line(asset, schema["worksheetName"], f"column_{position}",
                                     quote_header(column, position), column, schema))
    return result


def rendered(value: Any, lines: bool = False) -> bytes:
    if lines:
        text = "".join(json.dumps(line, ensure_ascii=True) + "\n" for line in value)
    else:
        text = json.dumps(value, ensure_ascii=True, indent=2) + "\n"
    return text.encode("utf-8")


def write_new(path: Path, value: Any, lines: bool = False, check: bool = False) -> None:
    raw = rendered(value, lines)
    if check:
        existing = path.read_bytes()
        if existing != raw and path.is_relative_to(REPO):
            # Git checks out evidence JSON as CRLF on Windows; compare exact frozen Git bytes too.
            relative = path.relative_to(REPO).as_posix()
            if existing.replace(b"\r\n", b"\n") != raw:
                raise ValueError("FROZEN_RECEIPT_CHECKOUT_CHANGED")
            existing = subprocess.check_output(["git", "show", "HEAD:" + relative], cwd=REPO)
        if existing != raw:
            raise ValueError("FROZEN_TRUTH_BYTES_CHANGED")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(raw)


def family_manifest(family_set: str) -> tuple[Row, Path]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sets = manifest.get("familySets", {})
    if family_set == "a3":
        if "a3" in sets:
            snapshot = pinned_file(sets["a3"]["frozenManifest"])
            return json.loads(snapshot.read_text(encoding="utf-8")), snapshot
        return manifest, MANIFEST
    selected = sets[family_set]["familyIds"]
    families = [family for family in manifest["families"] if family["id"] in selected]
    if len(selected) != len(set(selected)) or len(families) != len(selected):
        raise ValueError("EVALUATOR_FAMILY_SET_INVALID")
    assets = [asset for asset in manifest["assets"] if asset["family"] in selected]
    if assets:
        raise ValueError("D1C_PROPERTY_DICTIONARY_ADAPTER_REQUIRED")
    return {**manifest, "families": families, "assets": assets}, MANIFEST


def collect_truth(manifest: Row) -> list[Row]:
    rows = []
    for asset in manifest["assets"]:
        if asset["split"] not in ("holdout", "heldout"):
            raise ValueError("A3_EVALUATOR_SPLIT_INVALID")
        pinned_file(asset["original"])
        pinned_file(asset["dictionary"])
        rows.extend(gis_truth(asset) if asset.get("columns") else workbook_truth(asset))
    return rows


def family_counts(manifest: Row, rows: list[Row], positive: bool = False) -> list[Row]:
    counts = []
    for family in manifest["families"]:
        selected = [row for row in rows if row["family"] == family["id"]]
        count = {"family": family["id"], "columns": len(selected),
                 "scorable": sum(row["expectedTarget"] != "truth_absent" for row in selected)}
        if positive:
            count["positiveTargets"] = sum(row["expectedTarget"] not in ("unknown", "truth_absent")
                                           for row in selected)
        counts.append(count)
    return counts


def a3_receipt(path: Path, manifest_path: Path, counts: list[Row], columns: int) -> Row:
    return {"task": "A3", "path": path.as_posix(), "sha256": digest(path),
            "manifestSha256": digest(manifest_path), "columns": columns, "families": counts,
            "method": "Literal publisher aliases/types or hierarchical descriptions; no teacher/team labels.",
            "rules": ["Alias/type without expanded meaning is truth_absent.",
                      "Documented non-property statistical concepts are unknown/copy.",
                      "Undocumented columns and undifferentiated years are truth_absent.",
                      "No propagation into merged header children; no source values in this receipt."],
            "censusQualification": "Retained publisher metadata only; existing native limits block original.",
            "teacherCalls": 0, "trainingWrites": 0, "memoryWrites": 0,
            "evaluationBeforeFreeze": False}


def d1c_receipt(path: Path, manifest_path: Path, counts: list[Row], manifest: Row) -> Row:
    return {"task": "D1c", "path": path.as_posix(), "sha256": digest(path),
            "manifestSha256": digest(manifest_path), "files": len(manifest["assets"]),
            "columns": sum(count["columns"] for count in counts),
            "scorable": sum(count["scorable"] for count in counts),
            "positiveTargets": sum(count["positiveTargets"] for count in counts), "families": counts,
            "status": "blocked_no_eligible_property_holdout",
            "method": "Publisher-only freeze; no teacher/team labels. No qualifying new originals admitted.",
            "teacherCalls": 0, "trainingWrites": 0, "memoryWrites": 0, "evaluationBeforeFreeze": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family-set", choices=("a3", "d1c"), default="a3")
    parser.add_argument("--check", action="store_true", help="Compare frozen bytes without writing any file.")
    args = parser.parse_args()
    manifest, manifest_path = family_manifest(args.family_set)
    rows = collect_truth(manifest)
    counts = family_counts(manifest, rows, positive=args.family_set != "a3")
    path = ROOT.parent / args.family_set / "heldout-truth.jsonl"
    write_new(path, rows, lines=True, check=args.check)
    if args.family_set == "a3":
        receipt = a3_receipt(path, manifest_path, counts, len(rows))
    else:
        receipt = d1c_receipt(path, manifest_path, counts, manifest)
    receipt_path = REPO / "docs/evidence/gf-agent" / args.family_set / "heldout-truth-freeze.json"
    write_new(receipt_path, receipt, check=args.check)
    print(json.dumps({"columns": len(rows), "families": counts, "checked": args.check}))


if __name__ == "__main__":
    main()
