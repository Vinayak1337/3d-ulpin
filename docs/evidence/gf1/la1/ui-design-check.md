# LA1 UI design check

Change: `apps/studio/src/features/map/` (new `areaWindow.ts`, `WindowedArea.tsx`; edits to `MapPage.tsx`,
`MapWorkspace.tsx`) and `apps/studio/src/api/queries.ts`, against `origin/staging` (`410247e4`).

## Blocking

None. Every value shown is read from the server: the count line from `display-summary.featureCount` and the
features read, the outlines and heights from `display-window`, the identifier and kind from the window feature. An
unstated height stays null and the footprint is drawn flat, never extruded to a guess. No theme switch, no dark or
mobile variant, no provenance label.

## Design system

- Fixed during the check: `WindowedArea.tsx` first showed the identifier as the inspector title in heading type. It
  now titles the inspector with the kind and shows the identifier through `CopyableId` (mono, copyable), as
  identifiers are elsewhere in the Studio.

## Checked, no issue

- Tokens and shape: no new CSS; the window map reuses `MapWorkspace.module.css` (`workspace`, `canvasWrap`,
  `banner`, `leftStack`, `viewNote`, `inspectorColumn`, `closeInspector`, `readout`).
- One inspector per selection (`InspectorShell`), no primary action added.
- Copy is sentence case and plain: 'Showing 15,000 of 41,809 buildings; move closer to see the rest.' or
  '41,809 buildings'; the count line has `role="status"` so a screen reader hears it change.
- Keyboard and focus: the close button is the existing icon button with an `aria-label`; the copy button carries
  its own label; the scene keeps its labelled canvas.
- The danger banner for a failed window read names the failure and keeps the server's message; an area under the
  limit opens `MapWorkspace` exactly as before.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs origin/staging` -> exit 0 ('0 added line(s) in
apps/web. No candidates.'; the scan covers `apps/web` only, so the Studio files were read by hand above).
