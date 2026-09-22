# 15 · Exact-space history and revision comparison

Owner **HISTORY**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), geometry contract in [12](12-rights-aware-spatial-findings.md) and [99](99-ui-ux-and-integration.md). ER-05/20/24 are incorporated. New files are implementation destinations.

## A. User outcome and product value

Allow an authorized user to see what changed in an exact property space, when the application recorded it, and which source supports each version. Compare supplied observed/planned representations and recorded revisions without conflating them. A retired space can expose recorded successors without silently reassigning its old evidence as proof of their current rights.

## B. Current implementation and gap analysis

[History](../../apps/web/features/officer/register/History.tsx), [RevisionCompare](../../apps/web/features/officer/register/RevisionCompare.tsx) and [RecordHistory](../../apps/web/features/officer/register/RecordHistory.tsx) already expose retained events/revisions. [Registry storage](../../apps/web/lib/server/registry-db.ts) keeps record history. [Core identity](../../packages/contracts/src/spatial/core/identity.ts) has pure lineage validation, not a fully persisted split/merge workflow. [Scene cache](../../apps/web/lib/server/spatial-core-scene.ts) is current-data/process-local and cannot supply missing historical source/geometry versions by assertion.

Implement exact historical composition adapters, unit-specific comparisons, permission-safe source links and shared-map overlays. Preserve the existing timeline purpose, IDs and review history.

## C. Scope and non-goals

Required: exact-target paginated history, explicit two-manifest field/evidence/relationship comparison, supported geometry difference, historical URLs and available lineage browsing. Read-only comparison must not wait for new split/merge editing. New lineage writes remain optional until a same-client reviewed identity operation is implemented and tested by FND.

No inferred pre-survey state, guessed construction dates, interpolation between missing revisions, automatic title transfer, generic editable event log, arbitrary mesh booleans or current-source substitution. One retained revision is a valid single-version view, not proof of no historic change.

## D. HLD and end-to-end flow

Selected unit History → permission-filtered revision list → choose explicit Before/After manifests → resolve exact constituents → compute supported differences → show fields and one shared-map comparison → open cited historical source or existing update workflow. Reads cannot alter current records or trigger source reprocessing. A newer current revision only offers a new comparison; it never rewrites a saved comparison.

## E. Targeted LLD

### Historical composition contract

Consume FND SnapshotManifest from 01, including immutable membership, target/geometry/quantity/source-part/link/relationship/transform/review pins and policy/as-of context. `readHistoricalTarget(ctx,{target,scope})` is implemented through `resolveTarget` with the historical SnapshotScope, not a second current resolver. Missing exact source, representation or transform produces unavailable_revision for that constituent. A complete comparison cannot silently borrow a current value.

Where baseline data lacks a historic constituent, label it not retained. New immutable captures may preserve the actual current state at feature introduction, but may not backdate invented snapshots. Historical/current source-family membership is not enough: an exact source revision/hash is required. A relationship change with unchanged property revision must still alter the composition manifest.

`HistoryEntry` contains event/ref, participant target pins, recordedAt, separately nullable source-stated validFrom/validTo, permitted actor display, reason, outcome, source pins and optional actual change/commit receipt. Sort recordedAt plus stable event key; preserve source validity separately. Do not infer chronology from filesystem modification dates.

`ComparisonRequest` contains left/right `{target,scope:SnapshotScope}`, field selection and geometry mode. Same-object comparison requires stable semantic identity. Multi-object predecessor/successor comparisons need an explicit recorded lineage group. Cross-world comparison names both classifications/stages; do not squeeze them into one misleading single-world snapshot. Comparison result includes each constituent's available/unavailable/withheld state and currency relative to current data.

### Difference definitions

| Item | Required calculation / boundary |
| --- | --- |
| Quantity | Compare only matching definitions with qualified unit conversion. Unknown→known is availability change, not increase from zero. Plinth area is not carpet area. |
| Polygon | Added=after minus before, removed=before minus after, unchanged=intersection; retain holes/multipart. |
| Prism/components | Use FIND's qualified operation/slab representation. Missing Z/datum prevents volume difference; never compare bounding envelopes as exact geometry. |
| Rights/links | Compare stable assertion/link revisions and evidence. Changed party text alone is not a legal transfer. |
| Evidence | Added/removed/unlinked exact source-part/link versions. Preserve the old source bytes and association. |

Overlay compatibility checks horizontal CRS, axes/units, anchor/transform version and vertical benchmark/operation. A matching string alone does not prove equivalence. If overlay is unsupported, retain field/source side-by-side comparison and explicit limitation. External D1 roof meshes may have display comparison only; no arbitrary mesh-volume claim. The first useful field comparison remains available when FIND geometry is not yet qualified.

### Persistence, APIs and lineage

Proposed `usp_history_comparisons` stores immutable input manifests/result refs/method versions/access-view. Cache key includes both full manifests, requested fields, geometry method and entitlement/policy. Small field differences execute inline within a bounded request; geometry work uses FND fenced jobs, ≤60-second child tasks and the qualified profile limits. API never synchronously scans every historical source for a timeline page.

Proposed `usp_history_lineage` records actual reviewed change ID, split/merge kind, predecessor/successor pins, evidence, post-commit receipt and dates. Writes, when enabled, occur atomically with actual identity retirement/allocation through FND; lineage alone cannot create property identities. Enforce same namespace/kind, acyclicity, correct split/merge cardinality and non-reused IDs. Missing recorded lineage remains absent; authored lineage fixtures do not prove the production write path.

