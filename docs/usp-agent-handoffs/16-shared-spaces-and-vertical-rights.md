# 16 · Shared spaces, access relationships and vertical rights

Owner **RIGHTS** · Priority **P2** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · Read [F0/F1 contracts](01-shared-contracts-and-ownership.md) and [history boundaries](15-property-history-and-comparison.md).

## A. User outcome and product value

Allow an officer or authorized property user to inspect which defined spaces have recorded or claimed shared-use/access relationships, and the evidence behind them. Show a staircase, corridor, terrace, parking bay or underground crossing as an identified space with relationships—not merely an unlabelled building mesh. This is a vertical-mapping differentiator when backed by source evidence.

Synthetic example: Flat 101 and Flat 201 use Stair S1. A submitted document claims S1 belongs exclusively to Flat 101. Show the shared-use assertions, conflicting exclusive claim, affected units and source clauses. Do not decide which claim is legally correct. A duplex may relate to two floors while retaining one space identity.

## B. Current implementation and gap analysis

[registry contracts](../../packages/contracts/src/registry.ts) already include space use, `ownership_claim`, `shared_use`, `easement` and relationship types `within`, `floor`, `serves`, `crosses`. However, [registry evidenceChecks](../../apps/web/lib/server/registry.ts) currently permits `serves` from a space **to a building**, not arbitrary space-to-space access graphs. A new stair-to-flat relationship cannot simply be written into that legacy enum without coordinated validation changes.

[geo/registry.py](../../services/geo/geo/registry.py) treats parent context separately from competing volumes and checks membership/crossings. [core identity](../../packages/contracts/src/spatial/core/identity.ts) validates typed relations and lineage; [core source policy](../../packages/contracts/src/spatial/core/source-schema.ts) limits evidence inheritance. These concepts are present; a complete reviewed, permission-aware shared-access graph is not confirmed.

Missing: explicit assertion identity/revisions, evidence-backed unit-level access relationships, conflicting assertions without destructive replacement, full inspection UI and downstream scoped context projections. Existing party strings should not become a new verified-person registry.

## C. Scope and non-goals

First release: read existing rights/relationships; propose and review explicit shared-use/access/restriction assertions among supported existing spaces within one qualified site/scope; inspect linked clauses and affected units; expose a minimal relationship projection to FIND, PACK and IMPACT. Preserve existing registry links without broad semantic reinterpretation.

No automatic ownership adjudication, legal entitlement inferred from physical accessibility, emergency egress certification, automatic share percentages, navigation through private interiors or cross-site title consolidation. Cross-site tunnels and complex non-prismatic rights require separate adapter/geometry qualification. Missing internal geometry stays unresolved and can receive an evidence request; it is not generated from the exterior.

## D. HLD and end-to-end flow

Select unit/shared space → inspect current relationships and their sources → propose an explicit relationship/right assertion → validate endpoints/scope/evidence and geometric applicability → reviewer accepts for technical recording or requests clarification → FND records through a revision-checked adapter → graph projection and affected-property views update → linked FIND checks and PACK context plans become stale/recompute.

The graph is an evidence-backed read model, not another spatial database. It can display unreviewed assertions as such, but only the explicit reviewed selection participates in a downstream “recorded relationship” projection.

## E. Targeted LLD

Proposed `RightsAssertion`: stable ID/revision, source/target pins, assertion kind (`shared_use`, `access_via`, `easement_claim`, `restriction_claim`), evidence pointers, origin/classification, stated validity interval or unknown, party reference/display only when authorized, scope, review state and supersededBy. Existing `RegistryRight` values are adapted as source assertions, preserving their original meaning and status.

Use distinct relations for physical containment, level occupancy, access and rights. A common-space geometry can serve multiple units; do not clone its geometry per beneficiary. A duplex has one ID and explicit links to multiple applicable floors. An easement claim references a defined affected space or explicit unresolved extent; a text-only claim does not create a measured corridor. Fractions/share weights are included only if supplied with definition and evidence; do not divide equally by resident count.

