# T074 — Block Map reference image audit

Date: 2026-09-20. Status: read-only audit; no implementation changes. Scope: the twelve requested image paths, comprising six distinct images. Reference inventory IDs follow `.runtime/reference-image-inventory.json`.

## Method and scope

Every distinct image below was opened at its actual pixels with `view_image`; filenames were not used as evidence of screen content. The six raw exports were SHA-256 checked against the inspected images and are exact duplicates, so they were not redundantly interpreted. All twelve are 1672 × 941 PNGs. The current prototype was opened at the same viewport on `http://127.0.0.1:3013/`; its fresh comparison capture is `/tmp/t074-current-map.png`. Durable existing captures and controls results are in `docs/engineering-plan/evidence/t073/map/`. Current `index.html`, `app.js`, and map module behavior were also inspected. The frontend-design skill's instruction to respect explicit references applies; this audit does not substitute a new minimalist direction.

The screenshots establish appearance and visible affordances, not proof of interaction, ownership, regulatory rules, source accuracy, or measurement. Interaction requirements below are inferred from the controls and must become working behavior. No area, distance, personal name, official identifier, administrative location, or status shown in an image should be copied as factual data.

### Exact duplicate coverage

Paths below are relative to `/Users/vinayak/Downloads/3D_ULPIN_V2_REDESIGN_PACK_FINAL/images/`.

| ID | Image inspected directly | Raw export covered by exact-byte duplicate | SHA-256 |
| --- | --- | --- | --- |
| REF-01 | `anchors/01-block-map-anchor.png` | `raw-root-exports/3d_ulpin_urban_inspection_dashboard.png` | `648c967166d8f8d95f4ffd059c333c0aab5d0e03a9702cb3bf50071eb64f5ff1` |
| REF-04 | `block-map/01-layers-2d-map.png` | `raw-root-exports/municipal_gis_dashboard_map.png` | `0a47cac16463ad150881d105b67a0b1a2253f3261af22d95afe4c37ef7ee7b82` |
| REF-05 | `block-map/02-import-export-data-tools-modal.png` | `raw-root-exports/data_tools_import_gis_layers.png` | `7fc89a7ee158bd78625164e426ed18e7a813e74d98be3e7dfca9ef7a137a5b3d` |
| REF-06 | `block-map/03-properties-parcel-inspector.png` | `raw-root-exports/3d_parcel_inspector_dashboard.png` | `d338add3ab1bf5ae75d1b7427f43be7f04f3a21eeafb8daf741d1a3362fcbd3b` |
| REF-07 | `block-map/04-utility-and-findings.png` | `raw-root-exports/3d_utility_conflict_dashboard.png` | `072abae217d4ad5d4b656d3642b3ed2092645cf1eded3ec6b2df5faf47725a5a` |
| REF-08 | `block-map/05-photos-and-history-sidebar.png` | `raw-root-exports/3d_ulpin_municipal_dashboard.png` | `65bf6bb5e63da9fb5d7a0eb5c9339f3774b08307c639deccba10176ba2b38827` |

**Filename discrepancy:** REF-08 is a municipal start/dashboard screen, not a photos/history sidebar. None of these six unique images exposes a complete photo gallery or history tab's contents. Photos and History tabs are visible in other images; their content design must be sourced from the rest of the pack or explicitly designed, not claimed as observed here.

## Common reference shell and current gap

The reference uses a single roughly 72 px header: green brand left, broad global property search near the center-left, three location chips/breadcrumbs, Import / Check / Export actions, and the operator identity at the right. Main map content begins directly below this header. A roughly 314 px persistent left rail has tab navigation and dense but readable lists; a roughly 365 px right inspector has a title bar, scene thumbnail, identity, tabs, content, and fixed contextual actions. The central map spans approximately x=314–1307 in the expanded 3D reference. The 2D image collapses the right inspector into a narrow icon rail. Small borders, white panels, cool gray text, deep green active states, red findings, and blue utility accents are consistent. Map labels and thin white parcel boundaries are prominent; the map is not an unlabeled background behind an inspector.

