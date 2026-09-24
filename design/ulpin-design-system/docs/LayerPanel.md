---
category: Map and 3D
---

# LayerPanel

The Layers view of the left rail: a Colour by control on top, then layer groups with swatches and toggles.

- Colour by offers None, Rights, Readiness, Findings, Utilities; only one at a time, and it swaps the Legend.
- Groups: Context (ground, roads, public land, water), Cadastre (parcels, buildings, spaces), Below ground (basements, utilities, tunnels), Evidence (photos, survey controls).
- Toggles use `role="switch"`. A layer with no data shows "No data" in `ink-muted` and stays toggleable.

## Usage

```jsx
<LayerPanel colourBy="Rights" groups={[
  { label: 'Cadastre', layers: [
    { id: 'parcels', label: 'Parcels', outline: true, color: 'var(--map-parcel-line)' },
    { id: 'buildings', label: 'Buildings', color: 'var(--map-building)' },
    { id: 'spaces', label: 'Spaces', color: 'var(--rights-exclusive)' },
  ] },
  { label: 'Below ground', layers: [
    { id: 'utilities', label: 'Utilities', color: 'var(--utility-water)', visible: false },
    { id: 'tunnels', label: 'Tunnels', hatch: true, color: 'var(--readiness-unknown)', noData: true, visible: false },
  ] },
]} />
```