Proposed `usp_rights_assertions`, `usp_rights_reviews`, `usp_rights_commit_links` store additive assertion history and accepted receipt references. FND supplies a mapping adapter: compatible building-level `serves`/existing rights can flow through existing draft/commit validation; new space-to-space assertions stay in their separately versioned, technically reviewed relation store. They do not silently mutate the meaning of `RegistryLink`. Both paths share access checks, expected revisions, audit and atomic accepted-receipt publication.

States: `proposed → under_review → accepted | rejected | clarification_required`; accepted assertions are superseded or withdrawn by a new reviewed revision, never deleted to erase history. “Accepted” means accepted into the application's technical relationship record. Authority/official acceptance remains a separate evidence assertion. An accepted claim may still conflict with another claim; review state does not prove truth.

Validation requires endpoint existence, same allowed scope/world, expected revisions, non-self edges, compatible kinds, exact source association and supported validity. Containment edges must remain acyclic. Access graphs may contain legitimate cycles; do not incorrectly apply a global DAG constraint to all relationship types. Limit traversal to explicit paths, maximum 200 visited nodes per contextual request; report truncation rather than silently omitting affected spaces. Cross-scope endpoints require a future approved federation adapter and are initially rejected.

FIND consumes `{relationships, assertedRights, unresolved, inputPins}` and must distinguish claim/review status. PACK receives only explicit allowed context edges and evidence pointers applicable to its selected target; the whole building's rights do not automatically propagate to a unit. IMPACT can identify affected relationship endpoints but cannot infer legal compensation or clearance. HISTORY supplies prior revisions when available; absent lineage is shown as unknown.

Proposed APIs under `/api/v1/usp/rights`: `GET /targets/:ref/relationships` with scope/digest; `POST /assertions` with target/source pins, kind, evidence and idempotency key; `POST /assertions/:id/review` with expected assertion/endpoints revisions and reason; `GET /assertions/:id/history`. An accepted review publishes a minimal outbox event and link to its actual commit receipt in one transaction. Reads and derived diagrams apply source/party permissions; do not reveal hidden parties through tooltips, graph labels or downloadable JSON.

AI can suggest a relationship only from an exact authorized clause and existing endpoint IDs; it cannot infer shared rights from adjacency, stair geometry or owner names. Validators and reviewer confirmation remain required. Deterministic forms work with AI disabled.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [registry.ts contracts](../../packages/contracts/src/registry.ts), [registry service](../../apps/web/lib/server/registry.ts) | Preserve existing allowed relation kinds; expose compatible reviewed-write adapter | Avoid semantic corruption | FND | RIGHTS assertions |
| [core identity](../../packages/contracts/src/spatial/core/identity.ts), [core source schema](../../packages/contracts/src/spatial/core/source-schema.ts) | Reuse reference validation/evidence inheritance boundaries | Stable graph semantics | RIGHTS read-only reuse | F0 |
| Proposed new `packages/contracts/src/usp/rights.ts` | Assertion/review/context-edge DTOs | Explicit semantics and states | RIGHTS | Common/port projection |
| Proposed new `apps/web/lib/server/usp/rights/{graph,assertions,review,routes}.ts`, `migrations/16-rights.ts` | Additive reviewed assertion store and graph projection | Unit-level relationships without duplicate geometry | RIGHTS | FND commit/access/audit |
| Proposed new `apps/web/features/usp/rights/{RelationshipsPanel,AssertionForm,RelationshipEvidence}.tsx` | Inspect/propose/review contextual relations | Exact-space UX | RIGHTS | UI selection/evidence slots |
| [QuickRecords.tsx](../../apps/web/features/studio/product/QuickRecords.tsx), [RegisterPage.tsx](../../apps/web/features/officer/register/RegisterPage.tsx) | Mount Relations context | One register | UI | RIGHTS leaves |
| Proposed new `tests/usp-rights.test.ts`, `tests/usp-rights-integration.ts`, `tests/e2e/usp-rights.spec.ts` | Graph, evidence and reviewed-record tests | No inferred rights | RIGHTS | FND/FIND fixtures |

