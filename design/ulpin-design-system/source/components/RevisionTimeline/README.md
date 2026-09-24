# RevisionTimeline

The history of one record as a hash-chained list: each revision shows what changed, from which evidence, by whom and when, with its hash and the previous one.

- A **Chain consistent** badge sits at the top when every hash link matches; a break shows a `danger` badge at the first bad link. Say **Chain signed and verified** only when a signed head verifies; unsigned is neutral, not a failure.
- Newest first. Each entry links to a side-by-side compare with the previous revision.
- The consumer provides revisions with actor, time, summary, source links and hashes.