Current v5 instead has a two-row header/context region ending around y=154, a large canvas beginning at x=0, a single 320 px inspector, and temporary Find/Layer popovers. Its inspector prioritizes floor/explode/cut controls; it omits the thumbnail, identity chips, information tabs, numeric overview, and full footer action set. There is no global search, administrative breadcrumb, persistent property list, mini-map, road-name labeling, scale bar, or bottom findings tray. The geometry is genuinely interactive and reusable, but the composition and information architecture do not replicate the pack. The requested reference fidelity requires reinstating these reference elements, not treating their absence as an improvement.

Use the unversioned REF-01 brand consistently, rather than mixing the V2 wordmark used in several variants into the current product. Preserve the layout and visual hierarchy while showing the actual local operator/data context; do not impersonate the pictured officer.

## REF-01 — 3D Block Map anchor / urban inspection dashboard

### Observed image

- Left tabs: Layers, Properties, Findings; collapse control. Expanded layer rows include Buildings, Parcels (ULPIN), Roads, Public Land, Pipeline (Underground), and Findings / Conflicts, each with a toggle and overflow action. A Reset action sits beside the section heading.
- Below layers: Properties in Block with count, local search/filter control, selected property row with conflict badge, and other address/identifier rows. The selected row has a pale green background and left accent.
- Map toolbar: 3D / 2D, Underground, Labels; Fit Block, Focus, north compass on the opposite side. A compact Block Overview map is anchored bottom-left. A bottom floating findings tray contains two red findings and a blue nearby-utility card.
- The scene depicts a medium-rise residential block with separate gardens/setbacks, a public park, road junctions/crossings, marked lanes, dense irregular foliage, boundary walls, detailed light roofs, inset windows/balconies, warm light, and soft shadows. The map continues outside the immediate focus. Three street names and the public park name follow map context. Parcel outlines remain clearly legible.
- The focal building is red, outlined, and labeled; orange/red plan regions show conflict areas. A blue dashed underground line remains visible through the street surface, with nodes and a readable water-pipeline callout.
- Right Building inspector: previous/next/close, scene thumbnail with conflict badge, property identifier/address/location icon, Residential / G+4 / Constructed chips; Overview / Parcels / Utilities / Photos / History tabs. It shows three metrics, a conflict metric, two issue rows, and nearby utility status. Footer: Open Register, Open Workspace, Start Investigation.

### Working interactions and data required

Link global and local search, map picks, list selection, previous/next, thumbnail, and inspector to the same object identity. Layer visibility must control corresponding actual scene groups; reset must restore a known layer preset. Fit, focus, north, 2D, labels, and underground must preserve selection. Findings select their exact evidence and open an investigation with both object IDs and geometry revisions. Register/workspace actions need real contextual routes, not a replacement record modal.

The schema must supply object/geometry identity, parcel relations, location/address assertions, floor counts and use/status provenance, named road/public-land objects, source-linked issues, utility alignments and any valid proximity result, linked assets, and record/workspace references. Thumbnail and mini-map are render-derived views of this dataset; they must not show an unrelated reference image. Built-up area, plot area, and conflict area require distinct definitions and provenance. Two issue areas cannot be summed into a total when their geometries overlap; compute a union for any aggregate and expose the definition.

### Current gap, priority, acceptance

**P0:** restore the common three-region composition, reference controls and inspector hierarchy, and scene-context layers. Current v5 has real orbit/fit/focus, footprints, conflicts, parcels, roads, and utilities; reuse them. It lacks most of the reference presentation and navigation. Its dense Neem Gali scene intentionally differs from this spacious reference layout, so that geometry difference is a dataset choice, not a reason to move or shrink buildings.

**P1:** richer materials, rooftop variation, vegetation, surface detail, named roads, mini-map and thumbnail. Current pastel architecture and tank decoration read as stylized models, with repeating roofs and simpler lighting; the reference has more varied small details, contact shadows, textured vegetation and ground, and gentler distant contrast. Increase those qualities without manufacturing canonical heights or setbacks.

