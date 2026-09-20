# Problem statement 26011 — actual coverage, 21 September 2026

**The product aligns with the problem, but does not yet implement the whole solution.** A working 3D showcase is not a completed cadastral processing system. This audit combines the current T081 browser checks, T079 source/import tests and the explicitly historical T064–T068 saved-work evidence. Historical service demonstrations have not all been requalified in the current empty linked environment.

| Requested capability | Current evidence | Remaining work |
|---|---|---|
| Surface parcels and multistorey spatial identity | Source polygon/multipart/hole preservation, building/parcel relationships, floor records and searchable internal building/floor IDs in the shared map and register | Official 2D ULPIN assertions must come from source records. Internal DEMO 3D IDs are not standardized government issuance. Identity/version rules need end-to-end qualification across durable mixed imports. |
| Underground infrastructure, parking, air rights and other vertical interests | Utility alignments and example below-ground geometry; generic object/geometry relationships and source rights assertions | A line or visual extrusion is not a surveyed legal volume. General volumetric ownership, easement restrictions and overlapping rights need validated solids, heights/benchmarks and reviewed evidence. |
| GIS parcel layers | Declared GeoJSON/CSV, supplied MASTER and normalized source adapters; existing saved GIS intake | Arbitrary formats/CRSs and large bulk datasets are not covered by the bounded detail importer. GPKG originals in the complete package are retained; that package's map is derived from declared GeoJSON. |
| Drone imagery | Receipt and existing reviewed local imagery-contour assistance | General orthorectification, georeferencing and validated full-area extraction are not implemented by the new package preview. |
| LiDAR / 3D point clouds | Valid LAS/LAZ sample originals and fingerprints in the complete package | Automatic classification, building reconstruction and reliable floor/volume extraction are not delivered by this importer. |
| Building floor plans | Original plan documents, supplied floor polygons/schedules, shared floor views and existing reviewed plan-preparation paths | General automatic floor segmentation, calibration and unit delineation still require qualified extraction/review. A floor count cannot supply a missing boundary. |
| GNSS/CORS coordinates | Explicit named frames, source controls and benchmark checks in the sample | Production coordinate transformation, CORS validation and field accuracy qualification remain incomplete. Do not infer real geographic placement from local display coordinates. |
| DEM/DSM | Valid terrain/surface raster originals and source metadata retained | Automatic terrain registration, per-building base elevation assignment and datum reconciliation are not implemented in the new importer. |
| Automated building extraction | Existing local model/contour workflow with limited historical qualification | Needs consistent integration, failure/retry behavior and measured accuracy on representative supplied/real data. It is assisted draft geometry, not an authority. |
| Floor segmentation / vertical parcel delineation | Supplied exact geometry, schedules and reviewed preparation tools | No complete qualified ML pipeline from mixed source package to all floor/unit/underground volumes. |
| Intelligent topology validation | Computed polygon intersections, parcel overshoot and supported road-surface conflicts; unknown vertical relationships disclosed | Not a full solid topology engine or legal conflict decision. Source road centerlines are not silently converted to measured surfaces. Full 3D validation and accuracy tolerances need qualification. |
| Scalable, interoperable volumetric cadastre | Shared canonical adapter, source receipts, original hashes and renderer foundation; existing canonical services | Current detailed preview is bounded (100 buildings / 1,000 geometries / 2 km / 20 MB ZIP). Large-area processing and exchange conformance are not established. |
| Accurate governance, reduced ownership ambiguity and planning | Traceable source selection, residents separated from parties/rights, explicit missing evidence and review tools | These are intended benefits, not proven outcomes. Statutory acceptance, official issuance and multi-user production operation remain deferred. |
| Bulk officer workflow | Existing saved intake/preparation/review paths and new source-package preview | The new mixed package does not yet become a durable resumable batch or atomically record eligible connected subsets. T080 is the next planned integration task. |

## Priority after this navigation/import fix

1. T080: verified source receipts → durable batch identity → resumable processing → exact reviewed recording scope. Preserve originals, joins and IDs across reload/reimport.
2. Finish qualified adapters and named-frame/vertical reconciliation for raster, point cloud and floor-plan processing. Clearly report unsupported inputs.
3. Integrate and measure AI building/floor/vertical extraction, with officer correction and topology review before recording.
4. Qualify volumetric rights, scale and exchange behavior on representative data. Treat official identity issuance as a separate specification/acceptance requirement.

## Supplied Shiv Vihar boundaries

The supplied dataset itself identifies as synthetic. MASTER contains 31 parcels, 32 building footprints, 14 road/lane centerlines, 21 utility records and five supplied floor records with 26 schedule spaces. Missing residents, official 2D ULPINs, unit/floor boundary geometry and absolute building elevations remain missing. Decorative facades and display-zero placement are visualization, not extracted survey detail. Some metadata/point objects remain receipt-only under the current rendering profile. Import success does not change these limitations or turn the preview into a saved registry record.

References: `T079_WORKFLOW_AUDIT.md`, `T068_RESULT.md`, `apps/web/features/spatial/reference-import/PROVIDED_SOURCES.md`, and T081 result/evidence.
