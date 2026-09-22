# 16 · Shared spaces, access relationships and vertical rights

Owner **RIGHTS**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), compatibility rules in [12](12-rights-aware-spatial-findings.md), packet applicability in [10](10-scoped-evidence-packets.md), and [99](99-ui-ux-and-integration.md). ER-05/06/11/13/24 are incorporated. New code paths are implementation tasks.

## A. User outcome and product value

Allow an authorized user to inspect which defined stairs/corridors/terraces/basements serve which units, view the supporting clause and propose/review a correction. One shared stair is one space with multiple beneficiaries, not duplicated geometry. A duplex remains one identity across floors even when its per-floor outlines differ. Conflicting claims remain reviewable rather than silently replacing one another.

## B. Current implementation and gap analysis

[Registry contracts](../../packages/contracts/src/registry.ts) contain ownership_claim/shared_use/easement and within/floor/serves/crosses. [Registry validation](../../apps/web/lib/server/registry.ts) currently allows serves from a space to a building, not arbitrary stair-to-unit relations. [Geometry checks](../../services/geo/geo/registry.py), [core identity](../../packages/contracts/src/spatial/core/identity.ts) and [source-link policy](../../packages/contracts/src/spatial/core/source-schema.ts) supply reusable constraints, not a complete reviewed access graph.

Implement an additive versioned assertion/context store with exact geometry/evidence references and atomic technical acceptance receipts. Do not expand a legacy enum independently, treat party strings as a verified-person registry or infer rights from physical adjacency.

## C. Scope and non-goals

Required: read compatible existing relations, propose/review named new assertions among existing supported spaces within one site, preserve conflicts/history, inspect evidence, and supply explicit context projections to FIND/PACK/IMPACT. Current relations do not wait for optional split/merge writes or full HISTORY integration.

No legal adjudication, emergency-egress certification, inferred equal ownership shares, private indoor navigation, cross-site title consolidation or measured easement corridor from text alone. General solids/federated scopes are separate qualification. Unknown extent remains a retained claim with no analytical geometry.

## D. HLD and end-to-end flow

Select unit/shared space → read exact relationship manifest → inspect cited source → propose assertion with endpoint pins/extent/validity → validate and review → FND same-client technical acceptance → store immutable assertion revision/receipt/outbox → dependent views refresh → open same affected spaces and scoped clauses. Compatibility finding and accepted-record status are separate results.

## E. Targeted LLD

### Assertion and spatial representation

`RightsAssertion`: stable ID/revision, SnapshotScope, endpoint target pins, kind (ownership_claim/shared_use/access_via/easement_claim/restriction_claim), stated exclusivity (exclusive/shared/unspecified), evidence pointers, exact extent representation refs or unresolved extent, stated validity interval or unknown, origin/classification, permitted party reference/display, proposed/under_review/accepted/rejected/clarification_required state, supersedes/supersededBy and actual receipt. Default legacy exclusivity to unspecified unless the source explicitly states it. Do not infer exclusive title merely from a category label.

Keep containment, floor occupancy, physical access and rights assertions separate. Cardinalities allow many beneficiaries and multiple parcels/floors with explicit relations. A duplex references distinct per-level components with real lower/upper limits; no union-footprint × full height or connecting volume through a void. FND's geometry bridge must preserve every component in exact snapshots; incompatible simple-ring legacy mirrors stay unavailable. Before qualified component analysis, show the supplied identity/relations/source and analytical capability unsupported. Never give each component a new ownership identity just to fit storage.

Fractions are represented only when supplied with definition and source. Unknown validity cannot be assumed always current. Self edges and incompatible endpoint kinds fail. Containment must be acyclic; access graphs may legitimately cycle. Context traversal is bounded to 200 visited nodes and depth 8; report incomplete coverage rather than silently truncating affected units. Initial cross-site endpoint requests return unsupported_scope; no fabricated common site.

### Authority and same-client acceptance

