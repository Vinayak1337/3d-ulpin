# MVP task graph and release gates

**These fifteen work tickets subdivide source Phases 1–2; they do not replace or reorder the six-phase baseline.** A ticket may contain smaller checkpoints; a model must not interpret one row as permission for unlimited autonomous work.

`depends_on` below means “needed to start this ticket’s named main work.” Some clients/domain tickets can start with frozen mocks; their additional **integration requirements** are explicitly listed. Such tickets cannot become integration-verified until their real producers exist. This distinction prevents a false dependency cycle while preserving real completion gates.

## Dispatch schedule

| Wave | Lead activity | Child work, with at most three live slots | Gate |
|---|---|---|---|
| W0 | T00, small T01 calibration decision | One finite research/extraction ticket and one feasibility/test helper only when needed | Actual environment/model/usage observations, or an explicit calibration stop. |
| W1 | T01; merge contract/fixtures; provide client shells | T03→T04 platform; T02 fixtures→T05 geometry; one bounded research ticket only if blocking | Runtime and supported computation work; contracts are common. |
| W2 | Connect results and review mechanisms; prepare integration | T06 intake; T07→T08 lifecycle as producers unlock; T09 web | Real source and preparation path; mobile is not blocked by web polish. |
| W3 | Integrate continuously; release slots promptly | T10 mobile; remaining T08/T09 work; targeted geometry/platform fixes | Same case/request/source IDs across clients and services. |
| W4 | T11; own critical fixes and final decisions | T12 verification plus assigned, nonconflicting fixes | Required evidence collected; unresolved gaps classified. |
| W5 | T13→T14 | At most one bounded verification helper | Runnable checkpoint, truthful status, human next tasks, stop. |

A freed slot does not automatically need a new worker. Research does not stay alive after the question is answered. Do not keep three feature agents busy while nobody can integrate their output.

## Implementation tickets

### T00 — Preflight and bounded calibration

**Owner:** O-LEAD  
**Start dependencies:** None; start here

**Work:** Inspect repository, available tools/models, source authority and allowance observations. Run the small calibration package: minimum schema example, startup/health probe and one independent prism calculation. No full parallel feature wave without a valid runtime/budget observation path.

**Deliver:** Preflight record, runtime/model map, baseline usage with window, reversible initial decisions and calibration evidence.

**Gate:** Environment/authorization blockers and unknown usage are explicit; an observed budget supports continuation or the run stops at calibration. No fabricated model or account telemetry.

### T01 — Freeze the small contract and path leases

**Owner:** O-LEAD  
**Start dependencies:** T00

**Work:** Publish source, inspection, geometry, finding, job, request/response and review envelope schemas needed for this slice, typed client boundary, standard error examples and server-owned fields. Record the proposed synthetic local-frame/profile choice.

**Deliver:** Schema-valid examples, contract version, dependency manifest, path leases and minimal repo skeleton.

**Gate:** Both TypeScript and Python can validate the shared examples; no competing mobile schema; later modules are not built as speculative stubs.

### T02 — Create coherent raw fixtures and independent expectations

**Owner:** C-VERIFY  
**Start dependencies:** T01

**Work:** Produce explicitly synthetic raw parcel-local JSON, PNG plan/reference grid, level/control CSV, r1/r2, source manifests and a separate second rectangle case. Keep clean seed without accepted records or fake findings.

**Deliver:** Actual fixture files, their hashes/provenance, independent area/volume/contact/overlap expectations and malformed examples.

**Gate:** Each boundary component maps to an attributable input; U03 error is unverified, r2 is a separate new source, and exact XY dimensions are labelled new synthetic choices.

### T03 — Deliver runtime, identity, database and guarded case template

**Owner:** C-PLATFORM  
**Start dependencies:** T01

**Work:** Make local services and schema/migrations runnable. Configure distinct identities, scope guards, initial project/case/assignment data access and one real guarded route. Supply platform shell interfaces before every service is polished.

**Deliver:** Environment template, bootstrap/health commands, migrations, development identity realm/configuration and guarded route tests.

**Gate:** Fresh services start; actor is authenticated; wrong-role/cross-project access fails; clients receive usable configuration without secrets.

### T04 — Deliver immutable storage and durable processing primitives

**Owner:** C-PLATFORM  
**Start dependencies:** T03

**Work:** Build staged upload/verified finalization/controlled read helpers and logical-operation idempotency. Implement application job record, durable dispatch, private controlled operation entry and repeat-safe completion; integrate only allowlisted profiles.

**Deliver:** Tested storage/job interfaces and a real sample processing round-trip with exact input fingerprint.

**Gate:** Partial or mutable originals cannot masquerade as finalized evidence; replayed/late jobs do not publish duplicate/newer state or accepted units.

### T05 — Implement the supported prism engine

**Owner:** C-GEOMETRY  
**Start dependencies:** T01, T02

**Work:** Implement metric/reference checks, simple-footprint construction, declared quantities and relationship-aware contact/overlap checks. Provide pure operation plus callable handler ready for T04 registration.

**Deliver:** Geometry code, profile declaration, attributable result schema and independent expected-test comparisons.

**Gate:** C-001 computes 6.4 m³ overlap and zero after correction; contact/containment are distinct; unsupported geometry/reference fails; second fixture works.

### T06 — Connect real source intake and basic inspectors

**Owner:** C-INTAKE  
**Start dependencies:** T02, T04

**Work:** Wire source APIs on trusted helpers; add selected local JSON/CSV/PNG inspectors and purpose-specific statuses. Register them through the lead’s service integration, not a second API.

**Deliver:** Real upload/finalize/list/detail/read endpoints, small processing adapters, error examples and focused tests.

