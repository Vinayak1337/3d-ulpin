# D8 — source-native Indian tables and GIS (D1b, 10 October 2026 IST)

`manifest.json` is the development-teacher-safe view. **D1b adds 29 unchanged CSV/XLSX files in 21 publisher/schema families: 26 development files / 18 families and 3 tabular holdout files / 3 families.** Whole pack: **37 originals, 26 families; 32 development files / 21 families and 5 heldout files / 5 families**. These are schema families, not 26 distinct publishers.

**Evaluator only:** `heldout.json`, all heldout originals and their publisher documents. Never open these in a teacher context, include them in teacher prompts, or use them for calibration. The manifest freezes the exact evaluator metadata bytes. External `d1b-discovery/` is acquisition-worker material, not an approved teacher input directory.

## Development inputs

Historical `mi-d01`–`mi-d03` remain unchanged: one LGD CSV, three Bihar RERA building-table HTML originals and two project-list HTML originals. The Bihar manual p11 §17 documents seven building fields and square-foot entry units. LGD expanded meanings remain undocumented. Five HTML files are **not** CSV/XLSX originals; whole HTML remains external because of unrelated contact/bank sections. Teachers receive only their selected non-personal table profiles. Storey project relatives and Tower 3's conflict are unchanged.

New `mi-d04`–`mi-d18`: **23 OpenCity/Oorvani publisher-native CSV files in 15 conservatively grouped layouts**, including ward crosswalks/population/hierarchies, slum amenities, a land-use code index, district/ taluk/hobli rainfall, groundwater tables, district GDDP and transport statistics. Their retained CKAN metadata preserves publisher attribution/resource descriptions. These are real downloaded CSVs, but may be transcriptions/derivatives of authority reports: **not issuing-authority exports or official operational registry facts**. Development `test_only`; expanded definitions and canonical targets are not invented.

New `mi-d19`–`mi-d21`: **three official RBI XLSX originals**, with different cultivation/land-use measure-column schemas. Source captions explicitly say **Lakh Hectares**; some columns carry other units, so a worksheet-wide area conversion would be wrong. Preserve the exact captions, header groups, notes, numeric cells and dash literals. Unit/field identity does not establish property geometry or rights.

All 26 new development originals have small, byte-identical copies in `dev/d1b/`. Downloaded originals are unchanged under `E:/BhuAayam-data/datasets/messy-india/`. Source hashes, acquisition time, permission state, URLs, header profiles and case locators are in the development manifest. There was no CSV conversion, synthetic case insertion or reformatted workbook.

Families group the publisher and semantic layout, not individual years, cities or download names. Cosmetic rainfall-header variants and geographic recharge scopes are grouped conservatively; observed header fingerprints identify variants. A numbered source header row must match the complete `1..N` sequence; mostly numeric data rows are not header rows.

## Blind holdout inventory

| Family | Publisher | Files | Case names |
| --- | --- | ---: | --- |
| `mi-h01` | Gurugram Metropolitan Development Authority | 1 | `GIS_attributes`, `declared_projected_crs` |
| `mi-h02` | Gurugram Metropolitan Development Authority | 1 | `GIS_attributes`, `declared_projected_crs` |
| `mi-h03` | Office of the Registrar General & Census Commissioner, India | 1 | `publisher_documented_column_descriptions`, `merged_header_cells`, `multi_row_headers`, `multiple_worksheets`, `empty_worksheets` |
| `mi-h04` | Reserve Bank of India | 1 | `publisher_documented_column_descriptions`, `merged_header_cells`, `multiple_worksheets` |
| `mi-h05` | Reserve Bank of India | 1 | `publisher_documented_column_descriptions`, `merged_header_cells`, `multi_row_headers` |

The three new tabular families have exact publisher hierarchical column descriptions, source-cell locators and publisher documentation URLs in the evaluator manifest. This oracle covers explicit field identity/context, **not** an expanded legal/code dictionary or invented canonical target. Missing meanings require abstention. Whole publisher/schema families stay closed to teachers.

## Observed cases and limits

New development cases include lakh-grouped numeric cells, hectare area captions, multi-row/merged/numbered headers, repeated or empty column labels, parallel lists, missing/dash cells, coded lookup tables, mixed geographic granularity and unit-verification needs. Historical inputs also retain leading-zero codes, mixed-script address values, floor literals, apartment inventory and plot/khesra text; they do not make those cases native CSV examples.

Still absent: Devanagari/legacy-font headers and digits, `DD/MM/YYYY` record dates, gaj/sq-yd/acre areas, uncommon floor labels, tax/permission CSV registers, naturally missing/wrong CRS and genuine prompt injection. See `missingCapabilities`; **hectares found does not mean acres found**. Groundwater header units need independent verification; do not repair them by magnitude.

Five acquired candidates remain external and unselected: a staff/contact directory, two pseudocode-keyed school registers and two geolocated survey exports needing further privacy review. Nothing was redacted or admitted as a replacement original. Individual land-record lookups, private-person name/contact registers and accounts/keys/CAPTCHA bypass were not used.

Permission remains **unconfirmed**; portal license labels are observations, not upstream redistribution/training grants. D8 remains `usp-data-pack/1` style, not the strict D0–D7 application DTO. Native CSV/XLSX originals now exist, but **no live import, teacher/model call, review or runtime GF-AGENT pass occurred**. The report/check command is in `docs/evidence/usp/finale/GF-DATA/D1b/HANDOFF.md`.
