"""B8: where the production pipeline loses raw building instances, and one DEV-only instance-preserving comparison.

Replays B7's cached DEV scores through the unchanged production painting (`_building_tile`) and component
(`_components`) code, follows each raw query through painting, pieces and filters, and compares production with
score-ordered mask NMS. Only the frozen DEV split is opened; no model, GPU, holdout or transfer data is needed.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
import json
from multiprocessing import Pool
from pathlib import Path
import re
import time
from typing import Any

import numpy as np
from PIL import Image
from rasterio.features import rasterize
from scipy.ndimage import binary_erosion, label
from shapely.geometry import shape

from building_io import EVIDENCE, RUNS, configure_offline, read_json, sha, write_json
from diagnose_building_recall import PIXEL_BINS, interval, masks_for
from diagnose_operating_point import (
    CACHE_ROOT,
    DEV_DIR,
    EMPTY_FACTOR,
    GRID,
    IOU_THRESHOLD,
    PRECISION_FLOOR,
    WORKERS,
    ReplayNative,
    committed_plan_commit,
    dev_inputs,
    parity,
    production_instance,
    safe_ratio,
)
from eval_buildings import matched_pairs, threshold_session

PLAN = EVIDENCE / "b8/plan.json"
RESULT = EVIDENCE / "b8/result.json"
OUTPUT = RUNS / "b8-attrition"
SOURCE_RUN = "b7-epoch004-dev-20261010"
PRIMARY = (0.5, 0.45)
REFERENCE = 0.5
SUPPLEMENTARY_FLOOR = 0.05
KEEP_FRACTION = 0.5
NMS_IOU = 0.5
SCORE_MARGIN = 1e-6
RECALL_GAIN = 0.02
CONTACT_SHEET_SIZE = 12
CONTACT_SCALE = 3
BIN_LABELS = tuple(interval(edge, PIXEL_BINS) for edge in PIXEL_BINS)
CATEGORIES = (
    "claimed_by_higher_score",
    "fragmented",
    "area_filter",
    "simplify_or_invalid",
    "capacity",
    "other",
)
RECOVERED = "recovered_at_attribution_threshold"


@dataclass
class Query:
    """One model query painted by production: its index, unshifted sigmoid score and full unpainted mask."""

    index: int
    raw_score: float
    mask: np.ndarray


@dataclass
class Trace:
    """Production at one threshold: labels, components, rasterised predictions and the painted queries."""

    queries: list[Query]
    labels: np.ndarray
    label_of: dict[int, int]
    kept_ids: set[str]
    predictions: list[np.ndarray]


@dataclass
class ChipContext:
    """Everything needed to analyse one chip, with production traces cached per threshold."""

    prod: Any
    replay: ReplayNative
    size: tuple[int, int]
    fingerprint: str
    truth: list[np.ndarray]
    bins: list[str]
    traces: dict[float, Trace] = field(default_factory=dict)
    matches: dict[float, set[int]] = field(default_factory=dict)

    def trace(self, threshold: float) -> Trace:
        if threshold not in self.traces:
            self.traces[threshold] = trace_production(self.prod, self.replay, self.size, self.fingerprint, threshold)
        return self.traces[threshold]

    def matched(self, threshold: float) -> set[int]:
        if threshold not in self.matches:
            pairs = matched_pairs(self.truth, self.trace(threshold).predictions)
            self.matches[threshold] = {pair[0] for pair in pairs}
        return self.matches[threshold]


def mask_iou(first: np.ndarray, second: np.ndarray) -> float:
    union = np.count_nonzero(first | second)
    return np.count_nonzero(first & second) / union if union else 0.0


def painted_queries(prod: Any, replay: ReplayNative, size: tuple[int, int], threshold: float) -> list[Query]:
    """The queries production paints at the threshold, in its painting order, with their full masks."""
    logits, masks = threshold_session(replay, threshold).run(None, {})
    confidence = 1 / (1 + np.exp(-np.clip(logits[0, :, 0], -80, 80)))
    raw = 1 / (1 + np.exp(-np.clip(replay.logits[0, :, 0], -80, 80)))
    width, height = size
    queries = []
    for query in np.argsort(-confidence, kind="stable"):
        if confidence[query] <= 0.5:
            break
        mask = prod._resize_logits(masks[0, query], height, width) > 0
        queries.append(Query(int(query), float(raw[query]), mask))
    return queries


def paint(queries: list[Query], shape_hw: tuple[int, int]) -> tuple[np.ndarray, dict[int, int]]:
    """Production's painting rule (lower scores keep only unclaimed pixels), recording each query's label."""
    labels = np.zeros(shape_hw, np.uint8)
    label_of: dict[int, int] = {}
    for query in queries:
        painted = query.mask & (labels == 0)
        if painted.any():
            label_of[query.index] = len(label_of) + 1
            labels[painted] = label_of[query.index]
    return labels, label_of


def rasterize_component(component: dict, shape_hw: tuple[int, int]) -> np.ndarray:
    return rasterize([(component["geometry"], 1)], out_shape=shape_hw, dtype="uint8").astype(bool)


def trace_production(
    prod: Any, replay: ReplayNative, size: tuple[int, int], fingerprint: str, threshold: float
) -> Trace:
    """Run the production functions themselves, then check that the per-query painting record reproduces them."""
    native = threshold_session(replay, threshold)
    labels, scores, palette, _ = prod._building_tile(native, Image.new("RGB", size), replay.input_resolution)
    components, _ = prod._components(labels, scores, palette, fingerprint)
    queries = painted_queries(prod, replay, size, threshold)
    painted, label_of = paint(queries, labels.shape)
    if not np.array_equal(painted, labels):
        raise ValueError("Per-query painting differs from production _building_tile")
    predictions = [rasterize_component(component, labels.shape) for component in components]
    return Trace(queries, labels, label_of, {component["id"] for component in components}, predictions)


def best_raw_match(truth: np.ndarray, queries: list[Query]) -> tuple[Query, float] | None:
    """The query with the highest full-mask IoU against the truth, if that IoU reaches 0.5 (ties: higher score)."""
    scored = [(mask_iou(query.mask, truth), query.raw_score, query) for query in queries]
    scored = [item for item in scored if item[0] >= IOU_THRESHOLD]
    if not scored:
        return None
    best = max(scored, key=lambda item: (item[0], item[1]))
    return best[2], best[0]


def pixel_pieces(mask: np.ndarray) -> list[np.ndarray]:
    """4-connected pieces of a mask, as production's `_components` splits them."""
    labelled, count = label(mask)
    return [labelled == number for number in range(1, count + 1)]


