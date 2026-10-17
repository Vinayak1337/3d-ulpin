# Frontend build tracker — BhuAayam Studio

The decisions live in [GOAL.md](GOAL.md); this file tracks what is built, in the order of GOAL section 9. Tick a box only when the thing runs, not when it is written. Record real commands and results under **Verification**.

## Milestones

### M1 Foundation
- [x] Workspace packages: `apps/studio`, `packages/ui`, `packages/scene`, `packages/api-client`
- [x] `openapi-typescript` generation from `docs/api/openapi.json` (`pnpm --filter @ulpin/api-client generate`)
- [x] Vite dev server with `/api` proxy to `127.0.0.1:3188`
- [x] Design tokens (light only), self-hosted Noto fonts, base CSS, `Icon` wrapper (Phosphor Regular)
- [x] Local data layer: MSW route table (`local` / `live` per endpoint), excluded from production build
- [x] Vitest runs in each package

### M2 Frame + S1 Batches
- [x] 56 px header: wordmark · Batches / Map / Register · search · area switcher · user (GOAL override 1)
- [x] Router with the saved URL scheme (`/studio/work`, `/studio/areas/:areaId`, `/studio/properties/:buildingId/register`)
- [x] S1 Batches from `GET /work-queue`: filter chips, aligned columns, next action, Empty / Loading / Error

### M3 Scene engine + S4 Area map
- [x] `packages/scene` engine with React adapter; render on demand outside React: `setFootprints`, `loadTileset`, `select`, `pick`, `project`, `frame` (600 ms eased, interruptible, cut under reduced motion), `setPreset`, `stats`
- [x] Engine modes from the mockup: area, building, level, findings, underground (`setState`), halo, context fade, ghosted upper levels, Volumes light, grow-in
- [x] Engine `clip` (section, trench drawing) and the deviation split view
- [x] One derived official layer: 62 NYC OTI footprints with source roof heights (local route, validated against the OpenAPI schema)
- [ ] Load existing scene assets (`/areas/{id}/context` → `sceneAssets`) through `loadTileset` — no area with scene assets is installed yet
- [x] Pick → inspector; URL holds the selection
- [x] Frame time and memory measured (dev hook `window.__ulpinSceneStats`)
- [ ] State-scale boundary layer with level of detail (NWIC districts: original outside Git, EPSG:7755, conditional local use; needs a derivation script and vector tiling)
- [x] Layers panel (base, imagery with its no-data state, Colour by one at a time)

### M4 S5 Building and floors · S7 Evidence viewer · S12 Register
- [x] URL-driven selection with the mockup's click and Escape transitions (`state/selection.ts`, tested)
- [x] S5: level rail, level mode with the Swiss Dwellings floor (2 units, 6 rooms, unknown heights hatched), space inspector
- [x] S7: evidence viewer over the retained originals (CSV rows, GeoJSON pointers) with a 3D still
- [x] S12: register with a full-width units table, shares (Not assessed), history, gaps; register index

### M5 S2 Add files · S3 Live import (polling) · S9 review · S11 Assign
- [x] S2: files profiled by the live `POST /import-packages/inspect`; mapping confirmed by the officer; Start import calls the live `POST /import-packages` (not exercised in verification: it writes to the linked database)
- [x] S3: import tray polling `GET /import-packages/{id}`
- [x] S9 review: room candidates on the plan page (draft EXTRACT-02 route), decisions persisted; level questions
- [x] S11: assign a proposed code with the real P3 generator (local workflow store until identity routes are wired)

### M6 Findings mode (S8/S10) · S6 Underground · S13 Deviation · S14 Card + P4L
- [x] Findings mode shows Not assessed with the reason (no qualified geometry yet); S6 shows "No survey"; S13 shows Not assessed until a sanctioned and an observed source exist
- [x] S14 Property Card with a real QR to the same-device link; P4L Verify with the recomputed hash chain
- [x] S10 check and record stage; S13 deviation split view with Create finding
- [x] S12 register to the mockup layout: 3D + level rail, five tabs, Export (CityJSON 2.0, CSV, JSON)
- [x] Evidence viewer for paged documents (plans, deeds, survey report)
- [x] Public portal P1–P4 and the public map (released facts only)

