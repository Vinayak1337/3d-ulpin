---
category: Layout
---

# Panel

The standard container for every Studio rail, inspector section, check and dialog body: `surface` fill, 1px `border-strong`, `radius-12`, `shadow-card`.

- Head row: title in `studio-heading` (17px/600) with a Badge, caption or icon on the right.
- Body is padded 16px; `flush` content (Tabs, a DataTable) sits edge to edge under the head.
- Footer on `surface-subtle` holds at most one primary action and one secondary.
- Panels float on `bg` 16px apart (`space-4`). Don't stack a border, a shadow and a tinted fill on the same element.

## Usage

```jsx
<Panel title="Floors and units" aside={<Badge status="Reviewed" />} footer={<><Button variant="primary">Open register</Button><Button>Explore floors</Button></>}>
  <p className="studio-body">55 units across G plus 8 floors, stilt parking at ground, basements B1 and B2.</p>
</Panel>
```
