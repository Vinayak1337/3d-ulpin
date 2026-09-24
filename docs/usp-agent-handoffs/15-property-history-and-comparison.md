# 15 · Exact-space history and revision comparison

Owner **HISTORY**. Historical baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 24 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), [26](26-identifiers-and-standard-exchange.md), [28](28-data-acquisition-and-finale-tests.md), geometry contract in [12](12-rights-aware-spatial-findings.md) and [99](99-ui-ux-and-integration.md). ER-05/20/24 are incorporated. New files are implementation destinations.

**GF3 deviation ownership:** HISTORY integrates exact sanctioned/observed revision pairs and owns the deviation comparison service/GF-T19. DOMAIN supplies qualified candidate/quantity outputs; FIND supplies spatial operations. H27 defines those interfaces and no second history or geometry engine is created.

## A. User outcome and product value

Allow an authorized user to see what changed in an exact property space, when the application recorded it, and which source supports each version. Compare supplied observed/planned representations and recorded revisions without conflating them. A retired space can expose recorded successors without silently reassigning its old evidence as proof of their current rights.

## B. Current implementation and gap analysis

[History](../../apps/web/features/officer/register/History.tsx), [RevisionCompare](../../apps/web/features/officer/register/RevisionCompare.tsx) and [RecordHistory](../../apps/web/features/officer/register/RecordHistory.tsx) already expose retained events/revisions. [Registry storage](../../apps/web/lib/server/registry-db.ts) keeps record history. [Core identity](../../packages/contracts/src/spatial/core/identity.ts) has pure lineage validation, not a fully persisted split/merge workflow. [Scene cache](../../apps/web/lib/server/spatial-core-scene.ts) is current-data/process-local and cannot supply missing historical source/geometry versions by assertion.

Implement exact historical composition adapters, unit-specific comparisons, permission-safe source links and shared-map overlays. Preserve the existing timeline purpose, IDs and review history.

## C. Scope and non-goals

Required: exact-target paginated history, explicit two-manifest field/evidence/relationship comparison, supported geometry difference, historical URLs and available lineage browsing. Read-only comparison does not wait for split/merge editing. **For `finale_v1` GF1, reviewed split/merge retirement, successor assignment and lineage writes are required together** under H26's FND-owned same-client identity command; HISTORY consumes and proves the resulting graph. The older read-only milestone remains useful but cannot pass GF1 alone.

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

Proposed `usp_history_lineage` records actual reviewed change ID, split/merge kind, predecessor/successor UUIDs and project codes, exact pre/post pins, evidence, post-commit receipt and dates. At GF1 its writes occur atomically with actual identity retirement/allocation through H26's FND command; lineage alone cannot create property identities. Enforce namespace/kind policy, acyclicity, split one-to-many and merge many-to-one cardinality, distinct participants and non-reused IDs/codes. A correction that preserves one space uses a revision and historical label/anchor association, not a fictitious successor. Missing recorded lineage remains absent; authored lineage fixtures do not prove the production write path.

Resolver output for an old UUID, proposed code or meaningful historical alias includes exact retained status (`assigned`, `retired`, `cancelled_error`), recorded revision and authorized successor/predecessor links. A cancelled code is never reused or silently redirected. Same flat name, shared parcel, geometry overlap or nearest centroid cannot establish lineage. A demolished space stays retired; a replacement receives a new reviewed identity unless evidence and policy establish continuity. QR/card and CityJSON sidecar use the same code and exact revision as the history view, subject to current access or an exact active release. A valid checksum alone does not permit lookup or grant access.

