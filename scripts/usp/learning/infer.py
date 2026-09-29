#!/usr/bin/env python3
"""Re-run immutable candidate or base inference against checked source profiles."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from geo.usp_learning.corpus import load_examples, sha256_file
from geo.usp_learning.model import BASE_REVISION, load_adapter, load_base, metrics, score_matrix


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--originals-dir", type=Path, required=True)
    parser.add_argument("--base-dir", type=Path, required=True)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument("--model", choices=("base", "tuned"), default="tuned")
    args = parser.parse_args()
    torch.set_num_threads(2)
    report = json.loads((args.candidate_dir / "run.json").read_text(encoding="utf-8"))
    if report["corpus"]["fileSha256"] != sha256_file(args.corpus) or report["base"]["revision"] != BASE_REVISION:
        raise ValueError("run corpus or base revision mismatch")
    corpus, examples = load_examples(args.corpus, args.originals_dir)
    evaluated_split = "holdout" if corpus["schemaVersion"].endswith("-v2") else "evaluation"
    if report.get("evaluationStatus", "observed_once") != "observed_once":
        raise ValueError("candidate was not qualified to open evaluation; preserve untouched families")
    holdout = [item for item in examples if item["split"] == evaluated_split]
    tokenizer, model = load_base(args.base_dir)
    if args.model == "tuned":
        load_adapter(model, args.candidate_dir / report["candidate"]["file"], report["candidate"]["sha256"])
    if corpus["schemaVersion"].endswith("-v2"):
        threshold = report["comparison"]["tunedTrain" if args.model == "tuned" else "baseTrain"]["trainCalibratedThreshold"]
    else:
        key = "savedReloadedTuned" if args.model == "tuned" else "base"
        threshold = report["comparison"][key]["calibration"]["decisionThreshold"]
    if threshold is None:
        result = metrics(holdout, None, None, [None] * len(holdout))
        result["calibrationStatus"] = "no_useful_operating_point"
    else:
        with torch.no_grad():
            scores = score_matrix(tokenizer, model, holdout, corpus["targets"])
        result = metrics(holdout, scores, threshold)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