Tables `usp_rights_assertions`, `usp_rights_reviews`, `usp_rights_commit_links`, `usp_rights_applicability` store versioned claims/review receipts, not copied property geometry. Existing compatible relations flow through existing registry draft/commit validation. New space-to-space assertions use the separately versioned technical assertion store; they do not masquerade as supported legacy RegistryLink values. One projection indicates each assertion's authority origin to avoid double-counting a compatible migrated relation.

Review checks expected assertion/endpoints/full dependency manifest and source association. Accepted technical revision, receipt with post-write pins, audit and outbox commit on the same PoolClient through `commitProposal(kind:'relationship')` in 01. FND registers the transaction handler; RIGHTS supplies feature-local transaction logic. A feature cannot call an independently committing registry wrapper inside its outer transaction. Failed writes leave no accepted receipt. Accepted assertions are changed/withdrawn through a new reviewed revision, not erased.

### Compatibility and document applicability

| Condition | Required treatment |
| --- | --- |
| Multiple shared-use assertions on one stair | Not inherently exclusive conflict; show beneficiaries and evidence |
| Exclusive assertion overlaps another explicitly incompatible assertion in the same defined extent and overlapping supplied validity | possible_incompatibility for review, not legal verdict |
| Different supplied non-overlapping validity periods | Temporal context, not assumed simultaneous conflict |
| Missing exclusivity/extent/validity | compatibility not_assessed; do not auto-clear or accuse |
| Purported easement supplied | Preserve claim/review status; cannot automatically clear a geometric crossing |
| Parent clause has no unit-applicability decision | Not automatically inherited into a unit packet |

`ApplicabilityDecision` pins clause/source part, selected target, relation path, purpose, validity, reviewer, policy and active/superseded state. PACK includes shared context only when this decision is current and authorized. A stair related to two units does not authorize either unit to receive the other's deed. AI may suggest a clause/link citing exact authorized text and existing endpoints; it may not approve applicability or release.

Downstream port returns `ServiceResult<{inputManifestId,relationships,assertedRights,applicableContext,unresolved,coverage}>`. FIND consumes claims and supplied compatibility inputs; PACK consumes reviewed applicableContext; IMPACT consumes allowed affected endpoint refs. Missing port is not empty graph. A relationship/applicability change invalidates their complete dependency manifest even without geometry/property revision change. HISTORY contributes prior revisions when available, not an invented timeline.

### API and access

Prefix `/api/v1/usp/rights`: `GET /targets/:ref/relationships` with SnapshotScope; `POST /assertions` with create guard, endpoints/kind/evidence/extent; `POST /assertions/:id/review` with update guard/current manifest/reason; `POST /assertions/:id/withdraw` creates reviewed superseding state; `GET /assertions/:id/history`; `POST /applicability` with reviewer/target/clause/path/purpose/version guard. Use 01 envelopes and exact reference codec. Source, party, diagram labels and downloads all reauthorize. Public output requires an explicit ReleaseDecision; a technically accepted claim is not automatically public.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing registry contracts/validator and core references linked in B | FND compatible same-client mapping/geometry bridge, never independent enum change |
| Proposed `packages/contracts/src/usp/rights.ts` | RIGHTS assertion, applicability, review and downstream projection schemas |
| Proposed `apps/web/lib/server/usp/rights/{graph,assertions,review,applicability,routes}.ts`, `migrations/16-rights.ts` | RIGHTS additive versioned store and leaf handlers; FND registers |
| Proposed `apps/web/features/usp/rights/{RelationshipsPanel,AssertionForm,RelationshipEvidence}.tsx` | RIGHTS relation/evidence/forms |
| [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx), [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), shared map | UI mounts Relations within existing context, no permanent extra app |
| Proposed `tests/usp-rights.test.ts`, `tests/usp-rights-integration.ts`, `tests/e2e/usp-rights.spec.ts` | RIGHTS cardinality, component, clause, transaction and disclosure tests |

## G. UI placement and interaction