Prefix `/api/v1/usp/history`: `GET /targets/:ref/history` with exact scope/cursor/limit≤100; `GET /targets/:ref/lineage`; `POST /comparisons` with request/create guard → result or 202; `GET /comparisons/:id`. Use FND reference codec and envelopes. Invalid pairs/unsupported operation are 409/422 as appropriate. Historical permission checks use current grants or an explicit active release decision for those exact derivative bytes. Previously visible does not mean permanently authorized. Public history cannot expose former owners through a sanitized current page.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing registry/history/core/scene files linked in B | FND exact historical read and GF1 same-client identity/lineage adapter; UI retains old routes |
| Proposed `packages/contracts/src/usp/history.ts` | HISTORY entry/comparison/lineage schemas using F0 refs |
| Proposed `apps/web/lib/server/usp/history/{timeline,compare,lineage,routes}.ts`, `migrations/15-history.ts` | HISTORY bounded read/comparison and actual receipt links |
| Proposed `apps/web/features/usp/history/{PropertyTimeline,ComparisonPanel,LineageStrip}.tsx` | HISTORY leaf UI |
| Existing History/RevisionCompare/RecordHistory and shared map | UI mounts leaves; no duplicate timeline/map engine |
| Proposed `tests/usp-history.test.ts`, `tests/usp-history-integration.ts`, `tests/e2e/usp-history.spec.ts` | HISTORY old/current composition, no-write, geometry and permission tests |

## G. UI placement and interaction

Quick register → selected unit History → Compare versions → full register with same target and explicit left/right pins. One map offers Before/After/Difference; two source panes do not require two WebGL viewers. Keep both source dates, record dates, stage and classification visible. Loading does not display another unit's old content; empty says no earlier retained revision; incompatible frame/missing source yields field-only limitation; denied details are not leaked. Retired record has an explicit retired banner and successor links, not an automatic redirect hiding it. UI owns query, camera, focus and mobile sheet; HISTORY owns comparison content.

## H. Ownership and dependencies

Use an isolated branch from the verified staging head; own HISTORY paths/tests/migration. GF0 permits oracle tests; GF1 exact reads and actual FND split/merge receipts are required for the finale identity flow. FIND is required for analytical differences, not text history. RIGHTS/ASSIST consume available read projections. FND owns registry IDs/transactions and H26 allocation, DATA shared packs, UI all shared map/parent changes. A missing adapter is a declared capability gate, not permission to create substitute history.

## I. Implementation sequence

1. DATA supplies D0 version pair and independent expected differences; inventory actual retained source/geometry/link history.
2. Connect exact-manifest reads and field/evidence differences before overlays.
3. Add qualified FIND polygon/prism operations and per-constituent unavailable states.
4. Add lineage browsing against H26's required GF1 reviewed split/merge receipts; preserve absent lineage where no historical write exists.
5. Mount reusable UI and historical URLs, preserving current records and camera.
6. Change current data and reopen the old comparison to prove its independence; then attempt a permitted real dated pair.

## J. Datasets, tests and commands

**D0 before/after:** import/record one clean unit through real services, preserve manifest A, update its source/geometry/relationship through normal review and preserve B. DATA supplies a separate expected.json with exact changed fields and source hashes. Include a source-link-only update with unchanged logical property identity, one unknown→known quantity, a shared clause change and incompatible vertical reference. Reopen A after B and after application restart; every constituent must still match A or explicitly report not retained. Hash/current revision checks prove reads did not mutate records.

