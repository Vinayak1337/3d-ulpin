"""B7: DEV score diagnosis per roof size and a DEV-chosen operating point for the epoch-4 building model.

Stage `cache` runs the one preregistered GPU pass over DEV through the unchanged production painting path and
stores each chip's raw query logits and masks outside Git. Stage `analyse` replays the production painting,
component and matching code on that cache at every grid threshold, with no further forward pass.
Only the frozen DEV split is ever opened; the replay needs no model, GPU, holdout or transfer data.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from multiprocessing import Pool
from pathlib import Path
import re
import subprocess
import time
from typing import Any

from building_io import EVIDENCE, REPO, RUNS, configure_offline, read_json, sha, write_json

PLAN = EVIDENCE / "b7/plan.json"
RESULT = EVIDENCE / "b7/result.json"
CACHE_ROOT = RUNS / "b7-dev-scores"
DEV_DIR = Path("E:/BhuAayam-data/datasets/ramp/coco/dev")
GRID = tuple(round(0.05 * step, 2) for step in range(1, 20))
SCORE_FLOOR = 0.01
QUERIES = 200
PRECISION_FLOOR = 0.80
EMPTY_FACTOR = 2
REFERENCE = 0.5
IOU_THRESHOLD = 0.5
SCORE_STEP = 0.05
IOU_BINS = ((0.0, 0.1), (0.1, 0.3), (0.3, 0.5))
SMALL_BINS = ("[0,16)", "[16,64)", "[64,128)")
WORKERS = 12

_PRODUCTION: Any = None


def committed_plan_commit(plan: Path = PLAN) -> str:
    """The plan must be committed unchanged before any inference."""
    relative = plan.relative_to(REPO).as_posix()
    shown = subprocess.check_output(["git", "-C", str(REPO), "show", "HEAD:" + relative])
    if shown != plan.read_bytes().replace(b"\r\n", b"\n"):
        raise ValueError(f"{relative} differs from the committed plan; preregister before running")
    log = subprocess.check_output(["git", "-C", str(REPO), "log", "-1", "--format=%H", "--", relative])
    return log.decode().strip()


def dev_inputs() -> tuple[dict, dict, dict[int, list[dict]]]:
    """Frozen DEV COCO and the B3 receipt, checked with B5's identities."""
    from diagnose_building_recall import inputs

    coco, _, receipt = inputs()
    plan = read_json(PLAN)
    if plan["model"]["sha256"] != receipt["model"]["sha256"] or receipt["split"] != "dev":
        raise ValueError("Plan model or split differs from the B3 DEV receipt")
    by_image: dict[int, list[dict]] = defaultdict(list)
    for annotation in coco["annotations"]:
        by_image[annotation["image_id"]].append(annotation)
    return coco, receipt, by_image


class RecordingNative:
    """Wraps the model so the production path runs unchanged while its raw outputs are kept."""

    def __init__(self, native: Any) -> None:
        self.native = native
        self.input_resolution = native.input_resolution
        self.outputs: list[tuple[Any, Any]] = []

    def run(self, outputs: Any, inputs: dict[str, Any]) -> tuple[Any, Any]:
        logits, masks = self.native.run(outputs, inputs)
        self.outputs.append((logits, masks))
        return logits, masks


def write_chip_cache(path: Path, logits: Any, masks: Any) -> int:
    """Keep every query whose sigmoid reaches the floor; lower queries can never pass a grid threshold."""
    import numpy as np

    confidence = 1 / (1 + np.exp(-np.clip(logits[0, :, 0], -80, 80)))
    kept = np.flatnonzero(confidence >= SCORE_FLOOR)
    np.savez(path, logits=logits[0, :, 0], kept=kept, masks=masks[0, kept])
    return int(kept.size)


