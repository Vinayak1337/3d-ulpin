# 12 · Explainable, rights-aware spatial findings

Owner **FIND** · Priority **P1** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · Prerequisites [F0/F1](01-shared-contracts-and-ownership.md).

## A. User outcome and product value

Allow an officer to inspect a possible parcel, road-boundary or vertical-space discrepancy with its exact affected geometry, sources, uncertainty and review action. This strengthens existing computed checks into a defensible review workflow; it does not automate legal findings.

Synthetic example: two spaces overlap in plan, but one is a basement and the other a first-floor flat. Their volumes do not overlap. A third example places a basement across a parcel boundary with a supporting easement claim: show the geometric crossing and its evidence, rather than calling every intersection encroachment. The vertical distinction is central to the product.

## B. Current implementation and gap analysis

[geo/registry.py](../../services/geo/geo/registry.py) already distinguishes context from competing spaces, checks explicit containment/floor/crossing links, and appends a no-ownership-conclusion warning to overlaps. It limits registry checks to 2,000 total records and 100 volumetric spaces; its query path rejects some hole-bearing intersections. Do not claim it already implements arbitrary-scale solid geometry.

[area_semantics.py](../../services/geo/geo/area_semantics.py) preserves geometry roles, source dates, approval text, horizontal uncertainty and explicit vertical references. [core geometry schema](../../packages/contracts/src/spatial/core/geometry-schema.ts) distinguishes recorded road land from road surface and display-only shapes. [officer-investigations.ts](../../apps/web/lib/server/officer-investigations.ts) already stores investigations with pinned snapshots and rejects stale checks. Reuse this case-management path, rather than creating a second investigation system.

Missing: a unified finding projection across existing checks, explicit applicability/coverage, uncertainty-aware classification, rights/context explanations, stable cross-chunk pair deduplication and targeted review at unit/level scope. These are proposed improvements, not evidence that baseline checks determine ownership.

## C. Scope and non-goals

First release supports qualified planar polygons and vertically extruded prisms in compatible frames. Include parcel–parcel overlaps, supported structure–recorded-road-boundary differences, same-space competing claims requiring review, explicit containment/membership errors and vertical crossings with linked rights context. Keep physical geometry findings distinct from documentary contradictions.

No automatic enforcement, “illegal building” label, cadastral accuracy inferred from map pixels, general BIM solid intersection, or suppression of a finding simply because a party uploaded a purported easement. Unsupported geometry/uncertainty/reference systems yield an explicit unassessed result. Enhanced rights context waits for RIGHTS; base checks use existing relationships without inventing additional rights.

## D. HLD and end-to-end flow

Officer selects a scope and **Run checks** → API pins geometry/source/relationship revisions → existing job system runs bounded candidate generation and deterministic rule evaluation → persisted findings reference measured shapes and cited evidence → map highlights exact volume/level → officer opens or updates an existing investigation, requests evidence or changes a draft → rerun marks previous findings stale/superseded without deleting history.

Broad-phase spatial candidates may use PostGIS bounding boxes/indexes; narrow-phase computation uses supported local geometry. A candidate pair is not a finding until role, frame, interval and relationship rules are evaluated. Workers must load neighbour/context dependencies before declaring a scope assessed.

## E. Targeted LLD

### Finding contract and rule applicability

Proposed `FindingResult`: `id`, stable `caseKey`, `runId`, rule ID/version, participant target pins, input digest, semantic category (`geometry`, `records`, `relationship`), assessment state, measured result, uncertainty statement, evidence pointers, explanation reasons and next action. Human disposition is separate from the computed result: `open`, `under_review`, `explained`, `correction_proposed`, `resolved`, with actor/reason/revision. A disposition does not change source geometry or rewrite the original computation.

| Rule | Required inputs | Result/limitations |
| --- | --- | --- |
| Parcel overlap | Two supported recorded-parcel geometries in one qualified analysis frame | Positive-area intersection; boundary contact is separate. Overlap alone does not select the correct boundary. |
| Structure/road relation | Structure representation role and recorded road-land polygon, applicable date and compatible frame | Report measured crossing of that boundary; observed road surface alone is a different comparison and cannot establish recorded encroachment. |
| Vertical competing space | Two exclusive-space candidates, compatible vertical benchmark and valid prism geometry | Compute positive shared volume; normal parent/child containment is not competing ownership. Unknown exclusivity remains a review condition. |
| Shared/right-supported crossing | Crossing plus explicit linked shared-use/easement/restriction assertions and evidence | Show possible explanation and its review state. A claim never automatically clears a finding. |
| Document disagreement | Explicitly extracted/reviewed assertions about the same identified space and fact | Preserve both source statements; matching aliases alone cannot establish common identity. |
| Membership/containment | Validated `within`, `floor`, `serves`, `crosses` links | Reuse existing checks; distinguish topology errors from competing rights. |

