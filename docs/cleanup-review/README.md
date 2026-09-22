# Data-transition cleanup review — recommendations only

**Date:** 23 September 2026 (India). **Repository:** `Vinayak1337/3d-ulpin`. **Branch:** `review/data-transition-cleanup-20260923`.

The user requested a new branch from `main`, a review of what will not be needed for the new data direction, and a deletion/archival list. **No existing application, dataset, original, screenshot, test or instruction file was deleted, moved or rewritten.** This branch contains review tooling and findings only. It is not a new product specification.

## 1. Exact baseline and scope

| Item | Reviewed value |
| --- | --- |
| Branch creation point | `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` |
| Adopted handoffs compared separately | `docs/usp-agent-handoffs@e167b1f6c1a830b2b5c6c1708e8f0b0214e4d849`, PR #7 |
| Handoff status when checked | Open/unmerged; not silently merged into this branch |
| Tracked files inventoried | **2,396**, logical total **405,945,017 bytes (387.1 MiB)** |
| Text review coverage | **1,622** UTF-8 files preserved, machine-scanned for imports/references; candidate groups and important consumers manually reviewed |
| Other payloads | **774** files inventoried by Git blob identity, size and references; images, documents, archives and other binaries not fully decoded or visually reviewed |
| Static JS/TS trace | 533 modules; 1,448 conservative literal-import edges; 47 web entry points. Not a complete runtime/AST reachability proof. |
| Verification performed | All 1,622 preserved text blobs matched their baseline Git blob identity. Twenty classifier/preservation assertions passed. Ninety-one duplicate candidates have an explicitly retained identical counterpart. |
| Not performed | Application build/test suites, database/worker/browser/GPU runs, local-PC inventory, full binary inspection, dataset qualification, deletion, deployment or main merge |

The read-only acquisition used [workflow run 35776588425](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35776588425). Its `ulpin-cleanup-review-35776588425` artifact contains the complete Git inventory, duplicate groups and preserved textual sources. Artifact retention is seven days; the baseline commit and the reproducible rules below are the durable reference. The acquisition workflow is branch-scoped and runs no application commands or database operations.

**Coverage is not a claim of line-by-line semantic review of every binary or runtime proof of dead code.** Every tracked path receives a disposition. An unresolved dependency means keep or conditional retirement, not guessed deletion.

The decision rules classify **1,173 paths as removal/archival candidates subject to their stated conditions** and **1,223 as keep/update/retain-until-replaced**. The large candidate count is mostly historical evidence and design material, not 1,173 immediately removable source files.

## 2. Decision in one paragraph

Remove genuinely redundant working-tree copies, retire superseded instructions from the active reading path, and isolate historical design/evidence from the production app. **Do not clear the existing datasets or shared geometry pipeline to make room for D0–D7.** D0 reuses authored reference material; D3 reuses the Google/OSM acquisition. Existing import, document, raster, point-cloud inspection, revision and recovery mechanisms remain useful. New dataset names do not make originals, IDs, manifest-bound assets or regression tests obsolete.

