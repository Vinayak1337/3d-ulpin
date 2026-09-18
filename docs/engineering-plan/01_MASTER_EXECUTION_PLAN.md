# Master execution plan — 3D ULPIN
**Version 1.1 · 18 September 2026**

## 1. Product outcome and acceptance
Build a reusable, evidence-linked spatial/property platform in the existing `3d-ulpin` product. Supported source contributions should produce consistent property identities, geometry, measured quantities, source links and a visually coherent navigable 3D environment. The same records must drive the map, building register, level/unit inspection, plan, findings, history and export.

Uttam Nagar is a difficult regression fixture, not a special-case renderer architecture. A clean synthetic calibration neighbourhood may reproduce the reference's art direction; it must not be represented as the actual Uttam Nagar layout. Dense reference geography must retain its narrow gaps, courtyards and irregular boundaries. Source-supported content, planned content and fictional demonstration detail remain distinguishable.

Success means a complete neighbourhood produced by the common pipeline and reused on different supported datasets. An attractive standalone building, a green build or a table beside a static background image does not satisfy that outcome. Source format support is qualified by named versions/profiles and tested capabilities, not by an upload accepting bytes. These directions reconcile the recovered renderer and schema plans [P01–P03].

## 2. How much to design in advance
Use four planning levels. The **product charter** fixes outcomes and non-negotiable invariants. The **epic roadmap** fixes dependencies and deliverable boundaries. A **task brief** identifies the next reviewable result. The **detailed task plan**, written just in time, names current files, algorithms, tests, negative cases, migration/rollback and evidence.

Do not write 56 speculative file-by-file implementation plans now. Write sufficient architecture to prevent incompatible data/state choices, then fully plan only the active task and clarify the next task's interfaces. New findings update a versioned decision or task plan; they do not justify silently restarting the whole project.

An epic may contain several tasks and a task may contain several small commits. An accepted task must leave a coherent buildable system or an intentionally isolated feature-flagged increment. Cross-layer proving slices prevent months of disconnected schema work: core contract examples are tested as they are added, the legacy read adapter is their first real consumer, and the two-block API/storage demonstration precedes the renderer expansion.

## 3. Delivery strategy and software-engineering methods
**Risk-driven incremental delivery:** test the hardest assumptions early—identity preservation, coordinate compatibility, multi-source composition, render asset picking and architectural fidelity. Use a bounded experiment when a decision is genuinely uncertain. Its exit is evidence for a decision, not a new permanent prototype.

**Domain-led modules and ports/adapters:** group code by responsibility with explicit interfaces. Parsers understand sources; application services decide permitted operations; geometry services compute; renderers display; pages compose controls. Reuse the existing deployments rather than adding a microservice for every noun.

**Characterization and test-first development:** first capture existing behaviour that must survive; for new deterministic domain logic, write an independent expected result or failing test before implementation. Then implement, refactor and run integration checks. Screenshot tests complement numerical and behavioral tests; they do not replace them.

**Small, reviewable changes:** keep each change coherent and include its tests. Separate unrelated formatting, dependency upgrades and broad refactors. This applies Google's small-change review principle without imposing an arbitrary line quota [S01].

**Architecture decision records:** record a significant choice with context, alternatives, decision, consequences and status; preserve superseded records. This uses Nygard's lightweight ADR approach, not a repeated full design report [S02].

**Evolutionary data migration:** version and test schema/data changes with code, rehearse in isolated databases, and switch consumers only after compatibility evidence. This follows the small migration and independent environment practices described by Sadalage/Fowler [S03].

## 4. Architecture that is fixed versus choices that remain open
Keep the existing Next.js/React product, PostgreSQL/PostGIS, object storage and Python processing/worker boundaries unless an evidence-backed decision proves a specific change necessary. Keep Cesium as the first renderer candidate; qualify the actual pinned stack before replacing it. Keep the existing useful identifiers, source revisions, review/fingerprint safeguards and working routes [P01–P03].

Fix the boundaries now: original inputs / observations / selected canonical representations / disposable render assets; object identity / source feature IDs / external identifiers / tile IDs; data records / UI session / GPU resources; analytical frame / rendering frame; physical spaces / recorded interests / people/accounts.

Leave exact schema-library tooling, tile dimensions, compression extensions, solid kernels, cache limits and optional format coverage open until their bounded task has sufficient evidence. A schema needs extension points for raster/cloud/BIM assets; it does not need every parser, every analytical operation or 53 new SQL tables before the first map.

## 5. Ordered work and release boundaries
| Stage | Task range | Deliverable and exit |
|---|---|---|
| E01 Baseline and operating contract | T001–T003 | Fresh preservation baseline, reference/fixture requirements and core architecture decisions. |
| E02 Thin unified model | T004–T008 | Tested identity, sources, frames, representations, observations and snapshot contracts. |
| E03 Compatibility and normalization | T009–T011 | Existing data and first supported inputs cross the new boundary without loss. |
| E04 Multi-source proving slice | T012–T013 | Persisted two-block case and negative/compatibility gate. |
| E05 Shared application foundation | T014–T016 | Shared revision-aware data access, inspection session and viewport lifecycle. |
| E06 Compiler and first tiled renderer | T017–T022 | Real several-tile viewport, stable picking, supported geometry and measurement probes. |
| E07 Complete-map fidelity | T023–T027 | Coherent full neighbourhood, diverse inputs and user visual acceptance. |
| E08 Cross-area reliability | T028–T032 | Bounded resources, seams, recovery and **R1 renderer-foundation release**. |
| E09 Map interface | T033–T037 | Shared shell, controls/search, inspector/findings, history/export and responsive states. |
| E10 Property inspection interface | T038–T042 | Building/floor/unit/plan/source/history views using one model. |
| E11 Import/edit/review interface | T043–T047 | Actual live import and a safe correction/publication workflow. |
| E12 Product qualification | T048–T052 | Integrated, recoverable, declared supported **R2 product release**. |
| E13 Optional expansion | T053–T056 | Elected BIM/CAD/cloud/survey/private-integration and capacity increments. |

