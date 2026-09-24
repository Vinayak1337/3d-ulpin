---
category: Record
---

# ShareLedger

The undivided-share table for one building: each unit's 3D ULPIN, carpet area, share of the parent parcel and the basis the declaration uses (value or area).

- The footer totals the shares and flags anything other than 100% with a `danger` badge and the exact difference.
- Common areas list the units they serve; a common area serving fewer than two units is flagged.
- The consumer provides rows from the Deed of Declaration and computed carpet areas.

## Usage

```jsx
<ShareLedger building="Lake View Residence" basis="value" totalUnits={55} total={99.5} moreUnits={52}
  rows={[{ unit: 'Flat 701', code: '…F07-R001-4', carpet: 71.1, share: 1.88 }, { unit: 'Flat 704', code: 'P3-7Q4M…-R4', carpet: 69.3, share: 1.84 }]}
  evidence={{ source: 'Declaration', locator: 'sch.B', href: '#' }} />
```
