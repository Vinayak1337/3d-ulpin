# T063 — Unify Studio entry points and officer directories

See [Studio UX plan](../STUDIO_UX_PLAN.md) for user intent, audit and preservation contract.

## Scope

Make Studio default and sole normal route family; replace duplicate pages with compatibility redirects; improve default landing and searchable directories.

## Implementation boundary

Read local Next docs. Preserve route query identity and all existing processing. Present saved datasets/workspaces clearly; explicitly separate demonstration fixture routes. Remove disabled location placeholders and duplicate primary actions; expose supported add-source action. No dataset deletion.

Preserve previous T060/T061 changes in the dirty working tree. One task at a time; no subagent spawning from workers. Parent owns shared backlog and result acceptance.

## Verification

Route/context tests including legacy aliases, fixture/canonical separation and duplicate query values; focused typecheck/build; browser default, directory search and Back/reload.

Do not claim user acceptance from automated tests. Record actual checks, changed files, remaining limits and next-task handoff.
