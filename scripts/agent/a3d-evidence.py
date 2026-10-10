"""Summarise A3d's retained evidence; never contacts the runtime or a provider."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
ROOT = Path("E:/BhuAayam-data/task-data/a3d")
EVIDENCE = REPO / "docs/evidence/gf-agent/a3d"


def read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def pin(path: Path) -> dict[str, str]:
    if path.name.lower() in {".env", "demo.env"}:
        raise ValueError("EVIDENCE_CREDENTIAL_PATH_DENIED")
    return {"path": path.as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def runtime() -> dict[str, Any]:
    result = read(EVIDENCE / "runtime.json")
    for artifact in result["artifacts"]:
        assert pin(Path(artifact["path"]))["sha256"] == artifact["sha256"]
    assert result["mappingSseFrames"] == 3 and result["automaticDispatcher"] and not result["approval"]
    case = read(ROOT / "step0-case-readback.json")
    ids = {result["rawJobId"], result["mappingJobId"]}
    jobs = [job for job in case["jobs"] if job["id"] in ids]
    assert len(jobs) == 2 and all(job["status"] == "succeeded" for job in jobs)
    result["jobAuthorityStates"] = [{"id": job["id"], "status": job["status"]} for job in jobs]
    result["teacherDisposition"] = "One replay attempt; TEACHER_REPLAY_UNAVAILABLE; gateway disabled, no provider call."
    result["scope"] = "Step 0 only, at a4592e12. Later code is software-qualified and not served by this checkout."
    return result


def comparison() -> dict[str, Any]:
    result = read(EVIDENCE / "layout-comparison.json")
    assert result["verifiedColumns"] == 398
    assert result["headerStructure"]["conflictingVerifiedLabelPairs"] == 0
    assert result["decision"] == "tabular-header/2"
    return result


def memory() -> dict[str, Any]:
    path = Path("E:/BhuAayam-data/runtime/ulpin-demo/tabular-learning/accepted-plans.jsonl")
    entries = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(entries) == 1
    assert entries[0]["lineage"]["officerDecisionId"] == "69fff9eb-cde7-4c35-868d-d131199c5dba:2"
    assert all(field["target"] == "unknown" for field in entries[0]["plan"]["fields"])
    artifact = pin(path)
    assert artifact["sha256"] == "a623cb97c1c4cce94c886d72aac153568693bd01d3a412cdbfdc696dd3dcd8e0"
    return {**artifact, "entries": 1, "unchangedAgainst": "docs/evidence/gf-agent/a3c/result.json",
            "retainedFingerprintVersion": "column-types/1 (legacy, implicit)",
            "newFingerprintVersion": "tabular-header/2", "migration": "none; immutable read compatibility",
            "compatibility": "CSV sheet/header [1], exact old typed layout, canonical revalidation "
                             "and officer precedence.",
            "qualification": "Lead-entered T1 development decisions; not independent or authenticated officer truth."}


def derivatives() -> dict[str, Any]:
    path = REPO / "fixtures/usp/D8-messy-india/dev/d1c/derivatives.json"
    index = read(path)
    entries = []
    for derivative in index["derivatives"]:
        if derivative["family"] != "mi-d22":
            continue
        artifact = pin(REPO / derivative["developmentCopy"])
        assert artifact["sha256"] == derivative["sha256"]
        assert (REPO / derivative["developmentCopy"]).stat().st_size == derivative["bytes"]
        entries.append({"file": derivative["developmentCopy"], "sha256": derivative["sha256"],
                        "bytes": derivative["bytes"], "rows": derivative["rows"], "columns": derivative["columns"],
                        "derivativeOf": {"originalSha256": derivative["originalSha256"], "version": index["version"]}})
    assert len(entries) == 2
    return {"index": pin(path), "acceptedSoftwareInputs": entries, "liveImports": 0,
            "qualification": "Unlabelled development CSV derivatives of recorded JSON originals, not publisher CSV."}


def checks(logs: Path, api_lf: Path | None) -> dict[str, Any]:
    result = read(logs / "checks.json")
    result["logPins"] = [pin(path) for path in sorted(logs.glob("*.log"))]
    result["checksPin"] = pin(logs / "checks.json")
    assert "All checks passed" in (logs / "a3d-ruff.log").read_text(encoding="utf-8")
    result["ruff"] = 0
    if api_lf:
        text = api_lf.read_text(encoding="utf-8")
        assert text.strip() == "API-DOC: runtime receipt changed"
        result["apiLf"] = {"exit": 1, "onlyFailure": text.strip(), "log": pin(api_lf),
                           "qualification": "Reserved owner receipt unchanged; not a full contract-check pass."}
    else:
        result["apiLf"] = {"state": "pending committed true-LF archive check"}
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-lf", type=Path)
    args = parser.parse_args()
    logs = Path(read(ROOT / "evidence-input.json")["logs"])
    verified = checks(logs, args.api_lf)
    result = {"task": "A3d", "gates": ["GF-AGENT", "GF-STREAM"], "baseCommit": "a4592e12",
              "qualification": "Pinned dispatcher runtime proof; later software checks pass; "
                               "scope exceptions recorded.",
              "runtime": runtime(), "layoutComparison": comparison(), "memory": memory(),
              "derivatives": derivatives(), "checks": verified,
              "scopeExceptions": verified.pop("scopeExceptions"),
              "history": "Read-only current/reasons; private/source/input/payload checks survive; "
                         "write fences unchanged.",
              "completion": "Tables: unresolved drafts finish completed; quarantines/refusal markers keep "
                            "rejections. GIS: unresolved, duplicate-key and drifted records keep "
                            "completed_with_rejections.",
              "gaps": ["Post-merge owner rollout and real historical/read/completion qualification are required.",
                       "No property-positive accuracy, student improvement, live teacher or TNHB runtime claim.",
                       "Frozen truth and holdout evaluation were not used; a forbidden filename scan is disclosed."],
              "next": "Lead reviews scope exceptions, merges on staging, then authorised owner rolls both "
                      "demo processes."}
    (EVIDENCE / "result.json").write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
