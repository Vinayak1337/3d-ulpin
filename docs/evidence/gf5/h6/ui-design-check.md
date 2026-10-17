# UI design check: H6 part 2 (register page and building workspace)

Base `4c917667` (staging). Screens read on the live demo at 1440 x 900 and at 200% zoom (640 x 360 CSS px,
scale 2): `after.json`, `after/*.png`. The Part 1 screenshots in `shots/` are the state before the fixes.

## Blocking

None found.

## Design system

- At 200% zoom the header line of Tower 3 wraps before the badge, so the separator dot ends the first line
  ("1 floor recorded ·"). Cosmetic; `RegisterPage.tsx` header, the `· ` before the badge.
- The workspace count grid keeps three columns (`Workspace.module.css` `.counts`), so a fourth count
  ("space, use not stated") starts a second row. It reads in order; no rule was changed.

## Checked, no issue

- No new CSS, colour, spacing or radius: the four fixes use `EmptyState`, `Badge` (tone `warning`, no icon),
  `Panel` and the existing `ul-help`, `ul-btn` and `ul-panel` classes.
- Contrast: no new colour pair. The badge and the help text are the design system's own tokens.
- Keyboard: on Magnolia's register page the new "Open record" link takes the focus on the 12th Tab press from
  the top of the page, right after the Units tab, at both sizes (`after.json` `tabsToOpenRecord`); it shows
  the Studio's 2 px focus outline. The badge and the counts are text, not controls.
- 200% zoom: none of the four screens scrolls sideways and each changed element lies inside the viewport's
  width (`after.json` `pageScrollsSideways` false, `insideWidth` true, eight captures).
- Words come from reads: the level labels and their count from the canonical read's level schedule, the storey
  literals from its `conflicts`, the counts from the register read, the revision from the ledger. A building
  without a reviewed schedule, without a storey conflict or with checks keeps its screen unchanged.
- No sample value is hard-coded; the test fixtures are the retained F3a response and labels in the read's shape.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs 4c917667`: 0 added lines in `apps/web`,
  no candidates.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs 4c917667`: added lines in `apps/studio` scanned,
  no candidates.

## Not checked

- Contrast was not measured with a tool; it rests on the unchanged tokens.
- A screen reader was not run.
- The fixed screens were read on Tower 3 and Magnolia only: no demo building has checks, a second storey
  conflict or a space with a stated use, so those branches rest on the unit tests.
