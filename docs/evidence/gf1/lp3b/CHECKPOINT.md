# LP3b — checkpoint at the job-authority seam

wip(ingestion): large-file projections and reasons; automatic job authority remains

Base `35d7f2e7`; branch `task/lp3b-large-file-automatic`; worktree `E:/Projects/ulpin-wt/k2`.
No merge/rebase/push, no other checkout edits. The existing git identity is unchanged.

## Stop rule (a), exact prerequisite

`packages/server/src/modules/usp/jobs.ts:178` rejects `succeeded` or `paused` logical jobs;
`:189` rejects a fourth lifetime claim, irrespective of whether the earlier claims failed or yielded successfully.
L3 requires **one durable job for the item**, sleeping at reader/profile/layout/mapping/pressure boundaries and
resuming on transactional wake-ups. The existing authority has claim, heartbeat, accept and cancel, but no
successful yield/resume operation. This task owns **registration only** in `jobs.ts`, not those authority lines.
The adjacent named test exercises both actual authority refusals on SQL doubles, without writes.

**Needed:** an authority-owned yield/resume operation which retains monotonically increasing fences, counts
failed retries separately from successful phase yields, and retains a wake-up arriving during a live attempt
(no lost wake between reading a state and parking). Then `queueIntakeLargeTx(client, sourceId)` can call it.
No attempt rows were deleted, renumbered, or bypassed. No replacement broker or per-phase logical jobs added.
No loop or delayed polling was used to disguise the missing authority. No automatic worker was activated.

One additional contract edge: `packages/contracts/src/usp/intake.ts:74` keeps `partsPlanned` positive or null.
A sealed file with every feature rejected/duplicated/oversized has zero cuts; L3.7's final planned count 0 is not
representable. Only descriptions are owned. Decide whether such a file rests `not_understood` with null planned
count or widen the count schema in a separately assigned seam. The classifier currently keeps that count null.

## Delivered independently

- `step0.json`: state table, stored-row restart proofs, enqueue/media/operator/pin checks, terminal code inventory
  and officer sentences, L6 count sources, and the exact authority blocker. Committed first.
- `intake-large.ts`: named stored-state classification, no drafting before receipt/profile/mapping closure;
  phase counter projection; literal/limit-based failure words and nonzero-only hold summary. These are helpers,
  **not a running state machine**. No layout-memory bridge, provider route or new ceiling.
- `intake-ledger.ts`: `writeIntakeLargeTx` uses the existing draft writer, publishes state/counters together
  with at most one item refresh, and makes unchanged replay write/event-free. Existing bounded writer unchanged.
- `intake-draft.ts`: only a retained large GeoJSON **over the reader ceiling** now rests `not_understood` with
  the prescribed size sentence. An in-ceiling original still stops at the existing oversized refusal because
  the safe durable job cannot be enrolled yet. All old bounded tests are unchanged and pass.
- `streaming-vector.ts`: L7 adds `streamed-map-receipt.ts` to `readerFiles`.
  **Previously sealed jobs:** retained bytes/history remain available, but their read freshness reports
  `reader_changed`; current-write/approved-profile checks refuse the old reader pin. No receipt backfill,
  fingerprint migration or automatic re-read was performed. An unsealed old job also cannot silently resume
  under the new code. This is the existing fingerprint behavior, not a relaxed compatibility rule.
- Contract descriptions and generated OpenAPI/client/pins updated. No Studio source changed.

## Actual HTTP boundary (runtime.json)

An empty nonce-owned tmpfs PostgreSQL, actual Nest routes from this worktree, and a loopback in-memory S3
transport control. No original/source/job/package/reader/mapping row was injected. Product upload performs
byte-part and final original integrity checks. This is not MinIO or a throughput benchmark.

Both DA6 and Niagara: begin, raw byte parts, finalize, then **the client's register**, followed by actual event
stream and manifest. DA6 retained 43,263,076 bytes; Niagara 26,660,992. Register to row: 81 ms / 58 ms.
Both rows stop `probed` / `needs_answer`, with the **old oversized reason**, null plan and all three counts
null/0/0. After the real dispatcher tick: zero jobs and zero packages. Original hashes unchanged; originals
were also checked in the transport store. No hidden reader/profile request was sent to advance the walk.
Niagara did **not** reach `STREAMING_SOURCE_CRS`; its prescribed sentence is helper-tested, not runtime-proved.
No layout author/approve, drafting restart, confirmation or card was attempted past this stop.
The exact nonce container was verified and removed; no other task's resources were inspected for ownership
or removed. No process/provider call remains running.

## Checks

- Before: 279/279 ingestion, areas, packets, manual ingestion and later-receipt tests; backend typecheck 0.
- After: 289/289 with 10 new named checks; same old tests, including ranges. Backend/Studio typecheck 0.
- API generation / generator check / `pnpm studio:api-types` / pin refresh against `35d7f2e7` / Python API check: 0.
- HTTP boundary command: `node docs/evidence/gf1/lp3b/run-runtime.mjs <new-receipt.json>`: 0.
- `node docs/evidence/gf1/lp3b/check.mjs`: saved-boundary evidence only, not a fresh gate.
- One API check initially refused stale source pins after later source edits; regeneration then check passed.
  No runtime upload attempt failed. Diff/line-length checks pass.

## Resume, in order

1. Assign/extend the job-authority seam; implement its yielded-phase lifecycle and lost-wake invariant.
   No change is needed in large-original.ts (L1 is settled). Keep sealed-only admission (L2 is settled).
2. Add shared item queue, operation registration and dispatcher worker. Enroll the in-ceiling branch;
   start actual reader/profile services with stable keys; transactionally wake on both terminal paths,
   author/approve, mapping close/failure and finished review. Include raw/mapped part publication projections
   inside the permitted shared wake-up call so L4 emits one item event per part. No state polling.
3. Fold the sealed parts in global order with the existing cutter, fetch original spans by bounded authorized
   range reads (raw payloads contain parsed Features but **not original bytes**), and call the existing
   `draftIntakePartTx` serially. Preserve exact previous locators on replay and eight-unreviewed pressure.
   Track duplicate positions by distinct union of first/later conflict indexes, not `duplicate_keys`.
   Persist oversized counts in cut counts and closing item metadata; do not lose trailing/zero-cut holds.
   Mapping unresolved/importer quarantine beyond raw rejection cannot be falsely counted as reader rejection.
4. Activate worker only when all wake-ups and closure are safe. Repeat DA6 HTTP walk to approval, preparation,
   one process restart during drafting, three-package confirmation/cards/range excerpts, then Niagara refusal.

Missing: the automatic path in its entirety, folding/refill integration, terminal worker row wiring, persisted
L6 counters, restart proof and three-card proof. GF1 is **not passed**.
