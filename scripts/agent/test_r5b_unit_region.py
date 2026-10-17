"""The UNIT-3B control, the lead's two coded rules and the UNIT-3A candidate; no record, request or picture."""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from typing import Any


def helper() -> Any:
    path = Path(__file__).with_name("r5b-unit-region.py")
    spec = importlib.util.spec_from_file_location("r5b_unit_region", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULE = helper()
HAS_SHEET = MODULE.SOURCE.is_file() and importlib.util.find_spec("fitz") is not None
PICTURE = [
    "##########",
    "#........#",
    "#.##.##..#",
    "#.##.##..#",
    "#........#",
    "##########",
]


def mask(rows: list[str]) -> list[list[bool]]:
    return [[mark == "#" for mark in row] for row in rows]


class FrameGroups(unittest.TestCase):
    def test_the_frame_is_chosen_and_not_the_character_under_the_seed(self) -> None:
        boxes = MODULE.ink_boxes(mask(PICTURE))
        self.assertEqual(MODULE.frame_groups(boxes, (2, 2)), [(0, 0, 10, 6)])

    def test_a_frame_broken_in_two_gives_two_groups(self) -> None:
        broken = [PICTURE[0][:7] + "." + PICTURE[0][8:], *PICTURE[1:5], PICTURE[5][:2] + "." + PICTURE[5][3:]]
        groups = MODULE.frame_groups(MODULE.ink_boxes(mask(broken)), (4, 2))
        self.assertEqual(sorted(groups), [(0, 0, 7, 6), (3, 0, 10, 6)])


class LeadDecisions(unittest.TestCase):
    broken = [(0.0, 0.0, 7.0, 6.0), (3.0, 0.0, 10.0, 6.0)]
    ink = (10.0, 10.0, 47.0, 20.0)

    def test_d1_a_broken_frame_of_the_control_size_is_one_label(self) -> None:
        self.assertTrue(MODULE.one_label(self.broken, (10.0, 6.0)))
        self.assertTrue(MODULE.one_label(self.broken, (10.5, 5.5)))

    def test_d1_overlapping_groups_of_another_size_are_not_one_label(self) -> None:
        self.assertFalse(MODULE.one_label(self.broken, (10.75, 6.0)))
        self.assertFalse(MODULE.one_label(self.broken, (10.0, 7.0)))

    def test_d1_groups_of_the_control_size_that_do_not_overlap_are_not_one_label(self) -> None:
        apart = [(0.0, 0.0, 4.0, 6.0), (6.0, 0.0, 10.0, 6.0)]
        self.assertFalse(MODULE.one_label(apart, (10.0, 6.0)))

    def test_d3_a_nearer_mark_reduces_the_margin_on_its_side_only(self) -> None:
        margins = MODULE.clear_margins(self.ink, [(30.0, 24.0, 30.25, 24.25)])
        self.assertEqual(margins, (5.0, 5.0, 6.0, 4.0))
        self.assertIsNone(MODULE.refusal(margins, None))

    def test_d3_a_margin_under_the_floor_is_refused(self) -> None:
        margins = MODULE.clear_margins(self.ink, [(30.0, 22.75, 30.25, 23.0)])
        self.assertEqual(margins, (5.0, 5.0, 6.0, 2.75))
        self.assertEqual(MODULE.refusal(margins, None), "MARGIN_UNDER_THE_FLOOR")

    def test_d3_a_mark_at_a_corner_reduces_no_margin_and_stays_a_stray(self) -> None:
        corner = (50.0, 23.0, 50.25, 23.25)
        margins = MODULE.clear_margins(self.ink, [corner])
        self.assertEqual(margins, MODULE.K4C_MARGINS_PT)
        self.assertEqual(MODULE.refusal(margins, corner), "OTHER_INK_IN_REGION")


@unittest.skipUnless(HAS_SHEET, "The retained Tower 3 sheet and PyMuPDF are outside Git")
class RetainedSheet(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.document = MODULE.open_sheet()
        cls.page = cls.document[0]

    @classmethod
    def tearDownClass(cls) -> None:
        cls.document.close()

    def test_control_reproduces_the_recorded_unit_3b_region_exactly(self) -> None:
        result = MODULE.control(self.page, MODULE.INK_BELOW)
        self.assertEqual(result["measured"]["regionPt"], [596.0, 390.0, 644.0, 409.0])
        self.assertTrue(result["cropSameAsK4c"] and result["matches"])

    def test_without_the_decisions_unit_3a_is_refused_because_its_frame_is_two_ink_groups(self) -> None:
        result = MODULE.measure(self.page, MODULE.SEEDS["UNIT-3A"], MODULE.INK_BELOW)
        self.assertEqual(result["reason"], "LABEL_FRAME_IS_NOT_ONE_INK_GROUP")
        self.assertEqual(len(result["inkGroupsPt"]), 2)
        self.assertNotIn("regionPt", result)

    def test_under_the_decisions_unit_3a_is_a_region_with_one_reduced_margin(self) -> None:
        control = MODULE.control(self.page, MODULE.INK_BELOW)["measured"]["inkBoxPt"]
        result = MODULE.measure(self.page, MODULE.SEEDS["UNIT-3A"], MODULE.INK_BELOW, MODULE.size(tuple(control)))
        self.assertIsNone(result["reason"])
        self.assertEqual(result["regionPt"], [1077.5, 395.75, 1125.75, 414.75])
        self.assertEqual(result["marginsPt"], [5.0, 5.0, 6.0, 4.0])
        self.assertEqual([(made["id"], made["appliedTo"]) for made in result["decisions"]],
                         [("D1", "frame groups"), ("D2", "ink level"), ("D3", "bottom margin")])

    def test_an_unboxed_room_name_has_no_label_frame(self) -> None:
        result = MODULE.measure(self.page, (619, 418), MODULE.INK_BELOW)
        self.assertEqual(result["reason"], "NO_LABEL_FRAME_AT_SEED")


if __name__ == "__main__":
    unittest.main()