def isolate(prod: Any, piece: np.ndarray, value: int, fingerprint: str) -> tuple[list[dict], dict[str, int]]:
    """Run production `_components` on one piece alone, under the label value it has in the full chip."""
    labels = np.where(piece, value, 0).astype(np.uint8)
    palette = {0: "background", value: "building"}
    return prod._components(labels, np.zeros(labels.shape, np.float32), palette, fingerprint)


def classify_piece(context: ChipContext, trace: Trace, piece: np.ndarray, value: int, truth: np.ndarray) -> tuple:
    """The step that lost a piece that does match the truth at pixel level."""
    components, omitted = isolate(context.prod, piece, value, context.fingerprint)
    if omitted["small"]:
        return "area_filter", None
    if omitted["invalid"] or omitted["complex"] or not components:
        return "simplify_or_invalid", None
    if components[0]["id"] not in trace.kept_ids:
        return "capacity", None
    if mask_iou(rasterize_component(components[0], piece.shape), truth) < IOU_THRESHOLD:
        return "simplify_or_invalid", None
    return "other", "assignment_lost"


def classify_loss(context: ChipContext, trace: Trace, truth: np.ndarray, query: Query) -> tuple[str, str | None]:
    """Preregistered cascade for a truth whose representative raw query is not matched by the pipeline."""
    value = trace.label_of.get(query.index, 0)
    painted = trace.labels == value if value else np.zeros_like(query.mask)
    if np.count_nonzero(painted) < KEEP_FRACTION * np.count_nonzero(query.mask):
        return "claimed_by_higher_score", None
    pieces = pixel_pieces(painted)
    matching = [piece for piece in pieces if mask_iou(piece, truth) >= IOU_THRESHOLD]
    if not matching and len(pieces) > 1:
        return "fragmented", None
    if not matching:
        return "other", "partial_claim_below_iou"
    best = max(matching, key=lambda piece: mask_iou(piece, truth))
    return classify_piece(context, trace, best, value, truth)


