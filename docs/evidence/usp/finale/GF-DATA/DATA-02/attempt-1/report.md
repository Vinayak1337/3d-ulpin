# DATA-02 attempt 1 — authored adversarial fixtures

**Status:** READY_FOR_REVIEW for fixture authorship and packaging only. No GF-DATA, GF-AGENT, GF-SUFFICIENCY, rights, topology, privacy or runtime gate is promoted by this report.

**Branch and provenance:** `agent/DATA-02-adversarial-fixtures`, clean starting base `staging@55ee5b82f1587b31f4a97aa1723d83a33cf4dc1f`. The fetched remote staging `f45bbc7ad69d826d2fdca19d83e0dcf568bf95fa` is an ancestor of that local integration base. The authored oracle snapshot is `89bdcb534f297a404796a628d1c067dbfb1e9a48`; independent validator code is `fc1e933b1eecb74681a38d4f779ca20734832496`. Oracles were committed before the validator and before any production implementation/evaluation run on these cases. There was **no production engine, provider or operational-record processing run**.

**Agent:** Codex `gpt-6-sol` with `high` effort, verified from the latest `turn_context` in this worker's local client session. Worker thread `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7`, host `local`. No subagent was used.

## Authored coverage

The [catalogue](../../../../../../../fixtures/usp/D0/adversarial/v1/catalogue.json) and [coverage manifest](coverage-manifest.json) index 17 versioned synthetic case directories, 50 hashed source files and one `oracle.json` per case. Every oracle records author/date, preconditions, task-specific outcome or abstention, H28/H30 test mapping, source-byte hashes and limitations.

| Coverage | Case IDs and expected boundary |
| --- | --- |
| Indian reference mistakes | `crs-utm43-as44` (wrong-zone control displacement >500 km); `crs-kalianpur-as-wgs84` (synthetic identity residual >25 m); `crs-axis-order` (literal swap outside India plus an in-India conflicting axis declaration); `crs-missing-prj` (valid Shapefile companions, no `.prj`). All are unverified/unpublished. |
| Messy records and constrained agent | `indian-messy-csv` retains Devanagari/legacy glyph literals, lakh grouping, regional units, dates, khasra strings, feet-inch and all listed Indian level labels. `agent-injection` covers CSV header/cell, white PDF text, Devanagari, Unicode tags, bidi, filename and OCR link as inert data. `agent-heldout-and-protocol` has three held-out layouts, four invalid MappingPlan literal classes, no-key, outage and budget cases. |
| Privacy | `privacy-synthetic-deed` contains a Verhoeff-valid dummy Aadhaar, PAN pattern and Indian mobile in a one-page PDF plus a generated JPEG with GPS EXIF. Oracle requires masking and EXIF stripping for egress; no person or property is represented. |
| Rights and topology | `cross-site-metro` crosses two synthetic sites without creating a common site or title. `tenure-cooperative` keeps unit UDS not applicable; `tenure-per-deed-uds` freezes exact 1/1 and 199/200 controls, complete versus partial population, one-unit limited common, stilt sale claim and an unapproved clause. `topology-adverse-clean-pairs` has seven adverse cases, each with a clean twin; numeric controls include 10 m² / 20 m³ overlap, zero positive volume at contact and a 96 m² shell with a hole. |
| Indian roof, slope, scale and levels | `roof-and-chajja-negatives` excludes mumty, tank and 1 m parapet from an extra-level flag and abstains on roofprint-only setback. `sloped-site` keeps “Ground” at the uphill road entrance. `lift-core-480` has one shared core, 480 unique beneficiaries and five bounded one-hop pages. `stilt-mezzanine-levels` retains level kinds/order and null elevations. |
| H30 mixed insufficiency | `mixed-gap-batch` contains the required no-`.prj` vector, ambiguous-area CSV, unscaled plan with one dimension string, two non-overlapping generated GPS JPEGs, DEM alone, DSM without DTM, LAS without CRS, local IFC without georeference, address list, aggregate table and a ZIP with one supported plus one unsupported member. It specifies 16 object/task decisions and four class-level questions; “Not sure” parks the affected class. No original or never-fill fact is removed or invented. |

