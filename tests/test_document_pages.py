"""Technical control for PDF external-file denial; no invented PDF/property data."""
import importlib.util
from pathlib import Path
import unittest

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
