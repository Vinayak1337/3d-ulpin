# H1 UI design check

Scope: `apps/studio/src/app/Frame.tsx` and `Frame.module.css`, against the merge base with `staging` (`069f771f`).
Reviewed both files in full and the 16 captures in `before/` and `after/` (1280, 640 and 320 CSS px).

## Blocking

None. No invented data, no new on-screen text, no provenance label, no theme or dark-mode rule.

## Design system

- `Frame.module.css:54` (new): the header is taller than the 56 px top bar of
  [surfaces and layout](../../../design-system/surfaces-and-layout.md#officer-studio-finale_v1) at 1140 CSS px and
  below (105 px in two rows, 167 px in three at 640 px). This is the fix itself: one row needs about 1100 px, and
  the brief accepts wrapping. It keeps one navigation row. The 1140 px breakpoint is derived from the slot widths;
  it is not one of the documented breakpoints (1440, 900, 620), which do not describe how the top bar reflows.
  Smallest follow-up: one sentence in that document (protected, not edited here).
- `Frame.module.css:22-23` (existing, unchanged): the search shows focus as a 1 px border colour change with the
  input outline removed, at every width. [Accessibility](../../../design-system/README.md#accessibility) asks
  for a visible 2 px focus. Smallest fix: `.search:focus-within { outline: 2px solid var(--ui-focus);
  outline-offset: 3px; }`. Not applied: it changes the unzoomed header while focused, outside this task.
- `Frame.module.css:28,35` (existing, unchanged above 1140 px): the area name is cut with an ellipsis in its
  240 px slot; the full name is in the list and in the button's accessible name. Below 1140 px it now wraps.
- At 320 px (400% zoom) the search hint ends in an ellipsis and the page area is 100 px high under a 259 px
  header; the document scrolls and every control is reached by Tab. Accepted by the brief as stacking.

## Checked, no issue

- `Frame.module.css:26,54-67`: spacing and sizes use `--ui-space-*` and `--ui-touch-height`; no colour, font,
  radius or shadow is added. The two flex bases (310 px, 200 px) are wrap thresholds that shrink, not widths.
- `Frame.tsx:27-33`: one wrapper around the existing three actions; source order, labels and components are
  unchanged, so keyboard order equals reading order in every layout. Nothing is hidden or moved into a menu.
- Values on screen (area name, revision, request count) are still read from the API responses.
- Keyboard at 640 px: Tab reaches the same eight stops as at 1280 px (seven while the API is down, because the
  area button is disabled without areas, as before). All have the 2 px outline except the search (above). The
  area list opens with Enter, stays inside the window (also at 320 px), and Escape closes it with focus kept.
- At 1280 px the header screenshot is byte-identical before and after on all three routes; nothing moved.
- Light only, desktop-first; reduced motion untouched (no animation added).

## Mechanical scan

`node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs` — exit 0; the skill scans only `apps/web`
(0 added lines). Re-ran it through the existing adapter with the merge base, because `staging` moved during
the task: `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs 069f771f` — exit 0, 29 added lines, no candidates.
