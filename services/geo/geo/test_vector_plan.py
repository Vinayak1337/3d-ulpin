"""Regression for the door-leaf bbox bias found on Magnolia page 2.

Coordinates below are the baseline source-derived ground-bedroom candidate,
not a fabricated room or an evaluation label. Its 12'6\" x 10'2\" literal is
inside the face. A drawn door leaf extends the bbox by about 0.19 m, so the
bbox's >5% diagnostic must not silently override the <5% area comparison.
"""
import unittest
from shapely.geometry import Polygon
from geo.vector_plan import consistency, parse_dimensions


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


if __name__ == '__main__':
    unittest.main()