def nms_keep(queries: list[Query]) -> list[Query]:
    """Score-ordered mask NMS: drop a query whose full mask has IoU > 0.5 with an already-kept one."""
    kept: list[Query] = []
    for query in queries:
        if all(mask_iou(query.mask, other.mask) <= NMS_IOU for other in kept):
            kept.append(query)
    return kept


def largest_piece(mask: np.ndarray) -> np.ndarray:
    return max(pixel_pieces(mask), key=np.count_nonzero)


def alternative_predictions(context: ChipContext, threshold: float) -> list[np.ndarray]:
    """One prediction per NMS-kept query from its full mask's largest piece; overlap allowed, capped like production."""
    trace = context.trace(threshold)
    components = []
    for query in nms_keep(trace.queries):
        if query.mask.any():
            found, _ = isolate(context.prod, largest_piece(query.mask), 1, context.fingerprint)
            components.extend(found)
    components.sort(key=lambda component: (-shape(component["geometry"]).area, component["id"]))
    capped = components[: context.prod.MAX_COMPONENTS]
    return [rasterize_component(component, trace.labels.shape) for component in capped]


def overlapping_pairs(predictions: list[np.ndarray]) -> int:
    return sum(
        1
        for first in range(len(predictions))
        for second in range(first + 1, len(predictions))
        if np.count_nonzero(predictions[first] & predictions[second])
    )


def score_entry(context: ChipContext, predictions: list[np.ndarray]) -> dict[str, Any]:
    pairs = matched_pairs(context.truth, predictions)
    return {
        "predicted": len(predictions),
        "matched_truths": sorted(pair[0] for pair in pairs),
        "matched_predictions": sorted(pair[1] for pair in pairs),
        "prediction_bins": [interval(np.count_nonzero(prediction), PIXEL_BINS) for prediction in predictions],
    }


def attribution_row(context: ChipContext, index: int, threshold: float, category: str, **extra: Any) -> dict:
    return {"truth": index, "bin": context.bins[index], "threshold": threshold, "category": category, **extra}


def attribute_lost_truths(context: ChipContext, threshold: float) -> list[dict[str, Any]]:
    """Cascade category for every truth that has a raw match at the threshold but no pipeline match."""
    trace = context.trace(threshold)
    rows = []
    for index, truth in enumerate(context.truth):
        match = best_raw_match(truth, trace.queries) if index not in context.matched(threshold) else None
        if match is None:
            continue
        category, detail = classify_loss(context, trace, truth, match[0])
        rows.append(attribution_row(context, index, threshold, category, detail=detail, iou=match[1]))
    return rows


def attribution_threshold(score: float) -> float | None:
    """The largest grid threshold strictly below the score, where production first paints the query."""
    below = [threshold for threshold in GRID if threshold < score - SCORE_MARGIN]
    return max(below) if below else None


def supplementary_rows(context: ChipContext) -> list[dict[str, Any]]:
    """Cascade for truths missed at 0.5 with any raw match, taken at the threshold just below that match's score."""
    floor_queries = painted_queries(context.prod, context.replay, context.size, SUPPLEMENTARY_FLOOR)
    rows = []
    for index, truth in enumerate(context.truth):
        match = best_raw_match(truth, floor_queries) if index not in context.matched(REFERENCE) else None
        threshold = attribution_threshold(match[0].raw_score) if match else None
        if threshold is not None:
            rows.append(supplementary_row(context, index, truth, match, threshold))
    return rows


def supplementary_row(context: ChipContext, index: int, truth: np.ndarray, match: tuple, threshold: float) -> dict:
    query, iou = match
    if index in context.matched(threshold):
        return attribution_row(context, index, threshold, RECOVERED, detail=None, iou=iou)
    trace = context.trace(threshold)
    painted = next(item for item in trace.queries if item.index == query.index)
    category, detail = classify_loss(context, trace, truth, painted)
    return attribution_row(context, index, threshold, category, detail=detail, iou=iou)


