# 11 · Evidence readiness and actionable review queue

Owner **READY**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md) and UI placement in [99](99-ui-ux-and-integration.md). New paths are implementation tasks. ER-05/19/24 are incorporated here; no separate audit interpretation is needed.

## A. User outcome and product value

Allow an officer to see whether an exact building/floor/unit can proceed to a named technical step, understand what is missing, and open the right source/request/workspace. A building's usable exterior must not hide a unit's missing internal boundary. The useful feature is evidence-to-action, not an unexplained confidence score.

## B. Current implementation and gap analysis

[readWorkQueue](../../apps/web/lib/server/work-queue.ts) combines case/import/dataset metadata, distinguishes recorded history from a current fingerprint and paginates work. [workItemAction](../../apps/web/lib/work-queue.ts) supplies destinations; [WorkQueue](../../apps/web/features/officer/work/WorkQueue.tsx) polls while visible. [Dossiers](../../apps/web/lib/server/officer.ts) expose missing evidence/checks; [core values](../../packages/contracts/src/spatial/core/scalars.ts) preserve unknown/withheld/conflicting. Extend these, not a second task board. A file count or successful extraction is not completeness.

Implement the concrete policy below, exact aggregate populations and working next actions. Existing current-only metadata is insufficient for a version-pinned assessment without FND's manifest adapter.

## C. Scope and non-goals

READY0 supports per-target reasons for V0. READY1 adds six dimensions, one scope summary and matching filtered queue. No public auth or LLM is needed for local operation. FIND/CITIZEN may be absent, but their absent assessments/actions must remain explicit. No legal safety badge, owner/household risk score, new permanent navigation or source facts inferred from presentation meshes.

## D. HLD and end-to-end flow

Selected target/scope → FND immutable manifest and permitted evidence projections → pure policy evaluator → persisted assessment with dependency pins → strip/detail/queue → open exact missing input or evidence request → new source/review produces a new assessment. Expensive scope aggregation uses bounded durable jobs. Never rescan all documents on each hover. Current mutation eligibility remains the existing server review validator, not this UI score.

## E. Targeted LLD

### Demonstration policy `technical-review-v1`

This is an application test policy, not a government documentary rule. Implement these tasks and requirements as versioned data; do not ask a model to invent them per property.

| Requirement | Qualifying input / failure action |
| --- | --- |
| R-ID | Stable namespaced target and valid relevant parent relationships; ambiguity → resolve target |
| R-SOURCE | At least one usable exact source-part link for each required fact; duplicate files do not add facts; absent link → attach/select source |
| R-XY | Supported valid polygon with a geometry-purpose source, named frame, units and any required placement transform; unsupported/missing → inspect plan or frame |
| R-Z | Supported lower/upper interval, lower < upper, named vertical reference and exact level evidence; floor label/storey estimate alone fails → supply level schedule |
| R-LINK | Required building/floor/parcel associations explicitly supplied/reviewed under this task; proximity alone does not establish rights association |
| R-CHECK | Completed applicable check set for the exact manifest, including required neighbours; absent/partial/stale → run or finish checks |
| R-REVIEW | Existing preparation/review receipt for exact manifest with blocking findings resolved and warnings acknowledged as required by the existing workflow |

Task definitions: `inventory_inspection` requires R-ID/R-SOURCE for a source row, not geometry. `exterior_3d_inspection` requires R-ID/R-SOURCE/R-XY/R-Z for a building representation; estimated height may support an explicitly estimated inspection but never a surveyed-height claim. `unit_technical_review` requires R-ID/R-SOURCE/R-XY/R-Z/R-LINK/R-CHECK for the supported unit. `record_submission` adds R-REVIEW and delegates final eligibility to the unchanged server commit checks. Global placement is required only when the selected task is map-relative; a documented local-frame plan can be inspectable without it.

Rights completeness is not automatically applicable to a geometric inspection. If a particular record task requires a right assertion, use a separately configured named requirement with exact evidence/review criteria; an absent real departmental policy does not get replaced by invented law. Human H2 qualifies real workflow terminology later, not code development.

### Dimensions and result model

