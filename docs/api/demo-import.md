# NYC full-map demo upload

User-scoped demonstration adapter, 27 September 2026. **Real uploaded source data; fixed normalization rules; real SSE delivery.** This is not the production ingestion, ML, registry or scale gate. No real registry writes or provider calls occur. `packages/scene` and the map geometry adapter are unchanged.

## Run tomorrow

1. Keep Docker and the existing `ulpin-geo-1` container running (Shapely 2.0.7, pyproj 3.6.1). Keep the ordinary API on 3188 for the surrounding Studio shell. No database reset or reseed is needed.
2. From the repository root run `pnpm studio:demo`. It binds Studio to **127.0.0.1:5188**. Stop any previous owned Studio listener first; do not kill Claude's separate preview.
3. Open **Add files**. Select the five GeoJSON files below, optionally with the three registered multimodal extracts, or use the combined ZIP. Continue → Start import. A fresh area opens; surfaces arrive first, then buildings. The import notice reports repairs/rejections. Click Done to reclaim the map height.
4. Search `751920` to show the repaired building. Its source roof height is 47.00969814 ft (14.32856 m). Windows/trees/markings in Enhanced view remain illustrative.
5. Reloading the area's URL restores the saved local projection. Uploading again creates a fresh area so the streaming demonstration can be repeated.

Input directory: `/Users/vinayak/.codex/task-data/nyc-zcta-10013-context/`.

- ZIP: `nyc-10013-official-context.zip`
- Or select `layers/buildings-original.geojson`, `layers/roadbed.geojson`, `layers/sidewalk.geojson`, `layers/parks.geojson`, `layers/hydrography.geojson` together.

The ZIP's prepared layers are selected, not its duplicate acquisition originals. All uploaded ZIP bytes are retained. The already-prepared roadbed excludes one invalid source road feature; this adapter does not silently claim that excluded feature was uploaded as a prepared surface. See that pack's README and manifest.

## Fixed profile and output

