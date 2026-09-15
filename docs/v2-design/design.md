# 3D ULPIN — V2 redesign specification (final expanded pack)

Version 3.0 · Prepared for Vinayak · 15 September 2026  
Repository: `Vinayak1337/3d-ulpin`

## 0. Purpose

This pack redesigns the site into a cleaner V2 officer-facing experience **without sacrificing functionality**. It covers the three main page families, the internal navigation inside those pages, and the previously missing entry states where the user starts by choosing a block, selecting a property, or creating a workspace.

The design target is the full operational loop:

1. open a real block,
2. search or click a property,
3. inspect the surrounding block context,
4. inspect parcel / public land / road / utility relationships,
5. open that property’s register,
6. inspect floors, units, evidence, issues, history and investigations,
7. open or create a plan workspace,
8. measure, calibrate, compare and build details,
9. review and submit changes,
10. return to the same searchable block context.

## 1. IA and route model

Build the new experience under `/v2`:

```text
/v2
/v2/blocks/[areaId]
/v2/register
/v2/properties/[buildingId]/register
/v2/workspace
/v2/properties/[buildingId]/workspace
```

### Route purpose

- `/v2` — entry surface; open recent area or choose block/source
- `/v2/blocks/[areaId]` — main spatial operating page
- `/v2/register` — register start page (search/open recent/open from area)
- `/v2/properties/[buildingId]/register` — property register
- `/v2/workspace` — workspace start page (create/reopen)
- `/v2/properties/[buildingId]/workspace` — plan workspace for that property

## 2. Visual design language

### Core principles
- minimal, calm, professional, municipal-grade interface
- large dominant spatial/document canvas
- very little explanatory text; the UI should explain itself
- strong information hierarchy
- simple green/white/gray palette with restrained accents for severity
- compact but readable controls
- white cards over a pale neutral background
- clear map overlays and semantically distinct feature styles

### Core tokens
Use the tokens in `tokens.css`. All V2 styling must be scoped under `.ulpin-v2` (or a V2 layout root) so the old app remains untouched.

## 3. What counts as the “3D property” in the UI

Do not treat the mockup images themselves as product data.

### Use these actual product objects
- **building exterior** = the real or imported footprint + supported height/building-part information
- **parcel** = recorded parcel geometry and metadata
- **roads/public land** = real supplied geometry and its type meaning
- **utilities** = actual supplied alignment/profile/level meaning
- **floors & units** = real detailed registry records or prepared draft records
- **findings** = actual geometry/logic outputs from the app
- **documents** = real evidence entries and previews

### Display geometry vs analytical geometry
If the product uses richer display geometry (for example GLB or 3D Tiles) it must remain traceable to the same property identity. The displayed mesh must not replace the underlying analytical geometry used for checks.

## 4. Image coverage in this pack

### Anchor images
- `images/anchors/01-block-map-anchor.png`
- `images/anchors/02-property-register-anchor.png`
- `images/anchors/03-plan-workspace-anchor.png`

### Block map internal UIs
- `images/block-map/01-layers-2d-map.png`
- `images/block-map/02-import-export-data-tools-modal.png`
- `images/block-map/03-properties-parcel-inspector.png`
- `images/block-map/04-utility-and-findings.png`
- `images/block-map/05-photos-and-history-sidebar.png`

### Register internal UIs
- `images/register/01-register-start-page.png`
- `images/register/02-floors-and-units-page.png`
- `images/register/03-investigation-page.png`

### Workspace internal UIs
- `images/workspace/01-workspace-start-page.png`
- `images/workspace/02-measure-workspace-page.png`

### Reference boards
The multi-panel boards under `images/reference-boards/` exist to cover missing interaction patterns such as Evidence, Issues, Register History, Workspace Calibrate, Compare and Build Details.

## 5. Page family specs

## 5A. Block Map — `/v2/blocks/[areaId]`

### Purpose
The officer’s primary spatial operating page.

### Main layout
- compact top bar with area name, breadcrumb, search, actions
- left rail: layers + properties list (toggleable)
- center: 3D or 2D map canvas
- right rail: contextual inspector (parcel / property / utility / photos / history)
- bottom tray: findings

### What the page must support
- global search by property / parcel / building id
- fit block / focus selection
- 3D ↔ 2D toggle without losing context
- show whole block when one property is searched
- layers: buildings, parcels, roads, public land, utilities, photos, labels, terrain
- select property and open register/workspace
- exact conflict highlighting, not just whole-object coloring

### Internal navigation treatment
- **Layers** → left sidebar
- **2D Map** → same page mode toggle
- **Import / Export** → modal (same Data Tools shell)
- **Parcel / Utility / Photos / History** → right inspector tabs/states
- **Properties** → left list rail
- **Findings** → bottom tray

### Missing-but-required states for Block Map
These may not all have dedicated images, but they must be designed:
- no area loaded
- no property selected
- map loading skeleton
- import mapping review state
- export report preview state
- utility unavailable / no depth / unknown vertical reference
- no findings yet
- external data unavailable but saved snapshot exists

## 5B. Register start page — `/v2/register`

### Purpose
This is the starting point when the user wants to open a property register without already being inside the block map.

### Main content
- top search by ULPIN / property id / building id
- recent properties
- saved investigations and recent register drafts
- quick jump back to the latest block
- button to open selected property from search results

