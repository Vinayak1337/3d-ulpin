# LR3 step 0 — where a feature's heights would travel

Base: staging `7405ea74`.

## `sourceGeometry`: built and kept
- Built: `services/geo/geo/area.py:427` — `"sourceGeometry": copy.deepcopy(original)`, a copy of the feature's
  `geometry` member as the file writes it, before `_geometry` reads it. `_geometry`'s `position()` returns new
  `[x, y]` lists for the shape and never writes into `original`, so a 3D file's `sourceGeometry` keeps every
  height exactly as written. (`native_gis.py:341` sets it for GeoPackage/Shapefile; not touched.)
- Kept: the normalised feature goes into the package body (`areas.ts` `persistPreparedAreaImport`) and the
  committed feature body; sent to the officer only where not stripped.
- Stripped (not sent): `area-intake-service.ts:32` (`contextFeature`), `spatial-core-read.ts:40`,
  `apps/studio/src/local/sources.ts:43`. Set to `null` for geometry-free values: `source-building-values.ts:41,70`.
- Compared: `areas.ts:407` (`importedGeojsonRanges`) and `areas.ts:572` (`remapProvedPartIndexes`) compare the raw
  feature's `geometry` deep-equal with `sourceGeometry`. Both sides are the file's own geometry (the raw row and its
  untouched copy), so a third number is on both sides and the comparison still holds. Same for
  `scripts/verify-area.ts:97`, `scripts/usp/manual-mapping-smoke.mjs:101`, `scripts/verify-block-membership.ts:43`.
- Other names that look alike and are not this member: `datasets/reference-import/render-scene.ts:10`,
  `registry/cityjson-validation-processor.ts:20,43`, `spatial-ml-source.ts:112`, `scripts/demo-import/normalize.py:87`
  (builds its own from the NYC file). None would change with a 3D `sourceGeometry`.

## Readers of a feature's `height`
- server: `areas/areas.ts:959-960,999,1027-1034,1103-1126,1159,1498-1535`; `areas/canonical-area.ts:60,67`;
  `officer/officer-preparation.ts:282`; `officer/officer-investigations.ts:334,645`;
  `registry/canonical-building.ts:272-283,708`; `registry/registry.ts:644`; `spatial/spatial-core-read.ts:64`;
  `spatial/legacy/area-compat-adapter.ts:47`; `spatial/legacy/core-display.ts:64`;
  `spatial/legacy/core-legacy-adapter.ts:120,149,184`; `usp/ingestion/intake-targets.ts:39`;
  `usp/ingestion/sufficiency-context.ts:93`; `usp/ingestion/sufficiency-policy.ts:93`.
- studio: `features/map/footprints.ts:30,35`; `features/map/heightBands.ts:24-25`;
  `features/map/inspector/AreaInspector.tsx:19`; `features/map/inspector/BuildingInspector.tsx:51-71`;
  `features/map/inspector/evidence.ts:11`; `local/public.ts:36,134`; `local/sources.ts:79,95`.
- scripts: `db/serving-nyc-import.ts:88`; `demo-import/plugin.mjs:30`; `ml/verify-workflow.ts:216,275`;
  `usp/data/import-d1.ts:148`; `usp/manual-mapping-smoke.mjs:100`; `uttam-nagar/import-osm-reference.mjs:51`;
  `ux/verify-complete-journey.mjs:15,27`; `ux/verify-source-workflow.ts:37`.
- Every one reads `feature.height` (`value`, `state`, `reference`, `unit`, `evidence`, `originalValue`); none reads
  a member beside it. The new `sourceHeights` member is read by nothing (`grep sourceHeights` finds no reader), so
  no measurement, drawn height or card value changes.

## C.1 — the draft step's refusal path
`intake-large-worker.ts` `draftCut` → `intake-part-draft.ts` `draftIntakePartTx` → `areas.ts` `ingestProvedAreaPart`
→ `normalizeAreaImport` → `areaGeo('normalize')`. The geo service answers an `InputError` with 422 and its words
(`services/geo/geo/api.py:128-129`); `areaGeo` (`areas.ts:109-116`) throws `AppError(422, 'AREA_PROCESSING', detail)`;
a 5xx becomes `AppError(503, 'AREA_PROCESSING')`; a timeout or network fault is a plain error. A cut whose features
are all rejected throws `AppError(422, 'GIS_ALL_GEOMETRIES_REJECTED')` (`areas.ts:557`). The error leaves `step`, and
`fail` (`intake-large-worker.ts:267`) asks `intakeLargePartRefusal(code)` (`intake-large.ts:90`), which knows only
`PART_INTEGER_IDENTIFIER`; anything else is re-queued until attempt 3, then `INTAKE_LARGE_STOPPED`.

## C.2 — the 422 path of the resolver
`streaming-vector-worker.ts:234` → `streamed-map-receipt.ts:35` `resolveStreamedReference` →
`areaGeo('resolve-geojson-crs')`. Lines 41-44 turn every 422 into `STREAMING_SOURCE_CRS`; the reader's catch
(`streaming-vector-worker.ts:256-266`) treats any 413/422 as structural and ends at once. The route's 422 comes from
`InputError`, `KeyError`, `TypeError` or `ValueError` (`api.py:128`); the resolver's own refusals of a declaration
all begin with the label `The file's crs member declares ` (`area.py` `_geojson_crs`, every `_crs` message is
prefixed with it). LR2's first walk met the other kind: a stand-in's 422 for an operation it did not serve.

## C.3 — where the 438 codes are lost
Not lost by the reader: each set-aside record keeps its code in its chunk object (`records[].issueCode`,
`streaming-vector-worker.ts:217,222`; schema `contracts/src/usp/streaming-vector.ts:53`). The slot row is written by
`storeChunk` with `issueCode:null` for every chunk (`streaming-vector-worker.ts:56`); only a failure's end marker
carries a code (`:96-103`). LR2's harness summed `usp_streaming_vector_slots.issue_code`, hence `code: null`.
The receipt (`StreamedMapOriginalReceiptSchema`, `contracts/src/usp/ingestion.ts:95`) is a strict object with only
`quarantined` as a total; `sealedMapReceipt` builds it from slot rows (`streamed-map-receipt.ts:54-80`). Carrying
codes needs a new receipt member (a contract schema change) or per-code slot columns (a database change).
