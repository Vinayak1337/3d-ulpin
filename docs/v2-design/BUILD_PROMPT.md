# GPT-6 Ultra implementation handoff — 3D ULPIN V2 redesign (final expanded pack)

You are implementing the new V2 UI for `Vinayak1337/3d-ulpin`.

Read these files first, in order:
1. `design.md`
2. `UI_NAVIGATION_MATRIX.md`
3. `tokens.css`
4. all images under `images/`

This is an implementation assignment, not another design review.

## 1. Goal

Build a new V2 presentation layer that preserves the existing domain functionality while redesigning the app into a cleaner officer-facing product.

## 2. Build these V2 routes from scratch

```text
/v2
/v2/blocks/[areaId]
/v2/register
/v2/properties/[buildingId]/register
/v2/workspace
/v2/properties/[buildingId]/workspace
```

Keep the existing app routes available and visually unchanged.

## 3. Main page families and required internal navigation

### A. Block Map
Must support:
- Layers
- 2D Map
- Import
- Export
- Parcel
- Utility
- Photos
- History
- Properties
- Findings

### B. Register
Must support:
- Register start page
- Overview
- Floors & Units
- Evidence
- Issues
- History
- Investigation

### C. Plan Workspace
Must support:
- Workspace start page
- Measure
- Calibrate
- Compare
- Build Details

## 4. Important design rule

Do not turn every navigation button into a separate page.

Use the UI form defined in `UI_NAVIGATION_MATRIX.md`:
- Import/Export → modal/dialog
- Parcel/Utility/Photos/History → contextual inspector or side rail state
- Findings → bottom tray
- Register sections → same shell tabs
- Workspace modes → same canvas, different mode panels

## 5. Visual implementation rules

- Match the white/green/gray visual language from the references.
- Keep a compact header and large content canvas.
- Use minimal explanatory text.
- Make the UI self-explanatory through structure and interaction.
- Build readable, production-quality desktop layouts.
- Scope V2 styles so the old app is unaffected.

## 6. Functional preservation rules

The V2 UI must still use the real app logic for:
- block/area loading
- search and identifier resolution
- building selection
- map context retention
- parcel/building/public/utility findings
- dossiers/register data
- floors and units
- evidence and source previews
- issues and investigations
- workspace creation/opening
- measurements / calibration / compare / build details
- review and update workflows

Do not create a disconnected mock UI.
Do not hardcode fake register data as the functional source of truth.
Do not use the generated images as live page backgrounds.

## 7. Design truth rules

Where the generated reference images contain illustrative or imperfect labels, follow `design.md`, not the literal text in the image.
Examples:
- do not label a generic source ID as official ULPIN unless true
- do not sum overlapping findings incorrectly
- do not imply a utility is safe merely because a panel is green
- do not invent floors/units or geometry beyond supported product data

## 8. Coverage from images

### Block Map references
- `images/anchors/01-block-map-anchor.png`
- `images/block-map/01-layers-2d-map.png`
- `images/block-map/02-import-export-data-tools-modal.png`
- `images/block-map/03-properties-parcel-inspector.png`
- `images/block-map/04-utility-and-findings.png`
- `images/block-map/05-photos-and-history-sidebar.png`

### Register references
- `images/anchors/02-property-register-anchor.png`
- `images/register/01-register-start-page.png`
- `images/register/02-floors-and-units-page.png`
- `images/register/03-investigation-page.png`
- use the boards in `images/reference-boards/` for Evidence / Issues / History patterns

### Workspace references
- `images/anchors/03-plan-workspace-anchor.png`
- `images/workspace/01-workspace-start-page.png`
- `images/workspace/02-measure-workspace-page.png`
- use the boards in `images/reference-boards/` for Calibrate / Compare / Build Details patterns

## 9. Implementation strategy

### Step 1 — inspect current repo state
- Verify the latest branch/PR/head.
- Reuse the best available implementation branch with the latest officer workflow functionality.
- Create a new branch for the redesign work.

### Step 2 — create the V2 shell
- add a dedicated V2 layout and navigation
- add route scaffolding for all V2 pages
- keep old layout isolated

### Step 3 — build Block Map V2
- implement left rail, map shell, right inspector, bottom findings tray
- support 3D/2D switch
- implement Import/Export modal shell
- implement contextual inspector modes for Parcel, Utility, Photos, History

### Step 4 — build Register V2
- implement register start page
- implement register shell and all tabs
- ensure the selected building’s record is the one being shown

### Step 5 — build Workspace V2
- implement workspace start page
- implement canvas shell and tool modes
- implement Measure, Calibrate, Compare, Build Details panels

### Step 6 — fill the missing states
Add all required states even if no dedicated image exists:
- empty
- loading
- error
- stale
- no data
- blocked by missing calibration / missing compare source / unresolved questions

### Step 7 — verify functionality
Test the full flow:
- open block
- search property
- inspect parcel/finding/utility
- open register
- open workspace
- create or resume workspace
- measure
- calibrate
- compare
- build details
- return to block

## 10. Deliverables

Return:
- branch/PR link
- exact implemented routes
- screenshots of the final V2 pages
- what functionality was preserved
- what remains blocked or approximate
- test results for the end-to-end flow

Do not merge or deploy publicly without separate authorization.
