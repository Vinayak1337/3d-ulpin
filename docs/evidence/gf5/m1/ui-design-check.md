# UI design check — M1 (area map without recorded geometry, page error)

Base `staging`. Scope: `apps/studio/src/features/map/**`, `apps/studio/src/app/{router.tsx,PageError.tsx}`.

## Blocking
None. No value is invented: every name, state and count is read from the area record; no position, centroid,
marker or box is drawn for a building without a footprint.

## Design system
None found.

## Checked, no issue
- Tokens only (`--ui-*`); radii 8 and 4 from the shape lock; the list row has a fill only (no border and shadow).
- Status: `Reviewed` from the fixed word list, `Candidate` through the same `RecordState` the inspector uses
  (moved to `features/map/RecordState.tsx`, not changed). No "verified".
- Copy is sentence case: "Buildings without recorded geometry", "No footprint recorded · not drawn on the map",
  "No geometry is recorded for this area yet", "This page could not be shown".
- One primary action per view: the list row has a link ("Open register of <name>", visible text included in the
  accessible name); the error page has one Retry button.
- A fact is stated once: the building count note under the canvas was replaced by the list; the hint
  "listed under Tools" shows only while the list is closed.
- Keyboard: links and Retry are native controls; the link has the 2 px focus ring (`--ui-focus-ring`).
- 200 % zoom (640x400 CSS px, scale 2): nothing overflows; the Tools panel scrolls inside, the canvas names the list
  (`after/haryana-200pct.png`, `after/haryana-200pct-list.png`).
- Scale bar and north arrow are hidden when there is nothing georeferenced to scale.

Commands: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs staging` exit 0 (no `apps/web` change);
`node docs/evidence/gf-ai/ui/f2c/scan-studio.mjs staging` exit 0, no candidates.
