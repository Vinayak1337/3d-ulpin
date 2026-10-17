# UI design check: F3g (draft card state, inspector at 200% zoom, inset focus ring of the copy control)

Change checked: `task/f3g-draft-card-state-inspector-zoom` against its branch point `44c40f83` (18 files under
`apps/studio` and `packages/ui`, 133 added lines). Screens were read in the code and in the screenshots beside this
file, taken at 1440 x 900 and at 200% zoom (720 x 450 CSS px, device scale 2).

The scan script reads only `apps/web`, so it saw no line of this change. Its six patterns were also run by `grep`
over the 133 added lines: no match.

## Blocking

None.

## Design system

1. **The close control of the map lies over the scrolling region in a short window.** In a window up to 640 px
   high the header scrolls with the rows, and the close button of `features/map/MapWorkspace.tsx:472` stays at the
   top right of the inspector, where the header kept 48 px free for it. Scrolled body text can pass under it
   (`09-zoom-200-space-inspector-scrolled.png`, `11-zoom-200-building-inspector-scrolled.png`: beside the text in
   both, not on it). Rule: nothing covers content, [Accessibility](../../../design-system/README.md#accessibility).
   Smallest fix: in that window, keep the 48 px on the scrolling box instead of on the header
   (`MapWorkspace.module.css:14`), or place the close control in the header row of the shell.
2. **The building inspector's scrolling region is 84 px high at 200% zoom.** Its two actions stack in the 320 px
   panel and take 113 px of the 197 px the inspector gets (`10-zoom-200-building-inspector.png`;
   `browser-result.json`, `zoom.building`). Everything is reached by scrolling and both actions are whole. The
   197 px come from `MapWorkspace.module.css:12` (`max-height: calc(100% - 80px)`), not changed here.
3. **A viewport height in a stylesheet.** `features/map/inspector/Inspector.module.css:58` switches at
   `max-height: 640px`. The number is the height under which the header, the tabs and the actions leave the body
   less than about 150 px; it is a judgement, not a token. Heights between 451 and 640 px were not captured.

## Checked, no issue

- Tokens: no literal colour or font added. The one new rule in `packages/ui/src/styles/components.css:101` only
  moves the existing 2 px focus outline inside the code box.
- Components: `PropertyCard` gains an optional `state` and passes it to `UlpinCode`; without it the card reads as
  before (unit test). The copy control is one Studio component, `features/identity/CopyableId.tsx`, in both places.
- Status words: the draft card labels its code "3D ULPIN (proposed) · Draft" (the fixed word of `UlpinCode`) and
  carries no "Assigned"; the day row reads "Draft made" (`mocked-05-draft-card-dialog.png`,
  `local-layer-07-portal-printed-draft-card.png`, `06-live-draft-verify-draft-made.png`).
- No inline style left on the record identifier (`SpaceInspector.tsx:128`); the wrap is in the stylesheet.
- 1440 x 900: the header and tabs of the inspector stay and the body scrolls, as before
  (`01-live-1440-building-inspector.png`, `02-live-1440-space-inspector.png`; `browser-result.json`, `wide`).
- 200% zoom: Property Card lies whole inside the inspector (measured), the rows are reached by scrolling one
  region, the inspector does not overflow its width (0 px), and Enter on Property Card opens the cards dialog
  (`08-zoom-200-space-inspector.png`, `09-zoom-200-space-inspector-scrolled.png`).
- Focus: the ring of the copy control is 2 px, drawn 2 px inside the code box, whole on all four sides, on the
  verification page and on the recorded unit (`03-live-verification-copy-focus.png`,
  `04-live-recorded-unit-copy-focus.png`); Enter copies the exact string in both.
- Light mode only; no theme code; no mobile variant added.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs` → "0 added line(s) in apps/web. No candidates.",
exit 0.