def cache_chip(prod: Any, native: RecordingNative, chip: dict, directory: Path, root: Path) -> dict[str, Any]:
    import hashlib
    import numpy as np
    from PIL import Image
    from eval_buildings import infer

    with Image.open(root / chip["file_name"]) as source:
        raster = source.convert("RGB")
    if hashlib.sha256(np.asarray(raster).tobytes()).hexdigest() != chip["rgb_pixel_sha256"]:
        raise ValueError("Derivative source pixels changed")
    native.outputs.clear()
    predictions, _, _, tiles = infer(prod, native, raster, chip["source_image_sha256"])
    if tiles != 1 or len(native.outputs) != 1:
        raise ValueError(f"Chip {chip['source_id']} is not a single production tile; this cache assumes one")
    logits, masks = native.outputs[0]
    kept = write_chip_cache(directory / f"{chip['source_id']}.npz", logits, masks)
    return {"chip_id": chip["source_id"], "predicted_at_050": len(predictions), "kept_queries": kept}


def verify_weights(checkpoint: Path, receipt: dict) -> None:
    config = checkpoint.parent / "config.json"
    if sha(checkpoint) != receipt["model"]["sha256"] or sha(config) != receipt["model"]["config_sha256"]:
        raise ValueError("Selected weights or config drift")


def cache_scores(run_id: str) -> None:
    """The single preregistered GPU pass."""
    from eval_buildings import production, session

    plan_commit = committed_plan_commit()
    coco, receipt, _ = dev_inputs()
    checkpoint = Path(receipt["model"]["path"])
    verify_weights(checkpoint, receipt)
    directory = CACHE_ROOT / run_id
    (directory / "chips").mkdir(parents=True, exist_ok=False)
    prod = production()
    native = RecordingNative(session(checkpoint, "cuda")[0])
    started = time.perf_counter()
    rows = [cache_chip(prod, native, chip, directory / "chips", DEV_DIR) for chip in coco["images"]]
    manifest = {
        "plan_commit": plan_commit,
        "model_sha256": receipt["model"]["sha256"],
        "input_resolution": native.input_resolution,
        "peak_cuda_reserved_bytes": peak_cuda_reserved(),
        "seconds": time.perf_counter() - started,
        "rows": rows,
    }
    write_json(directory / "manifest.json", manifest)
    print(json.dumps({key: value for key, value in manifest.items() if key != "rows"}), flush=True)


def peak_cuda_reserved() -> int:
    import torch

    return torch.cuda.max_memory_reserved()


class ReplayNative:
    """Serves one chip's cached model outputs; the production painting sees what the GPU produced."""

    def __init__(self, cache: Path, input_resolution: int) -> None:
        import numpy as np

        data = np.load(cache)
        kept = data["kept"]
        self.logits = data["logits"].reshape(1, QUERIES, 1)
        self.masks = np.zeros((1, QUERIES, *data["masks"].shape[1:]), dtype=np.float32)
        self.masks[0, kept] = data["masks"]
        self.input_resolution = input_resolution

    def run(self, _outputs: Any, _inputs: dict[str, Any]) -> tuple[Any, Any]:
        return self.logits, self.masks


def replay_predictions(
    prod: Any, replay: ReplayNative, size: tuple[int, int], fingerprint: str, threshold: float
) -> list:
    from PIL import Image
    from eval_buildings import infer, threshold_session

    blank = Image.new("RGB", size)
    return infer(prod, threshold_session(replay, threshold), blank, fingerprint)[0]


def raw_instances(prod: Any, replay: ReplayNative, size: tuple[int, int]) -> tuple[list[float], Any]:
    """Every cached query as an unpainted full-resolution mask with its own score."""
    import numpy as np

    confidence = 1 / (1 + np.exp(-np.clip(replay.logits[0, :, 0], -80, 80)))
    queries = [query for query in range(QUERIES) if confidence[query] >= SCORE_FLOOR]
    width, height = size
    stack = np.stack([prod._resize_logits(replay.masks[0, query], height, width) > 0 for query in queries])
    return [float(confidence[query]) for query in queries], stack


