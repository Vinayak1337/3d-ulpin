# UI navigation matrix — V2 redesign

This matrix defines **how each internal navigation item should be built**. The goal is to prevent turning every button into a separate page when a better interaction pattern is a modal, inspector, tray, embedded tab, or same-canvas mode.

## 1) Block Map

| Navigation item | Recommended UI form | Coverage status | Visual reference | Implementation note |
|---|---|---|---|---|
| Layers | left sidebar / collapsible rail | rendered | `images/block-map/01-layers-2d-map.png` | Primary map controls live here. Include base map, 2D/3D, visibility toggles, and opacity. |
| 2D Map | same page mode toggle | rendered | `images/block-map/01-layers-2d-map.png` | Preserve search, selection, findings, and inspector state when switching from 3D to 2D. |
| Import | modal / step dialog | rendered | `images/block-map/02-import-export-data-tools-modal.png` | Use source selection, file upload, mapping review, and import confirmation. |
| Export | modal / tab inside same Data Tools shell | planned in docs | `images/block-map/02-import-export-data-tools-modal.png` and `images/reference-boards/board-05-detailed-grid-board.png` | Do not create a dedicated route. Use tabs: current view, selected data, report package. |
| Parcel | contextual right inspector | rendered | `images/block-map/03-properties-parcel-inspector.png` | Show parcel attributes, linked buildings, related sources, and open register. |
| Utility | contextual right inspector + mini section card | rendered | `images/block-map/04-utility-and-findings.png` | Show profile, material, level meaning, and related findings. |
| Photos | right inspector tab / gallery drawer | rendered | `images/block-map/05-photos-and-history-sidebar.png` | Best as a gallery inside the contextual side panel. |
| History | right inspector tab / vertical timeline | rendered | `images/block-map/05-photos-and-history-sidebar.png` | Timeline scoped to selected feature or current area. |
| Properties | left rail searchable list | rendered | `images/block-map/03-properties-parcel-inspector.png` | Property list remains visible while map stays dominant. |
| Findings | bottom tray + filter pills | rendered | `images/block-map/04-utility-and-findings.png` | Clicking a finding should highlight all participants and exact geometry. |

## 2) Property Register

| Navigation item | Recommended UI form | Coverage status | Visual reference | Implementation note |
|---|---|---|---|---|
| Initial Register page | dedicated start surface | rendered | `images/register/01-register-start-page.png` | Start by search, recent properties, or opening from selected block feature. |
| Overview | top summary section in register shell | planned in docs | `images/anchors/02-property-register-anchor.png` | Key metrics, status, linked parcel/building identity, and quick actions. |
| Floors & Units | primary tab/page content | rendered | `images/register/02-floors-and-units-page.png` | Main 3D stack / floor list + unit register. |
| Evidence | tab in same shell | planned in docs | `images/reference-boards/board-04-21-panel-board.png` | Document list + preview pane, filters, source metadata. |
| Issues | tab in same shell | planned in docs | `images/reference-boards/board-04-21-panel-board.png` | Status-filtered issue list with deep links into investigation. |
| History | tab or side timeline | planned in docs | `images/reference-boards/board-04-21-panel-board.png` | Keep property history visible without leaving the record. |
| Investigation | dedicated tab/page shell | rendered | `images/register/03-investigation-page.png` | Case workflow for evidence requests, discrepancy review, and closure. |

## 3) Plan Workspace

| Navigation item | Recommended UI form | Coverage status | Visual reference | Implementation note |
|---|---|---|---|---|
| Initial Workspace / Start page | landing page for create / reopen | rendered | `images/workspace/01-workspace-start-page.png` | Missing “create workspace first” surface is intentionally added. |
| Measure | same canvas mode with tool rail | rendered | `images/workspace/02-measure-workspace-page.png` | Distance, area, perimeter, angle, height, point tools. |
| Calibrate | same canvas mode + compact side panel | planned in docs | `images/reference-boards/board-04-21-panel-board.png` and `images/reference-boards/board-05-detailed-grid-board.png` | Two-point known distance or control point based alignment. |
| Compare | same canvas mode with split/overlay toolbar | planned in docs | `images/reference-boards/board-04-21-panel-board.png` and `images/reference-boards/board-05-detailed-grid-board.png` | Side-by-side, opacity overlay, swipe comparison, and difference highlights. |
| Build Details | same canvas mode with right review panel | planned in docs | `images/reference-boards/board-04-21-panel-board.png` and `images/reference-boards/board-05-detailed-grid-board.png` | Review extracted structure, floors, units, heights, linked evidence, and submit. |

## 4) Additional required states that may be easy to miss

These do **not** all need dedicated images, but they must be handled in implementation and are specified in `design.md`:

- empty state: no area selected
- empty state: no property selected
- empty state: no workspace exists yet
- loading state: map / dossier / document preview / comparison
- error state: failed import / failed export / geometry mismatch / calibration missing
- stale state: investigation or workspace changed elsewhere
- permissions state: evidence unavailable / utility restricted / external data missing
- offline / saved snapshot state
- confirmation dialogs: create workspace, import complete, build complete, submit for review
