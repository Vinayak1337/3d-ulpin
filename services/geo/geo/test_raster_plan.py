"""Tile and scale association invariants; synthetic inputs are not gate evidence."""
from __future__ import annotations

import unittest

from shapely.geometry import box
from shapely.ops import unary_union

from geo.raster_plan import DimensionLine, resolve_scale, tiles


class BoundedTilesAndScalePairing(unittest.TestCase):
    def test_large_sheet_tiles_and_ambiguous_dimension_pair_abstention(self) -> None:
        bounds = (100.0, 60.0, 2490.0, 1660.0)
        selected = tiles(bounds, 2000)
        self.assertTrue(all(max(region[2] - region[0], region[3] - region[1]) <= 2000 for region in selected))
        union = unary_union([box(*region) for region in selected])
        self.assertTrue(union.equals(box(*bounds)))
        self.assertAlmostEqual(sum(box(*region).area for region in selected), union.area)
        observations = [{"literal": "10'0\"", "bboxPt": [40, 0, 60, 5]},
                        {"literal": "6'0\"", "bboxPt": [105, 20, 110, 40]}]
        horizontal = DimensionLine("verified-horizontal", (0, 10), (100, 10), (30, 0, 70, 6), True)
        vertical = DimensionLine("verified-vertical", (100, 0), (100, 60), (104, 10, 112, 50), True)
        scale = resolve_scale(observations, [horizontal, vertical])
        self.assertEqual(scale["state"], "candidate")
        self.assertAlmostEqual(scale["metresPerPoint"], 0.03048)
        duplicate = DimensionLine("competing-horizontal", (0, 15), (90, 15), (30, 0, 70, 6), True)
        ambiguous = resolve_scale(observations, [horizontal, duplicate, vertical])
        self.assertEqual(ambiguous["state"], "no_scale")
        self.assertIsNone(ambiguous["metresPerPoint"])
        self.assertEqual(resolve_scale(observations, [horizontal])["state"], "no_scale")
        self.assertEqual(resolve_scale(observations, [])["reason"], "no_verified_dimension_line_endpoints")


if __name__ == "__main__":
    unittest.main()
