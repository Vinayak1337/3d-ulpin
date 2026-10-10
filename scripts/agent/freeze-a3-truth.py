"""Evaluator-only publisher truth freeze. Never imports teacher, memory or learner code."""

from __future__ import annotations

import hashlib
import html
import importlib.util
import json
import re
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


def write_new(path: Path, value: Any, lines: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        if lines:
            for line in value:
                handle.write(json.dumps(line, ensure_ascii=True) + "\n")
        else:
            json.dump(value, handle, ensure_ascii=True, indent=2)
            handle.write("\n")


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    rows = []
    for asset in manifest["assets"]:
        if asset["split"] not in ("holdout", "heldout"):
            raise ValueError("A3_EVALUATOR_SPLIT_INVALID")
        pinned_file(asset["original"])
        pinned_file(asset["dictionary"])
        rows.extend(gis_truth(asset) if asset.get("columns") else workbook_truth(asset))
    path = ROOT / "heldout-truth.jsonl"
    write_new(path, rows, lines=True)
    counts = [{"family": family["id"], "columns": sum(row["family"] == family["id"] for row in rows),
               "scorable": sum(row["family"] == family["id"] and row["expectedTarget"] != "truth_absent"
                               for row in rows)} for family in manifest["families"]]
    receipt = {"task": "A3", "path": path.as_posix(), "sha256": digest(path),
               "manifestSha256": digest(MANIFEST), "columns": len(rows), "families": counts,
               "method": "Literal publisher aliases/types or hierarchical descriptions; no teacher/team labels.",
               "rules": ["Alias/type without expanded meaning is truth_absent.",
                         "Documented non-property statistical concepts are unknown/copy.",
                         "Undocumented columns and undifferentiated years are truth_absent.",
                         "No propagation into merged header children; no source values in this receipt."],
               "censusQualification": "Retained publisher metadata only; existing native limits block original.",
               "teacherCalls": 0, "trainingWrites": 0, "memoryWrites": 0,
               "evaluationBeforeFreeze": False}
    write_new(REPO / "docs/evidence/gf-agent/a3/heldout-truth-freeze.json", receipt)
    print(json.dumps({"columns": len(rows), "families": counts}))


if __name__ == "__main__":
    main()
