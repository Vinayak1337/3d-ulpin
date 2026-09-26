# CLEANUP-DATA execution receipt — 26 September 2026

Base: `staging` at `92e4d04cdeaaa2d8ccc65680c6fea1675dcee88a`. This task made only unstaged changes in the shared checkout. The seven pre-existing staged skill edits and other owners' edits were not touched. The [exact deletion manifest](cleanup-data-execution-2026-09-26.paths.json) names all 286 retired paths and their base Git blobs.

## Data disposition

- Retired 49 reviewed geographic synthetic companion/generator paths, 18 authored D0 replay assets, 53 Lake/reference seed and scene paths, and 18 obsolete mixed bootstrap/replay scripts and tests. The public GLBs had bindings only in the now-retired historical mixed snapshot; a current source search found no live code reference to their paths.
- Moved all 148 files from `repo-data/` and `data-bundles/uttam-nagar/` out of the active checkout to the private archive `/Users/vinayak/.codex/archives/3d-ulpin-cleanup-data-2026-09-26-92e4d04c`. The archive is mode `0700`, copied files are mode `0600`, and its `archive-manifest.json` is SHA-256 `7b5bb1f2dfc427c6fecf6be2e285811f712a32e65be43fbf40c5295210994e1b`. Every archived file was checked against its active-tree source by size and SHA-256 before deletion; total 18,395,882 bytes. The snapshot and transfer remain recoverable there and from pinned Git history. They are historical mixed state, not installable source packs.
- Kept the real Bronx source at `fixtures/real-area/original.geojson` with exact SHA-256 `869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a`. Kept all six real Uttam/Google geometry source counterparts at their existing fixture paths, with the six SHA-256 values in [the provenance audit](cleanup-data-provenance-2026-09-26.md). Eight real-file/counterpart hash checks passed before archiving. Raw response files, acquisition receipts, licence/selection notes, D4 real-source pack, and D1 original remain in the active tree unchanged.
- Preserved the unresolved 85 null-site cases, 406 source records and 28 distinct source hashes within the complete private `repo-data` archive. No unclassified object or key was individually deleted or relabelled; the eight additional historical area keys are in that same archive. The complete Uttam row/review graph and its original mixed manifest remain in the archive, including the three real reference roots and six original objects. No replacement snapshot or new record was generated.

## Bootstrap and test boundary

- `platform:start` in `REPO_DATA=true` now starts isolated infrastructure, creates its private bucket and runs schema migration before app startup, without restoring the mixed snapshot. It preserves an existing isolated database and does not reset or reseed it. `repo:init`, snapshot export, and the mixed Uttam installer were retired with their scripts and package entries. Linked mode was not changed.
- `scripts/usp/local-isolation.mjs` retains its generic service/credential guards. Its former D0/preview launcher fails before starting services because that replay required the retired mixed saved state. The direct D1 import script and canonical source import/API paths remain. Recorded D0/PACK0 receipts are historical evidence, not a current runtime pass. A new real-source isolated journey is still needed for current runtime qualification.
- The GF0 source check now compares the D4 road bytes directly against the unchanged retained source, without using the mixed Uttam manifest. GF-CONTRACT's source row points to the retained D4 byte verifier and marks exact-part runtime coverage partial. Its generated inventory was refreshed. Other GF-CONTRACT rows may still describe historical tests; this edit does not promote their status.
- No live or linked database, populated volume, provider, preview, or deployment was accessed or changed. Docker was not run. No official-source accuracy, model-training permission, production readiness or release gate was claimed.

## Checks actually run

| Command | Exit | Result |
| --- | ---: | --- |
| `python3 scripts/usp/data/gf0-source-bundle.py --check` | 0 | D4 context and structured-code checks; retained road source SHA matched `317953642c770fb6913a14377a9a53904d9bf0eca5af7b150afbe7d5123d0f93`. Status remains `candidate_for_review`. |
| `pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D4/gf0-context-v1/manifest.json` | 0 | Two declared files and byte hashes checked; no parsing/workflow claim. |
| `pnpm exec tsx --test tests/usp-d1-pack.test.ts` | 0 | Two existing D1 source/topology checks passed. |
| `node --test tests/repo-data-mode.test.mjs` | 0 | Two isolated environment selection/secret-preservation checks passed. |
| `node scripts/usp/gf/GF-CONTRACT.mjs --write`; `node scripts/usp/gf/GF-CONTRACT.mjs --check`; `node --test tests/usp-gf-contract.test.mjs` | 0 each | Current static inventory written/checked; three inventory tests passed. This is not a live contract test. |
| `node --check scripts/usp/local-isolation.mjs`; `bash -n scripts/platform-start.sh`; `git diff --check` on changed text files | 0 each | Syntax/whitespace checks passed. |
| `pnpm typecheck` | 0 | Web TypeScript check passed against the shared dirty checkout. |

An initial invocation of `gf0-source-bundle.py` without its required `--check` argument exited 2 with usage text; the documented command above then passed. Static reference searches found no remaining active code reference to the retired directories or scripts. The lead subsequently retired the unreferenced `DelhiStudy.tsx` component and stylesheet, removing the sole stale installer instruction; its existing redirect to saved datasets remains. Current runtime and browser checks remain unavailable until a real-source isolated runner and UI integration are supplied.

## Lead integration review

The lead also retired 192 exact obsolete package/prototype/test/dead-component paths in [the direct manifest](cleanup-direct-retirement-2026-09-26.paths.json). Fixed seed/Studio source endpoints and their consumers were removed, while the real NYC source compatibility paths, canonical registry import, shared processing and saved-record APIs remain. Package commands no longer point to retired executables. The supplied `design-mockup/` files were recovered unchanged from `docs/design-mockup`; examples there are protected design references, not operational data.

Resolution for outstanding branch tips: BOOT-001 has no additional tree delta; DATA-02 authored adversarial fixtures are superseded by the official-source policy; UI-08's newer staging UI, privacy guards, CityJSON routes and provenance contracts prevail. Unique backend identifier/export wording and missing-frame honesty corrections from UI-08 are retained in `area-resolver.ts`, `block-export.ts` and `officer-investigations.ts`. Its old snapshot preview and captures are retired. Design-mockup assets are retained with the current backend-only documentation. The old UI branch's footprint-only preview idea remains a user-owned UI review item; no scene redesign is included.

Final lead checks: `pnpm typecheck` exit 0; `pnpm exec tsx --test tests/register-scope.test.ts` exit 0 (3 passed); six retained importer/identifier checks exit 0 (27 passed, 1 pre-existing HTTP integration skip). The endpoint cleanup worker reported Studio 18/18 and geo 85/85 passing. No broad new test suite was added. No live browser/API/database qualification was run.

### UI design check

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 92e4d04` exited 1 with one literal-colour candidate in the long HTML export line at `apps/web/lib/server/officer-investigations.ts:646`. Review confirms its existing export CSS is unchanged; only source/frame wording changed. **Blocking:** none introduced. **Design system:** no new visual styling. **Checked, no issue:** the unused Delhi study component and stylesheet were removed; the existing saved-datasets redirect is unchanged. Current screens, layout, keyboard/zoom behavior and theme were not redesigned. This is a static deletion/copy review, not browser acceptance.
