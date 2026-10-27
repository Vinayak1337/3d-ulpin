"""Create an offline K4b handoff receipt from preserved check logs and visual derivatives."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / "docs/evidence/gf1/k4b"
EXTERNAL = Path("E:/BhuAayam-data/task-data/k4b")
LOGS = {
    "backend": ("backend-final-unknown.log", 0), "focused": ("focused-final-unknown.log", 0),
    "openapi": ("openapi-unknown.log", 0), "apiTypes": ("api-types-unknown.log", 0),
    "apiClient": ("api-client-final-unknown.log", 0), "studio": ("studio-final-unknown.log", 0),
    "sqlVerifier": ("sql-verifier-final-production.log", 0), "apiStrictLf": ("api-check-final.log", 1),
    "exactRequest": ("request-check.log", 0), "visualFallback": ("render-offline.log", 0),
    "productWholePageRender": ("render-whole.log", 1),
}


def log_receipts() -> dict:
    checks = {}
    for name, (relative, code) in LOGS.items():
        path = EXTERNAL / relative
        data = path.read_bytes()
        checks[name] = {"exitCode": code, "path": path.as_posix(),
                        "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    return checks


def checked_controls() -> dict:
    strict = json.loads((EVIDENCE / "api-check-final.json").read_bytes())
    assert strict["onlyRuntimeReceiptChanged"] and len(strict["receiptMismatches"]) == 4
    tests = (EXTERNAL / "focused-final-unknown.log").read_text(encoding="utf-8")
    count = int(re.search(r"tests (\d+)", tests).group(1))
    assert count == 40 and "fail 0" in tests
    styles = json.loads((EXTERNAL / "style-check.json").read_bytes())
    functions = json.loads((EXTERNAL / "functions-check.json").read_bytes())
    assert not styles["issues"] and all(item["lines"] <= 40 for item in functions)
    report = (EVIDENCE / "REPORT.md").read_text(encoding="utf-8")
    request = json.loads((EVIDENCE / "k4c-source-space-request.json").read_bytes())
    embedded = json.loads(report.split("```json\n", 1)[1].split("```", 1)[0])
    assert embedded == request
    return {"productionCommit": strict["checkedCommit"], "checks": log_receipts(),
            "focusedTests": {"pass": count, "fail": 0, "database": "memory SQL only"},
            "style": {"newCodeColumns": 120, "newNamedFunctionLines": 40, "violations": 0},
            "apiInventory": {"operations": 294, "schemas": 331, "newRouteRuntimeVerified": False},
            "strictApi": {"exitCode": 1, "onlyRuntimeReceiptChanged": True, "historicalReceiptFailures": 4,
                          "receipt": "api-check-final.json", "repinned": False}}


def visual_result() -> dict:
    visual = json.loads((EVIDENCE / "visual-evidence.json").read_bytes())
    artifacts = [{**item, "path": Path(item["path"]).as_posix()} for item in visual["artifacts"]]
    return {"source": {"path": Path(visual["source"]).as_posix(), "sha256": visual["sourceSha256"],
                       "bytes": visual["sourceBytes"], "sourceId": "5293cd72-2377-4deb-a51c-c76d11ccb429",
                       "sourceRevision": 1, "page": 1, "frame": visual["metadata"]["pages"][0]["frame"]},
            "visualArtifacts": artifacts, "literalLabels": ["2ND FLOOR PLAN", "UNIT-3B"],
            "transcription": "visual officer-entered candidate; no extraction accuracy claim",
            "citedCropContainsSibling": True, "unitBoundaryReviewed": False,
            "productWholePageRender": visual["productWholePageRender"], "visualFallback": visual["fallback"]}


def implementation_result() -> dict:
    return {"task": "K4b", "gateScope": ["GF1", "GF-T15"], "status": "offline_implementation_verified",
            "fullRuntimeGatePassed": False, "observedAt": datetime.now(timezone.utc).isoformat(),
            "baseCommit": "0476489be0bbf36331c5c8880e97ae1d9d359c4d", "branch": "task/k4b-source-spaces",
            "steps": {"sqlAllowlist": "complete; K4a only", "sourceSpaceCommand": "complete",
                      "canonicalChildren": "complete", "p3Wiring": "complete; offline protocol evidence only"},
            "runtime": {"demoQueries": 0, "productWrites": 0, "migrationWrites": 0, "startupShutdown": 0,
                        "resetReseed": False, "ocrInferenceAcquisition": False, "heldOutReads": False,
                        "credentialsRead": False, "liveCodesAssigned": 0, "cardsGenerated": 0},
            "sqlMigrationAdded": False, "registryTsChanged": False,
            "p3": {"generatorChanged": False, "assignmentAuthority": "existing prepare/assign protocol",
                   "displayOnlyUnknownKinds": "?", "unknownLevel": "L?", "anchorState": "not_supplied",
                   "locationControl": "NO-ANCHOR / ?01 / L? / ?001"},
            "packetGuard": "blocked_required_context / committed_region_binding_unavailable",
            "k4cRequest": "k4c-source-space-request.json", "report": "REPORT.md", "pushed": False,
            "commits": subprocess.check_output(["git", "log", "--format=%H", "0476489b..HEAD"],
                                              cwd=ROOT, text=True).splitlines()}


def main() -> None:
    target = EVIDENCE / "result.json"
    assert not target.exists(), "Keep final receipts immutable."
    result = {**implementation_result(), **checked_controls(), **visual_result()}
    with target.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2)
        stream.write("\n")
    print("K4b result created: 40 offline tests; runtime untouched; four historical strict API failures preserved.")


if __name__ == "__main__":
    main()
