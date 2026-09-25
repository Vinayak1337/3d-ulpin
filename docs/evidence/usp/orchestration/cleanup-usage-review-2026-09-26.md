# CLEANUP-USAGE dependency review — 26 September 2026

The inventory's 257 fixture/reference paths are **conditional retirement candidates, not unused files**. Active API routes, package commands, import tests and snapshot manifests still consume them. The smallest useful first implementation is to retire an individual authored seed/source endpoint with its generator and migrate its affected checks. Deleting whole fixture, design, server or evidence directories would remove live behavior or unique source material.

Assignment base: `staging@eae7e7f418d72e4a36c526804380c35944e3809e`, sole original checkout. Observed reviewer: `Codex / gpt-6-astra / high` from this task's latest `turn_context`. This is a same-family engineering audit, not independent milestone approval. Concurrent CLEANUP-A reached `88e067fa449253f67b723a1f4d18cf1493a5136c` during the review; its 14 deletions and guide/index changes are outside this assignment.

The [path manifest](cleanup-usage-review-2026-09-26.paths.json) enumerates all **1,282 scoped paths**: 257 operational assets, 39 migration scripts, 73 additional design leaves and 913 historical paths. Each has a baseline Git blob and disposition group. It also records exact incoming references, dynamic directory/entrypoint anchors, six additional script dependencies and source-export holds. A filename reference can be a reader, writer or historical link; it is not automatically a runtime dependency. The concrete distinctions below control execution.

## Ordered retirement batches

Counts in this table refer only to the 257 assets. Script and additional design counts are separate, so none are double-counted.

| Batch | Assets | Retirement boundary and required changes |
| --- | ---: | --- |
| Legacy seed endpoints | 20 | `fixtures/c001/`, `c002/`, `registry/`; remove their authored seeding/file-serving paths after migrating affected checks. |
| Authored Studio source endpoint | 10 | `fixtures/studio/reference-v2/` and `original-studio.json`; retire the fixed fixture endpoint, trace inclusion and preparation command together. |
| Reference seeds and scenes | 38 | `fixtures/reference-neighborhood/`, `complete-demo/` and their public scene assets; generator/seed retirement precedes scene deletion, which depends on the mixed snapshot review. |
| Upload packages and prototype data | 133 | The 121 `design/reference-map-v5/{data,dataset}` files, nine public reference downloads and three `data-source/` leaves; migrate importer checks and legacy URL metadata before removing packages. |
| Geographic synthetic companions | 38 | Only the listed synthetic Uttam/Google-Uttam leaves; split mixed preparation/import scripts and coordinate snapshot references with Luna. |
| D0 replay | 18 | `fixtures/usp/D0/`; replace the synthetic replay branch and affected gate/test inputs while retaining the recorded baseline and real D1 path. |

### 1. Legacy seed endpoints

`apps/web/app/api/v1/[...path]/route.ts:121` serves `demo-files`; `domain.ts:919` allows c001, c002 **and real-nyc**, and its loaders construct fixture paths dynamically. Remove only the authored cases from the endpoint/loader contract. Preserve the real NYC originals and compatible real-source behavior.

`registry-routes.ts:38–39` exposes `registry-demo` through `seedRegistry`. The seed tail in `registry-seed.ts:471` reads the registry fixtures. **Do not delete that module**: its `importRegistryCase` at line 34 is also used by ordinary registry and officer imports. Keep canonical transactions, identity/revision handling and production imports.

Affected existing checks include `scripts/verify-demo.ts`, `api-regression.ts`, `verify-registry.ts`, `verify-case-document-copy.ts`, `verify-identities.ts`, `scripts/ux/verify-source-intake.mjs`, `tests/e2e/workbench.spec.ts` and `services/geo/tests/test_area.py`. Move meaningful document-copy, PDF, geometry, identity and authorization assertions onto permitted unchanged official inputs. Retire only scenario-specific expectations. Missing official coverage remains explicitly unavailable; do not author replacement records or silently call removed checks passing.

### 2. Authored Studio source endpoint

The Next route `apps/web/app/api/v1/studio/sources/[...asset]/route.ts` still calls `studio-sources.ts`, whose root is `fixtures/studio/reference-v2`. `apps/web/next.config.ts:5` explicitly includes these bytes in output tracing. This is an actual route despite the old Studio screen no longer being the main product mount.

Retire that fixed source route/helper/trace entry with `studio:prepare`, `scripts/studio/prepare.ts`, `core-fixture.ts` and the obsolete comparison workflow after migrating `tests/studio-data.test.ts` and `studio-continuation.test.ts`. Do not remove all `features/studio`: the active Studio URL resolver and reusable document/scene behavior remain separate dependencies. `scripts/studio/acquire-materials.py` downloads material sources, not operational synthetic records; preserve material attribution and review its appearance consumers separately. Parameterize `preservation.ts` rather than discarding its row-fingerprint protection.

