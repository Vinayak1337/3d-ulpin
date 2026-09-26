# Frontend build tracker — 3D ULPIN Studio

The decisions live in [GOAL.md](GOAL.md); this file tracks what is built, in the order of GOAL section 9. Tick a box only when the thing runs, not when it is written. Record real commands and results under **Verification**.

## Milestones

### M1 Foundation
- [x] Workspace packages: `apps/studio`, `packages/ui`, `packages/scene`, `packages/api-client`
- [x] `openapi-typescript` generation from `docs/api/openapi.json` (`pnpm --filter @ulpin/api-client generate`)
- [x] Vite dev server with `/api` proxy to `127.0.0.1:3188`
- [x] Design tokens (light only), self-hosted Noto fonts, base CSS, `Icon` wrapper (Phosphor Regular)
- [x] Local data layer: MSW route table (`local` / `live` per endpoint), **Local data** badge, excluded from production build
- [x] Vitest runs in each package

### M2 Frame + S1 Batches
- [x] 56 px header: wordmark · Batches / Map / Register · search · area switcher · user (GOAL override 1)
- [x] Router with the saved URL scheme (`/studio/work`, `/studio/areas/:areaId`, `/studio/properties/:buildingId/register`)
- [x] S1 Batches from `GET /work-queue`: filter chips, aligned columns, next action, Empty / Loading / Error

### M3 Scene engine + S4 Area map
- [x] `packages/scene` engine with React adapter; render on demand outside React: `setFootprints`, `loadTileset`, `select`, `pick`, `project`, `frame` (600 ms eased, interruptible, cut under reduced motion), `setPreset`, `stats`
- [ ] Engine `setMode` (building, level, findings, underground, deviation) and `clip` (section, trench) — with M4/M6
- [x] One derived official layer: 62 NYC OTI footprints with source roof heights (local route, validated against the OpenAPI schema)
- [ ] Load existing scene assets (`/areas/{id}/context` → `sceneAssets`) through `loadTileset` — no area with scene assets is installed yet
- [x] Pick → inspector; URL holds the selection
- [x] Frame time and memory measured (dev hook `window.__ulpinSceneStats`)
- [ ] State-scale boundary layer with level of detail (NWIC districts: original outside Git, EPSG:7755, conditional local use; needs a derivation script and vector tiling)
- [ ] Layers panel (base, Colour by, Model/Volumes) — add when there is more than one layer to control

### M4 S5 Building and floors · S7 Evidence viewer · S12 Register
### M5 S2 Add files · S3 Live import (polling) · S9 review · S11 Assign
### M6 Findings mode (S8/S10) · S6 Underground · S13 Deviation · S14 Card + P4L
### M7 Rehearsal journeys (Playwright) and desktop light captures

## Local / live route table

Kept in `apps/studio/src/local/routes.ts`. Every endpoint the Studio calls is listed there with `live` or `local` and the reason.

## Verification

| Date | Command | Result |
| --- | --- | --- |
| 26 Sep 2026 | `pnpm studio:typecheck` | 4 packages pass |
| 26 Sep 2026 | `pnpm studio:test` | 19 tests pass (ui 4, scene 3, api-client 1, studio 11 incl. OpenAPI contract checks on local responses) |
| 26 Sep 2026 | `pnpm studio:build` | Pass. Map route lazy-loaded (Three.js chunk 793 kB, 205 kB gzip); no MSW worker in `dist` |
| 26 Sep 2026 | Live API (`API_ALLOWED_ORIGINS=http://127.0.0.1:5188`, local operator subject set) + Vite proxy | `health`, `workspace-capabilities`, `work-queue` answered live; Batches lists the 2 records the linked database holds |
| 26 Sep 2026 | Headless Chromium (SwiftShader) 1440 × 900, area map, 62 buildings | 9.7–14.3 ms mean CPU per frame, 70–187 draw calls, ~93 MB JS heap; software GPU, so an upper bound |

## Backend requests raised

| Card | What the frontend needs | Draft contract |
| --- | --- | --- |
| Data (lead) | An official-source area installed in the linked environment through the real import route. Today the linked database holds only two legacy synthetic datasets and no areas, so the map runs on the local derived NYC OTI area | — |
| READY-01 | Readiness per work item, for the compact readiness column in Batches (omitted until then) | pending |
| TILE-01 | Per-feature 3D Tiles or batched geometry for city scale; the spike draws one mesh per footprint | pending |

## Notes for the next session

- Start the API from the staging checkout: `ULPIN_LOCAL_OPERATOR_SUBJECT="local-os:$(id -u):$(id -un)" API_ALLOWED_ORIGINS=http://127.0.0.1:5188 pnpm --filter @ulpin/api start`. Then `pnpm studio:dev` here (port 5188).
- `pnpm studio:derive` regenerates the local area from `fixtures/real-area` after checking its SHA-256.
- Capture at 1440 × 900 with headless Playwright; the in-app browser pane crops wide viewports.
- `ui-design-check` is staged, not committed, in the staging checkout's index (the user's index; leave it alone). Retarget it to `apps/studio` once it is committed.
