# UI design check: H8 (four more findings of the walk)

Base `39ed2dbb` (staging when the branch was cut). Four screens read on the live demo at 1440 x 900 and at
200% zoom (640 x 360 CSS px, scale 2), before on staging code and after on this branch: `before.json`,
`after.json`, `before/*.png`, `after/*.png`. The capture refused no request in either run and clicks nothing.

## Blocking

None found.

## Design system

- Register > Buildings at 200%: the building's name is squeezed to a column about 85 px wide and wraps to
  three lines, before and after (`before/register-buildings-200pct.png`, `after/register-buildings-200pct.png`).
  The identifier, requests and actions columns have fixed widths (300, 120 and 150 px) that leave the name
  what remains of a 640 px window. Not made worse by this task and not fixed by it.
- Batches on a server that serves the work board: the rows are drawn with three columns until the board
  read answers, then with five. The demo does not serve the board, so the change of grid was not seen.
- Register > Buildings keeps "Open requests: Unknown" on every row while the requests read is not served:
  a column of one repeated word, the same kind of finding as C8. Not in this task.

## Checked, no issue

- New CSS is one rule: `.table[data-columns="3"] .row` in `BatchesPage.module.css`, the grid of the queue's
  three columns built from the two flexible tracks and the 72 px time track the five-column grid already
  uses. No new colour, radius, shadow, spacing or font size.
- Components reused: `Panel`, `Skeleton`, `StatusBadge`, `DataTable`, and the `ul-help`, `ul-mono` and
  `ul-unknown` classes. The identifier is no longer muted: it is the one identity column of the table now.
- Batches: no empty header and no empty cell is left. The table is 168 px shorter at 1440 (833 to 665 px) and
  1538 px shorter at 200% (2523 to 985 px), because the batch name no longer shares the row with two empty
  tracks (`after/batches-1440.png`, `after/batches-200pct.png`).
- Residents: the panel is the same height before and after (121 px at both sizes). The "Not assessed" badge is
  drawn only when the server serves the read and holds no extract; "not served" and "failed" carry no badge,
  because nothing was assessed or stated in either case.
- 200% zoom: no screen scrolls sideways and every read element lies inside the window's width, before and
  after (`pageScrollsSideways` false, `insideWidth` true in both files).
- Console: one line on three of the four screens, before and after: the 404 of a read the demo does not
  serve (the work board, the residents, the requests). The workspace screen has none.
- Words come from reads or are fixed sentences about a named state: the column set from whether the
  work-board read answered; the Residents sentence from the read's answer and whether this build has the
  route live; the identifier from the feature's `identifier`. A failed read prints the server's code, never
  its message. No sample value is hard-coded; the test fixtures are shape-only placeholders.
- No column of Register > Buildings is named a ULPIN. The header "Parcel ULPIN" of a building's register
  page is unchanged: it reads the register's `parcelIdentifiers`.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 39ed2dbb`: 0 added lines in `apps/web`,
  no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs 39ed2dbb`: 244 added lines in `apps/studio`, no
  candidates.

## Not checked

- Seen on screen: Batches without a work board, Residents with a read that is not served, Register >
  Buildings with no project code. Tested as pure parts only, never seen: Batches with a work board (five
  columns), Residents with a served read that holds none, Residents with a failed read, the Residents
  skeleton while pending, and a "Project code" column.
- "Record reviewed details" was not clicked. Its title is not drawn anywhere until the action is recorded,
  so item 3 has no visible change; `workspace-check-*.png` show the button only.
- Tab order and focus rings were not measured with the keyboard. No control was added or removed.
