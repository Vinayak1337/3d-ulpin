---
category: Forms
---

# Toggle

A 36×20 on/off switch with `role="switch"`, used for layer visibility and Property Card redaction toggles.

- Always pair with a visible text label in the same row and pass the same text as `aria-label`.
- `primary` fill when on; `surface-subtle` with a `line-control` outline when off.

## Usage

```jsx
<div className="ul-layer"><span className="ul-grow">Party names (public)</span><Toggle aria-label="Party names (public)" /></div>
```
