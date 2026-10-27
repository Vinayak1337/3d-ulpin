"""Checks for the B8 attribution replay: the cascade categories, mask NMS and the production-parity invariant."""

from __future__ import annotations

import math
from pathlib import Path
import tempfile
import unittest

import numpy as np

from diagnose_operating_point import ReplayNative, production_instance, write_chip_cache
from diagnose_pipeline_attrition import (
    Query,
    analyse_chip,
    attribution_threshold,
    helps,
    nms_keep,
    painted_queries,
    trace_production,
)
from eval_buildings import infer
from test_diagnose_operating_point import uncompressed_rle

SIZE = 64
GRID_SIZE = 16
INPUT_RESOLUTION = 432


def logit(confidence: float) -> float:
    return math.log(confidence / (1 - confidence))


def write_cache(queries: list[tuple[float, tuple[slice, slice]]], strength: float = 5.0) -> Path:
    """A one-chip cache: each query is a confidence and the 16x16 mask cells it sets positive."""
    logits = np.full((1, 200, 1), -20.0, dtype=np.float32)
    masks = np.full((1, 200, GRID_SIZE, GRID_SIZE), -strength, dtype=np.float32)
    for number, (confidence, cells) in enumerate(queries):
        logits[0, number, 0] = logit(confidence)
        masks[0, number][cells] = 5.0
    path = Path(tempfile.mkdtemp()) / "chip.npz"
    write_chip_cache(path, logits, masks)
    return path


def raw_mask(cache: Path, query: int) -> np.ndarray:
    """The query's full-resolution mask, used as an exact truth."""
    replay = ReplayNative(cache, INPUT_RESOLUTION)
    queries = painted_queries(production_instance(), replay, (SIZE, SIZE), 0.05)
    return next(item.mask for item in queries if item.index == query)


def job_for(cache: Path, truths: list[np.ndarray]) -> dict:
    chip = {"source_id": "synthetic", "width": SIZE, "height": SIZE, "source_image_sha256": "synthetic"}
    annotations = [{"segmentation": uncompressed_rle(mask), "area": int(mask.sum())} for mask in truths]
    return {"chip": chip, "annotations": annotations, "cache": str(cache), "input_resolution": INPUT_RESOLUTION}


def categories(record: dict, threshold: str = "0.5") -> dict[int, str]:
    return {row["truth"]: row["category"] for row in record["primary"][threshold]["attribution"]}


class CascadeCategories(unittest.TestCase):
    def test_lower_score_overlapped_by_higher_score_is_claimed_and_nms_recovers_it(self) -> None:
        cache = write_cache([(0.9, (slice(4, 12), slice(4, 12))), (0.6, (slice(4, 12), slice(7, 15)))])
        record = analyse_chip(job_for(cache, [raw_mask(cache, 0), raw_mask(cache, 1)]))
        self.assertEqual(categories(record), {1: "claimed_by_higher_score"})
        production = record["primary"]["0.5"]["production"]
        alternative = record["primary"]["0.5"]["alternative"]
        self.assertEqual(production["matched_truths"], [0])
        self.assertEqual(alternative["matched_truths"], [0, 1])
        self.assertEqual(alternative["overlapping_pairs"], 1)

    def test_bar_through_a_roof_fragments_it(self) -> None:
        cache = write_cache([(0.9, (slice(0, 16), slice(7, 9))), (0.6, (slice(4, 12), slice(4, 12)))])
        record = analyse_chip(job_for(cache, [raw_mask(cache, 1)]))
        self.assertEqual(categories(record), {0: "fragmented"})
        self.assertEqual(record["primary"]["0.5"]["alternative"]["matched_truths"], [0])

    def test_piece_under_sixteen_pixels_is_an_area_filter_loss(self) -> None:
        cache = write_cache([(0.9, (slice(8, 10), slice(8, 9)))], strength=20.0)
        truth = raw_mask(cache, 0)
        self.assertLess(int(truth.sum()), 16)
        record = analyse_chip(job_for(cache, [truth]))
        self.assertEqual(categories(record), {0: "area_filter"})

    def test_truth_with_a_pipeline_match_is_not_attributed(self) -> None:
        cache = write_cache([(0.9, (slice(4, 12), slice(4, 12)))])
        record = analyse_chip(job_for(cache, [raw_mask(cache, 0)]))
        self.assertEqual(categories(record), {})
        self.assertEqual(record["supplementary"], [])


class ProductionReplay(unittest.TestCase):
    def test_trace_reproduces_the_production_predictions(self) -> None:
        from PIL import Image

        cache = write_cache([(0.9, (slice(4, 12), slice(4, 12))), (0.6, (slice(4, 12), slice(7, 15)))])
        prod = production_instance()
        replay = ReplayNative(cache, INPUT_RESOLUTION)
        traced = trace_production(prod, replay, (SIZE, SIZE), "synthetic", 0.5).predictions
        replayed = infer(prod, replay, Image.new("RGB", (SIZE, SIZE)), "synthetic")[0]
        self.assertEqual(len(traced), len(replayed))
        self.assertTrue(all(np.array_equal(left, right) for left, right in zip(traced, replayed)))


class Rules(unittest.TestCase):
    def test_nms_drops_only_masks_overlapping_a_kept_one_above_half(self) -> None:
        base = np.zeros((10, 10), dtype=bool)
        base[:, :6] = True
        near_duplicate = np.zeros_like(base)
        near_duplicate[:, 1:7] = True
        far = np.zeros_like(base)
        far[:, 6:] = True
        queries = [Query(0, 0.9, base), Query(1, 0.8, near_duplicate), Query(2, 0.7, far)]
        self.assertEqual([query.index for query in nms_keep(queries)], [0, 2])

    def test_attribution_threshold_is_the_grid_value_below_the_score(self) -> None:
        self.assertEqual(attribution_threshold(0.33), 0.3)
        self.assertEqual(attribution_threshold(0.3), 0.25)
        self.assertIsNone(attribution_threshold(0.05))

    def test_helps_needs_recall_precision_and_empty_chip_limits_together(self) -> None:
        production = {"recall": 0.70, "precision": 0.85, "empty_chip_false_buildings": 20}
        good = {"recall": 0.73, "precision": 0.82, "empty_chip_false_buildings": 40}
        self.assertTrue(helps(production, good))
        self.assertFalse(helps(production, {**good, "recall": 0.71}))
        self.assertFalse(helps(production, {**good, "precision": 0.79}))
        self.assertFalse(helps(production, {**good, "empty_chip_false_buildings": 41}))


if __name__ == "__main__":
    unittest.main()
