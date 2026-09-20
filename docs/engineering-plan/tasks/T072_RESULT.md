# T072 — Reference-style interactive neighbourhood map

Status: implemented; user visual acceptance remains open. Local prototype milestone, 20 September 2026. No live application seed, product viewport replacement, commit, push or deployment.

## Delivered

`design/reference-map-v5/`, served on localhost:3013, contains a new 180×180m fictional neighbourhood: 28 buildings and parcels, four intersecting street corridors, two parks, six focal floor objects, sixteen spaces and two utility alignments. B01 has five above-ground floors plus a basement; B12 has a footprint and no invented height.

The renderer now follows the reference's residential proportions and oblique neighbourhood composition with recessed windows/balconies, parapets/roof details, textured ground, connected road junctions, crossings, plot walls, authored vehicles, paths and instanced leaf canopies. Actual polygons/holes remain the analytical source. Decorations do not create geometry claims. Orthographic 2D, close focus, search, layers, floor/space isolation, separation, section cuts, underground view and view restoration work. WebGL loss falls back to readable/searchable records and restoration resumes rendering.

The focused shell has one property inspector and on-demand source/import panels. The full source ZIP actually opens in the browser: it verifies 13 file digests and sizes, checks normalized geometry/measurement/frame/link constraints and cross-checks original source fingerprints. Imports remain session-local. Failed imports preserve the current map. Mixed frames, unsupported axes/units, missing utility depth, extreme dimensions/floor counts, malformed decorations, self-intersections and inconsistent declared areas are rejected. Missing road geometry stays unavailable rather than crashing.

The source-like bundle includes six WGS84 GeoJSON files, floor/control CSVs, normalized local-metre JSON, schema, local master, mapping and manifests. Every source feature is reconstructed from actual generated source bytes. The source Drive specimen informed structure only; these are independent synthetic shapes. Exact limits and mappings: `design/reference-map-v5/DATA_PACKAGE.md`.

## Visual evidence and assessment

- `design/reference-map-v5/comparison.html`: supplied image and actual render side by side, previous map comparison, close-up, 2D/floor/basement/import captures.
- `evidence/t072/reference-comparison.png`: browser capture of the side-by-side comparison, inspected by the parent.
- `evidence/t072/map/00a-initial-massing.png`, `00b-massing-camera-check.png`, `00-massing.png`: neutral geometry/camera checkpoints.
- Final views are in `evidence/t072/map/01-opening.png` through `10-webgl-fallback.png`, plus tablet.

The new map corrects the prior oversized shallow massing, disconnected parallel streets, sparse landscaping and distant composition. It has an operable geometry-driven scene and a cleaner inspector than the supplied image. It remains more stylized than the supplied photographic-looking reference; texture realism/pixel parity is not claimed and functional tests do not substitute for user visual acceptance.

## Verified

- Map browser suite: 17 checks, zero page errors (`evidence/t072/map/results.json`).
- WebGL context loss, record search during loss and resumed rendering: 3 checks (`context-loss.json`).
- Import/records/mobile: 11 checks, zero page errors; no requests to port3000 (`evidence/t072/upload-results.json`).
- Upload contract: baseline JSON/ZIP accepted, unavailable road skipped; malformed frame/geometry/evidence conditions rejected (`upload-contract-results.json`).
- Python source validation: all 86 objects round-trip, eight actual source files, hashes/ZIP/strict schema/topology/containment checked. Maximum transform agreement error ~1.98×10⁻⁹m is numerical agreement for fictional data, not survey accuracy.
- Existing app pure GIS functions accepted 28 buildings, 28 parcels, four roads, two public-land areas and two utilities. No live imports. Floor/space adapter remains package-specific; arbitrary ZIP is not passed to the application's Shapefile ZIP handler.
- Local existing application: `/api/v1/areas` returned `[]`; work queue total remained 0.

## Performance

Apple M3 / ANGLE Metal, headless Chromium 153, 1120×845 canvas DPR1. Opening: 570 calls, 195,791 triangles. Direct continuous OrbitControls auto-rotation over 2201ms, without mouse-protocol pacing: 65 RAF intervals averaging 33.33ms, p95 33.4ms (~30Hz). CPU render submission: 4.25ms average / 6.4ms p95. Actual automated mouse orbit cadence was ~29.6Hz. Idle rendering stops; shadows are cached and invalidated by scene changes. These are measured local results, not portable FPS guarantees or hosted-fixture evidence.

## Remaining boundaries

Production shared-viewport integration, statutory identity generation, full processing/review, ML, LiDAR/imagery/DEM/native-solid ingestion and hosted/real-survey qualification are outside this prototype milestone. The existing main app remains empty. Previous port3012 reference remains preserved. The next product integration should adapt these modules to the shared viewport rather than create another page-specific production renderer.
