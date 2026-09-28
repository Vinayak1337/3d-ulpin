#!/usr/bin/env python3
"""Run a small, supervised, offline Granite Docling page/region trial."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import fitz
import psutil

from geo.usp_document_candidates.granite import (
    MAX_CPU_THREADS, MAX_GENERATED_TOKENS, MAX_PIXELS, MAX_SIDE,
    MODEL_ID, MODEL_LICENSE, MODEL_REVISION, MPS_MEMORY_FRACTION,
    render_pdf_region, sha256_file,
    verify_model_files,
)


MAX_REGION_SECONDS = 240
MAX_PROCESS_RSS_BYTES = 6 * 1024**3
MAX_SOURCE_BYTES = 16 * 1024**2


def _valid_identifier(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", value) is not None


def _stop_process(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()


def _run_worker(command: list[str], log_path: Path, timeout_seconds: int,
                memory_cap_bytes: int) -> dict[str, Any]:
    env = os.environ.copy()
    env.update({"TOKENIZERS_PARALLELISM": "false", "OMP_NUM_THREADS": "2",
                "MKL_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2"})
    started = time.monotonic()
    max_rss = 0
    stop_reason: str | None = None
    with log_path.open("w") as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                   env=env, start_new_session=True)
        try:
            while process.poll() is None:
                elapsed = time.monotonic() - started
                if elapsed > timeout_seconds:
                    stop_reason = "runtime_cap_exceeded"
                    break
                try:
                    child = psutil.Process(process.pid)
                    rss = child.memory_info().rss + sum(
                        descendant.memory_info().rss for descendant in child.children(recursive=True)
                    )
                    max_rss = max(max_rss, rss)
                    if rss > memory_cap_bytes:
                        stop_reason = "process_memory_cap_exceeded"
                        break
                except psutil.NoSuchProcess:
                    break
                time.sleep(0.25)
        finally:
            if stop_reason:
                _stop_process(process)
        exit_code = process.wait()
    return {"exitCode": exit_code, "stopReason": stop_reason,
            "elapsedSeconds": round(time.monotonic() - started, 3),
            "peakObservedRssBytes": max_rss, "logPath": str(log_path),
            "logSha256": sha256_file(log_path)}


def _write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-new-tokens", type=int, default=MAX_GENERATED_TOKENS)
    parser.add_argument("--region-timeout-seconds", type=int, default=MAX_REGION_SECONDS)
    parser.add_argument("--memory-cap-mib", type=int, default=6144)
    args = parser.parse_args()
    if not (1 <= args.max_new_tokens <= MAX_GENERATED_TOKENS):
        parser.error("output token cap exceeds the trial profile")
    if not (1 <= args.region_timeout_seconds <= MAX_REGION_SECONDS):
        parser.error("region timeout exceeds the trial profile")
    if not (1 <= args.memory_cap_mib <= MAX_PROCESS_RSS_BYTES // 1024**2):
        parser.error("memory cap exceeds the trial profile")
    repo = Path(__file__).resolve().parents[3]
    if args.output_dir.resolve().is_relative_to(repo):
        parser.error("extraction artifacts must remain outside Git")
    if args.output_dir.exists():
        parser.error("output directory exists; run artifacts are immutable")
    plan = json.loads(args.plan.read_text())
    if plan.get("schemaVersion") != "ai-04a-offline-trial-v1":
        parser.error("unknown trial plan version")
    sources = plan.get("sources", [])
    regions = plan.get("regions", [])
    if not (1 <= len(sources) <= 2 and 1 <= len(regions) <= 4):
        parser.error("bounded trial permits at most two documents and four regions")
    if any(not _valid_identifier(item.get("id")) for item in [*sources, *regions]):
        parser.error("source and region identifiers must be safe path segments")
    by_id = {source["id"]: source for source in sources}
    if len(by_id) != len(sources) or len({region["id"] for region in regions}) != len(regions):
        parser.error("duplicate source or region identifier")
    if len({(region["sourceId"], region["page"]) for region in regions}) > 4:
        parser.error("too many selected pages")
    for source in sources:
        original = Path(source["original"]["localPath"])
        size = original.stat().st_size
        if size > MAX_SOURCE_BYTES:
            parser.error(f"source exceeds bounded profile: {source['id']}")
        if size != source["original"]["bytes"] or sha256_file(original) != source["original"]["sha256"]:
            parser.error(f"unchanged original mismatch: {source['id']}")
        with fitz.open(original) as pdf:
            if len(pdf) != source["pageCount"]:
                parser.error(f"original page count changed: {source['id']}")
    model_files = verify_model_files(args.model_dir)
    args.output_dir.mkdir(parents=True)
    receipt_path = args.output_dir / "trial-receipt.json"
    receipt: dict[str, Any] = {
        "status": "running", "modelDerived": True, "nativeText": False,
        "plan": {"path": str(args.plan), "sha256": sha256_file(args.plan)},
        "code": {
            "runnerSha256": sha256_file(Path(__file__)),
            "adapterSha256": sha256_file(repo / "services/geo/geo/usp_document_candidates/granite.py"),
            "workerSha256": sha256_file(repo / "services/geo/geo/usp_document_candidates/worker.py"),
            "requirementsSha256": sha256_file(repo / "services/geo/requirements-document-models.txt"),
        },
        "model": {"id": MODEL_ID, "revision": MODEL_REVISION, "license": MODEL_LICENSE,
                  "cardUrl": "https://huggingface.co/ibm-granite/granite-docling-258M", "files": model_files},
        "sources": sources,
        "bounds": {"maxDocuments": 2, "maxRegions": 4, "maxSourceBytes": MAX_SOURCE_BYTES,
                   "maxPixelsPerRegion": MAX_PIXELS,
                   "maxImageSide": MAX_SIDE, "maxGeneratedTokens": args.max_new_tokens,
                   "cpuThreads": MAX_CPU_THREADS, "regionTimeoutSeconds": args.region_timeout_seconds,
                   "processMemoryCapBytes": args.memory_cap_mib * 1024**2,
                   "mpsMemoryFraction": MPS_MEMORY_FRACTION},
        "runtime": {"python": sys.version.split()[0], "platform": platform.platform(),
                    "torch": importlib.metadata.version("torch"),
                    "transformers": importlib.metadata.version("transformers"),
                    "doclingCore": importlib.metadata.version("docling-core")},
        "regions": [],
    }
    _write_receipt(receipt_path, receipt)
    failed = False
    for region in regions:
        if region["sourceId"] not in by_id:
            raise ValueError(f"unknown source for region: {region['id']}")
        original = Path(by_id[region["sourceId"]]["original"]["localPath"])
        image_path = args.output_dir / "rendered" / (region["id"] + ".png")
        item: dict[str, Any] = {"id": region["id"], "sourceId": region["sourceId"],
                                "sourceSha256": by_id[region["sourceId"]]["original"]["sha256"],
                                "status": "rendering"}
        receipt["regions"].append(item)
        _write_receipt(receipt_path, receipt)
        try:
            item["render"] = render_pdf_region(original, region["page"], region["bboxNorm"], image_path)
            output_path = args.output_dir / "regions" / region["id"]
            output_path.parent.mkdir(parents=True, exist_ok=True)
            command = [sys.executable, "-m", "geo.usp_document_candidates.worker",
                       "--image", str(image_path), "--model-dir", str(args.model_dir),
                       "--output-dir", str(output_path), "--max-new-tokens", str(args.max_new_tokens),
                       "--cpu-threads", str(MAX_CPU_THREADS)]
            item["worker"] = _run_worker(command, args.output_dir / (region["id"] + ".log"),
                                         args.region_timeout_seconds, args.memory_cap_mib * 1024**2)
            if item["worker"]["exitCode"] != 0 or item["worker"]["stopReason"]:
                item["status"] = "failed"
                item["failure"] = item["worker"]["stopReason"] or "model_or_tool_error"
                failed = True
            else:
                model_result_path = output_path / "model-result.json"
                model_result = json.loads(model_result_path.read_text())
                item["modelResult"] = {"path": str(model_result_path),
                                       "sha256": sha256_file(model_result_path),
                                       "generatedTokens": model_result["generatedTokens"],
                                       "hitTokenCap": model_result["hitTokenCap"],
                                       "parseError": model_result["parseError"],
                                       "hasAlphanumericMarkdown": model_result["hasAlphanumericMarkdown"],
                                       "markdownArtifact": model_result.get("markdownArtifact"),
                                       "doctagsArtifact": model_result["doctagsArtifact"],
                                       "device": model_result["device"],
                                       "dtype": model_result["dtype"],
                                       "inputTokens": model_result["inputTokens"],
                                       "elapsedSeconds": model_result["elapsedSeconds"],
                                       "peakProcessRssBytes": model_result["peakProcessRssBytes"],
                                       "mpsDriverAllocatedBytes": model_result["mpsDriverAllocatedBytes"]}
                if model_result["hasAlphanumericMarkdown"]:
                    item["status"] = "model_derived_extraction"
                else:
                    item["status"] = "model_derived_no_text"
                    item["failure"] = "no_alphanumeric_markdown"
                    failed = True
        except Exception as exc:
            item["status"] = "failed"
            item["failure"] = f"{type(exc).__name__}: {exc}"
            failed = True
        _write_receipt(receipt_path, receipt)
        print(json.dumps({"region": region["id"], "status": item["status"],
                          "failure": item.get("failure")}), flush=True)
        if item["status"] == "failed":
            break
    receipt["status"] = "failed" if failed else "completed"
    _write_receipt(receipt_path, receipt)
    print(json.dumps({"trialStatus": receipt["status"], "receipt": str(receipt_path),
                      "completedRegions": sum(item["status"] == "model_derived_extraction" for item in receipt["regions"])}))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