This is a preferred linear order under WIP=1. The dependency graph records the technical prerequisites. A later reorder needs a recorded reason and may not bypass a gate. Basic tiling, publication safety and navigation already exist in E06; E08 expands and hardens them rather than adding streaming after visual work is finished. Security constraints and negative tests begin with the first input/data tasks; the E12 audit is final qualification, not the start of security.

**R1 is a renderer foundation, not a completed product redesign.** It includes the accepted common contract, existing-data normalization, measured multi-area delivery and full-neighbourhood visual quality. Basic navigation/picking are necessary from the beginning; rich administration panels are not.

**R2 is the integrated local supported product.** It includes the first qualified import profiles, linked inspection, review/edit workflows and recovery. The declaration must state which source types, geography, hardware and access modes are actually supported.

**R3 is elective expansion.** Raw GNSS processing, LiDAR segmentation, full CAD/BIM support, production multi-user permissions, official integrations, native mobile/offline sync and million-feature capacity are not hidden R1/R2 prerequisites. Their contracts must not be prohibited by early design; their implementation is still deferred. Future adapters each get their own small plan rather than one 'support BIM' assignment.

The earlier boards placed some expansion before final release. This revision explicitly moves those optional dependencies out of the critical path while preserving their IDs and acceptance requirements in the crosswalk. It does not reclassify unimplemented features as complete.

## 6. First concrete demonstrations
The first domain demonstration uses a 10 × 8 metre synthetic building with a 6 metre declared exterior height: 80 m² footprint and 480 m³ prism volume. It crosses two 20 × 20 metre authoring areas with different local origins. Separate inputs provide the footprint, level bounds, unit boundaries, parcel reference and utility contribution. The building remains one identity and works with zero PDF attachments. These are independent fixture expectations, not real surveyed quantities [P02].

Exercise the actual source-to-candidate-to-composition/storage path, not just a prewritten JSON returned by a mocked endpoint. Repeat the operation, change its mapping, interrupt it, and query its identity from both areas. Follow with a minimal multi-tile renderer using the same read model.

The first visual delivery is then an entire coherent reference-style neighbourhood with real browser-rendered geometry. Reverse angles, close-up narrow gaps, top-down, wide district, section/underground and boundary travel must all work. The same compiler runs on dense, sloped, sparse and held-out fixtures. Unknown geometry uses an approved neutral fallback rather than invented factual detail.

## 7. One task at a time
Use `Planned → Ready → In progress → Review → Verify → Accepted`, with `Blocked` and `Deferred` as explicit states. Only one task can be In progress/Review/Verify as the active engineering task. Read-only review can assist it; parallel agents may not independently change shared contracts, migrations or state.

Before coding, the task plan must establish actual affected code, invariants, alternatives, permission/data boundaries, tests, known edge cases and a rollback strategy. All requirements and applicable negative cases must have an expected observable result. An unresolved risk either gets a bounded experiment, an explicit unsupported boundary or a blocker. The word 'handle' is not an acceptance criterion.

Accept each task based on its evidence, not only its author's claim. A small data task may need tests and a diff review; a visual task needs actual browser comparisons and the declared reviewer; a migration needs upgrade/restore evidence. Do not demand a new video archive for every small change. User visual checkpoints require user acceptance; routine technical tasks do not need repetitive permission questions within already authorized scope.

## 8. Change, branch and preservation policy
A verified cloud checkout is an allowed primary implementation environment. Use hosted CI and isolated synthetic/committed fixtures; do not make desktop connectivity a prerequisite for source work. A cloud run cannot validate uncommitted desktop changes, PC-only data or physical GPU/touch behavior. These remain explicit later gates before affected local migrations/releases. See `11_CLOUD_EXECUTION.md`. The first adoption/tooling increment is intended as one commit, not a single commit for the entire product rebuild.

Start implementation on `feat/unified-spatial-foundation` after a fresh Git check. If that branch already exists, inspect and reuse it only when its work matches; never reset it to force a clean start. Use bounded commits with task IDs and feature flags where replacement routes are incomplete. Merge/release decisions stay distinct from local task acceptance and require the applicable authorization.

Prefer add → adapt/backfill → compare → switch consumers → later retire. A Git revert does not revert a database. No live volume deletion, source overwrite, ID reassignment or new parallel canonical registry is allowed as a shortcut. A source or geometry revision must remain attributable to its historical frame and input bytes.

The user separately approved deletion of `E:\Projects\3d-ulpin-proof-20260917`. M001 handles only that exact directory after path/link checks; it excludes the product, study sources, originals and future test baselines. Cleanup is not a prerequisite for domain development and is not performed in this planning turn.

## 9. Reporting and completion
Use a short per-task result: task and commit; what changed; tests actually run with pass/fail/blocked; unresolved limitations; next task. Store durable decisions and small structured evidence, not a new long audit essay after each commit. A failed test or absent device remains visible. Do not claim remote checks, physical touch, source-format parsing or rendering capacity from a different evidence type.

This candidate is ready for target-instruction/path review and one-commit repository adoption. T001 preparation tooling has synthetic-fixture tests; actual target baseline and environment acceptance remain unstarted. The next execution task is **T001**, now cloud-capable; no UI rebuilding begins there.

## References
Project references P01–P03 and engineering sources S01–S07 are registered in `07_DECISIONS_RISKS_AND_SOURCES.md`. The detailed task and legacy mapping records are in `backlog.json` and `legacy_task_crosswalk.json`.
