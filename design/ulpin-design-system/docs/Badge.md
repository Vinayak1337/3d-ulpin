---
category: Status
---

# Badge

A status word with its icon: *Recorded*, *Reviewed*, *Needs evidence*, *Needs review*, *Blocking*, *Provisional*, *Draft*, *Unknown*.

- Always icon plus word; colour never carries the meaning alone.
- `success` for reviewed, recorded, assigned, passed. `warning` for needs review, needs evidence, stale. Neutral also for not assessed and test fixture. `danger` only for blocking findings and failures. `info` for informational counts. Neutral for draft and unknown.
- The consumer provides the tone and the fixed status word from the vocabulary in the README.

## Usage

```jsx
<Badge status="Recorded" />
<Badge status="Needs evidence" />
<Badge status="Blocking" />
<Badge tone="info" icon="info">3 sources</Badge>
<Badge icon={null}>Basis: value</Badge>
```
