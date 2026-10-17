# UI design check — H4 (a building without geometry says so; the reading statement beside citations)

Base `6fa49a28` (the `staging` commit this branch was cut from). Scope: `apps/studio/src/features/register/`
`{NoGeometry.tsx,ReadingNote.tsx,ReadingNote.module.css,SourceReadingNote.tsx,registerState.ts,`
`useReadingStatements.ts,RegisterPage.tsx,RegisterPage.module.css}`, `features/map/sceneGeometry.ts`,
`features/map/inspector/{InspectorShell,BuildingInspector,SpaceInspector,FindingsInspector}.tsx` and
`Inspector.module.css`, `features/review/WorkspacePage.tsx`, `features/review/candidates/CandidateCardView.tsx`,
`features/evidence/EvidenceViewer.tsx`. Measurements are in `before.json` and `after.json` (written by
`capture.mjs`, GET only); screenshots in `before/` and `after/`. One screenshot is mocked and named so:
`documents-tab-tower3-refused-mocked.png` (the consolidated read answered 409 in the browser).

## Blocking
None. The pane's title is the only sentence this change writes; the lines under it are the canonical read's own
`gaps`, unchanged and in its order, kept when they mention geometry, footprint or placement. Whether the title
shows is computed from the scene inputs, never from a name or an id. The statement beside a citation is the H3
mapping of the server's `documentResult.reasons`; a source the server says nothing about gets nothing. A failed
read prints one fixed sentence and the server's code, never its message.

## Design system
1. `features/register/RegisterPage.tsx:203,216` — for a building without geometry the level rail is no longer
   drawn (the task asks for the canvas, its controls and legend to go). On the register page that rail was the
   only on-screen control that filters the Units tab by floor. For Tower 3 that filter is what lists `UNIT-3B`
   (see finding 2), so after this change the unit is reachable on that page only by a link carrying `?level=`.
   Smallest fix if the filter should stay: render the existing `LevelRail` block above `NoGeometry` (move the two
   lines out of the fragment). Not done: the task says to remove it.
2. `features/register/RegisterPage.tsx:130-133,303-306` (on staging too; report only, not edited) — the header
   says "1 floor" while the Units tab counts 0 and prints "No floors recorded for this building". Two statements
   on one screen disagree. Cause and smallest change are in `result.json` `unitsTab`.
3. `features/review/WorkspacePage.tsx:296` — at 200% zoom (640 px wide) the check stage keeps its two columns,
   so the scene pane is 192 px wide (on staging too). The statement there is 515 px tall in a 358 px pane and
   scrolls inside the pane (`after/workspace-*-200pct-scene.png`): a scroller inside the page's scroller.
   Nothing is cut off and nothing scrolls sideways. Smallest fix: stack the stage's columns under about 900 px;
   that is the stage's layout, outside "the scene pane only". (Pane and statement sizes here and below were
   measured once with a throwaway probe; they are not in `after.json`.)
4. `features/evidence/CitedPageViewer.tsx:43-49` (not in this task's paths, not edited) — the viewer has a third
   dialog, opened by a citation that carries a page and a pin (the recorded panel's citations). It names the
   source and shows no statement. No live building reaches it with a stated source today (Tower 3's pinned
   citations cite `5293cd72`, which the server states nothing about). Smallest fix: one line,
   `<SourceReadingNote sourceId={evidence.sourceId} />` inside that `dd`.
5. `features/evidence/EvidenceViewer.tsx:68,158` — the statement sits in the dialog's header row, held to 280 px
   so the title keeps its room. With a long file name the title now wraps to two lines where it had one
   (`before|after/evidence-viewer-magnolia.png`); Tower 3's stays on one line.
6. `features/map/inspector/Inspector.module.css:10` (found by this check, on staging too) — the inspector body
   was one column sized by its widest child, so one long citation chip pushed the whole tab wider than the
   inspector: the chip, the gap lines and the new statement were cut at the right edge
   (`before/inspector-evidence-tower3.png`). **Edited without waiting for approval**, because the new statement
   was cut the same way: `grid-template-columns: minmax(0, 1fr)` on `.body`, in its own commit so it can be
   dropped. After: the chip is cut short with an ellipsis (its `title` and the viewer carry the full text), the
   text wraps, and on all five tabs of Tower 3's inspector the body is as wide as it scrolls (352 of 352 px,
   same probe).
7. `features/register/RegisterPage.tsx` Documents tab — the server's code after the failed-read sentence is in the
   caption's face, not mono, and is not copyable. Same treatment as the literal codes of H2 and H3. Unchanged.
8. `features/review/candidates/CandidateCardView.tsx` Citations — the card's citation carries only the first
   eight characters of its source id (`candidates/model.ts:115`, not in this task's paths), so the statement is
   joined by that prefix and shown only when exactly one stated source of the page's building begins with it.
   Smallest fix: let `CandidateCitation` carry the full `sourceId`.

## Checked, no issue
- Tokens only: the pane is `--ui-surface` with a 1 px `--ui-divider` border and the pane's own radius
  (`border-radius: inherit`); no shadow, no tinted fill, no colour or font literal. The gap lines reuse the
  page's existing `.gaps` list style; the title is the shared `EmptyState` with a Phosphor icon. Literals added:
  `gap: 4px` (the gap H3 used between a chip and its note) and `max-width: 280px` for the note in a dialog header.
- Nothing is drawn where there is nothing to draw: `canvases` is 1 before and 0 after on the register page and
  the building workspace of both buildings, at 1440 px and at 200% (`before.json`, `after.json` `scenes`). No
  WebGL context is created for them. A building with a footprint or a space outline is untouched: the statement
  is decided by `hasGeometry` (tests in `features/map/sceneGeometry.test.ts`).
- While the area's reads are pending or have failed the pane is as before (canvas or skeleton); the statement
  appears only once they have answered.
- Copy: sentence case, no status word, no badge, no warning tone, no reason beyond the server's lines.
  "1 floors" reads "1 floor" (header, inspector Overview, workspace summary share `levelSummary`).
- The statement beside a citation is the `ul-caption` line of H3, under its chip, in: the inspector's Evidence
  tab (`after/inspector-evidence-*.png`), the candidate card (`after/candidate-card-magnolia.png`) and the
  viewer's header (`after/evidence-viewer-*.png`). A citation whose source is not stated renders exactly as
  before (`Cited` returns it unwrapped; test in `ReadingNote.test.tsx`).
- The failed read is stated once, as a caption under the Sources heading, and no source line carries anything
  (`after/documents-tab-tower3-refused-mocked.png`, mocked). The live tab is unchanged from H3.
- No new control and no new tab stop: every addition is plain text. Focus order is the chips' order as before.
- 200% zoom: `fitsWidth` true on all eight scene captures before and after. On the register page the pane is
  608 x 420 px and holds the 258 px statement whole (`after/register-*-200pct-scene.png`).
- Light only, desktop first: no theme code, no dark or mobile variant.

Commands: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 6fa49a28` exit 0 (0 added lines in
`apps/web`); `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs 6fa49a28` exit 0, 380 added lines in `apps/studio`,
no candidates. With `staging` as the argument both also exit 0 with no candidates.
