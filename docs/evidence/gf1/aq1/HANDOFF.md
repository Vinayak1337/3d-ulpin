TASK   AQ1 — an officer's layout reaches the batch row             GATE GF1
WORKS  An officer's authored map layout reaches the stored row; two live readers of the batch receive its recipe/item notifications, and approval prepares its package.
SEE IT node docs/evidence/gf1/aq1/run-runtime.mjs <new-receipt.json>
INPUTS Unchanged NYC buildings original, including its unaccepted feature; the same original in a fresh unbound case is the difficult destination-memory control. Real Edmonton heritage CSV used in the table exclusion test.
GAPS   Supplementary memory publication meets the existing-destination guard; unit checks pass, but its live origin read-back is unqualified. No browser qualification is claimed.
DESIGN service.ts author adds only the requested transactional queue call after recipe.changed. events.ts changes only the three reader allowances and refusal words, prioritising the batch bound. tests/manual-author.test.ts exercises the real author/queue with the existing manual SQL/object control; tests/ingestion-events.test.ts checks reservation bounds and release. The HTTP walk reuses KN2's API host and the product dispatcher, with no domain SQL scaffolding.
COMMITS 1677bada — fix(ingestion): an authored map layout queues the batch row's draft
        e13b6555 — fix(ingestion): four live pages per batch, with words that say which bound was met
        4483fd34 — chore(ingestion): AQ1 regenerated contract and test follow-up
        8034164b — docs(usp): AQ1 evidence, an officer's layout reaches the row
        The final evidence commit records the unchanged five-layer rerun.
CHECKS Backend typecheck, isolated ingestion/area-binding/packet/manual/event checks, API generate/check, contract refresh/client generation, Python API checker, strict harness typecheck and diff check: exit 0. Counts, commands and qualification: checks.json.
NEXT   The Studio may use result.json to resume its approval walk after integration. Assign the existing-destination memory seam separately if fresh unbound repeated originals must propose into an existing area.

## Primary HTTP walk

`runtime.json` preserves the final walk. Before authoring, the row is `probed / needs_answer`, with null plan and its stored officer-question sentence. Both concurrent event streams answer 200. The destination is omitted from both authored requests and the actual stored suggestion is retained in the 201 receipt. Harness choices are stated, not source facts: kind building, doitt_id, unchanged geometry, no name and no height.

Revision 1 reaches `planned / undecided`, clears the reason and retains `origin: officer`, with `packageId: null`. Reauthor changes one member: the operations array is reversed without changing the mappings or source facts. Revision 2 reaches the row. Both streams deliver each `recipe.changed` followed by `intake.item`, with the recorded durable sequences in order. Replaying the first author request adds no job. No package is made before approval. Approval then produces one reviewed package and ready targets; no confirmation, recording or card command is sent by this primary walk. Numbers and jobs at each step are in result.json.

## Separate unchanged five-layer rerun

All five NYC packages record under one confirmation now, with no individual recovery, no extra review/confirmation request and no refusal. `five-layers.json` preserves the unchanged KN2 walk; result.json carries its timings and counts. It also reaches the three listed building cards in that separate walk. LP1's recorded base changes are observed, not modified here. Both that container and every AQ1 attempt's container are gone.

## Q2 proof and stop rule

- Running memory-path author enrolls no second job: new actual-author unit test. Existing `intake-draft.test.ts` proves the memory proposer keeps origin memory, repins operations and transfers no approval. The full worker's memory-origin publication is not claimed: the supplementary live check stops at the destination guard before authoring can commit.
- Officer revision 2: unit test and primary HTTP row read-back.
- Over-limit waiting reason: actual-author unit test checks the queue-written reason and `recipe.changed` then `intake.item` order. Protocol count is deliberately over-limit, not a fabricated operational input.
- Authored table with null destination: actual-author test on the retained public CSV, no draft job.
- Replayed author: unit test and primary HTTP replay, no extra event or job.

The supplementary same-original memory job remains one initial job, now `stale`; its row is actually read as `probed / undecided`, null plan, null waiting reason. One negative HTTP author captures `STALE_REVISION`: “This destination already exists; pin its current area and reference explicitly.” The guard is `service.ts:109-110`, outside this task's one-call edit. No destination override, job retry or product repair was made. Stop-rule evidence is preserved rather than treating a scoped zero exit as complete memory qualification.

The only old reader-bound test quotation was in `tests/ingestion-events.test.ts`; it now accepts four and checks the fifth, ninth and total bounds plus release. The controller and wire error schema quote no old numeric limits/words, so neither changes. API and client generation leave their content unchanged; only the two source pins change. All nonce-owned containers are removed, originals unchanged, no provider call, no populated volume, no unowned code edit, and no merge/rebase/push.
