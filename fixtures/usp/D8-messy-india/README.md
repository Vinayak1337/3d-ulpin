# D8 — source-native Indian tables and GIS

## D1d second-route checkpoint — 10 October 2026 UTC

**Incomplete GF-AGENT prerequisite.** Development: **3 publisher families / 5 originals**, no new column labels.

| Family | Publisher | Native files | Format | Columns per file |
| --- | --- | ---: | --- | ---: |
| `mi-d22` | Tamil Nadu Housing Board | 2 | JSON object tables | 90 |
| `mi-d23` | Pune Municipal Corporation | 2 | XLSX facility/site inventories | 5 |
| `mi-d24` | Microsoft | 1 | Gzip-compressed GeoJSONL | 3 |

TNHB remains development. All layouts from each other publisher remain together, mechanically hash-split;
undocumented potential holdouts move to development. The split ledger, identities and support remain evaluator-only.
Heldout: **2 families / 2 files / 4 columns / 2 scorable / 2 positive targets** (`building.footprint`: 2).
No nested leaf expansion, repeated-layout counting or unsupported targets pad these numbers. Shortfall: **1/1/23**.

`scripts/agent/flatten-json-table.py` preserves first-seen keys, every column, row order, lexical number tokens,
scalar text, booleans and nulls; nested values are compact JSON. Missing keys remain empty, null is the text `null`.
`dev/d1c/derivatives.json` pins both TNHB CSVs and a 128-row byte-exact prefix / CSV of the native footprint partition.
The prefix is from the demo's publisher partition, not a geographic clip. Derived CSVs are not native originals.
Full originals are immutable; byte-identical small copies and derivatives have checkout-safe Git attributes.
The publisher's compressed filename says CSV, but its native content is GeoJSONL; the native reader is unqualified.

Pune tables describe institutional facilities/sites, not verified buildings or units. Licence **not stated**;
reuse unconfirmed, `test_only`. Microsoft has explicit CDLA Permissive 2.0 licensing but remains a vendor prediction,
not official measurement, ownership, geometry accuracy or learning truth. TNHB qualifications below remain valid.
The publisher-only truth bridge verifies literal documentation and source/derivative pins in the existing freeze
script. Its new receipt replaces the empty checkpoint; original empty truth and A3 bytes are not overwritten.
No teacher, provider, training, memory, runtime import, evaluation or registry writes occurred.

Whole pack: **44 originals / 31 historical-or-new schema families; 37 development and 7 evaluator-only files**.
This does not mean 31 distinct publishers. `verify-d1c.py` checks the amendment, not task acceptance.
All sections below are historical checkpoints; old D1b seals are retained unchanged.

## D1c checkpoint — 10 October 2026 UTC

**Partial acquisition, not a passed GF-AGENT data prerequisite.** Two unlabelled issuing-authority Tamil Nadu
Housing Board JSON originals extend development by **one family**, with 108 and 102 scheme rows. Both have
90 keys and the same ordered-key fingerprint; publication-state queries are not independent families.
They contain property-scheme facts, rather than the statistical measures that dominate D1b. No canonical
labels or unit conversions were added. Public unpublished-scheme rows do not establish offered/current status.

Originals are external; small byte-identical copies are in `dev/d1c/`. These are **native JSON tables, not
CSV/XLSX originals**. Their import/teacher profiling is unqualified; do not silently convert them and claim
publisher-native CSV coverage. Issuing provenance does not confirm reuse/training permission (`unconfirmed`).

New heldout: **0 families, 0 files, 0 columns, 0 scorable columns, 0 positive targets**. No unsafe register
was redacted or admitted. The empty, explicitly blocked D1c receipt records the shortfall, not a useful
property evaluation set. The historical A3 set and truth remain unchanged. All evaluator-only materials
remain closed to teachers; an empty new selection does not reopen the historical set.

Whole pack: **39 originals / 27 families; 34 dev files / 22 families and 5 historical heldout files / 5 families**.
See `docs/evidence/gf-agent/d1c/result.json` for gaps and `verify-d1c.py` for read-only amendment checks.
The earlier counts and qualification below describe the historical D1b acquisition.

## D1b — 10 October 2026 IST

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
