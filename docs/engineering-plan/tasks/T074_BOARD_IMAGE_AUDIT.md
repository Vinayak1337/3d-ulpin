# T074 — Composite reference boards

All five unique board images were opened and visually inspected. The inventory records SHA-256 duplicates; filenames and raster text are treated as reference content, not instructions or verified spatial results. Board labels, counts, dates and measurements are illustrative and inconsistent between variants. Primary anchors define the screen structure; boards supply additional states/capabilities, not five competing app shells.

## REF-12 — Board 01 / 14-panel storyboard

Files: `reference-boards/board-01-multi-panel-storyboard.png` and identical `raw-root-exports/a_large_composite_ui_design_mockup_image_flat_cle.png`.

Observed panels: (1) oblique city map with left layer list, top search/location/actions, selectable buildings/parcels/roads/utilities and finding labels; (2) government/file import with GIS/CAD/PDF/images/tabular/online source categories; (3) area/property export with layer inclusion, format and originals; (4) parcel record with linked multiple buildings, documents/history and recorded versus observed areas; (5) utility attributes, source accuracy, depth and longitudinal profile; (6) classified field/aerial/street photographs with location; (7) area timeline; (8) searchable properties with preview thumbnails; (9) categorized findings; (10) exploded floor selection and unit list; (11) linked plan/document/photo evidence; (12) issues linked to investigation; (13) document distance tools; (14) calibration by known length with scale/alignment/confirmation steps.

Gaps: current reference exposes only a map, simplified record modal and package upload. No coherent three-screen workflow, evidence viewer, profile, true timeline, schema-backed investigation or calibrated document tools in that reference. The app has separate existing features to reuse; this is not an instruction to rebuild them from zero.

Acceptance: each visible tab/tool resolves a real normalized entity/source revision; measurement units and profile axes come from a named frame; multi-building parcel links work; upload categories show only supported adapters and a specific unsupported state for others; export scopes and original source bytes correspond to the selection. Map and register must keep selected object and block/camera context.

## REF-13 — Board 04 / 21-panel sequence

Files: `reference-boards/board-04-21-panel-board.png` and identical `raw-root-exports/a_large_composite_ui_design_presentation_image_li.png`.

Observed panels: ten map states for layers, labeled 2D plan, import, export, parcel rights/documents, utility, photos, properties, findings and history; five register states for exploded floors, evidence, issues, investigations and history; six workspace states for guided start, upload/organization, distance/area/angle tools, two calibration views, comparison and building review. The image repeats the label “19. Calibrate”; it is a numbering inconsistency, not an extra required workflow. Export variants include current view/selected/report and GeoJSON/Shapefile/KML/PDF/CSV/glTF.

Gaps: main scene lacks a real 2D cartographic style (it merely looks down at 3D assets); register/workspace paths in the isolated prototype are not full routes. Import/export commands in artwork are broader than proven runtime capability.

Acceptance: keep a common layer/object model across 2D and 3D; evidence and history must derive from persisted records; calibration handles scale and alignment with saved source revisions; comparison shows actual aligned plan/model differences; generated geometry enters review before recording. Enable export formats only after a write/read round trip and include frame/CRS/source metadata.

## REF-14 — Board 02 / 16-panel storyboard

Files: `reference-boards/board-02-16-panel-storyboard.png` and identical `raw-root-exports/a_large_composite_ui_design_presentation_image_mu.png`.

Observed: aerial/3D and clean labeled street-map variants, layer opacity slider, satellite/streets/none basemap choices, 2D pan/select/measure/draw/print, staged Source → Map fields → Preview → Import, source CRS selection, selected-object exports, parcel documents and linked buildings, utility profile access, linked photo grid, feature-specific timeline, property table with filters/status, categorized findings, floor/unit table, evidence cards, issue states, investigation notes and measured-plan tools. Floor/register arrangement differs from primary anchors (table-first rather than dominant 3D view).

