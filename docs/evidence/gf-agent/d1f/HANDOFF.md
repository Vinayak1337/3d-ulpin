TASK   D1f — Documented property-table families                 GATE GF-AGENT
WORKS  Nine immutable foreign originals/eight retained families; six have column definitions, five are profile-ready.
SEE IT python -B scripts/agent/verify-d1f.py --indian-development
INPUTS Good: Seattle native CSV/dictionary. Difficult: full WKT footprints, retained but blocked at T1 masking.
       Per-family issuer, URL, literal licence, files/rows/columns, dictionary file/SHA-256: families.json.
GAPS   Partial, no gate pass: not ten documented positive families or 120 target matches; no new Indian/blind source.
DESIGN acquire-d1f.py screens whole exports and retains byte-exact prefixes; originals/older recipes stay immutable.
       d1f-acquisition.ts reuses T1 masking and columnProfileHash; --check compares all immutable prepared products.
       verify-d1f.py reuses acquisition readers and development-only D8 checks, never the evaluator-opening main().
       Sibling manifest/registry/catalogue keep foreign geography separate; measured coverage is in families.json.
COMMITS de57ee99 — data(d8): development families with publisher dictionaries (D1f)
        9d1d7fe5 — data(d8): development families with publisher dictionaries (D1f)
        e20b9df3 — data(d8): development families with publisher dictionaries (D1f)
        5efa2ac9 — data(d8): development families with publisher dictionaries (D1f)
        36c82377 — fix(agent): deny credential paths in D1f acquisition
        This commit — docs(agent): D1f counts, blocked routes and dictionary extracts
CHECKS python -B scripts/api/build-dataset-catalog.py --check — 0 (initial stale-pin check: 1, then reconciled).
       python -B scripts/agent/verify-d1f.py --indian-development — 0 (104 pins; no partial/unrecorded originals).
       pnpm exec tsx scripts/agent/d1f-acquisition.ts --check — 0 (six ready tables of nine, explicit three gaps).
       pnpm exec tsc -p scripts/agent/tsconfig.json — 0.
       python -m pytest --noconftest scripts/api/test_dataset_catalog.py scripts/agent/test_acquire_d1f.py
       — 0; 7 passed; task-owned external temp/cache.
       ruff check scripts/agent/*d1f*.py — 0; git diff --check and new-file line-width check — 0.
NEXT   Lead: label only publisher-supported columns; assign shared masker/foreign admission fixes for blocked inputs.
       Owner: exact-path closed-discovery disposition. More documented Indian sources/blind positives remain missing.

| Family | Geography / issuer | Files | Rows | Native columns | Definitions / profiled dictionary rows |
| --- | --- | ---: | ---: | ---: | ---: |
| opf-d02 | Seattle, US / OSE | 1 | 38,309 | 46 | 46 / 46 |
| opf-d03 | NYC, US / NYCHA | 1 | 2,955 | 26 | 26 / 26 |
| opf-d04 | San Francisco, US / Environment + SFPUC | 2 | 34,354 | 66 | 66 / 66 |
| opf-d05 | Kansas City, US / city | 1 | 141 | 46 | 46 / 46 |
| opf-d06 | Edmonton, Canada / city, heritage | 1 | 1,105 | 14 | 9 / 9 |
| opf-d07 | East Baton Rouge, US / city-parish | 1 | 197,392 | 10 | 10 / 0 |
| opf-d08 | New Orleans, US / city | 1 | 162,486 | 8 | 0 / 0 |
| opf-d09 | Edmonton, Canada / city, footprints | 1 | 365,822 | 3 | 0 / 0 |

Totals: 203 column definitions; 198 profiles and 193 dictionary rows. Two dataset-level geometry descriptions are
**not** column definitions. Counts are per-file column instances, not six-target labels. Missing licence stays unknown.
Three WKT tables exceed the masked-sample cap after replacement expansion; no cells/features/geometry were modified.
Foreign admission needs contract/allowlist/prefix registration, not one line. Backend/contracts are untouched.
Chicago's unresolved ten-digit name-column risk stays closed; copies were withdrawn before profile/manifest dispatch.
All 104 retained files match recorded size/hash; no acquisition was in flight at restart and nothing was deleted.
Additional held-out n=0; public freeze: 2 families (n=2), 2 positives (n=4). Private files stayed closed on resumption.
Standing shortfall: 1 family (n=3), 23 positives (n=25). No provider, labels, training, runtime changes or push.