**Resolved plan ambiguities:** H28 Z3's literal “lat/lon-swapped GeoJSON that still falls inside India” cannot hold for the non-overlapping Indian longitude and latitude ranges. The case has an actual swapped point outside India and a distinct valid Indian coordinate with an inconsistent source axis declaration; neither is silently moved. The H30 E/G control-point disagreement uses the lead's conservative D010 minimum of three reviewed correspondences for global placement. Every authored control and benchmark is marked synthetic, never surveyed. Display-only fill is barred from evidence, analytics, rights, readiness, cards and training truth.

## Validation and hashes

| Executed command or check | Exit/result |
| --- | --- |
| `python3 fixtures/usp/D0/adversarial/generate.py` | 0; authored 17 case directories before oracle commit. |
| `python3 fixtures/usp/D0/adversarial/validate.py --self-test --rebuild-compare > docs/evidence/usp/finale/GF-DATA/DATA-02/attempt-1/format-validation.json` | 0; 17 oracles, 50 source hashes, 68/68 byte-identical rebuilt files. |
| Validator negative mutations on temporary copies | 4/4 rejected: altered source byte, inconsistent question budget, LAS header/body mismatch and bad Aadhaar check digit. |
| `pdftoppm -f 1 -singlefile -r 96 -png` on each of the three PDFs; `pdfinfo` on the deed | 0; one page each; rendered pages were visually inspected. The white instruction is extractable but invisible in the render. Poppler emitted a non-fatal fontconfig warning. |
| Independent `pypdf`/Pillow/ZIP/struct readers and `file` on Shapefile, LAS and IFC | 0; PDF extraction/render, JPEG GPS EXIF, GeoTIFF tags, LAS records, Shapefile index/DBF, ZIP CRC and IFC STEP hierarchy/references/local solid checked. |
| `git diff --check 55ee5b82f1587b31f4a97aa1723d83a33cf4dc1f..fc1e933b1eecb74681a38d4f779ca20734832496` | 0. |

The [packaging receipt](packaging-receipt.json) records the command, exit, agent setting and artifact hashes. The [validation result](format-validation.json) contains every source SHA-256, per-case oracle SHA-256, format counts and mutation results. The [coverage manifest](coverage-manifest.json) maps every case to H28/H30 requirements and records source tree SHA-256 `b4d06076f2f245e13f845f0474243b63d1e6278d1ab6b1c17ff18868e17cc78a`.

| Artifact | SHA-256 |
| --- | --- |
| `fixtures/usp/D0/adversarial/v1/catalogue.json` | `9ed873fd2c29178813fff129808fefd9f8901ec6968920e78db250245f6fa739` |
| `fixtures/usp/D0/adversarial/generate.py` | `3e76ba371d837041615e37c567138300a8f546a9b090480bf9d71ae06b88db36` |
| `fixtures/usp/D0/adversarial/validate.py` | `c7a46da71f3f34b3f00a83ec02d98606bd45a9a0c26492e7488ad7cf952e3870` |
| `format-validation.json` | `f25efed328985a6091a85d161f403515b59abcf21863b105293c5d8a9e088ceb` |
| `coverage-manifest.json` | `b5c093681ac5f68eaa6178f3224fc8294c19296b296ed1af9584e309a44c5c43` |
| `packaging-receipt.json` | `bf4294a94358ce46080c2539ebc4391277aaa12a1189962a3b410f411ab08f56` |

**Limits:** All cases are authored synthetic test data. None qualifies a real datum operation, survey control, legal instrument, Aadhaar identity, property title, photogrammetry reconstruction or Indian pilot accuracy. The IFC is checked as a well-formed local IFC4 STEP project with resolved references and local extrusion, without an external IFC4 schema validator or runtime import. Packaging and arithmetic validation cannot establish ingestion, prompt isolation, egress redaction, rights, findings, model quality or deployment. DATA-08 cross-family oracle review remains pending.
