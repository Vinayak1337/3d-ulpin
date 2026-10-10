"""Read-only D1c amendment checks; output counts only, never evaluator fields or values."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
PACK = Path(__file__).resolve().parent
BASE = "f5539916"
Row = dict[str, Any]


def load(path: Path) -> Row:
    return json.loads(path.read_bytes())


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def previous(path: Path) -> Row:
    relative = path.relative_to(ROOT).as_posix()
    return json.loads(subprocess.check_output(["git", "show", BASE + ":" + relative], cwd=ROOT))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def verify_history(manifest: Row, heldout: Row) -> None:
    old = previous(PACK / "manifest.json")
    old_closed = previous(PACK / "heldout.json")
    for key in ("assets", "families"):
        require(manifest[key][:len(old[key])] == old[key], "Historical development metadata changed")
        require(heldout[key] == old_closed[key], "Historical evaluator metadata changed")
    require(manifest["heldout"] == old["heldout"], "Teacher-safe blind summary changed")
    require(digest((PACK / "heldout.json").read_bytes()) == manifest["freeze"]["sha256"], "Blind seal mismatch")
    all_assets = manifest["assets"] + heldout["assets"]
    require(len({asset["id"] for asset in all_assets}) == len(all_assets), "Duplicate asset ID")
    require(not ({asset["original"]["sha256"] for asset in manifest["assets"]}
                 & {asset["original"]["sha256"] for asset in heldout["assets"]}), "Split byte overlap")
    require(manifest["fileCounts"] == {"development": 34, "heldout": 5, "total": 39, "families": 27},
            "Whole-pack counts mismatch")


def verify_development(manifest: Row) -> None:
    assets = [asset for asset in manifest["assets"] if asset["family"] == "mi-d22"]
    require(len(assets) == 2, "D1c source count mismatch")
    for asset in assets:
        raw = Path(asset["original"]["externalPath"]).read_bytes()
        require(digest(raw) == asset["original"]["sha256"], "Original hash mismatch")
        require(len(raw) == asset["original"]["bytes"] <= 1_000_000, "Original size mismatch")
        require((ROOT / asset["developmentCopy"]).read_bytes() == raw, "Copy not byte-identical")
        rows = json.loads(raw)["responseObject"]
        schema = asset["sourceSchema"]
        fields = list(rows[0])
        fingerprint = digest(json.dumps(fields, ensure_ascii=True, separators=(",", ":")).encode())
        require(fingerprint == schema["layoutFingerprint"], "Ordered-key fingerprint mismatch")
        require(len(rows) == schema["dataRows"] and len(fields) == schema["columnCount"], "Layout mismatch")
        require(all(list(row) == fields for row in rows), "Unexpected row schema")
        require(schema["canonicalTargets"] is None and schema["evaluationEligible"] is False, "Dev label added")
        require(all(row["createdBy"] in (None, "Admin", "SPOTNHB")
                    and row["lastModifiedBy"] is None for row in rows), "Unverified audit identity present")
        require(not any(re.search(r"email|phone|mobile|owner|allottee|customer|person", field, re.I)
                        for field in fields), "Personal column admitted")
        require(asset["purpose"] == "test_only" and asset["permission"]["state"] == "unconfirmed",
                "Development source overqualified")


def verify_empty_freeze(heldout: Row) -> None:
    require(heldout["familySets"]["d1c"]["familyIds"] == [], "Checkpoint unexpectedly opens new families")
    pin = heldout["familySets"]["a3"]["frozenManifest"]
    raw = Path(pin["externalPath"]).read_bytes()
    require(len(raw) == pin["bytes"] and digest(raw) == pin["sha256"], "A3 snapshot pin mismatch")
    require(json.loads(raw) == previous(PACK / "heldout.json"), "A3 snapshot changed")
    receipt = load(ROOT / "docs/evidence/gf-agent/d1c/heldout-truth-freeze.json")
    truth = Path(receipt["path"]).read_bytes()
    require(truth == b"" and receipt["sha256"] == digest(truth), "Empty checkpoint truth changed")
    require(receipt["manifestSha256"] == digest((PACK / "heldout.json").read_bytes()), "Receipt seal mismatch")
    require(receipt["families"] == [] and all(receipt[key] == 0 for key in
            ("files", "columns", "scorable", "positiveTargets", "teacherCalls", "trainingWrites", "memoryWrites")),
            "Empty checkpoint overclaims")
    require(receipt["status"] == "blocked_no_eligible_property_holdout", "Blocked state missing")


def verify_catalogue() -> None:
    path = ROOT / "docs/api/datasets.json"
    current = load(path)
    old = previous(path)
    require(all(current[key] == old[key] for key in old if key != "retainedExternalSources"),
            "Unrelated catalogue sections changed")
    old_entries = old["retainedExternalSources"]
    entries = current["retainedExternalSources"]
    require(len(entries) == len(old_entries), "Source catalogue history removed or added")
    changed = {"d1-messy-india-development-20261010", "d1-messy-india-heldout-20261010"}
    for before, after in zip(old_entries, entries):
        require(before.get("id") == after.get("id"), "Catalogue identity or order changed")
        if after.get("id") not in changed:
            require(before == after, "Unrelated catalogue source changed")
            continue
        require(after["manifestSha256"] == digest((ROOT / after["manifest"]).read_bytes()), "Catalogue pin stale")
        require(after["runtimeVerified"] is False and after["apiInstallation"] == "not-installed",
                "Catalogue runtime overclaim")


def main() -> None:
    manifest = load(PACK / "manifest.json")
    heldout = load(PACK / "heldout.json")
    verify_history(manifest, heldout)
    verify_development(manifest)
    verify_empty_freeze(heldout)
    verify_catalogue()
    print(json.dumps({"integrityChecks": "passed", "developmentFamilies": 1, "developmentFiles": 2,
                      "heldoutFamilies": 0, "heldoutFiles": 0, "heldoutColumns": 0,
                      "heldoutScorable": 0, "heldoutPositiveTargets": 0, "taskThresholdsMet": False}))


if __name__ == "__main__":
    main()
