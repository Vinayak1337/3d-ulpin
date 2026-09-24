---
category: Layout
---

# Tabs

An underlined tab row for inspector and register sections. Inspector tabs are **Overview · Rights · Evidence · Checks · History**; register tabs are **Shares · Documents · Checks · History**.

- The selected tab is `primary` with a 2px underline. Sentence case labels.
- Parcel, utility, photos and history are tabs, not pages.

## Usage

```jsx
<Tabs tabs={['Overview', 'Rights', 'Evidence', 'Checks', 'History']} defaultValue="Overview" />
```
