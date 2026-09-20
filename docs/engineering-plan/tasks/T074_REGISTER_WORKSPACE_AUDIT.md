# T074 — Register and workspace reference audit

Date: 20 September 2026. Status: read-only reference audit; not implementation or visual acceptance.

## Scope and evidence

All requested images were opened with the image viewer. SHA-256 comparison identifies six unique images across the twelve requested paths. Exact copies were inspected once and mapped below. The global inventory at `.runtime/reference-image-inventory.json` supplies stable reference IDs. Its additional REF-11 raw export is also an exact copy of the inspected workspace collage.

Reference root: `/Users/vinayak/Downloads/3D_ULPIN_V2_REDESIGN_PACK_FINAL/images/`.

| Reference | Inspected image and exact duplicate paths, relative to reference root | Size | SHA-256 |
|---|---|---|---|
| REF-02 | `anchors/02-property-register-anchor.png`; `raw-root-exports/3d_ulpin_building_register_dashboard.png` | 1672 × 941 | `a85692b4e5ec94ac49933506974515f5ac3c57171c3302d842c36e11c924989e` |
| REF-03 | `anchors/03-plan-workspace-anchor.png`; `workspace/02-measure-workspace-page.png`; `raw-root-exports/3d_ulpin_plan_workspace_interface.png` | 1672 × 941 | `46dd50441cb39e02ff94cf0a5511e2ce72b33bc4b52169fac029179220737ac0` |
| REF-09 | `register/01-register-start-page.png`; `raw-root-exports/3d_property_register_dashboard_ui.png` | 1672 × 941 | `b82d3cc8e32fc6e63d853dee1d6a158ea221292d9c9a258223010098a27bdcc7` |
| REF-10 | `register/02-floors-and-units-page.png`; `raw-root-exports/3d_ulpin_property_register_dashboard.png` | 1672 × 941 | `5c15f2cd71be752d6bee26650b9648a1d1cbd3445c0e0eb86f78d5557691f920` |
| REF-11 | `workspace/01-workspace-start-page.png`; additional inventory duplicate `raw-root-exports/a_large_clean_ui_ux_concept_board_image_with_mult.png` | 1536 × 1024 | `cc1d44aae4c0986fcfde748fdcc7de2d4ab4592c786c30b3dbeb2a0366c61b80` |
| REF-17 | `register/03-investigation-page.png`; `raw-root-exports/property_registry_investigation_dashboard.png` | 1672 × 941 | `7a4b3a5f26af5ff5965f1677c922f9b41ab70001b1ec830a7784caa9096e3033` |

Three filenames misdescribe the visible state: REF-09 is a selected building register, REF-10 is the register directory, and REF-11 is a seventeen-panel concept sheet. The last must not be implemented as one giant workspace page or treated as a single start-screen reference.

**Evidence boundary:** “observed” below means visible pixels, text, states, and control affordances. A screenshot cannot establish that its controls work. Interaction outcomes and implementation acceptance are proposed requirements inferred from those affordances and the user's request to reproduce the complete interface. All displayed addresses, ULPINs, areas, dates, approval labels, officers, and case histories are illustration content, not evidence of actual property facts or completed processing.

Current-prototype comparison is limited to `design/reference-map-v5`, using read-only inspection of `index.html`, `app.js`, and the map controls, plus actual viewing of `screens/04-floor-space.png` and `screens/12-selected-intersection.png`. These captures show the current dense fictional scene. This audit does not claim that missing prototype features are absent from the production application's services. Existing canonical services and reusable modules must be assessed and reused before implementation.

## Shared visual and navigation contract

The full-page references use a compact white header, dark green actions, navy headings, pale blue-gray surfaces, thin dividers, restrained rounded cards, and dense but structured information. A global search, locality context, officer identity, and page actions sit above a breadcrumb/context bar. Selected-property pages preserve a left property context card while their central task changes. The register and workspace devote substantial space to a real scene or document, not a substitute statistics dashboard.

Observed historical “V2” branding is not a requirement to introduce version branding: current project instructions require unversioned product routes and UI. Likewise the named officer is a presentation example, not a request for production multi-user authentication. Main navigation must open directories; contextual actions carry the selected canonical property into its register or workspace and back to the surrounding block.

## REF-02 — Selected building register anchor

### Observed composition and controls

