"""Report the fixed adapter attempt and, if accepted, the unchanged development comparison."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage_adapter import BASELINE, EXPECTATIONS_SHA, accepted_fit, accepted_outputs, isolation, require
from geo.usp_learning.association.validation import strict_json
from geo.usp_learning.association.citation_view import checked_freeze, checked_reload_counts, same


def compare(root):
    guard, _ = accepted_outputs(root, "reload")
    freeze = isolation.read(root / "inputs/run-freeze.json")
    require("trainingDiagnostic" not in freeze, "training diagnostic must use its own summarizer")
    plan = checked_freeze(freeze, isolation.read(root / "inputs/assignment.json"))
    checked_reload_counts(isolation.read(root / "inputs/fit-proof.json"),
                          isolation.read(root / "inputs/adapter-manifest.json"), plan,
                          versioned="datasetDeclaration" in freeze)
    stage = isolation.read(root / "stage.json")
    expected_path = Path(stage["sourceExpectations"])
    require(isolation.sha(expected_path) == EXPECTATIONS_SHA, "unchanged development expectations drift")
    expected = {r["exampleId"]: r["expected"] for r in isolation.read(expected_path)["examples"]}
    result = isolation.read(root / "outputs/reload/result.json")
    require(result["adapterTrainingUpdates"] == plan["plannedUpdates"], "reload update count drift")
    if "datasetDeclaration" in freeze or "trainingPlan" in result:
        require(same(result.get("trainingPlan"), plan), "reload training plan drift")
    raw = isolation.read(root / "outputs/reload/raw-outputs.json")
    baseline_raw = {r["exampleId"]: r for r in isolation.read(BASELINE / "outputs/baseline/raw-outputs.json")}
    batch = {r["exampleId"]: r for r in isolation.read(root / "inputs/development.json")["examples"]}
    require(result["adapterApplied"] and result["adapterReload"]["savedTensorsExact"]
            and result["adapterReload"]["tensorCount"] == 96, "adapter reload proof missing")
    require(len(raw) == len(result["results"]) == len(expected) == 2, "comparison cardinality drift")
    for row in raw:
        old = baseline_raw[row["exampleId"]]
        require(row["promptSha256"] == old["promptSha256"] and row["inputTokens"] == old["inputTokens"], "baseline prompt drift")
    signature = lambda c: (c["role"], c["state"], c["literal"], c["unit"])
    counts = {"examples": 2, "families": 1, "validModelOutputs": 0, "expectedClaims": 0,
              "acceptedClaims": 0, "correctAcceptedClaims": 0, "emittedCitations": 0, "exactEmittedCitations": 0,
              "canonicalAbstentions": 0, "validOutputsWithEmptyCanonicalLinks": 0,
              "expectedAbsentClaims": 0, "correctAbsentClaims": 0, "expectedNullClaims": 0, "correctNullClaims": 0}
    for row in result["results"]:
        truth = {signature(c) for c in expected[row["exampleId"]]["claims"]}
        projected = row["acceptedProjection"]
        predicted = {signature(c) for c in projected["claims"]}
        counts["validModelOutputs"] += int(row["modelOutputValid"])
        counts["expectedClaims"] += len(truth)
        counts["acceptedClaims"] += len(predicted)
        counts["correctAcceptedClaims"] += len(truth & predicted)
        counts["canonicalAbstentions"] += int(row["modelOutputValid"] and any(d["code"] == "no_canonical_targets" for d in projected["abstentions"]))
        counts["validOutputsWithEmptyCanonicalLinks"] += int(row["modelOutputValid"] and projected["canonicalLinks"] == [])
        for state in ("absent", "null"):
            subset = {c for c in truth if c[1] == state}
            counts["expected" + state.title() + "Claims"] += len(subset)
            counts["correct" + state.title() + "Claims"] += len(subset & predicted)
    for row in raw:
        try:
            value = strict_json(row["rawText"])
            evidence = {f["key"]: f["text"] for f in batch[row["exampleId"]]["evidence"]}
            for item in value.get("claims", []) + value.get("conflicts", []) + value.get("abstentions", []):
                for citation in item.get("citations", []):
                    counts["emittedCitations"] += 1
                    counts["exactEmittedCitations"] += int(isinstance(citation.get("quote"), str) and bool(citation["quote"])
                        and citation["key"] in evidence and citation["quote"] in evidence[citation["key"]])
        except (ValueError, TypeError, KeyError, AttributeError):
            pass
    precision = counts["correctAcceptedClaims"] / counts["acceptedClaims"] if counts["acceptedClaims"] else None
    coverage = counts["correctAcceptedClaims"] / counts["expectedClaims"]
    citation_fraction = counts["exactEmittedCitations"] / counts["emittedCitations"] if counts["emittedCitations"] else None
    gpu = result["runtime"]
    resources = (gpu["maxCudaAllocatedBytes"] <= 6 * 1024**3 and gpu["maxCudaReservedBytes"] <= 6 * 1024**3
                 and gpu["minimumSampledFreeCudaBytes"] >= 1536 * 1024**2)
    criteria = {"validRawOutputs2of2": counts["validModelOutputs"] == 2,
                "expectedClaims6of6": counts["correctAcceptedClaims"] == counts["expectedClaims"] == 6,
                "acceptedPrecision1": precision == 1, "coverage1": coverage == 1, "exactCitationFraction1": citation_fraction == 1,
                "absentPreserved": counts["correctAbsentClaims"] == counts["expectedAbsentClaims"] > 0,
                "nullPreserved": counts["correctNullClaims"] == counts["expectedNullClaims"] > 0,
                "canonicalAbstention2of2": counts["canonicalAbstentions"] == 2,
                "emptyCanonicalLinks2of2": counts["validOutputsWithEmptyCanonicalLinks"] == 2,
                "resourcesAndCleanup": resources and guard["cleanup"]["passed"]}
    return {"counts": counts, "acceptedSourceNativePrecision": precision, "sourceNativeCoverage": coverage,
            "exactCitationFraction": citation_fraction, "criteria": criteria, "developmentAccepted": all(criteria.values()),
            "baselineCounts": isolation.read(BASELINE / "baseline-summary.json")["counts"],
            "generationSeconds": [r["generationSeconds"] for r in raw], "gpu": gpu,
            "jobPeakCommittedBytes": guard["observation"]["peakJobMemoryBytes"],
            "sampledPeakProcessRssBytes": guard["observation"]["peakProcessRssBytes"],
            "adapterReload": result["adapterReload"], "conflictAccuracy": None,
            "conflictReason": "no natural conflict case in this bounded development slice",
            "canonicalAssociationPrecision": None, "canonicalReason": "no target records/crosswalk"}


def summarize(fit_root, reload_root=None):
    summary = {"version": "association-adapter-summary/1", "fitRoot": str(fit_root),
               "reloadRoot": str(reload_root) if reload_root else None, "evaluationOpened": False,
               "promoted": False, "generalizationQualified": False}
    if (fit_root / "receipts/association_adapter-fit-accepted.json").exists():
        summary["acceptedFitProof"] = accepted_fit(fit_root)
        summary["fit"] = isolation.read(fit_root / "outputs/fit/fit-result.json")
    else:
        summary["fitAccepted"] = False
        summary["guard"] = isolation.read(fit_root / "receipts/association_adapter-fit-guard.json")
        for name in ("failure.json", "token-preflight.json"):
            if (fit_root / "outputs/fit" / name).exists():
                summary[name] = isolation.read(fit_root / "outputs/fit" / name)
    if reload_root:
        summary["comparison"] = compare(reload_root)
    isolation.write((reload_root or fit_root) / "adapter-summary.json", summary)
    print(json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fit_root", type=Path)
    parser.add_argument("--reload-root", type=Path)
    args = parser.parse_args()
    summarize(args.fit_root, args.reload_root)
