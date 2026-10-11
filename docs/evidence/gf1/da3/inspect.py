"""Verify retained publisher words and count unchanged pack literals; no fetch, conversion or saved derivative."""

import hashlib
import json
from decimal import Decimal
from pathlib import Path
from typing import Any


def count_heights(features: list[dict[str, Any]]) -> dict[str, Any]:
    properties = [feature["properties"] for feature in features]
    values = [item["height_roof"] for item in properties if item.get("height_roof") is not None]
    assert all(isinstance(value, str) for value in values)
    return {
        "features": len(features),
        "present": sum("height_roof" in item for item in properties),
        "null": sum("height_roof" in item and item["height_roof"] is None for item in properties),
        "absent": sum("height_roof" not in item for item in properties),
        "zero": sum(Decimal(value) == 0 for value in values),
        "negative": sum(Decimal(value) < 0 for value in values),
        "minimumLiteral": min(values, key=Decimal),
        "maximumLiteral": max(values, key=Decimal),
        "valueTypes": sorted({type(value).__name__ for value in values}),
    }


def verify_document(asset: dict[str, Any], fields: list[dict[str, Any]]) -> None:
    path = Path(asset["path"])
    original = path.read_bytes()
    receipt_bytes = Path(str(path) + asset["receiptSuffix"]).read_bytes()
    receipt = json.loads(receipt_bytes)
    assert len(original) == receipt["bytes"] == asset["bytes"]
    assert hashlib.sha256(original).hexdigest() == receipt["sha256"] == asset["sha256"]
    assert hashlib.sha256(receipt_bytes).hexdigest() == asset["receiptSha256"]
    assert original == Path(asset["contemporaryCopy"]["repositoryPath"]).read_bytes()
    lines = original.decode("utf-8").splitlines()
    for field in fields:
        row = lines[field["line"] - 1]
        assert row.startswith("| " + field["publisherField"] + " |")
        assert field["meaningQuote"] in row
        for quote in field["additionalQuotes"]:
            assert "".join(quote["parts"]) in row
        assert field["unit"] is None
        assert field["nameMapping"]["state"] == "unverified"


def main() -> None:
    result = json.loads(Path(__file__).with_name("result.json").read_text(encoding="utf-8"))
    pack = Path(result["pack"]["path"])
    before = pack.read_bytes()
    assert hashlib.sha256(before).hexdigest() == result["pack"]["sha256"]
    counts = count_heights(json.loads(before)["features"])
    assert counts == result["pack"]["heightRoofCounts"]
    verify_document(result["assets"][0], result["fields"])
    assert pack.read_bytes() == before
    print(json.dumps({"status": result["status"], "heightRoofCounts": counts, "verified": True}, indent=2))


if __name__ == "__main__":
    main()
