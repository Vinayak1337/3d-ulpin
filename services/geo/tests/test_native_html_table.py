"""HTML cells keep source positions and never multiply merged or nested literals."""

import base64
import hashlib
import unittest
from typing import Any

from geo.area import extract_document
from geo.native_html_table import MAX_TABLES, extract_native_html_tables
from geo.native_workbook import MAX_CELL_CHARS, MAX_CELLS, MAX_TEXT_CHARS
from geo.validation import InputError


def read_html(document: str) -> dict[str, Any]:
    return extract_native_html_tables(document.encode("utf-8"))


class NativeHtmlTableTest(unittest.TestCase):
    def test_simple_table_keeps_cell_contract_and_empty_states(self) -> None:
        document = "<table><tr><th> Name </th><th>Area</th></tr><tr><td> A  &amp; B<br>12 </td><td></td>"
        document += "</tr><tr><td> \t&nbsp; </td></tr></table>"
        result = read_html(document)
        self.assertEqual((result["format"], result["method"], result["status"], result["code"]),
                         ("html", "native_reference", "ready", None))
        self.assertEqual([part["text"] for part in result["parts"]], ["Name", "Area", "A & B\n12", "", ""])
        self.assertEqual([part["id"] for part in result["parts"]], [f"part-{index}" for index in range(1, 6)])
        locators = [part["locator"] for part in result["parts"]]
        self.assertEqual(locators[0], {
            "sheet": "table-1", "sheetIndex": 1, "caption": None, "cell": "A1", "row": 1, "column": 1,
            "cellState": "literal", "cellType": "header", "label": "HTML table 1 (table-1), cell A1",
        })
        self.assertEqual([locator["cell"] for locator in locators], ["A1", "B1", "A2", "B2", "A3"])
        self.assertEqual([locator["cellState"] for locator in locators[-2:]], ["empty_string", "whitespace"])
        self.assertEqual(locators[2]["cellType"], "data")
        self.assertEqual(result["characterCount"], sum(len(part["text"]) for part in result["parts"]))
        raw = document.encode("utf-8")
        dispatched = extract_document({"format": "html", "base64": base64.b64encode(raw).decode("ascii")})
        self.assertEqual(dispatched.pop("sourceSha256"), hashlib.sha256(raw).hexdigest())
        self.assertEqual(dispatched, result)

    def test_rowspan_and_colspan_cover_positions_without_repeating_literals(self) -> None:
        result = read_html("<table><tr><th rowspan='2' colspan='2'>Group</th><th>Unit</th></tr>"
                           "<tr><td>Source</td></tr></table>")
        cells = {part["locator"]["cell"]: part for part in result["parts"]}
        self.assertEqual(list(cells), ["A1", "B1", "C1", "A2", "B2", "C2"])
        self.assertEqual(cells["A1"]["text"], "Group")
        self.assertEqual(cells["C2"]["text"], "Source")
        for ref in ("B1", "A2", "B2"):
            self.assertEqual(cells[ref]["text"], "")
            self.assertEqual(cells[ref]["locator"]["cellState"], "spanned")
            self.assertEqual(cells[ref]["locator"]["spanOf"], "A1")
        self.assertNotIn("spanOf", cells["A1"]["locator"])

    def test_two_tables_use_caption_or_nearest_preceding_heading(self) -> None:
        result = read_html("<h2> Earlier </h2><h3> Building <em>details</em> </h3>"
                           "<table><caption>Explicit &amp; caption</caption><tr><td>First</td></tr></table>"
                           "<h2> Registered projects </h2><table><tr><td>Second</td></tr></table>")
        first, second = result["parts"]
        self.assertEqual((first["locator"]["sheet"], first["locator"]["sheetIndex"]), ("table-1", 1))
        self.assertEqual(first["locator"]["caption"], "Explicit & caption")
        self.assertEqual((second["locator"]["sheet"], second["locator"]["sheetIndex"]), ("table-2", 2))
        self.assertEqual(second["locator"]["caption"], "Registered projects")
        self.assertEqual([part["id"] for part in result["parts"]], ["part-1", "part-2"])

    def test_nested_table_has_its_own_sheet_and_no_duplicated_cell_text(self) -> None:
        result = read_html("<table><tr><td>Before <table><tr><th>Inner</th></tr><tr><td>Value</td></tr>"
                           "</table> After</td><td>Outer</td></tr></table>")
        outer, sibling, inner_header, inner_data = result["parts"]
        self.assertEqual(outer["text"], "Before After")
        self.assertEqual(outer["locator"]["cellState"], "nested_table")
        self.assertEqual(outer["locator"]["nestedSheet"], "table-2")
        self.assertEqual((sibling["text"], sibling["locator"]["cell"]), ("Outer", "B1"))
        self.assertEqual(inner_header["locator"]["sheet"], "table-2")
        self.assertEqual((inner_header["text"], inner_data["text"]), ("Inner", "Value"))
        self.assertEqual(inner_data["locator"]["cell"], "A2")

    def test_script_style_comments_and_hidden_input_are_not_cell_text(self) -> None:
        result = read_html("<script>const fake = '<table><tr><td>Fake</td></tr></table>';</script>"
                           "<table><tr><td>Shown <script>secret()</script><style>.x { color: red; }</style>"
                           "<input type='hidden' value='private'><!-- hidden --> End</td></tr></table>")
        self.assertEqual(len(result["parts"]), 1)
        self.assertEqual(result["parts"][0]["text"], "Shown End")

    def test_no_tables_is_explicitly_unsupported(self) -> None:
        result = read_html("<h1>A document</h1><p>No tabular source elements.</p>")
        self.assertEqual((result["status"], result["code"]), ("unsupported", "HTML_NO_TABLES"))
        self.assertEqual(result["parts"], [])
        self.assertEqual(result["characterCount"], 0)
        self.assertTrue(result["warnings"])

    def test_non_utf8_without_charset_is_rejected(self) -> None:
        with self.assertRaisesRegex(InputError, "NATIVE_HTML_ENCODING_UNSUPPORTED"):
            extract_native_html_tables(b"<table><tr><td>caf\xe9</td></tr></table>")

    def test_declared_charset_and_bom_decode_without_replacement(self) -> None:
        document = "<table><tr><td>caf\u00e9</td></tr></table>"
        declared = ('<meta charset="windows-1252">' + document).encode("windows-1252")
        self.assertEqual(extract_native_html_tables(declared)["parts"][0]["text"], "caf\u00e9")
        legacy = ('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">' + document)
        self.assertEqual(extract_native_html_tables(legacy.encode("iso-8859-1"))["parts"][0]["text"], "caf\u00e9")
        conflicting = '<meta charset="windows-1252"><table><tr><td>\u092d\u0942\u092e\u093f</td></tr></table>'
        self.assertEqual(extract_native_html_tables(conflicting.encode("utf-16"))["parts"][0]["text"],
                         "\u092d\u0942\u092e\u093f")

    def test_limits_reject_excess_tables_cells_and_characters(self) -> None:
        documents = [
            "<table></table>" * (MAX_TABLES + 1),
            "<table><tr>" + "<td></td>" * (MAX_CELLS + 1) + "</tr></table>",
            "<table><tr><td colspan='2001'>One</td></tr></table>",
            "<table><tr><td>" + "x" * (MAX_CELL_CHARS + 1) + "</td></tr></table>",
            "<table><tr>" + ("<td>" + "x" * 32000 + "</td>") * (MAX_TEXT_CHARS // 32000 + 1)
            + "</tr></table>",
        ]
        for document in documents:
            with self.subTest(size=len(document)):
                with self.assertRaisesRegex(InputError, "NATIVE_HTML_LIMIT"):
                    read_html(document)


if __name__ == "__main__":
    unittest.main()
