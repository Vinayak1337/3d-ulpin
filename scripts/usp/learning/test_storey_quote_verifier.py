"""Quote verifier: a quote is kept only at its own page and region; stdlib only."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import storey_quote_verifier as verifier  # noqa: E402

SHA = "a" * 64


def store() -> dict:
    page_one = {"lines": [{"id": "p1-l0", "text": "T-3  G+41", "box": [10, 10, 80, 20]},
                          {"id": "p1-l1", "text": "No. of Apartments : 81", "box": [10, 100, 200, 110]}]}
    page_two = {"lines": [{"id": "p2-l0", "text": "G + 42", "box": [10, 10, 60, 20]}]}
    return {"schemaVersion": "storey-pages/1", "source": {"sha256": SHA}, "pages": {"1": page_one, "2": page_two}}


def item(quote: str, page: int, bbox: list[float] | None, value: object, literal: object = None) -> dict:
    locator = {"page": page, "bbox": bbox}
    found = {"quote": quote, "locator": locator, "value": value, "sourceSha256": SHA}
    return {**found, "valueLiteral": literal} if literal is not None else found


class QuoteVerifierTest(unittest.TestCase):
    def test_quote_at_its_locator_is_kept(self) -> None:
        kept, dropped = verifier.filter_verified(store(), [item("G+41", 1, [10, 10, 80, 20], "G+41")])
        self.assertEqual(len(kept), 1)
        self.assertEqual(dropped, [])

    def test_quote_shifted_to_another_page_is_dropped(self) -> None:
        kept, dropped = verifier.filter_verified(store(), [item("G+41", 2, [10, 10, 60, 20], "G+41")])
        self.assertEqual(kept, [])
        self.assertEqual(dropped[0]["dropCodes"], [verifier.QUOTE_NOT_AT_LOCATOR])

    def test_quote_in_the_page_but_outside_its_region_is_dropped(self) -> None:
        shifted = item("G+41", 1, [10, 100, 200, 110], "G+41")
        self.assertEqual(verifier.verify_item(store(), shifted), [verifier.QUOTE_NOT_AT_LOCATOR])

    def test_whitespace_and_unicode_width_do_not_break_a_match(self) -> None:
        wide = item("T-3 G＋41", 1, [10, 10, 80, 20], "G+41")
        self.assertEqual(verifier.verify_item(store(), wide), [])

    def test_number_missing_from_its_quote_is_dropped(self) -> None:
        wrong = item("No. of Apartments", 1, [10, 100, 200, 110], 81)
        self.assertEqual(verifier.verify_item(store(), wrong), [verifier.VALUE_NOT_IN_QUOTE])

    def test_value_literal_is_checked_instead_of_a_converted_value(self) -> None:
        converted = item("No. of Apartments : 81", 1, [10, 100, 200, 110], 81.0, literal="81")
        self.assertEqual(verifier.verify_item(store(), converted), [])

    def test_unknown_page_and_foreign_source_are_dropped(self) -> None:
        missing = item("G+41", 9, None, "G+41")
        foreign = {**item("G+41", 1, None, "G+41"), "sourceSha256": "b" * 64}
        self.assertEqual(verifier.verify_item(store(), missing), [verifier.QUOTE_NOT_AT_LOCATOR])
        self.assertEqual(verifier.verify_item(store(), foreign), [verifier.QUOTE_NOT_AT_LOCATOR])

    def test_cited_box_is_read_within_the_stored_regions_own_stated_edge_only(self) -> None:
        # Numbers of the retained site plan OCR result (K9d): its region, its render scale, one of its boxes.
        region, scale = [280, 860, 960, 2580], 0.813953488372093
        overhanging = [278.8857142857143, 1117.2131, 293.63041428571427, 1174.5536]
        further = [278.7, *overhanging[1:]]

        def read(bbox: list[float], edge: dict | None) -> str | None:
            page = {"lines": [{"id": "l0", "text": "a", "box": overhanging}], "storedRegion": region}
            if edge:
                page["regionEdge"] = edge
            return verifier.region_text({"source": {"sha256": SHA}, "pages": {"1": page}}, 1, bbox)

        stated = {"renderScalePxPerPt": scale}
        self.assertEqual(read(overhanging, stated), "a")
        self.assertIsNone(read(overhanging, None))
        self.assertIsNone(read(further, stated))
        self.assertIsNone(read(None, stated))
        self.assertEqual(read([300, 1117.2131, 340, 1174.5536], None), "")


if __name__ == "__main__":
    unittest.main()
