"""Inspect one unchanged local DXF into fresh private, original-linked artifacts.

Run using the lane-specific pinned environment. No URLs, repairs, services,
registry writes, block expansion or caller-selected executables are accepted.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "geo"))
from geo.native_dxf import (DXFError, MAX_INPUT_BYTES, encode_dxf_result, inspect_dxf)


def _read(path):
    with path.open("rb") as handle:
        raw = handle.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("DXF input exceeds 16 MiB; no output was published.")
    return raw


def _outside_git(path):
    if any((p / ".git").exists() or p.name.casefold() == ".git" for p in (path, *path.parents)):
        raise ValueError("Output must be outside Git checkouts and Git storage.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--output-dir", required=True, type=Path,
                        help="Fresh directory outside Git, with an existing parent.")
    args = parser.parse_args()
    try:
        if re.fullmatch(r"[a-f0-9]{64}", args.expected_sha256) is None:
            raise ValueError("Expected SHA-256 must be lowercase hexadecimal.")
        source = args.source.resolve(strict=True)
        if not source.is_file():
            raise ValueError("Source must be a regular local file.")
        output = args.output_dir.resolve()
        _outside_git(output)
        if output.exists() or not output.parent.is_dir():
            raise ValueError("Output directory must be fresh, with an existing parent.")
        raw = _read(source)
        sha = hashlib.sha256(raw).hexdigest()
        if sha != args.expected_sha256:
            raise ValueError("Source differs from expected SHA-256; no output was published.")
        result = inspect_dxf(raw, temporary_parent=output.parent)
        encoded = encode_dxf_result(result)
        if hashlib.sha256(_read(source)).hexdigest() != sha:
            raise ValueError("Source changed during inspection; no output was published.")
        import importlib.metadata
        paths = {"reader": ROOT / "services/geo/geo/native_dxf.py", "cli": Path(__file__),
                 "memoryGuard": ROOT / "services/geo/geo/native_pdf.py"}
        receipt = {"schemaVersion": "dxf-local-receipt/1", "runAt": datetime.now(timezone.utc).isoformat(),
            "status": result["status"], "sourcePath": str(source), "sourceSha256": sha,
            "sourceBytes": len(raw), "dxfVersion": result["dxfVersion"], "units": result["units"],
            "projectedEntityCountIncludingChildren": result["projectedEntityCountIncludingChildren"],
            "pointCount": result["pointCount"], "unsupportedFindingCount": len(result["unsupportedFindings"]),
            "supervision": result["supervision"], "qualification": result["qualification"],
            "environment": {"python": sys.version, "platform": sys.platform,
                "dependencies": {p: importlib.metadata.version(p) for p in
                                 ("ezdxf", "numpy", "fonttools", "pyparsing", "typing_extensions")}},
            "codeHashes": {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in paths.items()},
            "artifact": {"name": "drawing.json", "sha256": hashlib.sha256(encoded).hexdigest(), "bytes": len(encoded)},
            "sourceRecheckedBeforePublication": True}
        output.mkdir(exist_ok=False)
        owned = []
        try:
            for name, content in (("drawing.json", encoded), ("receipt.json", json.dumps(receipt, indent=2).encode("utf-8"))):
                with (output / name).open("xb") as handle:
                    owned.append(output / name)
                    handle.write(content)
        except OSError:
            for path in owned:
                path.unlink()
            output.rmdir()
            raise
        print(json.dumps({"status": result["status"], "sourceSha256": sha,
                          "entitiesIncludingChildren": result["projectedEntityCountIncludingChildren"],
                          "unitsState": result["units"]["state"], "outputDirectory": str(output)}))
        return 0
    except DXFError as error:
        print(json.dumps({"error": error.as_dict()}), file=sys.stderr)
    except (OSError, ValueError) as error:
        print(json.dumps({"error": {"status": "failed", "code": "LOCAL_INPUT", "message": str(error)}}), file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
