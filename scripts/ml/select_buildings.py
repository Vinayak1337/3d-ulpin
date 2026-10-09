"""Select the completed run on DEV only using the previously recorded three-threshold rule."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from typing import Any

from building_io import EVIDENCE, REPO, RUNS, configure_offline, read_json, sha, write_json

THRESHOLDS = (0.3, 0.5, 0.7)


def f1(metrics: dict[str, Any]) -> float:
    return 2 * metrics["tp"] / (2 * metrics["tp"] + metrics["fp"] + metrics["fn"])


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--selection-id", required=True)
    parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu")
    parser.add_argument("--final", action="store_true", help="Require finished training before fixing candidate")
    parser.add_argument("--compare-selection", type=Path, help="Retain an earlier DEV-selected fallback")
    args = parser.parse_args()
    for value in (args.run_id, args.selection_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            parser.error("Simple new ids required")
    return args


def selection_plan(args: argparse.Namespace, entries: list[dict[str, Any]]) -> dict[str, Any]:
    baseline = read_json(EVIDENCE / "b1-installed-dev-20261010/result.json")["metrics"]
    return {
        "schema": "building-dev-selection/1",
        "status": "started",
        "run_id": args.run_id,
        "thresholds": list(THRESHOLDS),
        "completed_epochs": [entry["epoch"] for entry in entries],
        "selection_rule": "Meet P>=.75 and R>=.70 if possible; otherwise max polygon F1, precision tie-break",
        "checkpoint_rule": "Compare all completed epochs at the same three previously recorded DEV thresholds",
        "baseline_dev_precision": baseline["per_building"]["precision"],
        "baseline_dev_recall": baseline["per_building"]["recall"],
        "baseline_dev_f1": f1(baseline["per_building"]),
        "baseline_empty_fp": baseline["false_buildings_on_empty"],
        "final_candidate_fixed": args.final,
        "holdout_calls": 0,
        "git_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip(),
    }


def cached_evaluation(checkpoint: Path, threshold: float) -> Path | None:
    digest = sha(checkpoint / "model.safetensors")
    for path in sorted(EVIDENCE.glob("*/result.json")):
        record = read_json(path)
        if record.get("schema") != "building-evaluation/1" or record.get("split") != "dev":
            continue
        if record["model"]["sha256"] == digest and record["profile"]["object_threshold"] == threshold:
            return path
    return None


def evaluate_epoch(args: argparse.Namespace, epoch: dict[str, Any], threshold: float) -> Path:
    checkpoint = Path(epoch["checkpoint"])
    cached = cached_evaluation(checkpoint, threshold)
    if cached is not None:
        return cached
    run_id = f"{args.selection_id}-e{epoch['epoch']:03d}-t{round(threshold * 100):03d}"
    command = [
        sys.executable,
        "-B",
        "-u",
        str(REPO / "scripts/ml/eval_buildings.py"),
        "--model",
        str(checkpoint),
        "--split",
        "dev",
        "--provider",
        args.provider,
        "--score-threshold",
        str(threshold),
        "--run-id",
        run_id,
    ]
    with (RUNS / args.run_id / f"{run_id}.log").open("x") as log:
        subprocess.run(command, cwd=REPO, stdout=log, stderr=subprocess.STDOUT, check=True)
    return EVIDENCE / run_id / "result.json"


def evaluation_summary(path: Path, epoch: dict[str, Any], threshold: float) -> dict[str, Any]:
    record = read_json(path)
    checkpoint = Path(epoch["checkpoint"])
    digest = sha(checkpoint / "model.safetensors")
    if record["split"] != "dev" or record["model"]["sha256"] != digest:
        raise ValueError("DEV receipt/checkpoint binding drift")
    if record["coverage"]["completed_chips"] != 1434:
        raise ValueError("DEV coverage incomplete")
    metrics = record["metrics"]["per_building"]
    return {
        "epoch": epoch["epoch"],
        "checkpoint": str(checkpoint),
        "model_sha256": digest,
        "threshold": threshold,
        "run_id": record["run_id"],
        "result_sha256": sha(path),
        "precision": metrics["precision"],
        "recall": metrics["recall"],
        "f1": f1(metrics),
        "empty_fp": record["metrics"]["false_buildings_on_empty"],
        "gate_thresholds_met": metrics["precision"] >= 0.75 and metrics["recall"] >= 0.70,
    }


def complete_selection(plan: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    chosen = max(rows, key=lambda row: (row["gate_thresholds_met"], row["f1"], row["precision"]))
    threshold_percent = round(chosen["threshold"] * 100)
    profile = f"rfdetr-rgb432-tile512-stride384-threshold{threshold_percent:03d}-mask000-v2"
    return {
        **plan,
        "status": "completed",
        "threshold_results": rows,
        "chosen": chosen,
        "model_sha256": chosen["model_sha256"],
        "object_threshold": chosen["threshold"],
        "beats_baseline_dev_f1": chosen["f1"] > plan["baseline_dev_f1"],
        "precision_delta": chosen["precision"] - plan["baseline_dev_precision"],
        "recall_delta": chosen["recall"] - plan["baseline_dev_recall"],
        "empty_fp_delta": chosen["empty_fp"]["buildings"] - plan["baseline_empty_fp"]["buildings"],
        "profile_version": profile,
        "note": "Selection uses DEV only; any transfer test needs its own preregistration. Karnataka HOLDOUT is closed.",
    }


def main() -> None:
    configure_offline()
    args = parse_arguments()
    run = RUNS / args.run_id
    if args.final:
        result_path = run / "result.json"
        if not result_path.is_file() or read_json(result_path).get("status") != "passed":
            raise ValueError("Final selection requires a successfully finished training segment")
    entries = [json.loads(line) for line in (run / "dev-selection.jsonl").read_text().splitlines()]
    if not entries:
        raise ValueError("No completed epoch DEV receipt")
    output = EVIDENCE / args.selection_id
    output.mkdir(exist_ok=False)
    plan = selection_plan(args, entries)
    write_json(output / "plan.json", plan)
    rows = []
    if args.compare_selection:
        comparison = read_json(args.compare_selection)
        if comparison["status"] != "completed" or not comparison["final_candidate_fixed"]:
            raise ValueError("Comparison must be a completed fixed DEV selection")
        rows.extend(comparison["threshold_results"])
        plan["comparison_selection"] = str(args.compare_selection)
        plan["comparison_sha256"] = sha(args.compare_selection)
    for epoch in entries:
        for threshold in THRESHOLDS:
            path = evaluate_epoch(args, epoch, threshold)
            rows.append(evaluation_summary(path, epoch, threshold))
    result = complete_selection(plan, rows)
    write_json(output / "result.json", result)
    print(json.dumps(result["chosen"]), flush=True)


if __name__ == "__main__":
    main()
