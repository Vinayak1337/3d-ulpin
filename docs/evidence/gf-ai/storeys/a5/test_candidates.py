"""Candidate assembly: two different printed storey values become a conflict, never a pick."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import candidates  # noqa: E402

SHA = "a" * 64
SOURCES = {SHA: "source-1"}
FRAME = {"kind": "pdf_display_page_top_left_points", "rotation": 0, "width": 1000.0, "height": 800.0}


def item(value: str, line: int, field: str = "floorExpression") -> dict:
    text = f"T-3 {value}"
    locator = {"page": 1, "bbox": [10.0, 10.0 * line, 90.0, 10.0 * line + 8], "lineId": f"p1-l{line}",
               "textSpan": [4, len(text)]}
    return {"field": field, "value": value, "valueLiteral": value, "quote": value, "locator": locator,
            "sourceSha256": SHA, "method": "deterministic:storey-rules@1", "state": "candidate"}


def store(values: list[str]) -> dict:
    lines = [{"id": f"p1-l{n}", "text": f"T-3 {value}", "box": [10.0, 10.0 * n, 90.0, 10.0 * n + 8]}
             for n, value in enumerate(values, 1)]
    return {"source": {"sha256": SHA, "bytes": 10, "path": "unused.pdf"}, "pages": {"1": {"lines": lines}}}


class StoreyAlternativesTest(unittest.TestCase):
    def test_two_values_are_a_conflict_with_no_chosen_value(self) -> None:
        items = [item("G+41", 1), item("G+42", 2), item("G+42", 3)]
        alternatives, other = candidates.storey_alternatives(items, SOURCES)
        self.assertEqual([entry["value"] for entry in alternatives], ["G+41", "G+42"])
        self.assertEqual(len(alternatives[1]["citations"]), 2)
        self.assertEqual((candidates.storey_state(alternatives), other), ("conflicting", []))

    def test_one_value_is_a_candidate_and_none_abstains(self) -> None:
        alternatives, _ = candidates.storey_alternatives([item("G+42", 1)], SOURCES)
        self.assertEqual(candidates.storey_state(alternatives), "candidate")
        self.assertEqual(candidates.storey_state([]), "abstained")

    def test_a_phrase_count_next_to_an_expression_stays_a_separate_statement(self) -> None:
        items = [item("G+42", 1), item("14", 2, "storeyCount")]
        alternatives, other = candidates.storey_alternatives(items, SOURCES)
        self.assertEqual([entry["value"] for entry in alternatives], ["G+42"])
        self.assertEqual([entry["value"] for entry in other], ["14"])


class PacketTest(unittest.TestCase):
    def test_a_conflict_names_one_proposal_per_value(self) -> None:
        items = [item("G+41", 1), item("G+42", 2), item("G+42", 3)]
        with mock.patch.object(candidates, "page_frame", return_value=FRAME):
            packet = candidates.packet_for(items, store(["G+41", "G+42", "G+42"]), "floorExpression")
        self.assertEqual(len(packet["proposals"]), 3)
        self.assertEqual(packet["conflicts"][0]["proposalIds"], ["p1", "p2"])
        self.assertEqual(packet["proposals"][0]["quoteCharacterSpan"], [4, 8])


if __name__ == "__main__":
    unittest.main()
