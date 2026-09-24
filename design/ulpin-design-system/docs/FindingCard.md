---
category: Review
---

# FindingCard

One reproducible finding: severity, the participants, the measured relationship with its arithmetic, the sources involved, and the next actions.

- Title states the result with its number ("U01 / U03: 6.4 m³ overlap"). Severity is a badge with icon, never a coloured stripe.
- Show the calculation in `ul-calc` so an officer can check it by hand.
- Actions: **Open in 3D** (switches to Volumes and frames participants), **Request evidence**, and **Mark resolved** only when new evidence is applied.
- The consumer provides participants, method version, measured values, tolerance, sources and allowed actions.

## Usage

```jsx
<FindingCard severity="blocking" method="Check v1.4 · r1" title="Flat 101 / Flat 201: 6.4 m³ overlap"
  calculation={['Flat 101 top 218.90 m · Flat 201 bottom 218.70 m', 'shared band 0.20 m × 32.0 m² = 6.4 m³']}
  evidence={[{ kind: 'table', source: 'levels-r1.csv', locator: 'row 3', href: '#' }, { state: 'estimated', source: 'Flat 201 lower', locator: 'unverified' }]}
  actions={[{ label: 'Open in 3D', icon: 'cube' }, { label: 'Request evidence' }]} />
```