`ReadinessAssessment` pins target, SnapshotScope, task, policy/version, required-item results, six dimensions, reasons, nextActions and evaluatedAt. Dimension states: ready, needs_input, needs_review, blocked, not_assessed, not_applicable, withheld; `currency:'current'|'stale'` is independent. Never map missing/denied provider to an empty check list.

| Dimension | Basis |
| --- | --- |
| Evidence coverage | Distinct applicable requirements with qualifying linked evidence, not file count |
| Geometry completeness | Supported XY/Z/reference for the selected task; display-only does not qualify |
| Association | Exact source/target/parent bindings and unresolved alternatives; no invented probability |
| Consistency | Current applicable check coverage and explicit contradictions; unknown is not no finding |
| Review | Exact submitted/checked/recorded receipts; recorded history is not current readiness |
| Freshness | Known supersession and supplied source dates; undated stays unknown, age alone is not invalidity |

Overall technical state: current blocking condition → blocked; required missing fact → needs_input; ambiguous/conflicting/review-required condition → needs_review; otherwise incomplete assessment → not_assessed; else ready for the task. Stale results cannot enable current record actions. Conflicting evidence is not the same as missing evidence. Withheld details/counts are suppressed unless a separately authorized aggregate policy permits them.

Coverage fields: qualifyingCount, applicableCount, unknownApplicabilityCount, policyVersion, denominatorEstablished. Return a fraction only when applicability is established and denominator > 0; otherwise null with not_applicable or unknown reason. A restricted requirement may produce a safe blocked/unknown status without disclosing its identity. Adding twenty duplicate deeds cannot increase qualifyingCount.

### Immutable aggregate and queue equality

Scope run pins an exact membership manifest, world/stage, access-view, policy, task and filter. Distinguish received targets, assessed targets, qualifying geometries, unresolved submissions, finding cases and affected targets. One finding with two participants is one case/two targets. Observed and synthetic populations are never mixed. Do not claim an entire ward's coverage from a received batch.

Each count returns an opaque `selectionToken` bound to its member set and filter. Clicking the count opens that exact queue; totals cannot be recomputed from newer live data behind the same token. Page size ≤100; bounded evaluation slices ≤100 targets, ≤200 evidence pointers per target. On truncation/budget limit mark incomplete and resume, never count skipped targets as ready. FND cursor/access rules apply; new data offers Refresh to a new manifest.

NextAction has typed actionKind, target/source refs, reasonCode, capability and rule-based effort category. Deterministic order: prerequisite blocking the chosen task, number of distinct targets unblocked, pending age, stable ID. Group a CRS question only for an explicitly shared source family. If CITIZEN is absent, link to the existing workspace rather than a dead Request evidence button.

### Storage/API

Proposed tables `usp_readiness_assessments`, `usp_readiness_scope_runs`; cache key includes manifest, target pin, policy/task, filter and access-view. Event invalidation is an optimization; exact dependency comparison is correctness.

Under `/api/v1/usp/readiness`, `POST /assessments` takes target or scope, task/policy and create guard and returns result or 202 job. `GET /assessments/:id` returns pinned result/currency. `GET /scopes/:scopeId/summary` requires manifest/task/policy. `GET /scopes/:scopeId/queue` requires selectionToken and bounded cursor. Shared envelopes/errors from 01 apply. All reads reauthorize. No scoring AI; explanations use deterministic reason templates or grounded restatement with the same facts.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing queue/dossier helpers linked in B | FND exposes exact read projections; READY consumes without replacing queue authority |
| Proposed `packages/contracts/src/usp/readiness.ts` | READY policy/result/action schemas using F0 types |
| Proposed `apps/web/lib/server/usp/readiness/{policy,evaluate,aggregate,service,routes}.ts`, `migrations/11-readiness.ts` | READY pure evaluation, manifest-based aggregates and leaf APIs; FND registers |
| Proposed `apps/web/features/usp/readiness/{ReadinessStrip,ReadinessDetails,ReviewQueue,ScopeSummary}.tsx` | READY leaf content |
| Existing WorkQueue, BlockPage and RegisterPage | UI sole owner mounts summaries/filters |
| Proposed `tests/usp-readiness.test.ts`, `tests/usp-readiness-integration.ts`, `tests/e2e/usp-readiness.spec.ts` | READY formulas, access, population equality and navigation |

