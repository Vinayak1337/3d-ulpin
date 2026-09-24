---
category: Review
---

# RevisionTimeline

The history of one record as a hash-chained list: each revision shows what changed, from which evidence, by whom and when, with its hash and the previous one.

- A **Chain consistent** badge sits at the top when every hash link matches; a break shows a `danger` badge at the first bad link. Say **Chain signed and verified** only when a signed head verifies; unsigned is neutral, not a failure.
- Newest first. Each entry links to a side-by-side compare with the previous revision.
- The consumer provides revisions with actor, time, summary, source links and hashes.

## Usage

```jsx
<RevisionTimeline chain="consistent" revisions={[
  { kind: 'recorded', title: 'r3 Recorded', byline: 'R. Iyer · 24 Sep 2026, 14:10', summary: 'Flat 201 lower limit 218.70 → 218.90 m from levels-r2.csv', hash: '7f3a…c2e1', previousHash: '91be…04d7' },
  { kind: 'evidence', title: 'r2 Evidence applied', byline: 'R. Iyer · 24 Sep 2026, 13:52', hash: '91be…04d7', previousHash: '2c80…9a13' },
  { kind: 'draft', title: 'r1 Draft from 5 sources', byline: 'Import agent · 24 Sep 2026, 11:05' },
]} />
```