- Header: 3D ULPIN brand and tagline, global property/address search with command-key hint, Maharashtra → Pune → Kothrud locality controls, Open Map, Export, Investigation, and officer identity.
- Context row: Back and a locality/address/building breadcrumb. Tabs: Overview, Register (selected), Floors & Units, Evidence, Issues, History.
- Left column, approximately one fifth of the page: neighborhood thumbnail with the property tinted red, View in 3D, property identity and Constructed status, address, linked parcel, ownership, land use, ward/zone, Building Metrics, and Issue Summary.
- Broad center: Building Register title, Download Register and Open Workspace actions; four metrics; then a tall exploded building beside the nested Floors & Units table. Floor plates, internal room partitions, stairs/terrace, level labels, street context, and north marker are visible. View controls include 3D View, Elevation, and Section.
- The table has floor expansion controls, floor aggregate areas, nested unit identifiers and areas, occupancy badges, and overflow menus. It includes terrace, fourth through first floors, and ground floor. Visible fourth-floor units 401/402 have individual 34 m² areas; unit 302 is Vacant; ground G01 is Commercial.
- Right column: Evidence & Documents with six categorized rows, dates and source descriptions; two issue cards; a compact activity timeline. Documents include parcel map, approved building plan, floor plans, section/elevation, utility drawings, and site photograph.

### Scene and canonical data requirements

The center needs selectable, independently identified floor and space geometry, not repeated rectangles inferred from a building footprint. Exploded spacing is a display transform; stored floor elevations and geometry must remain unchanged. Terrace is an explicit object/level or an honestly labeled surface, not an automatically invented dwelling floor. The left thumbnail and center model share the same property identity but have independent cameras.

The illustrated five floors, eight units, 312 m² built-up area and 280 m² plot area must be replaced by dataset-backed quantities with named definitions. “Built-up area” must not silently mean footprint area. Unit occupancy, construction status, ownership, approved-plan status and land use are sourced assertions with provenance, not deductions from geometry. Evidence rows need immutable asset revisions and object links. Activity requires actual events, not manufactured dates.

### Current gap and acceptance

The prototype has a selected-building inspector, actual floor/space selection and source/issue links, but Open property register opens a metadata/source JSON modal. It lacks this three-column register, hierarchy table, document browser, timeline, download scope, and workspace handoff.

Acceptance: capture this full selected-property composition at the reference viewport; table and scene selection must remain synchronized; expanded floor/unit rows must reflect canonical memberships; elevation/section must use the selected geometry; evidence must open the linked revision; downloads must retain selected identities, sources and unknowns; navigation back must restore property and block context. Missing interior geometry must show unavailable geometry while retaining valid tabular records.

## REF-09 — Building register variant, despite “start-page” filename

### Observed differences

This is substantially the same selected-building composition as REF-02, with historical V2 branding. Floors & Units is the active top tab although the central title remains Building Register. The model pane is explicitly titled 3D Building View; its bottom controls add Reset View. The right evidence area has Evidence & Documents and Field Photos tabs. The same sample property, metric strip, nested floors, issue summaries and history remain visible.

### Requirements, gap and acceptance

This is a state variant of the same reusable register, not a second register implementation. Its data contract is REF-02 plus source-backed photo collections and a view-reset state. The active-tab/title discrepancy is an illustration ambiguity: choose a consistent route/tab vocabulary during implementation and retain all represented capabilities.

The prototype has camera reset/focus concepts but no register Field Photos tab, source-photo viewer or corresponding scoped layout. Acceptance: reproduce the variant through the shared register's Floors & Units and evidence/photo states; Reset View changes the camera/display state only; photo counts derive from linked assets; absence of field photographs shows an honest empty state. Do not populate photographs from unrelated decorative building imagery.

## REF-10 — Property Register directory, despite “floors-and-units” filename

### Observed composition and controls

Breadcrumb Home → Property Register; Register active; a large Property Register heading and introductory text. Four large action tiles span the page: Search a property, Open from Block Map, Import register data, Recent buildings.

Below, three columns contain: a Recent Buildings list of five thumbnail/identity/address/last-viewed rows; an Example-labeled Sample Building Register card with a large neighborhood thumbnail, property identity, four metrics and View Full Register; and “How a Register Brings It All Together,” a diagram connecting a building to Building, Floors, Units or Rooms, Evidence, Issues and History. A bottom tips strip explains search, map opening and management; help is present.

### Scene and data requirements

