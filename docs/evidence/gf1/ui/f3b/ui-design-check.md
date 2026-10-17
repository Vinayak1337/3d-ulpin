# F3b UI design check

Scope: `apps/studio` changes on `task/f3b-table-live-and-citations` against `staging`, read against
`docs/design-system/README.md` and the screenshots in this folder. Report only; the findings below were not
edited for the report.

## Blocking

None found. Every number and word on the new screens is read from a response or from the citation it opens;
intercepted states carry the label "Intercepted … · no live writes" on the screenshot, live ones carry none.
Nothing is drawn on a page the server did not return, and no region is drawn without its unit saying where.
No write was made: 0 non-GET requests were attempted against the demo API, and 0 left the browser.

## Design system

- **Non-blocking, `apps/studio/src/features/intake/table/StaleNotice.tsx:15`:** the notice lost its
  **Needs review** badge to show one warning icon, as asked. The status word still appears once on the page,
  in the source header (`SourceHeader.tsx:21`), which is unchanged.
- **Non-blocking, `apps/studio/src/features/evidence/CitedPageViewer.tsx:62`:** the unavailable state reuses
  `EmptyState`, whose icon is a plain file-x mark, not a warning. The runtime being absent is not an error in
  the record, so no status word is used; the server's own sentence and code are shown under the title.
- **Non-blocking, `apps/studio/src/features/evidence/EvidenceViewer.module.css:25` (`.region`):** the outline
  has a stroke and a 14 % primary tint, the same pairing as the existing plan outline in this file; no shadow.
- **Inherited, waits for A3e, `ColumnsTable.tsx:26-31` and `LearnerPanel.tsx:14-44`:** on the live 90-column table
  the 90 unanswered columns read **0 %** confidence and **memory** or, in the learner table, **teacher fields**,
  because the server says so (`01`, `03`). 0 % is a number for a value the learner never produced. Not
  compensated in the UI; the exact components are named in the report's NEXT.
- **Inherited, not changed:** at 200 % zoom the Frame header's search and **Add files** controls overflow
  the 720 px viewport and the page scrolls sideways (`06`). That is `apps/studio/src/app/Frame.*`, owned by
  another worker. Inside the table page nothing is clipped; the answers table scrolls inside its own region
  and the reason column starts off-screen there (merely awkward, reachable by keyboard).
- **Inherited, not changed:** the sources of citation chips are still named by 8 characters of the id; the
  canonical citation carries no file name and the building page loads no source list, so the chip is left as it
  was. The viewer shows the full id with a **Copy source ID** control.

## Checked, no issue

- `Table.module.css`: `--ui-*` tokens only; the focus ring on the notice is 2 px `--ui-focus`; sticky headers
  have an opaque `--ui-surface-subtle` background from `.ul-table th` and a 1 px divider shadow.
- `StaleNotice.tsx`, `RecipeReview.tsx`, `AnswerForm.tsx`: one notice, one icon; Record is disabled, the
  shared-reason control and Approve are absent, the replay is hidden; an open confirmation closes and focus is
  on the notice (`08`, `09`, `10`; `browser-result.json`).
- `CitedPageViewer.tsx`: the page and region are written in words with the record's own numbers; the source id
  is in mono with a labelled copy button; one primary action per state (**Open the file view** or **Try
  again**, plus **Close**). Unknown stays distinct: a `pixel` region, a region outside the returned frame and a
  page without a raster each say why nothing is drawn (`pageGeometry.ts`, tested).
- `EvidenceViewer.tsx` file view: a PDF is no longer printed as bytes; the page says it is not a text file and
  **Open original** serves the unchanged bytes (`12`).
- Keyboard: focus order on the 90-column page is header → source → column table region → learner region →
  **Answer mapping questions**; both regions are labelled, focusable scrollers. Dialog focus is trapped by the
  shared `Dialog`; Escape closes the viewer.
- Screenshots opened: `01`–`07`, `09`–`12`.

Mechanical scans:

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` — exit **0**, no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` — exit **0**, 509 added lines, no candidates.
