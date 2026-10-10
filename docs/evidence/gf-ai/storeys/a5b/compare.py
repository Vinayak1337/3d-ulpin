#!/usr/bin/env python3
"""A5b comparison: A5's storey scoring on the baseline OCR rerun and on the tiled native-resolution OCR.

Development records and the demo Tower 3 sheets only. A5's score.py is imported read-only and its own
output files are never written; the A5 holdout is not opened.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
A5 = HERE.parent / "a5"
sys.path.insert(0, str(A5))

import score  # noqa: E402

JsonDict = dict[str, Any]
TOWER3_RECORD = "haryana-2831-tower3"
TOWER3_SIDES = ("G+41", "G+42")
NOISE_ISSUES = {"orientation_script_detection_unavailable"}
NOTES = [
    "baselineRerun reproduces A5's dev scores on the complete tessdata prefix, so the prefix repair changes no score.",
    "baselineRerun heritage page 1 tile 2 lost its worker once (exit 1, no result) and was re-run in a clean "
    "output; every baseline tile is available.",
    "alternative reads horizontal text only: Tower 3 site plan tile p01-t12 holds the G+42 table rotated 90 "
    "degrees and psm 11 emitted no word there, while the baseline path read it.",
    "alternative tiles were rendered on one thread after a code change; the Bihar sheet's 258 tile PNGs and its "
    "retained lines were byte-identical before and after, so the single run stands.",
]


def load_json(path: Path) -> JsonDict:
    return json.loads(path.read_text(encoding="utf-8"))


def dev_metrics(items_dir: Path) -> JsonDict:
    records = score.load_records("dev")
    truths = [score.truth_for(record) for record in records]
    facts = score.project_facts(records, score.items_by_source(items_dir))
    return score.score_system(truths, facts)


def tower3_items(items_dir: Path) -> list[JsonDict]:
    record = score.load_json(score.TRUTH / "demo" / f"{TOWER3_RECORD}.json")
    by_source = score.items_by_source(items_dir)
    return [item for sha in score.extraction_shas(record) for item in by_source.get(sha, [])]


def tower3_outcome(items_dir: Path) -> JsonDict:
    items = tower3_items(items_dir)
    expressions = [item for item in items if item["field"] == "floorExpression"]
    sides = {}
    for side in TOWER3_SIDES:
        hits = [item for item in expressions if score.squash(str(item["value"])) == score.squash(side)]
        sides[side] = {"found": bool(hits), "cited": any(item["locator"].get("bbox") for item in hits),
                       "citations": [{"source": item["sourceSha256"][:12], "page": item["locator"]["page"],
                                      "bbox": item["locator"]["bbox"], "quote": item["quote"]} for item in hits]}
    return {"sides": sides, "floorExpressionsFound": sorted({str(item["value"]) for item in expressions})}


def a5_tower3() -> JsonDict:
    """A5's recorded Tower 3 outcome, read from its committed result."""
    demo = load_json(A5 / "result.json")["demo"][TOWER3_RECORD]
    return {side: side in demo["storeyValuesFound"] for side in TOWER3_SIDES}


def cited_expressions(items_dir: Path) -> list[JsonDict]:
    """Verified floor-expression items on the development sources, with the quote and locator that cite them."""
    records = score.load_records("dev")
    by_source = score.items_by_source(items_dir)
    shas = sorted({sha for record in records for sha in score.extraction_shas(record)})
    return [{"source": item["sourceSha256"][:12], "value": item["value"], "quote": item["quote"],
             "page": item["locator"]["page"], "bbox": item["locator"]["bbox"]}
            for sha in shas for item in by_source.get(sha, []) if item["field"] == "floorExpression"]


def tile_diagnostics(pages_dir: Path) -> JsonDict:
    """How many OCR tiles of each store ended complete, partial or unavailable, and the issue codes seen."""
    states: dict[str, int] = {}
    issues: dict[str, int] = {}
    lines = 0
    for path in sorted(pages_dir.glob("*/*.pages.json")):
        store = load_json(path)
        for page in store["pages"].values():
            lines += len(page["lines"])
            for tile in page.get("tiles", []):
                states[tile["status"]] = states.get(tile["status"], 0) + 1
                for code in set(tile["issues"]) - NOISE_ISSUES:
                    issues[code] = issues.get(code, 0) + 1
    return {"tilesByStatus": states, "tileIssues": dict(sorted(issues.items())), "retainedLines": lines}


def precision_fell(baseline: float | None, alternative: float | None) -> bool:
    if baseline is None:
        return False
    return alternative is None or alternative < baseline


