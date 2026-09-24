---
category: Actions
---

# SegmentedControl

A pill of 2 to 4 mutually exclusive view options, used for 2D/3D, Model/Volumes and Plan/Oblique/Section.

- Switching a segment changes the view only; it never changes data, selection or camera target.
- The selected segment is a `primary` fill with `on-primary` text. Use `aria-pressed` on each button.
- The consumer provides the options and the selected value.

## Usage

```jsx
<SegmentedControl aria-label="View" options={[{ value: '3D', label: '3D', icon: 'cube' }, { value: '2D', label: '2D', icon: 'map-trifold' }]} />
<SegmentedControl aria-label="Render" defaultValue="Volumes" options={[{ value: 'Model', label: 'Model' }, { value: 'Volumes', label: 'Volumes' }]} />
```