This is a directory with no selected-building assumption. Search and map selection return canonical IDs. Recent buildings require local view-history events, and sample content must be explicitly fictional/sample content using a real dataset record. Thumbnails are views of the corresponding asset/geometry. Import register data must preserve its table records even when their unit boundaries are missing; a row alone cannot become a unit polygon.

### Current gap and acceptance

The prototype offers map search and package upload, but no register directory or recent-record surface. Acceptance: main Register navigation opens this directory; each tile has a meaningful destination; empty history remains empty; the example card opens the exact sample property; selecting a different dataset updates all cards/search/counts without copying the illustrated Lake View identity. Import exposes supported adapters and outcomes instead of claiming every format already works.

## REF-17 — Investigation detail

### Observed composition and controls

The global header and property sidebar remain. Investigation is the active contextual tab. The center starts with an investigation identifier, copy affordance, In Progress status control, and overflow; subtabs are Case Summary, Issues (2), Evidence (4), History, Next Actions.

The summary card contains investigation ID, related ULPIN/address, opening date, type, assignee, status and target closure. Two discrepancy cards show View on Map, measured area and percentage, location text, review status controls, requested-evidence checklists and due dates. Example requests include revised site plan, field photos, owner explanation, survey report, road boundary map, municipal drawing and site inspection report. A bottom Next Action banner and Continue Investigation/Reopen Investigation actions are visible. The right column is a large activity timeline with actors, dates, explanations and a resolved/closed footer.

### Illustration contradictions and data requirements

The same screen simultaneously shows In Progress, Under Investigation, Field Verification, final resolution/closure, and Continue/Reopen actions. Some displayed timeline dates are not chronological. These are contradictory mock states, not an acceptable lifecycle specification.

A case must link to existing issues and stable objects. Geometry findings retain calculation inputs, geometry versions, frame, tolerance and evidence polygons; an officer's legal/compliance finding is separate. Case status, assignment, requested evidence, due dates, review notes and closure/reopening are distinct structured records/events. A source document being received does not prove that its requested verification has passed. Percentages require an explicit denominator and compatible area definitions.

### Current gap and acceptance

The prototype computes spatial findings and opens a review preview, explicitly leaving workflow decisions to the application. It does not implement cases, evidence requests, status transitions or timelines.

Acceptance: reproduce the case composition using a coherent state from the actual case model; each issue opens its exact spatial evidence; attaching evidence links an immutable source revision; requested/received/verified remain distinguishable; valid transitions append attributable events; closed cases expose reopening only when allowed. No investigation closure, approval, ownership conclusion or legal encroachment claim may be inferred from a red polygon. The local single-operator release can record a configured local officer without expanding into production authentication.

## REF-03 — Plan workspace / measurement anchor

### Observed composition and controls

Header actions are Import, Check and Export. A contextual breadcrumb leads through Block/property/address to Plan Workspace; Save Draft, Build Details, Send for Review and Return to Register sit alongside it.

Three columns dominate the workspace. Left: Source Documents (3) with Add, document thumbnails, names, dates, statuses Used/Active/Processing and overflow menus. Compare Plans has Swap, current/compared plan slots, removal, Split View and Show Differences. Center: Ground Floor Plan document title, page 1/3 navigation, 125% zoom, mode tabs Measure/Calibrate/Compare/Build Details, and a measurement toolbar Distance/Area/Perimeter/Height/Delete. An overlay toggle, instruction text, plan canvas, compass, scale bar and Reference OK indicator are visible. The drawing has room labels, dimension lines, a green editable boundary with vertex handles, a 5.20 m measurement, and a red balcony detection labeled 4.50 m².

Right: Plan to Building Details stepper Documents → Extract → Placement → Review → Complete; editable Extracted Facts; Detected Elements with areas and statuses; three Questions to Verify; Apply Selection to Building; and next actions Confirm Placement, Prepare Units, Send for Review.

Across the lower portion: a small 3D Preview from Extracted Plans, Textured display choice, floor stack including terrace/four upper floors/ground, and Coverage Details. The scene places the selected building in street context and shows north.

### Data and geometry requirements

