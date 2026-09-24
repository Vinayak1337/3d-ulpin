---
category: Intake
---

# ImportStream

The live list of an import in progress: one row per file with what was detected, what the agent mapped, and what needs a decision, updated as results are saved.

- Rows turn from progress to result as each chunk is saved; the map updates without resetting the camera.
- Only rows that need a person show an action ("Review 1 mapping"); everything else is a quiet status line.
- A file the agent cannot read says which reader is missing; it never fails silently.
- The consumer provides the job events (file, stage, counts, exceptions) from the server stream.

## Usage

```jsx
<ImportStream title="Importing Lake View bundle" meta="186 spaces saved" rows={[
  { file: 'parcels.gpkg', state: 'saved', detail: '214 parcels · CRS EPSG:32643 detected' },
  { file: 'unit_inventory.xlsx', state: 'attention', detail: '11 of 12 columns mapped · carpet_sqft read as ft², converted to m²', action: { label: 'Review 1 mapping' } },
  { file: 'plan_F7.pdf', state: 'running', detail: 'reading rooms and dimensions', progress: 62 },
]} />
```
