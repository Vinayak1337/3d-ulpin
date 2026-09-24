---
category: Map and 3D
---

# Legend

The bottom-left map legend for the active Colour by mode, plus the always-on evidence and record-status keys.

- One legend at a time; it names the mode as its title. Unknown always appears as its own hatched entry.
- Evidence (fill) and record status (outline) keys use pattern and line style, never colour, so they hold in every mode and for every reader.
- The consumer provides the mode and the counts per entry.

## Usage

```jsx
<Legend sections={[
  { title: 'Rights', items: [
    { label: 'Exclusive unit · 42', color: 'var(--rights-exclusive)' },
    { label: 'Shared area · 9', color: 'var(--rights-shared)' },
    { label: 'Public or authority · 3', color: 'var(--rights-public)' },
    { label: 'Unknown · 4', color: 'var(--readiness-unknown)', hatch: true },
  ] },
  ...EVIDENCE_AND_RECORD_KEYS,
]} />
```
