---
category: Foundations
---

# Icon

A Phosphor Regular icon from the 3D ULPIN set (30 icons, MIT). Icons inherit `currentColor`: `ink-soft` in toolbars, `ink-muted` in chips, the status colour in badges.

- 20px (`size="md"`) in the Studio, 16px (`size="sm"`) inside dense table cells, chips and small buttons.
- An icon is never the only label for an action; icon-only buttons carry `aria-label` and a tooltip.
- Names: magnifying-glass, stack, cube, map-trifold, buildings, building, warning-octagon, warning, check-circle, info, file-text, file-arrow-up, arrow-counter-clockwise, ruler, scissors, shovel, eye-slash, eye, crosshair, qr-code, shield-check, git-commit, clock-counter-clockwise, list-checks, selection-background, translate, download-simple, caret-down, intersect, tray.

## Usage

```jsx
<Icon name="warning-octagon" />
<Icon name="file-text" size="sm" />
```
