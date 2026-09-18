# Engineering guidelines
These are proposed project rules for the next implementation. **Must** is an invariant or safety rule; **should** allows a reasoned exception recorded in the task plan. They do not assert that the current implementation already meets every rule.

## 1. Design for one product, not a collection of demos
Reuse the persisted product and its source/history/identity mechanisms. Extract bounded modules where responsibilities differ; do not create another standalone city app as the delivery architecture. A temporary experiment must have a question, fixture, comparison, termination condition and a decision about disposal or integration.

Use domain-led boundaries and dependency inversion pragmatically. A parser returns candidates; it does not call page state. A scene compiler reads a selected snapshot; it does not choose the legal owner. A UI calls application services; it does not calculate cadastral truth independently. Geometry calculations must not import browser or database implementations. Keep interfaces narrow and use concrete implementations until a second real use case or a testing boundary justifies abstraction.

A single function/module should have a coherent reason to change. Reuse invariants and semantic operations, not merely code with similar text. Avoid giant 'shared' helper modules, stringly typed generic property bags for core values, and interfaces with dozens of unrelated optional fields. Prefer explicit variants and namespaced source extensions. Do not create a plugin framework before the second qualified profile demonstrates what varies.

## 2. One authority for each kind of truth
| Concern | Authority | Not authoritative |
|---|---|---|
| IDs and object lifecycle | Versioned entity/identity service and persisted crosswalks | Label, array index, tile index or mesh UUID |
| Geometry and quantities | Named analytical representation, frame and computation version | Display mesh, exploded view, browser screenshot |
| Source facts | Immutable source revision plus exact locators and resolution decisions | Newest file by default or AI confidence alone |
| Workflow status | Application service and persisted revisions | Button state or an optimistic UI badge |
| Appearance | Versioned render recipe and derived assets | Unseeded per-render randomness |
| Server data in the UI | Revision/scope-aware resource layer | Independent writable copies in each page/store |
| Progress | `backlog.json` plus task evidence | Old workbook status, a chat promise or code compilation alone |

During migration, record a one-writer table per field/record. Compatibility views are readers. If a short transition needs a projection, make it rebuildable, revision-bound and service-owned; do not ask developers to manually sync two truths.

## 3. Geometry and identity rules
Preserve original coordinates, units, axes, placement and source meaning. Do not relabel a coordinate system or apply a transform twice. A frame identifier, vertical reference and operation version are required for the corresponding metric comparison; unknown placement allows a local preview, not an invented global zero.

Persistent IDs must survive label, floor name, area membership, renderer LOD and tile changes. True splits/merges create lineage with historical aliases; do not reissue or silently recycle IDs. Physical rooms, legal units and people are distinct even when they share an address. A building can relate to several parcels; a duplex to several storeys; common space to several units.

Keep ground footprint, roof projection, exterior, floor surface, unit boundary, legal boundary and display mesh as different roles. More triangles never add evidence. Unknown height is not zero; unknown depth is not safe clearance. State whether a quantity is source-reported or calculated and whether it means footprint, net area, gross area, volume, horizontal distance or 3D clearance.

## 4. Code and interfaces
New domain logic must have runtime boundary validation and typed internal values. Do not trust TypeScript types as validation for incoming JSON. Choose one authoritative schema definition and test validator parity across TypeScript and Python; do not separately hand-maintain contradictory enums or nullability rules.

Catch expected failures at a boundary and return a typed outcome. Do not silently replace errors with empty geometry or zero-valued metrics. Logs may include request/job/operation IDs and non-sensitive error classes, not secrets or private document contents. Cancellation is a distinct result, not a generic red error toast. Timeouts and resource limits must produce a recoverable state.

API commands should carry expected revision and operation identity where replay or concurrency matters. Return current/relevant revisions, status and machine-readable failure details. Lists need bounds and continuation. Error messages should tell the user what failed and what input or action can fix it without claiming a capability the adapter lacks.

Keep breaking changes explicit. New enum values can break exhaustive clients; an apparently additive field may change required meaning. Unknown future variants must be rejected or safely retained according to the named profile, never silently treated as a known geometry. Pin actual dependency versions and isolate upgrades from unrelated work.

## 5. Persistence, jobs and publication
Migrations must be versioned with the application, ordered and tracked. Do not expand the existing startup DDL approach indefinitely without an explicit migration-ledger decision. Test fresh install, upgrade, rerun, interruption and compatibility with the supported old/new app versions in isolated environments.

Backfills must retain original IDs and revisions, checkpoint progress, define collision handling and reconcile counts. Never assume destructive down-migrations can restore data. Prefer forward repair or switching consumers back to a compatible version; rehearsed backups are required before an approved live mutation that could lose state.

Workers may deliver the same message more than once. Require idempotent effects using operation keys, constraints and revision checks. Record attempts and checkpoint only durable progress. Retry transient failures with bounds; validation failures need corrected input, not endless retries. Never claim exactly-once processing without defining the narrow persisted effect.

Object storage and the database do not share a transaction. Write immutable assets to staging, verify hash/size and metadata, then commit a validated manifest/active pointer in the database. Failed builds must leave the prior publication usable. Reconcile orphaned staging assets through an explicit retention policy, not immediate blind deletion.

## 6. Frontend and rendering discipline
Extend existing shared data/session infrastructure instead of adding a second competing store. Keep query keys scoped by permission/world/snapshot/entity/representation as needed. Pending-request deduplication needs subscriber-aware cancellation. A slow response must not replace a newer route or snapshot. Cache size, age and invalidation must be explicit.

