# T066 — Unify source intake and source-led extraction

See [Studio UX plan](../STUDIO_UX_PLAN.md) for user intent, audit and preservation contract.

## Scope

Offer supported document uploads consistently and allow aerial building extraction before any building exists.

## Implementation boundary

Use explicit case/source/dataset context without dummy property. Reuse persisted ML batches, exact rasters, reviewed footprint draft adapter and ordinary review/commit. Infer eligible model/task from source use, hide engineering metadata under details, reuse valid persisted controls only when source hash/frame match. Keep page/component choices and reviewed placement. Preserve all supported document assignment profiles.

Preserve previous T060/T061 changes in the dirty working tree. One task at a time; no subagent spawning from workers. Parent owns shared backlog and result acceptance.

## Verification

No existing building source-led journey, floor-plan path, partial/empty/error/retry/cancel, source/placement mismatch, idempotence and originals; actual local inference/browser; focused tests/build.

Do not claim user acceptance from automated tests. Record actual checks, changed files, remaining limits and next-task handoff.

## Corrected reference gate

T069 completed first per latest user steering. Use design/officer-studio-v3/DESIGN_BRIEF.md and REVIEW.md plus the actual revised screenshots as the presentation/interaction target. Do not copy errors from superseded original or exploratory draft images. Keep actual app capabilities honest while implementing these tasks sequentially.

## Parent read-only handoff after T064

The T064 browser-verified intake is still in DataTools' modal; lift into a shared routed Add files task as shown in 05-add-files when implementing combined intake. Keep existing DataTools callers (standalone export and retained package review). File-picker controls should show the selected file once and shrink the drop zone after selection; leave room for the unresolved question and Continue at tablet height. Route incoming canonical block/property context into the task. Preserve exact bytes through existing upload services.

Specific source-led blockers: SpatialExtractionPanel requires buildingId and PreparationCase, filters every source part by entityIds.includes(buildingId), and ExtractionReview uses preparation.placement for frame selection. Server createSpatialMlFootprintDraft also requires a source-associated original entity to choose worldStatus; removing only the UI guard is insufficient. Use an explicit source-workspace/area association and declared origin with retained named metre frame, not a fake physical feature. Existing spatial-ml batches/items already key by package and retained source rather than building; retain their source-hash/part-fingerprint/currentness and idempotency guards. The public /import-packages/:id/documents schema currently requires at least one entity ID even though attachDocumentBatch's internal check can accept none. Any source-only path must be explicit and tested; do not globally weaken canonical-property association rules.

Unassigned useWorkspace.upload accepts PDF/PNG/levels CSV only, while property documents accept PDF/PNG/JPEG/CSV/TXT/DOCX. AssignDialog and copyFormats also restrict copy to the three older profiles. Align upload, canvas/source rendering and association, preserving family/revision/hash/case lineage; do not promise unsupported formats. Prefer one selected-source task with local eligible model chosen automatically, model hashes/licenses/quality under details, and source/context-calibration reuse only if exact fingerprints match.

User optional work-queue preference was not answered; keep proposed queue as the intended default. T067 owns default/global navigation and queue presentation, while this task owns /studio/add-files or equivalent explicit route, with a handoff for Add files callsites.
