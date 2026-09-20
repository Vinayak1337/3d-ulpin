# T074 — schema, scene compiler and renderer audit

Date: 2026-09-20. Read-only audit of the current checkout. No implementation, product seed or schema migration performed. Scope: preserving one data contract across visually different showcase neighbourhoods while rebuilding the reference map presentation. Existing tests were inspected; they were not rerun as part of this audit.

## Conclusion

Different arrangements do not require different cadastral schemas. Dense attached buildings, detached houses, road intrusions, courtyard buildings and overlapping parcels can share stable identities, versioned representations, explicit coordinate frames and evidenced relationships. The current prototype already computes polygon conflicts from geometry, rather than assigning red to a building ID. It does **not** yet support every arrangement or constitute the product's shared renderer.

There are three distinct boundaries in the checkout:

1. `design/reference-map-v5/`: standalone browser Three renderer, bespoke normalized fixture JSON and ZIP reader. It is isolated from the database.
2. Product `features/spatial/MapViewport.tsx`: source-discriminated Cesium viewport with area, local-model and tiles adapters, common engine factory, compiler and layout resource/session services.
3. Product `features/studio/scene/SharedViewport.tsx`: separate R3F canvas lease provider used by Studio scenes. `features/studio/product/SavedSceneViewport.tsx` uses the Cesium `MapViewport` for saved publications. `StudioApp.tsx` wraps both `SpatialDataProvider` and `StudioViewportProvider`.

Therefore, “one shared viewport” is an architectural direction with implemented components, not evidence that the new standalone reference renderer is already integrated everywhere. Do not copy the standalone renderer into each officer page.

## What the standalone importer actually accepts

Evidence: `upload.js:3` (`validateScene`) and `upload.js:42` (`readPackage`), `data/schema.json`, `app.js:9`.

- JSON must already be a normalized scene. Raw GeoJSON, CSV, GPKG, LAS, DEM and `MASTER_SCENE.json` are not parsed into canonical objects by this browser importer.
- ZIP supports stored/deflate entries, checks path safety, lengths, manifest SHA-256 hashes and original-file source fingerprints, then reads `normalized.json`. Packaged GeoJSON/CSV are preserved supporting sources; the runtime does not reconstruct the scene from them.
- Scope is explicitly synthetic, one local Cartesian east/north/up frame in metres, one named vertical benchmark; maximum 100 buildings, 500 objects, 1,000 geometries, 50,000 coordinate positions, 2 km extent and 20 MB compressed input/30 MB expanded ZIP. Rings have 4–256 positions; height ≤500 m; a façade-work budget is also enforced.
- `Polygon`, `LineString` and `Point` pass the handwritten geometry switch. **MultiPolygon is rejected there**, even though `data/schema.json` permits MultiPolygon and `spatial-checks.js` can measure it. Renderer building selection also filters to Polygon.
- The full JSON Schema is not executed in the browser. The schema requires fields that the manual validator does not (for example the complete observation/lineage/batch/rights sets). Conversely, the schema permits frame and geometry variants the renderer rejects. `schemaVersion` compatibility is not explicitly negotiated. This is a contract drift risk, not universal format support.
- Geometry IDs, active object links, basic source references, areas and some ring intersections are checked. Ring validation is not equivalent to complete topology validation: its strict crossing test does not comprehensively reject collinear self-overlaps, holes crossing the outer ring or mutually intersecting holes. Product topology validation should be reused rather than extending a second independent implementation.

## Arrangement support and remaining assumptions

### Analytical geometry and identity

`spatial-checks.js` uses robust polygon-clipping intersections/differences, preserves input IDs/coordinates, records exact geometry IDs/revisions, and replaces previous computed findings on import. Shared boundaries have zero area and do not become conflicts. Positive building footprint overlap receives a prism volume only when both vertical intervals and references are compatible. Unknown height yields footprint review with no volume; disjoint vertical intervals are not solid conflicts. Road overlaps are geometric review findings, not ownership decisions.