### M7 Rehearsal journeys (Playwright) and desktop light captures

## Local / live route table

Kept in `apps/studio/src/local/routes.ts`. Every endpoint the Studio calls is listed there with `live` or `local` and the reason. Eleven routes the published API serves are `live` (work-queue, areas, area context, building register, building ledger, area canonical, building canonical, source file, import inspect, import start, import progress); the audit against `docs/api/openapi.json` is in [ROUTES-LIVE.md](ROUTES-LIVE.md). Draft routes stay `local` and only answer when `VITE_LOCAL_DATA=on`. The local resolvers of the routes that went live were removed (they were dead code), so `pnpm studio:demo` no longer serves the Lake View area, the NYC area or the Swiss floor offline for those routes: the selection demo runs on the live API. The data files and the two tests that read them are kept.

The map draws buildings from `GET /areas/{id}/canonical` (and the explored building's `GET /buildings/{id}/canonical`) through `toSceneInputs()` from `@ulpin/contracts`, resolved in the browser from `packages/contracts/src/canonical/building-scene.ts` (alias in `vite.config.ts`; types in `src/types/contracts-canonical.d.ts`). A candidate record is drawn as a ghosted outline, never with the solid facade of a reviewed one; the inspector states `Candidate` or `Reviewed` and lists the record's gaps. The base map, search, inspector and register keep the context route.

## Verification

| Date | Command | Result |
| --- | --- | --- |
| 26 Sep 2026 | `pnpm studio:typecheck` | 4 packages pass |
| 26 Sep 2026 | `pnpm studio:test` | 19 tests pass (ui 4, scene 3, api-client 1, studio 11 incl. OpenAPI contract checks on local responses) |
| 26 Sep 2026 | `pnpm studio:build` | Pass. Map route lazy-loaded (Three.js chunk 793 kB, 205 kB gzip); no MSW worker in `dist` |
| 26 Sep 2026 | Live API (`API_ALLOWED_ORIGINS=http://127.0.0.1:5188`, local operator subject set) + Vite proxy | `health`, `workspace-capabilities`, `work-queue` answered live; Batches lists the 2 records the linked database holds |
| 26 Sep 2026 | Mockup review: read `design-mockup/` code (app, screens, studio-panel, scene) and captured 23 states at 1440 × 900 | Direction recorded in GOAL section 12 |
| 26 Sep 2026 | Journeys in headless Chromium: area → building → underground; Swiss area → level → room → record review → assign → card → verify; register → evidence viewer; Add files → inspect (live) → confirm | All ran without page errors |
| 26 Sep 2026 | Headless Chromium (SwiftShader) 1440 × 900, area map, 62 buildings | 9.7–14.3 ms mean CPU per frame, 70–187 draw calls, ~93 MB JS heap; software GPU, so an upper bound |

| 26 Sep 2026 | `pnpm -r typecheck` (studio, ui, scene, api-client) and `tsc --noUnusedLocals` on studio | Pass |
| 26 Sep 2026 | `pnpm -r test` | 40 tests pass (api-client 1, scene 6, ui 4, studio 29) |
| 26 Sep 2026 | Headless Chromium 1440 × 900 journeys: register (5 tabs, floor, deviation); evidence (plan p.3, deed cl.2); review (accept ×4, adjust, reject → continue) → check (open void in 3D); saved batch; record → assign → card → verify → register card enabled; portal home, results, record, map (area, building, record), verify | No page errors |
| 10 Oct 2026 | `pnpm --filter @ulpin/studio typecheck`, `pnpm --filter @ulpin/studio test` | Pass; 33 tests (the two contract tests were failing on OpenAPI 3.0 exclusive bounds and now run) |
| 10 Oct 2026 | Vite dev server with `ULPIN_API_TARGET=http://127.0.0.1:3194`, `VITE_LOCAL_DATA` unset, headless Chromium 1440 × 900 | Batches lists the 3 live work items; Bronx map draws 62 proposals and selecting one opens the inspector (this crashed on the published ledger shape before); Gurugram map says its 2 road lines are not drawn; Register of a proposal says no register is recorded; Evidence opens the retained `original.geojson`; Add files inspect (`POST /import-packages/inspect`) profiles a 62-feature and a 1-feature GeoJSON; no import started |
| 10 Oct 2026 | Vite dev server with `ULPIN_API_TARGET=http://127.0.0.1:3194`, headless Chromium 1440 × 900 | Bronx map draws the 62 candidates as ghosted outlines; selecting one opens the inspector with `Candidate`, Readiness `Not assessed` and the 4 gaps of its canonical record; Gurugram map still says its 2 road features are not drawn (the canonical record gives them no polygon and no line) |

## Backend requests raised

The route-by-route list from the 10 October audit is in [ROUTES-LIVE.md](ROUTES-LIVE.md#backend-requests).

| Card | What the frontend needs | Draft contract |
| --- | --- | --- |
| Data (lead) | A committed, recorded building. The demo database (10 Oct 2026) holds two areas of unrecorded proposals (62 NYC buildings, 2 Gurugram road lines) and no register, so S12 and the S5 floors cannot be checked live | — |
| READY-01 | Readiness per work item, for the compact readiness column in Batches (omitted until then) | pending |
| TILE-01 | Per-feature 3D Tiles or batched geometry for city scale; the spike draws one mesh per footprint | pending |
| Identity routes | Wire `POST /usp/identity/reviews` and `/assign` for register spaces so codes leave the browser store | local workflow in `apps/studio/src/local/workflow.ts` |
| PACK-01 | Property Card subtype and a QR resolver; today the card and Verify page read the browser store | local |
| HISTORY-02 | Sanctioned/observed pair for the deviation check | `BuildingLedger.deviation` |
| READY-01, RIGHTS-01 | Readiness, rights, areas, shares, checks, revisions per building; stage and next action per work item | `BuildingLedger`, `WorkBoard` |
| EXTRACT-02 | Room candidates from a plan page; level questions | `LevelReview` |
| DOC-01 | Page list, locator anchors, plan calibration and page renders of retained documents | `DocumentPages` |
| INGEST-03 | Saved import batch: detection, CRS, mapping state, open questions | `ImportBatch` |
| PUBLIC-01 | Public search, record, building and map projections of released records | `PublicSearch`, `PublicRecord`, `PublicBuilding`, `PublicMap` |
| IMPACT-01 | Utility survey bands for underground screening | pending |

## Notes for the next session

- Start the API from the staging checkout: `ULPIN_LOCAL_OPERATOR_SUBJECT="local-os:$(id -u):$(id -un)" API_ALLOWED_ORIGINS=http://127.0.0.1:5188 pnpm --filter @ulpin/api start`. Then `pnpm studio:dev` here (port 5188).
- `pnpm studio:derive` regenerates the local area from `fixtures/real-area` after checking its SHA-256.
- Capture at 1440 × 900 with headless Playwright; the in-app browser pane crops wide viewports.
- `ui-design-check` is staged, not committed, in the staging checkout's index (the user's index; leave it alone). Retarget it to `apps/studio` once it is committed.

## 27 September — continued interrupted overlay work

User requested Codex take over Claude's unfinished `frontend/studio` changes. Completed source-driven sidewalk/court materials, height colouring and legend, optional official aerial/derived-LiDAR overlays, and place-label deduplication/zoom/overlap filtering. Corrected double-flipped imagery, preserved source Z differences under a labelled display offset, exposed load/frame failures and released overlay GPU resources. Raw LiDAR and DEM remain evidence; no generic terrain or building reconstruction claim. Details and dataset links: [demo import guide](../api/demo-import.md#studio-overlay-completion). Build/typecheck and the existing nine scene tests pass; browser checked on the real NYC 10013 area. The user's staged skills and protected mockups remain untouched.
