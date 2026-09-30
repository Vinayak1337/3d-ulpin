#!/usr/bin/env python3
"""AI-06E: stdlib-only arithmetic on pinned development outputs; never run models.

No corpus/original/model files, threshold search, fitting or network access.
The only cutoffs replayed are the two values already recorded by the V7 run.
"""

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import sys


PINS = {
    "v8-lora-01/freeze.json": "1075a64cc50da8c84cd09818d6aba9822aa2afe7a34846b1a45d898763799005",
    "v8-lora-01/run/scores.json": "db8af9d3e922a212cc2015c2b812091c86fa8a0dd600a9f05236aa50e8943e74",
    "v8-lora-01/run/result.json": "dfb3f0a7f586e6949eb3d6a571e487103f316076d988530c41f51e987a140564",
    "v7-reranker-01/freeze.json": "d76f3c651269dfccd5c607038d603b698f9bbe7e62a75c0cf873c4378a467eb9",
    "v7-reranker-01/run/scores.json": "4ba474ab5574b3956a414b8e0e961c975496bed8f6b2d5627ae65e6a5490039d",
    "v7-reranker-01/run/run.json": "e0b40f2ad75206c64ce5c09653e79c4ef79f14d7340a8ca8e9bfc5d34226f541",
}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def summarize(root):
    inputs_read = {}

    def read(name, digest):
        content = (root / name).read_bytes()
        actual = hashlib.sha256(content).hexdigest()
        require(actual == digest, f"changed artifact: {name}")
        inputs_read[name] = actual
        return json.loads(content)

    data = {name: read(name, digest) for name, digest in PINS.items()}
    t_freeze = data["v8-lora-01/freeze.json"]
    b_freeze = data["v7-reranker-01/freeze.json"]
    t_inputs = read("v8-lora-01/selected-inputs.json", t_freeze["selectedInputsSha256"])
    b_inputs = read("v7-reranker-01/selected-inputs.json", b_freeze["selectedInputsSha256"])
    t_result = data["v8-lora-01/run/result.json"]
    b_result = data["v7-reranker-01/run/run.json"]
    targets = [target["id"] for target in t_inputs["targets"]]
    require(t_inputs["targets"] == b_inputs["targets"], "targets differ")
    require(t_result["threshold"] is None and not t_result["developmentPassed"], "unexpected original decision")
    cutoffs = {"historicalFixed": b_result["selection"]["fixedDiagnosticThreshold"],
               "historicalBaseSelected": b_result["selection"]["calibratedGlobalThreshold"]}
    require(cutoffs == {"historicalFixed": 0.5, "historicalBaseSelected": 0.9736446738243103}, "historical cutoffs changed")

    def rows_for(prefix, inputs, sections):
        matrix = data[prefix + "/run/scores.json"]
        require(set(sections) == {"train", "calibration"}, "closed split in saved decisions")
        require(matrix["targets"] == targets, "matrix targets differ")
        labels = {(row["source"], row["field"]): row for part in sections.values() for row in part["decisions"]}
        rows = {}
        require(len(inputs["fields"]) == len(matrix["fields"]) == len(matrix["scores"]) == len(labels), "row counts differ")
        for i, (field, identity, scores) in enumerate(zip(inputs["fields"], matrix["fields"], matrix["scores"])):
            require(field["split"] in ("train", "calibration"), "closed input split")
            key = (field["source"], field["path"])
            require(key not in rows and identity == {k: field[k] for k in ("source", "path", "split")}, "row identity mismatch")
            label = labels[key]
            wire = label["observedWire"]["nonNullTypes"]
            declared = re.search(r"publisher declared type ([^;]+); observed wire types", field["text"]).group(1)
            allowed = [0, 1] if "string" in wire or (not wire and declared == "text") else (
                [2] if field["path"] == "geometry" and any(t in wire for t in ("geojson:Polygon", "geojson:MultiPolygon")) else [])
            require(len(scores) == 3 and all(math.isfinite(s) and 0 <= s <= 1 for s in scores), "invalid scores")
            best = max(allowed, key=scores.__getitem__) if allowed else None
            rows[key] = {**field, "expected": label["expected"], "scores": scores,
                         "allowed": allowed, "top": targets[best] if best is not None else None,
                         "topScore": scores[best] if best is not None else None,
                         "prompts": inputs["prompts"][i * 3:i * 3 + 3]}
        return rows

    tuned = rows_for("v8-lora-01", t_inputs, t_result["comparison"])
    base = rows_for("v7-reranker-01", b_inputs, b_result["comparison"]["qwenCalibrated"])
    require(len(base) == 65 and len(tuned) == 69 and set(base) <= set(tuned), "unexpected comparison denominator")
    for key, old in base.items():
        new = tuned[key]
        require(all(new[k] == old[k] for k in ("text", "family", "split", "expected", "allowed", "prompts")), "noncomparable field")

    def stats(rows, cutoff):
        rows = list(rows)
        positives = [r for r in rows if r["expected"] is not None]
        accepted = [r for r in rows if r["topScore"] is not None and r["topScore"] >= cutoff]
        return {"fields": len(rows), "positives": len(positives),
                "correctTopPositive": sum(r["top"] == r["expected"] for r in positives),
                "acceptedPositive": sum(r["top"] == r["expected"] for r in accepted),
                "incorrectAccepts": sum(r["top"] != r["expected"] for r in accepted),
                "acceptedNegative": sum(r["expected"] is None for r in accepted)}

    # Replay only an existing fixed diagnostic and the already selected BASE cutoff.
    # This never searches cutoffs or changes the null tuned operating point.
    aggregates = {}
    for name, population in (("base65", base), ("tunedMatched65", {k: tuned[k] for k in base}), ("tunedAll69", tuned)):
        aggregates[name] = {}
        for policy, cutoff in cutoffs.items():
            sections = {}
            for split in ("train", "calibration"):
                subset = [r for r in population.values() if r["split"] == split]
                sections[split] = {"total": stats(subset, cutoff),
                    "byFamily": {family: stats([r for r in subset if r["family"] == family], cutoff)
                                 for family in sorted({r["family"] for r in subset})},
                    "byTarget": {target: stats([r for r in subset if r["expected"] == target], cutoff) for target in targets}}
            aggregates[name][policy] = sections
    for split in ("train", "calibration"):
        for policy, saved_name in (("historicalFixed", "qwenFixedDiagnostic"), ("historicalBaseSelected", "qwenCalibrated")):
            observed = aggregates["base65"][policy][split]["total"]
            saved = b_result["comparison"][saved_name][split]
            require(observed["acceptedPositive"] == saved["correctPositive"] and observed["incorrectAccepts"] == saved["incorrectMappings"],
                    "wire/decision replay differs from saved baseline")
    matrix = data["v8-lora-01/run/scores.json"]
    residual = max(abs(score - 1 / (1 + math.exp(-margin)))
                   for scores, margins in zip(matrix["scores"], matrix["margins"])
                   for score, margin in zip(scores, margins))
    require(residual < 1e-7, "saved margin/probability mismatch")

    def separation(population):
        out = {}
        for split in ("train", "calibration"):
            out[split] = {}
            for i, target in enumerate(targets):
                eligible = [r for r in population.values() if r["split"] == split and i in r["allowed"]]
                positive = [r for r in eligible if r["expected"] == target]
                negative = [r for r in eligible if r["expected"] != target]
                out[split][target] = {"positiveCount": len(positive), "negativeCandidateCount": len(negative),
                    "positiveMin": min(r["scores"][i] for r in positive), "positiveMax": max(r["scores"][i] for r in positive),
                    "negativeMax": max(r["scores"][i] for r in negative),
                    "negativeMaxField": [[r["source"], r["path"]] for r in negative if r["scores"][i] == max(n["scores"][i] for n in negative)]}
        return out

    objective = defaultdict(lambda: {"fields": 0, "positives": 0, "baseMass": 0.0, "weightedPositiveMass": 0.0,
                                     "negativeMass": 0.0, "eligibleGeometryPositiveMass": 0.0, "eligibleGeometryNegativeMass": 0.0})
    train = [r for r in tuned.values() if r["split"] == "train"]
    for row in train:
        objective[row["family"]]["fields"] += 1
        objective[row["family"]]["positives"] += int(row["expected"] is not None)
    for pair in t_freeze["trainingPlan"]["pairs"]:
        row = train[pair["fieldIndex"]]
        require(pair["label"] == int(row["expected"] == targets[pair["targetIndex"]]), "saved objective labels mismatch")
        weight = pair["objectiveWeight"]
        o = objective[row["family"]]
        o["baseMass"] += weight
        o["weightedPositiveMass" if pair["label"] else "negativeMass"] += weight * (8 if pair["label"] else 1)
        if pair["targetIndex"] == 2 and 2 in row["allowed"]:
            o["eligibleGeometryPositiveMass" if pair["label"] else "eligibleGeometryNegativeMass"] += weight * (8 if pair["label"] else 1)
    for o in objective.values():
        require(math.isclose(o["baseMass"], 0.1, abs_tol=1e-12), "family normalization differs")

    paired = [{k: row[k] for k in ("source", "family", "split", "path", "expected", "allowed", "scores", "top", "topScore")}
              | {"baseScores": base[key]["scores"] if key in base else None}
              for key, row in tuned.items()]
    return {"scope": "saved train/calibration arithmetic only; no fitted thresholds, calibrator, inference or promotion",
            "inputSha256": inputs_read, "historicalCutoffsReplayed": cutoffs,
            "tunedSelectedThreshold": None, "matchedFields": 65, "newFieldsWithoutBaseline": 4,
            "maximumSavedSigmoidResidual": residual,
            "aggregates": aggregates, "separation": {"base": separation(base), "tuned": separation(tuned)},
            "objectiveMass": dict(objective), "pairedRows": paired}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = summarize(args.root)
    require(not any(name in sys.modules for name in ("torch", "transformers", "peft", "geo")), "unexpected model module import")
    result["scriptSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    with args.output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")
    print(json.dumps({"output": str(args.output), "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
                      "matchedFields": 65, "inputArtifacts": len(result["inputSha256"]), "modelModulesImported": False}))
