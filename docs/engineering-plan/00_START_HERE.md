# 3D ULPIN — engineering execution plan
**Version 1.2 · 18 September 2026 · Adopted on the foundation branch**

## The decision
Evolve the existing product through a thin, runtime-validated shared model, an actual multi-source proving slice, one shared map/data/session boundary, and a reusable renderer. Qualify a complete neighbourhood before rebuilding rich interfaces. Preserve original sources, stable identities, geometry meaning and existing usable workflows.

The user authorized sequential implementation and local/remote synchronization. Core access is restored. The actual branch was created from `f082441` on `origin/feat/reusable-spatial-map-core`, retaining its shared contract, cache, viewport and tile compiler. The plan is now adopted; T001 is in progress. Its Windows pure/type/build/browser baseline has run. The actual isolated database/original-byte baseline is the remaining gate and will run on a dedicated hosted runner while local Docker is unavailable. M001's exact approved proof directory was deleted and its result recorded. See `tasks/T001_PROGRESS.md` and `tasks/M001_RESULT.md`; these replace earlier candidate-only status wording.

## What this package contains
| File | Purpose |
|---|---|
| `01_MASTER_EXECUTION_PLAN.md` | Product outcomes, release boundaries, the ordered sequence and decision gates. |
| `02_ENGINEERING_GUIDELINES.md` | Practical design, code, data, review, safety and delivery rules. |
| `03_ARCHITECTURE_AND_DATA_CONTRACT.md` | Shared-model boundaries, coordinate/identity rules, module ownership and migration strategy. |
| `04_TESTING_AND_EDGE_CASES.md` | Test strategy, 70 planned risk cases, numerical/visual/performance acceptance. |
| `05_TASK_BACKLOG.md` | 56 bounded task briefs grouped into 13 epics; the first 52 cover the core product, four are optional expansion. |
| `06_TASK_EXECUTION_PLAYBOOK.md` | One-task-at-a-time workflow, ready/done rules and change handling. |
| `07_DECISIONS_RISKS_AND_SOURCES.md` | Design decisions, unresolved risks, sources and explicit supersessions. |
| `08_LEGACY_TRACEABILITY.md` | Every one of the 81 earlier task references mapped into the new plan; 28 tests, 16 UI gates and 17 benchmarks retained. |
| `09_INPUT_SUPPORT_PLAN.md` | All 25 earlier input families, with honest first-release/deferred acceptance boundaries. |
| `10_RESUME_HANDOFF.md` | Standalone continuation instructions for a later chat or worker. |
| `tasks/T001_BASELINE_PLAN.md` | The first task's detailed plan, including environment, commands-to-discover, risks and exit criteria. |
| `tasks/M001_PROOF_CLEANUP_PLAN.md` | Separately authorized, exact-path proof cleanup; never a data cleanup. |
| `templates/` | Task plan, task result, architecture decision and defect templates. |
| `backlog.json` | Intended authoritative status/sequence file after deliberate repository adoption. |
| `legacy_task_crosswalk.json`, `acceptance_traceability.json`, `edge_cases.json`, `input_support_plan.json` | Machine-readable traceability and checks. |
| `legacy/` | Byte-preserved relevant source planning records; historical, not active task boards. |
| `tools/validate_plan.py` | Local plan consistency checks; never application tests or host maintenance. |

## Reading and ownership
Read the master plan and engineering guidelines first. Before a task, read its brief, relevant architecture/test sections and the task's detailed plan. Do not reread or rewrite every historical document for every small change.

Keep **one implementation task active**. An epic is not a single coding assignment. Every task receives a fresh detailed plan just before execution, against the actual code. If a brief turns out to contain more than one independently reviewable change, split it into child tasks without deleting its parent ID or acceptance requirements.

Task T001's detailed plan is written now, subject to fresh environment validation. Future `tasks/Txxx_PLAN.md` paths in the JSON are reserved locations, not existing detailed plans. This avoids pretending that file-level designs for unseen future code are already final.

## Historical baseline, not a new observation
The recovered handoff recorded `E:\Projects\3d-ulpin`, branch `main`, commit `16220977b127dbdad8953c899a38f37e8c6a53d6`, with a clean working tree and `ulpin-canonical/2`. It is a last-known starting point, not a current remote or live-database guarantee. T001 must recheck it. The full old-chat transcript remains unrecovered; the available planning artifacts are sufficient to plan without claiming literal transcript completeness.

## Status authority and migration of the tracker
The old workbook, old schema JSON and old renderer JSON remain historical snapshots. This package supersedes their execution ordering **when adopted**, not their useful requirements. Do not maintain multiple editable boards with independent status. Update `backlog.json`, task plans/results and ADRs; regenerate the human-readable backlog. External issue trackers may mirror IDs later, but must not become a competing truth source.

T001 is **In progress**, with tested baseline repairs and isolated integration tooling. Other core tasks remain **Planned** until their own requirements are verified; optional expansion remains **Deferred**. Inherited implementation is reusable but does not automatically satisfy whole task briefs. No database preservation, hosted run, merge, or visual acceptance is claimed without its corresponding result.

## Maintaining this plan
From this package directory, `python tools/validate_plan.py` checks internal record consistency. After intentionally updating `backlog.json`, run `python tools/render_backlog.py` to regenerate the readable backlog. The `--planning-snapshot` validator flag additionally checks this initial all-unstarted snapshot and should not be used to demand zero completed tasks after real implementation begins. These scripts do not run application tests or reach the user's computer.
