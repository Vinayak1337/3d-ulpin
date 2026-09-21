# 11 · Evidence readiness and actionable review queue

Owner **READY** · Priority **P1** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · Read [shared contracts](01-shared-contracts-and-ownership.md). This extends an existing workflow; all new DTOs/endpoints are proposals.

## A. User outcome and product value

Allow an officer to see which exact properties can proceed to a defined review step, which facts remain unsupported, and the smallest useful next action. A floor-level readiness view is more useful than a building-wide average that conceals one disputed unit. The differentiator is evidence-to-action at vertical-space granularity; the dashboard itself is a supporting capability.

Synthetic example: Building A has a supported exterior and three listed floors, but Flat 201 has no placed boundary. The building is not labelled universally “green.” Its exterior task can be ready while Flat 201 says “Boundary placement needed”; selecting that reason opens the correct plan/workspace or evidence request.

## B. Current implementation and gap analysis

[readWorkQueue](../../apps/web/lib/server/work-queue.ts) already combines case/import/saved-dataset metadata, paginates 20 items and distinguishes recorded history from a current recorded fingerprint. It explicitly leaves exact eligibility to the workspace. [workItemAction](../../apps/web/lib/work-queue.ts) maps these states to concrete destinations. [WorkQueue](../../apps/web/features/officer/work/WorkQueue.tsx) polls every 15 seconds while visible. Reuse its purpose; do not replace the existing queue with a second disconnected task board.

[Building dossiers](../../apps/web/lib/server/officer.ts) expose evidence, missing conditions and checks; [core value states](../../packages/contracts/src/spatial/core/scalars.ts) preserve unknown/withheld/conflicting. [useBlock](../../apps/web/features/officer/block/useBlock.ts) suppresses stale finding geometry. Missing: a versioned evidence-requirement policy, dimension-specific readiness, scope-aware denominators, cross-feature deduplication and precise “what would resolve this?” actions. File count and a successful ML job do not establish evidence completeness.

## C. Scope and non-goals

Implement a read-only computed assessment for building/floor/space targets, one area/batch summary, a filtered review queue and contextual next actions. Assessments must include input pins, policy version and limitations. Start with an explicitly named **technical review policy**; do not invent government documentary requirements.

No opaque combined AI score, owner/household risk ranking, legal safety badge or inferred missing geometry. No new permanent navigation item. CITIZEN evidence requests and FIND results are optional provider ports initially; unavailable providers produce `not_assessed`. Ordinary processing health belongs in batch diagnostics, not the officer's primary property summary.

## D. HLD and end-to-end flow

Officer opens batch/map scope → server resolves permitted revision-pinned targets → pure evaluator applies policy to evidence/geometry/check projections → response provides dimensions, blockers and action candidates → map/list shows compact readiness → selecting a reason opens the exact property/source/request → input change invalidates affected assessments.

Use lazy bounded evaluation for a property and resumable/materialized scope evaluation for a large area. Never synchronously scan all documents for every map hover. A stale cached assessment stays visibly stale and cannot enable a recording action.

## E. Targeted LLD

### Assessment and policy

Proposed `ReadinessAssessment` fields: target/scope, policy ID/version, input fingerprint, evaluatedAt, dimension results, required-item results, limitations and `nextActions`. Each required item specifies fact/purpose, applicability rule, minimum source/review condition and a deterministic resolver action. A policy is configuration reviewed for the intended workflow, not inferred per request by an LLM.

| Dimension | Inputs and interpretation | Missing/limited behavior |
| --- | --- | --- |
| Evidence coverage | Required applicable fact items with qualifying source links divided by all applicable required items | Unknown applicability yields partial assessment; zero applicable items is `not_applicable`, not 100% |
| Geometry completeness | Qualified footprint, named frame, vertical interval and required internal boundary for the selected task | Unplaced or absent boundary is unavailable; illustrative geometry never counts |
| Association | Exact identifiers/validated part bindings, reviewed matches and unresolved alternatives | Ambiguous source-to-target match remains ambiguous; no invented probability |
| Consistency | Latest applicable FIND/legacy checks, contradictions and their input pins | Missing checks=`not_assessed`; changed inputs=`stale`; no findings on partial coverage is not clear |
| Review state | Submitted/checked/recorded projection with exact workflow/revision evidence | A completed extraction is not reviewed; recorded history is not current-record readiness |
| Freshness | Source/revision supersession and policy age rules, where a dated source exists | Undated evidence=`unknown`; old alone does not imply invalidity |

