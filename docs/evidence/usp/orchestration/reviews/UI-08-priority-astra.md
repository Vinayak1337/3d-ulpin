# UI-08 priority — bounded Astra review

**Disposition: provenance correction required before accepting these affected surfaces.** Sample-promotion removal and retained saved inspection are supported by source review; all UI-08 requirements are not satisfied.

- Base `a56f6b0f9841ffb47c02248bfc7b48c8b8d24d0a`; reviewed code `f3eaeccab9b4e6c8f28942728b2cda92f6191ad4`; result `9527e105224c2ae6430fad01c0ac8576928a8471`.
- Review branch/worktree: `review/ui08-priority-astra`, `/Users/vinayak/.codex/worktrees/ui08-priority-astra-review`, created at the immutable result.
- Observed Codex desktop / `gpt-6-astra` / `medium`, verified from latest local `turn_context`. Same-family engineering review, not independent milestone approval.
- Read current operating guide, web AGENTS, H29 UI-08, worker report, changed routes/components and relevant existing service contracts. Report only; no UI implementation or full design review.

## P2 — Provenance is hidden on primary surfaces while an unsupported classification still drives filtering

`apps/web/features/officer/work/WorkQueue.tsx:33–35` drops `dataKind` for **all** work items. This hides even the record-derived synthetic classification supplied for cases/imports by `lib/server/work-queue.ts`; a synthetic recorded item can now appear simply as “Recorded”, with no separate provenance indication. The saved-dataset variant's hard-coded classification does not justify discarding the reliable variants too.

For compatibility datasets, `BlockHome.tsx:118–119` and `DatasetIntake.tsx:18` remove the classification without an explicit unknown/unverified replacement. `ReferenceWorkbench.tsx:99` displays only Saved/Unsaved in the scope strip; its “classification unavailable” explanation is buried in the Source files dialog (line 106). Meanwhile `BlockHome.tsx:68` still includes **every** saved dataset in the filter now labelled “Synthetic sources” (line 92), regardless of source-backed classification. The change therefore neither consistently exposes uncertainty nor eliminates the false classification claim.

The adapter issue is real: `lib/server/spatial-datasets.ts:48,56` writes synthetic metadata as a compatibility default; `lib/spatial-datasets.ts:4` types classification as the literal `synthetic`, and the work-queue dataset SQL supplies `demonstration`. A default is not evidence that an uploaded source is synthetic. Nor does omitting the badge explicitly distinguish that uncertainty from observed/official evidence. No new explicit “official” label was found, but hiding provenance violates H29's per-screen requirement.

**Smallest correction:** add a read-time provenance projection to the existing service/view-model contract that distinguishes recorded classification from an unqualified legacy default (for example, explicit unknown plus a basis/status). Preserve recorded classifications for case/import/area rows; use the qualified projection for saved datasets, intake and scope strips. Show unknown/unverified visibly where no source-backed value exists, and apply the same projection to the Synthetic filter so unknown datasets are not silently classified. Do not simply trust the hard-coded default, infer official status, equate synthetic with Test fixture, or rewrite protected originals/stored records. This can be carried into the existing screen-replacement owner; no separate redesign or data purge is needed.

## Other bounded checks

- `/studio/showcase` no longer loads a bundled default or an arbitrary sample by dataset query: a legacy sample query resolves only to an exact saved hash, otherwise to the directory; bare/import entries redirect to datasets/Add files. ReferenceWorkbench now fetches saved original bytes and identifiers, checks hash/digest, and retains saved map/register, source download and survey-layer inspection. ImportReceipt has no Try sample/download callbacks. `/studio/source-study` no longer mounts DelhiStudy; its hard-coded scenario promotion is removed from that finale entry. Protected source files remain. This establishes removed UI entry paths, not removal of publicly addressable historical assets or all legacy screens.
- Area `real` maps to Observed consistently with the existing `areas.ts` aggregation over observed feature world status. Synthetic/observed labels are not converted into official issuance. Other changed record surfaces continue reading actual world status/synthetic flags. No identifier or geometry mutation was introduced.
- Batches names, area names, source counts, update dates and pagination use the current work-queue response. Links reuse `workItemAction` with actual IDs for cases, imports, saved datasets and processing; no new sample identifiers were introduced. Fresh status/action and saved-link runtime behavior remains for manual validation.
- The changed source preserves unique saved inspection paths; no concrete additional redirect/inspection regression was established in this review. Source-study was a hard-coded geographic scenario screen, not the sole general GIS/raster/point-cloud inspector.

## Evidence and remaining acceptance

Reused [worker report](../../finale/GF-VIEW/UI-08/attempt-1/report.md): typecheck/design scanner/diff-check passed. The reported browser check was on earlier preview pin `9c6c578b73bb71ca06342840943ff199ac4e84c2`, so it cannot validate this code's Batches layout or redirects. No suites, browser journeys or services were repeated. Fresh visual fidelity, keyboard/zoom and S1/S4/S5/S12 captures remain with Luna after coordinated refresh. Existing historical names remain protected record values; UI-08, DATA-09 scene qualification and full grep/runtime acceptance are not complete.

Only this report changed; review `git diff --check` passed. Original/worker edits and prior review branches preserved. No application/data changes, keys, providers, installations, ports or services. Running preview `http://127.0.0.1:3187` was untouched; served revision was not re-inspected. Report worktree retained for integration; no owned running resources.
