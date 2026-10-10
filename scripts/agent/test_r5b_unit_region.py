"""The UNIT-3B control and the UNIT-3A refusal on the retained sheet; no record, request or saved picture."""
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

    def test_unit_3a_is_refused_because_its_frame_is_two_ink_groups(self) -> None:
        result = MODULE.measure(self.page, MODULE.SEEDS["UNIT-3A"], MODULE.INK_BELOW)
        self.assertEqual(result["reason"], "LABEL_FRAME_IS_NOT_ONE_INK_GROUP")
        self.assertEqual(len(result["inkGroupsPt"]), 2)
        self.assertNotIn("regionPt", result)

    def test_an_unboxed_room_name_has_no_label_frame(self) -> None:
        result = MODULE.measure(self.page, (619, 418), MODULE.INK_BELOW)
        self.assertEqual(result["reason"], "NO_LABEL_FRAME_AT_SEED")


if __name__ == "__main__":
    unittest.main()