**Acceptance:** a 1672 × 941 comparison has the same major panel proportions and control placement, all listed controls work, selected identity is consistent across views, and factual values are bound to the dataset. Use a separate reference-layout dataset to assess the reference composition; retain the dense dataset unchanged as a second test. Conflicts stay red when unselected, ordinary selection stays distinct, and null-height features remain flat. Capture opening, selection, collapsed rails, and the bottom findings tray against REF-01.

## REF-04 — Layers and 2D map / municipal GIS dashboard map

### Observed image

The left rail remains expanded with Layers selected. It adds Photos and Labels to the layer list; Utilities is a broader underground category. The center switches to a top-down cartographic scene: light gray roof plans, pale green ground, distinct black/white parcel edges, detailed trees and paths, labeled roads, selected red polygon and orange finding strips. The right becomes a narrow rail with Building, Parcels, Utilities, Photos, History icons. A mini-map remains bottom-left; the findings strip stays bottom-center. Bottom-right has a distance scale labeled in metres, plus zoom and a target/recenter control. Header search, breadcrumbs and import/export remain visible.

### Working interactions and data required

2D must be an actual orthographic plan camera and usable map style, not a 3D screenshot or a nearly overhead perspective. All objects, issues, layers, and selection must retain identity between 2D and 3D. The collapsed rail must reopen the selected category. Scale must derive from the actual orthographic viewport and named metre frame, updating with zoom/resizing. The mini-map must track the viewport. Labels need collision/visibility handling and layer settings, not constant overlapping DOM text.

Use the same canonical polygon rings/holes, footprints and geometry revisions as 3D. Source identifiers remain distinct from object identity. A true plan map must support tiny, narrow, concave, courtyard and touching/overlapping footprints independently. Photos layer needs evidence locations and linked source assets; absent assets should produce an honest empty state.

### Current gap, priority, acceptance

**P0:** v5 already has a true OrthographicCamera and exact polygons; keep it. It currently retains the 3D surface presentation, roof equipment and full inspector, rather than the reference's cartographic mode and collapsed category rail. It has no metric scale, mini-map, names, photo markers or Labels switch.

**Acceptance:** switching 3D ↔ 2D retains selection, camera context and layer settings; 2D screenshots reproduce the panel/toolbar/scale/minimap placement and cartographic hierarchy. Two different datasets and the dense overlapping case remain independently searchable and pickable. Verify a known frame distance against the scale calculation and ensure plan styling never alters coordinates.

## REF-05 — Data Tools import/export modal / GIS import tools

### Observed image

A centered modal roughly 900 × 650 px overlays a dimmed but recognizable Block Map. Title Data Tools, explanatory subtitle, close button, and wide Import / Export tabs. The visible Import tab contains numbered steps: input type tiles on the left (GeoJSON, Shapefile ZIP, ArcGIS JSON, PDF Plan, Scanned Image, Utility Drawing, Saved Snapshot); location selectors and Geometry Role below; replace-existing-layer checkbox. The right Preview section lists checkable layers, feature counts and visibility icons, followed by a small scene preview with red imported masses and blue boundaries. Cancel and Import & Preview sit bottom-right. No Export tab contents are shown.

### Working interactions and data required

File receipt, format selection, detected layer selection, geometry-role mapping, location/frame confirmation, preview and commit must remain distinct. Preview should show the actual incoming geometry in the same renderer, with stable feature counts and toggles. Cancellation must preserve the active scene. A replacement action must create/preserve revisions and originals; a same-name layer is not sufficient evidence that identities match. Export contents need confirmation from other references or a scoped design; this screenshot establishes the tab only.

Use sources/sourceRecords, byte hashes, revisions, frame and vertical datum, geometry roles, transform provenance, batches, suitability and issue status, stable object IDs and lineage. Structured GIS ingestion and document/image extraction are different pipelines into the same schema. Raw documents do not become spatial authority merely because the preview resembles a building. The user's latest “different data” requirement concerns arrangements in the same schema; it does not itself prove every pictured file parser already exists or must be faked.