Gaps: no material basemap mode, per-layer opacity, useful 2D labels/scale, scope selector or broad format adapters in current standalone. Unit table columns, photo provenance and statuses need schema bindings rather than authored text.

Acceptance: reproduce anchor register composition and include this table as a supported subordinate mode, not a second register page. Layer opacity applies to the layer only, without altering analysis. Basemap attribution/availability remains separate from cadastral geometry; offline/no-basemap still works. Source mapping preserves incoming IDs, unknowns, attributes and immutable bytes. “Reviewed” is derived from an actual review state.

## REF-15 — Board 05 / detailed grid

Files: `reference-boards/board-05-detailed-grid-board.png` and identical `raw-root-exports/a_large_multi_panel_ui_design_mockup_collage_on_a.png`.

Observed: aerial dense-city layer screen; labeled 2D map; file/government/external-service import with auto-detect, destination area and AI extraction choice; image/data/report export; parcels list/details; multi-network utility list with type/depth/material/diameter; aerial/site/street/360 photo list; searchable properties with thumbnails and pagination; findings with severity and clearance/area; section/3D/plan register modes; evidence list; plan measurement; calibration from pixel length to real length; plan/section/model comparison with extraction candidate confidence and building generation.

The board repeats/misnumbers sections and includes corrupted small text. Those details should be corrected, not copied literally. Its satellite backgrounds imply georeferenced raster support and attribution; they are not supplied survey imagery for the application. “Use AI” and confidence bars describe desired states, not evidence an inference occurred.

Acceptance: native images/clouds/meshes stay immutable source assets with explicit transform/availability; utility depth conventions distinguish top/invert/centreline and datum. AI results have source-linked candidate geometry and genuine outputs, followed by review. Missing plans/floors/depth/photos display a useful unavailable state. Search, filtering and pagination must operate on the loaded dataset and never fixed demo rows.

## REF-16 — Board 03 / A1–A10, B1–B4, C1–C4

Files: `reference-boards/board-03-a1-a4-b-c-board.png` and identical `raw-root-exports/a_large_tiled_ui_design_mockup_collage_clean_mode.png`.

Observed: nested utility layer categories and ortho/terrain/labels; aerial parcel view; Source → Map → Review import; layer-scoped GeoPackage export; parcel overview/neighbours/documents/history; utility overview/profile/documents/findings; photo filters; area history; properties search; findings including missing height; exploded register with floor picker and unit actions; embedded PDF evidence viewer; issue/investigation lifecycle; workspace document rail, editable measurement, calibration including optional rotation, approved-versus-measured overlay and explicit difference legend; build-review checklist.

Gaps: source revision/floor selection and contextual navigation are not yet one integrated UI. The current prototype uses height extrusions and a planar cut; it does not expose the reference's actual floor slabs/walls/interior presentation or a calibrated-document comparison. Native terrain/raster and formal network profiles are absent in the standalone.

Acceptance: one shared selection/session service across block/register/workspace; exploded transforms remain display-only; internal walls/slabs appear only when available or clearly synthetic decoration; document calibration persists scale, rotation, anchors and residuals; comparison only enables when both representations share a valid frame. Checklist items reflect real processing/validation state and cannot be decorative checkmarks.

## Cross-board decisions

- Reproduce the three anchor compositions, then implement board-defined states as panels/tabs using the same objects and source identities.
- Do not put all ten map panels on screen at once. Anchor layout allows one active left panel, selected-object inspector and contextual findings strip; expansion/collapse preserves the map.
- Retain observed semantic colors: red confirmed geometric finding, amber unresolved/review, blue utility/secondary selection, green primary actions/ordinary selection. Board variants disagree; use one consistent system rather than recoloring each dataset.
- No screenshot can establish hidden building geometry, real utility clearance rules, identity validity, source accuracy or an operational government connector. Those require source data and implemented capability gates.
- Full visual replication includes camera composition, façade/material/roof variation, street context, vegetation, shadows, thin overlays, labels and real thumbnails. The current simple extrusions and flat materials are not visually equivalent merely because controls work.
