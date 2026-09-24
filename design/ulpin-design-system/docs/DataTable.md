---
category: Layout
---

# DataTable

A dense Studio table: 13px cells, 36px rows, `surface-subtle` header row, hairline `divider` rows and a bold totals footer.

- Numbers right-aligned with tabular figures; areas and volumes to 2 decimals. Codes and hashes in mono.
- Units in the column header ("Carpet m²"). A muted "N more" row stands in for truncated rows.

## Usage

```jsx
<DataTable
  columns={[
    { header: 'Level', cell: (r) => r.level },
    { header: 'Unit', cell: (r) => r.unit },
    { header: 'Carpet m²', cell: (r) => r.carpet, numeric: true },
    { header: 'Status', cell: (r) => <Badge status={r.status} /> },
  ]}
  rows={[{ level: 'F7', unit: 'Flat 704', carpet: '69.30', status: 'Needs review' }]}
/>
```
