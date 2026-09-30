"""Read one unchanged CityJSON source into fresh fixed-name private artifacts.

Uses only Python's standard library. Outputs must be outside any Git checkout.
The reader child has a 20-second hard deadline; no service or provider is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "geo"))
from geo.native_cityjson import (CityJSONError, MAX_INPUT_BYTES,
                                MAX_OUTPUT_BYTES, MAX_SECONDS)

WORKER = """
import sys,json
from geo.native_cityjson import read_cityjson,encode_cityjson_result,CityJSONError,MAX_INPUT_BYTES
try:
    raw=sys.stdin.buffer.read(MAX_INPUT_BYTES+1)
    output=encode_cityjson_result(read_cityjson(raw))
except CityJSONError as error:
    sys.stdout.buffer.write(json.dumps({'error':error.as_dict()}).encode('utf-8'))
    sys.exit(2)
sys.stdout.buffer.write(output)
"""


def _outside_git(path):
    for parent in (path, *path.parents):
        if (parent / ".git").exists() or parent.name.casefold() == ".git":
            raise ValueError("Output directory must be outside Git checkouts and Git storage.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="New directory outside Git; existing directories are refused.")
    args = parser.parse_args()
    start = time.monotonic()
    try:
        if not re.fullmatch(r"[0-9a-f]{64}", args.expected_sha256):
            raise ValueError("Expected SHA-256 must be 64 lowercase hexadecimal characters.")
        source = args.source.resolve(strict=True)
        if not source.is_file():
            raise ValueError("Source must be a regular local file.")
        output_dir = args.output_dir.resolve()
        _outside_git(output_dir)
        if output_dir.exists() or not output_dir.parent.is_dir():
            raise ValueError("Output directory must be fresh, with an existing parent directory.")
        with source.open("rb") as handle:
            raw = handle.read(MAX_INPUT_BYTES + 1)
        if len(raw) > MAX_INPUT_BYTES:
            raise ValueError("Original exceeds 8 MiB; reader was not started.")
        source_sha = hashlib.sha256(raw).hexdigest()
        if source_sha != args.expected_sha256:
            raise ValueError("Original SHA-256 differs from the expected source.")
        # No caller-supplied code, executable, network URL or output filename.
        result = subprocess.run([sys.executable, "-I", "-c",
                                 "import sys;sys.path.insert(0," + repr(str(ROOT / "services" / "geo")) + ");" + WORKER],
                                input=raw, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=20, cwd=ROOT / "services" / "geo",
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if len(result.stdout) > MAX_OUTPUT_BYTES:
            raise ValueError("Child output exceeds the reader limit.")
        if result.returncode:
            if result.returncode == 2:
                error = json.loads(result.stdout)["error"]
                print(json.dumps({"error": error}), file=sys.stderr)
                return 2
            raise ValueError("Reader child failed; no output was published.")
        parsed = json.loads(result.stdout)
        if parsed["sourceSha256"] != source_sha:
            raise ValueError("Reader returned inconsistent source lineage.")
        receipt = {"schemaVersion": "cityjson-local-receipt/1", "sourceSha256": source_sha,
                   "sourceBytes": len(raw), "sourcePath": str(source),
                   "readerSha256": hashlib.sha256((ROOT / "services/geo/geo/native_cityjson.py").read_bytes()).hexdigest(),
                   "cliSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   "pythonVersion": sys.version, "status": parsed["status"],
                   "objectCount": parsed["objectCount"], "vertexCount": parsed["vertexCount"],
                   "boundaryIndexCount": parsed["boundaryIndexCount"],
                   "decodedBounds": parsed["decodedBounds"],
                   "qualification": parsed["qualification"],
                   "readerSecondsLimit": MAX_SECONDS, "childDeadlineSeconds": 20,
                   "observedSecondsBeforePublication": round(time.monotonic() - start, 6),
                   "artifact": {"name": "cityjson.json", "bytes": len(result.stdout),
                                "sha256": hashlib.sha256(result.stdout).hexdigest()}}
        # mkdir and exclusive file creation prevent overwrite/replay. No
        # caller-controlled names and no writes to the input.
        output_dir.mkdir(exist_ok=False)
        owned_files = []
        try:
            for name, content in (("cityjson.json", result.stdout),
                                  ("receipt.json", json.dumps(receipt, ensure_ascii=False, indent=2).encode("utf-8"))):
                target = output_dir / name
                with target.open("xb") as handle:
                    owned_files.append(target)
                    handle.write(content)
        except OSError:
            for target in owned_files:
                target.unlink()
            output_dir.rmdir()
            raise
        print(json.dumps({"status": parsed["status"], "outputDirectory": str(output_dir),
                          "sourceSha256": source_sha, "objects": parsed["objectCount"],
                          "vertices": parsed["vertexCount"]}))
        return 0
    except subprocess.TimeoutExpired:
        print("Reader child exceeded 20 seconds; no output was published.", file=sys.stderr)
    except (OSError, ValueError, KeyError, CityJSONError) as error:
        print(str(error), file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
