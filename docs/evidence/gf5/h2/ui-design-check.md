# UI design check — H2 (register absent state, review at 200% zoom, header search focus, portal errors)

Base `staging`. Scope: `apps/studio/src/features/register/{RegisterAbsent.tsx,registerState.ts,RegisterPage.*}`,
`apps/studio/src/features/review/candidates/CandidateReview.module.css`,
`apps/studio/src/app/{Frame.tsx,Frame.module.css,router.tsx}`.

## Blocking
None. Nothing on the new page is invented: the name is the canonical record's `name.value`, the reason is mapped
from the 409 response's `error.code`, and both links are built from the record's `buildingId` and `areaId`.

## Design system
1. `features/review/recorded/Recorded.module.css:7` (outside this task's paths): the building page gives the
   review a `minmax(520px, 1fr)` row. Under 960 px the stacked review is taller than that row, so it scrolls
   inside it (measured at 640 x 360: a 520 px box holding 1658 px, inside the page's own scroller). Nothing is
   clipped and the recorded panel does not overlap, but it is a scroller within a scroller. Smallest fix: make
   that row `auto` under the same 960 px width. The area review page (`/studio/areas/:id/candidates`) has one
   scroller.
2. `features/register/RegisterAbsent.tsx:30`: a building whose record states no name shows "Name unknown" in the
   heading, the same words the candidate page uses for it, not the italic *Unknown* of table cells
   ([README, content rules](../../../design-system/README.md)). Not seen on the demo (both buildings are named).

## Checked, no issue
- Tokens only (`--ui-space-*`, `--ui-focus`); no colour, radius, shadow or font literal added. The two layout
  numbers (960 px breakpoint, 264 px = six 44 px queue rows) follow the file's existing pixel layout values.
- Copy is sentence case: "No register is recorded for this building yet", "Open record", "Open area map". No
  status word is added; no "0 units", table, tab or export control is rendered (`result.json`: `tables` 0,
  `exportControl` false).
- One primary action ("Open record") and one secondary ("Open area map"); both are links with 1–3 word labels.
- Focus: the header search box now shows the 2 px `--ui-focus` outline at 3 px offset, as the other header
  controls do (`result.json` `searchFocus`: `none` before, `solid 2px` after; `after/header-search-focus.png`).
- 200% zoom (640 x 360 CSS px at device scale 2): the review columns are 608 px wide each, in document order
  (queue, canvas, inspector); `scrollWidth` equals `clientWidth` (640) on every page; elements that cut their
  content off inside the review went from 3 and 78 to 0. Tabbing from the top of the page moves through the
  queue, then the canvas, then the inspector, then the recorded panel (checked by hand in the same browser).
- A forced render error in a portal page (mocked response, marked `mocked`) keeps the portal header and footer
  and shows the shared page error with its one Retry button (`after/forced-portal-error-mocked.png`).
- Light only, desktop first: no theme code, no new dark or mobile variant.

Commands: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` exit 0 (no `apps/web` change);
`node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` exit 0, no candidates.