The revised direction is in [H00](https://github.com/Vinayak1337/3d-ulpin/blob/e167b1f6c1a830b2b5c6c1708e8f0b0214e4d849/docs/usp-agent-handoffs/00-README.md), [H01](https://github.com/Vinayak1337/3d-ulpin/blob/e167b1f6c1a830b2b5c6c1708e8f0b0214e4d849/docs/usp-agent-handoffs/01-shared-contracts-and-ownership.md) and [H99](https://github.com/Vinayak1337/3d-ulpin/blob/e167b1f6c1a830b2b5c6c1708e8f0b0214e4d849/docs/usp-agent-handoffs/99-ui-ux-and-integration.md). Those plans do not prove the replacement V0 application already passes.

## 3. First cleanup: verified duplicate copies, no new archive needed

| Rule | Exact removal candidate | Count / logical size | Retain / condition |
| --- | --- | --- | --- |
| D01 | Root `3D_ULPIN_UI_Demo_Guide.docx` | 1 / 1.046 MiB | Same Git blob exists at `docs/3D_ULPIN_UI_Demo_Guide.docx`. Retain that historical copy or its verified historical reference, not two active copies. |
| D02 | `fixtures/lake-view-complete-inputs/**` — expanded directory only | 38 / 2.358 MiB | Every member equals the path obtained by stripping `fixtures/lake-view-complete-inputs/`: canonical `fixtures/reference-neighborhood/**`, `fixtures/complete-demo/**` and `apps/web/public/scene-assets/**`. Preserve those originals and the separately named ZIP. |
| D03 | `data-source/lake-view-files/**` | 52 / 3.487 MiB | Every member equals `design/reference-map-v5/data/lake-view-complete/<same suffix>`. Retarget `data-source/README.md` to that browsable original tree first. Preserve the upload ZIPs. |

Total: **91 paths, 7,225,496 bytes (6.891 MiB)** of duplicate working-tree copies. Thirty-nine have no identified runtime consumer at their redundant location; the other 52 explicitly require the convenience-documentation fix. All still require a drift/reference check before a later approved removal.

This does **not** authorize deletion of `fixtures/lake-view-complete-inputs.zip`, `data-source/lake-view-complete.zip`, `data-source/shiv-vihar-complete.zip` or `apps/web/public/reference/*.zip`. Some duplicate bytes intentionally satisfy different test/runtime entry paths. For example, [t090-application-identifiers.test.ts](../../tests/t090-application-identifiers.test.ts) reads the `data-source` ZIPs. Binary ZIP member contents were not re-expanded for this review; blob equality is used only where exact equality was established.

## 4. Archive only meaningful history; remove duplicated presentation clutter

“Archive” means remove from active instructions or public app delivery after fixing consumers, while retaining a small index to meaningful immutable history. **Do not create another 200 MiB tracked archive folder.** Existing Git history already preserves the baseline. Keep original requirements, unique visual references and selected acceptance evidence; redundant captures/composites need no second copied archive.

| Rule | Candidates | Reason / required coordination |
| --- | --- | --- |
| A04 | `Astra_MVP_Handoff_Pack/**`; root `GPT_6_PRO_HANDOFF.md`, `BLOCK_DEMO_PLAN.md`, `PARCEL_TO_3D_PLAN.md`, `DEEP_REVIEW.md` — 49 files | Superseded orchestration and dated plans. Preserve original mandate/acceptance/source basis at the pinned commit. First bring the adopted handoff entry into the intended implementation branch and retarget README/AGENTS links. |
| A05 | 34 old delivery/architecture/verification files, including `docs/V2_ARCHITECTURE.md`, `V2_DELIVERY.md`, `REFERENCE_REBUILD_*`, `HACKATHON_PLAN.md`, `HACKATHON_STATUS.md`, old API/browser/registry evidence reports and `docs/v2-design/**` | Historical claims must not masquerade as current state or the new roadmap. Preserve relevant results and uncovered regression requirements. The exact 34 paths are enumerated by the rules/inventory. |
| A03 | `docs/tutorial-images/**`, historical `docs/3D_ULPIN_UI_Demo_Guide.docx`, `scripts/guide.mjs` — 30 files / 34.254 MiB | Root README explicitly calls these older tutorials historical. Retire the `guide` package command and old tutorial links together; keep `docs/STUDIO_DEMO_GUIDE.md` and operational launchers. |
| A08/A09 | `design/bulk-studio-v4/**` and `design/officer-studio-v3/**` — 52 files | Earlier standalone design/prototype paths. Retain only unique requirements/reference material and useful interaction history; do not maintain parallel app state/schema implementations. |
| A10 | Standalone-only remainder of `design/reference-map-v5/**` — 43 files | Old HTML/app screens, generated browser bundles and prototype assets, **not** the protected data/dataset/reference families in section 6. Update generator destinations and prototype tests together. |
| A06 | Dated output under `docs/evidence/**`, `docs/engineering-plan/evidence/**`, `docs/images/**`, `docs/frontend-completion/**` — 664 files after protected exclusions | Historical screenshots/exports/diagnostics are not new datasets or current runtime proof. Preserve a small dated result/provenance index and essential originals. Do not remove saved state that a verifier still reads. |
| A01/A02 | `apps/web/public/reference/review/**`, `review-t079/**`, and `outputs/ml-explainer/**` — 17 files | Old galleries and generated presentation results. Archive provenance, not another active app. Current `/explain`, `features/explainer` and public explainer assets remain in use. |
| D04 | `apps/web/public/studio-review/**` except `comparison-manifest.json` — 20 files / 25.044 MiB | Fourteen image files have identical blobs elsewhere; five unique composites are generated by `scripts/studio/compare.py`; one gallery HTML is historical. Retire the gallery/output assumptions and preserve original captures/reference links. No separate archive of duplicate images or reproducible composites is needed. |

The baseline permalink for any historical path is `https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/<path>`. Archive references should name that exact commit, not a mutable `main` URL.

## 5. Obsolete UI/code: conditional retirement, not blanket deletion

### R01: the disconnected older Studio shell — 28 files

Candidates include:

```text
apps/web/features/studio/App.tsx
apps/web/features/studio/StudioApp.tsx
apps/web/features/studio/StudioEntry.tsx
apps/web/features/studio/useStudioRoute.ts
apps/web/features/studio/styles.css
apps/web/features/studio/refinements.css
apps/web/features/studio/integration.css
apps/web/features/studio/hierarchy.css
apps/web/features/studio/components/**
apps/web/features/studio/data/mapScale.ts
apps/web/features/studio/data/property-upload.ts
apps/web/features/studio/data/usePropertyPreview.ts
apps/web/features/studio/data/useWorkspaceDraft.ts
```

The old `StudioEntry → StudioApp → App` chain has no path from the inspected current Next page entries. The [active Studio route](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx) imports officer workflow components and product helpers instead. This is static dependency evidence, not a passing deletion experiment.

**Do not confuse this with `/studio/showcase`:** [that current page](../../apps/web/app/studio/showcase/page.tsx) uses `ReferenceWorkbench`, not the disconnected StudioEntry app. Keep its data-review/import capabilities until a tested product replacement exists.

Before R01 removal: extract any still-required interactions/reference patterns, port old assertions, verify no computed/import/CSS/test consumers remain, and run active-route type/build/browser regressions. Do not remove the whole `features/studio` directory.

### R02: keep these donors until their replacements are qualified — 21 files

`features/studio/scene/**`, `data/district.ts`, `documents.ts`, `floorLayout.ts`, `display-geometry.ts`, `verify-property-source.ts`, `workspace-draft.ts`, `useSources.ts`, `routing.ts`, and `types.ts` still have generator/test or adopted-reference dependencies.

[scripts/studio/prepare.ts](../../scripts/studio/prepare.ts) and related fixture generation use the old district/layout/document logic. Studio tests import routing, geometry and workspace helpers. H01/H99 also cite `scene/SharedViewport.tsx`. Move useful fixture/geometry helpers into a single owned home and update consumers before pruning obsolete remainder. Not reached from a web entry does not mean unused by a generator.

### R03/R04: replace obsolete verification targets before deleting helpers

```text
scripts/spatial/studio-baseline.mjs
scripts/spatial/studio-capture.mjs
scripts/spatial/studio-continuation-verify.mjs
scripts/spatial/studio-correctness-verify.mjs
scripts/spatial/studio-port-check.mjs
scripts/spatial/studio-verify.mjs
apps/web/features/officer/shared/navigation.ts
```

The six browser harnesses target older `/studio/map/BLD-0413`, `window.__CITY_DEBUG__` or a standalone-port setup. Current Studio resolves the old path into directories instead of loading that old app. Migrate the useful interaction assertions into current-route V0/V1–V8 tests, then retire the old scripts and corresponding `test:studio:browser`, `test:studio:continuation`, `studio:capture` entries. `navigation.ts` is consumed by `tests/v2-state.test.ts`; point that test at current Batches/Map/Register navigation before removing the old helper. No failing browser test was claimed or run here.

Potential dependency pruning after these steps: `@react-three/fiber`, `@react-three/drei`, and eventually `jspdf` if their remaining donor/generator consumers are migrated. **Not approved for immediate removal.** Keep active `three`, `cesium`, `geotiff`, `pdfjs-dist`, icons and their licences. Rebuild/typecheck and trace worker/generator imports before any package/lockfile change.

## 6. Files and data that must stay

| Protected group | Why deletion would be wrong |
| --- | --- |
| `repo-data/**` | Saved DB, originals, identities and history; manifest binds presentation GLBs outside this directory. Restore dependencies are not replaced by new test packs. |
| `data-bundles/uttam-nagar/**`, `fixtures/google-uttam/**`, `scripts/google-uttam/**`, `scripts/datasets/**` | D3 real-reference/scenario separation and additive transfer. Preserve six-area bundle and original IDs; no bulk source purge. |
| `fixtures/reference-neighborhood/**`, `fixtures/complete-demo/**`, current canonical `scene-assets/**` | D0 donors, regression data and manifest-bound display assets. Only the redundant D02 copies are candidates. |
| `fixtures/studio/reference-v2/**`, `scripts/studio/prepare.ts` and linked generators | Current `studio-sources` APIs, fixture generation/tests and Next tracing still consume these. A versioned directory is not automatically dead. |
| `data-source/*.zip`, current `apps/web/public/reference` packages | Upload fixtures, active source views and tests. Preserve literal identifiers, hashes and source attribution. |
| `design/reference-map-v5/data/**`, `dataset/**`, `generate-data.py`, `validate-data.py`, `DATA_PACKAGE.md`, `ASSETS.md` | Active generator and t075/t076/t077 test inputs. Even `data/archive/t072-reference-v5/reference-scene.json` is read by current generators. Do not delete by the word archive/design. |
| `docs/evidence/reference/references/**`, `design/reference-map-v5/reference-audit/**`, `apps/web/public/studio-review/comparison-manifest.json` | Source visual references and their mapping. Five `reference-audit/images/REF-12.png` through `REF-16.png` have no identical outside blob; retain these unique inputs. |
| `features/officer/**`, `features/studio/product/**`, shared spatial/compiler/reference-runtime/reference-import, source inspection and ML modules | Actual active product mechanisms and future reusable ingestion/rendering paths. Directory names do not establish obsolescence. |
| Legacy/v2 URL resolver routes | Preserve historic identifiers/query context while routing into Studio; these are not duplicate full UIs. |
| Current registry/source/storage/jobs/dispatcher/contracts, migrations, isolation/transfer tests | The revised handoffs explicitly extend these rather than replacing them. |

Four historical-looking files have explicit verifier consumers and are excluded from bulk evidence archival:

```text
docs/evidence/reference/persistence-snapshot.json
docs/evidence/t061/workflow/state.json
docs/evidence/t066/workflow/state.json
docs/evidence/t066/browser/receipt-checkpoint.json
```

See `scripts/reference/verify.ts`, `scripts/ml/browser-workflow.mjs`, `scripts/ux/verify-source-workflow.ts` and `scripts/ux/verify-source-intake.mjs`. Parameterize those harnesses to fresh D0 receipts before archiving machine-specific state. Keep useful scripts/ux source-intake tests; migrate their inputs rather than erasing regression coverage.

## 7. Historical engineering plans are still CI inputs

**A07: 138 files can leave the active plan tree only after CI migration.** Do not recursively delete `docs/engineering-plan`.

[tests/engineering-acceptance.test.mjs](../../tests/engineering-acceptance.test.mjs) reads the reference catalogue, acceptance contract, traceability and backlog. [validate_plan.py](../engineering-plan/tools/validate_plan.py) checks task-plan existence and legacy/schema/renderer data. Existing GitHub workflows call these tools; some also execute actual application checks.

Keep the 19 K04 files under `tools/**`, `references/**`, `legacy/**`, plus `backlog.json`, `acceptance_traceability.json`, `edge_cases.json`, `input_support_plan.json` and `legacy_task_crosswalk.json` until the checks are deliberately migrated. Preserve original coverage requirements while replacing old execution sequencing. Do not delete CI merely because branch filters or task names are dated.

**U01/U02: update, not delete.** Root `AGENTS.md`, `README.md`, current status/startup/Studio/API documents, `data-source/README.md`, package manifests, Next tracing and workflow configurations need synchronized links/current-vs-historical wording. Preserve safety, source-retention and operational instructions. Main currently contains older task priorities; new agents must not accidentally treat them as the adopted USP order.

## 8. How to execute later, without destructive guesswork

1. **Adopt the current instruction entry deliberately.** PR #7 remains separate; bring its intended handoff version into the implementation branch through an authorized integration, then update README/AGENTS. This review did not merge it.
2. **Duplicate-only pass:** D01/D02, then D03 with README fix. DATA checks every retained counterpart hash and source manifest. Never prune ZIP members or snapshot object keys by duplicate content alone.
3. **Historical-presentation pass:** archive meaningful old plans/results to a small immutable-reference index; remove redundant gallery copies. Preserve K01/K02/K03 and link integrity. No new giant copied archive.
4. **UI/harness pass:** UI extracts R02 donor functionality as needed, replaces old browser targets, then removes R01/R03/R04 as a closed dependency change. FND alone applies shared package/config patches.
5. **CI-plan pass:** migrate existing acceptance/validator inputs before moving A07. Keep actual test obligations, not just a green workflow name.
6. **Verification:** run locked typecheck/build in an isolated worktree, current Studio tests, registry/scope/export/source/transfer regressions, current V0 browser navigation, import/reload and data preservation checks. Confirm every removed path has no retained importer, asset/manifest binding, generator read, route or documentation dependency. Keep invalid/unknown input tests.

These are proposed cleanup verification obligations, **not executed test results**. Relevant existing commands are in `package.json`: `pnpm typecheck`, `pnpm test:studio`, `pnpm test:registry`, `pnpm test:register-scope`, `pnpm test:register-exports`, `pnpm test:api`, `pnpm test:uttam`, `pnpm test:repo-data`, and `pnpm test:e2e`; use appropriate isolated services. Respect the build-server guard. Do not run `repo:init`, reseed, refresh a snapshot, modify `.env`, remove volumes or clear `.runtime` to get a clean test.

## 9. Exact file lists and reproducibility

[decisions.json](decisions.json) contains 30 ordered, explicit path/prefix rules, reasons and removal prerequisites. [classify_inventory.py](classify_inventory.py) is a standard-library **report generator only**, with no apply/delete mode. It verifies the pinned inventory metadata digest and refuses drift or an existing output directory. Ninety-one exact duplicate candidates must retain an identical counterpart; otherwise it fails.

From a checkout containing the pinned baseline:

```sh
python3 docs/cleanup-review/classify_inventory.py --repo . --output /tmp/ulpin-cleanup-classification
```

Use a new output directory each time. It produces `full-inventory.json`, `full-inventory.csv`, `candidates.csv`, `candidate-paths.md` and `summary.json`. The downloadable review pack also includes the preserved conservative import graph and reference evidence; supplying `--edges import-edges.json` includes literal static importers in each row. Run the script only for its pinned baseline; changed source requires renewed review, not force-applying old recommendations.

The review pack is not the source dataset pack. No D0/D1/D4 acquisition, new feature implementation or V0 qualification is claimed here. No local `node_modules`, `.next`, untracked checkpoint, downloaded model, PC dataset directory or database volume was inspected. Such paths must not be inferred as safe deletion candidates from this Git inventory.

Removing working-tree files does not remove their historical Git objects or guarantee a smaller full-history clone. No history rewrite, force push or release-data deletion is proposed.