### Current gap, priority, acceptance

**P0:** reproduce the modal structure and actual normalized-dataset preview workflow. Current v5 genuinely validates ZIP hashes/JSON geometry links and can replace the browser preview with another dataset; its small Open a dataset dialog has counts only, with no map preview, role mapping, layer selection or Import/Export layout.

**P1:** bind each pictured input tile to an existing, authorized ingestion path; show explicit unavailable/unsupported states where a parser is absent. Do not advertise a working DWG/Shapefile/PDF pipeline through a file input that only accepts normalized JSON.

**Acceptance:** capture the same modal anatomy at reference size. Import two distinct normalized datasets without schema changes; selecting layers changes the preview, not canonical source bytes. Invalid and mixed-frame input is explained before commit, cancellation preserves the current dataset, and re-import retains identity/revision semantics. Use actual feature counts and actual incoming geometry; export preserves canonical IDs, frame metadata, and originals where requested.

## REF-06 — Properties / parcel inspector

### Observed image

Properties is the active left tab, replacing the layer list with a full-height Properties / Parcels directory. It has search by ULPIN/address/owner, filter action, many address rows with per-row overflow/status, and bottom pagination. The central 3D view retains the same neighborhood, finding strip, utility line, controls and mini-map. A parcel boundary is highlighted with a white/red dashed perimeter around the focal building.

The right title is Parcel, with previous/next/close and a parcel scene thumbnail. Identity/address are followed by Overview / Parcel / Properties / Photos / History. The Parcel tab shows a verified badge and fields for parcel identifier, documented area, land use, zoning, ownership, status and public-land flag; Associated Buildings with a thumbnail and View in 3D; linked Property Register, Land Record and Building Plan entries; and Public Boundary Comparison with two colored areas and a difference. Contextual footer actions remain.

### Working interactions and data required

A parcel is a selectable first-class object, not merely a collapsed text link in a building inspector. List and map must support parcel ↔ building selection without losing surrounding camera context. Associated buildings must support zero, one or multiple linked buildings; links open the correct records/source revisions. Public-boundary comparison needs two explicitly identified geometry assertions, provenance, compatible frame and an actual computed difference.

Use parcels and buildings as separate object types, occupies/contains relations, identifier assertions, source observations and rights records. Ownership, zoning, verified status and documented area are sourced attributes/claims, not inferred from geometry or decorative labels. The current JSON can retain these as linked records; a missing field stays unavailable. Official ULPIN is distinct from internal 3D identity. Documented area, geometric area, and public-boundary area must remain separate.

### Current gap, priority, acceptance

**P0:** implement a generic selected-object inspector and persistent property/parcel directory. Current map picking and Find property operate on buildings only. The parcel control expands a text fragment rather than selecting/highlighting a parcel; there is no parcel details tab, associated-buildings navigation, linked-record layout, or boundary comparison.

**Acceptance:** reproduce the left directory and right Parcel state, including pagination when needed; select a parcel from map/list, navigate all associated buildings, and return without changing identity. Render exact parcel rings and holes. Test one parcel containing two buildings and one building linked to disputed parcel assertions; do not silently choose ownership. Boundary difference and verified badges appear only when the underlying evidence supports them.

## REF-07 — Utility and findings inspection

### Observed image

Left tabs show Layers, Utility, Findings with a red count. Utility Layers has Water Pipeline enabled and separate Sewer, Storm Water, Electric, Gas, Telecom/OFC, Manholes/Chambers rows. A local property list remains below. The map adds a Section toolbar button; the blue pipeline is bright with nodes and a name callout. A labeled A–A′ section line crosses the focal area. A floating Section View diagram shows ground/foundation and a pipe, with a numerical arrow. An on-map red/orange clearance callout points toward the building/utility relationship.

