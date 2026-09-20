# T064 result — file-first GIS intake

Implemented and parent-reviewed 20 September 2026. User acceptance is not inferred.

The intake reads actual original bytes before presenting details. GeoPackage/Shapefile declared CRS and layer/column metadata, GeoJSON Feature IDs and ArcGIS declared coordinates drive safe defaults. Officers explicitly confirm boundary meaning and source origin; missing/ambiguous values remain questions. Each native layer gets a deterministic identity namespace, and original bytes pass unchanged to existing draft review. Detailed mappings and utility configuration remain under advanced settings. Import/export mode tabs were removed; export remains its own task.

Parent review corrected layer identity collisions, overbroad ID-name inference, Feature-ID handling, duplicate boundary questions and mode tabs. The reference composition is implemented within the existing modal for this bounded task; unified routed file intake remains T066.

## Evidence

- Final private inspection/native/area regression suite: **92 passed** (mounted current source in ephemeral test container).
- Public inspection/identity tests: **11 passed**; final typecheck passed.
- Production build passed; geo/worker rebuilt and app restarted with the final implementation.
- `node scripts/ux/verify-intake.mjs`: **9 browser check groups passed**, no browser page errors. Actual projected GeoPackage creates a retained review draft, original download SHA256 matches file bytes. No recording performed. Multi-layer selection, missing ArcGIS CRS, Feature IDs, malformed input/recovery, advanced mappings, tablet layout and Escape closure checked.
- Screenshots and exact fixture receipt: `docs/evidence/t064/results.json`, `01-empty-intake.png` through `05-tablet-intake.png`. Compared against corrected `design/officer-studio-v3/05-add-files.png` by actual image inspection. Remaining modal vertical density/full-page alignment belongs to T066.

Malformed/missing native CRS requires source repair per the existing native ingestion contract. Native coordinate references are not invented. Mixed GIS/document batches are not yet claimed. One new explicitly fictional source draft is retained for reproducible qualification; existing records were not changed.

Next: T065, persisted preparation continuation and focused source review. See worker report for implementation file list.