def raw_match(truth: Any, scores: list[float], stack: Any) -> dict[str, Any]:
    """Best score among raw instances overlapping the truth at IoU >= 0.5, and the best IoU seen."""
    import numpy as np

    intersection = np.count_nonzero(stack & truth, axis=(1, 2))
    union = np.count_nonzero(stack | truth, axis=(1, 2))
    ious = np.divide(intersection, union, out=np.zeros(len(scores)), where=union > 0)
    matching = [score for score, iou in zip(scores, ious) if iou >= IOU_THRESHOLD]
    return {"best_score": max(matching) if matching else None, "best_iou": float(ious.max()) if len(ious) else 0.0}


def production_instance() -> Any:
    global _PRODUCTION
    if _PRODUCTION is None:
        configure_offline()
        from eval_buildings import production

        _PRODUCTION = production()
    return _PRODUCTION


def analyse_chip(job: dict[str, Any]) -> dict[str, Any]:
    """Per-threshold matches for one chip, plus raw-instance evidence for truths missed at 0.5."""
    from diagnose_building_recall import PIXEL_BINS, interval, masks_for
    from eval_buildings import matched_pairs

    chip, annotations = job["chip"], job["annotations"]
    prod = production_instance()
    size = (chip["width"], chip["height"])
    replay = ReplayNative(Path(job["cache"]), job["input_resolution"])
    truth = masks_for(annotations)
    per_threshold = {}
    for threshold in GRID:
        predictions = replay_predictions(prod, replay, size, chip["source_image_sha256"], threshold)
        pairs = matched_pairs(truth, predictions)
        per_threshold[str(threshold)] = {"predicted": len(predictions), "matched": sorted(pair[0] for pair in pairs)}
    reference = set(per_threshold[str(REFERENCE)]["matched"])
    missed = [index for index in range(len(truth)) if index not in reference]
    raw = {}
    if missed:
        scores, stack = raw_instances(prod, replay, size)
        raw = {str(index): raw_match(truth[index], scores, stack) for index in missed}
    return {
        "chip_id": chip["source_id"],
        "empty": not annotations,
        "bins": [interval(annotation["area"], PIXEL_BINS) for annotation in annotations],
        "per_threshold": per_threshold,
        "raw": raw,
    }


def safe_ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def threshold_row(records: list[dict], threshold: float) -> dict[str, Any]:
    key = str(threshold)
    tp = sum(len(record["per_threshold"][key]["matched"]) for record in records)
    predicted = sum(record["per_threshold"][key]["predicted"] for record in records)
    truth = sum(len(record["bins"]) for record in records)
    precision, recall = safe_ratio(tp, predicted), safe_ratio(tp, truth)
    f1 = safe_ratio(2 * tp, predicted + truth)
    empty_false = sum(record["per_threshold"][key]["predicted"] for record in records if record["empty"])
    return {
        "threshold": threshold,
        "tp": tp,
        "predicted": predicted,
        "truth": truth,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "empty_chip_false_buildings": empty_false,
        "recall_by_size_bin": recall_by_bin(records, key),
    }


def recall_by_bin(records: list[dict], key: str) -> dict[str, float | None]:
    truth: dict[str, int] = defaultdict(int)
    matched: dict[str, int] = defaultdict(int)
    for record in records:
        found = set(record["per_threshold"][key]["matched"])
        for index, label in enumerate(record["bins"]):
            truth[label] += 1
            matched[label] += index in found
    return {label: safe_ratio(matched[label], truth[label]) for label in sorted(truth)}


def select_operating_point(curve: list[dict], reference_empty: int) -> dict[str, Any] | None:
    """Preregistered rule: precision >= 0.80, empty-chip false buildings <= 2x the 0.5 count, max recall, ties high."""
    eligible = [
        row
        for row in curve
        if row["precision"] is not None
        and row["precision"] >= PRECISION_FLOOR
        and row["empty_chip_false_buildings"] <= EMPTY_FACTOR * reference_empty
    ]
    if not eligible:
        return None
    return max(eligible, key=lambda row: (row["recall"], row["threshold"]))


