"""Checks for the B7 operating-point diagnosis: selection rule, histograms and the cached-score replay."""

from __future__ import annotations

import math
from pathlib import Path
import tempfile
import unittest

import numpy as np

from diagnose_operating_point import (
    GRID,
    analyse_chip,
    bin_entry,
    score_label,
    select_operating_point,
    write_chip_cache,
)

SIZE = 64


def curve_row(threshold: float, precision: float, recall: float, empty: int) -> dict:
    return {"threshold": threshold, "precision": precision, "recall": recall, "empty_chip_false_buildings": empty}


def uncompressed_rle(mask: np.ndarray) -> dict:
    """COCO uncompressed RLE: alternating background and foreground run lengths, column-major."""
    flat = mask.flatten(order="F").astype(np.uint8)
    runs, current, length = [], 0, 0
    for value in flat:
        if value == current:
            length += 1
        else:
            runs.append(length)
            current, length = int(value), 1
    runs.append(length)
    return {"size": list(mask.shape), "counts": runs}


def synthetic_chip(confidence: float) -> tuple[dict, list[dict], Path]:
    """One 32x32 square roof, model output as one query of the given sigmoid score."""
    truth = np.zeros((SIZE, SIZE), dtype=bool)
    truth[16:48, 16:48] = True
    logits = np.full((1, 200, 1), -20.0, dtype=np.float32)
    logits[0, 0, 0] = math.log(confidence / (1 - confidence))
    masks = np.full((1, 200, 16, 16), -5.0, dtype=np.float32)
    masks[0, 0, 4:12, 4:12] = 5.0
    path = Path(tempfile.mkdtemp()) / "chip.npz"
    write_chip_cache(path, logits, masks)
    chip = {"source_id": "synthetic", "width": SIZE, "height": SIZE, "source_image_sha256": "synthetic"}
    annotation = {"segmentation": uncompressed_rle(truth), "area": int(truth.sum())}
    return chip, [annotation], path


class OperatingPointRegression(unittest.TestCase):
    def test_selection_prefers_highest_recall_then_higher_threshold(self) -> None:
        curve = [
            curve_row(0.3, 0.79, 0.80, 10),
            curve_row(0.35, 0.82, 0.75, 38),
            curve_row(0.4, 0.84, 0.75, 30),
            curve_row(0.45, 0.86, 0.70, 41),
        ]
        self.assertEqual(select_operating_point(curve, 20)["threshold"], 0.4)
        self.assertIsNone(select_operating_point([curve_row(0.5, 0.7, 0.9, 0)], 20))

    def test_score_labels_cover_every_branch(self) -> None:
        self.assertEqual(score_label(None), "no_instance_iou_ge_0.5")
        self.assertEqual(score_label(0.7), "at_or_above_0.50")
        self.assertEqual(score_label(0.03), "below_0.05")
        self.assertEqual(score_label(0.3), "[0.30,0.35)")
        self.assertEqual(score_label(0.4999), "[0.45,0.50)")

    def test_bin_entry_counts_share_and_no_match_ious(self) -> None:
        missed = [
            {"best_score": 0.2, "best_iou": 0.9, "recovered_below": 0.15},
            {"best_score": None, "best_iou": 0.35, "recovered_below": None},
        ]
        entry = bin_entry(10, missed)
        self.assertEqual(entry["share_missed_with_raw_instance_below_050"], 0.5)
        self.assertEqual(entry["missed_matched_by_pipeline_at_lower_threshold"], 1)
        self.assertEqual(entry["best_raw_iou_histogram_when_no_match"], {"[0.3,0.5)": 1})

    def test_cached_replay_finds_low_score_roof_only_below_its_score(self) -> None:
        chip, annotations, cache = synthetic_chip(0.3)
        record = analyse_chip({"chip": chip, "annotations": annotations, "cache": str(cache), "input_resolution": 432})
        matched = {threshold: record["per_threshold"][str(threshold)]["matched"] for threshold in GRID}
        self.assertEqual(matched[0.5], [])
        self.assertEqual(matched[0.3], [])
        self.assertEqual(matched[0.25], [0])
        self.assertEqual(record["per_threshold"]["0.5"]["predicted"], 0)
        self.assertAlmostEqual(record["raw"]["0"]["best_score"], 0.3, places=5)


if __name__ == "__main__":
    unittest.main()
