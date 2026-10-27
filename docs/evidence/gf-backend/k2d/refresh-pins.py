"""Reuse the reviewed LF producer/operation helpers; preserve historical receipt pins."""
from __future__ import annotations

import json
import runpy
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[4]


def receipt_encodings() -> list[dict[str, Any]]:
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-backend/k2b/check-lf-export.py"))
    qualification = json.loads((ROOT / "docs/api/runtime-qualification.json").read_text(encoding="utf-8"))
    observations = []
    for run in [qualification, *qualification.get("additionalRuns", [])]:
        path = ROOT / run["receipt"]
        data = path.read_bytes()
        exact = helpers["exact_receipt"](data, run["receiptSha256"])
        if exact != data:
            observations.append({"receipt": run["receipt"], "recordedSha256": run["receiptSha256"],
                                 "cause": "LF/CRLF encoding only; recorded exact bytes recoverable",
                                 "decision": "Preserve receipt and pin; normalize only fresh verification export"})
    return observations


def main() -> None:
    helpers = runpy.run_path(str(ROOT / "docs/evidence/gf-backend/k2c/refresh-pins.py"))
    receipt = ROOT / "docs/evidence/gf-backend/k2d/pins-review.json"
    if receipt.exists():
        raise FileExistsError("Pin review already retained; do not overwrite it.")
    path = ROOT / "docs/api/source-pins.json"
    pins = json.loads(path.read_text(encoding="utf-8"))
    changes = []
    for name, before in pins["sourceSha256"].items():
        after = helpers["digest"](ROOT / name)
        if before != after:
            changes.append({"producer": name, "before": before, "after": after})
            pins["sourceSha256"][name] = after
    additions = helpers["refresh_operations"](pins)
    encodings = receipt_encodings()
    path.write_text(json.dumps(pins, indent=2) + "\n", encoding="utf-8")
    receipt.write_text(json.dumps({"reviewed": changes, "operationAdditions": additions,
                                   "receiptEncodings": encodings,
                                   "schemaChanged": False, "openapiRegenerated": False}) + "\n", encoding="utf-8")
    print(f"Refreshed {len(changes)} reviewed producer pins; {len(encodings)} receipt encoding observations.")


if __name__ == "__main__":
    main()