The bottom Findings tray is expanded: count, All/Parcel/Road/Utility filters, Show on Map toggle, three cards with category chips, values, descriptions, Zoom, View Details, and overflow. The right inspector's Utility tab shows nearest asset details, View in Map, asset identifier, type, diameter, top depth, owner/status, clearance result and criterion, an embedded section diagram and Open Full Section. Register/Workspace actions remain.

### Working interactions and data required

Utility layers must distinguish asset types and actually control visibility. Selectable utilities and nearest-asset results need canonical utility geometry, diameter/depth semantics, vertical datum, owner/source, quality and revision. Draw A–A′ from a defined section plane and show genuine intersections with supplied ground, foundation and pipe geometry; do not substitute the current horizontal building clipping slider for this spatial section workflow. Unknown ground/foundation/depth must be represented explicitly.

Clearance needs a specified geometric definition (horizontal, vertical or 3D), compared geometry revisions, metric frame, precision/tolerance and a named sourced rule before declaring an infringement. Findings filtering, Zoom, Details, show/hide and navigation must act on the same evidence record. Pipeline proximity does not automatically mean overlap. The section image must remain readable when a dataset has no utility or has several competing candidates.

### Current gap, priority, acceptance

**P0:** reference Findings tray, categorical cards and evidence navigation. Current v5 computes road/parcel/building intersections correctly but exposes them through a header dialog and simplified inspector. The visual hierarchy is substantially different.

**P1:** utility asset inspector and actual section workflow. Current Underground mode reveals authored lines through translucent geometry. There is a generic utility layer, not selectable utility types, asset details, a computed nearest relation, A–A′ section, or clearance evidence. Height cutting is useful but is a different capability.

**Acceptance:** capture the utility/reference layout using a dataset with explicit utility dimensions/depth and foundation geometry; filters and section plane change real rendered evidence. A second dataset with missing vertical evidence shows an unresolved result without a fabricated measurement. The same issue and asset IDs remain selected across the floating section, bottom card and inspector.

**Reference inconsistency requiring semantic correction:** REF-01 labels the example 1.8 m proximity as “No direct conflict”; REF-07 labels 1.8 m horizontal clearance “Within Conflict Limit” against a pictured ≥2.0 m rule. Its section diagram also draws a vertical arrow for the same number. Replicate the composition, not contradictory calculations. Do not treat the pictured rule or municipality as verified regulatory authority.

## REF-08 — Municipal start dashboard (misnamed photos/history sidebar)

### Observed image

This is a full start page under the shared header. A broad pale hero has a large “Convert plans and evidence into building details” title, supporting copy, and a small exploded building/plan illustration. To the right, a five-step Documents → Extract → Placement → Review → Complete workflow card uses numbered nodes and icons. Get Started contains five equal cards: Choose Property, Create Workspace, Add Source Documents, Open Recent Workspace, Continue Draft. Below, Recent Workspaces is a table with property/address, update time, status and Open/Continue actions; Recently Added Plans is a four-card thumbnail strip for ground floor, first floor, section and site plan with dates and processing states.

### Working interactions and data required

Every entry action needs a real continuation path with the correct property/workspace/source identity. Recent workspaces and drafts require persisted sessions, progress and timestamps; plan cards need source thumbnails, revisions and processing states. The workflow steps express source-to-record progression; automatic extraction is reviewed assistance, not proof that a plan has become validated geometry. The hero illustration may be a declared decorative asset; thumbnails in recent data must be actual source previews.

### Current gap, priority, acceptance

**P0 for whole-pack replication, outside the map renderer itself:** current v5 opens directly on the neighborhood and has no start/dashboard route, recent workspace table, plan thumbnails or source workflow. Assign this screen to shell/workflow ownership; do not misclassify it as a missing inspector tab.

**Acceptance:** reproduce the hero/workflow/start-card/table/plan-card arrangement, with persisted actual draft/source records and functional actions. Empty datasets get truthful empty states in the same layout. No screenshot-derived sample names, dates or processing statuses are hardcoded as actual user records. Photos/History content remains separately unproven by this image.

## Shared canonical schema across different datasets

