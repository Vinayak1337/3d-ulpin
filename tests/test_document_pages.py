"""Technical control for PDF external-file denial; no invented PDF/property data."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

import fitz

helper = Path(__file__).resolve().parents[1] / "scripts/usp/document-models/run_pdf_pages.py"
spec = importlib.util.spec_from_file_location("page_helper", helper)
pages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pages)


class DocumentControl:
    def __init__(self, entries):
        self.entries = entries

    def xref_length(self):
        return 2

    def xref_get_key(self, xref, key):
        return self.entries.get((xref, key), ("null", "null"))

    def xref_is_stream(self, xref):
        return self.entries.get((xref, "_stream"), False)


class ExternalFileControls(unittest.TestCase):
    def test_external_stream_reference_and_script_cannot_reach_renderer(self):
        for entry in ({(1, "F"): ("string", "private-file"), (1, "_stream"): True},
                      {(1, "Ref/F"): ("xref", "2 0 R")},
                      {(1, "S"): ("name", "/JavaScript")}):
            with self.assertRaisesRegex(pages.PageError, "EXTERNAL_RESOURCE_UNSUPPORTED"):
                pages._deny_external_files(DocumentControl(entry))

    def test_inert_uri_and_numeric_annotation_flags_are_not_file_reads(self):
        pages._deny_external_files(DocumentControl({(1, "F"): ("int", "4"), (1, "S"): ("name", "/URI")}))
        pages._deny_external_files(DocumentControl({(1, "F"): ("xref", "2 0 R")}))
        pages._deny_external_files(DocumentControl({(1, "Type"): ("name", "/Filespec"), (1, "F"): ("string", "inert attachment name")}))
        with self.assertRaisesRegex(pages.PageError, "DOCUMENT_PAGES_ENCRYPTED"):
            pages._deny_external_files(DocumentControl({(-1, "Encrypt"): ("xref", "2 0 R")}))


if __name__ == "__main__":
    unittest.main()


class WholePageViewing(unittest.TestCase):
    def control(self, folder: Path, name: str, width: float, height: float):
        # Technical control with one drawn line; not a source record.
        with fitz.open() as document:
            document.new_page(width=width, height=height).insert_text((72, 72), "technical control")
            document.save(folder / name)
        return folder / name, hashlib.sha256((folder / name).read_bytes()).hexdigest()

    def info(self, width: float, height: float, support: str) -> dict:
        return {"page": 1, "label": "Page 1", "sourceLabel": None,
                "frame": {"kind": "pdf_display_page_top_left_points", "rotation": 0,
                          "width": float(width), "height": float(height)},
                "mediaBox": [0.0, 0.0, float(width), float(height)],
                "cropBox": [0.0, 0.0, float(width), float(height)],
                "boxConvention": "pymupdf_page_rectangles/1", "renderSupport": support}

    def test_page_within_the_limit_answers_with_exactly_the_fields_it_had(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source, digest = self.control(folder, "within.pdf", 595, 842)
            self.assertEqual(pages.inspect_pages(source, digest, 0, 25, None, folder)["pages"],
                             [self.info(595, 842, "supported")])
            drawn = pages.inspect_pages(source, digest, 0, 25, 1, folder)
            self.assertEqual(sorted(drawn["render"]), ["bytes", "dpi", "page", "pixelOrigin", "pixels",
                                                        "scale", "sha256"])
            self.assertEqual(drawn["render"]["pixels"], [990, 1400])

    def test_page_over_the_limit_is_listed_and_drawn_whole_as_reduced(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source, digest = self.control(folder, "over.pdf", 2586, 1695)
            reduced = {**self.info(2586, 1695, "reduced"), "reducedScalePxPerPt": 1400 / 2586}
            self.assertEqual(pages.inspect_pages(source, digest, 0, 25, None, folder)["pages"], [reduced])
            drawn = pages.inspect_pages(source, digest, 0, 25, 1, folder)
            self.assertEqual(drawn["pages"], [reduced])
            render = drawn["render"]
            self.assertIs(render["reduced"], True)
            self.assertEqual(render["scale"], reduced["reducedScalePxPerPt"])
            self.assertEqual(render["pixels"], [1400, 918])
            self.assertEqual(hashlib.sha256((folder / "page.png").read_bytes()).hexdigest(), render["sha256"])

    def test_page_beyond_the_legibility_floor_keeps_the_refusal_by_name(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source, digest = self.control(folder, "beyond.pdf", 4000, 4000)
            self.assertEqual(pages.inspect_pages(source, digest, 0, 25, None, folder)["pages"],
                             [self.info(4000, 4000, "unsupported")])
            with self.assertRaisesRegex(pages.PageError, "^DOCUMENT_PAGES_RENDER_PROFILE_UNSUPPORTED$"):
                pages.inspect_pages(source, digest, 0, 25, 1, folder)
            self.assertFalse((folder / "page.png").exists())

    def test_only_the_pages_read_asks_for_a_viewing_picture(self):
        # The reduced picture reaches no OCR, measurement, packet or candidate path: no other product
        # file passes the argument. The renderer's own use is the listing's scale, which draws nothing.
        root = helper.parents[3]
        product = [*(root / "scripts").rglob("*.py"), *(root / "services" / "geo" / "geo").rglob("*.py")]
        asking = sorted(path.relative_to(root).as_posix() for path in product
                        if "viewing=True" in path.read_text(encoding="utf-8"))
        self.assertEqual(asking, ["scripts/usp/document-models/run_pdf_pages.py",
                                  "services/geo/geo/usp_document_candidates/docling_tesseract.py"])
