#!/usr/bin/env python3
"""Supervise one offline, source-bound Docling/Tesseract PDF selection."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[3]
sys.path.insert(0, str(SCRIPT.parent))
sys.path.insert(0, str(REPO / "services" / "geo"))

from geo.usp_document_candidates.docling_tesseract import (  # noqa: E402
    MAX_ITEMS, MAX_RESULT_BYTES, SourceOcrError, encode_result_bounded,
    extract_source_page, sha256_file, verify_assets, verify_source,
)
from run_trial import _run_worker  # noqa: E402


MAX_WORKER_SECONDS = 600
MAX_MEMORY_BYTES = 6 * 1024**3
MAX_LOG_BYTES = 2 * 1024**2


def _failure_result(source_hash: str, page: int, exc: Exception) -> dict[str, Any]:
    code = exc.code if isinstance(exc, SourceOcrError) else "unexpected_worker_error"
    return {
        "schemaVersion": "source-ocr-candidate/1",
        "sourceSha256": source_hash,
        "sourcePage": page,
        "toolStatus": "unavailable" if isinstance(exc, SourceOcrError) and exc.unsupported else "failed",
        "outputStatus": "failed",
        "selection": {"rasterProcessing": "none", "textCompleteness": "unverified"},
        "items": [],
        "issues": [code],
    }


def _worker(args: argparse.Namespace) -> int:
    try:
        result = extract_source_page(
            args.source, args.expected_source_sha256, args.page, args.region,
            args.output / "render.png", args.models, args.tesseract, args.tessdata,
            args.max_items,
        )
    except Exception as exc:
        traceback.print_exc()
        result = _failure_result(args.expected_source_sha256, args.page, exc)
    try:
        (args.output / "result.json").write_bytes(encode_result_bounded(result))
    except SourceOcrError:
        # Nothing unbounded is ever written as a result. The parent records the
        # missing result as a failed attempt without reading a large file.
        traceback.print_exc()
        return 1
    return 0 if result["toolStatus"] in ("complete", "partial", "unavailable") else 1


def _read_bounded_result(path: Path) -> tuple[dict[str, Any] | None, str]:
    if not path.is_file():
        return None, "missing"
    if path.stat().st_size > MAX_RESULT_BYTES:
        return None, "over_byte_limit"
    try:
        value = json.loads(path.read_bytes())
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, "invalid_json"
    if not isinstance(value, dict) or value.get("schemaVersion") != "source-ocr-candidate/1":
        return None, "invalid_schema"
    return value, "accepted"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--expected-source-sha256", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--region", nargs=4, type=float, default=None,
                        metavar=("X0", "Y0", "X1", "Y1"),
                        help="optional source PDF display-page top-left point box")
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--tesseract", type=Path, required=True)
    parser.add_argument("--tessdata", type=Path, required=True)
    parser.add_argument("--max-items", type=int, default=MAX_ITEMS)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        return _worker(args)
    if args.output.resolve().is_relative_to(REPO) or args.output.exists():
        parser.error("output must be a new directory outside Git")
    if not 1 <= args.max_items <= MAX_ITEMS:
        parser.error("max-items exceeds the bounded profile")
    source = verify_source(args.source, args.expected_source_sha256)
    assets = verify_assets(args.models, args.tesseract, args.tessdata)
    packages = {name: importlib.metadata.version(name) for name in (
        "docling-slim", "docling-core", "docling-ibm-models", "docling-parse",
        "torch", "transformers", "PyMuPDF", "psutil")}
    if packages["docling-slim"] != "2.131.0":
        raise SourceOcrError("unsupported_docling_version")

    args.output.mkdir(parents=True)
    worker_command = [sys.executable, str(SCRIPT), "--worker",
                      "--source", str(args.source),
                      "--expected-source-sha256", args.expected_source_sha256,
                      "--page", str(args.page),
                      "--models", str(args.models),
                      "--tesseract", str(args.tesseract),
                      "--tessdata", str(args.tessdata),
                      "--max-items", str(args.max_items),
                      "--output", str(args.output)]
    if args.region is not None:
        worker_command.extend(["--region", *(str(value) for value in args.region)])
    os.environ["PATH"] = str(args.tesseract.parent) + os.pathsep + os.environ["PATH"]
    os.environ["TESSDATA_PREFIX"] = str(args.tessdata)
    worker = _run_worker(worker_command, args.output / "worker.log", MAX_WORKER_SECONDS,
                         MAX_MEMORY_BYTES, max_log_bytes=MAX_LOG_BYTES)
    result_path = args.output / "result.json"
    result, disposition = _read_bounded_result(result_path)
    if result is not None and result.get("sourceSha256") != source["sha256"]:
        result, disposition = None, "source_hash_mismatch"
    status = (result.get("outputStatus") if result is not None and
              worker["exitCode"] == 0 and worker["stopReason"] is None else "failed")
    receipt = {
        "schemaVersion": "source-ocr-attempt/1",
        "createdUtc": datetime.now(timezone.utc).isoformat(),
        "source": {"path": str(args.source), **source, "page": args.page,
                   "region": args.region},
        "assets": assets,
        "packages": packages,
        "code": {"runnerSha256": sha256_file(SCRIPT),
                 "adapterSha256": sha256_file(REPO / "services" / "geo" / "geo" /
                                              "usp_document_candidates" / "docling_tesseract.py")},
        "limits": {"sourceBytes": 16 * 1024**2, "sourcePages": 8,
                   "renderPixels": 1_600_000, "renderSide": 1_400,
                   "items": args.max_items, "resultBytes": MAX_RESULT_BYTES,
                   "logBytes": MAX_LOG_BYTES, "workerSeconds": MAX_WORKER_SECONDS,
                   "memoryBytes": MAX_MEMORY_BYTES, "cpuThreads": 2},
        "worker": worker,
        "result": {"disposition": disposition,
                   "bytes": result_path.stat().st_size if result_path.is_file() else None,
                   "sha256": sha256_file(result_path) if result_path.is_file()
                   and result_path.stat().st_size <= MAX_RESULT_BYTES else None,
                   "toolStatus": result.get("toolStatus") if result is not None else None,
                   "outputStatus": result.get("outputStatus") if result is not None else None,
                   "itemCount": len(result.get("items", [])) if result is not None else None,
                   "issues": result.get("issues") if result is not None else None},
        "status": status,
    }
    (args.output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": status, "toolStatus": receipt["result"]["toolStatus"],
                      "itemCount": receipt["result"]["itemCount"],
                      "worker": worker, "receipt": str(args.output / "receipt.json")}, indent=2))
    return 0 if status in ("complete", "partial") else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (SourceOcrError, OSError) as exc:
        print(f"source OCR preflight failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
