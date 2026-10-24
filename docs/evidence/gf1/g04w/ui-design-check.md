# UI design check: G04W

Change: `git diff 3f9e9d33` under `apps/studio/src/features/map/`: `WindowedArea.tsx` passes the window's
`packageId` to `BuildingCard` (one prop and its doc comment), and `inspector/BuildingCard.test.tsx` gains one test.
Nothing on screen is added, moved or restyled.

## Blocking

None.

## Design system

None.

## Checked, no issue

- Values from records (AGENTS.md data rules): the package id is read from the window's row for the proposal
  (`import_packages.id` of the package the proposal rule chose); a recorded building has none and is read as before.
  The card section shows only what the by-feature target read returns, as in G04M.
- One inspector per selection and one primary button: unchanged; "Open register" stays the only primary action.
- No new CSS, token, copy or status word; no theme or responsive change.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 3f9e9d33` exit 0 ("0 added line(s) in apps/web.
No candidates."; the scan covers apps/web only, so the Studio lines were read by hand above).