**Gate:** The same uploaded source revision is inspected by a real worker and read by a permitted consumer; malformed/missing input and retries behave correctly.

### T07 — Persist candidates, evidence bindings and field requests

**Owner:** C-LIFECYCLE  
**Start dependencies:** T02, T03

**Work:** Implement revisioned candidates, four evidence components, minimum synthetic relationships, target requests/assignment/read/response interfaces and geometry-result ingestion. Consume T04/T05/T06 as they become ready; release stable mocks only until the real path is integrated.

**Deliver:** Candidate and evidence APIs/domain rules, source binding behavior, scoped response persistence and fresh-check linkage.

**Gate:** Before this ticket is integrated, real T04/T05/T06 results replace its mocks. Receipt never auto-binds/accepts; revisions and operation IDs are preserved.

### T08 — Implement exact review, identity and lookup

**Owner:** C-LIFECYCLE  
**Start dependencies:** T04, T05, T06, T07

**Work:** Implement fixed submissions, readiness and separate reviewer decision under tested project-wide relevant-mutation concurrency protection; publish stable prototype identity, history and accepted lookup.

**Deliver:** Review/registry endpoints, actual transaction/race tests and no-duplicate issuance behavior.

**Gate:** Self/wrong-role/cross-project/stale/concurrent decisions fail or retry safely; accepted identity persists; clean seed still has no acceptance.

### T09 — Build the linked web workflow

**Owner:** C-WEB  
**Start dependencies:** T01, T02, T03

**Work:** Build shell, source forms, linked tree/plan/Cesium views, manual supported edit, evidence/finding/request/review and lookup. Work against frozen mocks while endpoints are unfinished, then consume their actual responses. Split editor work into small internal checkpoints.

**Deliver:** Usable web workbench, shared-client integration, error states and browser interaction evidence.

**Gate:** Final gate requires real T05–T08 producers. A local scene is labelled synthetic; display transforms do not alter stored quantities; refresh/relogin preserves server records.

### T10 — Build the online native evidence and Team flow

**Owner:** C-MOBILE  
**Start dependencies:** T01, T03, T06, T07

**Work:** Build Expo sign-in, assigned tasks, authorized Team progress/assignment, attachment/note upload, retry-safe online response/receipt and basic lookup when available. Use actual network/issuer configuration.

**Deliver:** Native app code, build/run instructions, real request/source integration, emulator/device results kept separate.

**Gate:** The phone response is visible on web with matching IDs; no false offline or final-acceptance behavior. Actual device unavailable means that check is NOT_RUN, not passed.

### T11 — Integrate the one complete manual case

**Owner:** O-LEAD  
**Start dependencies:** T04, T05, T06, T07, T08, T09, T10

**Work:** Merge producer/consumer patches in dependency order, remove core mock transports, resolve contract drift and execute the clean-seed happy path with separate accounts. Keep API/service integration moving before the last client is finished.

**Deliver:** Integrated branch/checkpoint and reproducible source-to-accepted-record journey with request/snapshot IDs.

**Gate:** No stitched-together independent demos, hardcoded findings or preaccepted seed. A real persisted lifecycle exists; gaps remain visible.

### T12 — Run independent adversarial and cross-client checks

**Owner:** C-VERIFY  
**Start dependencies:** T11

**Work:** Execute the acceptance matrix against the integrated commit, controlled stale/duplicate/concurrency scenarios, web state checks and available actual Android flow. Return defects to assigned owners for targeted patches.

**Deliver:** Test evidence report with real commands/results, independent expectations, environment/device labels and defect ownership.

**Gate:** No unresolved required correctness failure is hidden; second simple case detects hardcoding; no claims based solely on screenshots or test names.

### T13 — Prove reproducible startup and classify release

**Owner:** O-LEAD  
**Start dependencies:** T12

**Work:** Run fresh isolated setup/seed and representative read/write lifecycle, verify persistence after service restart, review supported profiles and all acceptance evidence. Use existing environment-only resources; no public/paid deployment by implication.

**Deliver:** Tested README, environment/setup commands, MVP_STATUS with precise completion classification and known limitations.

**Gate:** Required outcomes are classified honestly. An actual-device or runtime gap prevents MVP_VERIFIED even if code/build checks pass.

### T14 — Prepare human continuation and stop

**Owner:** O-LEAD  
**Start dependencies:** T13

**Work:** Reconcile completed work against revised 03; create A/B/V next tickets with real file paths, entry points, prerequisites and acceptance tests. Record observed usage or unknown telemetry, resumable state and the smallest remaining MVP gap where needed.

**Deliver:** TEAMMATE_A_NEXT, TEAMMATE_B_NEXT, VINAYAK_NEXT, session state, usage ledger and final summary.

**Gate:** No teammate is asked to rebuild a completed capability; difficult core remains Vinayak’s responsibility. Stop at the scoped MVP or explicit partial checkpoint.


## Integration and failure rules

T07 requires T04/T05/T06 for final integrated evidence; T09 requires T05/T06/T07/T08; T10’s complete lookup uses T08. The lead can merge a safe intermediate endpoint or view before these dependencies finish, but labels it contract-ready/mock-ready/implementation-ready rather than integration-verified.

All authors write and execute focused tests for their own mechanisms. C-VERIFY provides independent checks, not a substitute for author testing. Shared-schema fixes return to the lead; ordinary implementation defects return to the assigned writer. The final budget reserve is primarily for T11–T14, but producer/consumer integration starts earlier.

If the budget/environment guard triggers before T13, create a **partial version of T14 immediately**, regardless of its normal dependency. Record the stopped graph, completed checkpoints and exact next ticket; do not wait to run out of context before making the work resumable. Never mark skipped T13 or T12 complete merely to satisfy the graph.
