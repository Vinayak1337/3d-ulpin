# TASK-ID — task title
Status: Draft / Ready / In progress / Blocked / Accepted
Plan revision and date:
Base commit, branch, working-tree state:
Owner and reviewer:
Parent epic, release and legacy requirements:

## 1. Outcome and exclusions
State one observable user/system outcome. State what this task must not change.

## 2. Current evidence
List exact inspected files/ranges and affected runtime/data samples. Separate current observations, historical reports and assumptions. Name the first real consumer of every new API/module.

## 3. Dependencies and protected invariants
List accepted prerequisite tasks and their evidence. Name IDs, hashes, geometry, quantities, frame metadata, compatibility, privacy and workflows that must survive. Link applicable EC and original acceptance IDs.

## 4. Design and alternatives
Describe proposed data flow, ownership and dependency direction. Explain the smallest viable approach and rejected alternatives. Reference an ADR for significant decisions. List exact uncertainty and the experiment or explicit unsupported boundary that resolves it.

## 5. Affected files and contracts
| File/module | Existing role | Proposed change | Consumers/regression risk |
|---|---|---|---|
Document runtime schema, API error/revision behavior, storage writer, worker and UI-session changes where applicable. Do not invent paths that have not been checked.

## 6. Data and failure lifecycle
Explain receive/validate/write/review/publish/cancel/retry where applicable. Cover idempotency keys, duplicates, concurrent revisions, partial storage failure, permissions, resource bounds and history. State which operations are transactional and which are not.

## 7. Tests and independent expected results
| Case | Fixture/input | Expected output or invariant | Test layer | Actual command/evidence |
|---|---|---|---|---|
Include happy, boundary, negative, malformed, missing, partial, retry/concurrent and relevant visual/device cases. Define tolerances and measurement semantics. Write tests/oracles before deterministic logic where practical. Commands must come from inspected tooling, not guesses.

## 8. Step-by-step implementation
Order small changes and checks. Identify stop conditions before consequential steps. Separate pure refactor, behavior, migration and rollout. Define handling of pre-existing failures.

## 9. Migration, rollout and recovery
Rehearse upgrade/restore if data changes. Identify feature flags, fallback consumers, minimum compatible versions and failure handling. A Git revert is not a database rollback. Mark genuinely inapplicable sections explicitly.

## 10. Acceptance and evidence
Name the Definition of Done, reviewers, required user visual decision, evidence formats and remaining limitations. All checks remain planned until executed on the stated revision/environment.
