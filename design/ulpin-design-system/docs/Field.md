---
category: Forms
---

# Field

A labelled input: label above, helper below, error below that. No placeholder-as-label.

- Use for search, measurements, identifiers and form data. Units sit in the label ("Lower limit (m, site datum SD-1)"); heights always name their vertical reference.
- Errors name the problem and the fix: "Lower limit must be below the upper limit (6.00 m)."
- Portal forms use the UX4G Input components themed with these tokens; this card shows the same anatomy.
- The consumer provides label, value, helper text, error text and `aria-invalid`.

## Usage

```jsx
<Field label="3D ULPIN or address" placeholder="e.g. Flat 704, Lake View Residence" help="Search released records by code, parcel ULPIN or address." />
<Field label="Lower limit (m, SD-1)" defaultValue="238.10" error="Lower limit must be below the upper limit (236.80)." />
```
