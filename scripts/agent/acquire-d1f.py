"""Acquire approved public CSV exports into closed storage; promote only after whole-file screening."""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
from typing import Any
import urllib.request
import urllib.robotparser

TASK_ROOT = Path("E:/BhuAayam-data/task-data/d1f")
DATA_ROOT = Path("E:/BhuAayam-data/datasets/open-property-foreign/dev/d1f")
USER_AGENT = "BhuAayam-development-source-review/1.0"
HEADER_RISK = re.compile(
    r"owner|ownder|contact|email|phone|mobile|fax|applicant|allottee|occupant|lienholder|"
    r"tenant.?name|inspector|responsible|architect|designer|builder", re.IGNORECASE
)
CONTACT_RISK = re.compile(
    r"[\w.+%-]+@[\w.-]+\.[a-z]{2,}|\(?\d{3}\)?[- .]\d{3}[- .]\d{4}|\+\d{1,3}[ -]\d{4}",
    re.IGNORECASE,
)
OWNER_RISK = re.compile(r"\b(?:owned by\b|owner\s*:|owner is\b|owners are\b)", re.IGNORECASE)
Row = dict[str, Any]


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def save_new(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def checked_copy(source: Path, destination: Path, expected: str) -> Row:
    if digest(source) != expected:
        raise ValueError("D1F_SOURCE_HASH_CHANGED")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as original, destination.open("xb") as copied:
        shutil.copyfileobj(original, copied)
    if digest(destination) != expected:
        raise ValueError("D1F_COPY_HASH_MISMATCH")
    return {"externalPath": destination.as_posix(), "sha256": expected, "bytes": destination.stat().st_size}


def download(spec: Row, path: Path) -> Row:
    policy = urllib.robotparser.RobotFileParser()
    policy.parse(Path(spec["robotsPath"]).read_text(encoding="utf-8").splitlines())
    if not policy.can_fetch(USER_AGENT, spec["originalUrl"]):
        raise ValueError("D1F_ROBOTS_DENIED")
    request = urllib.request.Request(spec["originalUrl"], headers={"User-Agent": USER_AGENT})
    acquired_at = datetime.now(timezone.utc).isoformat()
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=90) as response, path.open("xb") as handle:
        if response.status != 200 or "text/csv" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("D1F_NOT_NATIVE_CSV")
        shutil.copyfileobj(response, handle)
    return {"externalPath": path.as_posix(), "sha256": digest(path), "bytes": path.stat().st_size,
            "acquiredAt": acquired_at, "httpStatus": 200}


def native_columns(metadata: Row) -> list[Row]:
    # Portal-computed regions exist in metadata but are absent from native CSV download exports.
    return [column for column in metadata["columns"]
            if column["position"] >= 0 and not column["fieldName"].startswith(":@")]


def screen(path: Path, metadata: Row) -> Row:
    columns = native_columns(metadata)
    if any(HEADER_RISK.search(column["name"]) for column in columns):
        raise ValueError("D1F_PROHIBITED_IDENTITY_FIELD")
    csv.field_size_limit(16 * 1024 * 1024)
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        headers = next(reader)
        if headers != [column["name"] for column in columns]:
            raise ValueError("D1F_EXPORT_SCHEMA_MISMATCH")
        if any(HEADER_RISK.search(header) for header in headers):
            raise ValueError("D1F_PROHIBITED_IDENTITY_FIELD")
        free_text = [index for index, header in enumerate(headers)
                     if re.search(r"name|address|street|reason|summary", header, re.IGNORECASE)]
        count = 0
        for row in reader:
            if len(row) != len(headers):
                raise ValueError("D1F_ROW_SCHEMA_DRIFT")
            if any(CONTACT_RISK.search(cell) or OWNER_RISK.search(cell) for cell in row):
                raise ValueError("D1F_CONTACT_OR_OWNER_LITERAL")
            if any(re.search(r"\b[0-9]{10}\b", row[index]) for index in free_text):
                raise ValueError("D1F_FREE_TEXT_TEN_DIGIT_CONTACT_RISK")
            count += 1
    return {"rows": count, "columns": len(headers), "wholeFileScreened": True,
            "policy": "Header identity/contact exclusion plus every cell contact/explicit-owner check; no redaction."}


class RecordedLines:
    """Keep the exact UTF-8 bytes consumed by csv.reader, including multiline quoted cells."""

    def __init__(self, handle: Any) -> None:
        self.handle = handle
        self.lines: list[bytes] = []

    def __iter__(self) -> RecordedLines:
        return self

    def __next__(self) -> str:
        raw = self.handle.readline()
        if not raw:
            raise StopIteration
        self.lines.append(raw)
        return raw.decode("utf-8-sig" if len(self.lines) == 1 else "utf-8")


