"""Read retained originals in memory; verify receipts and report literal-key coverage, without OCR."""

import csv
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path
from typing import Any


PACK = Path("E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson")
ROOT = Path("E:/BhuAayam-data/datasets/nyc-10013-linked/nyc-landmarks-preservation-commission")


def read_buildings() -> list[dict[str, Any]]:
    return json.loads(PACK.read_text(encoding="utf-8"))["features"]


def match_counts(
    buildings: list[dict[str, Any]], rows: list[dict[str, str]], field: str, column: str
) -> dict[str, Any]:
    keys = [feature["properties"].get(field) for feature in buildings]
    assert all(isinstance(key, str) for key in keys)
    building_counts = Counter(keys)
    row_counts = Counter(row[column] for row in rows)
    cases = {
        "exactlyOneRow": [key for key in keys if row_counts[key] == 1],
        "severalRows": [key for key in keys if row_counts[key] > 1],
        "noRows": [key for key in keys if row_counts[key] == 0],
    }
    unmatched = [row[column] for row in rows if row[column] not in building_counts]
    repeated = [key for key, count in building_counts.items() if count > 1]
    assert sum(len(values) for values in cases.values()) == len(buildings)
    return {
        "buildingField": field,
        "tableColumn": column,
        "buildings": {name: len(values) for name, values in cases.items()},
        "exampleKeys": {name: sorted(set(values))[:3] for name, values in cases.items()},
        "rowsMatchingNoBuilding": len(unmatched),
        "unmatchedRowExampleKeys": sorted(set(unmatched))[:3],
        "emptyBuildingKeys": sum(key == "" for key in keys),
        "emptyBuildingExampleKeys": sorted({key for key in keys if key == ""})[:3],
        "repeatedBuildingKeyValues": len(repeated),
        "buildingsWithRepeatedKeys": sum(building_counts[key] for key in repeated),
        "repeatedBuildingExampleKeys": sorted(repeated)[:3],
        "emptyTableKeys": row_counts[""],
        "repeatedTableKeyValues": sum(count > 1 for count in row_counts.values()),
        "buildingValueTypes": sorted({type(key).__name__ for key in keys}),
        "tableValueTypes": ["str"],
        "leadingZeroBuildingKeys": sum(key.startswith("0") for key in keys),
        "leadingZeroTableRows": sum(row[column].startswith("0") for row in rows),
        "decimalPointBuildingKeys": sum("." in key for key in keys),
        "decimalPointTableRows": sum("." in row[column] for row in rows),
    }


def inspect_table(buildings: list[dict[str, Any]]) -> dict[str, Any]:
    with (ROOT / "gpmc-yuvp.csv").open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        columns = reader.fieldnames
    for column, field in [("bin", "bin"), ("bbl", "base_bbl")]:
        width = 7 if column == "bin" else 10
        pattern = rf"[1-9][0-9]{{{width - 1}}}"
        assert all(re.fullmatch(pattern, row[column]) for row in rows)
        assert all(re.fullmatch(pattern, item["properties"][field]) for item in buildings)
    return {
        "columns": columns,
        "rows": len(rows),
        "keyColumn": "bin",
        "alternateKeyColumn": "bbl",
        "comparison": "Strings as written; no coercion, padding, composition, trimming or normalisation.",
        "matches": [
            match_counts(buildings, rows, "bin", "bin"),
            match_counts(buildings, rows, "base_bbl", "bbl"),
        ],
        "formOnlyLexicalMismatchRows": 0,
        "formOnlyLexicalMismatchBuildings": 0,
        "formFinding": "All BINs have 7 digits and all BBLs 10, without leading zeros or decimal points.",
        "schemaFinding": "Portal BIN type is number; BBL is text. CSV cells and both pack keys are strings.",
        "portalNumericSchemaBinRows": len(rows),
        "packStringBinValues": len(buildings),
    }


def inspect_pdf(name: str, buildings: list[dict[str, Any]]) -> dict[str, Any]:
    raw = subprocess.check_output(["pdftotext", "-enc", "UTF-8", "-layout", str(ROOT / name), "-"])
    text = raw.decode("utf-8")
    pages = text.split("\f")
    if not pages[-1].strip():
        pages.pop()
    keys = {feature["properties"][field] for feature in buildings for field in ["bin", "base_bbl"]}
    literals = {key for key in keys if key in text}
    if name == "2537.pdf":
        words = ["75 Varick Street", "Borough of Manhattan Tax Map Block 226, Lot 1"]
        page = 1
    else:
        words = ["275 Canal Street", "Borough of Manhattan Tax Map Block 209, Lot 35"]
        page = 53
    assert all(word in pages[page - 1] for word in words)
    return {
        "pages": len(pages),
        "textLayer": bool(text.strip()),
        "pagesWithReadableText": sum(bool(value.strip()) for value in pages),
        "extractedTextCharacters": len(text),
        "matchingKeyLiterals": sorted(literals),
        "namingWords": words,
        "pdfPage": page,
        "buildingKeyStatedInDocument": None,
    }


def main() -> None:
    buildings = read_buildings()
    result = json.loads(Path(__file__).with_name("result.json").read_text(encoding="utf-8"))
    assert hashlib.sha256(PACK.read_bytes()).hexdigest() == result["pack"]["sha256"]
    assets = {Path(asset["path"]).name: asset for asset in result["assets"]}
    inspections = {"gpmc-yuvp.csv": inspect_table(buildings)}
    for name in ["2537.pdf", "2362.pdf"]:
        inspections[name] = inspect_pdf(name, buildings)
    for name in inspections:
        receipt_bytes = (ROOT / (name + ".receipt.json")).read_bytes()
        receipt = json.loads(receipt_bytes)
        original = (ROOT / name).read_bytes()
        assert len(original) == receipt["bytes"] == assets[name]["bytes"]
        assert hashlib.sha256(original).hexdigest() == receipt["sha256"] == assets[name]["sha256"]
        assert hashlib.sha256(receipt_bytes).hexdigest() == assets[name]["receiptSha256"]
        assert inspections[name] == receipt["inspection"] == assets[name]["inspection"]
    print(json.dumps({"packFeatures": len(buildings), "inspections": inspections}, indent=2))


if __name__ == "__main__":
    main()
