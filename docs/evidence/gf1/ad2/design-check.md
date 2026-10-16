# AD2 — design check of the batches page

Change: `apps/studio/src/features/batches/BatchesPage.tsx` and `BatchesPage.module.css` against `staging`.

**Not run in a browser.** This session has no running API or database, and the page's one read
(`GET /api/v1/work-queue`) is a `live` route, so a rendered walk would show only the error state. The page's
markup was rendered in a test instead (`BatchesPage.test.tsx`: the columns are Batch, Next action, Updated).

## Blocking

None.

## Design system

None. The change only removes things: the stage filter chips, the Stage and Readiness columns, the count
cards and their CSS. No token, colour, radius, font or copy was added.

## Checked, no issue

- `--ui-*` tokens only: the CSS edits delete rules and drop the empty 300 px side column from `.page`; the
  three-column row grid is the one the page already used without the board.
- Copy: the filtered empty state now says "Clear the search to see every batch." There is no stage filter
  any more, so it names only the search. Sentence case kept.
- No hard-coded sample content: every row value is still read from the work-queue item.
- One primary action per view: unchanged ("Add files" on the empty state only).
- Keyboard and focus: rows stay links with the existing `a.row:focus-visible` ring; the removed chips and
  count cards were the only other focus stops.
- Light, desktop-first: no theme or breakpoint added; the only breakpoint (count cards under 1100 px) went
  with the cards it laid out.

## Mechanical scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` → "Base staging; 0 added line(s) in
apps/web. No candidates.", exit 0. The script scans `apps/web` only, so it does not cover this Studio
change; the rules above were checked by reading the diff.
