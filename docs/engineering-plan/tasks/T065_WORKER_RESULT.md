# T065 worker result — persisted preparation and focused fact review

20 September 2026. Bounded implementation on `feat/visual-ml-completion`, preserving the inherited dirty T060–T064 work. Ready for parent review; this is not browser or user acceptance. No worker build, service restart, commit, snapshot refresh, new model build, or record mutation was performed.

## Implemented

- `GET /api/v1/import-packages/:id/continuation` reads one repeatable-read snapshot and returns `needs_build`, `retry_build`, `processing`, `ready`, `reviewed`, or `recorded`. A matching model alone is insufficient: the current package revision must match the persisted `canonical.prepare` post-derivative receipt, linked case/revision, retained derivative SHA, reviewed placement and unchanged exterior revision. The model and current build job must match the fingerprint recomputed from the actual frame, active units, context and case revision.
- The exact matching build job is queried separately. The general case response's 30-job window cannot hide it after later inspection/inference jobs. Failed/stale/cancelled or mismatched jobs cannot expose an earlier ready model.
- Prepare requests for already prepared post-derivative revisions reuse those inputs and existing job. Failed-job retries reuse the derivative instead of adding another source/case revision. Old operation-key retries reject changed package or geometry state.
- Current registry reviews resume only when the preparation fingerprint, draft revision/status and site revision still match. Matching committed review receipts resume as recorded. The record UI then offers **Open recorded details**, not another record action. Existing server commit checks remain in force; the linked preparation check now uses the same stronger receipt/fingerprint verification. The detail-review route returns an existing current review before importing/allocating another proposal.
- The primary continuation appears above the fact list. Missing requirements lead with the first unresolved action; other requirements are disclosed. Reviewed facts and retained alternative values are collapsed. Unresolved candidates remain individually reviewable, with conflicts first. Equal values from corroborating sources do not receive a conflict warning; value, unit and named reference differences do.
- Source citations show document/page or row context; individual original-file access remains. **Show source** atomically changes document/page in the canvas. Raw locators remain in the explicit new/corrected fact, trace and placement operations, rather than occupying the ordinary panel.
- Manual corrected candidates retain the explicit source selection and review step. Local extraction tools and advanced geometry remain available under disclosure. Saved placement remains available without ordinary expansion. Original geometry, source bytes, IDs, calibration, benchmarks and revisions are not transformed or replaced.
- Source list uses compact document rows instead of repeated full thumbnails/Retained badges. Focus outlines and 44px review actions are included. The source canvas and existing model inspection remain intact.

## Owned files

- `packages/contracts/src/officer.ts`: continuation response contract.
- `apps/web/lib/preparation-continuation.ts`: pure persisted-build state verification.
- `apps/web/lib/server/preparation-continuation.ts`: transactional continuation and current review restoration.
- `apps/web/lib/server/domain.ts`: export the existing transactional case reader (other inherited dirty edits preserved).
- `apps/web/lib/server/officer-preparation.ts`: reuse current prepared inputs on reload/retry.
- `apps/web/lib/server/officer-routes.ts`: continuation GET, current-review reuse and pre-import stale guard.
- `apps/web/lib/server/registry.ts`: stronger linked-preparation recording guard.
- `apps/web/components/PreparationBuild.tsx`: persisted next action/review/record UI.
- `apps/web/features/officer/workspace/BuildPanel.tsx`: guided fact/placement panel, manual corrections, source citations.
- `apps/web/features/officer/workspace/fact-review.ts`: pending/reviewed/alternative grouping, semantic conflict distinction and source context.
- `apps/web/features/officer/workspace/WorkspacePage.tsx`, `useDocumentSelection.ts`, `Workspace.module.css`: compact source rows, atomic cited document/page selection and focused styling.
- `tests/preparation-continuation.test.ts`, `scripts/ux/verify-preparation-state.ts`, `docs/evidence/t065/worker-state.json`: checks/evidence.

## Verification

- `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/preparation-continuation.test.ts` — **25/25 passed**. Includes reload/post-derivative revision; changed facts and placement; changed exterior; missing/different derivative; old case/model/fingerprint; queued/running/failed/stale/cancelled current jobs; unrelated successful/newer jobs; absent receipt; conflict grouping vs corroboration; reference/unit differences; source/page locator restoration.
- `pnpm --filter @ulpin/web typecheck` — **passed** after the final atomic navigation change.
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json scripts/ux/verify-preparation-state.ts` — **passed**, read-only actual private-PC T061 case. Repeated continuation returned `recorded`, package revision **18**, case revision **2**, one supported space and the original committed review. Before/after unchanged: **9 sources, 9 jobs, 1 draft, 1 review**, same package/case revision and current snapshot ID.
- That read-only script also wraps the general case-job read with 30 unrelated inspection results while leaving the exact-fingerprint query real. The current successful build still resolves `ready`. No database fixture writes are involved.
- Evidence: `docs/evidence/t065/worker-state.json`, with timestamps, IDs, before/after counts and the bounded-history regression result. Explicitly private-PC linked evidence, not hosted-fixture acceptance.
- `git diff --check` passed for the touched tracked implementation files.

## Limits and parent handoff

Parent owns production build, browser/keyboard/viewport verification against the revised references, accepted task status and global backlog. The worker does not claim those checks or user acceptance. Parent was informed of the final cited-source navigation fix so the earlier overlapping build can be rerun.

Stale/failed variants are meaningful pure-state tests; this worker did not mutate the saved T061 case to generate failures or perform another recording. Existing recording endpoints retain their transaction, neighbour, revision, evidence and warning-acknowledgement safeguards. The retained manual placement controls remain explicit specialist controls; no fabricated OCR endpoints, calibration, measurements or inferred legal claims were introduced.

T066 remains separate: source-led document/spatial assistance and intake consolidation were only disclosed here, not reimplemented. T067 still owns broader map/register/workspace navigation and responsive hierarchy polish.
