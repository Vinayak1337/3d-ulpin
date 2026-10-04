# Small worker tasks and current queue

Use with [ORCHESTRATOR.md](ORCHESTRATOR.md). Each task below becomes one short assignment with an exact base/worktree, resource owner and return destination. The integration worker updates this board after returns; detailed historical results stay in their existing handoffs.

**Current mode, 4 October:** this lead personally authored the prompt and cleanup decisions. Product/ML delivery remains paused. Do not dispatch the tasks below until resumed. The mistakenly delegated ORCH-PLAN-01 returned stopped and clean, with no new files, commits or branch; its unused checkout remains because the app refused archival under pinned-task/workspace protection.

## Queue

| Task | State | Dependencies | Worker / effort | Next usable result |
| --- | --- | --- | --- | --- |
| D01 Runtime | parked | resume; preserved runtime/checkpoints | runtime / xhigh | One normal source-to-result API path |
| D02 Source scope | parked | resume | data / high | One supported building/source context, explicit unresolved links |
| D03 API/scene contract | parked | resume | contracts / xhigh | Exact existing endpoints/fields for the first UI journey |
| D04 First journey | parked | D01–D03 | backend / xhigh | Import/extract → cited review → saved read-back |
| D05 Mapping agent | parked | D02/D03; usable import path | backend / xhigh | Constrained mapping and manual fallback |
| D06 Label cohort | parked | D02; eligible annotation route | data / high | Grouped, independently reviewed development/evaluation data |
| D07 Domain baselines | parked | D06; frozen comparison | model / xhigh | Measured building/plan candidates using existing models |
| D08 Document/link baseline | parked | D04; eligible reviewed examples | backend/model / xhigh | Cited fields and explicit candidate building/floor links |
| D09 Geometry | parked | D02/D03; source frames and levels | geometry / xhigh | Supported reviewed prism/vector qualification |
| D10 Identity/exchange | parked | reviewed identity inputs; D09 for geometry export | backend / xhigh | Existing P3 flow and nonempty supported CityJSON |
| D11 Governance | parked | applicable D04/D09 outputs and source instruments | backend / xhigh | Readiness and supported checks with honest gaps |
| D12 Card | parked | reviewed record/evidence; applicable D10/D11 outputs | backend / high | Existing exact-revision card/QR connected to journey |
| D13 Studio integration | parked | selected API slice; frontend resume scope | Claude frontend | One live slice, then candidate/review/card consumption |
| D14 Rehearsal | parked | selected integrated D04–D13 scope | integration / high | Recorded journey and evidence-backed claims |

There is no requirement to finish all formats, train a new model or obtain complete geometry before D04. D06/D07 may proceed independently of D09/D10. Formal GF0–GF5 acceptance still follows the release manifest; the board does not waive it.

## How to allocate the first work

On resume, use one runtime/integration owner for D01, one data owner for D02, and one contracts owner for D03 if all three have separate resources. These are responsibilities, not three mandatory new chats. D03 returns contract gaps to the next backend owner; it does not generate another report of every API. As soon as D01–D03 provide the necessary slice, prioritize D04 over new format breadth. Start D06 preparation alongside it where label policy allows. D09 and D05 can proceed in parallel only with distinct assigned seams; otherwise serialize their shared writes. D07 owns the GPU only for its bounded model run. D13 goes to the existing frontend owner once the selected live API is usable. No fixed worker cap and no filler assignments.

Prepare each assignment from current accepted code, not only this text. The integrator records a compact row per active task: owner chat, worktree, accepted base, owned paths/resources, state, returned commit/result and next action. Use this file in place; do not create a status file or orchestration tree for each attempt.

## Dispatch prompts

### D01 — Reuse a working runtime

Read retained successful runtime handoffs and inspect `scripts/platform-health.sh`, `scripts/platform-smoke.py`, `scripts/platform-restart-verification.py`, `scripts/usp/desktop-prefix-runtime.mjs` and their actual environment scope before invocation. Reconcile running processes, populated storage and accepted revision. Use existing startup; fix only a reproduced blocker. Return one unchanged-source API/worker/result/read-back journey, one relevant retry, exact served revision and owned start/stop commands. No reseed, volume reset, blind dispatcher launch, default OS migration or reboot campaign.

### D02 — Choose source-supported scope

