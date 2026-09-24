---
category: Map and 3D
---

# LevelRail

A vertical level picker pinned to the right edge of the canvas: roof, floors, ground line, basements in source order, with the vertical reference named once at the top ("m · SD-1"). Heights are never relabelled as mean sea level unless the source says so.

- Click isolates that level; shift-click keeps the levels above as ghosts. Arrow keys move the selection.
- The ground line separates above and below ground and shows the benchmark elevation.
- Levels whose limits are estimated show their elevation with a trailing "est.".
- The consumer provides the level register (label, lower and upper elevation, evidence state) and the selected level.

## Usage

```jsx
<LevelRail reference="m · SD-1" ground="212.4" defaultSelected="F7" levels={[
  { id: 'Roof', elevation: '239.8' }, { id: 'F8', elevation: '236.8', ghost: true }, { id: 'F7', elevation: '233.8' },
  { id: 'F6', elevation: '230.8' }, { id: 'F1', elevation: '215.8' }, { id: 'G', elevation: '212.8', title: 'Ground, stilt parking' },
  { id: 'B1', elevation: '209.1', belowGround: true }, { id: 'B2', elevation: '205.8', estimated: true, belowGround: true },
]} />
```
