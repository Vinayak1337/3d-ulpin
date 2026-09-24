---
category: Map and 3D
---

# StrataSection

A schematic vertical section of one parcel: airspace, the building's levels, the ground line, basements, utilities and any corridor below, each labelled with its elevation.

- Use it in the inspector and on the Property Card to answer "what is above and below this space?"
- The selected space is `primary` with `on-primary` label; the air-rights envelope is a `rights-public` dashed outline over `sky-band`; below ground uses `soil-top` and `soil-deep`.
- Test fixtures (for example a metro tunnel that is not in real evidence) carry a "Test fixture" label.
- The consumer provides the stack of volumes with elevations and which one is selected.

## Usage

```jsx
<StrataSection parcel="MH2507A1B3C4D5" selected={2} roof="239.8 roof" ground="212.4 ground"
  airRights="Air-rights envelope to 254.0 m"
  levels={[{}, {}, { label: 'F7 · Flat 704', elevation: '233.8' }, {}, {}, {}, {}, {}]}
  basements={[{ label: 'B1 · parking', elevation: '209.1' }, { label: 'B2 · parking (levels estimated)', elevation: '205.8', estimated: true }]}
  utility="Water main (B)" corridor="Metro corridor · test fixture" corridorRange="194.0 to 198.0" />
```
