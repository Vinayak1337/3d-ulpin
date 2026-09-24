# 16 · Shared spaces, access relationships and vertical rights

Owner **RIGHTS**. Historical baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 24 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), [26](26-identifiers-and-standard-exchange.md), [28](28-data-acquisition-and-finale-tests.md), compatibility rules in [12](12-rights-aware-spatial-findings.md), packet applicability in [10](10-scoped-evidence-packets.md), and [99](99-ui-ux-and-integration.md). ER-05/06/11/13/24 are incorporated. New code paths are implementation tasks.

## A. User outcome and product value

Allow an authorized user to inspect which defined stairs/corridors/terraces/basements serve which units, view the supporting clause and propose/review a correction. One shared stair is one space with multiple beneficiaries, not duplicated geometry. A duplex remains one identity across floors even when its per-floor outlines differ. Conflicting claims remain reviewable rather than silently replacing one another.

## B. Current implementation and gap analysis

[Registry contracts](../../packages/contracts/src/registry.ts) contain ownership_claim/shared_use/easement and within/floor/serves/crosses. [Registry validation](../../apps/web/lib/server/registry.ts) currently allows serves from a space to a building, not arbitrary stair-to-unit relations. [Geometry checks](../../services/geo/geo/registry.py), [core identity](../../packages/contracts/src/spatial/core/identity.ts) and [source-link policy](../../packages/contracts/src/spatial/core/source-schema.ts) supply reusable constraints, not a complete reviewed access graph.

Implement an additive versioned assertion/context store with exact geometry/evidence references and atomic technical acceptance receipts. Do not expand a legacy enum independently, treat party strings as a verified-person registry or infer rights from physical adjacency.

## C. Scope and non-goals

Required: read compatible existing relations, propose/review named new assertions among existing supported spaces within one site, preserve conflicts/history, inspect evidence, and supply explicit context projections to FIND/PACK/IMPACT. For `finale_v1` GF2/GF3, add declaration-scoped UDS and limited-common context with exact sources and revisions. Current relations remain readable while GF1 identity split/merge is implemented; accepted declaration allocations must use exact current identities.

No legal adjudication, emergency-egress certification, inferred equal ownership shares, private indoor navigation, cross-site title consolidation or measured easement corridor from text alone. General solids/federated scopes are separate qualification. Unknown extent remains a retained claim with no analytical geometry.

## D. HLD and end-to-end flow

Select unit/shared space → read exact relationship manifest → inspect cited source → propose assertion with endpoint pins/extent/validity → validate and review → FND same-client technical acceptance → store immutable assertion revision/receipt/outbox → dependent views refresh → open same affected spaces and scoped clauses. Compatibility finding and accepted-record status are separate results.

## E. Targeted LLD

### Assertion and spatial representation

`RightsAssertion`: stable ID/revision, SnapshotScope, endpoint target pins, kind (ownership_claim/shared_use/access_via/easement_claim/restriction_claim), stated exclusivity (exclusive/shared/unspecified), evidence pointers, exact extent representation refs or unresolved extent, stated validity interval or unknown, origin/classification, permitted party reference/display, proposed/under_review/accepted/rejected/clarification_required state, supersedes/supersededBy and actual receipt. Default legacy exclusivity to unspecified unless the source explicitly states it. Do not infer exclusive title merely from a category label.

Keep containment, floor occupancy, physical access and rights assertions separate. Cardinalities allow many beneficiaries and multiple parcels/floors with explicit relations. A duplex references distinct per-level components with real lower/upper limits; no union-footprint × full height or connecting volume through a void. FND's geometry bridge must preserve every component in exact snapshots; incompatible simple-ring legacy mirrors stay unavailable. Before qualified component analysis, show the supplied identity/relations/source and analytical capability unsupported. Never give each component a new ownership identity just to fit storage.

Fractions are represented only when supplied with definition and source. Unknown validity cannot be assumed always current. Self edges and incompatible endpoint kinds fail. Containment must be acyclic; access graphs may legitimately cycle. Context traversal is bounded to 200 visited nodes and depth 8; report incomplete coverage rather than silently truncating affected units. Initial cross-site endpoint requests return unsupported_scope; no fabricated common site.