Reuse `docs/api/real-sources.md`, both dataset catalogues, D1/D4/D5 manifests and `docs/evidence/usp/association-crosswalk/review.md`. Select one actual supported context; distinguish property identity, drawing-set relationship, local placement and survey accuracy. GMDA sectors plus Haryana Tower 3 are not automatically a matched building. Preserve G+41/G+42 conflict. Return a short field/source/location/revision table and named gaps; use separate foreign software-integration evidence if Indian placement is unsupported. No invented join, new broad source hunt or automatic permission claim.

### D03 — Reconcile the consumer contract

Read `docs/api/openapi.json`, `apps/studio/src/local/routes.ts`, `packages/scene/src/types.ts`, existing area/register/snapshot services and `packages/contracts/src/{spatial/core,usp}`. For the first journey list exact API, auth, IDs/revisions, wire fields, frame and errors. Add only a demonstrated missing record-backed projection; no universal replacement schema, new registry or blanket `/canonical` routes. Preserve current idempotency/access contracts. Return a precise frontend handoff; frontend edits belong to Claude.

### D04 — Complete the first source-to-record journey

Reuse existing import, extraction, source-fusion, association proposal, registry amendment/review and cited-read paths in `packages/server/src/modules`. Fill the smallest missing connection. Use one supported retained input and one incomplete/conflicting input. Prove the exact source opens, reviewed result persists, and unsupported links remain unresolved. Start or extend one small API journey runner: scoped writes/idempotency, read-back by default, explicit partial status. Do not require all other formats or geometry. Return a usable API action and integrated contract changes, not another capability inventory.

### D05 — Connect constrained mapping

Reuse `packages/contracts/src/usp/adaptive-mapping.ts`, `packages/server/src/modules/usp/ingestion/adaptive-mapping*.ts`, `chunk-mapping*.ts`, the canonical conversion registry and model gateway. Complete one actual supported unfamiliar layout through proposal → review → deterministic execution. Keep manual mapping useful during outage. Mapping output contains permitted operations/source references, not arbitrary executable factors/coordinates. Label replay as integration evidence, not semantic accuracy. Report useful coverage and errors on the checked sources. No new gateway or background learner.

### D06 — Establish labels and splits

Follow `delivery-reset-20261004/ML_DATA_PLAN.md`. Inventory unique retained originals, not repeated crops/pairs as independent examples. Pilot annotation classes/ambiguity/effort on development data. Establish eligible independent labels and group by site/building/template/revision before splitting. Keep training, development/calibration and final evaluation distinct. Return manifests and coverage limitations; do not invent labels, move old development items into a new holdout or claim team labels are official. Escalate only a real label-acceptance-policy decision for the dependent claim.

### D07 — Measure existing domain models

Reuse `services/geo/ml-models.json`, `services/geo/geo/spatial_ml.py`, `packages/server/src/modules/spatial/spatial-ml.ts` and T061 evidence. Use production preprocessing and one pinned reusable offline environment. On eligible development data, measure building masks and plan rooms, per class/site, false positives, omissions, polygonization error and correction effort. Freeze any final comparison before holdout access; development results choose whether to adapt. One GPU owner. Return useful source-pixel candidates through existing batch/review paths. No automatic OCR scale, wall snapping, legal-unit inference, training-overlap claim or new harness hierarchy.

### D08 — Extract and link useful document facts

Reuse the current native/OCR/fusion/citation readers and `source-fusion-associations.ts` / document-association authorities. Compare exact/regex extraction with one suitable pretrained model only where needed. Propose literal floor labels, values, units, citations and conflicts. Candidate links use scoped IDs and supported references; name/overlap/count compatibility alone does not accept identity. Measure retrieval separately from ranking, wrong-building/wrong-floor accepts and useful abstention. Keep rejected values in results with reasons. No speculative fragment-support fitting.

### D09 — Close one geometry qualification path

Own the shared geometry seam exclusively. Reuse `usp/geometry.ts`, existing frame contracts/`core_frames.py`, native admission and SQL qualification authority. Support one actual vector/prism profile with reviewed polygons, levels, units and applicable references. Distinguish structural validity, reference accuracy and analytical eligibility. Missing datum/limits remain unknown; preserve holes/components. Return one qualified supported flow and one clear unsupported flow. Do not weaken guards to serialize a shape or wait for ML when vector evidence is sufficient.

