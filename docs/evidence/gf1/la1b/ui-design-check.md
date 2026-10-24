# LA1b UI design check

Change: `apps/studio/src/features/map/` (`areaWindow.ts`, `WindowedArea.tsx`, the window-mode lines of
`MapWorkspace.tsx`) and `packages/scene/src/engine.ts` (`fitPlanBox`), against `staging` (`41c5773b`).

## Blocking

None. Every value shown is read from the server: the empty sentence appears only when `display-summary` states 0
features or no extent; the inspector shows the kind and identifier the window feature holds and links the
building's register by its id. No sample value, no invented field, no theme switch, no dark or mobile variant, no
provenance label.

## Design system

None found.

## Checked, no issue

- Tokens and shape: no new CSS. The empty sentence reuses the map's existing empty card (`noGeometry`,
  `ul-float` + `emptyCard` in `MapWorkspace.module.css`), the same card that says 'No geometry is recorded for this
  area yet'.
- Copy: one plain sentence in sentence case, 'This area has no recorded buildings to draw yet.'; no danger banner
  for this case, because nothing failed.
- One inspector per selection (`InspectorShell`) and one primary action in its footer: 'Open register', the same
  words and route as the normal inspector's link (`/studio/properties/{id}/register`). A feature that is not a
  building gets no action.
- Identifiers stay mono and copyable through `CopyableId`.
- Keyboard and focus: the register action is a real link styled `ul-btn`, reachable by Tab with the shared focus
  ring; the close button keeps its `aria-label`.
- The scale readout is hidden when nothing is drawn, as the normal map hides it for 'No geometry'.
- An area under the limit opens `MapWorkspace` as before; its window hook reads no summary and adds nothing.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` -> exit 0 ('0 added line(s) in
apps/web. No candidates.'; the scan covers `apps/web` only, so the Studio files were read by hand above).