Prefix `/api/v1/usp/history`: `GET /targets/:ref/history` with exact scope/cursor/limit≤100; `GET /targets/:ref/lineage`; `POST /comparisons` with request/create guard → result or 202; `GET /comparisons/:id`. Use FND reference codec and envelopes. Invalid pairs/unsupported operation are 409/422 as appropriate. Historical permission checks use current grants or an explicit active release decision for those exact derivative bytes. Previously visible does not mean permanently authorized. Public history cannot expose former owners through a sanitized current page.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing registry/history/core/scene files linked in B | FND exact historical read and optional same-client lineage adapters; UI retains old routes |
| Proposed `packages/contracts/src/usp/history.ts` | HISTORY entry/comparison/lineage schemas using F0 refs |
| Proposed `apps/web/lib/server/usp/history/{timeline,compare,lineage,routes}.ts`, `migrations/15-history.ts` | HISTORY bounded read/comparison and actual receipt links |
| Proposed `apps/web/features/usp/history/{PropertyTimeline,ComparisonPanel,LineageStrip}.tsx` | HISTORY leaf UI |
| Existing History/RevisionCompare/RecordHistory and shared map | UI mounts leaves; no duplicate timeline/map engine |
| Proposed `tests/usp-history.test.ts`, `tests/usp-history-integration.ts`, `tests/e2e/usp-history.spec.ts` | HISTORY old/current composition, no-write, geometry and permission tests |

## G. UI placement and interaction

Quick register → selected unit History → Compare versions → full register with same target and explicit left/right pins. One map offers Before/After/Difference; two source panes do not require two WebGL viewers. Keep both source dates, record dates, stage and classification visible. Loading does not display another unit's old content; empty says no earlier retained revision; incompatible frame/missing source yields field-only limitation; denied details are not leaked. Retired record has an explicit retired banner and successor links, not an automatic redirect hiding it. UI owns query, camera, focus and mobile sheet; HISTORY owns comparison content.

## H. Ownership and dependencies

Use `feat/usp-history`, own HISTORY paths/tests/migration. F0 permits oracle tests; F1 exact reads required for live history. FIND is required for the requested analytical differences, not text history. RIGHTS/ASSIST consume available read projections; no circular dependency on optional split/merge editing. FND owns registry IDs/transactions, DATA shared packs, UI all shared map/parent changes. A missing adapter is a declared capability gate, not permission to create substitute history.

## I. Implementation sequence

1. DATA supplies D0 version pair and independent expected differences; inventory actual retained source/geometry/link history.
2. Connect exact-manifest reads and field/evidence differences before overlays.
3. Add qualified FIND polygon/prism operations and per-constituent unavailable states.
4. Add available lineage browsing; consume actual commit receipts only when the optional write path exists.
5. Mount reusable UI and historical URLs, preserving current records and camera.
6. Change current data and reopen the old comparison to prove its independence; then attempt a permitted real dated pair.

## J. Datasets, tests and commands

**D0 before/after:** import/record one clean unit through real services, preserve manifest A, update its source/geometry/relationship through normal review and preserve B. DATA supplies a separate expected.json with exact changed fields and source hashes. Include a source-link-only update with unchanged logical property identity, one unknown→known quantity, a shared clause change and incompatible vertical reference. Reopen A after B and after application restart; every constituent must still match A or explicitly report not retained. Hash/current revision checks prove reads did not mutate records.

**D5 later real-source gate:** obtain a permitted revision pair for the same tower/unit from [RERA 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831) or [2079](https://haryanarera.gov.in/view_project/project_preview_open/2079), or a known-property/campus drawing pair. Previously only indices were verified; do not assume two downloadable versions exist. Check matching identity, drawing purpose, date, units and permission. If only one exists, show one, do not synthesize an earlier real version. D0 remains the implementation fallback.

Test missing old original, current family/new source revision, same flat name in another building, hidden past parties, revoked source/release, cursor membership change, invalid lineage/cardinality, component holes and late geometry result. If lineage writes are enabled, rollback between identity update and receipt must leave neither apparent successor nor orphan lineage. V6 screenshot must name actual manifest refs and preserve one camera; a mock before/after is insufficient.

Run `pnpm typecheck`, `pnpm test:registry`, `pnpm test:studio`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-identity.test.ts tests/usp-history.test.ts`; `pnpm exec tsx tests/usp-history-integration.ts`; `pnpm exec playwright test tests/e2e/usp-history.spec.ts`. Return pack/source/manifest hashes, exact before/after expected/actual values, no-write/permission proofs and V6 screenshots. Separate read history, supported geometry and optional lineage-write qualification.

## K. Copy-paste assignment

> Implement HISTORY on feat/usp-history using 00, 01 and this handoff. Obtain two real-service D0 revisions and later attempt one permitted D5 pair. Build exact historical manifests/constituents, field/source/relationship diff, supported FIND overlays and stable old-record navigation. Never substitute current sources/placement, infer history, turn unknown into zero or block basic read history on a new split/merge editor. FND owns immutable-read/identity adapters, UI shared mounts and DATA pack files. Execute J by modifying current data while reopening old manifests and testing access/no-write behavior. Return commits, hashes, numerical/source evidence, V6 images and explicit optional gates. No unauthorized merge or official-history claim from fixtures.