def score_label(score: float | None) -> str:
    """Histogram label for the highest score among raw instances matching a missed truth."""
    if score is None:
        return "no_instance_iou_ge_0.5"
    if score >= REFERENCE:
        return "at_or_above_0.50"
    if score < SCORE_STEP:
        return "below_0.05"
    lower = math.floor(score / SCORE_STEP + 1e-9) * SCORE_STEP
    return f"[{lower:.2f},{lower + SCORE_STEP:.2f})"


def iou_label(iou: float) -> str:
    for lower, upper in IOU_BINS:
        if lower <= iou < upper:
            return f"[{lower},{upper})"
    return "[0.3,0.5)"


def missed_rows(records: list[dict]) -> list[dict[str, Any]]:
    """One row per truth missed at 0.5: its size bin, lower-threshold recovery and raw-instance evidence."""
    rows = []
    for record in records:
        raw = record["raw"]
        for index_text, evidence in raw.items():
            index = int(index_text)
            lower = [
                threshold
                for threshold in GRID
                if threshold < REFERENCE and index in record["per_threshold"][str(threshold)]["matched"]
            ]
            rows.append({"bin": record["bins"][index], "recovered_below": max(lower) if lower else None, **evidence})
    return rows


def bin_table(records: list[dict]) -> dict[str, dict[str, Any]]:
    truth: dict[str, int] = defaultdict(int)
    for record in records:
        for label in record["bins"]:
            truth[label] += 1
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in missed_rows(records):
        grouped[row["bin"]].append(row)
    return {label: bin_entry(truth[label], grouped[label]) for label in sorted(truth)}


def bin_entry(truth: int, missed: list[dict]) -> dict[str, Any]:
    histogram: dict[str, int] = defaultdict(int)
    iou_histogram: dict[str, int] = defaultdict(int)
    for row in missed:
        histogram[score_label(row["best_score"])] += 1
        if row["best_score"] is None:
            iou_histogram[iou_label(row["best_iou"])] += 1
    below = sum(1 for row in missed if row["best_score"] is not None and row["best_score"] < REFERENCE)
    recovered = sum(1 for row in missed if row["recovered_below"] is not None)
    return {
        "truth": truth,
        "missed_at_050": len(missed),
        "missed_with_raw_instance_below_050": below,
        "share_missed_with_raw_instance_below_050": safe_ratio(below, len(missed)),
        "missed_matched_by_pipeline_at_lower_threshold": recovered,
        "share_missed_matched_by_pipeline_at_lower_threshold": safe_ratio(recovered, len(missed)),
        "best_raw_match_score_histogram": dict(sorted(histogram.items())),
        "best_raw_iou_histogram_when_no_match": dict(sorted(iou_histogram.items())),
    }


def parity(curve: list[dict], receipt: dict) -> dict[str, Any]:
    """The replay at 0.5 against the frozen B3 DEV counts."""
    reference = next(row for row in curve if row["threshold"] == REFERENCE)
    expected = receipt["metrics"]["per_building"]
    empty = receipt["metrics"]["false_buildings_on_empty"]["buildings"]
    return {
        "replay_tp": reference["tp"],
        "b3_tp": expected["tp"],
        "replay_predicted": reference["predicted"],
        "b3_predicted": expected["precision_denominator_predicted_buildings"],
        "replay_empty_chip_false_buildings": reference["empty_chip_false_buildings"],
        "b3_empty_chip_false_buildings": empty,
        "matches": reference["tp"] == expected["tp"]
        and reference["predicted"] == expected["precision_denominator_predicted_buildings"]
        and reference["empty_chip_false_buildings"] == empty,
    }


def share_below_reference(bins: dict[str, dict], labels: tuple[str, ...]) -> float | None:
    chosen = [bins[label] for label in labels if label in bins]
    below = sum(entry["missed_with_raw_instance_below_050"] for entry in chosen)
    return safe_ratio(below, sum(entry["missed_at_050"] for entry in chosen))