### 3. Reference seeds and scenes

`demo:seed`, `demo:complete` and the reference/browser/investigation/register verification commands in `package.json` are live entrypoints. `generate.py`, `scenarios.ts`, `seed.ts`, `complete-data.py`, `complete.ts`, `mesh.py` and `bundle.py` form the authored generation/import/package chain. Stop recreation by retiring the generators and seed command wiring as one bounded batch; migrate useful register, picking and persistence assertions before removing their scenario harnesses.

Scene deletion is a later dependency: `repo-data/manifest.json` binds public GLBs, while `scripts/repo-data.ts:143,181` and the reference scripts consume the installed identity receipt. The mixed snapshot is Luna's scope. Do not delete manifest-bound scene bytes or the ignored `fixtures/reference-neighborhood/installed.json` independently. `scripts/reference/verify.ts:175` also **reads** the committed persistence snapshot, so it cannot be archived as mere output yet.

### 4. Upload packages and the old prototype

The current `/studio/showcase` route uses `demo-datasets.ts` to resolve legacy `?dataset=` names by saved dataset SHA-256. It then redirects to the saved-ID inspector or dataset list; it does not automatically import the bundled ZIP. Preserve that URL resolution with minimal historical identifier/hash metadata when retiring the download descriptions and bytes. Preserve `ReferenceWorkbench`, canonical upload/validation, source fingerprints and the unique document, GIS, raster and point-cloud inspectors.

Affected checks are T075 adapter/package/presentation, T076 normalization, T077 import, T078 reference city, T079 complete source, T083 HTTP, T089 routing, T090 identifiers and T092 survey assets. They directly open public ZIPs or design data. Migrate the format/identity/coordinate assertions before removing those inputs; do not remove the shared source adapters to make tests disappear.

`scripts/reference/build-shared.mjs:8–14` builds **from active application importer/runtime code into the prototype**, then copies three public packages. Its output direction is decisive: generated `design/.../shared` can retire without deleting `apps/web/features/spatial/reference-import` or `reference-runtime`. Include the six extra closure paths listed in the manifest: the three `scripts/spatial/generate-*-showcase*.py` generators, their requirements file, `verify-complete-showcase.py` and `save-demo-datasets.ts`. The saver persists datasets and writes legacy evidence; it is not a read-only check.

There are **46 additional prototype shell/generated leaves** eligible for retirement with their build/verification bridge: HTML/JS/CSS, copied vendors and licences, generated shared bundles, prototype screenshots and local verifiers. Retire copied vendor licences only with their corresponding copied code. Keep the remaining **27 design leaves**: `reference-audit/**` and `screens/supplied-reference.png`. Git blob comparison confirms REF-12 through REF-16 have no identical blob elsewhere at the audit base. Other duplicate images still carry reference/gallery mapping, so relocation requires a hash-preserving pointer update. The manifest provides exact membership; this is not approval to remove `design/reference-map-v5/` wholesale.

### 5. Geographic companions

`prepare.py`, fictional-room derivation/import, complete-bundle preparation and their scenario verifiers recreate or depend on synthetic interiors. Retire the authored portions together; mixed `import.mjs` files need a split, not blanket removal. The 11 scripts in this migration group are enumerated separately from assets.

Keep the five real acquisition/import lineage scripts (`acquire.py` and `osm_roads.py` in both geographic directories, plus `uttam-nagar/import-osm-reference.mjs`) and three preservation scripts across Studio/Uttam. OSM/Google observations remain real gathered third-party context, not official cadastral evidence. Preserve their raw bytes, attribution and limits. Coordinate `scripts/datasets/uttam-nagar.mjs`, repo bootstrap and `scripts/usp/data/gf0-source-bundle.py` with Luna's mixed-bundle result. Shared real-source APIs, source registries, worker services and georeferencing contracts remain in place.

### 6. D0 replay and historical baseline

`scripts/usp/data/import-d0.ts`, `verify-d0.ts`, `verify-d0-live.ts`, `GF-CONTRACT.mjs`, `tests/usp-data-pack.test.ts` and the receipt-driven Studio/product e2e checks consume D0. `scripts/usp/isolated-live.mjs:203–218` runs its import/replay branch; real D1 follows. Do not retire the whole isolation runner or shared pack verifier.

Make a separate gate-input migration: preserve generic integrity/semantic checks and real D1 ingestion/rendering, remove synthetic replay generation, and state which coverage lacks an official replacement. The current release manifest still adopts the recorded D0/PACK0 plus single-real-D1 baseline. Keep those receipts truthful and labelled historical; deleting a replay fixture neither invalidates the recorded event nor makes it official-source qualification.

## Disposition of all 913 historical paths

