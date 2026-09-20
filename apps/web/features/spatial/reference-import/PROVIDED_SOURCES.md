# Adapter for the supplied Shiv Vihar source formats

`normalizeProvidedDatasetFiles(files, {mode: 'master' | 'normalized'})` is a read-only normalization boundary. It returns `scene`, `normalizedText`, `originals`, `diagnostics` and `sourceManifest`. It does not write the database, assign legal rights, align terrain or replace a source polygon. The return scene goes through the existing `adaptReferenceScene` canonical `ulpin-spatial/2` adapter.

A ZIP can declare its mode in `provided-source-manifest.json`:

```json
{"schemaVersion":"ulpin-provided-source/1","mode":"master","classification":"synthetic"}
```

`manifest.json` separately fingerprints every ZIP member. No `normalized.json` is required: the scene is extracted from source JSON when uploaded. A standalone original MASTER JSON can use a one-file Map and explicit `{mode:'master'}`. This adapter is bounded to the actual observed v1 formats, synthetic classification and named local metre frames.

## Observed source mapping

The supplied [MASTER_SCENE.json](https://drive.google.com/file/d/1tiqqJaT-AwXj09YAIZUGG-x0TwKcOQoh/view) was metadata-read and inspected as JSON on 20 September 2026. Its scene is explicitly synthetic. The normalized folder was metadata-listed, then the four relevant JSON originals were retrieved and parsed. Authenticated connector download references returned HTTP 403 during local materialization; the same metadata-grounded Google Drive files were downloaded read-only using their Drive download endpoint. Returned byte counts matched Drive metadata. No remote files were edited or shared.

| Source | Exact fields used | Interpretation |
|---|---|---|
| MASTER scene | `scene_id`, `scene_name`, `scene_version`, `coordinate_reference_system` | Named engineering frame, metres, east/north/up; original vertical-reference text retained verbatim. |
| MASTER parcels | `id`, `geometry`, `building_ids` | Exact implicit ring. Appending the first vertex makes it explicitly closed without altering vertex positions/order. |
| MASTER buildings | `id`, `parcel_id`, `footprint`, `height_m`, `floors`, `usage` | Exact footprint and reported height/count; no building base elevation exists in the source. |
| MASTER roads / lanes | `id`, `centerline`, `width_m` | Exact source line and width claim; no buffered or bounding-box road polygon. |
| MASTER utilities | `drains[].centerline`, `poles[].location`, `other[].location` | Exact XY alignments / XYZ points retained. Unsupported 3D points remain unavailable to the current canonical inline renderer. |
| `normalized/parcels.json` | `schema: canonical.parcels.v1`, `canonicalParcelId`, `geometry`, `landUse` | Source canonical identity/rings retained. |
| `normalized/buildings.json` | `schema: canonical.buildings.v1`, `canonicalBuildingId`, `canonicalParcelIds`, `geometry`, `heightM`, `floorCount`, `useType` | Supports multiple parcel associations; exact normalized geometry. |
| `normalized/roads.json` | `schema: canonical.roads.v1`, `roadId`, `geometry`, `widthM` | Source line geometry, not measured road surface. |
| `normalized/floor_spaces.json` | `schema: canonical.floor-spaces.v1`, `buildingId`, `floorId`, `level`, `unitId`, `areaSqM`, `geometryReference` | Building-scoped floor/unit identities and stated areas. `geometryReference` explicitly says no unit polygon source exists; floor and space geometry remains null. |

The normalized files do not carry a vertical datum. They therefore require the original MASTER file as frame context and retain its text `local assumed mean sea level`. The adapter does not substitute the different control-point benchmark or treat it as a national datum. All building canonical base elevations stay null. The source's 98.1–103.9 m terrain range is not a per-building elevation or terrain surface. Any renderer placement at a visual zero is display-only, not a volume or collision measurement.

## Identities and unprovided fields

Original object IDs are preserved. Source floor IDs such as `F00` and unit IDs such as `GF-S01` are local to a building, so internal records use reversible building-scoped IDs while retaining `sourceFloorId` and `sourceUnitId` verbatim. The user's requested internal demo identifiers are generated separately as `DEMO-3D-<source-building-id>` and `<building-demo-id>:<supplied-level>`. Assertions explicitly record `status: fictional`, issuer `app_demo_identifier` and `notExtracted: true`.

No official parcel 2D ULPIN or resident data was present in these inspected files. Neither is invented. MASTER floor counts do not establish explicit floor levels/boundaries; only supplied schedule rows create floor records. Open areas, vegetation, parking, terrain, appurtenances, vehicles and community features remain in the preserved receipt with an explicit unsupported-section report. A vacant plot is not relabelled public land or public ownership.

## Actual source verification

Two uploadable local test packages are available:

- `/reference/provided-master.zip`: 31 parcels, 32 buildings, 14 road/lane lines, 21 utility records, 5 supplied floors and 26 schedule-only spaces; 129 canonical entities.
- `/reference/provided-normalized.zip`: 31 parcels, 32 buildings, 8 road lines, 5 supplied floors and 26 schedule-only spaces; 102 canonical entities. MASTER geometry is retained as context rather than merged as a duplicate representation.

Both contain five byte-unchanged originals plus the new profile and integrity manifests. Both were passed through `normalizeProvidedDatasetFiles` and the canonical adapter. The first package includes source utility points that the current renderer cannot display; entity count is not a rendered-solid count. Actual verification reports remain under `.runtime/provided-master-report.json` and `.runtime/provided-normalized-report.json`.

| Original | Bytes | SHA-256 |
|---|---:|---|
| MASTER_SCENE.json | 24,120 | `b950642dab6dada2a33e79d7bc5963ded2e46bbcbe88947320e9aeb8953415c4` |
| normalized/buildings.json | 55,610 | `9ac2b1cd3dc82acbb383f44bfccbc8595625552dae2f7bf9edf95bb5ddcc7532` |
| normalized/parcels.json | 44,425 | `ba96b658ec2c3d9edcc4a056a33cef68cc30016df12923939db5359e24e4e0f3` |
| normalized/floor_spaces.json | 31,998 | `67d294a76514df415e5692a80aa93a436b3a299865cdcc7b414a580bd78a167e` |
| normalized/roads.json | 4,832 | `3dfb40b19263962f6e7e66a32260e13498d08a01b2bd45b1e541ec7525ffd564` |

Focused tests use an independently authored fixture with the actual observed field names, renamed object IDs, repeated building-local floor/unit IDs, missing base elevations and explicit unsupported geometry. Run `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/t076-provided-source-adapters.test.ts`.
