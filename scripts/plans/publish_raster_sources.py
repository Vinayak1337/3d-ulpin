"""Publish compact publisher-member provenance, retaining originals outside Git."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from raster_common import pin, write_json

REPO = Path(__file__).resolve().parents[2]


def file_receipt(original: dict[str, Any]) -> dict[str, Any]:
    fields = ("bytes", "sha256", "archiveMember", "crc32", "acquiredAt")
    return {key: original.get(key) for key in fields}


def acquisition_summary(root: Path) -> dict[str, Any]:
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    selection = json.loads((root / "selection.json").read_text(encoding="utf-8"))
    plans = [{"id": plan["id"], "files": {name: file_receipt(original)
                                           for name, original in plan["files"].items()}}
             for plan in manifest["plans"]]
    return {"schemaVersion": "p2-cubicasa-acquisition/1", "source": "https://zenodo.org/records/2613548",
            "archive": selection["archive"], "wholeArchiveVerified": False, "classification": "test_only",
            "geography": selection["geography"], "horizontalCrs": None, "units": "pixel",
            "datasetLicense": selection["datasetLicense"], "codeModelLicense": selection["codeLicense"],
            "attribution": "Kalervo, Ylioinas, Häikiö, Karhu, Kannala / Aalto University / CubiCasa (2019)",
            "selectionRule": selection["rule"], "excludedPriorFeasibility": selection["excludedPriorFeasibility"],
            "selection": pin(root / "selection.json"), "publisherTestList": pin(root / "test.txt"),
            "privateManifest": pin(manifest_path), "originalPairs": len(plans),
            "originalBytes": sum(original["bytes"] for plan in plans for original in plan["files"].values()),
            "plans": plans, "acquisitionTimeCaution": "Null times belong to prior interrupted member downloads",
            "writer": pin(Path(__file__)), "fineTuning": False, "indianAccuracyClaim": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(REPO / "docs/evidence/gf-ai/plans/raster"):
        parser.error("output must be task-owned evidence")
    receipt = write_json(args.out, acquisition_summary(args.root))
    print(json.dumps(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
