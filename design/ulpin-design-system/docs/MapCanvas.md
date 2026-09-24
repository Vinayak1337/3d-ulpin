---
category: Map and 3D
---

# MapCanvas

The map canvas frame: `map-ground` fill, `radius-12`, clipped. The map owns the centre of every Studio map screen; rails, toolbar, level rail, legend and inspector float beside or over it.

- Put the scene (an SVG using the `m-*` classes with `<MapPatterns />` in its defs, or a 3D view) as children, and floating chrome in `overlays`, each absolutely positioned: MapToolbar top-left, LevelRail right edge, Legend bottom-left, a `data-num` coordinate readout on the bottom edge.
- Scene classes: `m-ground`, `m-road`, `m-public`, `m-water`, `m-water-line`, `m-parcel`, `m-bldg`, `m-ctx` (context opacity), `m-halo` + `m-sel` (selection), `m-est` (hatched estimate), `m-crit`, `m-sleeve`, `m-label`, `m-code`.
- Only the thing being asked about has colour; everything else is neutral massing at `opacity-context`.

## Usage

```jsx
<MapCanvas height={420} overlays={<>
  <div style={{ position: 'absolute', top: 16, left: 16 }}><MapToolbar /></div>
  <div style={{ position: 'absolute', bottom: 16, left: 16 }}><Legend sections={EVIDENCE_AND_RECORD_KEYS} /></div>
</>}>
  <svg viewBox="0 0 720 420" width="100%" height="100%"><MapPatterns /><rect className="m-ground" width="720" height="420" /></svg>
</MapCanvas>
```