def primary_entry(context: ChipContext, threshold: float) -> dict[str, Any]:
    alternative = alternative_predictions(context, threshold)
    return {
        "production": score_entry(context, context.trace(threshold).predictions),
        "alternative": {**score_entry(context, alternative), "overlapping_pairs": overlapping_pairs(alternative)},
        "attribution": attribute_lost_truths(context, threshold),
    }


def chip_context(job: dict[str, Any]) -> ChipContext:
    chip, annotations = job["chip"], job["annotations"]
    return ChipContext(
        prod=production_instance(),
        replay=ReplayNative(Path(job["cache"]), job["input_resolution"]),
        size=(chip["width"], chip["height"]),
        fingerprint=chip["source_image_sha256"],
        truth=masks_for(annotations),
        bins=[interval(annotation["area"], PIXEL_BINS) for annotation in annotations],
    )


def analyse_chip(job: dict[str, Any]) -> dict[str, Any]:
    context = chip_context(job)
    return {
        "chip_id": job["chip"]["source_id"],
        "empty": not job["annotations"],
        "bins": context.bins,
        "primary": {str(threshold): primary_entry(context, threshold) for threshold in PRIMARY},
        "supplementary": supplementary_rows(context),
    }


def production_counts(job: dict[str, Any]) -> dict[str, Any]:
    """Parity stage: production at 0.5 only."""
    context = chip_context(job)
    entry = score_entry(context, context.trace(REFERENCE).predictions)
    return {"empty": not job["annotations"], "bins": context.bins, "primary": {str(REFERENCE): {"production": entry}}}


def metric_counts(records: list[dict], threshold: float, method: str) -> dict[str, Any]:
    key = str(threshold)
    entries = [(record, record["primary"][key][method]) for record in records]
    tp = sum(len(entry["matched_truths"]) for _, entry in entries)
    predicted = sum(entry["predicted"] for _, entry in entries)
    truth = sum(len(record["bins"]) for record, _ in entries)
    precision, recall = safe_ratio(tp, predicted), safe_ratio(tp, truth)
    return {
        "threshold": threshold,
        "tp": tp,
        "predicted": predicted,
        "truth": truth,
        "precision": precision,
        "recall": recall,
        "f1": safe_ratio(2 * tp, predicted + truth),
        "empty_chip_false_buildings": sum(entry["predicted"] for record, entry in entries if record["empty"]),
        "by_size_bin": size_bin_rows(entries),
    }


def size_bin_rows(entries: list[tuple[dict, dict]]) -> dict[str, dict[str, Any]]:
    """Recall by truth-area bin, precision by prediction-area bin, F1 as their harmonic mean."""
    truth, found = Counter(), Counter()
    predicted, correct = Counter(), Counter()
    for record, entry in entries:
        matched_truths, matched_predictions = set(entry["matched_truths"]), set(entry["matched_predictions"])
        for index, label_text in enumerate(record["bins"]):
            truth[label_text] += 1
            found[label_text] += index in matched_truths
        for index, label_text in enumerate(entry["prediction_bins"]):
            predicted[label_text] += 1
            correct[label_text] += index in matched_predictions
    return {label_text: size_bin_row(truth, found, predicted, correct, label_text) for label_text in BIN_LABELS}


def size_bin_row(truth: Counter, found: Counter, predicted: Counter, correct: Counter, label_text: str) -> dict:
    precision = safe_ratio(correct[label_text], predicted[label_text])
    recall = safe_ratio(found[label_text], truth[label_text])
    both = precision is not None and recall is not None and precision + recall > 0
    return {
        "truth": truth[label_text],
        "predicted": predicted[label_text],
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if both else None,
    }


