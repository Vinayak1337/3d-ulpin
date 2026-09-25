# FND-02 attempt 3 · selected target authority

## Scope and provenance

- Assignment `FND-02`, callback `ulpin-FND-02-attempt-3`; worker `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7` on `local`, `Codex/gpt-6-sol/xhigh`. Original accepted base `b2d2cc657c96f994e8b367762e1fd8f3f10c68c8`; plan refresh `604ab6521e75618fe57dd284bfaa84b97a133dbf` remains merged through `6c8fc8d83203c666ed106be7ed59fc2230e1ea63`.
- Attempt-1 and attempt-2 code and receipts remain in history. This bounded R7 correction was tested at `f138320d3f8070d93e5730ce035935b7a2718482`. The evidence commit follows it. The branch was not pushed or merged to staging/main.

## R7 correction

`validateMembers` now requires every identity participant to match a selected `registry_record` `TargetPin` by UUID **and revision** whenever the manifest uses `selection.kind='targets'`. The same validator runs during review preparation and immediately before an identity command writes. Site-scoped commands still use whole-site membership; an authorized exact idempotent replay remains governed by its prior receipt and access context.

The isolated regression captured a valid A-only snapshot while the site also contained B, C and D. Assignment for unselected C, correction for unselected B, a split with unselected successors, a merge with an unselected predecessor/successor, and a boundary adjustment with unselected B each returned `403 USP_IDENTITY_SELECTION`. Across those five preparation attempts, the review-row, code, revision, audit, outbox and snapshot counts stayed identical. This tests the actual condition where a target snapshot contains whole-site members for evidence yet grants a narrower target selection.

The suite then inserted one synthetic already-prepared B review into the disposable review table, simulating a row made by the previous validator. Its command also returned `403 USP_IDENTITY_SELECTION`; the review stayed unconsumed and no code, revision, audit, outbox or snapshot state changed. A positive F/G boundary adjustment with **both** participant pins selected passed and its post-state snapshot retained both new revisions. Existing site-scoped assignments, split/merge and the exact replay tests passed in the same run.

## Executed checks

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-*.test.ts` | 0 | 111 passed, 0 failed/skipped. |
| `pnpm typecheck` | 0 | Explicit final TypeScript check passed. |
| `pnpm build` | 0 | Production build and TypeScript passed; retained GeoTIFF web-worker warning remains. |
| `git diff --check` | 0 | No whitespace errors. |
| `node scripts/usp/local-isolation.mjs --run` | 0 | 20/20 internal commands exited 0, including repeat migration, D0/D1 browser checks, expanded GF-T15 and owned-service cleanup. |

The disposable runner scope was `local-03df105c64e59734`; authored identity site `cd30e983-9d1f-4777-af37-5d7f9e433dc7`. The authored source SHA-256 was `783719ada119a459da27816e97ae23db2741462575b664109b65b23bf17db4de`. The GF-T15 receipt lists 22 checks. The accepted command path produced **14 receipts and 14 audit rows**, with final code states 3 assigned, 1 cancelled-error and 4 retired. Representative receipt IDs: `ac34acd3-b98b-4f56-b091-69c6ac4b848f`, `3d2bf434-57dd-47e9-bda7-12cdb16d908a`, `77405791-745c-444b-823d-5d75e81ec101`. [run-summary.json](run-summary.json) pins all internal command exits and raw receipt hashes.

Fresh final-run [D0 unit](d0-unit-desktop.png) and [D1 roof](d1-roof-desktop.png) screenshots were visually inspected for retained product rendering. They do not show a P3 UI. [artifact-manifest.json](artifact-manifest.json) hashes this evidence and the two changed source files.

## Qualification boundary

The R7 result is a local, authored scope-consistency test in disposable Postgres/S3/HTTP services. It does not qualify public access, official issuance, real-source identity accuracy, UI, HISTORY, exchange, QR/release, scale or deployment. The full GF0/GF1/GF-T15 gates remain pending other owner work and independent milestone review. No linked environment, populated volume, credential, historical receipt or public service was changed.
