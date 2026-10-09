"""Regression for the door-leaf bbox bias found on Magnolia page 2.

Coordinates below are the baseline source-derived ground-bedroom candidate,
not a fabricated room or an evaluation label. Its 12'6\" x 10'2\" literal is
inside the face. A drawn door leaf extends the bbox by about 0.19 m, so the
bbox's >5% diagnostic must not silently override the <5% area comparison.
"""
import unittest
from shapely.geometry import Polygon
from geo.vector_plan import consistency, in_scope, parse_dimensions


class DoorLeafBboxRegression(unittest.TestCase):
    def test_area_check_and_bbox_diagnostic_are_separate(self):
        ring = [
            [612.6, 1216.2], [635.04, 1216.2], [635.04, 1217.64],
            [635.04, 1306.68], [635.04, 1307.4], [522.84, 1307.4],
            [522.84, 1306.68], [517.2, 1306.68], [517.2, 1305.6],
            [540.6, 1305.6], [540.6, 1305], [540.6, 1304.52],
            [517.2, 1304.52], [517.2, 1280.52], [522.84, 1280.52],
            [522.84, 1216.92], [522.84, 1216.2], [549.72, 1216.2],
            [612.6, 1216.2],
        ]
        result = consistency(Polygon(ring), [parse_dimensions('(12\'6" X 10\'2")')],
                             0.03396031151158365, .05)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['bboxDiagnosticStatus'], 'mismatch')
        self.assertAlmostEqual(result['differenceM2'], 0.135918722788, places=8)
        self.assertEqual(result['comparedQuantity'], 'area_vs_stated_length_product')


class SourceLineBboxRegression(unittest.TestCase):
    def test_terrace_vertical_and_horizontal_source_edges_have_valid_scope(self):
        # Magnolia page 2, source slab edges seqnos 17242 and 17335. Shapely
        # box(*bbox) is invalid for zero-width/height and dropped these edges.
        region = [[965.64, 1150, 1254.66, 1635.73]]
        self.assertTrue(in_scope([1234.4000244140625, 1362.800048828125,
                                  1234.4000244140625, 1512.320068359375], region))
        self.assertTrue(in_scope([1035.43994140625, 1507.6400146484375,
                                  1234.4000244140625, 1507.6400146484375], region))
        self.assertFalse(in_scope([1035.44, 1507.64, 1300, 1507.64], region))


if __name__ == '__main__':
    unittest.main()