Each dimension state is `ready`, `needs_input`, `needs_review`, `blocked`, `not_assessed`, `not_applicable` or `withheld`. Return supporting item IDs/reason codes, not only colour. Overall display follows a documented precedence: current blocking finding → blocked; required missing/ambiguous item → needs input/review; incomplete assessment → not assessed; otherwise ready **for the named technical step**. Withheld information must not leak through counts; an authorized aggregate projection may instead report “additional restricted review required.”

Coverage is a descriptive fraction, not legal confidence. Keep `qualifyingCount`, `applicableCount`, `unknownApplicabilityCount`, `policyVersion`; compute the fraction only when its denominator is established. Do not weight 20 duplicates of one deed more highly than one valid fact source.

### Scope summary and next actions

Scope metrics name their population: “received parcels in batch B at digest D,” not “entire ward.” Store/report supplied expected-population count separately if available, with its source. Distinct target count, checked target count, pending submissions and distinct open finding cases use separate units. A finding touching three objects is one case and three affected objects; do not mix these in the same total. Synthetic and observed worlds have separate denominators.

Next-action candidates carry `actionKind`, target/source refs, reason, required capability and estimated effort category (`simple`, `specialist`, `unknown`) with its rule basis. Rank deterministically by blocking prerequisite first, number of **distinct affected targets** the action can unblock second, age of pending action third, stable ID last. These are workflow ordering rules, not property risk scores. Group a coordinate-reference question only across an explicitly shared source family; do not mass-apply it across unrelated sources.

### APIs, storage and recomputation

Proposed under `/api/v1/usp/readiness`:

| Endpoint | Behavior |
| --- | --- |
| `POST /assessments` | Target/scope/policy + idempotency; returns current assessment or 202 scope evaluation job |
| `GET /assessments/:id` | Authorized, pinned assessment and staleness metadata |
| `GET /scopes/:scopeId/summary` | Required world/digest/policy; counts and coverage definitions |
| `GET /scopes/:scopeId/queue` | Cursor, bounded page size ≤100, allowed status/reason filters; deterministic action ordering |

Proposed `usp_readiness_assessments` keyed by target pin + scope digest + policy version + access-view class; `usp_readiness_scope_runs` tracks resumable aggregates. Never use a cache computed under a broader permission set for public output. Event-triggered invalidation may accelerate updates, but exact digest comparison remains the correctness check if an event is missed. Use an injected optional `evidenceRequests` port for a next action; when unavailable, offer an existing workspace destination instead of a dead upload button.

No AI is needed for scoring. An optional plain-language explanation must restate deterministic reasons with references, not generate missing requirements or override state. READY does not record properties; it links to the existing review flow, which revalidates eligibility.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [work-queue.ts](../../apps/web/lib/server/work-queue.ts), [client actions](../../apps/web/lib/work-queue.ts) | Consume preserved metadata through adapter; keep historical/current distinction | Extend existing work model | FND adapter; READY consumer | F1 |
| [officer.ts](../../apps/web/lib/server/officer.ts), [core scalars](../../packages/contracts/src/spatial/core/scalars.ts) | Read dossiers and reuse explicit missing states | No fake zero/default certainty | READY read-only reuse | Target/evidence ports |
| Proposed new `packages/contracts/src/usp/readiness.ts` | Policy/result/action schemas | Stable evaluable dimensions | READY | Common refs/ports |
| Proposed new `apps/web/lib/server/usp/readiness/{policy,evaluate,aggregate,service,routes}.ts` | Pure computation, scoped caching and API | Deterministic ready/unknown results | READY | FND read/access/jobs |
| Proposed new `apps/web/lib/server/usp/readiness/migrations/11-readiness.ts` | Assessment/run tables | Resumable large-scope work | READY | FND registry |
| Proposed new `apps/web/features/usp/readiness/{ReadinessStrip,ReadinessDetails,ReviewQueue,ScopeSummary}.tsx` | Compact dimensions and actionable queue | Shared map/register/batch use | READY | UI slots |
| [WorkQueue.tsx](../../apps/web/features/officer/work/WorkQueue.tsx), [BlockPage.tsx](../../apps/web/features/officer/block/BlockPage.tsx), [RegisterPage.tsx](../../apps/web/features/officer/register/RegisterPage.tsx) | Mount summaries/filters, not duplicate page | Coherent workflow | UI | READY leaves |
| Proposed new `tests/usp-readiness.test.ts`, `tests/usp-readiness-integration.ts`, `tests/e2e/usp-readiness.spec.ts` | Formulas, permissions, staleness and navigation | Reproducible outcomes | READY | Synthetic fixtures/F1 |

