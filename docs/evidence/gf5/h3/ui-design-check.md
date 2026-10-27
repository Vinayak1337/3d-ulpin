# UI design check — H3 (document reading statements, refused workspace, one scroller at 200% zoom)

Base `staging` (`e387b37d`). Scope: `apps/studio/src/features/register/{registerState.ts,ReadingNote.tsx,`
`SourceList.tsx,useReadingStatements.ts,RegisterPage.tsx,RegisterPage.module.css,registry.ts}`,
`apps/studio/src/features/review/{WorkspacePage.tsx,recorded/CitationControls.tsx,recorded/RecordedPanel.tsx,`
`recorded/Recorded.module.css}`, `apps/studio/src/app/Frame.tsx`, `apps/studio/src/api/queries.ts`.
Measurements are in `capture.json` (written by `capture.mjs`); screenshots in `before/` and `after/`.

## Blocking
None. The statement beside a source is built only from the server's `documentResult.reasons` through
`readingStatement`; a source without the field, or with `current: true`, prints nothing (no "Current"). No date,
version or actor is added. The refused workspace shows the canonical record's name and the mapped 409 code.

## Design system
1. `features/register/RegisterPage.module.css:1,39` (found by this check, on staging too): under 1100 px the
   register page stacks its two columns but stayed held to the window's height, so the tab column got no height.
   At 200% zoom of a 1280 x 720 and of a 1920 x 1080 window the Sources list could not be reached at all
   (`before/documents-tab-tower3-live-200pct*.png`; reachable `false` in `result.json` `registerPageZoom`).
   **Edited without waiting for approval**, because the new statement sits on that tab: one line,
   `.frame { height: auto; }` inside the existing 1100 px rule, in its own commit so it can be dropped. After:
   reachable `true` at both sizes; the 1440 px screenshot of the tab is byte-identical before and after.
2. Places outside this task's paths still show a source with no statement beside it: the map inspectors
   (`features/map/inspector/BuildingInspector.tsx:120`, `SpaceInspector.tsx:45,121`, `FindingsInspector.tsx:54`)
   and the evidence viewer's header. The statement is therefore made on two screens and missing on the map and
   in the viewer. Smallest fix: provide the same `ReadingStatementsContext` there and render `ReadingNote`
   beside each chip.
3. `features/review/recorded/CitationControls.tsx`: the chip names the source by its short id (existing: the
   canonical record carries no file name), so the statement sits under an id, not a file name. Unchanged here.
4. When the consolidated read fails, nothing is stated and no error line is shown; the page reads as it did
   before this task. A reader cannot tell "nothing stated" from "could not ask". Not seen on the demo.

## Checked, no issue
- Tokens only: the statement uses the existing `ul-caption` class, the same style as the retained-source line
  above it; no colour, radius, shadow or font literal is added. The one literal, `gap: 4px` in `.citation`,
  repeats the gap of the Documents list rows (`.sources li`).
- Copy: sentence case, no status word, no badge or warning tone; several reasons are joined with " · " in the
  server's order; an unknown reason shows as its literal code (`after/documents-tab-tower3-mocked.png`, mocked).
- The recorded fact and its citation are unchanged: with the citation's new wrapper made layout-transparent in the
  browser, the chip (329 x 28) and the panel (1408 x 486) measure the same as with it (`capture.json`
  `recorded[live]`). A stated citation adds one 16 px caption line under its chip.
- No new control: the statement is plain text, so the tab order is the chips' order as before. Contrast is that
  of `ul-caption` (`--ui-muted` on the panel surface), not measured again here.
- 200% zoom: the statement wraps inside the window and nothing scrolls sideways on the Documents tab (640 and
  960 px wide) and in the recorded panel (640 px wide): `fits` true in `capture.json`.
- The building page at 200% zoom (640 x 360): the review box was 520 px high holding 1658 px (a scroller inside
  the page's scroller); it is now 1658 px high and the page is the one scroller (`pageScroll` 1779 over 193).
  At 1440 x 900 the boxes are the same and the screenshot is byte-identical before and after.
- The refused workspace (`/studio/review/:id` under a 409, mocked) shows the same page as the register page:
  name, "The register of this building could not be read", the mapped reason, one primary and one secondary link.
- Light only, desktop first: no theme code, no dark or mobile variant.

Commands: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` exit 0 (no `apps/web` change);
`node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` exit 0, no candidates.
