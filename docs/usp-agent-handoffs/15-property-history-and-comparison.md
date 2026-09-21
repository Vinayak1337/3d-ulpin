# 15 · Property history and revision-pinned comparison

Owner **HISTORY** · Priority **P2** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · Consume [F0/F1](01-shared-contracts-and-ownership.md).

## A. User outcome and product value

Allow an officer or authorized property user to understand **what changed, in which space, when the system recorded it and what evidence supports each version**. Compare observed geometry, recorded representations and a proposal without treating them as interchangeable. This strengthens existing history into a vertical-property audit capability.

Synthetic example: a first-floor unit was later split into two units. An old identifier still opens the retired record and its successors. Comparing its old boundary with the two reviewed successor boundaries explains the change; the old deed is not silently reassigned to both children as proof of their current rights.

## B. Current implementation and gap analysis

[History.tsx](../../apps/web/features/officer/register/History.tsx) already shows source, review, association and investigation events. [RevisionCompare.tsx](../../apps/web/features/officer/register/RevisionCompare.tsx) compares retained physical-feature versions and refuses overlay when frame checks fail. [RecordHistory.tsx](../../apps/web/features/officer/register/RecordHistory.tsx) opens stored registry revisions and their evidence. [registry-db.ts](../../apps/web/lib/server/registry-db.ts) retains record revisions; [core identity](../../packages/contracts/src/spatial/core/identity.ts) contains pure split/merge validation and lineage planning.

Missing: one exact-space comparison model spanning these sources, explicit recorded-time versus valid-time labels, consistent historical source authorization, a complete persisted lineage adapter and scope-preserving shared-map comparison. A pure core split/merge helper is not a working database/API/UI lineage workflow. Do not rebuild the existing timeline from scratch.

## C. Scope and non-goals

First release: paginated exact-target history, explicit two-revision comparison for geometry/rights/links/evidence, source and frame pins, stable historical URLs, and read-only lineage browsing. Add validated lineage receipts only through FND's reviewed identity-change adapter; the first useful read/comparison path must not wait for a new geometry editor.

No invented pre-survey history, automatic temporal interpolation, prediction of construction dates, automatic title transfer, or classification of newer observations as approved changes. Split/merge editing is optional until the existing review/commit adapter supports it; if absent, clearly show “No recorded lineage,” not a fake split workflow. Do not add an editable general event log.

## D. HLD and end-to-end flow

Open selected unit's History → request a permission-filtered timeline at pinned revisions → choose Before and After → resolve exact source/geometry/relationship revisions → compute supported differences → display fields and optional shared-map overlay → open cited evidence or a linked reviewed proposal. A retired record can navigate to explicitly recorded predecessors/successors without changing its identity.

History reads must not update current records or trigger source reprocessing. Derived comparison caches are keyed by both revision manifests, method and access view. A current revision change does not rewrite a historical comparison; it adds a “Newer version available” notice.

## E. Targeted LLD

Proposed `HistoryEntry`: event ID, target pin(s), event kind, recordedAt, optional validFrom/validTo, actor display permitted by policy, reason, change ID, source pins and outcome. Distinguish receipt time, review time and source-stated validity. Unknown validity remains null with a reason. Sort timeline by recordedAt plus a stable event ID; never infer factual order from file modification times alone.

Proposed `ComparisonRequest`: left/right target+revision+world manifests, requested fields and geometry mode. Same-object comparisons require matching semantic identities; split/merge comparison requires an explicit lineage group. Cross-world observed/recorded/proposed comparison is an explicit action with both world labels, never an implicit mix inside a single scope. Rights are not classified as “observed geometry”; keep record state and observation classification orthogonal.

| Difference | Computation and limitation |
| --- | --- |
| Field/quantity | Compare values with their definitions and units; convert only through a qualified unit operation. Unknown-to-known is an availability change, not a zero-based numerical increase. |
| Footprint | Supported compatible polygons: added=`after minus before`, removed=`before minus after`, unchanged=`intersection`; preserve holes/multipart. |
| Prism | Compute supported interval/footprint differences using qualified local geometry; missing Z or datum prevents volume claims. |
| Rights/relationships | Compare stable assertion/link identity and exact evidence/review pins, not only party-name text. A renamed party is not automatically a transfer. |
| Evidence | Added/removed/unlinked source-part refs with immutable source revision; current source contents cannot substitute for an old revision. |

Frame equivalence needs horizontal reference, transformation version, axis/unit metadata and vertical benchmark where relevant. The baseline component's local overlay check is not a universal CRS equivalence test. Use FND/core frame adapters; with incompatible frames retain side-by-side field/source comparison and explain why overlay is disabled. If fewer than two revisions exist, display the one available version without implying historical change.

Proposed `usp_history_lineage` stores reviewed change ID, type (`split`, `merge`), predecessor/successor pins, evidence, reviewer/commit receipt and recordedAt. No fabricated backfill: historical data without recorded lineage stays unlinked. An accepted lineage group must be acyclic, same namespace/kind, satisfy cardinalities and preserve retired identities. Core planning results are persisted only atomically with the actual reviewed identity change through FND; failed commits leave no apparent lineage. HISTORY does not allocate new registry IDs.

Optional `usp_history_comparisons` caches manifests/results without copying original assets. Historical permissions are evaluated using current grants plus explicit release policy; “it was once visible” is not permanent entitlement. Redacted public history uses a separate projection; it does not expose old owners through an otherwise sanitized current property page.

