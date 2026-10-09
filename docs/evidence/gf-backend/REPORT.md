TASK   K1 → K2 — Canonical projections and real-import checkpoint            GATE GF-CONTRACT / GF-SCENE; GF-BACKEND / GF-DATA blocked
WORKS  Read private ENU canonical area/building projections with cited states; demo remains running from E:/Projects/ulpin-wt/k1.
SEE IT curl http://127.0.0.1:3194/api/v1/buildings/7ea8da1a-1700-4de6-9b82-d5866e4450d8/canonical
INPUTS GMDA retained roads and NYC OTI 353927 (foreign test_only); scanned Haryana RERA 2831 site-plan PDF plus genuine G+41/G+42 conflict.
GAPS   No reviewed building installed; history, renderer styles, geometry-free import and local OCR remain unqualified.

## Checkpoint

- `k1/result.json`: contracts/server/API/client strict typechecks, two route-group tests, two manual-ingestion checks; regenerated native OpenAPI and client. The stale ingestion-only expectation was 235 against 288 existing routes; it now compares the complete declared published inventory (290 with these two routes). This is the explicitly authorised test-only exception to owned paths.
- `k2/result.json`: actual 200 area/building curls, exact-current ETag read, 404 unavailable revision, 403 cross-site read, and unchanged original hashes. Two GMDA road proposals and 62 NYC building proposals were retained through the existing inspect/import routes. **All remain unreviewed**, not registry acceptance or a gate pass. NYC stays in its separate foreign `test_only` area.
- Tower 3's unchanged scanned PDF was retained through the existing source-case/document route. Native extraction completed with `needs_ocr`; one explicit OCR retry completed with `OCR_RUNTIME_UNAVAILABLE`, no provider call. The source-truth G+41/G+42 alternatives are preserved in the complete contract example, **not installed as a building or claimed extracted by this run**.
- No parallel importer, seed, migration, reset, original modification, credential access or change to another Docker project. The existing native demo processes were identity-checked/stopped and resumed from this worktree. Doctor passed; stack left running.

## Failure signature and next decision

**Baseline:** GMDA import accepted unchanged official road bytes, with zero questions. Both review and prepare reject before recording with `USP_GEOMETRY_PAYLOAD_UNQUALIFIED`; commit rejects the absent review. Stop rule applied: no repeated import, bypass or qualification fabrication. **Diagnosis:** `areas.reviewPackage` requires qualified analytical geometry before calling its spatial check; fresh proposal revisions have no qualification. Fix needs the lead's explicit area-review ownership: separate source-only acceptance from unassessed spatial analysis, preserving its existing safeguards. This task did not change review/commit semantics.

The same import contract is GIS-only and requires real accepted geometry: PDF inspection rejects the format, and PDF creation returns `INVALID_INPUT`. It cannot represent Tower 3 or Bihar Magnolia with unknown footprint/placement; it also has no administrative sector-feature kind. Do not substitute a sector polygon, public-land classification or guessed tower polygon. Lead should widen the **existing** import contract/route, then install GMDA administrative context, Tower 3 and Bihar through review. No database migration has yet been justified.

Scene owner must consume the explicit candidate/hatch sidecar: the protected scene types/renderer lack candidate styling and estimated-envelope hatching. Historical canonical reads currently accept only the exact current complete digest; do not mix old physical geometry with current register descendants. Lead should add complete retained-snapshot support and regenerate `docs/api/source-pins.json` at integration (outside K1 ownership). The OpenAPI evidence wrapper invokes the repository's existing native producer without writing that unowned file.