Quick register → Stair S1 → Relations → beneficiaries → cited clause → propose correction/request evidence. Show short readable relationships before any graph. Selecting a beneficiary highlights its exact ID; one stair mesh remains. Full register expands evidence/history in the same contextual section. Missing graph says no relationships supplied, not private ownership. Unknown extent, conflicting claim, denied source, partial traversal and superseded revision have different labels. Review errors retain the draft. UI owns camera, focus and sheet; RIGHTS owns leaf contents.

## H. Ownership and dependencies

Use `feat/usp-rights`; own RIGHTS modules/migration/tests only. F0 fixtures then F1-feature actual acceptance/geometry references. Current relationships work without new lineage editing. FIND/PACK/IMPACT read documented ports, not mutate this store. FND owns shared transaction/registry/geometry adapters; DATA packs; UI parents. Real clause applicability H2 is a pilot qualification, not a blocker for explicitly authored demonstration policy.

## I. Implementation sequence

1. Adapt existing relation semantics and source IDs; create explicit unknowns where metadata is missing.
2. Obtain D0 stair/duplex/claim fixtures; implement endpoint, validity, exclusivity and cycle rules.
3. Persist assertion/review with FND same-client receipt; test rollback and concurrent reviews.
4. Implement reviewed applicability decision and downstream projections, invalidating dependent manifests.
5. Mount exact-space/evidence UX via UI; demonstrate one geometry serving multiple units.
6. Test qualified per-level components through actual persistence; then attempt permitted D5 clauses for real-source evaluation.

## J. Data and acceptance tests

**D0 from 00:** STAIR-S1 serves U-A101 and another supplied floor's unit. Include shared clause SHARED_STAIR_CONTEXT, an unrelated sibling deed, conflicting explicit exclusive claim, missing validity, access cycle and invalid containment cycle. DUPLEX-D1 has unequal per-floor outlines and an empty region between them. Assert one semantic ID and exact components retained; either qualified compound analysis or explicit unsupported result, never a filled envelope. A text-only basement crossing retains unresolved extent.

**After local completion, D5:** obtain permitted matching plan/section/shared clauses from [RERA 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831) or [2079](https://haryanarera.gov.in/view_project/project_preview_open/2079), or a consenting institution. Previous attachment access was not qualified. Recheck tower/unit, clause applicability, dates, geometry and permissions; do not collect unrelated personal data. Missing clauses → D0 fallback and unpassed real-rights qualification.

Test stale endpoint/source/applicability, duplicate command, superseded/withdrawn assertion, two reviewers, cross-site request, private parties in graph/tooltips/JSON, unavailable HISTORY, and failed transaction before receipt. PACK must exclude the sibling deed even after an accepted shared relation; FIND must not clear overlap merely because an easement was accepted technically. Reopen the same relation and sources after restart; dependent results must become stale on relation-only change.

Run `pnpm typecheck`, `pnpm test:registry`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-identity.test.ts tests/usp-rights.test.ts`; `pnpm exec tsx tests/usp-rights-integration.ts`; `pnpm exec playwright test tests/e2e/usp-rights.spec.ts`. Return assertion/receipt before-after pins, component round-trip, packet-inclusion and permission evidence plus actual UI captures. No synthetic clause proves legal applicability.

## K. Copy-paste assignment

> Implement RIGHTS using 00, 01 and this A–K file on feat/usp-rights. Obtain D0 stair/duplex/claim truth and later attempt permitted D5 clauses. Preserve legacy relation meanings and one identity across component geometries. Build versioned assertions, exact evidence/validity/exclusivity, reviewed applicability and same-client technical acceptance via FND. Supply FIND/PACK/IMPACT projections with unknown states; no blanket inheritance or ownership inference. UI owns shared scene/parents, DATA pack files. Complete J real-service rollback/stale/component/clause/access tests and return commits, receipts and screenshots with capability limits. Do not ask humans to design the graph, invent legal rights or merge main without authorization.
