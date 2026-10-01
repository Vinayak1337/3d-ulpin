#!/usr/bin/env python3
"""One gated packet-region renderer; no model or OCR execution."""
import argparse
import hashlib
import json
import os
import socket
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve()
REPO = SCRIPT.parents[3]
# The accepted gate initializes base site packages before the configured venv.
# Prefer the supervisor's own configured purelib for this pinned renderer.
if os.environ.get("ULPIN_TRIAL_SITEPACKAGES"):
    sys.path.insert(0, os.environ["ULPIN_TRIAL_SITEPACKAGES"])
sys.path.insert(0, str(REPO / "services/geo"))
from geo.usp_packet_regions import extract_region, RegionError, MAX_SOURCE
MEMORY = 512*1024**2
MAX_RESULT = 16*1024


def encode(value):
    data = json.dumps(value, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_RESULT:
        raise RegionError("PACKET_REGION_METADATA_LIMIT")
    return data


def worker(args):
    def denied(*a, **kw):
        raise RegionError("PACKET_REGION_EXTERNAL_RESOURCE_DENIED")
    socket.socket = socket.create_connection = socket.getaddrinfo = denied
    try:
        if args.source.stat().st_size > MAX_SOURCE or args.selection.stat().st_size > MAX_RESULT:
            raise RegionError("PACKET_REGION_SOURCE_LIMIT")
        with args.source.open("rb") as stream:
            original = stream.read(MAX_SOURCE+1)
        with args.selection.open("rb") as stream:
            selected = stream.read(MAX_RESULT+1)
        if len(selected) > MAX_RESULT:
            raise RegionError("PACKET_REGION_METADATA_LIMIT")
        result, png = extract_region(original, args.sha256, args.page, json.loads(selected), REPO)
        (args.output / "region.png").write_bytes(png)
        (args.output / "result.json").write_bytes(encode(result))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, RegionError) else "PACKET_REGION_RENDER_FAILED"
        (args.output / "result.json").write_bytes(encode({"version": "packet-region-failure/1", "code": code}))
        return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=int, default=25)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if (not 1 <= args.page <= 8 or not 1 <= args.seconds <= 25 or len(args.sha256) != 64 or
            any(v not in "0123456789abcdef" for v in args.sha256)):
        parser.error("unsupported page/hash/process bounds")
    if args.worker:
        return worker(args)
    from run_trial import _run_worker
    args.output.mkdir(mode=0o700, exist_ok=False)
    execution = _run_worker([sys.executable, str(SCRIPT), *sys.argv[1:], "--worker"],
                            args.output / "worker.log", args.seconds, MEMORY, 64*1024)
    path = args.output / "result.json"
    result_hash = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() and path.stat().st_size <= MAX_RESULT else None
    receipt = {"version": "packet-region-execution/1", "seconds": args.seconds, "memoryBytes": MEMORY,
               "worker": execution, "resultSha256": result_hash}
    (args.output / "receipt.json").write_bytes(encode(receipt))
    return 0 if execution["exitCode"] == 0 and execution["stopReason"] is None and result_hash else 1


if __name__ == "__main__":
    raise SystemExit(main())
