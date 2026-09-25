# DATA-09 attempt 2 — review corrections

Producer: Codex / `gpt-6-sol` / `high`, verified from the worker turn context. Branch: `agent/DATA-09-official-reference-area`; original verified base: `1678c7fd70a242468d4d0ee9b68011b92d875a92`. Tested code and manifest commit: `04c69335342942fdb89709c447ff5fef79dd0203`. This corrects attempt-1 review findings DATA09-R1–R3 (reviewed on staging commit `9e80e8b376c25bb01922f42ea80a5b1d06bbbb6d`); the attempt-1 report and receipts remain unchanged historical evidence. No new source acquisition or production run occurred.

## Corrections

**R1 — unchanged official sources.** The `self-test` CLI mode, its source-copy/alteration code, and unused imports are removed from [DATA-09-official-reference.py](/Users/vinayak/.codex/worktrees/51a5/3D%20Ulpin/scripts/usp/data/DATA-09-official-reference.py). The two attempt-1 mutation checks are **superseded and nonqualifying** under the current official-source-only policy. No altered official bytes or fabricated adverse cases were produced or run in attempt 2. Negative adverse-case coverage remains unavailable; it is not a test pass.

**R2 — original-to-extract integrity.** Before selecting the Gurugram row, `check` hashes and sizes the retained LGD original CSV and matches it independently against the DATA-01 acquisition record, DATA-01 provenance, and DATA-01 check receipt. It then compares the same original pin with this D4 manifest's `provenance.original` and `subsetLineage.sourceSha256`, checks resource ID and URL, and compares the exact CSV row to the checked-in extract. It also verifies every `source-observations.originalHashes` entry against the four unchanged retained private originals. The observed LGD original is 89,622 bytes, SHA-256 `b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`. The [attempt-2 source check](/Users/vinayak/.codex/worktrees/51a5/3D%20Ulpin/docs/evidence/usp/finale/GF-DATA/DATA-09/attempt-2/source-check.json) records each successful pin comparison and the private-source hashes without publishing GMDA geometry.

**R3 — source permission.** The [D4 manifest](/Users/vinayak/.codex/worktrees/51a5/3D%20Ulpin/fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json) now records `permission: unconfirmed` for both the LGD extract and the source-derived observation metadata. The portal-wide [Government Open Data Licence notice](https://www.data.gov.in/Godl) was observed, but its exact applicability and any exemptions for the specific [LGD districts resource](https://www.data.gov.in/resource/local-government-directory-lgd-districts) have not been independently pinned. Accordingly, the LGD asset's `qualified` and `tested` provenance stages are `not_run`; only original-byte and literal-format inspection remains. The derived metadata inherits LGD and GMDA permission limits. The exact existing extract and all historical source bytes are preserved. The [attempt-2 layer ledger](/Users/vinayak/.codex/worktrees/51a5/3D%20Ulpin/docs/evidence/usp/finale/GF-DATA/DATA-09/attempt-2/layer-status.json) marks administrative-label publication `failed(resource_specific_publication_permission_unconfirmed)`.

## Executed checks

At code commit `04c6933`, the following commands each exited **0**. The source-check JSON holds their run time, exact command strings, exit statuses and stdout/stderr hashes.

1. `python3 -m py_compile scripts/usp/data/DATA-09-official-reference.py`
2. `python3 scripts/usp/data/DATA-09-official-reference.py check`
3. `pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json`

Static AST inspection confirmed the `self_test` function and source-copy mutation imports are absent. A source-derived rebuild of the three D4 pack files from the **unchanged** retained originals was byte-identical before the code commit; the committed source/manifest bytes are those checked above. No negative input was synthesized for this run.

Code SHA-256: `d36de9e8e8f9bbdd6d11a5dc51283fe5cb9eef62dec382722d19a0e3a0c045c9`. Manifest SHA-256: `dcdc217f00c531d222ca80630fcb03de6516f69f3f7b82b7d371b5f64467b68d`. Retained LGD extract SHA-256: `9214ba1e83683e2735379dd8b17df3269218efde6f6491299b49a1d14a036bce`. Attempt-2 source-check SHA-256: `b2e569200feb802b527e9fc7fb0ff36246b655418e8767e1bbf6e7279775e9bb`. Layer ledger SHA-256: `34a6c62cd92c55faf39482c1baa08f14186b54e0f7162e4c7f7be22a2ef70362`.

## Open qualifications

The [official Haryana RERA 2831 project page](https://haryanarera.gov.in/view_project/project_preview_open/2831) names villages/sectors but does not locate Tower 3 precisely. The private GMDA sector/road bytes remain unqualified for released scene reuse; parks yielded zero features. Terrain, water, land use, trees, context buildings, imagery and underground depth remain unavailable from qualified official bytes. Resource-specific LGD reuse applicability, source geometry age/accuracy, independent review, production ingestion and GF-DATA/GF-SCENE release tests remain open. No gate status or real-source accuracy claim is promoted.
