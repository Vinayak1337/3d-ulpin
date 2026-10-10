"""Retain a preregistered publisher test slice using bounded archive-member ranges."""
from __future__ import annotations

import argparse
import json
import struct
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from raster_common import pin, write_json

RETAINED = Path("E:/BhuAayam-data/task-data/d06-vision-cohort-20261005")
EXCLUDED = {"high_quality_architectural/1191", "high_quality_architectural/2536"}


def fetch_range(url: str, start: int, count: int, total: int) -> tuple[bytes, dict[str, Any]]:
    request = urllib.request.Request(url, headers={
        "Range": f"bytes={start}-{start + count - 1}", "Accept-Encoding": "identity",
        "User-Agent": "BhuAayam-P2-test-only/1",
    })
    with urllib.request.urlopen(request, timeout=40) as response:
        expected = f"bytes {start}-{start + count - 1}/{total}"
        if response.status != 206 or response.headers.get("Content-Range") != expected:
            raise ValueError("publisher_range_response_mismatch")
        chunks = []
        remaining = count
        while remaining:
            chunk = response.read(min(remaining, 1024 * 1024))
            if not chunk:
                raise ValueError(f"publisher_range_truncated: expected={count}, missing={remaining}, start={start}")
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        return raw, {"url": url, "contentRange": expected, "etag": response.headers.get("ETag"),
                     "acquiredAt": datetime.now(timezone.utc).isoformat()}


def read_member(entry: dict[str, Any], archive: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    count = min(archive["size"] - entry["offset"], entry["compressedBytes"] + 512)
    if count > 20 * 1024**2 or entry["bytes"] > 20 * 1024**2:
        raise ValueError("member_over_bound")
    raw, receipt = fetch_range(archive["links"]["self"], entry["offset"], count, archive["size"])
    signature, _, flags, compression, _, _, _, _, _, name_size, extra_size = struct.unpack("<I5H3I2H", raw[:30])
    if signature != 0x04034B50 or flags & 1:
        raise ValueError("unsupported_local_zip_header")
    name = raw[30:30 + name_size].decode("utf-8")
    if name != entry["name"]:
        raise ValueError("archive_member_name_mismatch")
    offset = 30 + name_size + extra_size
    compressed = raw[offset:offset + entry["compressedBytes"]]
    if len(compressed) != entry["compressedBytes"]:
        raise ValueError("local_zip_extra_field_over_bound")
    data = zlib.decompress(compressed, -15) if compression == 8 else compressed
    if compression not in {0, 8} or len(data) != entry["bytes"]:
        raise ValueError("archive_member_size_mismatch")
    if f"{zlib.crc32(data):08x}" != entry["crc32"]:
        raise ValueError("archive_member_crc_mismatch")
    return data, {**receipt, "archiveMember": name, "crc32": entry["crc32"], "rangeBytes": len(raw)}


def freeze_selection(root: Path, index: dict[str, dict[str, Any]], archive: dict[str, Any]) -> dict[str, Any]:
    data, receipt = read_member(index["cubicasa5k/test.txt"], archive)
    split = root / "test.txt"
    with split.open("xb") as stream:
        stream.write(data)
    paths = [line.strip("/\r ") for line in data.decode().splitlines() if line.strip()]
    train = set((RETAINED / "provenance/train.txt").read_text().splitlines())
    validation = set((RETAINED / "provenance/val.txt").read_text().splitlines())
    selected = [path for path in paths if path not in EXCLUDED][:100]
    if len(set(selected)) != 100 or any(f"/{path}/" in train | validation for path in selected):
        raise ValueError("invalid_fixed_test_selection")
    selection = {"schemaVersion": "p2-cubicasa-selection/1", "ids": selected,
                 "rule": "First 100 publisher test.txt paths in source order, excluding two prior feasibility plans",
                 "excludedPriorFeasibility": sorted(EXCLUDED), "split": {**pin(split), **receipt},
                 "classification": "test_only", "geography": "foreign; mostly Finland; sites undisclosed",
                 "datasetLicense": "CC-BY-NC-SA-4.0", "codeLicense": "CC-BY-NC-4.0",
                 "archive": archive, "index": pin(RETAINED / "provenance/archive-member-index.json"),
                 "fitting": False, "frozenBeforeInference": True}
    write_json(root / "selection.json", selection)
    return selection


def retain_plan(identifier: str, root: Path, index: dict[str, dict[str, Any]],
                archive: dict[str, Any]) -> dict[str, Any]:
    files = {}
    for filename in ("F1_scaled.png", "model.svg"):
        entry = index[f"cubicasa5k/{identifier}/{filename}"]
        destination = root / identifier / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            data = destination.read_bytes()
            if len(data) != entry["bytes"] or f"{zlib.crc32(data):08x}" != entry["crc32"]:
                raise ValueError("existing_original_crc_mismatch")
            receipt = {"archiveMember": entry["name"], "crc32": entry["crc32"],
                       "url": archive["links"]["self"], "resumedExistingBytes": True,
                       "acquiredAt": None, "qualification": "Prior interrupted download; exact acquisition time unknown"}
        else:
            data, receipt = read_member(entry, archive)
            with destination.open("xb") as stream:
                stream.write(data)
        files[filename] = {**pin(destination), **receipt}
    value = {"id": identifier, "files": files}
    write_json(root / identifier / "acquisition.json", value)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--selection-only", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    allowed = Path("E:/BhuAayam-data/datasets/cubicasa5k").resolve()
    if not root.is_relative_to(allowed):
        parser.error("use a task-specific subdirectory under the allowed private dataset root")
    metadata = json.loads((RETAINED / "provenance/zenodo-record-2613548.json").read_text())
    archive = metadata["files"][0]
    entries = json.loads((RETAINED / "provenance/archive-member-index.json").read_text())
    index = {entry["name"]: entry for entry in entries}
    root.mkdir(parents=True, exist_ok=True)
    selection_path = root / "selection.json"
    selection = json.loads(selection_path.read_text()) if selection_path.exists() else freeze_selection(root, index, archive)
    if args.selection_only:
        print(json.dumps(pin(selection_path)))
        return 0
    missing = [identifier for identifier in selection["ids"] if not (root / identifier / "acquisition.json").exists()]
    with ThreadPoolExecutor(max_workers=2) as pool:
        for plan in pool.map(lambda identifier: retain_plan(identifier, root, index, archive), missing):
            print("retained", plan["id"], flush=True)
    plans = [json.loads((root / identifier / "acquisition.json").read_text()) for identifier in selection["ids"]]
    write_json(root / "manifest.json", {"selection": pin(selection_path), "plans": plans})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