For compatible prisms, `zOverlap = max(0, min(upperA,upperB)-max(lowerA,lowerB))`; `volume = area(intersection(footprintA,footprintB)) * zOverlap`. Preserve holes and multipart results through core-compatible geometry; do not flatten them to an exterior ring. If an existing worker cannot represent the result, return `unsupported_geometry` or use the new qualified module. Planar overlap without supplied heights is not positive 3D volume.

Separate numerical tolerance from survey uncertainty. Keep existing numerical epsilon for stable computation; it does not express measurement confidence. When source positional error bounds exist, report them and classify small-boundary discrepancies as `uncertainty_sensitive`. A conservative horizontal envelope may use the sum of supplied error bounds only when their meanings/units are compatible; call it an engineering bound, not a statistical probability. Missing accuracy metadata produces `uncertainty_unknown`, never assumed zero. Do not invent threshold metres or statutory setbacks.

### Persistence, identity and coverage

Proposed `usp_finding_runs` stores scope/filter/method versions, input manifest, dependency completeness and status. `usp_finding_results` stores deterministic results; `usp_finding_case_links` links a stable case key to existing investigation IDs. Case key hashes rule family + sorted semantic participant refs + spatial component identity where required; result key additionally pins revisions and algorithm version. Reruns can associate history without conflating different floors or different components.

Never use display mesh IDs or chunk IDs as property identities. Deduplicate boundary-spanning pairs globally for a run. Declare coverage as supplied object count, assessed count, skipped counts by reason and neighbour dependencies. Partial import produces `partial`, not `completed_clear`. A completed check of known inputs still does not establish completeness of real-world records.

### Proposed API

Under `/api/v1/usp/findings`: `POST /runs` takes scope, explicit rule set, expected digest and idempotency key; returns 202. `GET /runs/:id` exposes coverage/status. `GET /runs/:id/results` is cursor-paginated with allowed filters. `POST /results/:id/investigation` requires current input pins and creates/links an existing officer investigation through FND. `PATCH /cases/:caseKey/disposition` requires expected case revision, reason and supporting evidence when marking explained/resolved.

Do not add new finding results to an old investigation by rewriting its pinned snapshot. FND supplies a controlled adapter to append a linked assessment reference or create a follow-up investigation; legacy investigation types remain intact. READINESS consumes a minimal permitted projection, not full parties/documents. Public release is off by default.

AI is optional for explanation of deterministic reasons and supplied evidence. It cannot choose geometry, make legal conclusions or change severity/disposition. A deterministic template remains the fallback. All geometry, frame and source refs are validated before and after worker calls.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [registry.py](../../services/geo/geo/registry.py), [area_semantics.py](../../services/geo/geo/area_semantics.py), [core_geometry.py](../../services/geo/geo/core_geometry.py) | Reuse proven computations/semantic rules through wrappers | Avoid duplicate unqualified algorithms | FIND read-only reuse; FND shared hooks | Core contracts |
| [officer-investigations.ts](../../apps/web/lib/server/officer-investigations.ts) | Provide scoped link/follow-up adapter, preserve old snapshots | Reuse existing review history | FND | FIND case references |
| Proposed new `packages/contracts/src/usp/findings.ts` | Result, applicability, coverage and disposition schemas | Stable downstream projection | FIND | Common refs |
| Proposed new `services/geo/geo/usp_findings.py` | Qualified role-aware planar/prism rule engine | Handle explicit supported geometries | FIND | FND dispatch registration |
| Proposed new `apps/web/lib/server/usp/findings/{rules,service,routes}.ts` and `migrations/12-findings.ts` | Runs, fingerprints, dedup and investigation linkage | Recoverable deterministic results | FIND | FND DB/access/job ports |
| Proposed new `apps/web/features/usp/findings/{FindingPanel,FindingEvidence,CheckCoverage}.tsx` | Explanation, evidence and review actions | Exact-space review | FIND | UI overlay/selection slots |
| [FindingsTray.tsx](../../apps/web/features/officer/block/FindingsTray.tsx), [Issues.tsx](../../apps/web/features/officer/register/Issues.tsx), [Investigation.tsx](../../apps/web/features/officer/register/Investigation.tsx) | Mount new projections and context | One reviewer workflow | UI | FIND leaves |
| Proposed new `tests/usp-findings.test.ts`, `tests/usp-findings-integration.ts`, `services/geo/tests/test_usp_findings.py`, `tests/e2e/usp-findings.spec.ts` | Geometry/rights/staleness/flow tests | Observable result correctness | FIND | Fixtures and live services |

