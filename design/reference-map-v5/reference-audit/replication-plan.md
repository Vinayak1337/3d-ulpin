# T074 — Complete reference audit and replication plan

20 September 2026. Audit complete; implementation and visual acceptance remain pending. This task adds review artifacts only. The live product remains empty and the current dense prototype remains available unchanged.

## Decision

Reproduce the supplied interface's composition and complete interaction states, beginning with the Block Map anchor. Use the existing canonical services and shared spatial foundation. Different neighbourhoods must be imported through adapters into one versioned model, with the same components rendering them. A new dataset must not require custom page code, hardcoded IDs or a new renderer.

The current prototype is a useful geometry and interaction experiment, but it is not a full visual replica or the integrated product. Reducing gaps between buildings alone will not recreate the reference: the reference also depends on detailed facades, coherent roads, shadows, varied roofs, cartographic labels and a much more complete officer interface.

## All images accounted for

The supplied folder contains 35 files and 17 unique images, verified by SHA-256. Every unique image was visually inspected, including every panel of the composite boards. Duplicates are mapped to their original paths in [the inventory](reference-image-inventory.json). The [interactive review](http://127.0.0.1:3013/reference-audit/) shows all 17 with observations, gaps and implementation requirements.

| References | Detailed review |
|---|---|
| REF-01, 04–08: map, 2D, import, parcels, utilities, home | [Map image audit](T074_MAP_IMAGE_AUDIT.md) |
| REF-02, 03, 09–11, 17: register, workspace, investigation and 17-panel board | [Register and workspace audit](T074_REGISTER_WORKSPACE_AUDIT.md) |
| REF-12–16: five additional composite boards | [Board image audit](T074_BOARD_IMAGE_AUDIT.md) |
| Canonical data, import limitations, current renderers and regression matrix | [Schema and renderer audit](T074_SCHEMA_RENDERER_AUDIT.md) |

The three anchor images define full-page composition. Composite boards define additional states, not panels that should all appear simultaneously. Some filenames are misleading: the photos/history image is Home; the register start image is a selected building; the floors-and-units image is the directory; workspace start is a collage.

Illustration contradictions must be corrected while retaining their visual structure: investigation status is simultaneously open and closed; a height is shown as both extracted and missing; utility clearance labels disagree with the illustrated rule and measurement direction. Reference values, addresses, IDs and approvals are examples, not facts to copy. Historical V2 branding is omitted under the current unversioned product requirement.

## Exact interface to reproduce

**Block Map.** One compact white header with global search, locality context and Import/Check/Export. Persistent left Layers/Properties/Findings rail; dominant map; right contextual inspector with rendered thumbnail, identity, tabs, source-backed metrics and next actions. Add bottom findings tray, minimap, metric scale, north/reset, labelled streets and readable selection. At the 1672 × 941 anchor size, target approximately 72 px header, 314 px left rail and 365 px right inspector, then verify against pixels rather than treating these estimates as final measurements. At narrower sizes collapse rails deliberately while keeping selection and map controls reachable.

**Map states.** Dedicated 2D cartography over the same objects; independent parcel selection; many buildings on a parcel and buildings crossing parcels; property/floor/space selection; sourced photo/history tabs; utilities with actual section and clearance evidence; issue list and exact highlighted intersection; source import and scoped export. A horizontal clipping plane is not a substitute for an A–A′ section. Selection must work for overlapping objects through a visible candidate picker or cycling with clear feedback.

**Home and directories.** Reproduce the municipal overview and register/workspace entry states as routes over actual available records. Main navigation opens a directory; contextual actions retain property ID, surrounding block and return camera. Empty records remain empty. Do not reintroduce fictional activity or live data during this audit.

**Register.** Property context at left; exploded model and synchronized floor/unit hierarchy in the centre; evidence, issues and history at right. Support elevation/section/reset, source document/photo viewing, scoped exports and investigation handoff. Missing unit boundaries preserve the sourced schedule but show geometry unavailable. Explode is only a display transform.

**Plan Workspace.** Document/page rail and comparison slots; dominant PDF/image canvas with Measure/Calibrate/Compare/Build modes; right extraction and placement review; lower shared 3D preview and floor stack. Source pixels, calibrated plan coordinates, canonical placement and display offsets remain distinct. Auto-extracted fields show source regions and review status; unresolved scale, height and conflicting values block dependent measurements instead of receiving defaults. Reuse existing processing and draft services; reviewed ML assistance follows the visual milestone.

**Investigations.** One coherent case state, source requests, received versus verified evidence, attributable timeline and explicit review decisions. Computed spatial intersections never establish ownership, approval or legal encroachment by themselves.

## How to build the map appearance

1. **Keep exact source geometry.** Compile Polygon and MultiPolygon parts, holes, base elevations and local frame transforms. Fit and section bounds use full XYZ, including underground and buildings based at +100 m. Retain native irregular assets when supplied; do not replace source solids with boxes. Unknown height stays unknown.
2. **Add a separate visual representation.** Use facade/roof material profiles and optional local mesh assets linked to canonical object/representation IDs. Generate facade details along actual edges, keep courtyards open and make shared-wall boundaries sensible. Decorative windows, tanks and trees are explicitly synthetic display assets; they cannot become cadastral evidence or change quantities.
3. **Build streets from geometry.** Road surfaces, kerbs and markings follow rotated/curved/concave source corridors, with no assumption that every road is an axis-aligned rectangle. Labels follow named road records. Vegetation and street furniture use validated placements, budgets and deterministic seeds. Dense colonies and spacious blocks use different data/presentation choices, not different renderers.
4. **Match lighting and composition.** Calibrate the camera, roof/wall palette, material roughness, soft shadows and contact shading against the anchor. Evaluate ambient occlusion with a performance budget. Avoid glossy plastic, uniform heights and repeated facade textures. Use a small versioned asset catalogue; do not paste the reference screenshot onto the ground as a substitute map.
5. **Integrate cartography and picking.** Legible road/place labels, scale and north, stable selection outlines, derived thumbnails and minimap share the same object IDs and frame transforms. Red is evidence-backed conflict, amber is unresolved data/review, blue is utilities and green is action/selection; never assign conflict by a fixture ID.
6. **Scale through the existing runtime.** Use the layout resource cache, session service and scene compiler. Instance repeated decorations, use LOD/streaming for larger sources and draw only while needed. Preserve canonical shapes and source revisions across detail changes. Test actual runtime frame time and memory before declaring a city-sized scene supported.

The current prototype's utility tubes smooth their centreline and use a fixed display radius. Until an exact analytical profile is supplied and checked, that mesh cannot support diameter or clearance claims. Terrain and imagery likewise need known placement and vertical metadata; flat ground is not a DEM.

## One schema, different data

Current contracts are not interchangeable: the standalone fixture JSON, `ulpin-spatial/1` render DTOs and the product's `ulpin-spatial/2` development boundary serve different purposes. Keep their version names honest. The first build task will pin and test adapters into the existing canonical boundary, reuse existing service writers, and derive render data from it. Do not add another browser-owned canonical store.

```text
Original files + immutable revisions
  → format adapter + source records + declared CRS/vertical metadata
  → staged suitability and normalization report
  → versioned canonical objects / geometry / relations / sources / observations
  → reviewed transforms + scene compiler + optional presentation sidecar
  → shared viewport, register and workspace
```

Core records: stable internal object IDs; separate source identifier assertions including supplied 2D ULPIN; linked building/floor/space identities; geometry revisions; named frames and vertical benchmarks; many-to-many relations; source records and original byte hashes; observations/rights evidence; lineage; computed findings with geometry inputs, method and tolerance. Missing values and missing geometry remain explicit. A floor schedule does not establish unit boundaries. Internal 3D identifiers must not be presented as officially issued identifiers.

Keep the existing demonstration ZIP usable through an explicitly versioned compatibility adapter. Its source GeoJSON/CSV remain originals. Today its runtime loads `normalized.json` after checking hashes; it does not normalize those raw files during upload. Test raw adapters separately before claiming raw format support. The handwritten validator and JSON Schema must agree, including MultiPolygon, reference integrity, topology checks and schema-version handling.

An optional **versioned presentation sidecar** may hold validated camera intent, material profile IDs, deterministic decoration seeds, local display assets, road styling and terrain/imagery placement. It references the canonical snapshot digest and representation revisions. It cannot hold rights decisions, substitute dimensions, official identities or conflict outcomes. Without it the same data must render as a useful plain geometric map. No arbitrary executable metadata is accepted.

### Import capability must be explicit

| Input family | Normalization and honest boundary |
|---|---|
| GeoJSON/CSV and the supplied source-style package | Match columns/IDs/relations, confirm frames, preserve originals and report accepted/missing/invalid features. A register row without geometry stays a row. |
| Shapefile/GeoPackage/KML | Enable only after a real adapter, CRS conversion and representative fixture pass. Do not equate file upload with successful spatial normalization. |
| Floor-plan PDF/image | Preserve pages; calibrate/align; review extracted facts and geometry proposals before applying a draft. |
| GeoTIFF/DEM/DSM and imagery | Preserve raster and spatial metadata, distinguish preview from georeferenced imagery, require vertical reference for measured heights. |
| LAS/LAZ, native meshes and 3D Tiles | Use declared asset-backed representations and qualified processing paths. Preserve shape and source; unsupported analysis is explicit. |
| GNSS/CORS, utility networks and schedules | Preserve coordinate quality, datum and source observations; validate transformations and network/solid profiles before analysis. |

This is a target capability matrix, not a claim that every adapter is implemented. Existing Drive-derived notes describe floor/space tables without complete unit polygons and uncertain raster vertical metadata; build synthetic geometry independently and label it, never attribute invented boundaries to those sources.

## Sequential build and acceptance gates

WIP limit: one bounded implementation task at a time. Each starts with a detailed file/test plan and ends with reviewed evidence and backlog result. Reuse existing implementation after inspecting coverage; do not rebuild working services just because the prototype has a gap.

| Order | Bounded task | Completion evidence |
|---|---|---|
| 1 | Shared import/scene contract and compatibility adapter | Same validated contract through canonical compiler; schema/manual validator agreement; original bytes and revisions retained; multipart, holes, rotated frame and nonzero-Z tests. Two unrelated fixtures import with no renderer changes. |
| 2 | Block Map anchor shell over the shared viewport | Reference-sized side-by-side capture; header/rails/inspector/tray proportions; keyboard controls; selection, return camera and directory navigation verified. |
| 3 | Reference-quality 3D scene | Separate spacious reference-composition and dense fixtures; source shapes preserved; edge-following facades/roads, shadows/materials, labels/minimap/scale; measured runtime performance; actual captures reviewed. |
| 4 | Remaining map states | 2D, parcel, utilities/section, findings, photos/history, import/export all backed by real records/actions; original IDs survive round trip; unavailable states explicit. |
| 5 | Register and investigation | Directory, selected register, synchronized model/table, floors/units/evidence/history and coherent case lifecycle; same canonical identities end to end. |
| 6 | Calibrated plan workspace | Real synthetic dimensioned documents, independently checked calibration/measurements, comparison alignment, reviewed draft placement and register handoff. ML proposals only if actual processing qualifies. |
| 7 | Showcase interoperability and final visual review | Run the fixture matrix below through the UI, verify scoped exports/reimports, inspect each reference state, exercise error/empty/unknown states and agreed hardware/size budgets. |

### Required showcase fixture matrix

- Spacious reference-style block and tightly packed Delhi-style colony; attached walls are not overlaps.
- Two overlapping buildings, building/parcel mismatch, building/road intersection and parcel with multiple buildings.
- Rotated/concave footprints and roads, open courtyard holes and disjoint MultiPolygon parts.
- Nonuniform floors, unknown height, basement, +100 m base elevation and vertically stacked objects sharing XY.
- Building spanning multiple parcels; tabular unit records without geometry; explicit cross-floor relationships.
- Utility-rich, utility-free and unknown-depth scenes; measured clearance only for qualified geometry.
- Offset/rotated local frames and georeferenced imagery/terrain; missing datum shown honestly.
- Larger streamed fixture and native irregular solid asset within declared limits.

Change all IDs/names in at least one independent fixture and import it through the UI. Selection, filters, counts, findings, register links, floor tables, source evidence and exports must still work. For each supported case, compare source versus canonical versus render representation and prove render transforms did not change measurements. Unsupported profiles must produce actionable reports rather than plausible substitute geometry.

## Review result

All supplied images are reviewed and the replication scope is now explicit. The next task is the shared contract/adapter gate, followed by the exact Block Map composition. Visual acceptance requires real browser captures beside the original images and working interactions, not compilation alone. This audit makes no claim that the present map supports every GIS format or already matches the reference.
