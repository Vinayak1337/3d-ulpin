#!/usr/bin/env python
"""Prove full-precision parity against a frozen pre-refactor hash manifest."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any

from compact_evidence import encode

JsonDict = dict[str, Any]
ROOT = Path(__file__).resolve().parents[2]
EXCLUSIONS = {
    "candidates.json": ["/codeSha256", "/pages/*/runtimeSeconds"],
    "consistency.json": [],
}


def checksum(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def normalized(raw: bytes, filename: str) -> bytes:
    value = json.loads(raw)
    if filename == "candidates.json":
        value.pop("codeSha256")
        for page in value["pages"].values():
            page.pop("runtimeSeconds")
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def differences(before: Any, after: Any, path: str = "") -> list[str]:
    if type(before) is not type(after):
        return [path + ": type differs"]
    if isinstance(before, dict):
        changes = [path + "/" + key + ": key differs" for key in before.keys() ^ after.keys()]
        for key in before.keys() & after.keys():
            changes.extend(differences(before[key], after[key], path + "/" + key))
        return changes[:10]
    if isinstance(before, list):
        if len(before) != len(after):
            return [path + ": length differs"]
        return [
            change
            for index, (left, right) in enumerate(zip(before, after))
            for change in differences(left, right, path + "/" + str(index))
        ][:10]
    return [] if before == after else [path + ": value differs"]


def compare(record: JsonDict, after_root: Path) -> JsonDict:
    before_path = Path(record["path"])
    before_raw = before_path.read_bytes()
    assert checksum(before_raw) == record["sha256"] and len(before_raw) == record["bytes"], "baseline changed"
    after_path = after_root / record["input"] / record["file"]
    after_raw = after_path.read_bytes()
    before_normal = normalized(before_raw, record["file"])
    after_normal = normalized(after_raw, record["file"])
    return {
        "input": record["input"],
        "file": record["file"],
        "beforeFullPrecision": {"path": str(before_path), "sha256": checksum(before_raw), "bytes": len(before_raw)},
        "afterFullPrecision": {"path": str(after_path), "sha256": checksum(after_raw), "bytes": len(after_raw)},
        "beforeNormalizedSha256": checksum(before_normal),
        "afterNormalizedSha256": checksum(after_normal),
        "identical": before_normal == after_normal,
        "differences": differences(json.loads(before_normal), json.loads(after_normal)),
    }


def function_quality(function: ast.FunctionDef) -> JsonDict:
    arguments = [*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs]
    return {
        "name": function.name,
        "lines": function.end_lineno - function.lineno + 1,
        "typed": function.returns is not None
        and all(argument.annotation is not None for argument in arguments if argument.arg not in {"self", "cls"}),
    }


def file_quality(path: Path) -> JsonDict:
    text = path.read_text(encoding="utf-8")
    functions = [function_quality(node) for node in ast.walk(ast.parse(text)) if isinstance(node, ast.FunctionDef)]
    return {
        "file": path.relative_to(ROOT).as_posix(),
        "functionCount": len(functions),
        "maximumFunctionLines": max(function["lines"] for function in functions),
        "exceptionsOver40Lines": [function for function in functions if function["lines"] > 40],
        "allFunctionsTyped": all(function["typed"] for function in functions),
        "maximumLineCharacters": max(len(line) for line in text.splitlines()),
        "over120CharacterLines": [index for index, line in enumerate(text.splitlines(), 1) if len(line) > 120],
    }


def code_quality() -> list[JsonDict]:
    paths = [
        ROOT / "services/geo/geo/vector_plan.py",
        ROOT / "services/geo/geo/test_vector_plan.py",
        *sorted((ROOT / "scripts/plans").glob("*.py")),
    ]
    results = [file_quality(path) for path in paths]
    assert all(result["allFunctionsTyped"] and not result["over120CharacterLines"] for result in results)
    assert all(not result["exceptionsOver40Lines"] for result in results)
    return results


def receipt_record(after_root: Path, input_name: str) -> JsonDict:
    path = after_root / input_name / "result.json"
    raw = path.read_bytes()
    receipt = json.loads(raw)
    return {
        "input": input_name,
        "path": str(path),
        "sha256": checksum(raw),
        "bytes": len(raw),
        "layerProfileName": receipt["layerProfileName"],
        "pageResults": receipt["pageResults"],
        "sourceHashUnchanged": receipt["sourceHashUnchanged"],
    }


def git_context() -> JsonDict:
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True)
    staging = subprocess.run(["git", "rev-parse", "staging"], cwd=ROOT, capture_output=True, text=True, check=True)
    ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", "staging", "HEAD"], cwd=ROOT)
    return {
        "head": head.stdout.strip(),
        "staging": staging.stdout.strip(),
        "stagingIsAncestor": ancestor.returncode == 0,
    }


def proof(baseline: Path, after_root: Path, checks_path: Path | None = None) -> JsonDict:
    manifest = json.loads(baseline.read_text(encoding="utf-8"))
    cases = [compare(record, after_root) for record in manifest["files"]]
    receipts = [receipt_record(after_root, name) for name in ["bihar", "tower3"]]
    return {
        "version": "vector-plan-refactor-proof/1",
        "task": "P1 structure review",
        "gate": ["GF-AI:plan_rooms", "GF-T16-prerequisite"],
        "baselineManifest": {"path": str(baseline), "sha256": checksum(baseline.read_bytes())},
        "baselineGitSha": manifest["gitSha"],
        "exclusions": EXCLUSIONS,
        "normalization": "Sorted JSON object keys, no coordinate rounding or array reordering. UTF-8 compact encoding.",
        "timingNote": "Page runtime is instrumentation, not extraction output. "
        "Neither compared document has timestamps.",
        "receiptsNote": "result.json receipts retain fresh timestamps, code/git hashes "
        "and layerProfileName; not compared.",
        "layerProfileName": receipts[0]["layerProfileName"],
        "receipts": receipts,
        "codeQuality": code_quality(),
        "checks": json.loads(checks_path.read_text(encoding="utf-8")) if checks_path else [],
        "gitContext": git_context(),
        "cases": cases,
        "allIdentical": all(case["identical"] for case in cases),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument(
        "--after", required=True, type=Path, help="private full-precision root with bihar/tower3 children"
    )
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--checks", type=Path, help="optional receipt of verification commands actually executed")
    args = parser.parse_args()
    result = proof(args.baseline, args.after, args.checks)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("xb") as stream:
        stream.write(encode(result))
    print(json.dumps({"out": str(args.out), "allIdentical": result["allIdentical"]}))
    if not result["allIdentical"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