Current limitations: it checks building/building, building/one linked parcel and building/road corridor only. It does not check parcel/parcel conflicts, unit volumes, easements, sloped solids or actual pipe collisions. Multiple linked parcels are explicitly skipped rather than using a qualified union. Road centerlines need a corridor polygon before overlap can be measured. The existing `spatialChecks` producer/oracle payload is source evidence; `spatialCheckReport` is current browser computation and must not be confused with that earlier oracle after edits.

### Building rendering

`architecture.js:251` and `map.js:21` use Polygon buildings; holes are passed to Three Shape holes and façades follow actual edge directions. Building-specific styling is selected from scene decoration and optional object appearance, not from a fixed B01/B02 test. Building ID hashes select repeatable palette variation. Unknown height is footprint-only. Floor identity/geometry is used when supplied; a floor count alone creates visual repetition and does not invent floor records.

This is polygon/prism rendering, not arbitrary geometry. Multipart buildings are omitted/rejected. Irregular footprints and holes are implemented, but courtyard preservation needs browser geometry/visual acceptance, not only the clipper's unit tests. The renderer can prefer linked floor segments over an exterior extrusion; missing or invalid floor geometry can therefore produce incomplete display. No explicit compiler diagnostic currently explains that fallback decision. Arbitrary roof surfaces, setbacks represented by separate solids, sloped walls, bridges and authored meshes do not have a general display profile.

### Ground, roads and utilities

`environment.js` renders exact Polygon road/open-area/parcel surfaces, including holes. Road markings, kerbs and street lamps are generated **only** for five-position, axis-aligned rectangular corridors; arbitrary rotated/curved/concave roads retain their surface but lack that detail. This is safer than drawing their bounding boxes, but visually uneven. Ground and most street/parcel surfaces use fixed scene-zero elevations. Ground is an oversized flat rectangle, not terrain. Tree and car positions are authored decoration, not inferred from parcel data.

Utility LineStrings require supplied Z or an authored base. They become a smoothed Catmull-Rom tube with fixed 0.2 m radius and x-ray material. This is a display alignment: smoothing can depart from the original polyline, and the radius is not a source measurement. It cannot establish clearance/collision or pipe diameter. Utility identity remains in the input but is not a general interactive utility inspector.

### Camera and sectioning

The opening view uses optional `sceneDecoration.camera` and focal metadata, otherwise a clamped distance and fixed southeast direction. Overall fit uses XY building bounds at elevation zero and a minimum span, not complete XYZ scene bounds. Ground/roads, elevated and deep objects can therefore be outside an appropriate fit. Section slider maximum uses building height instead of base plus height (`map.js:291`); selected cut defaults similarly ignore nonzero base (`map.js:304`). A building starting at +100 m is a necessary regression fixture. Geographic anchors are metadata here, not a live georeferencing transform. Rotating coordinates within ENU works for footprints; rotating/translating a separate input frame is not implemented by this importer.

### Presentation contract

`sceneDecoration` currently has permissive additional properties, including `urbanForm`, `ground`, `plotWalls`, `camera`, `architecture`, `buildingStyles`, cars and paths. `object.attributes.appearance` is also open. This is useful for experimentation but not a versioned, validated production presentation contract. Some camera/style fields bypass the input validation applied to geometry. Reference quality cannot depend on arbitrary per-fixture JavaScript assumptions.

## Product foundation worth retaining

Evidence: `docs/SHARED_MAP_IMPLEMENTATION.md`; `packages/contracts/src/spatial/core/README.md`, `frame-schema.ts`, `geometry-schema.ts`; product `compiler/compile.ts`, `data/core-display.ts`, `data/resource-cache.ts`, `data/Provider.tsx`.

