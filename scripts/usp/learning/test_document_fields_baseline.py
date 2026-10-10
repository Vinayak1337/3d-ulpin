"""Storey and unit rules: one named test per pattern family; no OCR, no network."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO / "services" / "geo"))

import document_fields_baseline as rules  # noqa: E402


def found(finder, text: str) -> list[tuple]:
    return [(item["value"], item["quote"]) for item in finder(text)]


class FloorExpressionTest(unittest.TestCase):
    def test_ground_plus_n_with_and_without_spaces(self) -> None:
        self.assertEqual(found(rules.find_floor_expressions, "T-3 G+41"), [("G+41", "G+41")])
        self.assertEqual(found(rules.find_floor_expressions, "TOWER G + 42 FLOORS"), [("G+42", "G + 42")])

    def test_stilt_basement_and_double_basement_forms(self) -> None:
        self.assertEqual(found(rules.find_floor_expressions, "S+14")[0][0], "S+14")
        self.assertEqual(found(rules.find_floor_expressions, "B+G+6")[0][0], "B+G+6")
        self.assertEqual(found(rules.find_floor_expressions, "sanctioned 2B+G+12.")[0][0], "2B+G+12")
        self.assertEqual(found(rules.find_floor_expressions, "B+S+17")[0][0], "B+S+17")

    def test_text_that_only_looks_like_an_expression_is_ignored(self) -> None:
        self.assertEqual(rules.find_floor_expressions("AG+4 ROOM, G+ TOWER, 3+4"), [])


class BasementCountTest(unittest.TestCase):
    def test_count_written_before_b_is_a_count_but_a_bare_b_is_not(self) -> None:
        self.assertEqual(found(rules.find_basement_counts, "2B+G+12"), [(2, "2B+G+12")])
        self.assertEqual(rules.find_basement_counts("B+G+6"), [])

    def test_basement_phrase(self) -> None:
        self.assertEqual(found(rules.find_basement_counts, "two basements and a podium")[0][0], 2)

    def test_an_area_figure_before_basement_is_not_a_count(self) -> None:
        self.assertEqual(rules.find_basement_counts("192 BASEMENT PARKING"), [])
        self.assertEqual(rules.find_basement_counts("AREA 7.5 BASEMENT"), [])


class StoreyPhraseTest(unittest.TestCase):
    def test_numbers_and_words_before_storeys_or_floors(self) -> None:
        self.assertEqual(found(rules.find_storey_phrases, "a 3 storey building")[0][0], 3)
        self.assertEqual(found(rules.find_storey_phrases, "Fourteen storied block")[0][0], 14)
        self.assertEqual(found(rules.find_storey_phrases, "12 floors")[0][0], 12)

    def test_floor_plan_captions_are_not_a_count(self) -> None:
        self.assertEqual(rules.find_storey_phrases("2 FLOOR PLAN"), [])

    def test_hindi_storey_form(self) -> None:
        self.assertEqual(found(rules.find_storey_phrases, "14 मंजिला भवन")[0][0], 14)


class FloorLabelTest(unittest.TestCase):
    def test_ordinal_word_numeric_and_ranged_captions(self) -> None:
        self.assertEqual(found(rules.find_floor_labels, "SIXTH FL. BUILT UP AREA")[0][0], "SIXTH FL")
        self.assertEqual(found(rules.find_floor_labels, "3RD. TO 6TH. FLOOR PLAN BLOCK-A")[0][0],
                         "3RD. TO 6TH. FLOOR PLAN")

    def test_special_floor_kinds(self) -> None:
        kinds = {item["labelKind"] for text in ("BASEMENT FLOOR COVER", "STILT FLOOR", "PODIUM", "TERRACE FLOOR PLAN",
                                                "MEZZANINE", "REFUGE FLOOR", "GROUND FLOOR PLAN")
                 for item in rules.find_floor_labels(text)}
        self.assertEqual(kinds, {"basement", "stilt", "podium", "terrace", "mezzanine", "refuge", "ground"})

    def test_hindi_floor_labels(self) -> None:
        self.assertEqual(found(rules.find_floor_labels, "भूतल योजना")[0][0], "भूतल")
        self.assertEqual(found(rules.find_floor_labels, "प्रथम तल")[0][0], "प्रथम तल")


class UnitCountTest(unittest.TestCase):
    def test_count_before_noun_and_label_forms(self) -> None:
        self.assertEqual(found(rules.find_unit_counts, "TOTAL 81 UNITS")[0][0], 81)
        self.assertEqual(found(rules.find_unit_counts, "No. of Apartments : 85")[0][0], 85)
        self.assertEqual(found(rules.find_unit_counts, "Total flats 40")[0][0], 40)

    def test_area_figures_are_not_unit_counts(self) -> None:
        self.assertEqual(rules.find_unit_counts("707.05 sqm built up"), [])

    def test_units_per_floor_are_not_a_building_total(self) -> None:
        self.assertEqual(rules.find_unit_counts("TYP. 2 UNITS/FL."), [])
        self.assertEqual(rules.find_unit_counts("2 UNITS PER FLOOR"), [])


class FloorHeightTest(unittest.TestCase):
    def test_units_are_converted_in_code(self) -> None:
        metres = {item["valueLiteral"]: item["value"]
                  for text in ("floor to floor height 3.2 mtr", "storey height 3000 mm", "floor height 10 ft")
                  for item in rules.find_floor_heights(text)}
        self.assertEqual(metres, {"3.2": 3.2, "3000": 3.0, "10": 3.048})

    def test_missing_unit_stays_unit_unknown(self) -> None:
        item = rules.find_floor_heights("floor to floor height 3.2")[0]
        self.assertEqual((item["state"], item["value"]), ("unit_unknown", None))


class PageTileTest(unittest.TestCase):
    def test_tiles_cover_the_page_with_overlap(self) -> None:
        boxes = rules.tile_boxes(1100, 600)
        self.assertEqual(boxes[0], [0.0, 0.0, 500.0, 500.0])
        self.assertEqual(max(box[2] for box in boxes), 1100)
        self.assertEqual(max(box[3] for box in boxes), 600)
        self.assertLess(boxes[1][0], boxes[0][2])

    def test_words_on_one_row_are_joined(self) -> None:
        words = [{"text": "G", "box": [0, 0, 8, 10]}, {"text": "+41", "box": [10, 0, 30, 10]},
                 {"text": "FLOOR", "box": [0, 50, 40, 60]}]
        self.assertEqual([row["text"] for row in rules.join_rows(words)], ["G +41", "FLOOR"])


class NativeResolutionTileTest(unittest.TestCase):
    def test_pixel_tiles_stay_within_the_bound_and_overlap_by_a_tenth(self) -> None:
        scale = 300 / 72
        boxes = rules.pixel_tile_boxes(2592, 1744, scale)
        widths = [(box[2] - box[0]) * scale for box in boxes]
        self.assertLessEqual(max(widths), rules.TILE_PIXELS)
        self.assertAlmostEqual((boxes[0][2] - boxes[1][0]) / (boxes[0][2] - boxes[0][0]), 0.1, places=3)
        self.assertEqual((max(box[2] for box in boxes), max(box[3] for box in boxes)), (2592, 1744))

    def test_a_word_seen_by_two_tiles_keeps_the_higher_confidence(self) -> None:
        low = {"text": "G+4l", "box": [10, 10, 40, 20], "confidence": 71.0}
        high = {"text": "G+41", "box": [11, 10, 41, 20], "confidence": 93.0}
        apart = {"text": "G+41", "box": [100, 10, 130, 20], "confidence": 65.0}
        kept = rules.dedupe_words([low, high, apart])
        self.assertEqual(sorted(word["text"] for word in kept), ["G+41", "G+41"])
        self.assertIn(high, kept)

    def test_tile_words_are_boxed_in_page_points_and_weak_words_dropped(self) -> None:
        header = "\t".join(rules.TSV_COLUMNS)
        strong = "\t".join(["5", "1", "1", "1", "1", "1", "120", "60", "60", "30", "92.5", "B+G+6"])
        weak = "\t".join(["5", "1", "1", "1", "1", "2", "10", "10", "20", "20", "41.0", "noise"])
        pixmap = SimpleNamespace(x=300, y=600)
        words = rules.tile_words("\n".join([header, strong, weak]), pixmap, 2.0, (1000.0, 1000.0))
        self.assertEqual(words, [{"text": "B+G+6", "box": [210.0, 330.0, 240.0, 345.0], "confidence": 92.5}])


DEV_PLAN = Path("E:/BhuAayam-data/datasets/rera-storeys/RERAP01282025205138-1/sanctioned-building-plan.pdf")
DEV_PLAN_SHA256 = "b6f0178b9951b71fe68c9213efa15dedfa5bf7fa78ee0ce30c57515f6975e53d"
TESSERACT = Path("E:/BhuAayam-data/task-data/k2/tesseract-runtime-k2b/Library/bin/tesseract.exe")
TESSDATA = Path("E:/BhuAayam-data/runtime/ulpin-demo/tessdata-complete")
ASSETS_PRESENT = DEV_PLAN.is_file() and TESSERACT.is_file() and (TESSDATA / "eng.traineddata").is_file()


@unittest.skipUnless(ASSETS_PRESENT, "private development PDF and OCR assets are not on this machine")
class DevelopmentCropTest(unittest.TestCase):
    def test_a_300_dpi_tile_of_the_3d_apartment_plan_reads_its_storey_expression(self) -> None:
        import fitz

        self.assertEqual(rules.digest(DEV_PLAN), DEV_PLAN_SHA256)
        with tempfile.TemporaryDirectory() as folder, fitz.open(DEV_PLAN) as document:
            page = document[4]
            dpi = rules.scan_dpi(page)
            scale = dpi / rules.PDF_POINTS_PER_INCH
            job = {"scale": scale, "tesseract": TESSERACT, "tessdata": TESSDATA, "folder": Path(folder),
                   "number": 5, "page_size": (page.rect.width, page.rect.height)}
            box = rules.pixel_tile_boxes(page.rect.width, page.rect.height, scale)[37]
            tile, words = rules.ocr_scan_tile(job, page, box, 37)
        found = [item["value"] for row in rules.join_rows(rules.dedupe_words(words))
                 for item in rules.find_floor_expressions(row["text"])]
        self.assertEqual((tile["status"], dpi), ("complete", 300.0))
        self.assertIn("B+G+6", found)


if __name__ == "__main__":
    unittest.main()
