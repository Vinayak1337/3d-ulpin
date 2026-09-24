# Surfaces and layout

Three surfaces share tokens but not layouts. The **Officer Studio** is the finale product. The **Public Portal** and **Admin Console** are full_product (FP-PUBLIC and later); their rules are here so the Studio does not paint them into a corner.

## Officer Studio (finale_v1)

Routes are fixed by [H99](../usp-agent-handoffs/99-ui-ux-and-integration.md) section 3. The frame:

| Zone | Size | Contents |
| --- | --- | --- |
| Top bar | 56 px, full width | Wordmark, **Batches · Map · Register**, search (`/`), area switcher, Live or Snapshot status, theme, user |
| Scope strip | 36 px, top of the map column | Area, source classification, revision; **Add files** |
| Canvas | Flexible majority | The Cesium scene |
| Map toolbar | Floating, top-left of canvas | Tools and view toggles, one row |
| Level rail | Floating, right edge of canvas | Levels with the vertical reference |
| Legend | Floating, bottom-left of canvas | Only the active Colour by legend plus evidence and record keys |
| Readout | Bottom edge of canvas | Coordinates, height, frames, scale, north |
| Left panel | 308 px, **closed by default** | One of Layers, Spaces, Sources, Checks, opened on demand over the canvas |
| Inspector | 360 px; 400 px with an evidence preview | The one selected thing: identity header, tabs **Overview · Rights · Evidence · Checks · History**, one primary and one secondary action in the footer |
| Tray | 172 px, collapsible, bottom of the map column | Either the import stream or the findings list, never both |

- The top bar has one navigation row only; the scope strip is context, not navigation.
- A finding, packet or history panel replaces the inspector's foreground with a clear **Back**; do not stack panels.
- **Workspace** (`/studio/properties/:buildingId/workspace`) is one canvas with stages **Add files → Review details → Check and record**, plus Tools (measure, calibrate, compare).
- **Register** (`/studio/properties/:buildingId/register`) is a page at up to 1600 px: identity header once, the model with the level rail, the floors and units table, then tabs Shares, Documents, Checks, History.
- **Batches** (`/studio/work`) shows exact work items and next actions with at most three scope-qualified counts. There is no separate dashboard per feature.
- Operator capabilities (AI provider state, offline profile) live in the existing workspace dialog, not a settings page.
- Always offer **Back to map**, restoring camera and selection.

### Navigation forms

| Item | Form |
| --- | --- |
| Add files, export | Dialog (960 px) with steps |
| Parcel, utility, photos, history | Inspector tabs |
| Findings | Tray list plus inspector detail |
| Evidence source | Evidence viewer overlay (960 px), side by side with the 3D space |
| Assign proposed 3D ULPIN, retire, split, merge | Confirmation dialog (760 px) showing the code, location line and lineage |
| Property Card | Full-page preview with export and the local QR |

## Breakpoints

| Width | Studio | Portal (full_product) |
| --- | --- | --- |
| 1440 and up | Canvas plus inspector; left panel and tray on demand | 12-column grid, 1200 px content |
| 900 to 1439 | Optional panels collapse to icons; inspector stays | Same, narrower gutters |
| 620 to 899 | Inspector becomes a right sheet over the canvas | 8-column grid |
| Below 620 | One full-height sheet; scope header and action stay visible; view-first, editing desktop-only | Single column, sticky search |

## Public Portal (FP-PUBLIC)

- Frame: UX4G accessibility bar (32 px), then the Portal header (64 px) with wordmark, empty department-mark slot, **English / हिन्दी** switch and **Sign in**. Content at 1200 px; UX4G footer.
- Comfortable density: Portal type scale, 44 px controls, one column below 768 px.
- Released data only; owner names, documents and unreleased findings never appear. Every record page says "Released details only".
- Maps are view-only with a list beside or below. Phones get a static image with **Open 3D**.
- Public routes run under `/public/*` behind their own ingress allowlist and session cookie (H13 Z3).

## Admin Console (full_product)

Not built for the finale. When built: same top bar with **Overview · Imports · Coverage · Users · Audit · Settings**; summary first, and every number opens the filtered list behind it; charts with one axis each and status colours only for status. In the finale, Batches carries the counts and the workspace dialog carries capability state.