## G. UI placement and interaction

Quick register → choose Stair S1 → **Relations** → see “Serves Flat 101 and Flat 201” with claim/review labels → open supporting clause → **Propose correction** or **Request evidence**. Full register gives the same relationship list plus versioned review history and a small accessible relationship diagram/list. Selecting a beneficiary highlights its exact space in the existing map; camera remains under the shared controller.

Default view shows a short human-readable relation, not a dense graph. Expand evidence/party details only when permitted. Empty says “No relationships supplied,” not “Private space.” Unknown geometry, conflicting claims and incomplete traversal have distinct labels. Loading/review failures preserve the draft form. Denied evidence is not exposed through graph export. Accepted review shows its technical receipt and any still-open conflict. RIGHTS owns leaf content; UI owns parent tabs, map highlights and mobile drawer layout.

## H. Agent ownership and dependencies

Use `feat/usp-rights`. F0 permits graph/validation fixtures; F1 is required for real assertions and review receipts. HISTORY read port is consumed when available; absence does not justify invented old relations. FND owns changes to existing registry enums/validators/transactions and any shared adapter. UI owns shared map and parents. FIND/PACK/IMPACT consume documented projections, not direct writes into RIGHTS tables. Keep cross-site/general-solid work outside the initial scope.

## I. Implementation sequence

1. Adapt existing shared-use/easement/serves/floor relationships without changing their meaning.
2. Define supported new assertion kinds and endpoint/evidence rules; add same-site fixtures including duplex and access cycles.
3. Implement additive assertion/review storage and atomic accepted receipt through FND.
4. Expose minimal downstream context ports; test that unreviewed claims cannot clear findings or broaden packets automatically.
5. Build Relations UI and exact-space highlight callbacks; UI mounts them.
6. Run live proposal/review/revision scenarios with party/source restrictions and conflicting claims.

## J. Acceptance criteria and verification

Demo a shared stair serving two floors, one duplex spanning two floors, a terrace restriction claim and a basement crossing with unresolved extent. All use stable spatial identities and cited clauses. A conflicting exclusive claim remains visible beside shared-use evidence. Reviewing it cannot alter geometry or confer official ownership. The same stair appears once, not once per linked flat.

Test unauthorized source/party details, cross-site endpoints, stale review, duplicate relation, valid access cycle, invalid containment cycle, missing evidence, superseded assertion, failed transaction and packet-context expansion. An accepted relationship update invalidates dependent FIND/PACK projections by their input digest; no event-only assumption.

Run `pnpm typecheck`, `pnpm test:registry`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-identity.test.ts tests/usp-rights.test.ts`; `pnpm exec tsx tests/usp-rights-integration.ts`; `pnpm exec playwright test tests/e2e/usp-rights.spec.ts`. Return exact before/after assertion/receipt evidence, negative authorization tests and UI captures.

## K. Copy-paste agent assignment

> Implement RIGHTS on `feat/usp-rights`. Read the index/shared contracts, this handoff and the existing registry relation validators/core evidence rules. Build the proposed additive assertion/review/graph modules and tests; preserve the current `serves` semantics rather than expanding legacy enums independently. Reuse spatial IDs, require exact cited clauses and keep claim/review/authority distinct. FND owns reviewed registry adapters; UI owns shared register/map mounts. Supply documented context projections to FIND/PACK/IMPACT and consume real HISTORY only when available. Run section J including access-cycle versus containment-cycle cases and live reviewed receipts. Return commits, schema/adapter needs, test evidence and limitations; no main merge without authorization.
