# FND-04 · Geometry separation · Attempt 1

## Handoff and outcome

- Worker task `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7`, host `local`; observed `Codex / gpt-6-astra / high` (T-risk).
- Assigned integration base `1a6baf0d832117932c291fa6bfc08a536d8bd26e`; isolated worktree `/Users/vinayak/.codex/worktrees/51a5/3D Ulpin`.
- Branch `agent/FND-04-geometry-separation`; final code commit `6ddc4e17b322ebf44d0b173a5a94da63fbb24aef`.
- SQL/registry/scope checks ran at `11fb326839ef88c44eea172154fc06906c74126b`. The sole later source change preserves the physical-semantic classification of the source CityJSON roof while keeping analytical eligibility false. Typecheck and all 119 USP tests were rerun at the final code commit; SQL, registry and scope sources are byte-identical between these two commits.
- Result/evidence commit is supplied in the final callback. No merge, remote push or deployment was performed.

Implemented the contracts, additive database boundary, canonical qualification annotations, display compiler adapter and narrow live-consumer guards. Bounded verification passed. No GF-VIEW/GF-T18 or other runtime/milestone gate is marked passed.

## Implementation and producer/consumer coverage

| Producer / authority | Consumer and enforcement |
| --- | --- |
| `packages/contracts/src/usp/geometry.ts` | Strict representation, geometryClass, analyticEligible, semanticLod/displayLevel, qualification, sufficiency verdict and derivative contracts. A linked-evidence label alone cannot qualify; context meshes, estimates and illustrative derivatives remain nonanalytical. Missing legacy metadata projects as null with explicit missing source-integrity/qualification requirements. |
| `packages/contracts/src/usp/domain.ts` | Declaration prepare/commit kind and change schema, typed instrument/declaration/entry/applicability pins, amendment predecessor checks and snapshot membership checks. Old snapshots remain readable. New captures explicitly report declarations `not_assessed`; no declaration authority is invented. |
| `apps/web/lib/server/usp/migrations.ts` and `geometry-migration.ts` | Removed the identity-migration early return that skipped later migrations. Added versioned, immutable annotations beside the existing canonical registry/features; exact record revision/body hash and an accepted `qualify_geometry` receipt are required. Source pins/hashes must match retained current source revisions. Superseded sources and retired/cancelled records cannot remain in the current analytical view. |
| `usp_analytic_geometry` and `usp/geometry.ts` | One SQL eligibility predicate/view serves FIND, READY, PACK and export. NOLOGIN purpose roles have SELECT on that view and no raw canonical/annotation/display-table SELECT grants. The same-client role helper restores the previous role; pooled readers use read-only repeatable-read transactions. Payload checks prevent a changed body from reusing a qualified ID/revision. Explicit estimated/context-mesh/illustrative source classification cannot be overridden by a qualification annotation. |
| Canonical registry/features/units and their revision tables | Additive `NOT VALID` checks reject new illustrative writes while preserving incompatible historical rows if any already exist. The retained verification database contained zero illustrative-labelled rows in all six tables; proposed writes against populated rows were rejected with SQLSTATE 23514 and rolled back. |
| `usp_display.derivatives` and `usp/display-compiler.ts` | Separate immutable metadata store keyed by canonical record/revision with a revision foreign key. Only the compiler purpose role receives store SELECT. The adapter verifies local context, exact snapshot access and current canonical status; changed record/source/layer pins mark output stale, and retired/cancelled records return no display output. The write helper rejects stale/out-of-scope input pins. It generates no geometry and returns no public object URL. |
| `usp/snapshots.ts` → existing USP resolve/scope routes | Captures exact annotation revisions in snapshot membership, resolves qualification only when the pinned annotation still matches the current qualified SQL view, and exposes `geometry-not-assessed` or `analytic-geometry`. Source-only inspection stays available. Display-store rows are never captured into analytical snapshots. |
| `registry.ts` → `prepareRegistryReview`, `commitRegistryReviewTx`, `registryQuery` | Guard reviewed geometry and query scope using the canonical view and exact payload comparisons. Query coverage is checked before raw spatial selection. Same-client recording checks cannot reuse an old passing review to bypass qualification. |
| `areas.ts` → `reviewPackage`, `runAreaCheck` | Guard actual feature payloads before analytical checks. An unqualified source or changed/transformed payload cannot produce a passing analytical review through these paths. |
| `officer.ts` → `buildingDossier` | Qualified projection includes selected geometry and every participant in current findings. Unqualified findings are withheld with an explicit not-assessed message. Original records, geometry, sources and history remain inspectable. |
| `officer-investigations.ts` → investigation findings/readiness and register export | Guard finding-based creation and readiness/review/close transitions. Printable analytical exports require qualified exact payloads. JSON may preserve retained geometry for explicitly labelled source inspection; its analytical state remains `not_assessed` and unqualified findings are excluded. |
| `block-export.ts` → block export | Checks both block features and child property export states. A qualified block outline cannot conceal unqualified child unit geometry in a printable packet. Source-inspection JSON retains its explicit unqualified state. |
| `usp/external-scene.ts` → existing D1 external-scene route/viewport | Adds explicit physical-semantic, evidence-linked but analytically unqualified metadata to the already source-hash-checked CityJSON roof. Semantic LoD comes from the decoded source; tile displayLevel remains null. Original source faces, IDs, local display and the existing unsupported analytical-volume state are preserved. |
| Existing `usp/packet0.ts` | Remains exact source-part text/CSV extraction. It does not read the display store or produce geometry measurements. Existing source/packet contract regressions remain passing. |

