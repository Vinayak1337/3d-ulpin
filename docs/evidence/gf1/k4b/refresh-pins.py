"""Refresh only K4b producers and its declared route; never historical runtime receipt pins."""
from __future__ import annotations

import argparse
import hashlib
import json
import runpy
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
NEW_PRODUCERS = [
    "packages/contracts/src/canonical/source-spaces.ts",
    "packages/server/src/modules/officer/source-spaces.ts",
    "packages/server/src/modules/usp/ingestion/source-building-children.ts",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    receipt = ROOT / "docs/evidence/gf1/k4b" / Path(args.receipt).name
    if receipt.exists():
        raise FileExistsError("Preserve prior pin review receipts.")
    target = ROOT / "docs/api/source-pins.json"
    pins = json.loads(target.read_bytes())
    assert pins["producerHashScope"] == "crlf-to-lf"
    changed = subprocess.check_output(["git", "diff", "0476489b", "--name-only"], cwd=ROOT, text=True).splitlines()
    changes = []
    for producer in sorted(set(changed + NEW_PRODUCERS)):
        if producer not in pins["sourceSha256"] and producer not in NEW_PRODUCERS:
            continue
        before = pins["sourceSha256"].get(producer)
        after = hashlib.sha256((ROOT / producer).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
        if before != after:
            pins["sourceSha256"][producer] = after
            changes.append({"producer": producer, "before": before, "after": after})
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-backend/k2c/refresh-pins.py"))
    additions = helpers["refresh_operations"](pins)
    target.write_text(json.dumps(pins, indent=2) + "\n", encoding="utf-8")
    receipt.write_text(json.dumps({"reviewed": changes, "operationAdditions": additions,
                                   "runtimeReceiptPinsChanged": False}) + "\n", encoding="utf-8")
    print(f"Reviewed {len(changes)} K4b producer pins and {len(additions)} operation additions.")


if __name__ == "__main__":
    main()