**D5 later real-source gate:** obtain a permitted revision pair for the same tower/unit from [RERA 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831) or [2079](https://haryanarera.gov.in/view_project/project_preview_open/2079), or a known-property/campus drawing pair. Previously only indices were verified; do not assume two downloadable versions exist. Check matching identity, drawing purpose, date, units and permission. If only one exists, show one, do not synthesize an earlier real version. D0 remains the implementation fallback.

Test missing old original, current family/new source revision, same flat name in another building, hidden past parties, revoked source/release, cursor membership change, invalid lineage/cardinality, component holes and late geometry result. At GF1, rollback between identity update and receipt must leave neither apparent successor nor orphan lineage. V6 screenshot must name actual manifest refs and preserve one camera; a mock before/after is insufficient.

**GF-T15** adds two concurrent reviewed allocation attempts, retry with the same request key, stale expected revision, split/merge rollback after code reservation, cancelled-code tombstone, corrected label/official anchor, multi-parcel and missing-anchor records, retired URL/QR behavior and non-reused successors. Compare H26's independent vectors and exact before/after receipt rows. **GF-T21** later verifies card, viewer, exchange and resolver show one code/revision without leaking a sibling or obsolete release. Record both test IDs in H28's central matrix; historical backlog T numbers remain separate.

Run `pnpm typecheck`, `pnpm test:registry`, `pnpm test:studio`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-identity.test.ts tests/usp-history.test.ts`; `pnpm exec tsx tests/usp-history-integration.ts`; `pnpm exec playwright test tests/e2e/usp-history.spec.ts`. Return pack/source/manifest hashes, exact before/after expected/actual values, no-write/permission proofs and V6 screenshots. Separate read-history and supported-geometry results; report the GF1 lineage-write gate from actual FND receipts.

## K. Copy-paste assignment

> Implement HISTORY using 00, 01, H26, H28 and this handoff. Reuse retained D0 revisions and attempt one permitted dated real pair. Build exact historical manifests/constituents, field/source/relationship diff, supported FIND overlays and stable old-record navigation. For `finale_v1` GF1, consume FND's atomic reviewed split/merge, retirement and successor receipts; test stale/concurrent/rollback behavior under GF-T15. Never substitute current sources/placement, infer history, turn unknown into zero or hide a retired record through automatic redirect. FND owns immutable-read/identity writes, UI shared mounts and DATA independent packs. Return source/manifest hashes, before/after rows, actual receipts, V6 images and unqualified capabilities. Do not claim official issuance or legal history from fixtures.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. Task cards: [H29](29-agent-task-cards.md) HISTORY-01 and HISTORY-02.

### Z1. Split the sequence by gate

- **GF1 block:** exact revision reads, field diff, lineage display (including `boundary_adjustment`, [H26](26-identifiers-and-standard-exchange.md) Z2) and the GF-T15 history rows. Exit: GF-T15 history cases pass.
- **GF3 block:** FIND overlays and the sanctioned/observed deviation (GF-T19). Exit: GF-T19 receipt.

Section I step 3 (FIND polygon/prism operations) belongs to the GF3 block, so GF1 is never blocked on FIND.

### Z2. Sanctioned versus observed deviation (GF-T19)

HISTORY owns `apps/web/lib/server/usp/history/deviation.ts` and `tests/usp-deviation.test.ts`. It consumes H27 `DeviationPair` and FIND operations and returns a review finding with uncertainty, never a verdict. Cases come from H28's single GF-T19 list: identical pair, revised sanctioned plan, seeded extra storey, seeded setback, missing datum (`not_comparable`), and the rooftop-structure and chajja negatives in [H28](28-data-acquisition-and-finale-tests.md) Z3. Command: `pnpm test -- usp-deviation` (FND wires it into `pnpm test:gf:GF-T19`).

### Z3. Indian transaction dates

Replace the two date fields with `sourceDates[] {role, literal, isoDateOnly, calendar}`, where `role` is one of `execution`, `registration`, `mutation`, `effective`, `sanction`, `occupancy_certificate`, plus `mutationStatus` (`recorded`, `pending`, `rejected`, `unknown`). Registration can follow execution by months, and mutation is often pending. An unregistered agreement or power-of-attorney chain is shown as "document, not a registered transfer". Store `recordedAt` as UTC and display it in IST; store date-only values as dates, never instants. Tests: `2024-03-31` round-trips unchanged; a pending-mutation entry is not shown as a recorded transfer.

### Z4. Revision chain on history

Each revision shows chain state from H10: `consistent`, `broken` or `unsigned`. The UI says "Chain consistent" only; it never says "verified" or "authentic" unless a signed head exists and verifies.