## G. UI placement and interaction

Area map → **Check** → contextual findings tray → choose result → selected property/floor and measured intersection appear → **Evidence** → **Open investigation** or **Request clarification**. Full register's Issues section uses the same finding panel. Show rule name, measurement with units, assessed coverage and one next action before secondary details. Explain “recorded road boundary” versus “observed road surface” in the evidence label, not only a tooltip.

Loading retains old results as visibly stale, never current. Empty reads “No finding in the assessed scope” with coverage. Missing Z values show a planar-only result, not a fabricated volume. Unavailable/denied source displays an appropriate safe state. Worker failure retains the prior run and supports explicit retry. A resolved investigation remains in history; recalculation may reopen review if new revisions materially change inputs. FIND owns panels; UI owns map overlay registration and shared camera/floor controls.

## H. Agent ownership and dependencies

Use `feat/usp-findings`. Work only in FIND modules/tests/migration. F0 supports pure fixtures; F1 is necessary for real scoped runs. RIGHTS can later enrich explanations through its port without changing the base evaluator. FND owns shared worker/API/registry patches; UI owns parent trays/maps. IMPACT may reuse FIND's qualified geometry adapter, but must not edit its code independently. Do not lift baseline geometry limits globally without measured qualification.

## I. Implementation sequence

1. Capture baseline rules and regression fixtures; define supported input matrix and unassessed states.
2. Build deterministic pair evaluation, role checks, numerical tolerances and explicit uncertainty metadata.
3. Persist pinned runs/results, deduplicate cross-partition pairs and expose bounded APIs.
4. Connect existing investigations via FND adapter; keep computed result and human disposition separate.
5. Provide UI panels/overlay data; integrate READINESS projection and optional RIGHTS context.
6. Run geometry edge cases plus live repeat/revise/review scenarios before claiming the check complete.

## J. Acceptance criteria and verification

Demo includes vertically separated identical footprints, positive-volume overlap, boundary-only contact, contained flat/building, basement crossing with unreviewed easement evidence, road-surface-only data and recorded-road-land data. Expected results must differ for the correct reasons. Add holes, multipart shapes, missing benchmark, negative basement levels, absent heights, unknown positional accuracy, duplicate pairs across chunks and a source revised during checking.

A result must cite exact sources and method, reopen the correct floor/unit, reject stale investigation linkage and preserve historical runs. Missing RIGHTS data cannot clear an overlap. A map colour cannot be the only status cue. No automatic legal conclusion appears in API/UI/report text.

Run `pnpm typecheck`, `pnpm test:registry`, `pnpm test:area`, `pnpm test:register-scope`; `python -m pytest services/geo/tests/test_registry.py services/geo/tests/test_usp_findings.py`; proposed TS tests via `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-findings.test.ts`, live integration via `pnpm exec tsx tests/usp-findings-integration.ts`, browser via `pnpm exec playwright test tests/e2e/usp-findings.spec.ts`. Return computed fixture measurements and actual investigation linkage evidence.

## K. Copy-paste agent assignment

> Implement FIND on `feat/usp-findings`. Read the index/shared contracts, this handoff, the linked registry/area/core geometry and investigation code. Preserve existing context-aware checks and build the proposed bounded findings modules, schemas, migration and tests. Distinguish positive volume, contact, containment, uncertain evidence and claimed rights; never turn overlap into a legal verdict. Consume FND target/access/jobs/investigation ports and provide UI overlay data rather than altering shared maps or routers. Test section J geometry and stale/partial-run cases through actual services. Return commits, method/coverage limitations, numeric fixtures, investigation history evidence and UI captures. No main merge without authorization.
