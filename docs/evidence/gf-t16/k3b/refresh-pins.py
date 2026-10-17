"""Reuse reviewed producer/operation pin helpers; never re-pin historical runtime receipts."""
from __future__ import annotations

import argparse
import json
import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--receipt', default='pins-review.json')
    args = parser.parse_args()
    evidence = ROOT / 'docs/evidence/gf-t16/k3b' / Path(args.receipt).name
    if evidence.exists():
        raise FileExistsError('Preserve each reviewed pin receipt; choose a new name.')
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-backend/k2c/refresh-pins.py"))
    path = ROOT / "docs/api/source-pins.json"
    pins = json.loads(path.read_bytes())
    additions = ["packages/server/src/modules/officer/level-schedules.ts",
                 "packages/server/src/modules/registry/canonical-level-schedule.ts"]
    for producer in additions:
        pins["sourceSha256"].setdefault(producer, "")
    changes = []
    for producer, before in pins["sourceSha256"].items():
        after = helpers["digest"](ROOT / producer)
        if before != after:
            changes.append({"producer": producer, "before": before, "after": after})
            pins["sourceSha256"][producer] = after
    operations = helpers["refresh_operations"](pins)
    path.write_text(json.dumps(pins, indent=2) + "\n", encoding="utf-8")
    with evidence.open("x", encoding="utf-8") as output:
        output.write(json.dumps({"producerHashScope": "crlf-to-lf", "reviewed": changes,
                                 "operationAdditions": operations, "runtimeReceiptRepinned": False}) + "\n")
    print(f"Refreshed {len(changes)} reviewed producer pins; runtime receipts untouched.")


if __name__ == "__main__":
    main()
