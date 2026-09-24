---
category: Map and 3D
---

# MapPatterns

SVG `<defs>` for the two map fill patterns: `url(#hatch)` (estimated geometry: 45° `ink-muted` hatch over `map-building`, used by `.m-est`) and `url(#crit)` (a finding solid: `mark-critical` with a `map-halo` hatch). Place once inside any scene `<svg>`.

## Usage

```jsx
<svg viewBox="0 0 200 100"><MapPatterns /><rect x="10" y="10" width="80" height="60" className="m-est" /><rect x="110" y="10" width="80" height="60" fill="url(#crit)" /></svg>
```
