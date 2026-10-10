"""Refresh only this worker's touched producers, preserving all historical runtime receipt pins."""
from __future__ import annotations

import argparse
import json
import runpy
import subprocess
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[4]


def refresh_touched(pins: dict[str, Any], digest: Callable[[Path], str]) -> list[dict[str, str]]:
    base = subprocess.check_output(["git", "merge-base", "staging", "HEAD"], cwd=ROOT, text=True).strip()
    touched = subprocess.check_output(
        ["git", "diff", base, "--name-only"], cwd=ROOT, text=True,
    ).splitlines()
    changes = []
    for producer in touched:
        if producer not in pins["sourceSha256"]:
            continue
        before = pins["sourceSha256"][producer]
        after = digest(ROOT / producer)
        if before != after:
            changes.append({"producer": producer, "before": before, "after": after})
            pins["sourceSha256"][producer] = after
    return changes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", default="pins-review.json")
    args = parser.parse_args()
    receipt = ROOT / "docs/evidence/gf-backend/k3c" / Path(args.receipt).name
    if receipt.exists():
        raise FileExistsError("Preserve the create-once pin review receipt.")
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-backend/k2c/refresh-pins.py"))
    target = ROOT / "docs/api/source-pins.json"
    pins = json.loads(target.read_bytes())
    assert pins["producerHashScope"] == "crlf-to-lf"
    changes = refresh_touched(pins, helpers["digest"])
    additions = helpers["refresh_operations"](pins)
    assert not additions, "This task extends commands, not routes."
    target.write_text(json.dumps(pins, indent=2) + "\n", encoding="utf-8")
    with receipt.open("x", encoding="utf-8") as output:
        output.write(json.dumps({"hashScope": "crlf-to-lf", "reviewed": changes,
                                 "operationAdditions": additions, "runtimeReceiptsRepinned": False}) + "\n")
    print(f"Refreshed {len(changes)} touched producer pins; other producers and runtime receipts untouched.")


if __name__ == "__main__":
    main()