### Missing-but-required states
- no recent properties
- property not found
- property exists but no detailed records yet
- open from map selection handoff

## 5C. Property Register — `/v2/properties/[buildingId]/register`

### Purpose
Structured property record for one building/property.

### Main layout
- top summary bar: property identity, location, status, actions
- left sub-navigation: Overview, Floors & Units, Evidence, Issues, History, Investigation
- center content: selected tab content
- optional right panel: details, filters, quick evidence preview, actions

### Required tabs
#### Overview
- property summary, parcel linkage, status badges, quick metrics
- open in block map / open workspace

#### Floors & Units
- 3D building stack or sectional stack
- floor list and unit register
- quick open of unit or floor evidence

#### Evidence
- document list with filters
- preview pane or modal
- source metadata and linkage

#### Issues
- issue list with status / type / severity filters
- open issue details or create investigation

#### History
- timeline of updates, source changes, review events

#### Investigation
- current or historical investigations
- discrepancy summary
- evidence requests
- notes, assignee, status, close/reopen flow

### Missing-but-required states
- building exists but no floors/units yet
- evidence exists but no preview available
- issue list empty
- history empty
- no active investigation

## 5D. Workspace start page — `/v2/workspace`

### Purpose
The missing “create workspace first” page.

### Main content
- search existing property
- choose recent workspace
- continue draft workspace
- create new workspace
- attach documents first then assign to property

### Required actions
- **Add Existing Property**
- **Create New Workspace**
- **Resume Draft**
- **Open Recent Workspace**

### Missing-but-required states
- no workspaces yet
- unassigned documents exist
- build draft exists but property unresolved

## 5E. Plan Workspace — `/v2/properties/[buildingId]/workspace`

### Purpose
Preparation surface where plans/evidence become structured building details.

### Main layout
- top workspace step bar or mode tabs
- left rail: documents / tool modes / layers
- center: plan canvas or compare canvas
- right rail: mode-specific panel (measurement, calibration, diff, build review)

### Required modes
#### Measure
- distance, area, perimeter, angle, height, point markers
- measurements list and add-to-notes action

#### Calibrate
- set scale with known distance
- optional control point alignment
- show current scale / units / reset

#### Compare
- overlay approved vs measured / source A vs source B
- side-by-side and split-slider modes
- opacity and color-coded difference hints

#### Build Details
- review extracted floors, units, building attributes, heights, linked evidence
- unresolved questions panel
- build / update draft / send for review

### Missing-but-required states
- no source plan yet
- plan uploaded but unplaced
- calibration incomplete
- compare source missing
- build blocked by unresolved questions
- build finished / ready for review

## 6. Important UX rules

### 6.1 Do not over-page everything
Some things should remain embedded in a single operational page:
- Import/Export = modal/dialog
- Photos/History = contextual side tabs
- Findings = bottom tray
- Register tabs = same shell
- Workspace tools = same shell, same canvas, different mode

### 6.2 Preserve navigation context
If the officer came from a selected building on the block map, opening Register or Workspace must preserve a clear “Back to Block” action and restore selection state.

### 6.3 Minimal text, high clarity
Use labels, icons, chips, sections and visual grouping instead of long explanatory copy.

### 6.4 Severity and state styling
- red = active severe discrepancy
- amber = warning / needs evidence / unresolved
- blue = informational
- green = reviewed / valid / ready

Do not let color alone carry meaning; use icons and badges too.

### 6.5 Functional truth rules
- do not label a source id as official ULPIN unless it is one
- do not add overlapping finding totals incorrectly
- do not show a utility as safe just because it is visible
- do not show a building as cleared just because it is selected
- do not show unsupported geometry as authoritative

## 7. Additional UIs that may have been missed

These do not all need images, but they must be specified and built:

### Global / shell states
- V2 home
- recent activity tray
- notifications / sync status
- user workspace / local saved state indicator

### Dialogs
- create workspace
- add existing property
- confirm import
- export package options
- submit for review
- reopen investigation
- resolve stale draft

### Inline / embedded states
- evidence preview modal
- compare legend
- build validation summary
- unresolved questions list
- source mismatch warning
- stale data banner

### Empty/loading/error states
- loading map
- loading dossier
- loading PDF/image preview
- no evidence
- no findings
- failed import
- calibration missing
- compare cannot run
- export failed

## 8. Accessibility and responsiveness

### Accessibility
- all interactive targets at least 40–44 px tall
- keyboard navigable rails, tabs, dialogs and trays
- visible focus states
- readable text contrast
- semantic headings and landmarks

### Responsive behavior
Desktop-first design. Target at minimum:
- 1440×900
- 1366×768
- 1920×1080
- browser zoom 125%

Below tablet width:
- rails become drawers
- findings tray may become modal sheet
- workspace right panel may collapse into a step drawer

## 9. Acceptance checklist

The redesign is only successful if the officer can:

1. open a block and understand it quickly,
2. search a property and keep its surrounding block visible,
3. inspect a parcel/property/utility/finding with contextual panels,
4. open that building’s register,
5. inspect floors, units, evidence, issues, history and investigation,
6. open or create a workspace,
7. measure, calibrate, compare and build details,
8. return to the same building and block context,
9. complete the workflow without relying on long explanatory text.

## 10. Implementation note

Use the images as style/composition references. Use the actual product data and domain logic for buildings, parcels, utilities, floors, units, evidence, findings, and investigations.