These groups are mutually exclusive. “Archive candidate” means replace current links/writers with a pinned Git-history reference after the named dependency cutover; it does not mean unreferenced or approved for immediate deletion.

| Disposition | Paths | Reason / next action |
| --- | ---: | --- |
| Current baseline/coordination retained | 81 | All scoped USP baseline, foundation, alignment and orchestration records. The release manifest pins the continuation baseline; current finale receipts outside the 913 are also retained. |
| Source/design references retained | 27 | Supplied references, engineering reference contract/catalogue and images pinned by `apps/web/public/studio-review/comparison-manifest.json`. Repoint by exact hash before any relocation. |
| Model/source provenance retained | 35 | T061 model/evaluation/attribution and workflow extraction lineage, including derived masks/rasters and recorded evidence. These are not disposable UI captures. |
| Active exact pointers held | 7 | Legacy start/validator and T079/T083/T091/T092/T093 result pointers still named by handoffs or CURRENT_WORK. |
| Current pointer dependencies held | 29 | Their explicitly named capture directories and exact transitive dependencies. Directory references are recorded separately in the manifest. |
| Verifier inputs held | 4 | Reference persistence snapshot; T061 workflow state; T066 workflow state and receipt checkpoint. Parameterize readers first. |
| Source-export members held | 6 | Register-control source ZIPs and T068 roof/unit exports; member-level preservation required. |
| External state/policy lineage held | 6 | Repository-data receipts and provider catalogue observation; coordinate with the data/provider owner. |
| Legacy plan retirement after cutover | 260 | Superseded engineering plan/task/evidence paths. Preserve still-adopted requirements and source references while moving entrypoints and consumers. |
| Historical run archive after cutover | 458 | Old generated captures, result reports, test logs and synthetic register outputs; update their manifest/report links and output writers. |
| **Total** | **913** | **195 retained/held; 718 conditional archive/retirement candidates.** |

The six source ZIPs were inspected with `zipfile` member metadata, never decoded as text. In particular, T068 `roof-register.zip` contains a published OAM source image; `unit-register.zip` contains published CubiCasa/OAM images and attribution alongside synthetic records. Preserve the complete ZIPs pending per-member hashes, provenance and retained-counterpart review. A Git history pointer alone is insufficient to discard this source material.

The four executable evidence readers are in `scripts/reference/verify.ts`, `scripts/ux/verify-source-workflow.ts`, `verify-preparation.mjs`, `verify-source-intake.mjs` and `verify-complete-journey.mjs`. In contrast, the T058/T068 preservation scripts and preparation/work-queue verifiers write their committed result files; migrate their output locations if the report trees retire. Do not rerun old scripts to regenerate synthetic records.

H29 CLEANUP-02 already defines the legacy-plan cutover. Move the active gate pointer into H00, remove CURRENT_WORK from `docs/usp-agent-handoffs/release-plan.json` entrypoints and update linked handoff instructions. `tests/engineering-acceptance.test.mjs` still reads four legacy catalogue/contract/traceability/backlog inputs; preserve their adopted requirements and supplied-reference hashes in the surviving contract before retiring that check or directory. The legacy validator checks source/task evidence, and `scripts/spatial/save-demo-datasets.ts` plus `tests/t084-dataset-ml-integration.ts` still write there. These are concrete dependencies, not a reason to treat all documentation as unused. Do not remove the current handoffs, design system, release plan or finale evidence.

Every manifest path is recoverable using `git show eae7e7f418d72e4a36c526804380c35944e3809e:<path>` and its recorded blob. The manifest also supplies the corresponding pinned GitHub URL prefix. Keep this historical pointer rather than rewriting old reports to suggest newer tests passed.

## Evidence, limits and execution handoff

This was static review only: bounded `rg`/text reads, Git tree/blob metadata, JSON accounting and format-aware ZIP listing. No application tests, build, server, provider, database or seed ran. No input assets, services, populated volumes, credentials, current UI or other workers' files were changed. No new fixture was created. The exact-reference graph is not a complete dynamic module/database/object graph; named dynamic seams and unknown external state remain explicit holds.

Read commands succeeded after correcting initial shorthand paths/extensions; those lookup misses were not product failures. Final report checks cover JSON parsing, unique/count-complete scope membership, baseline blob equality and whitespace only. The seven other user-staged skill changes remain staged; CLEANUP-A owns the separate AGENTS change.

For later execution, recheck each batch against its actual current base and owner. Use typecheck plus only the directly affected existing checks; use one actual desktop journey when a route/UI contract changes. Run `$ui-design-check` for web UI changes. Source deletion requires reviewed unchanged official replacement data or an explicit unavailable-coverage result. Snapshot/scene retirement waits for Luna's exact record/object result. This report authorizes no deletion and makes no new runtime, accuracy or release-pass claim.