- `ulpin-spatial/2` is a development boundary with namespaced identities, revision references, typed relationships and source/frame/geometry catalogs. It must not be relabelled interchangeable with `ulpin-spatial/1` renderer DTOs or the standalone schema.
- Core geometry profiles distinguish planar, prism, asset and unavailable. Polygon/MultiPolygon holes exist; an asset reference preserves a native artifact without claiming arbitrary mesh measurement/render support.
- Core frame catalogs support engineering/projected/geographic/geocentric descriptions and versioned local rigid transforms (rotation, translation, vertical tie), plus bounded WGS84 ENU operations. This is substantially better than adding another transformation dialect to scene decoration. A described projected CRS is not proof of arbitrary EPSG reprojection support.
- The existing publication compiler validates one anchored engineering frame/vertical reference, supports Polygon/MultiPolygon/prism rendering, emits GLB feature metadata and coarse/detail 3D Tiles 1.1. Current bounds include 2,000 visible entities, 50,000 positions, 12,000 façade bays, 80 MB publication bytes and ±5 km local origin. Levels/spaces are inspection overlays rather than exterior tile features. These are bounded neighbourhood capabilities, not district/country capacity certification.
- `core-display.ts` is explicitly a read-only display projection: it projects a bounded geographic neighbourhood into a relative plane, labels unknown heights and diagram-width lines, keeps canonical measurement independent and generates a display ground plane. It does not make source heights surveyed terrain.
- One layout-scoped `ResourceCache`/`MapSessions` instance deduplicates requests, aborts unused readers, prevents stale completion overwrites and bounds idle cache entries. Preserve this service and canonical writers; do not introduce a parallel browser canonical store for the new renderer.

## Recommended implementation boundary

Keep cadastral records unchanged while making the rendering backend replaceable:

`preserved originals → source adapters → validated version-pinned canonical catalogs → selected render profile + reviewed frame transform → scene compiler → shared viewport → inspector/actions resolved back to canonical refs`

1. Reuse core identity/source/frame/geometry validators. Add an explicit adapter from the existing standalone showcase JSON; do not silently rename it as the core schema. Preserve all source IDs and revisions. Report unsupported objects individually instead of coercing them into boxes.
2. Compile each supported representation into analytical selection geometry and separate disposable display geometry. Every pickable node carries canonical entity ref, representation ref/revision and role. Display decoration is non-authoritative and excluded from measured volume, topology and ownership IDs.
3. Use the product frame service to produce one bounded render frame, preserving the reviewed transform chain. Derive camera and section ranges from actual XYZ bounds. Keep measurement in its qualified analytical frame.
4. Put the new Three/R3F presentation behind one Studio viewport/controller boundary; use existing shared resources and sessions. Retain Cesium tile compatibility as a backend/source path. Page controls consume selection/actions, not renderers of their own.
5. Keep showcase geometry in fixture packages. Change fixture data without changing renderer code or reference-ID conditions. The same normalized schema must load dense, open and irregular scenes.

### Minimal backward-compatible presentation addition — proposed, not implemented

Use a separately versioned presentation manifest/sidecar first, avoiding an incompatible mutation of strict canonical schemas. Bind it to the canonical snapshot digest and versioned representation references. It may contain:

- Optional camera intent (target reference or bounds, heading/pitch/distance); derive safe defaults and clamp values.
- Appearance profile/material IDs from a versioned local asset catalog; deterministic seed; optional referenced façade/roof display asset.
- Authored display-only instances (trees, vehicles, furniture), each with explicit frame/transform, asset/version and classification.
- Explicit road surface/detail profiles; detail follows actual polygon/centerline geometry and declared widths, with a plain-surface fallback.
- Optional terrain/imagery display asset with actual placement metadata and availability diagnostics. No assumed elevation or geotransform.

No legal rights, canonical dimensions, conflict decisions or official identity values belong here. Missing sidecar means valid plain geometry, not failed ingestion. Photorealistic materials/models may improve reference fidelity, but must remain detachable from the data contract.

## Showcase acceptance matrix

“Implemented” below means supported code exists; it is not new visual acceptance from this audit.

