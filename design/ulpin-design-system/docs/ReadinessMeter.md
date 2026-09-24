---
category: Record
---

# ReadinessMeter

Readiness of one record for a named task (for example "Assign proposed 3D ULPIN"), split into six dimensions: evidence, geometry, association, consistency, review, freshness.

- Always name the task in the title; readiness for one task says nothing about another.
- Unknown dimensions show the hatched bar and the word *Unknown*; they block an all-clear.
- No single overall score. The summary says how many dimensions are ready and what blocks the rest.
- The consumer provides the task and each dimension's value or Unknown.

## Usage

```jsx
<ReadinessMeter task="Assign proposed 3D ULPIN" dimensions={[
  { name: 'Evidence', value: 1 }, { name: 'Geometry', value: 1 }, { name: 'Association', value: 1 },
  { name: 'Consistency', value: 0.6, label: '1 finding' }, { name: 'Review', value: 1 }, { name: 'Freshness', value: 'unknown' },
]} />
```
