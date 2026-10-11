TASK   LP1 — A package review pins what it checked                    GATE GF1
WORKS  Both NYC halves reviewed at area revision 0 record in one confirmation; four cards verify consistent.
       All five vector layers reviewed at area revision 0 record in turn without re-review (2,362 features).
SEE IT docs/evidence/gf1/lp1/result.json, before-04.json and after-02.json.
INPUTS Immutable NYC originals, feature-order test-only halves outside Git, retained review/packet fixtures.
GAPS   No NYC qualification was manufactured: qualified-context movement uses bounded protocol controls.
       The hand-written API projection needs optional review.scope added by its owner; see below.
DESIGN Canonical SHA-256 pins own whole features, reference, bounded qualified context/qualification pins,
       checked associations, widened local extent, 255 m margin and area-check-officer-v2.
       Re-derive under area lock at review persistence and recording. Area revision is informational.
       Document membership follows the exact committed physical_feature_revisions row, not package JSON scans.
COMMITS a5f05a46 Step 0 complete before application changes.
        8ff80e90 Bounded review snapshot and coverage.
        706bd636 Recording re-derivation and readable refusals.
        302c8bca Exact committed-revision document membership.
        The final API/evidence commit follows this record; see git log.
CHECKS Backend typecheck; 182 focused tests; native and Python API checks; Shapely margin sweep; diff/line checks.
NEXT   Lead review/integration; no merge, rebase or push performed here. Pending v1 reviews need one re-review.

## Runtime and interpretation

- Reproduce in a new nonce-owned throwaway box:
  `node docs/evidence/gf1/lp1/run-runtime.mjs after <new-receipt-path>`.
- Before-build break is measured in `before-04.json`: first package committed, second refused 409 STALE_REVISION.
- Final build receipt is `after-02.json`: 1,661 buildings recorded, four selected cards verified, no stopped targets.
- `after-01.json` is superseded: it passed recording but predates the corrected cross-area margin selector.
- Final layer review times: 2,313.530 / 292.722 / 436.876 / 1,259.415 / 1,253.208 ms.
- Final layer commit times: 7,376.031 / 58.979 / 336.595 / 4,214.532 / 2,725.166 ms.
- Existing CA6 is the before performance reference; timings differ by harness, so no formal speedup is claimed.
- Final EXPLAIN used both existing spatial GiST indexes and the qualification primary key: 17.489 ms execution.
- A live raw-selector probe included 468 cross-area NYC features beyond one own feature's bounding box.
  No raw selector row was presented as qualified geometry. Scope is a box widened 255 m per side, not a radius.
- Native normalization still rejects the original self-intersecting feature; it was not repaired or deleted.
- All six own throwaway containers are removed. No populated volume, other checkout or ingestion file was touched.

## Retained guards and migration

Source-native admission is unchanged; recorded corrections and the retained model roofprint remain refused.
Document authority, recording mutex, acknowledgement, per-feature revision locks, CA1 exterior recording and
geometry-free/source-workspace paths remain intact. Display and whole-area-check limits are unchanged.
The Python combined supplied-set, vertex and pair guards are unchanged; qualified context is not truncated.

The lead settled pair guards as `input_scope_guard` and uncertainty as `explicit_association_exception`.
No Python edit was made. Shapely 2.0.7 uses default mitre limit 5; the measured 254.950548 m reach fits 255 m.
Initial stop evidence remains in commits 40754fc1/f1cf079f and the runnable locality diagnostic.

Pending v1 reviews are intentionally refused with “review again”; there is no automatic backfill.

## Ownership-bound API documentation follow-up

`packages/contracts/src/area.ts` now declares optional review.scope and runtime responses return it.
The native generator's hand-written `packageProjection.review` at
`apps/api/src/modules/spatial/spatial.openapi.ts:229–231` does not infer TypeScript interface additions.
That producer is outside LP1's owned paths and was not changed. Add the optional scope there, then regenerate
at integration. Native generation/check already matches the current producer; four owned source pins refreshed.
No ingestion adjustment was needed in the exercised unchanged confirmation/target-card worker flow.