- Preserve original file bytes and revision identity; pages and thumbnails are derived assets linked to their source page. Multi-page files need page-level locators.
- Store calibration as an explicit transform with picked page points, known distance, unit, method and revision. Page pixels, plan-local metres, placement into a named canonical frame, and display transforms are separate spaces.
- Distance/area/perimeter require valid calibration and compatible geometry. Height needs vertical evidence or an explicit user observation; a horizontal plan cannot establish it. Unknown scale or vertical datum remains unknown.
- Proposed extraction results retain source regions, original values, alternative observations and review status. Applying a selection produces a traceable draft geometry revision; it must not overwrite originals or issue official identifiers.
- Compare needs two actual source/geometry revisions and alignment information. A side-by-side visual comparison can work before alignment; quantitative differences cannot honestly do so.
- Model preview, floor stack and register handoff use the same stable objects and geometry revisions. Drafts must be separate from accepted geometry; Save Draft and Send for Review are different operations.

The illustration shows height 12.5 m while also saying height was not found in the documents. Its 9.00 m/7.50 m dimensions, 122 m² ground built-up area and 612 m² total are not a coherent calculation specification. Implement unknown/conflicting observations and computed quantities, not literal numerical imitation. A Reference OK badge must be backed by a defined check, not a decorative success marker.

### Current gap and acceptance

The prototype has canonical geometry, sources and a 3D map, but no actual PDF/page canvas, calibration editor, plan measurement, comparison, extraction review, placement wizard, draft persistence or register-linked workspace. Its GeoJSON/CSV package is not a substitute plan document.

Acceptance: reproduce the three-column workspace and lower preview at the reference size; open and switch actual supplied test documents/pages; make canvas overlays follow zoom/pan; calibrate a known line and independently verify measurements; delete/cancel only the active measurement/drawing; keep unsupported/unscaled states explicit. Verify one reviewed extraction/placement creates a new draft revision with lineage, then opens the same property in the register. Reference reproduction needs a clearly synthetic plan asset with known dimensions or a real authorized plan, not invented measured results over a decorative image.

## REF-11 — Seventeen-panel concept sheet

Every lettered panel is a distinct required state/capability. The compact labels and sample values below describe visible content, not verified data. Shared components should implement overlapping panels; do not create seventeen independent data stores.

