TASK   A5a — Long numeric cells stay inside the profile contract          GATE GF-AGENT
WORKS  Three footprint tables now yield 21 profiles and 12 dictionary-linked rows, without moving older profiles.
SEE IT pnpm exec tsx scripts/agent/d1f-acquisition.ts --output-root E:/BhuAayam-data/task-data/a5a --check
INPUTS Good: retained Seattle CSV. Difficult: Baton Rouge, New Orleans and Edmonton WKT footprint prefixes.
GAPS   No runtime gate claim; the closed-folder 104-file restart check was not repeated. No labels produced.
DESIGN column-profile.ts preserves the historical prefix and masking, then shortens only expanded outputs.
       Complete bracket tokens/code points are atomic; the final […] marker counts toward the unchanged 256 cap.
       d1f-acquisition.ts checks the archived 198 profiles and writes only the three recovered tables to A5a.
       verify-profiles.ts reproduces T1/T1b from raw inputs; verify-development.py fences closed reads.
COMMITS d88faf81 — docs(agent): A5a a masked sample can outgrow the profile contract, reproduced
        408a0ea1 — fix(ingestion): bounded post-mask samples, preserving all formerly valid outputs
        This commit — data(agent): the three footprint tables profiled with their dictionary rows (A5a)
CHECKS pnpm typecheck:backend — 0; pnpm exec tsc -p scripts/agent/tsconfig.json — 0.
       Column-profile tests, apps/api tsconfig — 0 (4 passed; 30 fixture sample hashes unchanged).
       mapping-teacher, mapping-teacher-review and a3-chunk tests, agent tsconfig — 0 (19 passed).
       pnpm exec tsx --tsconfig scripts/agent/tsconfig.json docs/evidence/gf-agent/a5a/verify-profiles.ts — 0.
       pnpm exec tsx scripts/agent/d1f-acquisition.ts --check — 0 (198 profiles unchanged).
       A5a preparation and its --check, using the SEE IT output root — 0.
       python -B docs/evidence/gf-agent/a5a/verify-development.py — 0 (nine foreign files and Indian development).
       git diff --check; owned-file line-width check — 0.
NEXT   Lead: review/integrate; separate coordinate-mask semantics and foreign admission from this repair.
       Requested verify-d1f.py reads closed acquisitions/provisional folders; permission is needed to repeat it.
       No acquisition, provider, GPU, runtime, held-out read, old product write or push occurred.

| Table | Columns / profiles | Dictionary-linked rows | Definitions | Shortened samples | Identity-style samples |
| --- | ---: | ---: | ---: | ---: | ---: |
| opf-d07 East Baton Rouge | 10 / 10 | 10 | 10 | 10 / 100 | 10 / 100 |
| opf-d08 New Orleans | 8 / 8 | 1 | 0 | 10 / 80 | 14 / 80 |
| opf-d09 Edmonton | 3 / 3 | 1 | 0 | 2 / 30 | 2 / 30 |

New Orleans and Edmonton link the existing dataset-level geometry descriptions, not new column definitions.
Identity-style masks remain conservative: coordinates account for 22 such samples; New Orleans adds three area
samples and one GlobalID sample. No meaning or target was assigned. All samples meet the unchanged contract.

Byte identity: T1 411 columns / 45 tables and T1b 193 columns / 5 tables reproduce their recorded JSONL SHA-256s
and profile hashes. D1f's 198 profiles, links, dictionary rows and inventory reproduce unchanged; its five pinned
products retain their recorded byte hashes. Product pins, caller/error inventory and Step 0 are in `result.json`.
Historical gap records stay immutable; current preparation proves all nine tables and reports no masking gap.

Tests used in-process provider/label controls only, with temp files and recording paths redirected beneath A5a.
They are not genuine teacher outputs. The first boundary assertion incorrectly rejected the existing Devanagari
zero mask; the test was corrected, not the product. No frozen truth was opened or used.
