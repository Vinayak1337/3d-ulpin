# T065 — Resume and guide preparation from saved state

See [Studio UX plan](../STUDIO_UX_PLAN.md) for user intent, audit and preservation contract.

## Scope

Persist continuation and show one useful next action; compact source-linked fact review and placement.

## Implementation boundary

Fix refreshed successful-build continuation using persisted job/model fingerprint evidence, never assume current draft matches model. Drive stage from requirements and actual review/job state. Group reviewed facts, show missing/conflicting ones first; preserve individual source access and manual edits. Reuse supported metadata, never auto-accept claims. Place advanced geometry/tools behind disclosure.

Preserve previous T060/T061 changes in the dirty working tree. One task at a time; no subagent spawning from workers. Parent owns shared backlog and result acceptance.

## Verification

Reload after upload/extraction/placement/build; stale/failed job; no duplicate model/record; browser Build-to-review and keyboard; targeted tests/build.

Do not claim user acceptance from automated tests. Record actual checks, changed files, remaining limits and next-task handoff.

## Audit handoff

Parent browser confirmed persisted T061 case (`b5b9b4e8-c06a-4aca-afec-c8d443b708e1`) shows 6/6 facts reviewed and Review ready badge after reload but only Build proposed 3D details. PreparationBuild `builtRevision` is component-local null state and gates ready. Do not simply remove the gate: ensure persisted model corresponds to current package/fact/placement fingerprints. Evidence selector currently lists raw attribution JSON lines; keep locators accessible but present selected source/page context and only expand detailed locator selection during an actual new fact operation. Large every-source thumbnails plus repeated Retained labels consume the whole left rail.

## Corrected reference gate

T069 completed first per latest user steering. Use design/officer-studio-v3/DESIGN_BRIEF.md and REVIEW.md plus the actual revised screenshots as the presentation/interaction target. Do not copy errors from superseded original or exploratory draft images. Keep actual app capabilities honest while implementing these tasks sequentially.

## Persisted-build evidence discovered by parent

`officer-preparation.ts:prepareDetails` already inserts an `operations` row with kind `canonical.prepare`, operation_key `<packageId>:<inputRevision>`, payload_hash of the retained derivative, and result `{caseId, caseRevision, sourceId, packageRevision}` after saving the package. The final packageRevision is the post-derivative revision. This is stronger resume evidence than merely seeing a model. CaseDetail has model revision, build jobs and inputFingerprint. A bounded resume-state query can match the current package/case/source/model and required placement rather than depend on component-local builtRevision. Placements increment/save the package, so edited placement invalidates the former package match. Verify this against stale/failed builds and record/reload, and do not simply mark any historic succeeded job ready.