| Panel | Observed layout, scene and affordances | Data requirements and current prototype gap | Implementation acceptance |
|---|---|---|---|
| A — Block Map / Layers | Aerial scene, selected parcel/building, layer tree for buildings, parcels, roads, public land and utilities; imagery/labels toggles, 2D/3D, search, selected-property popup, toolbar/legend. | Canonical typed objects plus source-backed imagery with spatial transforms. Prototype has selectable 2D/3D fictional geometry and layers, but not this complete aerial scene/layer taxonomy. | Each visible layer control changes the corresponding available data; imagery uses its actual georeference; popup actions retain identity. No fake imagery availability. |
| B — Import Data | Modal tabs File Upload/Government Sources/Sample Data; dropzone; several selected source files; coordinate autodetection and advanced options; Cancel/Import. Advertised formats include Shapefile, GeoPackage, KML, GeoJSON, PDF and images. | Byte-preserved assets, format adapters, CRS suitability and staging jobs. Current prototype accepts its normalized JSON/package contract, not all pictured formats or government connectors. | Implement an adapter and test it before enabling its format; distinguish receipt, suitability, processing and review; retain files with unknown CRS for correction instead of guessing. Government Sources needs an actual available source or an honest unavailable state. |
| C — Export | Modal tabs Current View/Selected Features/Full Area/Investigation Report; geometry and related-information checkboxes; GeoPackage format; optional 3D inclusion; Cancel/Export. | Export scope uses selected stable IDs and versioned relations, evidence links, CRS and metadata. Existing downloadable package is not every pictured export. | Reimport generated supported exports; verify selected scope, identities, nulls and geometry dimensionality. Do not label an extrusion-only export as a preserved native solid. |
| D — Parcel View | Aerial parcel highlight and measured area; Details/Owners/Documents/History; land use, survey/ward/source fields; boundary documents, map and 3D actions. | Many-to-many parcel membership; identifier assertions and rights records separate from physical geometry. Prototype exposes linked parcel but not this full inspector or rights/history tabs. | Parcel remains independently selectable; building relationships are explicit; ownership/official identifiers are attributed assertions; tab contents follow selected parcel. |
| E — Utility View | Water/sewer/electric filters; utility list with diameter/depth; street and underground pipe scene; selected pipe material/source popup. Gas depth is explicitly unknown. | Utility path/network, dimensions, elevations, depth reference and datum. Prototype has limited authored underground utility geometry, not complete network/filter/inspection UI. | Unknown depth stays unknown; surface-relative depth and elevation are not conflated; below-ground placement needs a known reference; supplied network segments retain topology. Illustrated list/popup depths are not a trusted calculation. |
| F — Photos | Site Photos (12), Add Photos, dated thumbnail grid, large selected image and capture/location/direction metadata with small map. | Original photo assets/revisions, property links, capture metadata and geotag provenance. No equivalent prototype photo browser. | Open actual linked photo, preserve original bytes, distinguish EXIF/entered location from verified location; no unrelated decoration as evidence. |
| G — History (Map) | Year choices 2020–2024, selected 2023, two dated imagery views and swipe divider. | Time-indexed imagery/geometry revisions, capture time versus ingest time, consistent alignment. Prototype has no temporal comparison. | Compare actual available revisions on a shared camera; dates are sourced; missing years are unavailable, not synthesized. |
| H — Findings | Five findings, category filters, area/clearance and severity; road, parcel, public-land and utility examples, including unknown sewer clearance. | Calculation records with input geometry versions, predicates, tolerances and units; unknown/unmeasurable distinct from clear. Prototype has computed polygon findings but not all utility/clearance predicates or this complete panel. | Selecting each result highlights computed evidence; shared-wall zero-area contact is not positive overlap; missing vertical data cannot produce a numeric clearance or definitive volume. |
| I — Register / Floors and Units | Side navigation; exploded translucent colored floor stack; terrace, upper/ground/basement rows with unit/area summaries; View in 3D. | Same floor/space memberships and geometry as REF-02, with negative elevations and basement. Prototype has focal basement/floor/space geometry but not register layout/table. | Reuse register and map runtime; preserve actual levels and basement datum; arbitrary missing, nonconsecutive or mixed-use floors remain supported. |
| J — Evidence | All/Plans/Photos/Documents filter counts; source files, sizes, author/source and year. | Categorized asset revisions linked to objects and observations. Prototype lists source records, not a document evidence viewer. | Filter counts derive from actual assets; open correct immutable revision/page; show absent size/date as unknown. |
| K — Issues | Open/Resolved/All tabs, Add Issue; cards for front extension, water clearance and missing approval. | Manual issues and computed findings distinguish origin; compliance claims need evidence and review. Prototype lacks editable issue lifecycle. | An “unapproved” label cannot come solely from geometry; resolve/reopen appends events and keeps original finding history. |
| L — Investigation | Open case card, allegation title, creation date/officer/status, View Details/Add Evidence and related findings. | Case references existing issues, evidence and object IDs; same state machine as REF-17. Absent in prototype. | Case list opens corresponding detail; evidence receipt does not implicitly close case; no duplicated issue records. |
| M — Workspace / Measure | Plan, Measure/Calibrate/Compare/Build Details modes, drawing toolbar, red 5.20 m line and click/Esc instruction. | Page calibration and editable draft measurements. Absent in prototype. | Two-point distance matches independent known geometry; Esc finishes/cancels the active interaction predictably without clearing other work. |
| N — Workspace / Calibrate | Two selected reference points, Known Distance field 5.20, metre unit, Set Scale. | Calibration revision, source page, picked points, unit and transform. Absent in prototype. | Invalid/zero-length calibration rejected; changing calibration invalidates/recomputes dependent measurements with lineage rather than silently rewriting accepted geometry. |
| O — Workspace / Compare | Overlay/Side-by-side choices; uploaded plan and Map/Existing Plan panes, split divider and zoom. | Two source/geometry revisions and optional alignment transform. Absent in prototype. | Side-by-side works without falsely asserting alignment; overlay and numerical differences require compatible calibrated placement. |
| P — Workspace / Build Details | Extracted Elements 4/5 confirmed; footprint, ground, first-floor and section heights checked, stair core unchecked; preview and plan thumbnails; Build to Register. | Reviewed proposals per source element with explicit membership and geometry revisions. Absent in prototype. | Only confirmed applicable elements enter the draft; unchecked/unknown items remain visible; building identity persists on register handoff. |
| Q — Create Property / Workspace | Add Existing Property search and Find Property; separate Create New Property / Create Workspace card. | Existing-ID resolution or a new internal draft identity; workspace and accepted-property lifecycle distinct. Absent in prototype. | Search prevents accidental duplicate identity; create allocates a local draft ID, not an official ULPIN; both paths open the same workspace component with different initial state. |

## Canonical-data integration requirements

The references describe views over one model. Retain the existing canonical service authority and the normalization contract already documented in `design/bulk-studio-v4/DATA_MODEL.md` and the isolated fixture package. Do not build separate register, map and plan copies of a property.

