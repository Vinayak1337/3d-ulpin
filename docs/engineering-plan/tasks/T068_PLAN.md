# T068 — Delete obsolete presentations and qualify complete journey

See [Studio UX plan](../STUDIO_UX_PLAN.md) for user intent, audit and preservation contract.

## Scope

Remove proven-unused presentation code and verify the integrated officer journey.

## Implementation boundary

Dependency/capability audit before each deletion; retain thin historical URL resolvers, source APIs and canonical workflows. Update workflow guide with exact supported actions and limitations. Review all preceding diffs; fix remaining defects one at a time. Start final app.

Preserve previous T060/T061 changes in the dirty working tree. One task at a time; no subagent spawning from workers. Parent owns shared backlog and result acceptance.

## Verification

Production build; supported GIS/source-to-extraction-to-review-to-record-to-export journey, refresh and errors; original/identity preservation; route scan; final browser captures; record actual results and unqualified acceptance gates.

Do not claim user acceptance from automated tests. Record actual checks, changed files, remaining limits and next-task handoff.

## Corrected reference gate

T069 completed first per latest user steering. Use design/officer-studio-v3/DESIGN_BRIEF.md and REVIEW.md plus the actual revised screenshots as the presentation/interaction target. Do not copy errors from superseded original or exploratory draft images. Keep actual app capabilities honest while implementing these tasks sequentially.

## Parent read-only deletion audit during T066

A TypeScript module-resolution graph from all 35 current app page/layout/route/error/loading/template entrypoints found no unreachable TSX presentation modules under apps/web/components or features after T063 thin-route replacement. This is a read-only preliminary result, not permission to delete used modules or a substitute for final capability review. Rerun after T067. Current components (AreaViewer/AreaSection/PlanView/SpatialViewer/PreparationBuild/PreparationPlacement) are shared or retained capabilities. Do not manufacture file deletion by dropping accessible corrections/export/calibration tools. Old route aliases stay as thin resolvers. Delete genuinely obsolete JSX/CSS/components discovered by final audit, and explicitly state when an old presentation was removed by replacing its page body rather than deleting compatibility URLs.