## G. UI placement and interaction

Within `/studio/work` show **Needs attention / Ready for review / Recorded history** as contextual filters, preserving existing processing information. A chosen scope can show up to three compact counts with an explicit denominator and a “View work” action. `/studio/areas/:areaId` exposes an optional **Evidence readiness** layer, not an always-on multicolour map.

Select building → quick register → select Flat 201 → readiness strip “Boundary needed” → details show source/placement deficiency → **Open plan** or **Request evidence** → later refresh after review. Full register exposes all dimensions and linked reasons. Gray/patterned “Not assessed” is distinct from red “Blocked”; icons/text supplement colours.

Loading shows the previous scope's data only if still matching the selected digest; otherwise show skeleton labels. Empty scope says no received properties, not zero risk. Failed assessment has retry and last-known stale timestamp. Denied dimensions are non-disclosing. Partially processed areas show assessed/received counts; ready is always qualified by its task label. UI owns map legend and parent mounts; READY owns evaluator-driven content.

## H. Agent ownership and dependencies

Use `feat/usp-readiness`. Pure policy/evaluator/leaf components may start after F0 with absent-provider fixtures. F1 is required for actual counts and permissions; FIND/CITIZEN supply enhanced checks/requests when integrated. READY must not write their tables or fabricate substitute results. UI alone changes shared map state, route filters and WorkQueue parents. FND alone modifies existing services/migration registration. A working mocked dashboard is not completion.

## I. Implementation sequence

1. Define one named technical policy and synthetic cases with complete, absent, conflicting, unknown and withheld data.
2. Implement pure dimension evaluation and deterministic actions; lock formulas and denominator tests.
3. Add target assessment endpoint and scoped caching; test invalidation on source, relationship, geometry and policy changes.
4. Add scope aggregation with stable pagination and resumable bounded jobs; wire optional ports explicitly.
5. Deliver quick-register/detail/queue components and UI integration requests.
6. Run live comparisons between listed targets, aggregate counts and underlying records; verify every actionable item opens the exact object.

## J. Acceptance criteria and verification

Demonstrate a synthetic batch with ten received parcels, of which six have qualifying geometry, two are missing placement and two are unassessed. Display those counts and an explicitly bounded geometry-completeness measure; do not label the ward 60% mapped. Add one finding shared by two parcels: case count remains one. Add a duplicate source: evidence coverage does not rise. Switch to a unit with missing boundaries: the building's ready exterior cannot make the unit ready.

Test zero denominator, unknown applicability, revoked access, mixed worlds, stale findings, provider offline, identity ambiguity, cross-scope IDs, concurrent updates and invalid filter/cursor reuse. Refresh must not briefly show a prior building's readiness as the new selection's state. Existing record actions still perform authoritative server validation.

Run `pnpm typecheck`, `pnpm test:studio`, `pnpm test:registry`; proposed tests via `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-readiness.test.ts`, `pnpm exec tsx tests/usp-readiness-integration.ts` and `pnpm exec playwright test tests/e2e/usp-readiness.spec.ts`. Capture metric inputs/outputs and complete action navigation in isolated services, not only snapshots of a card.

## K. Copy-paste agent assignment

> Implement READY on `feat/usp-readiness`. Read the index, shared contracts, this handoff and linked work-queue/dossier/core-state files. Own the proposed readiness contracts, evaluator/services/migration, leaf UI and tests; request FND/UI changes rather than editing shared parents. Build per-task evidence readiness, honest scope denominators and deterministic next actions, preserving unknown/withheld/stale states. Do not produce one unexplained confidence score or infer legal clearance. Integrate unavailable FIND/CITIZEN ports explicitly and connect real F1 records before claiming completion. Run section J tests, return formula fixtures, live aggregate checks, navigation screenshots, commits and unresolved policy qualifications; do not merge main without authorization.