| Showcase | Today | Required acceptance / remaining work |
|---|---|---|
| Dense attached block; overlap and road intrusion | Implemented and existing browser checks for 82-building fixture | Repeat with entirely different IDs and arrangement. Verify zero-area shared walls stay neutral; every overlapping identity independently selectable; exact red intersection, not invented collision. |
| Open detached blocks with parks | Earlier v5 fixture and same module paths | Load through public importer, compare controls and frame/state isolation, no dense-style assumptions or fixed reference identifiers. |
| Oblique streets and irregular plots | Polygon surfaces/edge façades implemented | Rotated/concave road screenshot and picking; general kerbs/markings need work. No rectangular replacement or street furniture outside corridors. |
| Courtyard with occupied/nonoccupied hole | Hole geometry implemented; analytical tests present | Browser rendering, shadows, roof equipment, parcel holes and ray picking all preserve courtyard. Reject crossing/outside holes. |
| Multipart building / parcel | Schema/core/compiler permit; standalone importer/render do not | Implement multipart adapter/render selection with one entity identity; do not split identity merely for draw calls. |
| Mixed heights, nonzero bases, stacked XY | Analytical Z overlap supported; renderer prisms partially suitable | Test +100 m base, deep basement, missing height and disjoint stacked volumes. Fix camera/section limits and fixed ground assumptions. |
| Underground utility / elevated corridor | Utility x-ray display exists | Exact authored alignment, meaningful diameter only if supplied; no smoothed-tube measurement. Mixed elevations and intersections need explicit supported profiles. |
| Offset/rotated source frames | Core transformation model exists; standalone requires pre-normalized ENU | Import through core adapter with versioned transform and round-trip tolerance tests; do not interpret source local XY as lon/lat. |
| Terrain / draped imagery | Flat ground only in standalone | Native affine/raster data and vertical reference required; renderer adapter and terrain picking/LOD tests missing. |
| >100 buildings / large area | Standalone rejects; product bounded tiled compiler exists | Route supported snapshots through chunked/tiled publication; test memory, selection across tiles, context restoration and measured device performance. |
| Irregular 3D mesh/solid | Native asset reference available in core; no general analytical/render profile proven | Preserve artifact and report unsupported operations; add qualified profile only when needed. No blanket “any data” claim. |

## Test gaps to close before claiming reusable reference quality

Existing tests cover ZIP hashes/fingerprints, frame-unit rejection, retained old revision on changed geometry, interaction with fixture conflicts, clipping/floor controls, unknown height and idle rendering. Spatial unit tests cover concavity, holes, multipart arithmetic, touching/identical shapes, frame/Z distinctions and moved objects.

Missing cross-layer evidence includes: renamed IDs everywhere; a second independent package imported through the UI; multipart import/render; rotated and concave roads; courtyard raycast/roof clearance; nonzero benchmark camera/section; many linked parcels; invalid hole topology; presentation manifest validation; vertical-only noncollision shown without red volume; large-scene tiled handoff; reimport of historical revisions without stale selection/cached assets. Screenshot similarity and correct cadastral behavior must both pass; neither substitutes for the other.

## Supplied Drive source implications

The earlier inspected source inventory remains the evidence boundary (`design/bulk-studio-v4/SOURCE_INVENTORY.md` and `DATA_MODEL.md`). It records synthetic source files, named local coordinates, differing vertical-reference wording, a DSM with unknown datum, schedule-only floor spaces without unit polygons, preview imagery without reliable metric placement and metadata-only binary inspection. The proposed v1.1 solid/asset/LoD discussion in `DATA_MODEL.md` is a design proposal, not implemented support.

Adapters should preserve those unknowns and discrepancies, including many-to-many parcel membership, and expose source claims separately from computed geometry. A convincing reference map can use explicitly synthetic display assets while the same schema honestly represents missing geometry in another package. Real data availability must not be inferred from a visually complete demonstration.
