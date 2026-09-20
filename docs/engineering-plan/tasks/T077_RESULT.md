# T077 — Searchable identities, source extraction and reference register

20 September 2026, local macOS linked environment. Implemented inside `/studio/showcase`, using the existing layout-scoped resource/session services and shared MapViewport. Saved blocks links to this fictional preview. Nothing was seeded into the live registry. No passwords: the user's clarification supersedes the earlier typo.

## Delivered

- Building and floor identity/search uses explicit record assertions. Search accepts linked parcel 2D ULPIN, building 3D ULPIN, floor 3D ULPIN and names. Authored floor IDs use `building3DULPIN:level`, with ground `0` and basement `-1`. Demo identifiers are visibly fictional, never official issuance.
- Same-canvas Block Map and Property Register: building, exploded floor plates, exterior-floor toggle, orthographic elevation and benchmark section. Exact Polygon/MultiPolygon rings and courtyard holes remain unchanged. Floor plates use supplied unit boundaries; symbolic edge fins are not measured walls. Missing floor polygons do not produce invented levels.
- Selected building context includes linked parcel IDs, measured footprint from source polygons, height, revisions and supplied floor records. Residents are authored fiction linked to floor/unit records, shown in the selected detail panel. Occupancy does not establish ownership.
- Two new source-only GeoJSON/CSV ZIPs are normalized during import (neither contains normalized.json): dense colony with 82 buildings, 329 floors and 333 fictional residents; spacious reference block with 28 buildings, 121 floors and 125 fictional residents. Original previous packages remain unchanged.
- Actual supplied MASTER_SCENE and normalized v1 source structures have explicit adapters and separate uploadable packages. The latter produces 102 entities; master produces 129. Exact source shapes and source-local IDs/joins are retained. Missing building bases, official parcel IDs, resident schedules and unit geometry stay missing. Known height may be illustrated at display ground; analytical vertical intervals remain unavailable.
- Original bytes/SHA-256, source row/feature locators and geometry revisions are retained through the canonical `ulpin-spatial/2` boundary. Raw-source details: `apps/web/features/spatial/reference-import/PROVIDED_SOURCES.md`; authored fixture profile: `design/reference-map-v5/data/SOURCE_SHOWCASE.md`.
- Responsive explorer and register; global search remains available on narrow screens. No duplicate viewport per view.

## Verification and review

44 contract/package/normalization/session/end-to-end fixture tests and 15 runtime geometry/records/floor-plate tests pass. Production build (including TypeScript) passes. Browser evidence is in `../evidence/t077/`; `comparison.html` pairs actual Studio captures with supplied REF-01/REF-02.

Review corrections: delayed sample fetch cannot replace a newer import; blank/boolean numeric fields cannot become zero; multi-parcel IDs stay plural; relation IDs cannot collide through slash concatenation; floor selection preserves active elevation/section presentation; section controls refresh when selection changes; narrow register canvas cannot overlap its tabs. Invalid package errors are concise and leave the active scene intact.

## Limits

This is a local, non-persisted preview. Leaving/re-entering within Studio retains the active preview/session; a full browser reload starts the default scene. Canonical publication still uses the retained product workflows. No statutory IDs, ownership inference, ML segmentation or official validation is claimed.

The detailed profile is bounded to 100 buildings, 1,000 geometry records, a 2 km local-metre extent and declared package limits. These tested source adapters are not universal GIS/CAD/IFC/PDF/LiDAR extraction. Unsupported raw files use existing intake; additional adapters must be qualified. Missing supplied terrain/native solids/point utility renderers remain unsupported. Full calibrated workspace and every reference-board interaction are separate remaining milestones.

Visual comparison shows the reference composition, detailed synthetic city exteriors, conflicts, labels and exploded register. Simplified procedural facades and source-limited interior geometry differ from the reference. Photographic/pixel parity and user visual acceptance are not asserted.
