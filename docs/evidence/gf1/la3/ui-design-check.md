# LA3 UI design check

Base `staging` (2acba69a). Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging`, exit 0, no
candidates (0 added lines in apps/web). Manual read of the changed Studio files:

## Blocking
None.

## Design system
- `WindowedArea.tsx` WindowKey: the proposed swatch is `color-mix(in srgb, var(--ui-map-building-edge) 18%, transparent)`,
  the scene's own ghost fill (building-edge at 0.18); it is a token mix, not a literal colour. The design system draws
  an AI candidate as a dashed outline (`map-and-3d.md`, State table); the scene's existing candidate look is a ghost
  fill, so the key shows what the scene draws. Smallest fix if the owner wants the dashed outline: a scene change,
  not made here.
- The key nests `Legend` (class `ul-float`) inside the existing `mapTools` disclosure, so it carries two surfaces.
  Left as is; both are existing components.

## Checked, no issue
- Tokens only; no new colour, font, radius or shadow; no new CSS.
- Not colour alone: a proposal is a ghost fill (see-through) against the solid facade of a record, and the status
  line and inspector say it in words.
- Keyboard: the key is a native `details`/`summary`, focusable with the existing 2 px focus ring; open by default.
  Text sizes are rem/px from existing classes and wrap at 200% zoom as `mapTools` does.
- Values come from the window reply (`displayState`, counts); no hard-coded numbers. Sentence case; the proposal
  line says "A reviewed proposal, not yet confirmed by an officer."; the identifier and "Open register" stay.
- Desktop, light only; no theme code.
