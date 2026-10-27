# PF1 UI design check

Base: `e9c12699`. Reviewed the Studio diff manually as well as running the skill's scan.

## Blocking

None.

## Design system

None. No CSS, tokens, icons, copy, controls or layout changed.

## Checked, no issue

- `apps/studio/src/features/map/MapWorkspace.tsx:260` and `WindowedArea.tsx:44`: frame notifications
  move to leaf subscriptions; selection, inspector, layer switches and window reads are unchanged.
  The import count subscribes separately and still reads the engine's rendered count.
- `apps/studio/src/features/map/SceneLabels.tsx:17` and `ScaleAndNorth.tsx:8`: original markup, styles,
  label filtering, scale calculation, units and north-arrow accessible name remain. Source text and
  unknown heights survive the real NYC and Swiss unit inputs.
- `packages/scene/src/engine.ts:442`: all queued surface parts eventually draw, unchanged parts retain
  their objects, hidden/removed parts cancel, and replacement textures/geometries are disposed.
  No new picking, measurement or record claims.
- Rules: [principles/content/accessibility](../../design-system/README.md),
  [map selection and evidence](../../design-system/map-and-3d.md). Keyboard controls, reduced-motion
  handling and zoom CSS are untouched. No browser/200% zoom qualification was performed: this task
  forbids a runtime.

Scan: `node .agents/skills/ui-design-check/scripts/scan-ui-diff.mjs e9c12699` — exit **0**, no candidates.
The scanner covers `apps/web` only (zero added lines there); the Studio findings above are the manual
review, not scanner coverage.
