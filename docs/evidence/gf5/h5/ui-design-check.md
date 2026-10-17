# UI design check — H5 (the register page lists the recorded floors and units; the level rail stays)

Base `a251e934` (the `staging` commit this branch was cut from). Scope: `apps/studio/src/features/register/`
`{unitsTabView.ts,UnitsTab.tsx,RegisterPage.tsx,RegisterPage.module.css,NoGeometry.tsx,registerState.ts}`,
`features/evidence/CitedPageViewer.tsx`, `features/review/candidates/{model.ts,CandidateCardView.tsx}`,
`features/review/Workspace.module.css`. Measurements are in `before.json` and `after.json` (written by
`capture.mjs`: GET and the two card POST reads only, 0 requests refused); screenshots in `before/` and `after/`.
One screenshot per phase is mocked and named so: `mocked-pinned-viewer-tower3-statement.png` (the consolidated
read answered in the browser with the reading result of the building's other source copied onto `5293cd72`).

## Blocking
None. Every word about a floor or a unit on the Units tab is printed by the imported `RecordedPanel` from the
canonical read; this change writes no sentence about one. The badge is a count of what the tab lists. The one
new sentence, "The recorded floors and units could not be read", stands for a failed canonical read and is
followed by the server's code, never its message; while that read is pending or failed the badge shows no
number instead of 0.

## Design system
1. `features/register/RegisterPage.tsx:212-213` (on staging too; not edited) — the header's Property Card button
   needs a selected unit ("Blocked: select a unit with an assigned proposed code"). A unit recorded from a source
   label is now listed by the panel, which has no selection, so on Tower 3 that button stays blocked although
   UNIT-3B has an assigned code and a valid card. Before this change the unit could be selected only as a table
   row reading "After review" and "Draft" (`before/register-tower3-floor-1440.png`), which item 1 rules out.
   The card is opened from the panel's Cards block instead ("Open card PDF", "Verification"). Smallest fix if the
   button must work for such a unit: an `onSelectUnit` prop on `RecordedPanel` (another worker's file).
2. `features/register/RegisterPage.tsx:326-328` (on staging too; not edited) — Magnolia's empty state advises
   "Add a plan or level schedule" although a level schedule is reviewed for it. The state itself is right (no
   registry floor, no unit); the advice is not. Smallest fix: drop the advice when the canonical read has levels.
3. `features/register/NoGeometry.tsx`, `RegisterPage.module.css:18-28` — the rail stands beside the statement at
   the top right of the pane, the place it has over a drawn scene, in normal flow. Beside the rail the statement
   has less room than its 520 px limit, so it starts at that room's left edge (`after/register-tower3-1440.png`);
   in a pane without a rail (the workspace) it is centred as before (`after/workspace-check-tower3-1440.png`).
   At 200% its title takes two lines beside the rail (`after/register-tower3-200pct-rail.png`). Whether the
   statement is then taller than the pane was not measured; the pane scrolls when it is.
4. `features/register/UnitsTab.tsx:32-34` — with a floor selected and only recorded units on it, the filter bar
   ("Spaces on 2ND FLOOR PLAN", "All units") is a panel of its own above the recorded panel, since the recorded
   panel cannot take it without a change to its files. Two panels where the table state has one.
5. `features/evidence/CitedPageViewer.tsx:47` — the statement sits between the source id and "Copy source ID",
   held to 280 px, so it wraps to three lines there (`after/mocked-pinned-viewer-tower3-statement.png`). Same
   component and width as in the file and paged dialogs.
6. `features/review/Workspace.module.css:69-72` — 900 px is a literal: the Studio's styles have no breakpoint
   token (they use 720, 900, 960, 1100, 1140, 1200 and 1280 as literals). The stacked stage needs the frame to
   grow (`.frame:has(> .check)`), otherwise the checks get no height: 0 px with the columns stacked and no such
   rule (a throwaway probe, not in `after.json`), 316 px with it (`after.json` `checkStages`), at 640 px wide.
7. `packages/ui` `LevelRail` (read-only, not edited) — the rail is one tab stop moved by ArrowDown and ArrowUp
   only; Enter and Space do nothing on it, and on a one-level building the second ArrowDown clears the
   selection because the page toggles a level selected twice.
8. `features/review/WorkspacePage.tsx` "Changes since r5" (not edited; item 5 is the stage's layout only) —
   counts "0 units" for Tower 3, the old badge's count.

## Checked, no issue
- One model of a recorded unit: `RecordedPanel` is imported; no row, label or card markup is copied. The table
  never lists a unit the panel lists (they are taken out by id), so nothing about a recorded unit comes from the
  draft columns.
- Badge and panel agree: Tower 3 "Units 1" with one unit in the panel, with no floor and with `2ND FLOOR PLAN`
  selected; Magnolia "Units 0" with the empty state, and its header gives no floor count.
- The rail does not lie over the statement at 1440 or at 200% (`railOverStatement: false` in `after.json`); no
  canvas is mounted for either building.
- No horizontal page scroll at 1440 or at 200% on the register page and the check stage (`fitsWidth: true`).
- Tokens only: the new rules use `--ui-space-4` and existing surfaces; no colour, shadow, radius or font literal.
  Contrast was not measured: the change adds no colour or text style.
- Keyboard, Tower 3 register page, no mouse (`after.json` `keyboard.walk`): Tab reaches Back to map, Export, the
  Levels rail, the Units tab, All units, the floor citation, the unit citation, Copy code, Open card PDF and
  Verification in that order, then leaves the page; ArrowDown on the rail selects the floor; ArrowRight and
  ArrowLeft move between tabs; Enter on the unit citation opens the viewer with the focus inside it and Escape
  returns the focus to that citation. No trap, no unreachable control.
- No page error on the register pages, the check stage, the viewer or the keyboard walk (`pageErrors` in
  `after.json`).

## Scans
- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs a251e934` — exit 0; 0 added lines in `apps/web`;
  no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs a251e934` — exit 0; 283 added lines in `apps/studio`; no
  candidates.
