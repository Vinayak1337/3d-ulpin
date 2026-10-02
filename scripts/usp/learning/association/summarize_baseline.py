"""Score accepted baseline artifacts against pre-model source-supported expectations."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(root):
    stage = json.loads((root / "stage.json").read_bytes())
    accepted = json.loads((root / "receipts/association_student-run-accepted.json").read_bytes())
    guard_path = root / "receipts/association_student-run-guard.json"
    assert sha(guard_path) == accepted["guardSha256"]
    guard = json.loads(guard_path.read_bytes())
    assert guard["outputsAccepted"] and guard["cleanup"]["passed"]
    for relative, digest in accepted["artifacts"].items():
        assert sha(root / "outputs" / relative) == digest
    freeze = json.loads((root / "inputs/run-freeze.json").read_bytes())
    expected_path = Path(stage["sourceExpectations"])
    assert sha(expected_path) == freeze["expectedClaimsSha256"]
    expected = {row["exampleId"]: row["expected"] for row in json.loads(expected_path.read_bytes())["examples"]}
    results = json.loads((root / "outputs/baseline/result.json").read_bytes())
    raw = json.loads((root / "outputs/baseline/raw-outputs.json").read_bytes())
    batch = {row["exampleId"]: row for row in json.loads((root / "inputs/development.json").read_bytes())["examples"]}
    signature = lambda c: (c["role"], c["state"], c["literal"], c["unit"])
    counts = {"examples": len(expected), "families": 1, "validModelOutputs": 0, "expectedClaims": 0,
              "acceptedClaims": 0, "correctAcceptedClaims": 0, "emittedCitations": 0, "exactEmittedCitations": 0,
              "canonicalAbstentions": 0}
    for row in results["results"]:
        truth = {signature(c) for c in expected[row["exampleId"]]["claims"]}
        projected = row["acceptedProjection"]
        predicted = {signature(c) for c in projected["claims"]}
        counts["validModelOutputs"] += int(row["modelOutputValid"])
        counts["expectedClaims"] += len(truth)
        counts["acceptedClaims"] += len(predicted)
        counts["correctAcceptedClaims"] += len(truth & predicted)
        counts["canonicalAbstentions"] += int(row["modelOutputValid"] and any(d["code"] == "no_canonical_targets" for d in projected["abstentions"]))
    for row in raw:
        try:
            value = json.loads(row["rawText"])
            evidence = {f["key"]: f["text"] for f in batch[row["exampleId"]]["evidence"]}
            for item in value.get("claims", []) + value.get("conflicts", []) + value.get("abstentions", []):
                for citation in item.get("citations", []):
                    counts["emittedCitations"] += 1
                    counts["exactEmittedCitations"] += int(isinstance(citation.get("quote"), str) and bool(citation["quote"])
                        and citation["key"] in evidence and citation["quote"] in evidence[citation["key"]])
        except (json.JSONDecodeError, TypeError, KeyError, AttributeError):
            pass
    summary = {"version": "association-baseline-summary/1", "counts": counts,
        "acceptedSourceNativePrecision": counts["correctAcceptedClaims"] / counts["acceptedClaims"] if counts["acceptedClaims"] else None,
        "sourceNativeCoverage": counts["correctAcceptedClaims"] / counts["expectedClaims"],
        "exactCitationFraction": counts["exactEmittedCitations"] / counts["emittedCitations"] if counts["emittedCitations"] else None,
        "conflictAccuracy": None, "conflictReason": "no natural conflict case in this bounded development slice",
        "canonicalAssociationPrecision": None, "canonicalReason": "no target records/crosswalk; no canonical links supported",
        "generationSeconds": [r["generationSeconds"] for r in raw], "gpu": results["runtime"],
        "jobPeakCommittedBytes": guard["observation"]["peakJobMemoryBytes"],
        "sampledPeakProcessRssBytes": guard["observation"]["peakProcessRssBytes"],
        "guardSha256": sha(guard_path), "resultSha256": sha(root / "outputs/baseline/result.json"),
        "rawSha256": sha(root / "outputs/baseline/raw-outputs.json"), "expectedClaimsSha256": sha(expected_path),
        "evaluationOpened": False, "fitPerformed": False, "generalizationQualified": False}
    with (root / "baseline-summary.json").open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(summary, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    summarize(parser.parse_args().root)
