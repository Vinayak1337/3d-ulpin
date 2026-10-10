"""Regression for the door-leaf bbox bias found on Magnolia page 2.

Coordinates below are the baseline source-derived ground-bedroom candidate,
not a fabricated room or an evaluation label. Its 12'6\" x 10'2\" literal is
inside the face. A drawn door leaf extends the bbox by about 0.19 m, so the
bbox's >5% diagnostic must not silently override the <5% area comparison.
"""

import unittest

import fitz
from shapely.geometry import Polygon
from geo.vector_plan import DEFAULTS, MAGNOLIA_CAD_LAYERS, consistency, digest, in_scope, parse_dimensions, read_page


class DoorLeafBboxRegression(unittest.TestCase):
    def test_area_check_and_bbox_diagnostic_are_separate(self) -> None:
        ring = [
            [612.6, 1216.2],
            [635.04, 1216.2],
            [635.04, 1217.64],
            [635.04, 1306.68],
            [635.04, 1307.4],
            [522.84, 1307.4],
            [522.84, 1306.68],
            [517.2, 1306.68],
            [517.2, 1305.6],
            [540.6, 1305.6],
            [540.6, 1305],
            [540.6, 1304.52],
            [517.2, 1304.52],
            [517.2, 1280.52],
            [522.84, 1280.52],
            [522.84, 1216.92],
            [522.84, 1216.2],
            [549.72, 1216.2],
            [612.6, 1216.2],
        ]
        result = consistency(Polygon(ring), [parse_dimensions("(12'6\" X 10'2\")")], 0.03396031151158365, 0.05)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["bboxDiagnosticStatus"], "mismatch")
        self.assertAlmostEqual(result["differenceM2"], 0.135918722788, places=8)
        self.assertEqual(result["comparedQuantity"], "area_vs_stated_length_product")


class SourceLineBboxRegression(unittest.TestCase):
    def test_terrace_vertical_and_horizontal_source_edges_have_valid_scope(self) -> None:
        # Magnolia page 2, source slab edges seqnos 17242 and 17335. Shapely
        # box(*bbox) is invalid for zero-width/height and dropped these edges.
        region = [[965.64, 1150, 1254.66, 1635.73]]
        self.assertTrue(
            in_scope([1234.4000244140625, 1362.800048828125, 1234.4000244140625, 1512.320068359375], region)
        )
        self.assertTrue(
            in_scope([1035.43994140625, 1507.6400146484375, 1234.4000244140625, 1507.6400146484375], region)
        )
        self.assertFalse(in_scope([1035.44, 1507.64, 1300, 1507.64], region))


class LayerProfileAbstention(unittest.TestCase):
    def test_other_cad_layer_names_return_explicit_no_match_gap(self) -> None:
        # Synthetic code-path check only, not a room inventory or gate evidence.
        with fitz.open() as document:
            page = document.new_page()
            other_layer = document.add_ocg("OTHER-ARCHITECT-WALLS")
            for index in range(24):
                page.draw_line((20, 30 + index * 5), (200, 30 + index * 5), oc=other_layer)
            page.insert_text((20, 180), "GROUND FLOOR PLAN")
            layers = {drawing["layer"] for drawing in page.get_drawings()}
            self.assertEqual(layers, {"OTHER-ARCHITECT-WALLS"})
            self.assertFalse(any(MAGNOLIA_CAD_LAYERS.matches_wall_layer(layer) for layer in layers))
            result = read_page(page, {"purpose": "synthetic_code_path_test"}, digest(DEFAULTS), DEFAULTS)
            self.assertEqual(result["classification"]["kind"], "vector_plan")
            self.assertEqual(result["gaps"], ["no_matching_layer_profile"])
            self.assertEqual(result["candidates"], [])
            self.assertEqual(result["panels"], [])
            self.assertIsNone(result["scale"]["metresPerPdfPoint"])


if __name__ == "__main__":
    unittest.main()
