TASK   D3 — Native HTML table reader            GATE GF-AGENT
WORKS  Read retained HTML tables through the Python native-document dispatch as bounded workbook-style cell parts.
SEE IT E:/BhuAayam-data/task-data/d3/geo-py311/Scripts/python.exe docs/evidence/gf-agent/d3/verify_real_inputs.py
INPUTS mi-d03 registered-page-3.html (good); mi-d02 RERAP01282025205138-1.html (difficult layout/span/nesting page).
GAPS   Python reader verified; TS identification, strict locators and empty-part preservation remain unqualified.

## Design and verification

- `services/geo/geo/native_html_table.py`: standard-library decoding/collection, then pure `_place_cells` and
  `_grid_parts`. Reuses the ODS A1 helper and workbook limits; missing positions stay absent. Span-covered cells
  have empty text and source references. Nested values stay only in their own sheets; direct outer text is retained.
- `services/geo/geo/area.py`: only the format allow-list/message and HTML dispatch with original-byte SHA-256 changed.
- `packages/contracts/src/usp/document-ingestion.ts`: one-line `DocumentFormatSchema` addition only.
- `services/geo/tests/test_native_html_table.py`: requested seven cases plus decoding and bounded-limit invariants.
  `verify_real_inputs.py`: read-only development checks; emits counts and selected header rows, not contacts,
  bank sections, addresses or data-cell text. `result.json` holds the measured results and environment recovery.

The exact check is `python -m pytest services/geo/tests/test_native_html_table.py
services/geo/tests/test_native_workbook_xml.py -q`, using the executable above: exit 0, 11 passed.
The real-input verifier, `git diff --check`, staged whitespace check and new-Python-file 120-character check pass.
Code commit: `4921857d` — feat(geo): read native HTML tables as bounded cell references.

## Next — outside owned paths

The lead should assign the TS integration seam: identify HTML natively in `document-native.ts`, include the HTML module
in `documentReaderSha`, admit HTML locators/states without inventing OOXML IDs, and preserve empty span parts.
Regenerate the published API schema and qualify one officer-reviewed import. Select non-personal main tables before
teacher use; whole pages contain unrelated/private sections. No registry writes, model calls, source changes or full
GF-AGENT pass are claimed. No push or integration by this worker.