Keep three separate spatial layers: (1) source-preserved physical components such as building shell, roof, floor, basement, bridge or utility; (2) proposed/recorded legal-space extents with their own evidence, validity and vertical limits; (3) display or planning volumes. A legal apartment or easement can use multiple disjoint per-level components, including elevated or underground portions, but a physical intersection alone creates no right. Each component pins horizontal frame, local metres, Z reference/benchmark, transform/version, lower/upper limit or explicit unknown, geometry role, source and quality. Incompatible or missing vertical references remain unassessed. `potential_development_space` may be computed from a qualified planning envelope and built volume, with FSI ratio and remaining permissible floor area in m² kept distinct; it is never labelled air right. An elevated right or transferable development instrument requires a separately sourced, reviewed jurisdiction-specific assertion. [Reviewed source on AAI planning conditions](https://nocas2.aai.aero/nocas/CCZMMAP.html).

### Declaration-scoped undivided-share ledger

`ShareDeclaration` is a revisioned sourced instrument, not a calculated property attribute: declaration ID, jurisdiction/statute, instrument/source revision and locator, effective/recorded dates, amendment/supersession links, allocation subject (land interest, general common property, limited common property, or stated other), complete declared unit population and explicit `populationStatus` (`complete`, `partial`, `unknown`, `conflicting`), share basis (`declared_value`, `declared_area`, or source-defined other), stated allocation denominator and rounding, review status and exact target pins. Do not silently convert value-based shares into area shares or derive them from mesh/footprint. Different allocation subjects and declarations never share a denominator by convenience.

Each `ShareEntry` carries one declared unit's stable UUID/project code when assigned, literal source label, exact fraction as positive integer numerator/denominator (arbitrary precision, normalized only for arithmetic), source locator, validity and review state. A missing, duplicate, cancelled or retired unit must be diagnosed against the declaration's effective date and lineage, not silently dropped or double-counted. Use rational sums to avoid floating-point drift. A 100% reconciliation check applies only when the declared unit population and allocations for that precise subject and effective revision are complete; otherwise return `not_assessed_incomplete_population` with known subtotal and missing/ambiguous members. Distinguish a true 99.5% total in a complete declaration from a partial extract that happens to total 99.5%. Freeze any source rounding/tolerance and independent oracle before evaluation; never force a sum to 1 by adjusting the last entry.

An amendment is a new sourced revision linked to the prior declaration, with its own effective date, reviewed approval and retained old entries. Do not overwrite the prior allocation or retroactively apply the new denominator to an old property card. The Maharashtra Apartment Ownership Act provides a declaration/value basis and contemplates registered amendment; its details must be checked for the actual jurisdiction/instrument before a legal conclusion. A `LimitedCommonAreaAllocation` links one shared-space identity, exact clause and its beneficiaries/use conditions; **one-unit limited common area is valid** when the instrument reserves it for one apartment. “Common” does not imply two or more beneficiaries. Land share, general common-property interest, limited-common use and physical access are separately projected, so a parking bay, stair or terrace does not accidentally become a share of land. [Reviewed source: Maharashtra Apartment Ownership Act](https://maharashtra.gov.in/Upload/PDF/Maharashtra%20Apartment%20Ownership%20Act%201970.pdf).

The officer sees declared fraction, basis, instrument/revision, population coverage and arithmetic result before recording a finding or exporting a card. PACK receives only the target's share and authorized applicable context under the exact manifest; sibling deeds/party data remain excluded. The CityJSON sidecar in H26 carries these assertions and their provenance, while plain geometry export records them as omitted. Neither a rendered common area nor an AI-suggested clause can approve a share.

### Authority and same-client acceptance

Tables `usp_rights_assertions`, `usp_rights_reviews`, `usp_rights_commit_links`, `usp_rights_applicability` and proposed declaration/share/allocation revisions store versioned claims and review receipts, not copied property geometry. Existing compatible relations flow through existing registry draft/commit validation. New space-to-space assertions use the separately versioned technical assertion store; they do not masquerade as supported legacy RegistryLink values. One projection indicates each assertion's authority origin to avoid double-counting a compatible migrated relation. FND registers additive migrations and exact snapshot pins for declaration, entry, amendment and beneficiary revisions.

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

Downstream port returns `ServiceResult<{inputManifestId,relationships,assertedRights,declaredShares,allocationCoverage,applicableContext,unresolved,coverage}>`. FIND consumes claims and supplied compatibility inputs; PACK consumes reviewed target-specific declaredShares/applicableContext; IMPACT consumes allowed affected endpoint refs. Missing port is not empty graph. A relationship, declaration/amendment or applicability change invalidates the complete dependency manifest even without geometry/property revision change. HISTORY contributes prior revisions when available, not an invented timeline.

### API and access

Prefix `/api/v1/usp/rights`: `GET /targets/:ref/relationships` with SnapshotScope; `GET /targets/:ref/declared-shares` with exact declaration/coverage; `POST /assertions` with create guard, endpoints/kind/evidence/extent; `POST /assertions/:id/review` with update guard/current manifest/reason; `POST /assertions/:id/withdraw` creates reviewed superseding state; `GET /assertions/:id/history`; `POST /applicability` with reviewer/target/clause/path/purpose/version guard; reviewed declaration create/amend commands with complete-population and exact-source guards. Use 01 envelopes and exact reference codec. Source, party, diagram labels and downloads all reauthorize. Public output requires an explicit ReleaseDecision; a technically accepted claim is not automatically public.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing registry contracts/validator and core references linked in B | FND compatible same-client mapping/geometry bridge, never independent enum change |
| Proposed `packages/contracts/src/usp/rights.ts` | RIGHTS assertion, declaration/share, applicability, review and downstream projection schemas |
| Proposed `apps/web/lib/server/usp/rights/{graph,assertions,declarations,review,applicability,routes}.ts`, `migrations/16-rights.ts` | RIGHTS additive versioned assertion/declaration store and leaf handlers; FND registers |
| Proposed `apps/web/features/usp/rights/{RelationshipsPanel,AssertionForm,RelationshipEvidence}.tsx` | RIGHTS relation/evidence/forms |
| [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx), [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), shared map | UI mounts Relations within existing context, no permanent extra app |
| Proposed `tests/usp-rights.test.ts`, `tests/usp-rights-integration.ts`, `tests/e2e/usp-rights.spec.ts` | RIGHTS cardinality, component, clause, transaction and disclosure tests |

## G. UI placement and interaction

Quick register → Stair S1 → Relations → beneficiaries → cited clause → propose correction/request evidence. Show short readable relationships before any graph. Selecting a beneficiary highlights its exact ID; one stair mesh remains. Full register expands evidence/history in the same contextual section. Missing graph says no relationships supplied, not private ownership. Unknown extent, conflicting claim, denied source, partial traversal and superseded revision have different labels. Review errors retain the draft. UI owns camera, focus and sheet; RIGHTS owns leaf contents.

## H. Ownership and dependencies

Use an isolated branch from the verified staging head; own RIGHTS modules/migration/tests only. GF0 fixtures then GF2 actual acceptance/geometry references and GF3 governance checks. Current relationships work during GF1 lineage implementation, but accepted shares refer to exact current unit pins. FIND/PACK/IMPACT read documented ports, not mutate this store. FND owns shared transaction/registry/geometry adapters; DATA packs; UI parents. Real clause applicability remains a pilot qualification; a fictional demonstration must be labelled and cannot prove a real property interest.

## I. Implementation sequence

1. Adapt existing relation semantics and source IDs; create explicit unknowns where metadata is missing.
2. Obtain D0 stair/duplex/claim fixtures; implement endpoint, validity, exclusivity and cycle rules.
3. Persist assertion/review with FND same-client receipt; test rollback and concurrent reviews.
4. Add sourced declaration population, rational shares, amendments and one-unit limited-common allocation; implement reviewed applicability and downstream projections, invalidating dependent manifests.
5. Mount exact-space/evidence UX via UI; demonstrate one geometry serving multiple units and one valid limited-common area serving one unit.
6. Test qualified physical/legal elevated and underground per-level components through actual persistence; then attempt permitted matched Indian clauses for real-source evaluation.

## J. Data and acceptance tests

**D0 from H28:** STAIR-S1 serves U-A101 and another supplied floor's unit. Include shared clause SHARED_STAIR_CONTEXT, an unrelated sibling deed, conflicting explicit exclusive claim, missing validity, access cycle and invalid containment cycle. DUPLEX-D1 has unequal per-floor outlines and an empty region between them. Assert one semantic ID and exact components retained; either qualified compound analysis or explicit unsupported result, never a filled envelope. A text-only basement crossing retains unresolved extent.

**GF-T16 independent ledger fixture:** freeze the complete declared unit population and hand-calculated rational shares. Include one complete 99.5% allocation that must raise a scoped arithmetic review finding; a distinct partial population with a 99.5% known subtotal that must remain unassessed; duplicate and missing unit labels; value-based versus area-based instruments; stated rounding; one amended declaration with retained earlier effective period; one valid limited-common parking or terrace allocation benefiting exactly one apartment; and separate land/common/use allocations. Exercise a source clause that remains unapproved and must not enter a card. Record instrument hash, jurisdiction, population count, numerator/denominator and independent subtotal/expected status. H28 owns the central GF-T16 receipt and permitted real-source qualification.

**GF-T18 spatial negative cases:** explicit legal basement/elevated extent, physical-only roof/utility, different vertical datums, non-overlapping duplex components, a legitimate atrium and contained unit versus incompatible exclusive units. Assert no inferred air right, no legal right from physical intersection, and unavailable analytical geometry when a component or Z operation is missing. The complete source inventory and qualified solid profile are prerequisites for a partition-residual claim; see [27](27-domain-ai-and-cadastral-checks.md).

**After local completion, D5:** obtain permitted matching plan/section/shared clauses from [RERA 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831) or [2079](https://haryanarera.gov.in/view_project/project_preview_open/2079), or a consenting institution. Previous attachment access was not qualified. Recheck tower/unit, clause applicability, dates, geometry and permissions; do not collect unrelated personal data. Missing clauses → D0 fallback and unpassed real-rights qualification.

Test stale endpoint/source/applicability, duplicate command, superseded/withdrawn assertion, two reviewers, cross-site request, private parties in graph/tooltips/JSON, unavailable HISTORY, and failed transaction before receipt. PACK must exclude the sibling deed even after an accepted shared relation; FIND must not clear overlap merely because an easement was accepted technically. Reopen the same relation and sources after restart; dependent results must become stale on relation-only change.

Also test stale declaration/amendment population, concurrent review of the same instrument, rollback between share write and receipt, source-revision mismatch, retired/changed unit pins and scoped share export. A share check cannot silently pass when the population or denominator is unknown. Historical cards must retain the then-current declaration revision; changed applicability alone stales the packet.

Run `pnpm typecheck`, `pnpm test:registry`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/core-identity.test.ts tests/usp-rights.test.ts`; `pnpm exec tsx tests/usp-rights-integration.ts`; `pnpm exec playwright test tests/e2e/usp-rights.spec.ts`. Return assertion/receipt before-after pins, component round-trip, packet-inclusion and permission evidence plus actual UI captures. No synthetic clause proves legal applicability.

## K. Copy-paste assignment

> Implement RIGHTS for `finale_v1` using 00, 01, H26, H28 and this handoff. Reuse D0 stair/duplex/claim truth and qualify a permitted matched Indian declaration where available. Preserve legacy relations and one identity across component geometries. Build versioned assertions, exact evidence/validity/exclusivity, declaration-scoped rational UDS, complete-population checks, amendments and valid one-unit limited-common allocation. Keep physical, legal and planning volumes distinct; an elevated volume is not an inferred transferable air right. Review and commit through FND's same-client transaction. Supply FIND/PACK/IMPACT projections with explicit unknown states; no blanket inheritance or ownership inference. UI owns shared Cesium scene/parents, DATA independent pack oracles. Complete GF-T16 and relevant GF-T18 plus J's rollback/stale/component/clause/access tests; return source hashes, independent sums, receipts and screenshots with capability limits. Do not invent legal rights or merge main without authorization.