The lead explicitly confirmed the narrow seam transfer for `registry.ts`, `areas.ts`, `officer.ts`, `officer-investigations.ts` and `block-export.ts` before those edits. No UI render redesign, ledger, plan, AGENTS, credential, dependency or dataset files changed.

## Executed verification

Actual argument vectors, timestamps, stdout/stderr and exit statuses are retained in [checks.json](checks.json), [sql-command.json](sql-command.json) and [sql-run.json](sql-run.json). [verification.json](verification.json) pins all 18 changed source files, both relevant code commits, the baseline migration source hash, and the retained database/manifest hashes.

| Command | Exit / result |
| --- | --- |
| `pnpm typecheck` | 0 at final code |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-*.test.ts` | 0; 119 passed, including 8 new metadata tests and existing contract/API-envelope/source regressions |
| `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/registry*.test.ts` | 0; 12 passed |
| `pnpm test:register-scope` | 0; 3 passed |
| `node scripts/usp/gf/FND-04-isolated.mjs` | 0; 21 fresh-database and 22 retained-database checks |
| `git diff --cached --check` | 0 before code commits |

### Actual PostgreSQL evidence

[sql-fresh.json](sql-fresh.json) and [sql-retained.json](sql-retained.json) record:

- installation/replay on a fresh database and installation after the **actual pinned baseline USP/identity migration** had already run;
- successful analytical-view reads under each intended role, followed by SQLSTATE 42501 for display-store, raw canonical-table and annotation-table reads under FIND, READY, PACK and export;
- successful compiler-role SELECT on the empty display store, with normal pooled role restored afterward;
- SQLSTATE 23514 for proposed illustrative writes in populated `registry_records`, `registry_revisions`, `physical_features`, `physical_feature_revisions`, `units` and `unit_revisions`;
- SQL rejection of label-only/missing qualification and context-mesh eligibility, and explicit estimated/illustrative/context-mesh source classification guards;
- an actual retained registry row captured and resolved through the snapshot adapter without acquiring analytical eligibility; declaration state remains not assessed;
- correct current-versus-stale input revision checks at the display compiler boundary, without creating a derivative;
- all **44 protected retained table row hashes unchanged** after migrations, rejected-write transactions and source-inspection checks.

The runner uses the existing `assertUspIsolation` profile, verifies loopback Docker context, nonce project/volume absence and the database port, and starts only its new PostgreSQL service. It restores the unchanged hash-checked repository dump only into that owned database. Cleanup is limited to that nonce-owned project and its volumes. No web server is started or stopped; unrelated port 3000 is untouched. No populated external database is reset or reseeded.

Earlier checks and the pre-final-classification-guard verification are preserved under [iterations/3c88238](iterations/3c88238/verification.json) and `iterations/11fb326/`, with raw runs also retained under `.runtime/usp-fnd04/`. Iterative tests passed; the final guards came from code review, not a fabricated runtime failure or a hidden waiver.

## Operational effects, trust boundary and unqualified coverage

Unqualified legacy geometry is intentionally **not automatically grandfathered into analysis**. The affected analytical review/check and printable-export operations now return explicit unavailable/not-assessed errors until the exact geometry is qualified. Source browsing, retained geometry inspection and permitted source-part/JSON inspection remain available. No source values are filled with zero or invented dimensions.

No enabled processor creates `qualify_geometry` acceptance receipts in this task. The new annotation helper accepts only the existing canonical command authority's accepted receipt and exact pins. Wiring an actually qualified deterministic/domain processor to that authority remains separate work; a client label cannot substitute for it. No real positive qualification case was available for this assignment, so **real-source analytical accuracy remains unqualified**. The retained D0/other historical corpus is regression material only under the current official-source policy.

The display store is empty by design; no synthetic or illustrative scene data was generated. SQL access/constraint behavior is proven, but a nonempty derivative asset byte round trip, scene rendering, deterministic compiler output and regeneration jobs are not claimed. UI/SCENE must adopt the boundary when its authorized compiler implementation exists.

Declaration contracts and historical pins are ready; `prepareProposal(kind: declaration)` explicitly returns `USP_DECLARATION_NOT_ASSESSED`. Full declaration/rights acceptance, domain AI, coordinate/height accuracy and GF-T18 algorithms were not implemented here. Existing generic workspace processors, raw source/GeoJSON inspection exports and legacy rendering outside the transferred consumers are not newly qualified by this work. No UI/browser/GPU, S3 byte integration, protected multiuser, provider, or deployment gate was run.

The SQL purpose roles enforce ACLs in the intended analytical reader contexts. The migration/application session owner remains privileged and can administer the database; these checks do not claim to restrain a database administrator or establish distinct authenticated deployment users. Applying the migration requires the role/schema creation privileges exercised only in isolated PostgreSQL here. No linked-environment migration or credentials were changed.

Independent lead/cross-family or human acceptance remains required. This worker receipt is bounded implementation evidence, not a same-family milestone pass.
