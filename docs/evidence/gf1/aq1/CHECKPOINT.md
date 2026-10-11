# AQ1 checkpoint

Primary steps 1–5 are complete and committed with result.json: authored layout publication, two concurrent live readers and ordered events, proposed revision 2, approval and prepared building targets. Q2 tests hold, so the one-call author change is retained.

Supplementary fresh-unbound memory publication is unqualified: its single initial job becomes stale at the existing destination guard, and actual row/refusal read-back is retained. No unowned fix or retry was made.

Remaining after the first evidence commit: run KN2's five-layer harness unchanged into `docs/evidence/gf1/aq1/five-layers.json`, update result.json and the handoff with the observation, and make a second evidence commit. Do not alter KN2 or areas to make it pass.

```sh
node docs/evidence/gf1/kn2/run-runtime.mjs docs/evidence/gf1/aq1/five-layers.json
```

Current branch remains `task/aq1-answer-moves-the-item`, base recorded in result.json. No running task or owned container remains. No integration operation has been performed.
