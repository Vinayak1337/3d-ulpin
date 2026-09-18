# One-task-at-a-time execution playbook

## 1. What counts as a task
A task produces one coherent, reviewable outcome with a measurable pass condition. An epic is a planning group. A checklist item or commit is a step inside a task. A task that is too broad must be split before execution, using child IDs such as `T018.1`, while its original requirements and crosswalk remain attached to the parent.

The active task includes its planning, implementation, review and verification. Keep WIP=1 across those states. Do not start another domain's implementation while the current result is unverified. Read-only research/review may assist the same active task. A blocked task may be parked and an independent task selected only through a recorded dependency check, not by silently claiming completion.

## 2. Detailed plan before code
Use `templates/TASK_PLAN.md`. Replace generic assurances with concrete outcomes. The plan must record fresh code paths/base revision, the requested capability, excluded scope, affected consumers, schema/API/state changes, alternatives, protected invariants, data lifecycle, tests and test oracles, negative cases, migration/rollback and completion evidence.

Deep planning is proportional to risk. A typography correction does not require a database migration section beyond 'not applicable'. A new geometry/profile or snapshot writer requires explicit unit/frame, identity, transaction, failure and compatibility analysis. 'All edge cases handled' is not an acceptable statement; name the applicable cases, unknowns, unsupported bounds and regression strategy.

## 3. Definition of ready
A task becomes Ready only when prerequisites have accepted evidence; its scope and owner are clear; current code and environment have been inspected; source/fixture inputs are available or a bounded acquisition step exists; affected invariants and consumers are known; the test matrix has independent expected outcomes; the change and rollback boundaries are safe; and decision-blocking unknowns are resolved or isolated behind explicit unsupported states.

No implementation starts on a stale path assumption. A planning brief's `detail_plan_path` is not evidence that a detailed plan file exists. Task T001 is authored now but still needs environment validation.

## 4. Working loop
**Inspect → plan → challenge → test → implement → verify → review → accept.**

Inspect the actual code and affected data. Draft the plan and challenge it with a plausible wrong implementation: duplicate identity, wrong frame, late response, partial write, no documents, unsafe source or low-detail selection. Add the discriminating test/oracle. Make the smallest coherent implementation change and run fast checks. Exercise the real integration boundary, then inspect the diff and generated outputs. Fix failures inside the same task until its definition of done passes.

For an exploratory spike, write the decision question, competing hypotheses, fixed fixture, evaluation criteria and stop rule before running it. Record the result as a measured or unmeasured finding; do not let a spike automatically become production code.

## 5. Definition of done
The scoped behavior works through its real consumer; all applicable positive, negative, invariant and regression tests pass; any migration/upgrade/recovery obligations pass; no new blocker or silent data loss exists; review is recorded accurately; documentation/contracts match implemented behavior; and the result includes exact commit, environment, fixtures and evidence locations. A UI task also needs actual interaction and applicable visual acceptance. A visual gate requiring the user cannot be self-approved by the implementer.

Existing unrelated failures may be recorded with a dependency-impact decision, but must not be converted to passes. Missing runtime, GPU, browser, input or service means blocked/unverified for that claim. The relevant parent gate cannot close while its must-pass evidence is absent.

## 6. Completion and reporting
Update `backlog.json` only after verification. Write `tasks/Txxx_RESULT.md` using the concise template. Separate engineering acceptance from user visual acceptance, merging, deployment and broad release. The chat update states exactly what changed, what passed/failed/was blocked, and the next task. Do not issue a full project completion claim after finishing a foundation slice.

Evidence should be small and targeted: command/result summaries, structured result JSON and relevant screenshots/camera captures. No command-by-command video recording is required. Logs, seeds and large temporary outputs follow a stated retention policy; originals and project data never become temporary proof merely because a test referenced them.

## 7. When the plan changes
A local implementation detail that preserves contracts can change with a note in the task plan. A shared contract, schema, authority boundary, renderer choice, permission behavior or release-scope change needs an ADR and impact review. Added scope goes into a future task or an explicit split; it cannot be smuggled into an unrelated refactor.

When a required test exposes a deeper issue, stop the affected change, preserve the branch state and record the failing case. Re-plan the bounded task rather than disabling the test. Changes to expected measurements need an independent definition/oracle review. Failed visuals return to the same task; they do not trigger another disconnected project.

## 8. Decision and authorization policy
Routine technical choices within a user's authorized task can be made and recorded without repeated confirmation. Ask only for a genuinely consequential unresolved product choice, destructive ambiguity, sensitive access, public deployment or required visual acceptance. The current turn is planning-only: no stored authorization is used to mutate the offline computer now.

Once implementation resumes, T001 is the next product task. M001 is separately authorized maintenance with a precise target and can be scheduled safely without making cleanup a prerequisite for every code change. Do not re-ask which directory after the user already specified it; stop only if actual path resolution/content safety reveals new ambiguity.
