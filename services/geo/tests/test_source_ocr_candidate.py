"""Focused source-frame and output-limit regressions for the optional OCR adapter."""

from __future__ import annotations

import tempfile
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import fitz

from geo.usp_document_candidates.docling_tesseract import (
    MAX_RESULT_BYTES, SourceOcrError, _selection, collect_items,
    encode_result_bounded, source_page_box,
)


class SourceOcrCandidateTests(unittest.TestCase):
    def test_crop_box_maps_to_original_page_and_rejects_unknown_origin(self) -> None:
        # Geometry from the retained page-1 heading crop and its actual PNG DPI.
        crop_height = 181 * 72 / 96.012
        frame = {
            "pageNumber": 1,
            "pageFrame": {"width": 1190.37, "height": 1495.0},
            "render": {"scale": 3.0, "pixelOrigin": [321, 156],
                       "dpi": [96.012, 96.012],
                       "doclingPagePoints": [1072 * 72 / 96.012, crop_height]},
        }
        bottom_left = SimpleNamespace(l=137.0, t=crop_height - 18.0, r=335.0,
                                      b=crop_height - 34.0, coord_origin="BOTTOMLEFT")
        mapped = source_page_box(bottom_left, frame)
        self.assertEqual(mapped["pageNumber"], 1)
        self.assertEqual(mapped["frame"], "pdf_display_page_top_left_points")
        for actual, expected in zip(mapped["box"], (167.9, 60.0, 255.89, 67.11)):
            self.assertAlmostEqual(actual, expected, delta=0.06)
        top_left = SimpleNamespace(l=137.0, t=18.0, r=335.0, b=34.0,
                                   coord_origin="TOPLEFT")
        self.assertEqual(source_page_box(top_left, frame)["box"], mapped["box"])
        with self.assertRaisesRegex(SourceOcrError, "unsupported_ocr_box_origin"):
            source_page_box(SimpleNamespace(l=0, t=0, r=1, b=1,
                                            coord_origin="UNKNOWN"), frame)
        with self.assertRaisesRegex(SourceOcrError, "unsupported_pdf_page_frame"):
            _selection(SimpleNamespace(rect=fitz.Rect(0, 0, 100, 100), rotation=90), None)

        prov = SimpleNamespace(page_no=1, bbox=bottom_left)
        entries = [(SimpleNamespace(text=value, label="text", prov=[prov]), 0)
                   for value in ("first", "second")]
        document = SimpleNamespace(iterate_items=lambda: iter(entries))
        items, issues, partial = collect_items(SimpleNamespace(document=document), frame, 1)
        self.assertEqual([item["text"] for item in items], ["first"])
        self.assertEqual(issues, ["item_limit_reached"])
        self.assertTrue(partial)

    def test_result_bytes_are_capped_before_parent_json_read(self) -> None:
        with self.assertRaisesRegex(SourceOcrError, "result_byte_limit_exceeded"):
            encode_result_bounded({"text": "A" * MAX_RESULT_BYTES})
        from importlib.util import module_from_spec, spec_from_file_location

        runner = Path(__file__).resolve().parents[3] / "scripts/usp/document-models/run_source_ocr.py"
        spec = spec_from_file_location("run_source_ocr_test", runner)
        assert spec is not None and spec.loader is not None
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            oversized = Path(directory) / "result.json"
            oversized.write_bytes(b"{" + b" " * MAX_RESULT_BYTES)
            self.assertEqual(module._read_bounded_result(oversized),
                             (None, "over_byte_limit"))

    def test_supervised_log_file_stops_at_byte_limit(self) -> None:
        from importlib.util import module_from_spec, spec_from_file_location

        runner = Path(__file__).resolve().parents[3] / "scripts/usp/document-models/run_source_ocr.py"
        spec = spec_from_file_location("run_source_ocr_log_test", runner)
        assert spec is not None and spec.loader is not None
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "loud_worker.py"
            script.write_text("print('x' * 100000)\n", encoding="utf-8")
            log = Path(directory) / "worker.log"
            observed = module._run_worker([sys.executable, str(script)], log, 30,
                                          128 * 1024**2, max_log_bytes=32)
            self.assertEqual(log.stat().st_size, 32)
            self.assertTrue(observed["logTruncated"])
            self.assertEqual(observed["stopReason"], "log_byte_limit_exceeded")


if __name__ == "__main__":
    unittest.main()
