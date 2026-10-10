"""Regression for treating query-order changes as served-instance changes; v2 contract checks."""

from __future__ import annotations

import unittest

import numpy as np
from rasterio.features import rasterize
from shapely.geometry import box, mapping

from building_io import read_json
from check_building_instances import PROTOCOL, compare_instances


def fixture(left: int, score: float) -> tuple[dict, np.ndarray]:
    geometry = mapping(box(left, 1, left + 3, 4))
    component = {"geometry": geometry, "score": score}
    mask = rasterize([(geometry, 1)], out_shape=(8, 8), dtype="uint8").astype(bool)
    return component, mask


class InstanceParityRegression(unittest.TestCase):
    def setUp(self) -> None:
        self.limits = read_json(PROTOCOL)["pass_per_chip"]

    def test_instance_permutation_passes_but_score_drift_does_not(self) -> None:
        first, first_mask = fixture(0, 0.8)
        second, second_mask = fixture(4, 0.9)
        result = compare_instances(
            [first, second], [second, first], [first_mask, second_mask], [second_mask, first_mask], self.limits
        )
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["maximum_mask_iou_loss"], 0)
        changed_second = {**second, "score": 0.902}
        result = compare_instances(
            [first, second], [changed_second, first], [first_mask, second_mask], [second_mask, first_mask], self.limits
        )
        self.assertEqual(result["failures"], ["score_delta"])

    def test_unilateral_instance_is_allowed_only_in_frozen_threshold_band(self) -> None:
        near, mask = fixture(0, 0.501)
        allowed = compare_instances([near], [], [mask], [], self.limits)
        self.assertEqual(allowed["status"], "passed")
        self.assertFalse(allowed["raw_counts_equal"])
        self.assertEqual(allowed["threshold_band_unmatched_count"], 1)
        high = {**near, "score": 0.501001}
        denied = compare_instances([high], [], [mask], [], self.limits)
        self.assertIn("unmatched_above_threshold_band", denied["failures"])


if __name__ == "__main__":
    unittest.main()
