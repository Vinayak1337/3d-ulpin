# Supplied source inventory

Inspected 20 September 2026 through the authenticated Google Drive connector, read only. Entry point: [supplied folder](https://drive.google.com/drive/folders/1ziJNcxowBVpWT-cdWivwdrqbDK9-OfAn). Its root contains `Shiv_Vihar_3D_ULPIN_Dataset_Report.docx` and `dataset/`. No data was imported into the application or service volumes.

## Evidence and limits

This is **synthetic source material**, not a real field survey. The parsed [MASTER_SCENE.json](https://drive.google.com/file/d/1tiqqJaT-AwXj09YAIZUGG-x0TwKcOQoh/view) explicitly describes a synthetic, technically plausible Delhi colony. Its `scene_id` is `SV-MASTER-001`, revision `1.0.0`, with local scene coordinates. Buildings have `geometryStatus: existing_synthetic`; the point-cloud manifest describes deterministic synthetic sampling; the imagery metadata describes a deterministic source render. The word “authoritative” within these source documents means their own fixed synthetic baseline, not cadastral or legal authority.

Metadata listing preceded content access. JSON was parsed as JSON and CSV read as delimited text. No binary was read as text. Binary headers, raster values, point coordinates, visual PDF contents and the DOCX report were **not independently inspected**. The producer's validator was not executed. Counts below distinguish parsed records from producer report claims. Folder listings were bounded at 100 entries; the listed immediate directories fit that bound. `tmp/` and `validation/conflict-cases/` were discovered but not traversed.

## Files whose contents were inspected

Paths are relative to `dataset/`; exact filenames are preserved.

| File | Direct observation | Normalization implication |
|---|---|---|
| `MASTER_SCENE.json` | Keys include scene ID/version/status, CRS, roads, lanes, parcels, buildings, open areas, vegetation, parking, utility features, community structures, appurtenances, vehicles, terrain and constraints. `LOCAL-SHIV-VIHAR-DEMO`, metres, 0–400 m extent; vertical reference text is “local assumed mean sea level”. | Preserve the original frame text and object keys. Do not infer EPSG, WGS84 placement or a national vertical datum. |
| `lake-view-parcels.geojson` | 96 features; custom named local CRS; first parcel properties include `layer`, `parcel_id`, `source_parcel_id`, `block_id`, `area_sq_m`, `land_use`, `occupancy_type`, `building_ids`, `boundary_status`, `source_revision`. Polygon ring is closed. | Treat as local vector coordinates, not longitude/latitude. Preserve complete raw properties and source layer/feature locator. |
| `gnss-cors-survey-control.csv` | Columns `point_id, point_type, x, y, z, horizontal_accuracy_m, vertical_accuracy_m, coordinate_frame, vertical_reference, observation_datetime, monument_description`. | Preserve observation time, accuracy, and benchmark text separately from geometry. “GNSS” in a filename does not make these synthetic observations genuine. |
| `plans/SV-B-029-floor-schedule.csv` | 26 schedule rows, building `SV-B-029`, parcel `SV-P-028`, five floor IDs F00–F04; unit IDs/types, stated area, level, room/bedroom/bathroom counts. | Schedule claims do not supply unit boundaries. Counts remain source assertions, including unusual room/bedroom combinations. |
| `lidar/shiv-vihar-pointcloud-manifest.json` | LAS 1.4/format 7, 261,000 points; bounds [0.05,0.05,98.164]–[399.95,399.95,121.277], density 1.6313 points/m²; classes 2/3/4/5/6/7/11; deterministic synthetic generation method. | Store manifest claims with source locator; do not present them as independently parsed binary header results. Scale/offset not supplied here remain unknown. |
| `normalized/parcels.json` | `canonical.parcels.v1`; 31 records; canonical/source IDs, block ID, geometry, area, use, occupancy, building IDs, source assets, revision, review status and provenance. | Existing IDs survive ingestion through namespaced source keys; never derive identity from row order. |
| `normalized/buildings.json` | `canonical.buildings.v1`; 32 records; array `canonicalParcelIds`, polygon, footprint area, height, floor count, type/use, basement, source and supporting asset IDs, revision/status/provenance. | Parcel membership is many-to-many, separate from physical geometry. Height is an observation and an extrusion input, not identity. |
| `normalized/floor_spaces.json` | 26 records; `buildingId, floorId, floorName, level, unitId, unitType, areaSqM, sourcePlanFile`, counts and provenance. `geometryReference` contains **building** footprint and explicitly says no unit polygon source exists. | Create floor/space identity and a stated-area observation; space geometry stays null until genuine geometry evidence is supplied. Never reuse the building footprint for every unit. |
| `normalized/source_assets.json` | 14 assets with source paths, format/type, byte size, SHA-256, source revision, provenance and processing step. | Keep source file revisions and byte fingerprints immutable; claimed hashes have not been recomputed against original bytes during this inspection. |
| `normalized/control_points.json` | Nine control records; XYZ, accuracy, named frame, vertical reference, time, source asset and provenance. Benchmark text is `SV-VD-01 assigned local datum (100.000 m)`. | Preserve this separately from the master's different vertical-reference wording; require reviewed alignment before quantitative comparisons. |
| `normalized/dataset-links.json` | Array `relationships` with `fromId, relationship, toId`; e.g. `contains_building`, `covered_by_asset`. | Stable relation IDs, evidence and validity can be added; do not flatten membership into one mandatory parent column. |
| `normalized/elevation_surfaces.json` | Two records. DEM/DSM 400×400, 1 m pixels, [0,0,400,400] bounds. DEM datum is assigned local datum; DSM datum is **null**. Min/max are metadata claims. | Keep native raster header/geotransform and vertical datum distinct. Bounds/resolution alone do not prove pixel orientation or a complete affine transform. |
| `normalized/imagery_assets.json` | GeoTIFF 800×800 at 0.5 m pixels, local frame, acquisition time null, deterministic render. JPEG preview has null coverage/resolution/frame and `non_authoritative_preview`. | Preview is display-only; do not invent acquisition time or map placement. Exact affine geotransform was not observed. |
| `normalized/lidar_assets.json` | LAS and LAZ representations share manifest counts/classifications/bounds; LAZ marked compressed equivalent; named local vertical datum. | Link equivalent representations without deduplicating away originals. No coordinates were independently read. |
| `normalized/normalization-report.json` | Reports 14 processed sources, 31 parcels, 32 buildings, 26 floor spaces, 8 roads, 9 controls, 2 imagery, 2 LiDAR, 2 elevation surfaces, 233 relationships. Explicit warnings: preview non-authoritative, DSM datum unknown, no unit polygons. Utilities/open areas skipped. | These gaps define adapter/review requirements, not safe default values. Report assertions are not fresh validation. |
| `validation/final-report.md` | Producer reports 37 readable files, seven segregated controlled conflict cases and overall WARNING; confirms missing DSM datum/unit polygons. | Controlled test conflicts remain separate from baseline records. We did not rerun these tests. |

## Metadata-only discovery

The root DOCX report was metadata-read: Office Open XML document, 50,176 bytes. It was not summarized from its title. The following exact dataset entries were listed but their contents were not opened:

- Root: `validate_dataset.py`, `build_conflict_cases.py`, `build_normalized_model.py`, `generate_floor_plans.py`, `gnss-cors-survey-control.gpkg`, `shiv-vihar-survey-control-report.pdf`, `lake-view-parcels.gpkg`.
- `plans/`: `floor-plan-manifest.json`, `SV-B-029-floor-plans.svg`, `SV-B-029-ground-floor.pdf`, `SV-B-029-first-floor.pdf`, `SV-B-029-second-floor.pdf`, `SV-B-029-third-floor.pdf`, `SV-B-029-fourth-floor.pdf`.
- `lidar/`: `shiv-vihar-pointcloud.las` (9,396,375 bytes), `shiv-vihar-pointcloud.laz` (2,892,298 bytes).
- `imagery/`: `shiv-vihar-orthomosaic.tif`, `shiv-vihar-orthomosaic-preview.jpg`.
- `elevation/`: `shiv-vihar-dem.tif`, `shiv-vihar-dsm.tif`.
- `normalized/`: `roads.json`, `README.md`.
- `validation/`: `final-consistency-report.json`, `conflict-summary.json`, `conflict-test-readme.md`, `test-conflicts.json`, `floor-plan-validation.json`, `conflict-cases/`.

## Proposed fields versus observed fields

`schema.json` is a **new proposed exchange contract**, not a schema claimed to exist in Drive. UUID-capable opaque IDs, source record IDs, immutable geometry version IDs, lineage fingerprints, identifier assertions, rights, batch state and issue objects are additions. The source includes some corresponding concepts under different names. The source GeoJSON's `block_id: SV-BLOCK-A` and normalized parcel `blockId: SHIV-VIHAR-A` are different strings; retain both as observations and review equivalence rather than silently merging by label.

`demo-data.json` is a separate fictional neighborhood authored for the interface. None of its coordinates, unit outlines, object labels or utility route is claimed to have been extracted from Drive. Its seven source descriptors are not seven downloaded original files. Three contain embedded fictional records; four are clearly metadata-only demonstrations, with no fabricated original hash, URI or byte count. No official ULPINs were found or issued by this work.
