---
category: Record
---

# CarpetAreaCheck

Recomputes RERA carpet area from the unit's plan polygon and compares it with the declared figure.

- Shows the arithmetic: floor area inside external walls, minus service shafts, minus exclusive balcony or terrace, equals carpet area (internal partitions stay included, per RERA s.2(k)).
- A difference above the set tolerance becomes a *Needs review* finding; below it, a *Within tolerance* note.
- The consumer provides the computed parts, the declared value with its source, and the tolerance.

## Usage

```jsx
<CarpetAreaCheck unit="Flat 704" grossInternal={74.38}
  deductions={[{ label: 'Less service shaft', area: 0.88 }, { label: 'Less exclusive balcony', area: 4.2 }]}
  declared={72} declaredEvidence={{ source: 'Sale deed', locator: 'cl.2', href: '#' }} tolerancePct={2} />
```
