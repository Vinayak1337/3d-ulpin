---
category: Output
---

# PropertyCard

The one-page card for a space: identity, level and elevations, areas, share, rights and shared spaces, evidence list, revision, chain state and a QR code. In the finale the QR opens a local demonstration link on the same device; public verification is planned.

- Printable A4 and shareable as PDF. Only released fields appear; personal data never does.
- Footer states it is a technical record and not a title document, with the revision, its hash and "Chain consistent".
- Levels name their vertical reference; share shows "not applicable: co-operative society tenure" when that applies.
- The consumer provides the released record, the QR target URL and the revision.

## Usage

```jsx
<PropertyCard title="Flat 704, Lake View Residence" code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4" location="MH2507A1B3C4D5 / S01 / F07 / R003"
  revision="r3" hash="7f3a…c2e1"
  facts={[
    { label: 'Parcel ULPIN', value: 'MH2507A1B3C4D5', mono: true },
    { label: 'Level', value: 'F7 · 233.80 to 236.80 m · site datum SD-1' },
    { label: 'Carpet area', value: '69.30 m² (from plan components) · 72.00 m² declared' },
    { label: 'Undivided share', value: '1.84 % of parcel' },
  ]} />
```
