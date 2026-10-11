TASK   AU3 — Raster and points of a batch, audit and smallest build            GATE GF1 / GF5
WORKS  Three real originals retained, probed and read over HTTP; no product change or map claim.
SEE IT node docs/evidence/gf1/au3/check.mjs
INPUTS NYC ortho (good); DEM with IFD beyond probe head (difficult); NYC LAZ, all unchanged.
GAPS   Normal Studio does not upload them; accepted reader artifacts do not update intake or reach its map.

## What dropping them shows today

- Orthophoto: normal Studio lists **Document or table / Not imported**; opt-in NYC transport can draw it.
- DEM: same unimported row; even the NYC transport does **not draw** it.
- LAZ: same unimported row; opt-in NYC transport can draw a derived surface, not product point-batch output.

The drop guard is `apps/studio/src/features/intake/AddFilesDialog.tsx:134-151,249-257` for all three.
Development drawing also needs a GeoJSON anchor, supported frame, configured interpreter and viewer's layer switch
(`scripts/demo-import/plugin.mjs:102-110,165`; `apps/studio/src/features/map/MapWorkspace.tsx:132-150`).

## Eight items (normal product path, not the optional development transport)

Citations below use the prefixes declared in `chain.json`; each expands to a full repository file path.
`works` means the stated reader/limit condition in `chain.json` was read, not that a batch surface draws.

| Item | Orthophoto | DEM | LAZ |
| --- | --- | --- | --- |
| 1 Drop | not connected [D] | not connected [D] | not connected [D] |
| 2 Front door/probe | refused INVALID_INPUT [F] | refused INVALID_INPUT [F] | refused INVALID_INPUT [F] |
| 3 Reader | by request only [R] | by request only [R] | by request only [P] |
| 4 Draw | not connected [V] | not connected [V] | not connected [V] |
| 5 Placement | not built [L] | not built [L] | not built [L] |
| 6 Height/facts | not connected [H] | not connected [H] | not connected [H] |
| 7 Native limits | works [B] | works [B] | works [Q] |
| 8 OBJ/glTF audit | not connected [M] | not connected [M] | not connected [M] |

- D: `studio/features/intake/AddFilesDialog.tsx:134-151,249-257`
- F: `controller/ingestion.controller.ts:64-97`; `contracts/ingestion.ts:106-121,189-193`
- R: `ingestion/raster-window.ts:144,150-164`; P: `ingestion/point-batch.ts:143,149-163`
- V: `studio/features/map/overlays.ts:199-204`; `controller/raster-window.controller.ts:38-58`
- L: `ingestion/intake-ledger.ts:100-107`; `database/sql/95-ingestion/intake-ledger.sql:17-18`
- H: `ingestion/source-fusion-raster.ts:22-24`; `ingestion/source-fusion-point.ts:22-24`
- B: `geo/raster_window.py:61,89-106`; Q: `geo/point_batch.py:42,68-95`
- M: `studio/features/intake/AddFilesDialog.tsx:38,134`; `contracts/ingestion.ts:106-108`

`by request only` qualifies **continuation**: dedicated `/rasters` and `/points` retention queues part zero itself.
Enrol/probe starts neither reader. All three are too small for `/uploads`; separate retain routes worked.
Results: `result.json`; complete conditions/citations: `chain.json`; model paragraphs: `chain.json.details.models`.

## Single measurement and safety

The nonce-owned tmpfs PostGIS box and loopback in-memory S3 control were removed; no volume or demo touched.
Retain/enrol/next-part/metadata/artifact reads used HTTP. Harness awaited unchanged canonical workers directly;
dispatcher and browser were read, not measured. S3 control is not a production object-store capacity benchmark.
All three manual `/sources` requests returned `422 INVALID_INPUT`. Requested-reader elapsed times including reads:
ortho **0.815 s / 95,494 B TIFF**, DEM **0.819 s / 117,176 B TIFF**, LAZ **0.774 s / 245,760 B native records**.
Cards stayed `probed / undecided` after reading; zero intake parts, physical features and registry records.
DEM probe CRS absent was header ignorance; native metadata states EPSG:2263, vertical reference unknown.
LAZ header CRS absent became EPSG:6347/NAVD88 metadata, still `globalPlacement=not_qualified`.

## Build tasks (proposal, not code)

`proposal.json.tasks` is the exhaustive disjoint path list, including generated contracts and prerequisites.
- **SURFACE-BACKEND, 24 h:** existing retention/probe/reader workers, `usp/jobs.ts`, `cases/processing.ts`,
  ingestion controller/contracts, Python readers/API; new `intake-surface.ts` helper; accepted part display reads.
- **SURFACE-MAP, 12 h:** map `overlays.ts`, imagery worker/pixels, `MapWorkspace.tsx`, new map subscriber,
  scene `engine.ts` diff-by-id. No intake-page edits.
- **SURFACE-DROP, 8 h:** intake `AddFilesDialog.tsx`, new `surface/retain.ts` and `surface/BatchSurfaces.tsx`.
  This is what the batch page needs; schedule after its current GeoJSON owner returns.

Estimate **44 worker-hours**, allocation ortho14/DEM12/LAZ18. Keeps16MiB original ceiling, limits in officer words.
LAZ needs211 parts, so replace32-history cap with611 unique planned parts (existing5M-point bound).
DEM is a flat masked scalar preview, not a measured terrain mesh. No unqualified Z, height or floor count enters facts.
Large raster2GB/point1GB admission/read strategy, COG pyramids and qualified height use are explicitly separate builds.

## Architecture qualifications / contradictions

`chain.json.architectureDifferences` quotes each statement with the code line. Key ones:
- “header-level readers ... LAZ/COPC ... rasters” (`INGESTION-ARCHITECTURE.md:30`): each part fetches/hashes/spools
  the entire original (`geo/raster_window.py:67-82`; `geo/point_batch.py:48-63`) before decoding its selected part.
- “Probe everything first, read nothing yet” (`:8`): dedicated retention queues first reader before probe
  (`ingestion/raster-window.ts:144`; `ingestion/point-batch.ts:143`). This is design, not today's route ordering.
- Probe coverage (`:83-84`), extent drawing/pyramids/chunks/placement (`:102,134,136,138,141,147-151`) are proposals,
  not current behavior (`ingestion/intake-headers.ts:88-106,139-169`; `ingestion/intake-draft.ts:89-96`).

Refresh refused `Unexpected index bytes: packages/server/src/modules/usp/ingestion/events.ts`.
Audit continued unchanged. NEXT: review proposed placement/preview scope, coordinate intake-page owner, dispatch builds.

DESIGN `chain.json` cites24 item/file cells and shared reader conditions; `result.json` projects one HTTP run.
       `proposal.json` supplies three exclusive builds; `check.mjs` checks references, shape and file ownership.
COMMITS `bf11727a` — audit/measurement; proposal commit is the next branch commit (see git log).
CHECKS `node docs/evidence/gf1/fx2/refresh.mjs --refresh` — 1, recorded refusal, no product edits.
       `node docs/evidence/gf1/au3/run-runtime.mjs docs/evidence/gf1/au3/runtime-01.json` — 0.
       `node docs/evidence/gf1/au3/check.mjs` — 0; `git diff --check` — 0; new-file120-column check — 0.
