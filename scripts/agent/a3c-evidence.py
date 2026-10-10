"""Summarise retained A3c API/SSE receipts without any runtime mutation or provider call."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path("E:/BhuAayam-data/task-data/a3c")
FIRST = ROOT / "runtime-bf387c50-05c1-42da-bd5d-44d11e4543b9"
SECOND = ROOT / "runtime-c726d4c1-a926-4dd8-bffc-17e383bde251"
XLSX = ROOT / "runtime-3310e995-113b-485a-ba95-3c4a18a0c37c"
LEARNING = Path("E:/BhuAayam-data/runtime/ulpin-demo/tabular-learning")
REPO = Path(__file__).resolve().parents[2]


def read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def pin(path: Path) -> dict[str, Any]:
    return {"path": path.as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def journey(directory: Path) -> dict[str, Any]:
    receipt = read(directory / "receipt.json")
    profile = receipt["profile"]
    chunks = read(directory / "chunks.json")
    events = read(directory / "events.json")["changes"]
    selected = [row for row in events if row["change"]["kind"] == "mapping.chunk"
                and row["change"]["jobId"] == receipt["jobId"]]
    assert len(selected) == len(chunks)
    return {"asset": profile["tabular"]["developmentAssetId"], "source": profile["source"],
            "caseId": receipt["caseId"], "rawJobId": read(directory / "raw.json")["jobId"],
            "jobId": receipt["jobId"], "records": profile["records"],
            "layoutFingerprint": profile["profile"]["layoutFingerprint"],
            "selection": profile["tabular"]["selection"],
            "status": read(directory / "status.json")["status"], "mappingSseFrames": len(selected),
            "metrics": [chunk["payload"]["mapping"]["metrics"] for chunk in chunks]}


def learning() -> dict[str, Any]:
    approved = read(FIRST / "approved.json")
    model = LEARNING / "approvals" / f"{approved['id']}-{approved['revision']}" / "learner/v44"
    manifest = read(model / "manifest.json")
    metrics = read(model / "metrics.json")
    assert manifest["version"] == "v44" and manifest["threshold"] is None
    assert metrics["partialFitCalls"] == 1
    memory = (LEARNING / "accepted-plans.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(memory) == 1
    entry = json.loads(memory[0])
    assert entry["lineage"]["officerDecisionId"] == f"{approved['id']}:{approved['revision']}"
    assert all(field["target"] == "unknown" for field in entry["plan"]["fields"])
    return {"before": pin(Path("E:/BhuAayam-data/task-data/a4/learner/v43/model.npz")),
            "after": pin(model / "model.npz"), "manifest": pin(model / "manifest.json"),
            "metrics": pin(model / "metrics.json"), "memory": pin(LEARNING / "accepted-plans.jsonl"),
            "beforeVersion": "v43", "afterVersion": "v44", "partialFitCalls": 1, "threshold": None,
            "committedAfterUpdate": 0, "parentModelSha256": manifest["parentModelSha256"],
            "approvedBatchSha256": manifest["approvedBatchSha256"], "memoryEntries": 1,
            "provenance": "Lead-entered verified T1 development unknown labels; not authenticated officer truth"}


def counts() -> dict[str, Any]:
    before = read(ROOT / "before-counts.json")
    after = read(ROOT / "after-counts.json")
    keys = ["areas", "registry", "sites", "importPackages", "physicalFeatures"]
    assert all(before[key] == after[key] for key in keys)
    return {"before": {key: len(value) if isinstance(value, list) else value for key, value in before.items()},
            "after": {key: len(value) if isinstance(value, list) else value for key, value in after.items()},
            "registryAreaSiteListsUnchanged": True, "importPackageCountUnchanged": True,
            "physicalFeatureCountUnchanged": True}


def artifacts() -> list[dict[str, Any]]:
    paths = [ROOT / "before-counts.json", ROOT / "after-counts.json", ROOT / "final-public-readback.json",
             ROOT / "served-checkpoint.json"]
    for directory in [FIRST, SECOND, XLSX]:
        paths.extend(sorted(directory.rglob("*.json")))
    return [pin(path) for path in paths]


def checks() -> dict[str, Any]:
    return {"backendTypecheck": 0, "agentTypecheck": 0, "focused": {"exit": 0, "passed": 18},
            "ai": {"exit": 0, "passed": 22}, "apiTypes": 0, "clientTypecheck": 0,
            "ruff": 0, "refreshExplicitBase": 0, "refreshMissingBaseExpectedRefusal": 1,
            "producerPinsNoNewTestPins": 0, "lineAndFunctionAudits": 0, "diffCheck": 0,
            "doctorServedK1Before": 0, "doctorA2BeforeRebindExpectedManifestMismatch": 1,
            "doctorA2AfterRebind": 0, "doctorFinal": 0, "platformStart": 0,
            "lfArchive": 0, "lfContractCheck": 1}


def qualification() -> dict[str, Any]:
    return {"proves": ["CSV through the real job, events and approval",
                       "Second known-layout file uses accepted memory with no teacher call",
                       "Learning starts only from an approved recipe",
                       "Native selected XLSX through propose-only runtime, without approval"],
            "doesNotProve": ["Mapping accuracy on property columns: every answer here is unknown",
                             "Teacher route: gateway off",
                             "Student takeover or positive mapping improvement",
                             "Automatic dispatch by the unchanged older k1 dispatcher",
                             "Historical mapped-chunk reopening after another source changes the case revision"],
            "runtimeHalf": "Real fenced-job proof; ordinary dispatcher rollout and final historical reads remain gaps"}


def limitations() -> dict[str, Any]:
    return {"publicReadback": "Both source profiles and recipe history reopen; mapped job/chunk GETs become 409 "
            "after a later source advances the same case. Successful pre-append reads are retained.",
            "dispatcher": "Only API restarted, as authorized. Exact API-enrolled jobs were driven by the existing "
            "a2 fenced worker entry points; k1 dispatcher was neither stopped nor replaced.",
            "coldChunk": "First file layouts are new/memory/new; the one-row tail changes inferred Sl.No type.",
            "fallbackProvenance": "teacherFields denotes unresolved manual fallback slots, not a provider answer; "
            "all teacherCalls are zero and the gateway is off.",
            "counts": "Areas, registry lists, sites, packages and physical features unchanged; only one new "
            "unassigned case and three real sources were added.",
            "permission": "D8 public development, test_only, permission unconfirmed; originals unchanged"}


def contract_check() -> dict[str, Any]:
    temp = Path("C:/Users/kvina/AppData/Local/Temp")
    failure = (temp / "a3c-api-lf-final.log").read_text(encoding="utf-8").strip()
    assert failure == "API-DOC: runtime receipt changed"
    return {"checkpoint": "dac2a7cdf670f602b074fb930e73ebb173a35436",
            "export": (temp / "a3c-api-lf-final-path.txt").read_text(encoding="utf-8").strip(),
            "archive": "git -c core.autocrlf=false archive HEAD | tar -x -C <fresh-unique-dir>",
            "exit": 1, "onlyFailure": failure, "runtimeReceiptsOrPinsChanged": False}


def main() -> None:
    first, second, xlsx = journey(FIRST), journey(SECOND), journey(XLSX)
    assert first["caseId"] == second["caseId"] == xlsx["caseId"]
    assert first["layoutFingerprint"] == second["layoutFingerprint"]
    assert all(row["layout"] == "memory" and row["teacherCalls"] == 0 and row["memoryHits"] == 1
               and row["needsInput"] == 0 for row in second["metrics"])
    approved = read(FIRST / "approved.json")
    approval_chunks = read(FIRST / "approval-readback/chunks.json")
    result = {"task": "A3c — Tabular enrolment and live two-file run", "gate": "GF-AGENT / GF-T06/T07",
              "base": "ccfc9de9", "caseId": first["caseId"], "first": first, "second": second, "xlsx": xlsx,
              "approval": {"recipeId": approved["id"], "revisions": [[1, "proposed"], [2, "approved"]],
                           "jobId": read(FIRST / "approval-job.json")["jobId"],
                           "metrics": [row["payload"]["mapping"]["metrics"] for row in approval_chunks]},
              "learning": learning(), "counts": counts(), "checks": checks(), "qualification": qualification(),
              "runtime": read(ROOT / "served-checkpoint.json"), "artifacts": artifacts(),
              "runCodeCommit": "6d65e4e3", "limitations": limitations(), "contractCheck": contract_check(),
              "runtimeGate": "k4a.log last line: exit 0",
              "logsRoot": "E:/BhuAayam-data/task-data/a3c/logs-3e83511514b34dfcbfcb1a5e12931308",
              "recovery": ["Enrollment test lacked local context; fixed through existing controls wrapper",
                           "Second upload used bare GET case instead of its case envelope; fixed once",
                           "Pre-rebind doctor compared a2 to served k1 manifest; served k1 doctor passed",
                           "Native stop path guard used an escaped separator; fixed to normalized path equality",
                           "Historical mapped reads refuse stale case pins; no fences relaxed or writes repeated"]}
    out = REPO / "docs/evidence/gf-agent/a3c/result.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(json.dumps({"result": str(out), "caseId": first["caseId"], "second": second["metrics"]}))


if __name__ == "__main__":
    main()
