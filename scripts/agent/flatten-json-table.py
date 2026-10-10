"""Lossless JSON-object rows to CSV; no field renaming, scalar coercion or row reordering."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
from typing import Any

VERSION = "json-table-csv/1"


class NumberLiteral(str):
    """Retain the original JSON number token rather than rounding through a float."""


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON_TABLE_DUPLICATE_KEY")
        result[key] = value
    return result


def reject_constant(value: str) -> None:
    raise ValueError("JSON_TABLE_NONFINITE_NUMBER")


def read_rows(raw: bytes, pointer: str = "") -> list[dict[str, Any]]:
    value = json.loads(raw.decode("utf-8-sig"), parse_int=NumberLiteral, parse_float=NumberLiteral,
                       object_pairs_hook=unique_object, parse_constant=reject_constant)
    if pointer:
        if not pointer.startswith("/"):
            raise ValueError("JSON_TABLE_POINTER_INVALID")
        for part in pointer[1:].split("/"):
            key = part.replace("~1", "/").replace("~0", "~")
            if isinstance(value, list):
                value = value[int(key)]
            else:
                value = value[key]
    if not isinstance(value, list) or not value or not all(isinstance(row, dict) for row in value):
        raise ValueError("JSON_TABLE_OBJECT_ARRAY_REQUIRED")
    return value


def compact_json(value: Any) -> str:
    if isinstance(value, NumberLiteral):
        return str(value)
    if isinstance(value, list):
        return "[" + ",".join(compact_json(item) for item in value) + "]"
    if isinstance(value, dict):
        pairs = (json.dumps(key, ensure_ascii=False) + ":" + compact_json(item) for key, item in value.items())
        return "{" + ",".join(pairs) + "}"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def scalar_text(value: Any) -> str:
    if isinstance(value, str):
        return str(value)
    return compact_json(value)


def csv_bytes(rows: list[dict[str, Any]]) -> tuple[bytes, list[str]]:
    headers = list(dict.fromkeys(key for row in rows for key in row))
    if not headers:
        raise ValueError("JSON_TABLE_COLUMNS_REQUIRED")
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow(scalar_text(row[key]) if key in row else "" for key in headers)
    return buffer.getvalue().encode("utf-8"), headers


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def flatten(source: Path, output: Path, pointer: str = "") -> dict[str, Any]:
    raw = source.read_bytes()
    rows = read_rows(raw, pointer)
    derivative, headers = csv_bytes(rows)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as handle:
        handle.write(derivative)
    if source.read_bytes() != raw:
        raise ValueError("JSON_TABLE_ORIGINAL_CHANGED")
    return {"version": VERSION, "sourcePath": source.as_posix(), "sourceSha256": sha(raw),
            "rowArrayPointer": pointer, "path": output.as_posix(), "sha256": sha(derivative),
            "bytes": len(derivative), "rows": len(rows), "columns": len(headers),
            "scriptSha256": sha(Path(__file__).read_bytes()),
            "nullLiteral": "null", "missingCell": "", "nestedValue": "compact JSON text"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--pointer", default="", help="RFC 6901 pointer to the original object array.")
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    receipt = flatten(args.source, args.output, args.pointer)
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        with args.receipt.open("x", encoding="utf-8", newline="\n") as handle:
            json.dump(receipt, handle, ensure_ascii=True, indent=2)
            handle.write("\n")
    print(json.dumps({"version": VERSION, "rows": receipt["rows"], "columns": receipt["columns"]}))


if __name__ == "__main__":
    main()
