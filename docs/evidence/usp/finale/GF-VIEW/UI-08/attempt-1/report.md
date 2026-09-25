# UI-08 attempt 1 — record-backed finale content

**Result:** Code and isolated local UI preview passed. UI-08's full finale gate remains pending DATA-09's qualified Indian reference area, same-corpus baseline comparisons, a production build, and independent milestone review. No deployment or data replacement occurred.

**Branch and agent:** `agent/UI-08-record-backed-content`; base `80e1e9cf46a49eefb1d4024efe14f82c177ec85d`; code `d8b95384bb802b3b1de121f650524aec21be7ab6`. Agent product Codex desktop, model `gpt-6-sol`, effort `xhigh`. Callback `ulpin-UI-08-attempt-1`.

## Implemented

- S1 work, S4 area scope, S5 building selection, S12 register, intake, processing, source study, header chooser, and generated register/block documents show recorded classification or explicit unavailable states. Synthetic classification is not displayed as a test-fixture claim. Stored names remain exact, including names that contain “Fictional” or “Lake View.”
- `/studio/showcase` loads only an explicitly selected saved dataset; no bundled dataset is substituted. The saved package, SHA-256 and canonical digest are checked before display. Its unselected route shows a real empty state. Legacy URL routing and raw document/GIS/raster/point-cloud inspection remain.
- The saved-map runtime no longer strips words or underscores from recorded names. Its unqualified overlap badge says “Geometry finding.” Source-import error copy now says synthetic; internal source status values remain unchanged.
- The compact building card uses only the recorded footprint. Missing footprint is unavailable; it does not invent façade, height, roads, rooms, or control points. The larger display exterior labels illustrative details.
- The former `/studio/source-study` route lists saved areas rather than locality-name matched constants. Historical `features/studio/data/district.ts`, `documents.ts`, and `reference-workbench/demo-datasets.ts` remain as unreferenced material; no protected dataset, original, upload, or `apps/web/public/` file changed.

## Checks

See [checks.json](checks.json) and the final [runner receipt](runs/local-c4b63017534069b9/runner-receipt.json). TypeScript and `git diff --check` passed. UI 20/20, scene 7/7, spatial 30/30, Studio routes 33/33, source normalizers 14/14, map labels/floor plates 6/6, and preview isolation guard 1/1 passed. The Playwright capture test passed 1/1.

The final preview used a fresh nonce-owned Docker project and fixed loopback port 3108. It verified the hash-pinned `repo-data` database (`92cbdeb930c7b20f9a90f7857f92787ebe2562c65892ad835a758bdf1b6cfda8`), 44 original table digests and 497 object hashes before any preview. Existing additive migrations and replay ran only in that new database. The `jobs` row count stayed 566 while its row JSON digest changed because migration adds nullable `started_at`; all 44 migrated table digests and all 497 object keys/hashes were unchanged after browser reads. The runner removed its own services and left port 3108 free. Earlier failed nonce runs and logs are retained under `runs/`.

The required design scan was invoked with the exact base. Its original script resolves the original checkout, so a temporary copy with only its root set to this worktree scanned 182 added UI lines. One candidate remains: literal colors on the standalone generated register HTML line. The entire inline print style has the same SHA-256 in base and current (`1e08b3bafc6ea5cba6594729e80d0bb38961843b9e5f430c67431e42f5203baa`); no new color was introduced. The changed icon import now uses the shared icon wrapper.

`pnpm build` was blocked by the repository's build-server guard because an unrelated portfolio Next server occupied port 3000. It was neither stopped nor bypassed. The local preview used Next dev on port 3108 and does not count as a production build.

## Screenshots and limits

The final active-product light-mode captures, with exact routes in [capture-manifest.json](runs/local-c4b63017534069b9/screenshots/capture-manifest.json), are [S1 Batches](runs/local-c4b63017534069b9/screenshots/S1-batches.png), [S4 Area map](runs/local-c4b63017534069b9/screenshots/S4-area-map.png), [S5 Building selection](runs/local-c4b63017534069b9/screenshots/S5-building-selection.png), [S12 Property register](runs/local-c4b63017534069b9/screenshots/S12-property-register.png), and [unselected saved map](runs/local-c4b63017534069b9/screenshots/saved-map-unselected.png). S4/S5 use the recorded 2D presentation for a deterministic read-only capture; the isolated preview did not start the processing service. The observed Bronx area is retained foreign regression data, not Indian DATA-09 evidence or an official scene. S1 includes synthetic historical records and their unmodified names. S12 has no supplied interior records, so none are displayed.

Earlier active-product screenshots are available for qualitative “before” reference: `docs/evidence/t071/01-batches.png` (S1 prototype), `docs/evidence/usp/finale/GF-VIEW/UI-01/attempt-2/runs/local-dce7a5b0a94e03b1/screenshots/studio-light-desktop.png` (S4), `docs/evidence/usp/finale/GF-VIEW/UI-02/attempt-2/runs/local-8ba10b1b462de6b1/screenshots/d0-selected-light-1440.png` (S5), and `docs/evidence/reference/register-1440.png` (S12). They predate this exact base or use another corpus; they are not same-record before/after evidence. A same-corpus baseline pair is still required to close UI-08's screenshot criterion.

The remaining repository grep hits are internal `fictional` status assertions in `reference-import/source-normalizer.ts` and `reference-runtime/records.js`, the stored legacy description in `lib/server/spatial-datasets.ts`, historical unreferenced generators and diagnostic `/map-lab`, comments, and protected public records. None is a hard-coded disclaimer in the mapped finale screens. The storage description was left unchanged under the assigned no-storage-edit scope.