Proposed APIs under `/api/v1/usp/history`: `GET /targets/:ref/history` (scope, cursor, bounded page); `GET /targets/:ref/lineage`; `POST /comparisons` with revision manifests/idempotency; `GET /comparisons/:id`. Encode refs using the FND route codec; do not parse IDs at colon boundaries. Expensive comparisons may return 202 via existing jobs; small field diffs can complete inline under a measured bound. Missing exact historical assets produces `unavailable_revision`, not a current-version fallback. Invalid pairing/stale proposal is 409/422 according to shared conventions.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [registry.ts](../../apps/web/lib/server/registry.ts), [registry-db.ts](../../apps/web/lib/server/registry-db.ts) | Supply exact recorded revisions through FND adapter | Preserve current registry authority | FND | HISTORY read model |
| [core identity](../../packages/contracts/src/spatial/core/identity.ts), [snapshot.ts](../../packages/contracts/src/spatial/core/snapshot.ts) | Reuse lineage/validity validators and source pins | No reinvention of identity | HISTORY read-only reuse | F0 |
| Proposed new `packages/contracts/src/usp/history.ts` | Timeline/comparison/lineage DTOs | Stable typed comparisons | HISTORY | Common refs |
| Proposed new `apps/web/lib/server/usp/history/{timeline,compare,lineage,routes}.ts`, `migrations/15-history.ts` | Read composition, qualified differences and lineage receipts | Persisted traceability | HISTORY | FND exact reads/commit adapter |
| Proposed new `apps/web/features/usp/history/{PropertyTimeline,ComparisonPanel,LineageStrip}.tsx` | Exact-space history and compare controls | Reuse quick/full register | HISTORY | UI shared selection/overlays |
| [History.tsx](../../apps/web/features/officer/register/History.tsx), [RevisionCompare.tsx](../../apps/web/features/officer/register/RevisionCompare.tsx), [RecordHistory.tsx](../../apps/web/features/officer/register/RecordHistory.tsx) | Mount compatible new leaves and avoid duplicate histories | One timeline experience | UI | HISTORY leaves |
| Proposed new `tests/usp-history.test.ts`, `tests/usp-history-integration.ts`, `tests/e2e/usp-history.spec.ts` | Exact revision, permission, lineage and overlay tests | No fabricated timeline | HISTORY | Isolated revisions/frames |

## G. UI placement and interaction

Map quick register → unit → **History** compact strip → **Compare versions** opens the full register's History context with the same target and chosen pins. The main comparison shows two labelled revision selectors, compact changed-field summary and a single map overlay mode: Before / After / Difference. Do not create two permanent WebGL viewers. Two source excerpts may be shown side by side without duplicating the map.

Loading retains selection but not stale comparison content from another unit. Empty says no earlier revision retained. Missing old source or incompatible frame is explicit with field-only fallback. Denied old evidence cannot be downloaded through comparison links. Success displays both revision dates, world/classification and source buttons. Retired identities show a non-dismissable retired label and explicit successor links; no automatic redirect that hides history. UI owns scene/route integration; HISTORY owns timeline/selector contents.

## H. Agent ownership and dependencies

Use `feat/usp-history`. F0 allows pure differences and lineage tests; F1 is needed for stored revisions and source access. HISTORY exposes a read-only minimal port to RIGHTS/ASSIST. It must not independently rewrite registry commit/ID allocation, shared viewport or route state. FND applies lineage persistence hooks; if not available, deliver real read-only history and report the write path as gated optional work, not implemented. UI integrates shared parents serially.

## I. Implementation sequence

1. Inventory available historical record/physical/source revisions and define exact read projections.
2. Implement timeline and two-version field/evidence diff with missing-state tests.
3. Add qualified polygon/prism overlays through existing geometry services and explicit frame gating.
4. Add lineage read model; connect actual reviewed identity receipts only when FND provides atomic persistence.
5. Deliver reusable timeline/comparison UI and UI integration patches; test historical URLs and source permissions.
6. Run live recorded-revision comparisons and regression cases without modifying current records.

## J. Acceptance criteria and verification

Synthetic demo retains two unit revisions, an observed survey and a proposed boundary. Compare each explicit pair and show their classifications; only the recorded pair represents recorded history. A missing height remains unknown, not a numeric gain from zero. An incompatible vertical reference prevents volume comparison. The current property remains unchanged after every read.

Test a single retained revision, retired identifier, valid split/merge fixture, cycle/cardinality failure, same label in another building, missing old original, same source family/new revision, historical private-party leakage and cross-scope access. When lineage writes are enabled, kill the transaction before commit and verify no orphan successor/receipt. Do not claim that fixture lineage proves the optional production write integration.

Run `pnpm typecheck`, `pnpm test:registry`, `pnpm test:studio`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-identity.test.ts tests/usp-history.test.ts`; `pnpm exec tsx tests/usp-history-integration.ts`; `pnpm exec playwright test tests/e2e/usp-history.spec.ts`. Return revision manifests, computed differences, source-link/permission checks and screenshots with clear before/after labels.

## K. Copy-paste agent assignment

> Implement HISTORY on `feat/usp-history`. Read the index/shared contracts, this handoff and existing History/RevisionCompare/RecordHistory/core identity code. Extend the real exact-revision read path through the proposed HISTORY modules and tests, preserving current IDs and source revisions. Keep recorded time, source validity, world classification and technical review state distinct. UI owns map/parent mounts; FND owns registry/identity persistence. Build read-only comparison first; do not claim optional split/merge writes without the atomic reviewed adapter. Run section J and return manifests, numeric/source difference evidence, permissions tests, screenshots, commits and remaining gates. Do not fabricate history or merge main without authorization.
