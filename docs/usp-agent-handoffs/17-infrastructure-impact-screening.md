# 17 · Infrastructure impact screening

Owner **IMPACT** · Priority **P3** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · Depends on [F1](01-shared-contracts-and-ownership.md) and [FIND's qualified geometry contract](12-rights-aware-spatial-findings.md).

## A. User outcome and product value

Allow a scoped engineer/officer to sketch a proposed excavation or elevated work envelope and identify **potentially affected mapped spaces, their evidence and remaining assessment gaps**. This extends an existing spatial query into a saved, reviewable planning screen. The benefit specifically comes from separating underground, surface and elevated interactions.

Synthetic example: a trench envelope intersects one basement, approaches a utility with a known profile and passes below an apartment. The result distinguishes positive-volume intersection, boundary contact and incomplete utility coverage. It does not claim that the route is safe to excavate or determine compensation.

## B. Current implementation and gap analysis

[SpatialInquiry.tsx](../../apps/web/features/officer/register/SpatialInquiry.tsx) already offers a vertical stack at a point and an excavation rectangle with local frame/benchmark labels. [registryQuery](../../apps/web/lib/server/registry.ts) and [geo/registry.py](../../services/geo/geo/registry.py) calculate point/volume intersections against bounded registry spaces. The Python query path supports at most 100 spaces and rejects some hole-bearing intersections. This is a useful existing foundation, not an absent feature.

[area_semantics.py](../../services/geo/geo/area_semantics.py) preserves explicit utility dimensions, levels and reference meanings. Missing: a persisted proposal revision, map-based envelope editing, clear coverage/unsupported-source results, source-pinned affected-space reports and a workflow for requesting missing engineering evidence. General mesh or arbitrary utility-solid collision is not assumed.

## C. Scope and non-goals

First release supports a saved planar footprint plus lower/upper bounds in a qualified local frame, point-stack inspection, existing supported registry prisms and appropriately qualified utility profiles. Keep the old numeric form available; map drawing is another input to the same validated contract.

No route optimization, structural analysis, utility locating certification, emergency safety advice, automatic permission issuance or legal damages calculation. Unsupported arbitrary solids and cross-site frame federation remain explicit future work. Empty results never mean “safe.” A user-entered work envelope is classified as proposed/hypothetical, not measured survey evidence.

## D. HLD and end-to-end flow

Area map → contextual **Assess proposed work** → draw or enter envelope → confirm units/reference and study scope → API pins proposal and source snapshot → bounded geometry screen → show affected spaces and assessment gaps → select a result to inspect exact floor/source → save report or request missing evidence. Editing the proposal makes the previous result visibly stale until rerun.

Reports store a reproducible input manifest. An area update does not silently change a previously saved screen; instead show newer source data available. Large candidate sets use existing jobs with FND hooks, not client-side loops over every mesh.

## E. Targeted LLD

Proposed `ImpactProposal`: ID/revision, actor, title, purpose, scope, frame/vertical-reference pins, supported footprint, lower/upper metres, classification `hypothetical|planned`, input source pointers if supplied and explanation of entered assumptions. Validate finite coordinates, valid rings/holes, bounds, lower < upper, frame compatibility and size/vertex limits inherited from the qualified geometry profile. Do not convert depth-below-ground to elevation unless a supported ground reference is available.

`ImpactRun` pins proposal revision, scope/world manifests, method/rule version, candidate set and coverage. Result classes: `positive_intersection`, `boundary_contact`, `potential_interaction_uncertain`, `not_intersecting_assessed`, `not_assessed`. For compatible prisms reuse FIND's footprint-area × positive shared-height calculation. Do not use display-only geometry. A boundary contact is not a positive volume, and a planar footprint alone cannot establish a 3D intersection.

Utility profiles need compatible level meaning, benchmark, cross-section and interpolation. Reuse existing qualified utility operations; a missing radius/diameter/height must not receive an invented buffer. A centreline crossing with missing depth is an assessment gap, not “no impact.” User-specified working clearance is a labelled scenario parameter with its basis, not an assumed legal clearance standard. Unsupported profiles remain in the gap list.

Coverage reports distinguish loaded area selection, known asset inventory, assessed assets and unknown inventory completeness. Source age/positional uncertainty are preserved as supplied. When no inventory completeness evidence exists, report that limitation even if every loaded asset was tested. RIGHTS may add linked shared/access beneficiaries; lack of that provider leaves rights-impact assessment unassessed rather than empty.

Proposed tables `usp_impact_proposals`, `usp_impact_runs` and immutable result manifests. No new canonical property geometry store. Proposed APIs under `/api/v1/usp/impact`: `POST /proposals`, `PATCH /proposals/:id` with expected revision, `POST /proposals/:id/runs` with snapshot/digest/idempotency, `GET /runs/:id`, `GET /runs/:id/results` cursor-paginated, and `GET /runs/:id/report`. Report generation can reuse PACK's manifest/permission conventions but must not depend on extracting every underlying document. Link authorized scoped evidence; never bundle the entire original utility survey by default.

Access requires `scope.assess` and read rights for participating resources. Restricted assets may require an approved aggregate warning rather than exposing coordinates/operators; do not report a count of zero when hidden assets prevent a complete answer. Proposal sharing is explicit, not public by default. AI may explain deterministic results with citations; it cannot select “safe” routes, invent measurements or grant approval.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [registry service](../../apps/web/lib/server/registry.ts), [registry.py](../../services/geo/geo/registry.py) | Preserve existing point/volume query, adapt qualified inputs/results | Reuse working logic and caps | FND wrapper; IMPACT consumer | F1 |
| [area_semantics.py](../../services/geo/geo/area_semantics.py) | Read supported utility-profile metadata | No guessed underground dimensions | IMPACT read-only reuse | FIND geometry adapter |
| Proposed new `packages/contracts/src/usp/impact.ts` | Proposal/run/coverage/result schemas | Reproducible screening | IMPACT | Common refs/FIND projection |
| Proposed new `apps/web/lib/server/usp/impact/{proposals,screen,report,routes}.ts`, `migrations/17-impact.ts` | Persist proposals and pinned screens | Recoverable review/report | IMPACT | FND jobs/access/storage |
| Proposed new `services/geo/geo/usp_impact.py` | Envelope-to-supported-profile adapter | Bounded engineering geometry | IMPACT | FIND qualified operations; FND hook |
| Proposed new `apps/web/features/usp/impact/{ImpactEditor,ImpactResults,ImpactCoverage}.tsx` | Numeric/drawn proposal and affected spaces | Map-context interaction | IMPACT | UI drawing/overlay slots |
| [SpatialInquiry.tsx](../../apps/web/features/officer/register/SpatialInquiry.tsx), [BlockPage.tsx](../../apps/web/features/officer/block/BlockPage.tsx) | Mount editor/results and retain numeric inquiry | One map/query experience | UI | IMPACT leaves |
| Proposed new `tests/usp-impact.test.ts`, `tests/usp-impact-integration.ts`, `services/geo/tests/test_usp_impact.py`, `tests/e2e/usp-impact.spec.ts` | Intersection/coverage/persistence tests | No false safety assurance | IMPACT | Isolated scenarios |

## G. UI placement and interaction

`/studio/areas/:areaId` → contextual tools menu → **Assess proposed work** → choose point stack or volume → draw footprint and enter vertical bounds → **Screen mapped records**. An adjacent panel shows affected spaces and **Not assessed** reasons before optional details. Selecting a basement result isolates that level through the shared map; selecting evidence opens the existing source drawer. Full register retains SpatialInquiry for its site.

Initial state explains required frame and bounds. Loading shows the pinned proposal, not moving source data. Empty results show “No intersection among assessed records” plus inventory coverage. Incomplete depth/frame data remains conspicuous. Error preserves the proposal for correction; denied resources show a policy-approved limitation. Success reports exact snapshot/proposal revision. No green “all clear” badge. UI owns drawing mode and camera; IMPACT owns editor/results, with keyboard numeric input as an accessible alternative.

## H. Agent ownership and dependencies

Use `feat/usp-impact`. Pure proposal/geometry fixtures can start after F0/FIND interfaces; live screening waits for F1 and qualified FIND operations. RIGHTS is optional only if absence is explicitly represented. FND owns shared query/worker hooks; UI owns drawing and map parent integration. Do not modify FIND algorithms independently or increase legacy site caps without qualification. Depend on PACK only for optional extract packets, not basic report availability.

## I. Implementation sequence

1. Wrap the existing numeric point/prism query with reproducible proposal/run schemas.
2. Add snapshot pinning, coverage/unsupported results and persistence before drawing UI.
3. Reuse qualified FIND geometry and utility adapters; test complete and incomplete profiles.
4. Deliver editor/results components and ask UI to connect shared drawing/selection.
5. Add report output and evidence-request links; verify permissions and stale revisions.
6. Run live saved proposal, edit, rerun and historical report scenarios.

## J. Acceptance criteria and verification

Use a synthetic trench touching one boundary, intersecting a basement and crossing a utility centreline whose depth is unknown; a first-floor unit remains vertically separate. Results must distinguish all four situations. Repeat with an elevated work volume. Alter the proposal or source revision: old results become stale, and rerun creates a new record rather than overwriting history.

Test negative elevations, invalid/zero-height envelope, holes, mismatched units/benchmark, missing utility dimensions, partial inventory, restricted assets, duplicate run requests, worker restart and source revocation before report download. No UI/API/report statement may imply an unassessed corridor is safe or authorized.

Run `pnpm typecheck`, `pnpm test:registry`; `python -m pytest services/geo/tests/test_registry.py services/geo/tests/test_usp_impact.py`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-impact.test.ts`; `pnpm exec tsx tests/usp-impact-integration.ts`; `pnpm exec playwright test tests/e2e/usp-impact.spec.ts`. Return numeric fixtures, coverage manifest, real saved-run/report evidence and UI captures.

## K. Copy-paste agent assignment

> Implement IMPACT on `feat/usp-impact`. Read the index/shared contracts, this handoff, FIND's geometry contract and existing SpatialInquiry/registry query code. Build saved, revision-pinned proposal screening in the proposed IMPACT modules, retaining the existing numerical form and explicit geometry limits. Reuse FND/FIND ports; UI owns drawing/map mounts. Keep unknown utility depth, incomplete inventory and restricted records explicit; never label a route safe or approved. Run section J actual geometry/persistence/permission tests and return measurements, manifests, screenshots, commits and supported-profile limits. Do not rewrite canonical geometry or merge main without authorization.
