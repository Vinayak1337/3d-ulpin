# Frontend goal — 3D ULPIN Studio

Owner: the user, with Claude as frontend lead. Written 26 September 2026 from the planning conversation, on branch `frontend/studio` (worktree `/Users/vinayak/Desktop/ulpin-frontend`, based on staging `3cc5790`). This is the frontend's own plan. The repository's other active plans are backend-only and say the UI is user-owned ([H99](../usp-agent-handoffs/99-ui-ux-and-integration.md), [backend streaming plan](../usp-agent-handoffs/backend-streaming-plan.md), [NestJS ledger](../orchestration/NESTJS_MIGRATION.md)).

Read this first in every frontend session. Then read [the design system](../design-system/README.md), the [mockup reference](../design-system/mockups/officer-studio/README.md) and [screens](../design-system/mockups/officer-studio/screens.md), and the [API guide](../api/README.md).

## 1. What we are building

An evidence-linked 3D property workbench for SIH 26011, using the story **Identify → Prove → Govern**:

- **Identify:** surface, stacked, elevated and underground spaces, and give reviewed spaces a proposed project code (P3) with a readable Location line.
- **Prove:** every fact opens its source (page, row, drawing region, survey point); geometry and quantities come from retained sources.
- **Govern:** findings, deviation, carpet area, shares and underground screening, with explicit limits.

The officer's outcome is a traceable property record and a scoped **3D Property Card** with a QR code. The map is the working view, not the product. Ingestion accepts any data family, understands unreliable data with an AI agent (the model only proposes mappings; deterministic code converts) and builds 3D only from what the evidence supports: fill, ask, park or reject ([H30](../usp-agent-handoffs/30-reference-scene-and-incomplete-data.md) E).

**Scale:** the same map must work for one building, a city or a state. We work **block by block**, but everything lands in **one global store in one earth frame**, so blocks render at their exact coordinates side by side and the full map exists from the first block ("mostly no data yet", shown honestly through coverage).

The revised hardening review (`~/Downloads/3D ULPIN Plan Review — Grand Finale Hardening.docx`, revised 26 Sep) records the product direction these decisions come from.

## 2. Decisions already made