### D10 — Reuse identities and complete exchange

Reuse `usp/project-identity.ts`, identity contracts and `usp/exchange.ts`. Connect supported identity lifecycle to reviewed records; official parcel ULPIN remains sourced. For D09-qualified geometry, emit actual CityJSON vertices/semantics plus provenance/rights sidecar and loss report. Validate the declared schema/LoD and supported round trip. No reimplementation of the allocator, second identity authority, invented dimensions or requirement that all identity work wait for segmentation.

### D11 — Connect supported governance

Reuse existing declarations, readiness, findings and impact services. Add only missing consumers/quantity operations for the selected source-supported scope. Carpet components, share instruments, sanctioned/as-built matching and coverage need their actual evidence; room masks and review clicks do not supply it. Return explainable results or `not_assessed`/`not_comparable`, preserving exact source/revision and access. Unknown survey coverage does not authorize invented no-survey polygons or a clean-to-dig claim.

### D12 — Connect the existing card

Reuse `packages/server/src/modules/usp/packets/{plan-service,card-service,card-projection,card-render-profile}.ts`, packet/PDF contracts and `/usp/property-cards/...` routes. Assemble only evidence actually supported for the selected target/revision. Keep unknowns visible and private authorization current; verify exact resolver and scoped evidence exclusion. Return one card/read-back flow. No new CardPlan store, alternative QR resolver or copied sibling evidence; no claim that existing building/floor scope already qualifies every unit case.

### D13 — Hand the selected live slice to Claude

Follow existing frontend ownership, `docs/frontend/GOAL.md`, `PLAN.md` and the UI skill. Reconcile auth/current data/errors before switching the selected routes from local to live. Use generated client contracts and a pure scene adapter; preserve saved URLs and unreplaced local state. First consume D04, then the relevant candidates, identity and card. Return a real browser journey and concrete backend defects. Backend workers do not take over frontend work implicitly.

### D14 — Rehearse and record claims

Extend the D04 journey, reusing accepted results. Record exact live, retained, replayed, failed and not-run steps, times and real source scope. One compact claims table connects every presented capability to measured evidence; missing requirements remain open. Prepare a short startup/recovery/runbook and hand off presentation assets if requested. No whole-system rerun after every feature, destructive reset-to-demo, or release pass from a partial script.

## Integration return

For every accepted task, the integration worker confirms exact owned commits and a clean/coordinated staging window, integrates only those changes, runs relevant checks once, republishes changed API contracts when needed, and updates the board. Report `integrated` only with an actual staging commit and usable scope. Completed planar/raster branches, experimental ML and the published review branch retain their current status until specifically selected; do not merge them just because they exist.

## Parked checkpoints and later product work

- **Fragment-support fine-tuning:** coordinator `21bef00a`, learner `393f058f`; preserve the learner's uncommitted `scripts/usp/learning/association/test_fragment_rank_balance.py` and `services/geo/geo/usp_learning/association/fragment_rank_phase_adapter.py`. STUDENT-45 failed at runtime copying before training; prior completed experiments also missed quality targets. These are different failure categories. No automatic STUDENT-46 resume, checkpoint discard or promotion.
- **Completed leaves:** planar `6d94edac` and raster/point `de7855a3` remain in their owned worktrees. Select only when D04 or another concrete journey needs them; reuse their completed checks.
- **Later ML:** a measured D07/D08 development gap may justify one pretrained-model adaptation or fine-tune after adequate eligible examples, fixed task metrics and grouped splits. Use the ML/data plan's sequence; no automatic teacher/learner chain, protected-test tuning or training based only on a small loss improvement. Domain perception and document-to-building/floor association remain separate tasks.
- **Full product after the selected finale journey:** constrained schema learning/mid-import handover (H21), additional formats needed by users (H25), privacy-separated public requests (H13), grounded assistance (H18), renderer/scale/deployment and separately authorized generative preview. Scope each from its release gate and demonstrated user need. Do not silently delete these goals or let them block the first useful journey.

Unknown vertical reference remains unknown, not `building_relative` by default. Scene adapters preserve holes, literal levels and source units; a projection does not replace canonical registry contracts. D14 reuses accepted evidence and identifies actual remaining GF-STREAM/GF-SCALE-1, privacy, source and officer/browser requirements rather than declaring the entire release passed from one successful script.
