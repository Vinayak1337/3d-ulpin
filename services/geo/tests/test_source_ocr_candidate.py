"""Focused source-frame and output-limit regressions for the optional OCR adapter."""

from __future__ import annotations

import tempfile
import hashlib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import fitz

from geo.usp_document_candidates.docling_tesseract import (
    MAX_RESULT_BYTES, SourceOcrError, _selection, collect_items,
    encode_result_bounded, source_page_box, collect_tsv_items, render_pdf_selection,
)


class SourceOcrCandidateTests(unittest.TestCase):
    def test_large_page_requires_bounded_crop_and_preserves_source_affine(self) -> None:
        page = SimpleNamespace(rect=fitz.Rect(0, 0, 6000, 8000), rotation=0)
        region = [4800.25, 6500.125, 5100.75, 6600.875]
        self.assertEqual(_selection(page, region)[1], region)
        with self.assertRaisesRegex(SourceOcrError, "unsupported_pdf_page_frame"):
            _selection(page, None)
        # Exact source/crop profile boundaries, invalid input and out-of-page
        # requests must reject before get_pixmap, regardless of output scaling.
        _selection(SimpleNamespace(rect=fitz.Rect(0, 0, 14400, 14400), rotation=0), [12400, 12400, 14400, 14400])
        for box, code in (([0, 0, 2001, 10], "region_side_limit_exceeded"),
                          ([0, 0, 10, 2001], "region_side_limit_exceeded"),
                          ([5990, 0, 6010, 10], "region_outside_supported_page"),
                          ([0, 0, 0.5, 10], "region_outside_supported_page"),
                          ([0, 0, float("nan"), 10], "invalid_region"),
                          ([0, False, 10, 10], "invalid_region")):
            with self.subTest(box=box), self.assertRaisesRegex(SourceOcrError, code):
                _selection(page, box)
        for rect, rotation in ((fitz.Rect(0, 0, 14401, 8000), 0),
                               (fitz.Rect(1, 0, 6000, 8000), 0),
                               (fitz.Rect(0, 0, 6000, 8000), 90),
                               (fitz.Rect(0, 0, 0, 8000), 0)):
            with self.subTest(rect=rect, rotation=rotation), self.assertRaisesRegex(SourceOcrError, "unsupported_pdf_page_frame"):
                _selection(SimpleNamespace(rect=rect, rotation=rotation), region)
        _selection(SimpleNamespace(rect=fitz.Rect(0, 0, 2000, 2000), rotation=0), None)
        # This blank technical-control PDF is not a source record or OCR label.
        # Render a fractional-offset crop to exercise real MuPDF pixel rounding.
        with tempfile.TemporaryDirectory() as directory:
            source, png = Path(directory)/"control.pdf", Path(directory)/"crop.png"
            with fitz.open() as document:
                document.new_page(width=6000, height=8000)
                document.save(source)
            frame = render_pdf_selection(source, hashlib.sha256(source.read_bytes()).hexdigest(), 1, region, png)
            self.assertEqual(frame["pageFrame"]["width"], 6000)
            self.assertEqual(frame["pageFrame"]["height"], 8000)
            self.assertEqual(frame["regionKind"], "selected_region")
            self.assertEqual(frame["requestedRegion"], region)
            render = frame["render"]
            self.assertLessEqual(max(render["pixels"]), 1400)
            self.assertLessEqual(render["pixels"][0]*render["pixels"][1], 1_600_000)
            dpi_x, dpi_y = render["dpi"]
            pixel_box = [10, 10, 100, 25]
            box = SimpleNamespace(l=10*72/dpi_x, t=10*72/dpi_y, r=100*72/dpi_x,
                                  b=25*72/dpi_y, coord_origin="TOPLEFT")
            cited = source_page_box(box, frame)["box"]
            sx, sy = render["pixelOrigin"]
            roundtrip = [cited[0]*render["scale"]-sx, cited[1]*render["scale"]-sy,
                         cited[2]*render["scale"]-sx, cited[3]*render["scale"]-sy]
            for actual, expected in zip(roundtrip, pixel_box):
                self.assertAlmostEqual(actual, expected, places=8)
            self.assertGreaterEqual(cited[0], region[0])
            self.assertGreaterEqual(cited[1], region[1])
            self.assertLessEqual(cited[2], region[2])
            self.assertLessEqual(cited[3], region[3])

    def test_sparse_tsv_keeps_literal_words_and_maps_pixels_without_docling_dpi(self) -> None:
        header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
        tsv = header + (
            "5\t1\t1\t1\t1\t1\t137\t18\t40\t16\t90\t001\n"
            "5\t1\t1\t1\t1\t2\t180\t18\t50\t16\t88\tTITLE\n"
            "5\t1\t2\t1\t1\t1\t0\t0\t10\t10\t12\tnoise\n"
            "5\t2\t3\t1\t1\t1\t0\t0\t10\t10\t95\twrong-page\n")
        frame = {"pageNumber": 3, "pageFrame": {"width": 1190.37, "height": 1495},
                 "render": {"scale": 3.0, "pixelOrigin": [321,156], "pixels": [1072,181]}}
        items, issues, partial = collect_tsv_items(tsv, frame, 64)
        self.assertEqual([i["text"] for i in items], ["001 TITLE"])
        cite = items[0]["sourcePageBoxes"][0]
        self.assertEqual(cite["pageNumber"], 3)
        self.assertEqual(cite["derivedFrom"], "tesseract_tsv_pixels_via_mupdf_pixel_origin")
        self.assertEqual(cite["box"], [458/3,174/3,551/3,190/3])
        self.assertEqual(issues, ["low_confidence_words_withheld", "invalid_tesseract_word_withheld"])
        self.assertTrue(partial)
        empty, empty_issues, empty_partial = collect_tsv_items(header, frame, 64)
        self.assertEqual(empty, [])
        self.assertIn("no_ocr_text_emitted", empty_issues)
        self.assertTrue(empty_partial)

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