def prefix(source: Path, destination: Path, row_limit: int = 128) -> Row:
    with source.open("rb") as handle:
        recorded = RecordedLines(handle)
        reader = csv.reader(recorded)
        next(reader)
        rows = 0
        for _ in range(row_limit):
            if next(reader, None) is None:
                break
            rows += 1
        raw = b"".join(recorded.lines)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("xb") as handle:
        handle.write(raw)
    return {"externalPath": destination.as_posix(), "sha256": digest(destination), "bytes": len(raw), "rows": rows,
            "sourcePath": source.as_posix(), "sourceSha256": digest(source),
            "sourceLocator": f"CSV header and data records 1-{rows}; native order, multiline boundaries retained",
            "recipe": "byte-exact CSV record prefix; no filtering, column selection, coercion or re-serialization",
            "script": "scripts/agent/acquire-d1f.py", "scriptSha256": digest(Path(__file__)), "rowBoundary": True}


def retained_download(spec: Row) -> Row:
    previous = json.loads(Path(spec["retainedReceipt"]).read_bytes())
    if previous.get("reason") != "D1F_EXPORT_SCHEMA_MISMATCH":
        raise ValueError("D1F_RECOVERY_NOT_AUTHORIZED")
    for key in ("id", "family", "originalUrl", "metadataPath", "issuer", "geography"):
        if previous[key] != spec[key]:
            raise ValueError("D1F_RECOVERY_LINEAGE_CHANGED")
    recorded = previous["download"]
    source = Path(recorded["externalPath"])
    if not source.resolve().is_relative_to((TASK_ROOT / "provisional").resolve()):
        raise ValueError("D1F_RECOVERY_PATH_DENIED")
    if digest(source) != recorded["sha256"]:
        raise ValueError("D1F_RECOVERY_BYTES_CHANGED")
    return recorded


def validate_spec(spec: Row) -> None:
    for key in ("metadataPath", "robotsPath", "retainedReceipt"):
        if key in spec and not Path(spec[key]).resolve().is_relative_to(TASK_ROOT.resolve()):
            raise ValueError("D1F_INPUT_PATH_DENIED")
    for key in ("id", "receiptId", "family"):
        if key in spec and not re.fullmatch(r"[a-z0-9-]+", spec[key]):
            raise ValueError("D1F_OUTPUT_PATH_DENIED")
    if not spec["originalUrl"].startswith("https://"):
        raise ValueError("D1F_PUBLIC_HTTPS_REQUIRED")


def acquire(spec: Row) -> Row:
    validate_spec(spec)
    metadata_path = Path(spec["metadataPath"])
    metadata = json.loads(metadata_path.read_bytes())
    fields = native_columns(metadata)
    if not fields or len(fields) > 256 or any(HEADER_RISK.search(column["name"]) for column in fields):
        raise ValueError("D1F_METADATA_ADMISSION_DENIED")
    closed = TASK_ROOT / "provisional" / f"{spec['id']}.csv"
    downloaded = retained_download(spec) if "retainedReceipt" in spec else download(spec, closed)
    receipt_id = spec.get("receiptId", spec["id"])
    receipt_path = TASK_ROOT / "acquisitions" / f"{receipt_id}.json"
    try:
        screening = screen(closed, metadata)
    except ValueError as error:
        save_new(receipt_path, {**spec, "download": downloaded, "state": "closed_owner_disposition_required",
                                "reason": str(error)})
        return {"id": spec["id"], "state": "excluded", "reason": str(error)}
    directory = DATA_ROOT / spec["family"]
    original = checked_copy(closed, directory / f"{spec['id']}.csv", downloaded["sha256"])
    dictionary = checked_copy(metadata_path, directory / f"{spec['id']}-dictionary.json", digest(metadata_path))
    derivative = prefix(Path(original["externalPath"]), directory / f"{spec['id']}-prefix-128.csv")
    receipt = {**spec, "original": original, "dictionary": dictionary, "prefix": derivative,
               "acquiredAt": downloaded["acquiredAt"], "httpStatus": 200, "screening": screening, "state": "selected"}
    save_new(receipt_path, receipt)
    return {"id": spec["id"], "family": spec["family"], "state": "selected", **screening}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    args = parser.parse_args()
    if not args.spec.resolve().is_relative_to(TASK_ROOT.resolve()):
        raise ValueError("D1F_SPEC_PATH_DENIED")
    specs = json.loads(args.spec.read_bytes())
    for spec in specs:
        print(json.dumps(acquire(spec)))


if __name__ == "__main__":
    main()
