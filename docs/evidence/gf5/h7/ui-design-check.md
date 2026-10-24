# UI design check: H7 (the walk's findings the Studio closes by itself)

Base `63c986d5` (staging when the branch was cut). Twelve screens read on the live demo at 1440 x 900 and at
200% zoom (640 x 360 CSS px, scale 2), before on staging code and after on this branch: `before.json`,
`after.json`, `before/*.png`, `after/*.png`. The capture refused no request in either run.

## Blocking

None found.

## Design system

- The register header is 16 px taller at 1440 (91 to 107 px) and 34 px taller at 200% (226 to 260 px): the
  reason under `Deviation check` takes two lines. It is there from the first paint while the button is
  disabled, so nothing moves on hover or focus. The reason is 216 px wide and the button about 175 px, so
  at 200%, where the group starts a wrapped row, the text begins left of the button's edge
  (`after/register-header-200pct.png`). Cosmetic; `RegisterPage.module.css` `.needs`.
- The Columns table of an import without a teacher says the state twice per row, as `No answer · teacher
  unavailable` under From and as the full sentence under Question, each with a `Needs review` badge
  (`after/table-columns-1440.png`). Both are true and the lead asked for the sentence; the two badges per
  row are heavier than one would be.
- The case page of a case with several tables is a 960 px column on a 1440 px window, as the other
  statement pages are (`.loading` of the register page); the right third stays empty.

## Checked, no issue

- New CSS is three rules: `.casePage` and `.casePage > section` (spacing tokens `--ui-space-4`, `--ui-space-6`
  only) and `.needs` (a max width and `text-align: end`). No new colour, radius, shadow or font size.
- Components reused: `EmptyState`, `Panel`, `DataTable`, `Skeleton`, `Tabs`, `Badge`, `Button`, `Icon`, the
  `ul-btn`, `ul-help`, `ul-caption`, `ul-title` classes and the register page's `.primary` and `.blocked`.
- Contrast: no new colour pair. The reason under `Deviation check` is the same muted 12 px text as the
  Property Card's blocked reason beside it.
- 200% zoom: no screen scrolls sideways before or after. One element is wider than the viewport in both
  runs, the Columns table row, which sits in its own scroll region (`table-columns`, `insideWidth` false in
  `before.json` and `after.json`); unchanged by this task.
- Console: the duplicate React key on the History tab is gone (`before.json` holds it at both sizes,
  `after.json` does not). The one remaining console line on the register screens is the 404 of a read the
  demo does not serve, the same line as before.
- Words come from reads or are fixed sentences about a named state: the candidate sentence from the
  canonical read's `recordState`, the table list from the case read's `sources`, the count of sources from
  the same read, `r5` from the ledger, the datum caption from the ledger's site benchmark, the record names
  in History from the ledger's building and spaces. Failed reads print the error code, never the message.
- No sample value is hard-coded. The fixed `SD-1` caption of the level register is replaced by the ledger's
  stated datum. Test fixtures are shape-only placeholders or the retained F2b responses.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 63c986d5`: 0 added lines in `apps/web`,
  no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs 63c986d5`: 543 added lines in `apps/studio`, no
  candidates.

## Not checked

- Tab order and focus rings of the new links (the table links and `Add files` on the case page) were not
  measured with the keyboard; they are plain links and the design system's button classes.
- The Review stage with a level chosen (`?level=` of Tower 3's floor) was read as text in the browser, not
  captured: "No review of 2ND FLOOR PLAN is held | The server holds no review of this level, so what waits
  for review on it is not known here." The demo answers 404 for that read. The branch for a level review
  that fails with another code was not seen on screen.
- A case read that fails and a case with exactly zero tables but several sources of other kinds were read
  on two real cases (`case-no-source`, `case-no-table`); the failed read has a unit test and no screenshot.
- No screen reader was run.
