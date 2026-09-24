---
category: Layout
---

# DescriptionList

Label/value fact rows: muted label on the left (40%), value on the right. Used for inspector facts, check results and the Property Card.

- Every value that came from a source carries an `EvidenceChip` inline; unknown values say *Unknown* with a request action.
- Units always shown; heights name their vertical reference ("F7 · 233.80 to 236.80 m · SD-1").

## Usage

```jsx
<DescriptionList items={[
  { label: 'Level', value: 'F7 · 233.80 to 236.80 m · SD-1' },
  { label: 'Carpet area', value: <>69.30 m² <EvidenceChip source="Plan F7" locator="p.3" /></> },
  { label: 'Parcel ULPIN', value: 'MH2507A1B3C4D5', mono: true },
]} />
```