| Uploaded source | Count | Existing renderer style |
| --- | ---: | --- |
| [NYC buildings](https://data.cityofnewyork.us/d/5zhs-2jue) | 1,662 | Recorded footprint and roof height |
| [Roadbed](https://data.cityofnewyork.us/d/i36f-5ih7) | 446 | Road surface |
| [Sidewalk](https://data.cityofnewyork.us/d/52n9-sdep) | 213 | Paved surface, using road material |
| [Parks/Greenstreets/courts](https://data.cityofnewyork.us/d/y6ja-fw4f) | 41 | Green surface or paved court |
| [Hydrography](https://data.cityofnewyork.us/d/pjs3-c3z5) | 1 | Water |

All **2,363** prepared features are delivered. Profiles and exact SHA-256 hashes live in `scripts/demo-import/nyc-profile.json`. The adapter rejects other bytes, rather than pretending to understand arbitrary GIS. The user explicitly authorized these reused materials for this demo. `properties.sourceLayer`, `sourceSubtype`, original fields and `sourceGeometry` retain the real classification. `kind` on the **display projection** chooses an existing renderer material; it is not a canonical registry reclassification. Actual source names alone become surface labels. Source IDs are not issued ULPINs.

All layers transform from EPSG:4326 to EPSG:32618 and subtract one shared projected origin derived from the upload. Height is `height_roof × 0.3048`; ground elevation remains source metadata because its vertical datum is unqualified. Context surfaces have no qualified elevations. No terrain, floors, ownership, trees or utility records are invented.

The invalid building `751920` is repaired on a derivative using Shapely `make_valid`. A repair is accepted only if it yields valid polygon geometry and passes tight area/boundary preservation checks; otherwise it is quarantined. The checked polygon has **0 m² area delta and 0 m boundary Hausdorff distance** in the analysis CRS. Its original geometry is retained, and `properties.geometryRepair` plus the import notice record the repair. This is a display repair, not survey certification or an edit to the prior real-backend package.

## API and stream contract

The development-only Vite module is `scripts/demo-import/plugin.mjs`; normalization is `normalize.py`; the frontend transport/cache integration is `apps/studio/src/api/demo-import.ts`. Enable both `ULPIN_DEMO_IMPORT=1` and `VITE_DEMO_IMPORT=1`, with `VITE_LOCAL_DATA=off` (the npm command sets them). Ordinary `pnpm studio:dev` and production builds do not enable the module.

- `POST /api/demo/inspect`: multipart `file`; returns profile/count/hash/CRS. Read-only.
- `POST /api/demo/imports`: multipart repeated `file`, optional opaque `intent`; returns `{id, areaId}`. Same intent plus same uploaded hashes is idempotent; a new upload uses a new intent.
- `GET /api/demo/areas`: local demo area summaries.
- `GET /api/demo/areas/{areaId}/events`: actual `text/event-stream`. On connect/reconnect it sends a current atomic `snapshot`; subsequent events are `metadata`, `chunk`, `complete`, or `failed`. Every event has a monotone SSE `id`/`sequence` and package status. A chunk contains at most 96 normalized features. Snapshot replaces the cache; deltas append once, preventing replay duplication.
- `POST /api/demo/areas/{areaId}/ack`: browser acknowledges applying a chunk; bounded backpressure, not an invented progress timer. Processing starts with the first stream subscriber. After disconnect, processing may finish and a later subscriber receives the saved snapshot.
- Existing `GET /api/v1/areas/{id}/context`, `/import-packages/{id}`, `/buildings/{id}/register`, `/sources/{id}/file` are served by the local adapter **only for its reserved `d30d…` IDs**. Other IDs still use Nest. Context returns unrecorded `displayFeatures`; the canonical `features` list stays empty. Empty registers do not assert ownership or floors. Unsupported capabilities/mutations are rejected.

This separate development contract intentionally does not change the production OpenAPI schema. Upload max 32 MiB, expanded ZIP max 64 MiB; loopback/same-origin only. State, original uploads, exact per-layer source bytes, repair receipts and event-count journal are stored outside Git under `~/.codex/task-data/nyc-stream-demo` (override with `ULPIN_DEMO_DIR`). A mid-process server restart is reported as failed; re-upload to retry. Completed areas survive restart.

## Checked

- Studio typecheck/build passed; existing large-bundle warning remains.
- Browser: five-file upload and ZIP upload, import progress/completion, all layers in map, repaired building search/selection, and completed-area reload.
- ZIP run: 25 real feature chunks, 96 features in the first chunk, 2,363 unique final IDs; metadata to completion approximately 6.1 seconds on this machine. This is a demo observation, not a performance qualification.
- All five retained source hashes match the uploaded profile. Unsupported official boundary file returns HTTP 400 with a clear profile error.
- UI design scan (adapted to Studio) found no candidates; no renderer or styles changed.

## Same-area multimodal upload (27 September)

Prepared download: `/Users/vinayak/.codex/task-data/nyc-10013-multimodal/nyc-10013-multimodal.zip` (14,621,643 bytes). It contains the five existing vector layers and three bounded extracts. Separate-file upload also works: select those five GeoJSONs plus the three files in `nyc-10013-multimodal/upload/` together.

| Input | Actual contents | Normalization / fusion |
| --- | --- | --- |
| `nyc-10013-lidar-2017.laz` | 1,726,222 measured returns; classes 1 (unclassified), 2 (ground), 17 (bridge deck); EPSG:6347 + NAVD88 metres | Chunked LAZ reading; footprint spatial join; measured Z/count summaries for 90 buildings. These mixed returns are not roof heights. |
| `nyc-10013-dem-2017.tif` | 757,952 native pixels, 1 US-survey-foot horizontal grid, EPSG:2263 | Ground samples at 82 footprint interior points. Vertical unit/datum remains unqualified from the header; raw values never replace building heights. |
| `nyc-10013-ortho-2018.tif` | 768 × 768 RGBA pixels, EPSG:3857, nine official NYC imagery tiles | Source-pixel samples at 93 footprint interior points. No invented facade textures or geometry. |

Coverage is approximately `[-74.0125, 40.7165, -74.0095, 40.719]`, with native rectangular/tile-grid extents recorded per asset. **It is a small overlapping subset, not full-ZCTA LiDAR/DEM coverage.** Capture vintages differ. No official same-area drone acquisition was found.

The point reader also emits a downloadable 2 m maximum-observed-Z raster (18,189 populated cells, 271 empty). Withheld/noise classes are excluded, empty cells stay nodata, and no interpolation occurs. This is a derived observed-surface grid, not an independently acquired official DSM or a certified terrain/roof model.

`scripts/demo-import/multimodal.py` reads the uploaded binary bytes. It adds `properties.spatialObservations[]` to existing buildings and `supplementalDatasets[]` to area context/SSE metadata. Existing vector geometry and source heights remain unchanged. **The current map does not draw raw point clouds, terrain or draped imagery.** Binary assets are served as downloads through the dataset catalogue, not sent into the existing text evidence viewer. Upload and completion notices explain this limit.

Additional local API contracts:

- `GET /api/demo/areas/{areaId}/datasets` → `{areaId, state, datasets, sources}`. Each dataset has its uploaded hash, source/download URLs, role/format, survey year, actual CRS/bounds, matched-building count and point/raster metrics. Point-cloud reports include `derivedSurface` with its hash, recipe, resolution, nodata counts and download URL.
- `GET /api/demo/areas/{areaId}/surface` → derived GeoTIFF attachment (404 when absent).
- `GET /api/v1/sources/{sourceId}/file` → unchanged uploaded bytes with a binary attachment content type for LAZ/TIFF.
- `spatialObservations[]` records `sourceId`, `kind`, `captureYear`, and either point counts/Z statistics, a raw DEM sample with unqualified vertical reference, or an RGB source pixel. All are evidence observations, never canonical rights, floor or height facts.

Binary processing uses an isolated Python environment, already installed at `~/.codex/task-data/nyc-10013-multimodal/venv/bin/python`. Set `ULPIN_DEMO_PYTHON` to override. Recreate it with `python3 -m venv <path>` and `<path>/bin/pip install -r scripts/demo-import/requirements.txt`. Ordinary vector-only uploads retain the existing Docker reader. Production builds still exclude this module.

Acquisition recipe: `scripts/demo-import/prepare-multimodal.py <private-output-directory>`. Retained manifest contains original URLs, bytes/hashes, acquisition date, coordinate systems and recipes. Full NOAA source tile and original NYC PNG tiles are retained unchanged. The 674 MB DEM was accessed by HTTP byte ranges; only its exact native-grid crop is retained locally, **not the whole original TIFF**. No broader public redistribution licence is asserted.

Checked: eight-layer ZIP through HTTP/SSE (25 chunks, 2,363 unique vector features, approximately 10 seconds locally); binary-only import rejects with an instruction to include map geometry; Studio build/typecheck; separate-file browser upload. These are bounded demo checks, not production ingestion/scale qualification.