| Existing foundation | Required view use / additive record contract |
|---|---|
| `objects`, stable internal IDs, identifier assertions | Property, parcel, floor, space and utility navigation; official 2D ULPIN assertion distinct from internal 3D identity. Dataset labels and sample identities must not be hardcoded into components. |
| `geometries`, versions, `frames`, explicit vertical datum | Map, exploded register, elevation, section and workspace preview use the same geometry. Display offsets never change measured area/volume. Null geometry/height/datum stay null. Native solid/surface support remains a separately declared adapter capability. |
| `relations` | Floor/space membership, multiple parcel membership and cross-floor spaces use explicit links; no universal assumption that one unit belongs to exactly one floor or one building to one parcel. |
| `sources`, `sourceRecords`, `observations`, `lineage` | Documents, source attributes, photographs, extraction proposals, measurement inputs and derived assets remain traceable to revisions and page/feature locators. Values can be stated, measured, computed or disputed without erasing their source. |
| `rights` and evidence links | Owners/rights tabs must present attributed rights evidence separately from geometry and a building's occupants. Rights do not arise from touching/overlapping polygons. |
| `issues`, computed evidence, batches/staging | Findings can link to investigations and reviewed corrections. Calculation status, source suitability and publication status remain separate. B12's unknown height cannot be “resolved” by the UI selecting a decorative height. |
| Additional records to reuse or define explicitly | Workspace/draft IDs; document-page assets; calibration/placement transforms; editable measurements; extraction proposal review; source requests; investigation cases/transitions; attributable audit events; local recent-view history. These are proposed needs, not claims that the current fixture schema already implements them. |

Supported geometry must remain native or explicitly derived. Unsupported geometry is not permission to replace a curved/irregular/multipart volume with a rectangular building. A valid register row may have no drawable geometry; a source raster/point cloud remains an asset, not a fabricated parcel/floor. Render/display meshes and levels of detail are independent of analysis geometry and its measurement authority.

The actual Drive floor-space tables previously inspected do not supply all unit polygons. Such rows can populate a sourced schedule and area assertions, with `geometryId: null`, until evidence supports boundaries. This is essential interoperability behavior for the illustrated register hierarchy.

## Dataset and acceptance matrix

Use the same components and canonical IDs for each of these cases; do not create a new schema or screen implementation per scene.

| Dataset case | What must remain usable and honest |
|---|---|
| Current dense fictional colony | Map → B01 register → its real supplied floor/space hierarchy; actual 16 m² lane/parcel findings; B02/B03 overlap; shared-wall contacts remain valid; unknown B12 height remains unmeasurable. Existing source ZIP stays an import/export test fixture. |
| Plan-led apartment | Actual known-dimension synthetic plan pages plus documented calibration; floor/space extraction review and preview; all measurements independently checked. Requires plan assets beyond the present map fixture. |
| Tabular schedule without unit boundaries | Full floor/unit list, sourced area observations, document links and missing-geometry state. No invented apartment shapes or area-to-square conversions. |
| Mixed-use / basement / multipart or cross-floor unit | Nonuniform floors, negative levels, explicit use/occupancy observations and membership links; render supported geometry, acknowledge unsupported native payloads. |
| Parcel/utility/imagery-focused dataset | Independent parcel selection, rights evidence, utility metadata, source-backed dated imagery; absence of building plans does not disable the rest of the application. |
| Conflicting or incomplete evidence | Competing area/height observations, unknown CRS/datum, unavailable documents, unaligned plan comparison and unresolved case requests remain visible and reviewable. |

For each full-page reference and each unique collage state, implementation acceptance requires: a browser capture at the reference viewport, comparison of layout and content hierarchy, a functional interaction path, source/identity continuity, and explicit empty/error/unknown states. Capturing a populated static imitation alone is insufficient. Visual acceptance must also inspect narrower viewports so essential canvas actions and selected-property context remain reachable.

## Delivery implications

The current prototype is a usable scene and computed-spatial-evidence foundation, not a completed register/workspace reproduction. The largest missing deliverables are the register directory, selected-register layout and hierarchy, evidence/photo/history surfaces, investigation lifecycle, and the calibrated plan-workspace flow. Reuse the current renderer and existing canonical services while implementing those surfaces; preserve all source and geometry revisions.

This audit changed only this document. It did not modify application code, fixture data, source assets, backend services or any live records.