| Topic | Decision |
| --- | --- |
| Frontend stack | **React + Vite + TypeScript** (user decision). Not Next.js |
| Old frontend | `apps/web` is frozen legacy. Do not build new UI there and do not delete it; the backend lanes are still extracting code from it |
| Backend | NestJS API in `apps/api`, domain code in `packages/server`, SQL in `database/`, Python processors in `services/geo`. Built by the GPT-6 lanes, not by us |
| Division of work | **Claude builds all frontend.** Backend, tiling and data work belong to the GPT-6 lanes. We never edit `apps/api`, `packages/server`, `database/` or `services/`; we report reproducible backend issues instead |
| 3D viewer | **Three.js + [`3d-tiles-renderer`](https://github.com/NASA-AMMOS/3DTilesRendererJS)** behind our own scene engine module. No Cesium. Globe/ellipsoid mode for state and city views. Geography (CRS, datum, transforms) stays in the backend; the viewer receives positions relative to a local origin |
| Map data delivery (backend, planned) | One PostGIS store; 3D Tiles 1.1 with implicit tiling via pg2b3dm; MVT vector tiles via Martin; imagery and DEM via TiTiler; SSE after commit. 3DCityDB only as a later export. Status: TILE-01 and GF-STREAM are pending |
| Apps | `apps/studio` (officer, finale) with role-gated `/admin` routes later; `apps/global` (public global map) is **full product**, built later on the same scene engine and UI packages from a **released-only** projection, never Studio's private tiles |
| Scope | Desktop-first, **light mode only**, no theme switch. Mobile is not required, but keep responsive seams. Keyboard, focus, contrast, reduced motion and 200 % zoom are required |
| Design | Build in the design language of [docs/design-system](../design-system/README.md) (tokens, components, copy, fixed status words). Mockups in [`design-mockup/`](../../design-mockup/README.md) are **visual references** for layout and behaviour, applied **with the decluttering overrides in section 5**. `design-mockup/` is byte-protected: never edit it, never copy its code or data |

## 3. Non-negotiable data rules

From [AGENTS.md](../../AGENTS.md) and the [delivery policy](../usp-agent-handoffs/current-delivery-policy.md):

- Screens show only values read from records. **No hard-coded sample content.** Nothing from the mockup's worked example ("Lake View", "Flat 704", its codes, numbers, files, dates or people) may enter code, fixtures, tests or captures.
- Never label data "fictional", "demo" or "demonstration data". The scope strip shows the dataset's recorded classification; the fixed status words (*Draft*, *Needs evidence*, *Needs review*, *Reviewed*, *Recorded*, *Assigned*, *Retired*, *Cancelled*, *Unknown*, *Not assessed*, *Not comparable*, *Test fixture*, *Replayed*, *Estimated*, *Illustrative*) appear only where the record supports them.
- Only data from official sources (data.gov.in first, or the responsible authority), with provenance kept. Never invent records, identifiers, geometry, heights, units, rights or findings. A missing case is an Empty, *Unknown* or *Not assessed* state.
- Unknown, absent, null, withheld and conflicting stay visually distinct. Unknown is never zero. Estimated and illustrative geometry always look different from evidence-linked geometry. A project code is "proposed", never official.
- Private sources (for example the RERA and GMDA originals kept outside Git) stay local: never committed, never served publicly.

## 4. Architecture

```
apps/studio              React + Vite officer Studio (routes, screens, app state)
packages/scene           Three.js + 3d-tiles-renderer engine; shared later with apps/global
packages/ui              design-system components ported from docs/design-system (tokens, ul-* anatomy)
packages/api-client      typed client generated from docs/api/openapi.json, plus draft contracts
apps/global              deferred (full product)
```

**Stack:**

| Concern | Choice |
| --- | --- |
| Routing | React Router (data router). Keep the existing URL scheme (`/studio/work`, `/studio/areas/:areaId?feature=…&record=…`, `/studio/properties/:buildingId/register`, and so on) so saved links survive. The URL is the source of truth for selection ([H99](../usp-agent-handoffs/99-ui-ux-and-integration.md) selection, generation and cache rules) |
| Server state | TanStack Query: caching, retries, polling for import progress until SSE exists |
| API types | `openapi-typescript` + `openapi-fetch`, generated from `docs/api/openapi.json`; regenerate whenever the backend republishes |
| Styling | Plain CSS with the design-system `--ui-*` tokens ([tokens.css](../design-system/tokens.css), [fonts.css](../design-system/fonts.css)) and CSS modules. No component library. Self-hosted Noto Sans, Noto Sans Devanagari and Noto Sans Mono |
| Icons | Phosphor Regular through one `Icon` wrapper |
| 3D | `three` + `3d-tiles-renderer` in `packages/scene`: an imperative engine class (`load`, `select`, `setMode`, `clip`, `pick`) with a thin React adapter, so React re-renders never touch the render loop |
| Tests (lean) | Vitest for logic and contracts; Playwright for the main journeys. No exhaustive matrices |

**Scene engine requirements.** It must handle two inputs: today's bounded scene assets (3D Tiles/GLB from the old compiler, served through `GET /api/v1/areas/{areaId}/context` → `sceneAssets` and `GET /api/v1/spatial/core/areas/{areaId}/scene/{assetPath}`), and tomorrow's streamed global tiles.

- **Modes:** area, building, level, findings, underground, deviation (split view).
- **Behaviour:** picking resolves to the canonical `recordId`; floor isolation; section and trench clipping; underground view with see-through ground; HTML label overlays; eased camera presets computed from bounds (600 ms, interruptible, never moving on its own during import).
- **Look:** the mockup's feel (soft shadows, edge lines, hatching for estimated or unknown, ghosting, *Volumes* render).
- **Scale:** level of detail by zoom (state and city: vector footprints and coverage; 3D loads as the camera approaches).

**Vite dev:** proxy `/api` to the Nest API at `http://127.0.0.1:3188`. Set `API_ALLOWED_ORIGINS` to the exact dev origin if the proxy forwards `Origin` ([API guide](../api/README.md)). The API is loopback-only with a configured local operator; there is no real login yet.

## 5. Screens and the decluttering overrides

Finale screens (IDs from [screens.md](../design-system/mockups/officer-studio/screens.md)): S1 Batches, S2 Add files, S3 Live import, S4 Area map, S5 Building and floors, S6 Underground, S7 Evidence viewer, S8 Findings, S9 Workspace review, S10 Check and record, S11 Assign proposed code, S12 Register, S13 Deviation, S14 Property Card, P4L local Verify. Admin A1–A7, Portal P1–P7 and S15–S19 are full product.

The mockup, reviewed at 1440 × 900, repeats the same facts in many places and fills the screen with chrome. **Apply these overrides; they win over the mockup.**

1. **One header, 56 px.** Wordmark · Batches / Map / Register · search · area switcher (revision and dataset classification as its subtitle) · user. **Remove** the scope strip, the language menu (Hindi is *Planned*), the More menu (only *Planned* items), the theme toggle and the always-on "Live" pill (show *Snapshot* only when viewing a snapshot). Crumbs move into the inspector title. **Add files** lives on Batches and in Empty states, not on the map.
2. **Left panel = Layers only** (base, imagery, Colour by, AI candidates, Model/Volumes). The level's space list moves into the level inspector, where it doubles as the accessible list alternative to the map. Sources become evidence chips inline with each fact. Checks live only in the tray.
3. **Canvas.** Tools: Select, Measure, Section, Underground. Trench drawing (impact screening) is an action inside the underground inspector. 3D/2D and reset go in a small separate cluster. No hint pill: the inspector's Empty state says "Select a building". The readout is only the scale bar and **N**; CRS and vertical reference show on hover and in Layers. Labels appear only for selected and hovered objects, with more as you zoom in. The legend is shown only for the active Colour by; the evidence key appears on hover. The level rail must not cover the canvas or collide with the toolbar.
4. **One inspector, tabs depend on the selection.** A space gets Overview (facts with inline evidence chips) · Rights · History; findings appear as inline badges that open the tray. The readiness meter becomes one "Blocked: …" line, shown only when the primary action is blocked. There is one primary button per view.
5. **One findings list:** the tray, holding either the import stream or findings, only while it has content. Remove the left Checks panel, the building inspector's "Consistency" meter row and the register's Checks tab. **S10 Check and record becomes findings mode on the map** plus **Record reviewed details**, not a separate page.
6. **Register = the table view.** Full-width Units table, plus Shares and History tabs. No second 3D canvas (use **Open in map**). Documents and checks open from rows. Header: **Property Card** as the primary action, plus an Export menu; Deviation check is a mode.
7. **Batches.** Keep label, next action, compact readiness and time. Drop the stage badge (the next action implies it), "n of 6", the repeated area subtitle and the Area filter. The count cards become filter chips. Keep columns aligned (the mockup's rows don't line up).
8. **One progress model.** A batch's next action drives the flow; review and check are canvas modes, not a separate workspace route with its own stage bar.

The result: with a unit selected, the canvas grows from about 700 px wide to about 1030 px, and each fact appears in one place.

## 6. Screen → API map

These are the operations in [openapi.json](../api/openapi.json) (132 operations; only 9 are runtime-verified, so check `x-runtime-verified`). "Gap" means the backend card is still pending, so we write a draft contract (section 8) and show the screen's Empty or Unavailable state.

| Screen | Available now | Gap (backend card) |
| --- | --- | --- |
| Frame | `GET /workspace-capabilities`, `GET /health` | Real login and roles |
| S1 Batches | `GET /work-queue` | — |
| S2 Add files | `POST /import-packages/inspect`, `POST /import-packages`, `POST /cases`, `POST /cases/{id}/sources`, `/acquisitions*`, `GET …/questions`, `POST …/answers` | Mapping agent (INGEST-02), sufficiency decisions and question budget (INGEST-04), large uploads (INGEST-06) |
| S3 Live import | `GET /import-packages/{id}`, job status (poll) | SSE events (backend streaming plan) |
| S4/S5 Map, building, floors | `GET /areas`, `GET /areas/{id}/context`, `GET /spatial/core/areas/{id}` + scene assets, `GET /buildings/{id}/dossier`, `POST /usp/targets/vertical`, `POST /usp/targets/resolve` | Streamed tiles and global grid (TILE-01), coverage |
| S7 Evidence viewer | `POST /usp/evidence/original`, `POST /usp/evidence/part`, `GET /sources/{id}/file` | — |
| S8 Findings | Register `findings`, `POST /area-checks`, `GET /area-checks/{id}` | Qualified geometry operations (FIND-01) |
| S9 Workspace review | `POST /import-packages/{id}/prepare*`, `GET …/requirements`, `POST …/preparation-facts`, officer AI extractions (gateway disabled by default) | — |
| S11 Assign code | `POST /usp/identity/reviews`, `POST /usp/identity/assign`, `POST /usp/identity/resolve`, `POST /usp/identity/mutate` | — |
| S12 Register | `GET /buildings/{id}/register`, `GET /physical-features/{id}/revisions`, `GET /property-directory` | Readiness (READY-01) |
| S13 Deviation | — | HISTORY-02 |
| S6 Underground | — | IMPACT-01 |
| S14 Card, P4L Verify | `POST /usp/packets`, `GET /usp/packets/{id}`, `…/receipt` (packet0) | Property Card subtype and QR resolver (PACK-01) |
| Exchange | `POST /usp/exchange/cityjson/export` | — |

## 7. Local data layer (build before the APIs exist)

We build the whole Studio now, even where the API is missing, without breaking the data rules.

**Mechanism.** Screens call only the typed client using the real `/api/v1/...` paths. In development, **MSW (Mock Service Worker)** intercepts just the endpoints marked `local` in one route table; everything else goes to the real Nest API through the Vite proxy. When a backend endpoint lands, flip its entry to `live`; the screen doesn't change. Local responses are validated against the OpenAPI schemas (or our draft contracts), so drift fails loudly. The production build excludes MSW. The scope strip or area subtitle shows a **Local data** badge whenever a local route answered.

**Content: three honest sources, no invented records.**

1. **Replayed real responses.** Run the real Nest API against retained official sources (it already handled the USGS PDF intake/retry/read and the NYC footprint import, see [runtime-qualification.json](../api/runtime-qualification.json)) and save the responses. Replayed data carries the *Replayed* badge.
2. **Records derived from retained official sources**, with deterministic derivation scripts that record inputs, hashes and lineage. Candidates, from [real-sources.md](../api/real-sources.md) and [datasets.json](../api/datasets.json):
   - NYC OTI building footprints (Bronx crop): area map with real buildings;
   - 3DBAG D1 roof building (Netherlands, CC BY 4.0): a real LoD2 exterior for the engine, labelled with its own geography;
   - NWIC and KSRSAC district boundaries: state-scale map, streaming and level-of-detail tests (check each permission first);
   - LGD district codes: administrative context;
   - Haryana and Bihar RERA drawing PDFs: evidence viewer and plan review, **local only**;
   - GMDA Gurugram sector and road queries: reference-area context, **local only**, permission unconfirmed;
   - Swiss Dwellings published rows (CC BY 4.0): real multi-unit floor data for level and unit screens, labelled Swiss.

   Foreign sources stay in their own geography; never move them onto Indian coordinates.
3. **Workflow state created by using the app.** Batches, reviews, answers, assigned codes, packets and cards are not pre-written. The local layer implements the **commands** over an in-browser store (IndexedDB): import a real file, review it, assign a code (generated by the real P3 algorithm from `packages/contracts`), make a card. Everything on screen then comes from a real source plus a real action.

**Limits.** The local layer cannot run the Python processors, so their outputs come from replays or derivation scripts. Screens will look sparse where real data is sparse; don't fill them. Findings and deviations appear only if the real data contains them; otherwise the screen shows *Not assessed* or Empty.

## 8. Draft contracts the frontend writes for the backend

Keep these in `packages/api-client/src/draft/` as TypeScript types and OpenAPI fragments, clearly marked as drafts, and hand them to the backend lanes:

- SSE events: `chunk.validated`, `scene.manifest_published`, `batch.needs_input`, `batch.completed`, with cursor and replay ([H14](../usp-agent-handoffs/14-adaptive-ingestion-and-progressive-review.md) F).
- Tile generation manifest and coverage: tileset URLs per profile (3D, vector, raster, terrain), generation ID, frame metadata, `recordId` lookup, cell coverage.
- Sufficiency decisions and questions (H30 E): `outcome`, `missing[]`, `unlocks[]`, question with choices.
- Readiness per named task (H11), deviation pair (H15), underground column (H17), Property Card and verify resolver (H10).

## 9. Order of work

1. **Foundation:** pnpm workspace entries for `apps/studio`, `packages/ui`, `packages/scene` and `packages/api-client`; client generation; the Vite proxy; tokens and fonts; `Icon`; the MSW route table.
2. **Frame + S1 Batches** against the live `work-queue`, with Empty, Loading and Error states.
3. **Scene engine spike + S4 Area map:** load existing scene assets and one derived official layer; pick → inspector. Measure frame time and memory. Then a state-scale boundary layer for level of detail.
4. **S5 Building and floors, S7 Evidence viewer, S12 Register.**
5. **S2 Add files, S3 Live import (polling), S9 review, S11 Assign.**
6. **Findings mode (S8/S10), S6 Underground, S13 Deviation, S14 Card + P4L,** switching from local to live as the backend cards land.
7. **Rehearsal journeys** in Playwright; desktop light captures.

Before handing off any UI change, run the repository's `ui-design-check` skill (`.agents/skills/ui-design-check`); it currently scans `apps/web` and needs retargeting to `apps/studio`.

## 10. Settled in the planning conversation (26 September 2026)

Keep these; they were argued out and agreed, and the rest of this file builds on them.

**Product wording and identity** (from the revised hardening review and the repository's H97 alignment):
- Identity is the **opaque P3 code**, `P3-<20-symbol random payload>-<2-symbol check>`. It embeds no parcel, level, use or date, so corrections never change it. It is shown with a **display-only Location line** (`<parcel ULPIN> / S01 / F07 / R003`). A draft space has no code; codes are never reused; split, merge or demolition retires a code with lineage. There is no largest-overlap parcel rule. With no official anchor the card says "official parcel anchor not supplied". Label both as "3D ULPIN (proposed)", never official.
- Every level names its **vertical reference**. Say "metres above mean sea level" only when the source states that datum.
- The QR opens the **exact revision on the same device** (local link). Phone scanning and public verification are full product.
- Underground output is a **screening report, never a dig permission**. Draw a utility sleeve only where the source states a tolerance. Unsurveyed ground reads "No survey", never clear.
- The air-rights envelope is full product (it needs a sourced development-control rule); the finale shows elevated and below-ground extents in the strata view.
- Finding order is deterministic; a learned ranking only after a preregistered test.

**Why Three.js and not Cesium.** The mockup's look (edges, hatching, ghosting, soft shadows, section cuts) came from about 370 lines of plain Three.js; in Cesium each needs custom shaders. Cesium's extras (clamping to ground, underground camera, geodesic measuring) are either done better in the backend (heights recorded, not guessed) or buildable in a few weeks. `3d-tiles-renderer` covers streaming, globe navigation, terrain and imagery plugins. Japan's national PLATEAU city models are rendered this way (Takram's `three-geospatial`). Because data is served as standard tiles, another viewer could read the same data later.

**The Helsinki lesson: data first, viewer second.** Helsinki stores semantic CityGML in 3DCityDB on PostGIS, in one projected system with a named height datum. It distributes 4 km² map sheets and streams 3D Tiles to a viewer that is a replaceable consumer. We copy the data discipline, not the viewer, and go further with interiors and underground legal spaces.

**Why our own tables + pg2b3dm, not 3DCityDB as the tile source.** Our records carry legal spaces, rights, P3 codes, `analyticEligible` and per-field provenance that CityGML doesn't. A second schema would need syncing on every revision and would break "one registry". pg2b3dm works on any PostGIS table or view.

**Global store, filled block by block** (backend-owned; the frontend relies on it):
- One earth frame for every record, with the source CRS and vertical reference kept. No per-block local database or coordinates.
- Blocks are **work units** (batch, review, coverage), not storage units.
- One fixed global tile grid: publishing a block regenerates only its cells, and an object crossing a block edge keeps one identity and appears once.
- **Coverage is data:** the state view shows covered blocks and honest gaps.
- Detail by zoom: state and city views use vector tiles; 3D loads only as the camera approaches.
- A block whose CRS was never verified stays **parked in its local frame** and is not placed on the global map.

**Public global map** (`apps/global`, full product unless the user pulls a thin version into the finale):
- Map-first home: the state map with coverage, and the P1 search box on top. Results as pins and a list. The record page flies into the block with the unit lit. Verify and corrections follow the P-boards.
- It reads only a **released projection**: the officer releases chosen units and fields → a publish job builds released-only tiles and records → global renders those. Never Studio's private tiles, sessions or caches. Same scene engine and coordinates, different data.
- Admin (A1–A7) is role-gated routes inside `apps/studio`, not a third app.

**Demo spine (six minutes)**, which orders the finale screens:
1. Problem: records that disagree.
2. Adaptive intake: the building appears inside a city layer that is still streaming.
3. Footprint, roof and storeys; a deviation opens where plan and observation disagree.
4. Units extrude; click one for its code, Location line, anchor, share and levels.
5. Checks run and the officer resolves one, creating a hashed revision.
6. Underground screening with a trench.
7. Property Card and same-device QR.
8. Zoom out to the whole streamed layer; CityJSON export.

Metrics come only from real runs.

**Mockup facts.** The mockup is `design-mockup/` (from the Claude Design project "Officer Studio mockups transfer").
- `Officer Studio.html` is the interactive Studio; its Tweaks panel switches screen states.
- `Portal Admin and Phone.html` holds the boards: Portal P1–P7 (search-first in the mockup), Admin A1–A7, Studio S15–S19 and phone views (out of scope).
- To view it: serve the folder with `python3 -m http.server 8765 --directory design-mockup` and capture 1440 × 900 with headless Playwright from the repo's `node_modules/.pnpm/@playwright+test@1.63.0/node_modules/playwright`. The in-app browser pane crops wide viewports.
- The review found the same facts repeated four or five times: the same finding in the Checks panel, tray, inspector, legend and label; a level shown five times. Hence section 5.

**Data realities.**
- DATA-09's Gurugram reference area (around Haryana RERA project 2831) found terrain, water, land use, context buildings, imagery and underground depth *unavailable* from qualified official bytes, and LGD reuse permission unconfirmed.
- DATA-10 official large layers (NWIC, KSRSAC) have unresolved use permission.
- Expect sparse screens; don't fill them.

**The hardening review document.** It was edited in place at `~/Downloads/3D ULPIN Plan Review — Grand Finale Hardening.docx` (revised 26 September; the backend streaming plan records its SHA-256 as `a0c70fa9…`). It now carries the P3 identity, Three.js viewer, global store, streamed tiles, official-only tests (T15–T22 including the scale rung) and the new rebuild order. The pre-edit original was only a session scratch copy.

**Working preferences of the user.**
- Brainstorm before building when direction is unclear, then decide.
- Claude makes technical calls when asked to ("decide what's best") and explains them briefly.
- No mock or invented data, ever.
- Work in this worktree and branch; never push or merge without being asked.

**Local environment.**
- Two Docker stacks are usually running (`ulpin-*` linked and `ulpin-repo-*` isolated: PostGIS, MinIO, Redis, geo, worker).
- The Nest API is not started by default: `pnpm --filter @ulpin/api start` on `127.0.0.1:3188`, after checking the port is free. The guarded real-source runtime is `scripts/usp/REAL_SOURCE_RUNTIME.md`.
- Don't reset volumes, reseed or touch `.env`.

## 11. Open items

- **AGENTS.md** still says "Keep Next.js", "H22 retains the current Cesium runtime" and "run `$ui-design-check` for `apps/web`". Waiting for the user's OK to add a short frontend section (React + Vite, Three.js, this file).
- Confirm the stack in section 4 at the start of implementation.
- The public `apps/global` stays full product unless the user brings a thin version into the finale.
- The backend's official large layer (DATA-10) permission is unresolved; the frontend scale work uses the district boundary layers locally until then.