def conclusion(bins: dict[str, dict], chosen: dict | None, reference: dict) -> str:
    everything = tuple(bins)
    overall = share_below_reference(bins, everything)
    small = share_below_reference(bins, SMALL_BINS)
    evidence = (
        f"{overall:.0%} of the missed truths have a raw instance at IoU >= 0.5 scoring under 0.5 "
        f"({small:.0%} of those under 128 px)."
    )
    if chosen is None or chosen["threshold"] == REFERENCE:
        return f"No operating point beats 0.5 under the preregistered rule. {evidence}"
    gain = chosen["recall"] - reference["recall"]
    small_recall = ", ".join(f"{label} {chosen['recall_by_size_bin'][label]:.3f}" for label in SMALL_BINS)
    return (
        f"Below-threshold detections exist: {evidence} A DEV operating point of {chosen['threshold']:.2f} raises "
        f"recall by {gain:.4f} to {chosen['recall']:.4f} at precision {chosen['precision']:.4f}, but recall under "
        f"128 px stays low ({small_recall}): most missed small roofs stay missed at this point."
    )


def analyse(run_id: str) -> None:
    configure_offline()
    plan_commit = committed_plan_commit()
    coco, receipt, by_image = dev_inputs()
    directory = CACHE_ROOT / run_id
    manifest = read_json(directory / "manifest.json")
    if manifest["model_sha256"] != receipt["model"]["sha256"]:
        raise ValueError("Cached scores come from different weights")
    jobs = [
        {
            "chip": chip,
            "annotations": by_image[chip["id"]],
            "cache": str(directory / "chips" / f"{chip['source_id']}.npz"),
            "input_resolution": manifest["input_resolution"],
        }
        for chip in coco["images"]
    ]
    started = time.perf_counter()
    with Pool(WORKERS) as pool:
        records = pool.map(analyse_chip, jobs, chunksize=8)
    curve = [threshold_row(records, threshold) for threshold in GRID]
    reference = next(row for row in curve if row["threshold"] == REFERENCE)
    chosen = select_operating_point(curve, reference["empty_chip_false_buildings"])
    bins = bin_table(records)
    seconds = time.perf_counter() - started
    write_json(RESULT, result_record(plan_commit, manifest, receipt, curve, bins, chosen, seconds))
    print(json.dumps({"chosen": chosen and chosen["threshold"], "parity": parity(curve, receipt)["matches"]}))


def result_record(
    plan_commit: str, manifest: dict, receipt: dict, curve: list[dict], bins: dict, chosen: dict | None, seconds: float
) -> dict[str, Any]:
    reference = next(row for row in curve if row["threshold"] == REFERENCE)
    return {
        "schema": "building-operating-point/1",
        "status": "completed",
        "split": "dev",
        "plan_commit": plan_commit,
        "model_sha256": receipt["model"]["sha256"],
        "coco_sha256": receipt["coco_sha256"],
        "source_receipt": "docs/evidence/gf-ai/building/b3-ka-run1-20261010-epoch004-dev-t050/result.json",
        "score_cache": CACHE_ROOT.as_posix(),
        "inference_seconds": manifest["seconds"],
        "peak_cuda_reserved_bytes": manifest["peak_cuda_reserved_bytes"],
        "budget_bytes": 6 * 1024**3,
        "replay_parity_with_b3_at_050": parity(curve, receipt),
        "size_bins_missed_at_050": bins,
        "curve": curve,
        "selection_rule": read_json(PLAN)["selection_rule"],
        "chosen_operating_point": chosen,
        "conclusion": conclusion(bins, chosen, reference),
        "claim_scope": read_json(PLAN)["claim_scope"],
        "analysis_seconds": seconds,
        "holdout_calls": 0,
        "transfer_calls": 0,
        "training_started": False,
    }


def main() -> None:
    configure_offline()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, choices=("cache", "analyse"))
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        parser.error("Simple unique run-id required")
    if args.stage == "cache":
        cache_scores(args.run_id)
    else:
        analyse(args.run_id)


if __name__ == "__main__":
    main()