Use one object/geometry/relation/source model and one viewer, not one bespoke model for the reference neighborhood and another for dense Delhi-style geometry. Current v5 already demonstrates the important foundations: stable IDs, explicit local frame and vertical benchmark, source links, exact polygon holes, height-null footprints, floors/spaces, derived spatial findings and independent overlapping-building selection. Retain those behaviors during the visual reconstruction.

| Reference need | Canonical binding | Required behavior when unavailable |
| --- | --- | --- |
| Building, parcel, road, public land, utility, floor, space | Typed objects + geometry versions + relations | Show missing geometry/height explicitly; never replace a supplied irregular shape with a decorative box |
| Map frame, scale, elevation/depth, sections | Named frame, units, vertical datum, transformations and uncertainty | Disable unsupported measurement, preserve source coordinates and explain mismatch |
| Parcel 2D identifier vs building/floor/space identity | Identifier assertions with issuer/status/source; stable internal IDs | Display unissued/unverified state without fabricating an official ID |
| Metrics, overlap patches, clearance and comparison | Computed issue/evidence with geometry refs, method, tolerance and revision | No red “conflict” from missing height alone; no positive overlap for a shared wall; unknown Z remains a plan finding |
| Owner, zoning, land use and verified badge | Rights/observations/source-linked claims, not geometric inference | Preserve unknown/disputed states and competing assertions |
| Photos, plans, history, linked records | Source assets, originals, revisions, lineage, event history | Empty state or unavailable asset, not a reference screenshot masquerading as current evidence |
| Recent workspace/draft state | Session/workflow records linked to object and source IDs | Empty start page remains useful; no synthetic completion claims |
| Rendered detail, tree/vehicle decoration, thumbnails | Dataset presentation metadata and renderer-derived previews | Decorative geometry stays separate from analytical geometry; no invented height/clearance |

Dataset acceptance must cover at least: (1) a spacious reference-composition neighborhood; (2) the current 82-building dense neighborhood; (3) positive overlaps and exact shared-wall contacts; (4) unknown heights and vertically disjoint buildings; (5) concave polygons/holes and different extents; (6) multiple buildings per parcel; (7) a utility-rich section case and a utility-absent case. The same routes, controls and schema must operate for all of them. The data drives street orientation, massing, floor availability, names and findings. A source arrangement must never be artificially separated to resemble the reference.

## Bounded implementation priorities and review gates

1. **P0 shell and selected-object architecture:** reproduce REF-01 proportions, global search/location/actions, persistent left tabs/list, right inspector tabs/thumbnail/actions and collapsible regions. Preserve the renderer and actual selection/state APIs. Verify same identity across routes and dataset switches.
2. **P0 map visual modes:** reference-composition fixture plus dense fixture under the same renderer; retain exact polygons and conflict handling. Add reference map labels, public-land presentation, mini-map, scale, correct 2D treatment and selected parcel support. Tune lighting/material detail against screenshots, not against filenames or a remembered aesthetic.
3. **P0 findings and data tools:** adopt the bottom findings tray and real input preview layout, preserving computed evidence, non-overlapping totals, original bytes and revisions. Unsupported imports are explicit; swapping normalized datasets already works and must remain tested.
4. **P1 evidence-rich inspectors:** associated buildings, record links, boundary comparison, photos/history, utilities and real section geometry. Complete or identify dependencies before making visual factual claims.
5. **P0 whole-pack dashboard ownership:** implement REF-08 in shell/workflow work alongside the other pack routes. Do not mark the entire pack replicated when only the map renderer resembles one anchor.

Review every reference state at 1672 × 941 beside its actual source image, then at tablet size. Check typography, panel extents, visible content density, toolbar placement, map composition, color semantics, and actual functionality separately. Automated interaction success does not establish visual acceptance. Conversely, a close screenshot with static or unrelated image content does not satisfy the map requirement. Preserve keyboard search/selection, Escape, focus handling, layer state, renderer recovery, and frame performance while expanding the reference UI. Measure performance on the actual browser/backend and state the observed cadence; do not claim a universal frame rate from a headless run.
