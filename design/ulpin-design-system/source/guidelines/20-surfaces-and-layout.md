# Surfaces and layout

Finale scope: the Officer Studio. The Public Portal and Admin Console are full-product scope; their rules stay here so the Studio does not block them.

Three surfaces share tokens but not layouts. The Portal follows UX4G page patterns; the Studio is a map-first workbench; the Admin Console is a dense table and chart view.

## Public Portal (citizens)

- Frame: UX4G accessibility bar (`a11y-bar`, 32px) then the Portal header (`header-portal`, 64px) with the wordmark, a department-mark slot, **English / हिन्दी** switch and **Sign in**. Content is centred at `portal-content` (1200px); footer uses the UX4G footer.
- Comfortable density: `portal-*` type, `touch-height` controls, one column below 768px.
- Released data only. Owner names, documents and unreleased findings never appear; a record shows a "Released details only" note.
- Maps on the Portal are view-only: the same scene styling, no editing tools, and a list view beside or below.

## Officer Studio (reviewers)

- Top bar (`header-studio`, 56px): wordmark, primary navigation **Batches · Map · Register**, global search (`/`), dataset or area switcher, live status, theme toggle, user menu.
- Map page grid: optional left panel (`rail-left`, 308px, closed by default) · canvas · inspector (`rail-right`, 360px), with a collapsible bottom tray (`tray-height`, 172px) for the import stream and findings list. Panels float on `bg` with `space-4` gaps, `radius-12`.
- The left panel holds one of: Layers, Spaces, Sources, Checks. It is closed by default and opens on demand over the canvas, one at a time. Only one tray (import stream or findings) is open at once.
- The inspector holds one selection with tabs **Overview · Rights · Evidence · Checks · History**. It widens to `rail-right-wide` when an evidence preview is open.
- The Workspace opens from a queue item or a selected property. It is one canvas with modes **Add files → Review details → Check & record**, plus Tools (measure, calibrate, compare).
- Register pages use `max-content` width: identity header once, then the model with the floor and unit table, then tabs for Documents, Checks, History.
- Always offer **Back to map** that restores the camera and selection.

## Admin Console (supervisors)

- Same top bar as the Studio with navigation **Overview · Imports · Coverage · Users · Audit · Settings**.
- Overview is summary first: four stat tiles (open findings, spaces awaiting review, imports running, 3D ULPINs issued this week), then trends, then tables. Every number opens the filtered list behind it.
- Charts follow the data-viz rules: one axis, thin marks, legends for two or more series, status colours only for status.

## Breakpoints

| Width | Studio | Portal |
| --- | --- | --- |
| 1440 and up | Rails, canvas, inspector side by side | 12-column grid, 1200px content |
| 1024 to 1439 | Left rail collapses to icons; inspector stays | Same, narrower gutters |
| 768 to 1023 | Inspector becomes a right sheet over the canvas | 8-column grid |
| Below 768 | View-only map with bottom sheet; editing is desktop-only | Single column, sticky search |

## Navigation forms

| Item | Form |
| --- | --- |
| Import, export | Dialog (`dialog-lg`) with steps |
| Parcel, utility, photos, history | Inspector tabs |
| Findings | Bottom tray list plus inspector detail |
| Evidence source | Evidence viewer overlay (`dialog-lg`), side by side with the 3D space |
| Assign proposed 3D ULPIN, retire, split, merge | Confirmation dialog showing the code and lineage |
| Property Card | Full-page preview with print and QR |
