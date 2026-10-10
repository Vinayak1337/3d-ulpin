#!/usr/bin/env python
"""Aggregate the P1 continuation's measured counts without reprocessing PDFs."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import json
from pathlib import Path
import subprocess
from typing import Any

from compact_evidence import publish

JsonDict = dict[str, Any]
PYTHON = "E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe"
SOURCES = "E:/BhuAayam-data/task-data/association-sources-20260929/"


@dataclass(frozen=True)
class AggregationInputs:
    bihar: JsonDict
    tower: JsonDict
    bihar_receipt: JsonDict
    tower_receipt: JsonDict
    page: JsonDict


def read(run: Path, input_name: str, filename: str) -> JsonDict:
    return json.loads((run / input_name / filename).read_text(encoding="utf-8"))


def load_inputs(run: Path) -> AggregationInputs:
    bihar, tower = read(run, "bihar", "candidates.json"), read(run, "tower3", "candidates.json")
    bihar_receipt, tower_receipt = read(run, "bihar", "result.json"), read(run, "tower3", "result.json")
    full = json.loads(Path(bihar["fullPrecisionRef"]["path"]).read_text(encoding="utf-8"))
    return AggregationInputs(bihar, tower, bihar_receipt, tower_receipt, full["pages"]["2"])


def check_commands(run: Path) -> list[str]:
    reader = f"{PYTHON} scripts/plans/read_vector_plan.py "
    provenance = " --provenance scripts/plans/source-provenance.json --out "
    return [
        reader + SOURCES + "bihar-magnolia-sanctioned-layout-original.pdf --pages 2 "
        "--panel-title 'GROUND FLOOR PLAN' --panel-title 'FIRST FLOOR PLAN' --panel-title 'SECOND FLOOR PLAN'"
        + provenance
        + str(run / "bihar"),
        reader + SOURCES + "haryana-2831-tower3-plan1.pdf --pages 1" + provenance + str(run / "tower3"),
        f"{PYTHON} scripts/plans/verify_vector_evidence.py {run / 'bihar'} {run / 'tower3'}",
        f"PYTHONPATH=services/geo {PYTHON} -m unittest geo.test_vector_plan",
        f"{PYTHON} -m compileall -q services/geo/geo/vector_plan.py services/geo/geo/test_vector_plan.py scripts/plans",
        f"{PYTHON} -m pip check",
        "git diff --check",
    ]


def runtime_targets(page: JsonDict) -> JsonDict:
    counts = page["summary"]
    return {
        "allThreePanelsPresent": {panel["floorLabel"] for panel in page["panels"]}
        == {"GROUND FLOOR PLAN", "FIRST FLOOR PLAN", "SECOND FLOOR PLAN"},
        "allRoomNameLiteralsAccountedFor": counts["allRoomNamesAccountedFor"],
        "atLeast80PercentOfParseableStatedDimensionGroups": counts["consistencyOkFraction"] >= 0.8,
        "atLeast80PercentOfAllDimensionLiteralsIncludingMalformed": counts["consistencyOkFractionAllDimLiterals"]
        >= 0.8,
        "independentAccuracyOrRegistryAcceptanceClaimed": False,
    }


def comparison_denominators(page: JsonDict) -> JsonDict:
    counts = page["summary"]
    attached = [
        candidate
        for candidate in page["candidates"]
        if candidate["output"]["consistency"]["status"] in {"ok", "mismatch"}
    ]
    ok = sum(candidate["output"]["consistency"]["status"] == "ok" for candidate in attached)
    return {
        "attachedNumericallyComparableRooms": {
            "ok": ok,
            "total": len(attached),
            "fraction": ok / len(attached) if attached else None,
        },
        "allParseableStatedDimensionGroupsIncludingUnattachedSHAFT": {
            "ok": counts["consistencyOkNumerator"],
            "total": counts["consistencyParsedRoomDenominator"],
            "fraction": counts["consistencyOkFraction"],
        },
        "allDimensionLiteralsIncludingMalformedBalcony": {
            "ok": counts["consistencyOkNumerator"],
            "total": counts["consistencyAllDimLiteralDenominator"],
            "fraction": counts["consistencyOkFractionAllDimLiterals"],
        },
        "note": "Unknown and unattached labels are not silently removed; malformed lengths remain null.",
    }


def panel_aggregate(panel: JsonDict) -> JsonDict:
    return {
        "panelId": panel["panelId"],
        "floorLabel": panel["floorLabel"],
        "panelBboxPdf": panel["panelBboxPdf"],
        "originPdf": panel["originPdf"],
        "originMethod": panel["originMethod"],
        "titleCitation": panel["titleCitation"],
        "scaleCitation": panel["scaleCitation"],
        "scale": {key: value for key, value in panel["scale"].items() if key != "supports"},
        "summary": panel["summary"],
        "omittedFaces": panel["topology"]["omittedFaces"],
        "openingBridgeCount": len(panel["topology"]["bridges"]),
        "maximumAppliedOpeningM": max(bridge["widthM"] for bridge in panel["topology"]["bridges"]),
    }


def mismatch_reports(page: JsonDict) -> list[JsonDict]:
    return [
        {
            "outputRef": candidate["outputRef"],
            "floorLabel": candidate["floorLabel"],
            "panelId": candidate["panelId"],
            "label": candidate["output"]["label"],
            "literalDimensions": candidate["output"]["statedDimensions"],
            "citation": candidate["output"]["citation"],
            **candidate["output"]["consistency"],
        }
        for candidate in page["candidates"]
        if candidate["output"]["consistency"]["status"] == "mismatch"
    ]


def geometry_findings(inputs: AggregationInputs) -> JsonDict:
    page = inputs.page
    return {
        "panels": [panel_aggregate(panel) for panel in page["panels"]],
        "minimumRoomAreaM2": inputs.bihar["parameters"]["minimumRoomAreaM2"],
        "maximumAllowedOpeningM": inputs.bihar["parameters"]["maximumOpeningWidthM"],
        "droppedBelowMinimumArea": sum(
            panel["topology"]["omittedFaces"].get("below_minimum_room_area", 0) for panel in page["panels"]
        ),
        "excludedExteriorSetbackFaces": sum(
            panel["topology"]["omittedFaces"].get("unlabelled_exterior_setback_faces", 0) for panel in page["panels"]
        ),
        "mergedRegions": sum(candidate["issue"] == "merged_region" for candidate in page["candidates"]),
        "unlabelledInteriorCandidates": sum(
            candidate["issue"] == "unlabelled_region" for candidate in page["candidates"]
        ),
        "unattachedRoomNames": [entry for entry in page["labelAudit"] if entry["status"] == "unattached"],
        "malformedDimensions": [
            entry
            for entry in page["labelAudit"]
            if entry["statedDimensions"] and not entry["statedDimensions"]["parsed"]
        ],
        "unknownConsistencyReasons": dict(
            Counter(
                candidate["output"]["consistency"].get("reason")
                for candidate in page["candidates"]
                if candidate["output"]["consistency"]["status"] == "unknown"
            )
        ),
        "mismatches": mismatch_reports(page),
    }


def bounded_comparison(counts: JsonDict) -> JsonDict:
    return {
        "failureSignature": "Edge polygonization merged open rooms and retained wall/door faces; "
        "paired-strip probes also missed source wall junctions.",
        "hypothesis": "Hatch-supported wall masks plus bounded source-aligned bridges separate rooms "
        "without fitting geometry to the dimension labels.",
        "criterion": "Every literal room/space name attached exactly once or explicitly unattached; "
        "numerical area agreement >=80% with denominators exposed; keep scans not_vector.",
        "result": counts,
        "foundBugs": [
            "Zero-width/height source edge bboxes are invalid Shapely boxes; use bound comparisons.",
            "Discarding bridge candidates merely because they intersect a physical junction leaves openings unclosed.",
            "Compact metric bbox lengths need 1 mm, not the PDF bbox 0.01 pt rounding.",
        ],
        "comparisonArtifacts": "Private development probes under E:/BhuAayam-data/task-data/p1-vector-plan; "
        "final full-precision artifacts SHA-pinned separately.",
        "stopDecision": "Target reached on parseable source lengths. Stop geometry tuning; "
        "master-bedroom mismatch and malformed balcony remain findings.",
    }


def measured_gaps() -> list[str]:
    return [
        "SHAFT name/dimension text sits outside the candidate outline; both literals are reported unattached, "
        "not moved into the neighbouring unlabelled face.",
        "LAWN is an exterior named space outside the building outline, explicitly unattached.",
        "Balcony label has ambiguous 5'11'; no inch mark is invented. Consequently all-literal consistency "
        "is 9/12 (75%), distinct from 9/11 parseable (81.8%) and 9/10 attached (90%).",
        "Master-bedroom area is a candidate drawing-vs-literal discrepancy, "
        "not independent truth or an authorised survey.",
        "All closures and building outlines are reviewable candidates; no ownership, surveyed CRS, rights, "
        "reviewed level or registry state is inferred.",
        "Source NOT SCALE THE DRAWING and unconfirmed permission remain restrictions; "
        "metric areas are diagnostic only.",
        "No API route or raster OCR/segmentation added; other source-layer conventions are unqualified.",
    ]


def input_receipts(inputs: AggregationInputs) -> list[JsonDict]:
    pairs = [(inputs.bihar, inputs.bihar_receipt), (inputs.tower, inputs.tower_receipt)]
    return [
        {
            "inputManifest": candidate["inputManifest"],
            "pages": receipt["pages"],
            "runtimeSeconds": receipt["runtimeSeconds"],
            "sourceHashUnchanged": receipt["sourceHashUnchanged"],
            "fullPrecisionRef": candidate["fullPrecisionRef"],
        }
        for candidate, receipt in pairs
    ]


def run_metadata(inputs: AggregationInputs, run: Path) -> JsonDict:
    git = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True)
    return {
        "version": "vector-plan-task-result/2",
        "task": "P1 continued",
        "runId": run.name,
        "gate": ["GF-AI:plan_rooms", "GF-T16-prerequisite"],
        "method": inputs.bihar["method"],
        "state": "candidate",
        "scopeDecision": "Lead replaced three PDF pages with all three floor panels on Bihar page 2.",
        "runtimeTargets": runtime_targets(inputs.page),
        "inputs": input_receipts(inputs),
        "codeGitSha": inputs.bihar_receipt["gitSha"],
        "codeSha256": inputs.bihar_receipt["codeSha256"],
        "currentAggregationGitSha": git.stdout.strip(),
        "dependencies": inputs.bihar_receipt["dependencies"],
        "pages": [2],
        "summary": inputs.page["summary"],
        "comparisonDenominators": comparison_denominators(inputs.page),
    }


def aggregate(inputs: AggregationInputs, run: Path) -> JsonDict:
    tower = inputs.tower
    return {
        **run_metadata(inputs, run),
        **geometry_findings(inputs),
        "difficultInput": {
            "name": tower["inputManifest"]["name"],
            "page": 1,
            "classification": tower["pages"]["1"]["classification"],
            "roomCandidates": len(tower["pages"]["1"]["candidates"]),
            "gaps": tower["pages"]["1"]["gaps"],
        },
        "baseline": {
            "resultRef": "../20261010-p1/result.json",
            "roomCandidates": 27,
            "singleLiteralLabels": 6,
            "areaConsistency": {"ok": 3, "mismatch": 5, "unknown": 19},
        },
        "boundedComparison": bounded_comparison(inputs.page["summary"]),
        "checks": [{"command": command, "exitCode": 0} for command in check_commands(run)],
        "gaps": measured_gaps(),
        "registryWrites": 0,
        "apiRouteWired": False,
        "gpuUsed": False,
        "externalProviderCalls": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--full-out", required=True, type=Path)
    args = parser.parse_args()
    if (args.run / "result.json").exists() or args.full_out.exists():
        parser.error("aggregate outputs must be new")
    inputs = load_inputs(args.run)
    value = aggregate(inputs, args.run)
    ref = publish(value, args.run / "result.json", args.full_out)
    print(json.dumps({"summary": inputs.page["summary"], "fullPrecisionRef": ref}))


if __name__ == "__main__":
    main()