The session stores selected IDs, layers, view mode, camera/return context and temporary interaction state—not entire authoritative databases or private source blobs. Source drafts and server records are not interchangeable. URL state, session state and renderer selection have a documented precedence and reconciliation rule.

A common viewport/controller owns camera commands, stable picking, scene lifecycle and quality profile. A register or calibrated plan may have a specialized view, but cannot own a new geometry truth. Inactive full-world canvases must release or pause resources. Culling is not unloading. Mesh unload must not erase a selected property's identity.

Keep held-pointer control lifecycle stable through UI rerenders. Test delayed press-and-drag, release/cancel, blur, wheel-after-drag and touch where supported. Apply an actual click/drag threshold so a navigation gesture does not accidentally select a property. Keyboard alternatives and focus boundaries are required for essential operations.

## 7. Visual engineering is not a CSS finish
Define design tokens, shared component states and a camera/lighting profile. Compare scene-only crops independently of the surrounding interface. A matching header cannot compensate for a poor map. Use actual browser output without replacing the canvas with the reference image.

Prioritize correct silhouette, depth, materials, street/ground continuity and proportion before decorative post-processing. Generic styling may improve a sparse dataset, but missing balconies or roofs cannot become asserted observations. Any illustrative geometry belongs to a declared scenario/representation and is excluded from observed quantities.

Every shared styling/lighting change reruns previously accepted views. Do not bulk-approve screenshot baselines merely because the current output changed. The user accepts principal visual gates; automated tests detect regressions after an implementation view is approved. A different real geography is judged for comparable quality, not identical building arrangement.

## 8. Test-first and review
For deterministic rules, add a failing test or independently computed example, implement the minimum correct behaviour, then refactor. For legacy changes, add characterization tests before altering behaviour. For performance or visual uncertainty, run a measured experiment; avoid forcing a unit test to stand in for the question.

Use unit/contract tests for semantics, real integration tests for persistence/transactions, property tests for invariants, targeted browser journeys for wiring, and actual device/performance review for hardware claims. Mock external boundaries where useful; do not mock away the very database, transform or importer whose correctness is being asserted.

Review design and data impact before line-level polish. Review the plan/test oracle separately from implementation where feasible. A self-review is not an independent review; disclose which occurred. A reviewer must challenge plausible wrong cases, not only confirm the happy path. Google's review checklist is a useful reference for design, functionality, complexity and tests [S04].

No silent coverage reduction, ignored failure, deleted assertion or unsupported screenshot rebaseline. If a test is wrong, explain its faulty requirement/oracle and change the test and rationale together. A pre-existing failure is recorded with reproduction and impact; a newly introduced failure blocks acceptance.

## 9. Change size and branch policy
Use one logical result per change, including relevant tests [S01]. A pure refactor should preserve behaviour and be separated from a semantic change when practical. Split a task when it requires unrelated decisions, cannot be reviewed coherently, or needs unbounded validation. Do not use an arbitrary file/line count as a substitute for judgement.

Start on the authorized feature branch and preserve others' work. Do not reset, force-push, auto-stash, overwrite a branch, run `git clean`, replace lockfiles or reformat the whole repository to simplify a task. Branch acceptance, merging and deployment are separate decisions. No task report may claim a remote push that was not performed and verified.

Prefer frequent small integrations within the feature branch. Before merging to the shared mainline, ensure the compatible increment, migrations, tests and rollout flags are reviewed. Incomplete replacement routes stay behind an explicit flag with a documented fallback and eventual removal task.

## 10. Inputs, privacy and AI assistance
Treat files, archive paths, native database containers, XML references, URLs and AI-produced text as untrusted input. Enforce size, count, recursion, runtime and memory bounds. Do not execute embedded instructions or fetch arbitrary remote references. Cloud URLs and thumbnails require the same source permission boundary as the original content.

Keep private party, lease and account information out of public/geometry-safe tiles, caches, logs and search by default. A source being readable by a local single operator is not production authorization design. Before public/multi-user deployment, require implemented access controls, tests and a new release-scope decision.

AI may suggest extraction, mapping or conflict candidates. It cannot approve its own geometry, issue official identifiers or directly publish registry changes. Record method/version and source locators; review candidates under the same validators as any other input.

## 11. Practical documentation and team workflow
Keep a short task plan, coherent code/tests, a concise result and ADRs only for significant choices. Store one small evidence manifest per task; capture visuals at visual checkpoints rather than recording every command as a video. Keep secrets and large raw traces out of Git. Temporary diagnostics get a retention rule and cannot be confused with canonical data.

Vinayak is the proposed architecture/integration owner. Bounded fixture preparation, source-profile research, ordinary interfaces and tests can be delegated after interfaces are clear. Workers receive one task, explicit paths and limits; they do not recursively spawn more work or edit another owner's shared contract. WIP=1 applies to the active implementation; read-only assistance does not authorize parallel independent rewrites.

A task is not done until applicable tests, regression, review and evidence pass. Do not pretend all possible edge cases can be enumerated in advance. Maintain a risk-based register, add every discovered failure as a regression and make unsupported cases explicit.

## 12. Continuous integration and guardrails
Use the existing repository CI where available. As each boundary is introduced, include its fast checks on relevant changes and its integration/upgrade/browser checks when affected. A pull request should identify the task, contract/data impact, commands, results, rollout and unresolved limitations. Block merges on newly introduced failures; do not treat a not-run job as green.

Add inexpensive dependency-direction, schema-fixture, public-DTO and plan-consistency checks instead of relying only on prose rules. Cache dependencies by the actual lockfile and isolate job data resources. A cloud/headless CI image may qualify automated behavior but cannot certify the user's physical GPU or native-touch profile. Network outage means remote CI is unverified, even when local tests pass.
