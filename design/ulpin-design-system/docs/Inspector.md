---
category: Record
---

# Inspector

The single right-hand panel for the current selection: identity header, tabs **Overview · Rights · Evidence · Checks · History**, and a footer with the next action.

- Header: space name, `UlpinCode`, status badge, and the parcel ULPIN it anchors to.
- Every value that came from a source carries an `EvidenceChip`; unknown values say *Unknown* with a request action.
- The footer holds at most one primary action (the next step in the workflow) and one secondary.
- The consumer provides the selected record, its evidence links and the permitted actions for the role.

## Usage

```jsx
<Inspector title="Flat 704" status="Needs review" code="P3-7Q4M2R8T6V0W3X5Y9ZAB-R4" location="MH2507A1B3C4D5 / S01 / F07 / R003"
  facts={[
    { label: 'Level', value: 'F7 · 233.80 to 236.80 m · SD-1' },
    { label: 'Carpet area', value: <>69.30 m² <EvidenceChip source="Plan F7" locator="p.3" href="#" /></> },
    { label: 'Declared area', value: <>72.00 m² <EvidenceChip source="Sale deed" locator="cl.2" href="#" /></> },
    { label: 'Parking', value: <>Covered stilt <EvidenceChip state="missing" locator="Needs evidence" /></> },
  ]}
  primaryAction={{ label: 'Review area' }} secondaryAction={{ label: 'Open in 3D', icon: 'cube' }} />
```
