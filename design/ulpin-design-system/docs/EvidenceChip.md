---
category: Record
---

# EvidenceChip

A compact link from a value to its exact source: document or dataset name, then page, row, clause or feature, then revision.

- Click opens the evidence viewer with the region highlighted beside the 3D space.
- Dashed outline marks an estimate derived from the source; the amber variant marks a missing source and doubles as a **Request evidence** action.
- The consumer provides the source label, locator, revision and state.

## Usage

```jsx
<EvidenceChip source="Sanctioned plan" locator="p.3 · r2" href="#" />
<EvidenceChip kind="table" source="unit_inventory.xlsx" locator="row 41" href="#" />
<EvidenceChip kind="feature" source="parcels.gpkg" locator="feature 1187" href="#" />
<EvidenceChip state="estimated" source="Estimated" locator="from nDSM height" />
<EvidenceChip state="missing" locator="Needs evidence · request" href="#" />
```
