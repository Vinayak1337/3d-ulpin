"""Checks for the attribution gap: count-only journals suffice only for unambiguous truth status."""

from __future__ import annotations

import unittest

import numpy as np
from shapely.geometry import box

from diagnose_building_recall import adjacency, attribution, geometries_for, inputs, interval


class RecallAttributionRegression(unittest.TestCase):
    def test_unambiguous_count_only_chips_need_no_inference(self) -> None:
        matched, method = attribution({}, [{}, {}], [], {"truth_buildings": 2, "tp": 0}, object())
        self.assertEqual(matched, set())
        self.assertEqual(method, "historical_all_fn")
        matched, method = attribution({}, [{}, {}], [], {"truth_buildings": 2, "tp": 2}, object())
        self.assertEqual(matched, {0, 1})
        self.assertEqual(method, "historical_all_tp")

    def test_unknown_polygon_adjacency_does_not_hide_known_raster_contact(self) -> None:
        mask = np.zeros((4, 4), dtype=bool)
        mask[1:3, 1:3] = True
        records = [{"polygon": None}, {"polygon": box(1, 1, 3, 3)}]
        neighbours = adjacency(records, [mask, mask.copy()])
        self.assertTrue(all(row["raster_touching"] for row in neighbours))
        self.assertTrue(all(row["shared_edge"] is None for row in neighbours))
        self.assertTrue(all(row["overlap"] is None for row in neighbours))

    def test_real_difficult_chip_has_source_supported_metric_areas_but_no_occlusion_labels(self) -> None:
        coco, _, _ = inputs()
        chip = next(image for image in coco["images"] if image["source_id"] == "0020b409-a333-4eb4-89c8-531b8110312a")
        annotations = [row for row in coco["annotations"] if row["image_id"] == chip["id"]]
        geometry, keys = geometries_for(chip, annotations)
        self.assertEqual(len(geometry), 11)
        self.assertEqual(keys, {"label"})
        self.assertTrue(all(row["area_m2"] > 0 for row in geometry))
        self.assertTrue(all(row["edge_pixels"] >= 0 for row in geometry))
        self.assertEqual(interval(None, (0, 40)), "unknown")


if __name__ == "__main__":
    unittest.main()
