# Shared spatial-map core — first implementation slice

Branch: `feat/reusable-spatial-map-core`. Base application commit: `1622097`.

## What is implemented

- One `MapViewport` entry point and one `createMapRuntime` Cesium factory. Existing AreaViewer and SpatialViewer imports are compatibility facades. Geographic-area, local-engineering-model, and 3D Tiles layers are source adapters, not page-owned engines.
- One request cache and map-session service per officer layout. Requests are deduplicated, obsolete requests are cancelled, stale completions cannot overwrite replacements, successful mutations invalidate active readers, and idle entries are bounded. Neither canonical records nor source documents are persisted in browser storage by this cache.
- A runtime-validated `ulpin-spatial/1` minimum contract. It preserves entity IDs, many authoring memberships, source revision references, explicit frames, geometry roles, vertical bounds and optional attachments. This is a qualified initial profile, not implementation of every proposed schema or input format.
- A read-only legacy-area adapter and `/api/v1/spatial/areas/[areaId]?world=observed|planned|hypothetical|synthetic`. Unresolved global heights remain unresolved. Local coordinates are not relabelled geographic coordinates. Unsupported source geometry produces diagnostics; original records and sources remain in the existing stores.
- A deterministic polygon/prism compiler with holes, a versioned material library, synthetic-only schematic architecture, GLB feature metadata and actual 3D Tiles 1.1 coarse/detail content. Tiles expose only canonical IDs, representation IDs, revisions and kinds, not source URLs, residents or documents.
- Two authored calibration neighbourhoods served by the same compiler: 60 buildings with park/context, and 120 densely arranged buildings. Each has one explicit floor/unit fixture; interiors are not inferred for every exterior. The calibration API does not write to the registry or seed a database.
- `/map-lab`: one live map remains mounted while switching Map, Building and Sources panels. Selected floors/units use exact fixture geometry for a temporary inspection overlay. Measurement uses analytical representations, never tile LOD or decorative facades.

## Run

Use the repository's normal dependency/setup instructions. With dependencies installed:

```text
pnpm dev
```

Open `/map-lab` on the app's local port 3000. The calibration screen needs no populated database, AI key, map token, external imagery or extra asset download. Existing registry pages still require the normal local services.

```text
pnpm test:spatial
pnpm typecheck
pnpm build
```

Browser suite, after building, with Playwright Chromium installed:

```text
SPATIAL_START_SERVER=1 pnpm test:spatial:browser
```

On PowerShell set `$env:SPATIAL_START_SERVER="1"` before the command. Stop an existing port-3000 server before requesting that the suite start its own. To use an already running server, omit that variable; `SPATIAL_BASE_URL` optionally selects a different local URL.

## Ownership boundaries

`packages/contracts/src/spatial/` is renderer-neutral. `features/spatial/data/` owns transient readers, view sessions, bounded fixtures and compatibility adapters. `features/spatial/compiler/` generates disposable display assets. `features/spatial/engine/` is the only engine factory. `features/spatial/layers/` adapts geometry sources. Page-specific controls belong outside the engine.

One shared implementation is not a promise that a WebGL canvas survives every Next.js route unmount. Active surfaces have one owner and release resources when destroyed. Layout-scoped data/selection/camera services retain appropriate context. Calibration panel switches do preserve the exact live canvas; dataset changes replace its content/runtime and retain the corresponding world session.

There remains one authoritative database writer: the existing application services. No second canonical database, automatic legacy reprojection, snapshot replacement, reseed, or official identifier issuance is introduced.

## Boundaries still open

This is the initial shared-map foundation, not completion of all renderer-first/schema-plan tasks. The complete reference visual benchmark has not been approved. The synthetic renderer's facades/roof equipment are display-only illustrative detail and are not counted as measured building volume. The first compiler supports bounded, explicitly placed metre-based ENU polygon/prism scenes; it does not support arbitrary IFC solids, LiDAR extraction, raster terrain, circular utility collision analysis, or every domain profile.

A regional/global catalog, resumable bulk ingestion, cross-area publication transactions and a complete large-world capacity test remain later work. Coarse/detail tiles and cache limits are implemented; this does not prove country-scale capacity. Large input thresholds in existing importers are unchanged.

The compatibility endpoint has pure adapter tests, not a new live-database restoration test. Existing source-specific geometry adapters remain behind the shared viewport during staged migration. Full legacy workflow parity must be exercised on the user's saved data before retiring them.

## Verification

See the branch's GitHub Actions **Spatial core** run and `.runtime/spatial-qa/browser-results.json` artifact for the tested revision and actual browser screenshots. Assertions and screenshots are acceptance evidence only for their named fixtures. A CPU-rendered CI browser is not certification of the user's GPU, a physical phone, or a frame-rate target. No original mockup is used as the live map background.