## G. UI placement and interaction

Batches uses Needs attention / Ready for review / Recorded history with at most three task-qualified counts. Map has an optional readiness layer. Unit quick register says Boundary needed → detail → exact source/workspace/request. Full register reuses the detail. No universal green property badge. Text/icon distinguish not assessed from blocked. Loading keeps matching scope only; stale results are visibly stale; empty names the missing population; errors retain retryable work; permission failures disclose no hidden filenames. 99 owns camera/selection/focus/mobile sheet.

## H. Ownership and dependencies

Use `feat/usp-readiness`; own READY contracts/services/migration/leaves/tests. F0 fixtures first, F1-min real target evaluation, V0 before broad aggregate work. FIND and CITIZEN enhance only their actual outputs. No writes to their tables. FND/UI own all shared patches. Source-query policy/data acquisition is agent work; H2 confirms real rules later.

## I. Implementation sequence

1. Obtain D0 expected requirements from DATA, implement the fixed policy and pure evaluator.
2. Wire one real target's reasons and working source/workspace destination for V0.
3. Persist assessments against complete manifests; test source/relationship change without target revision change.
4. Add bounded scope jobs, frozen membership/selectionTokens and cursor equality.
5. Integrate optional provider results and UI mounts, preserving not_assessed states.
6. Recheck D4 missing-geometry inventory and D3 scale only after the exact D0 results pass.

## J. Data to use and verification

**D0:** DATA prepares a ten-parcel assessment variant: six qualifying geometries, two missing placement and two not assessed. This is a dedicated small fixture, not a mandate to enlarge the V0 hero scene. A geometry summary shows 6/10 for the named received population, while overall record readiness may differ. Add one two-parcel case (one case), duplicate evidence (coverage unchanged), a source-only unit, unknown applicability and a restricted part. Card target IDs must equal the full paginated list's IDs, even when a concurrent import adds an eleventh target.

**D4:** retrieve/preserve the [DDA inventory](https://dda.gov.in/sites/default/files/Housing_Department/list_of_flats_and_garages_dda_premium_housing_scheme_2026.pdf). Recheck first-page row C-01-3 against visible columns. Inventory inspection may be ready while exterior/unit geometry is unavailable. Do not infer Block C, a polygon, ownership or completeness from it. Unreachable/permission-unclear source → D0 equivalent; leave real-source gate unpassed. **D3 after completion (24 September 2026):** use [H00's geography-independent real corpus and sparse-source cohorts](00-README.md#4-data-packs-acquire-before-implementing-against-imaginary-inputs). Test bounded, snapshot-consistent aggregation/count-to-queue membership across the real load ladder, including source-only records, missing height and unresolved associations. No locality prerequisite; incomplete candidates must not become ready surveyed units or disappear from the received-population denominator.

Test zero/unknown denominator, absent provider, stale check, source supersession, wrong-world/cross-scope cursor, permission revocation, duplicate source, cross-building flat labels, rapid A→B selection, assessment worker restart and aggregate limit. Existing recording checks must still reject stale/invalid work even if an old readiness object says ready.

Run `pnpm typecheck`, `pnpm test:studio`, `pnpm test:registry`; proposed `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-readiness.test.ts`, `pnpm exec tsx tests/usp-readiness-integration.ts`, `pnpm exec playwright test tests/e2e/usp-readiness.spec.ts`. Return manifests, expected/actual counts, queue target sets, real next-action navigation and screenshots per 00. Test-plan existence is not an assessment pass.

## K. Copy-paste assignment

> Implement READY on feat/usp-readiness using 00, 01 and this file. Obtain D0 ten-target truth and attempt D4 real rows; implement technical-review-v1 exactly, then live per-target reasons and matching aggregate/queue membership. Preserve task-specific unknown/withheld/stale states and absent-provider behavior. UI/FND own shared mounts/adapters; do not create another task board or score engine. Complete the visible missing-fact→source/request action and run J through actual services. Return pack/hash, formulas, exact queue/count evidence, screenshots and commits; flag real-domain qualification separately. No legal clearance, guessed geometry, mocked completion or unauthorized main merge.