def category_table(rows: list[dict], missed: Counter, categories: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """Per size bin and overall: truths missed, those with a raw match, and their cascade categories."""
    table = {}
    for label_text in (*BIN_LABELS, "all"):
        chosen = [row for row in rows if label_text in ("all", row["bin"])]
        counts = Counter(row["category"] for row in chosen)
        table[label_text] = {
            "missed": sum(missed.values()) if label_text == "all" else missed[label_text],
            "with_raw_match": len(chosen),
            "categories": {category: counts[category] for category in categories},
            "other_detail": dict(Counter(row["detail"] for row in chosen if row["category"] == "other")),
        }
    return table


def missed_by_bin(records: list[dict], threshold: float) -> Counter:
    missed: Counter = Counter()
    for record in records:
        found = set(record["primary"][str(threshold)]["production"]["matched_truths"])
        missed.update(label_text for index, label_text in enumerate(record["bins"]) if index not in found)
    return missed


def attribution_tables(records: list[dict]) -> dict[str, Any]:
    primary = {}
    for threshold in PRIMARY:
        rows = [row for record in records for row in record["primary"][str(threshold)]["attribution"]]
        primary[str(threshold)] = category_table(rows, missed_by_bin(records, threshold), CATEGORIES)
    supplementary_rows_all = [row for record in records for row in record["supplementary"]]
    supplementary = category_table(supplementary_rows_all, missed_by_bin(records, REFERENCE), (*CATEGORIES, RECOVERED))
    return {"primary": primary, "supplementary_at_own_score": supplementary}


def helps(production: dict, alternative: dict) -> bool:
    """The preregistered rule: recall +0.02, precision >= 0.80 and empty-chip false buildings <= 2x production's."""
    return bool(
        alternative["recall"] >= production["recall"] + RECALL_GAIN
        and alternative["precision"] >= PRECISION_FLOOR
        and alternative["empty_chip_false_buildings"] <= EMPTY_FACTOR * production["empty_chip_false_buildings"]
    )


def comparison(records: list[dict]) -> dict[str, Any]:
    result = {}
    for threshold in PRIMARY:
        production = metric_counts(records, threshold, "production")
        alternative = metric_counts(records, threshold, "alternative")
        alternative["overlapping_prediction_pairs"] = sum(
            record["primary"][str(threshold)]["alternative"]["overlapping_pairs"] for record in records
        )
        result[str(threshold)] = {
            "production": production,
            "alternative": alternative,
            "recall_gain": alternative["recall"] - production["recall"],
            "helps": helps(production, alternative),
        }
    return result


def largest_category(table: dict[str, dict]) -> str:
    counts = table["all"]["categories"]
    return max(CATEGORIES, key=lambda category: counts[category])


def verdict(is_helpful: bool) -> str:
    return "helps" if is_helpful else "does not help"


def conclusion(tables: dict, compared: dict) -> str:
    table = tables["primary"]["0.45"]["all"]
    own = tables["supplementary_at_own_score"]["all"]
    gains = "; ".join(f"at {key} {value['recall_gain']:+.4f}" for key, value in compared.items())
    verdicts = "; ".join(f"at {key} it {verdict(value['helps'])}" for key, value in compared.items())
    return (
        f"Of {own['with_raw_match']} DEV truths missed at 0.5 that have a raw match, "
        f"{own['categories'][RECOVERED]} are matched once the threshold sits just below the match's score and "
        f"{own['categories']['claimed_by_higher_score']} are still lost to painting claimed by a higher-scored mask; "
        f"at 0.45 itself only {table['with_raw_match']} truths are lost after the model, "
        f"{table['categories']['claimed_by_higher_score']} of them to claiming. "
        f"Score-ordered mask NMS changes DEV recall {gains}; by the preregistered rule, {verdicts}."
    )


def outline(mask: np.ndarray) -> np.ndarray:
    return mask & ~binary_erosion(mask, border_value=0)


def draw_example(context: ChipContext, chip: dict, row: dict, path: Path) -> None:
    """Chip with the truth (green), the representative raw query (blue) and its painted pixels (red)."""
    trace = context.trace(row["threshold"])
    truth = context.truth[row["truth"]]
    query = best_raw_match(truth, trace.queries)[0]
    value = trace.label_of.get(query.index, 0)
    image = np.asarray(Image.open(DEV_DIR / chip["file_name"]).convert("RGB")).copy()
    image[outline(query.mask)] = (40, 120, 255)
    image[outline(truth)] = (0, 210, 80)
    if value:
        image[outline(trace.labels == value)] = (240, 0, 70)
    size = (image.shape[1] * CONTACT_SCALE, image.shape[0] * CONTACT_SCALE)
    Image.fromarray(image).resize(size, Image.Resampling.NEAREST).save(path)


def evenly_spaced(rows: list[dict], count: int) -> list[dict]:
    if len(rows) <= count:
        return rows
    return [rows[position * len(rows) // count] for position in range(count)]


def contact_sheet(records: list[dict], jobs: dict[str, dict], directory: Path, category: str) -> list[dict[str, str]]:
    """PNGs of the largest attribution category at 0.45, evenly spaced over the chip-sorted list."""
    rows = sorted(
        (
            {**row, "chip_id": record["chip_id"]}
            for record in records
            for row in record["primary"]["0.45"]["attribution"]
            if row["category"] == category
        ),
        key=lambda row: (row["chip_id"], row["truth"]),
    )
    written = []
    for number, row in enumerate(evenly_spaced(rows, CONTACT_SHEET_SIZE), start=1):
        job = jobs[row["chip_id"]]
        path = directory / f"{category}-{number:02d}-{row['chip_id'][:8]}-truth{row['truth']}.png"
        draw_example(chip_context(job), job["chip"], row, path)
        written.append({"path": path.as_posix(), "sha256": sha(path)})
    return written


def build_jobs(source_run: str) -> tuple[list[dict], dict, dict]:
    coco, receipt, by_image = dev_inputs()
    directory = CACHE_ROOT / source_run
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
    return jobs, receipt, manifest


def parity_proof(records: list[dict], receipt: dict) -> dict[str, Any]:
    return parity([metric_counts(records, REFERENCE, "production")], receipt)


def run_parity(source_run: str) -> None:
    jobs, receipt, _ = build_jobs(source_run)
    with Pool(WORKERS) as pool:
        records = pool.map(production_counts, jobs, chunksize=8)
    print(json.dumps(parity_proof(records, receipt)))


def result_record(plan_commit: str, receipt: dict, records: list[dict], sheet: list[dict], seconds: float) -> dict:
    tables = attribution_tables(records)
    compared = comparison(records)
    return {
        "schema": "building-pipeline-attrition/1",
        "status": "completed",
        "split": "dev",
        "plan_commit": plan_commit,
        "model_sha256": receipt["model"]["sha256"],
        "source_cache": (CACHE_ROOT / SOURCE_RUN).as_posix(),
        "replay_parity_with_b3_at_050": parity_proof(records, receipt),
        "attribution": tables,
        "comparison": compared,
        "alternative_helps": {key: value["helps"] for key, value in compared.items()},
        "contact_sheet": sheet,
        "conclusion": conclusion(tables, compared),
        "claim_scope": read_json(PLAN)["claim_scope"],
        "analysis_seconds": seconds,
        "holdout_calls": 0,
        "transfer_calls": 0,
        "production_changed": False,
    }


def run_analysis(source_run: str, run_id: str) -> None:
    plan_commit = committed_plan_commit(PLAN)
    jobs, receipt, _ = build_jobs(source_run)
    started = time.perf_counter()
    with Pool(WORKERS) as pool:
        records = pool.map(analyse_chip, jobs, chunksize=4)
    if not parity_proof(records, receipt)["matches"]:
        raise ValueError("Replay does not reproduce the B3 DEV counts at 0.5; stopping before any result is written")
    directory = OUTPUT / run_id
    (directory / "contact-sheet").mkdir(parents=True, exist_ok=False)
    category = largest_category(attribution_tables(records)["primary"]["0.45"])
    by_chip = {job["chip"]["source_id"]: job for job in jobs}
    sheet = contact_sheet(records, by_chip, directory / "contact-sheet", category)
    seconds = time.perf_counter() - started
    write_json(RESULT, result_record(plan_commit, receipt, records, sheet, seconds))
    print(json.dumps({"parity": True, "seconds": seconds, "contact_sheet": len(sheet)}))


def main() -> None:
    configure_offline()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", required=True, choices=("parity", "analyse"))
    parser.add_argument("--run-id", help="New output directory name under the b8-attrition run folder (analyse)")
    parser.add_argument("--source-run", default=SOURCE_RUN, help="B7 score cache run to replay")
    args = parser.parse_args()
    if args.stage == "parity":
        run_parity(args.source_run)
    elif args.run_id and re.fullmatch(r"[A-Za-z0-9_-]+", args.run_id):
        run_analysis(args.source_run, args.run_id)
    else:
        parser.error("analyse needs a simple unique --run-id")


if __name__ == "__main__":
    main()