def decide(baseline: JsonDict, alternative: JsonDict) -> JsonDict:
    """The preregistered rule on floorExpression: precision does not fall and recall rises."""
    base, alt = baseline["floorExpression"], alternative["floorExpression"]
    fell = precision_fell(base["precision"], alt["precision"])
    rises = alt["hits"] > base["hits"] and alt["recallDenominator"] == base["recallDenominator"]
    return {"precisionBaseline": base["precision"], "precisionAlternative": alt["precision"],
            "recallHitsBaseline": base["hits"], "recallHitsAlternative": alt["hits"],
            "recallDenominator": alt["recallDenominator"], "precisionFell": fell, "recallRises": rises,
            "alternativeReplacesBaseline": rises and not fell}


def summarise(metrics: JsonDict) -> JsonDict:
    keep = ("precision", "precisionDenominator", "recall", "recallDenominator", "hits", "correct")
    summary = {field: {key: value[key] for key in keep if key in value} for field, value in metrics.items()}
    summary["floorExpression"]["wrongExtractions"] = metrics["floorExpression"]["wrongExtractions"]
    summary["floorExpression"]["misses"] = metrics["floorExpression"]["misses"]
    return summary


def lower_measures(baseline: JsonDict, alternative: JsonDict) -> list[str]:
    """Secondary dev measures (every field except floorExpression) where the alternative scores lower."""
    lower = []
    for field in ("floorLabels", "unitCount", "basementIndicated"):
        for measure in ("precision", "recall"):
            base, alt = baseline[field].get(measure), alternative[field].get(measure)
            if base is not None and (alt is None or alt < base):
                lower.append(f"{field} {measure} {base} -> {alt}")
    return lower


def lost_sides(baseline: JsonDict, alternative: JsonDict) -> list[str]:
    return [side for side in TOWER3_SIDES if baseline[side]["found"] and not alternative[side]["found"]]


def conclusion(verdict: JsonDict, lower: list[str], lost: list[str]) -> str:
    if not verdict["alternativeReplacesBaseline"]:
        return ("No gain: the tiled native-resolution OCR does not meet the preregistered rule against the "
                f"repaired-prefix baseline (precision fell: {verdict['precisionFell']}; "
                f"recall rises: {verdict['recallRises']}).")
    caveat = ""
    if lower or lost:
        caveat = (f" It scores lower on {len(lower)} secondary dev measures and loses Tower 3 sides {lost}, "
                  "so it earns a place beside the baseline pass, not instead of it.")
    return ("The preregistered rule on floorExpression is met on development records (precision does not fall, "
            f"recall rises on one literal), on development evidence only.{caveat}")


def build_result(args: argparse.Namespace) -> JsonDict:
    committed = load_json(A5 / "result.json")["baseline"]
    systems = {"a5Committed": committed, "baselineRerun": dev_metrics(args.baseline_items),
               "alternative": dev_metrics(args.alt_items)}
    verdict = decide(systems["baselineRerun"], systems["alternative"])
    tower3 = {"baselineRerun": tower3_outcome(args.baseline_items),
              "alternative": tower3_outcome(args.alt_items)}
    lower = lower_measures(systems["baselineRerun"], systems["alternative"])
    lost = lost_sides(tower3["baselineRerun"]["sides"], tower3["alternative"]["sides"])
    return {
        "schemaVersion": "storey-a5b-result/1", "task": "A5b", "plan": "plan.json", "stage": "dev",
        "claimScope": "development and demo Tower 3 only; no holdout claim",
        "dev": {name: summarise(metrics) for name, metrics in systems.items()},
        "tower3": {**tower3, "a5Committed": a5_tower3()},
        "decision": {"rule": "plan.json decisionRule", "againstBaselineRerun": verdict,
                     "againstA5Committed": decide(committed, systems["alternative"]),
                     "secondaryMeasuresLowerThanBaselineRerun": lower, "tower3SidesLost": lost},
        "citedFloorExpressions": {"baselineRerun": cited_expressions(args.baseline_items),
                                  "alternative": cited_expressions(args.alt_items)},
        "diagnostics": {"baselineRerun": tile_diagnostics(args.baseline_pages),
                        "alternative": tile_diagnostics(args.alt_pages)},
        "notes": NOTES,
        "conclusion": conclusion(verdict, lower, lost),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("baseline-items", "alt-items", "baseline-pages", "alt-pages"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=HERE / "result.json")
    args = parser.parse_args()
    result = build_result(args)
    args.output.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps(result["decision"]["againstBaselineRerun"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
