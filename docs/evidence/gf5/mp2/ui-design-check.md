# UI design check: MP2 (the area map's imagery layer and the floors card)

Base `ea040eac` (staging at the branch point). Screens read on the live demo through a local Studio at
1440 x 900 and at 200% zoom (720 x 450 CSS px, scale 2): `captured-after.json`, `shots/after-*.png`;
the same two screens on the starting code: `captured-before.json`, `shots/before-*.png`.

## Blocking

- **A footprint of unknown height is hidden under the picture.** The scene drapes every image overlay at
  y = 0.2 m with a polygon offset (`packages/scene/src/engine.ts:299`, `:307`) and draws a footprint whose height
  is unknown as a 0.05 m slab from y = 0 (`geometry.ts:7`, `:45`). Measured in the running scene on the Karnataka
  area: 22 pictures at 0.20 m, the one drawn footprint between 0 and 0.05 m. With the layer on, the reviewed roof
  projection of that area is not visible (`after-karnataka-on-1440.png` against `after-karnataka-off-1440.png`);
  it still answers a click. `packages/scene` is read-only for this task, and lifting the footprint from the Studio
  would mean passing a base height no record states, so nothing was changed. Smallest fix, in the scene: draw
  image overlays below flat footprints (for example without depth write and before the buildings).

## Design system

- At 200% zoom with the tools open, the tools panel now gives way to the note and scrolls (its scrollbar is
  hidden by an existing rule), so the Imagery switch is below the fold of the panel. Keyboard focus still
  reaches it and scrolls it into view (`tabsToSwitch` 15 at both sizes). Before this change the panel covered the
  note instead.
- The attribution is one long line of sources (the read's `upstreamConditions`, verbatim) and states: four
  lines at 1440 wide, five at 200%. It is read from the answer and was not shortened.
- Magnolia at 200%: the building inspector covers the right half of the floors card, as it covered the old
  card (`before-magnolia-200pct.png`). The card's placement was not changed; only its words were.
- The failure count is the switch's `hint` (muted text beside the label). The switch's accessible name is
  "Imagery" alone, because `Toggle` in `packages/ui` names the button by its label; the count is read as text.

## Checked, no issue

- No new colour, font, radius or shadow: the one new rule (`.leftStack`) is layout only; `.mapTools` and
  `.viewNote` keep their tokens. Both scans below found no candidate.
- Contrast of the note on the picture: `--ui-ink-soft` on the note's 90% surface backing is 8.05:1 over a black
  picture and 10.05:1 over a white one (computed in the page, `captured-after.json` `contrast`); the rule is 4.5:1.
- Keyboard: from the top of the page, 15 Tab presses reach the Imagery switch (Enter opens Tools on the way) and
  Space turns the layer off, at both sizes. The switch is the shared `Toggle` with its 2 px focus outline.
- 200% zoom: no screen scrolls sideways; the note lies inside the map's width and clear of the scale readout
  in all six imagery captures (`pageScrollsSideways` false, `noteInsideWidth` true, `noteClearOfReadout` true).
- Every word about the imagery is read from the canonical read: sources (`upstreamConditions`), licence,
  `classification` and `analyticalEligibility` (fixed words for the one value each may hold). "Capture date
  unknown" is the fixed wording for a read that has no capture field; `acquiredAt` (when the file was retained)
  is never shown as a capture date. The layer is labelled "Imagery", not "Aerial" or "Official".
- An area whose read lists no image keeps its Layers panel as it was: no Imagery switch, no note line.
- The floors card states counts and labels from the register and canonical reads; "No floors recorded. Add a
  plan." and its button remain only when both reads say there is no file, reviewed level or room candidate.
- Light theme only; no theme, mobile or dark variant added.

## Scans

- `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging`: 0 added lines in `apps/web`, no
  candidates, exit 0.
- `node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs ea040eac`: 416 added lines in `apps/studio` scanned, no
  candidates, exit 0.

## Not checked

- A screen reader was not run. Reduced motion: no animation was added.
- An area with both a supplemental aerial GeoTIFF and listed pictures (none exists on the demo): one switch
  would then govern both; not seen on a screen.
