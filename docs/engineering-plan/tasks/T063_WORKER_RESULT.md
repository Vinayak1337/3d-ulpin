# T063 worker result — Studio entry and directories

20 September 2026. Implemented for parent review on `feat/visual-ml-completion`; not user accepted. Parent owns production build, browser qualification, backlog and final acceptance. Existing T060/T061 dirty-tree work was preserved.

## Result

- `/` and plain `/studio` now open `/studio/datasets` (Saved blocks), with complete query context retained. Historical case bookmarks still resolve to their saved Studio case.
- The 13 old officer page wrappers now redirect directly into Studio. The legacy helper and `/v2/**` also terminate in Studio. All existing officer capabilities remain mounted by the Studio page, including advanced geometry, retained register and source study.
- Historical malformed path tails are retained rather than truncated to a valid property. Canonical UUID routes remain separate from explicit fictional fixture routes.
- Retained identifier resolution preserves incoming query arrays. Ambiguous identifiers render the register chooser on their Studio identifier URL; choosing a match carries evidence/source/page/floor/unit/repeated context while the selected canonical target owns its record/property identity.
- Saved blocks supports URL-persisted search and dataset-type filters. Removed disabled location previews and reduced primary actions to Add survey files. Property search and workspace continuation are compact links. Fictional reference quarter and Delhi source study remain secondary explicit links. Empty saved datasets remain accessible with honest preview states; no name-based removal or renaming.
- Saved workspaces are searchable by workspace/property name and identifier, sorted by actual update time, and filterable by property assignment. Removed duplicate large creation cards; retained new-workspace, existing-property and recent-property capabilities. Recent properties are a secondary disclosure.
- Register directory groups block choices by actual metadata and no longer preferentially selects the Lake View demonstration. Real, fictional, mixed, empty and unclassified source states have explicit labels. Known metadata is never inferred from a record name.
- Block/workspace search uses the installed Next version's documented native history integration, avoiding server-navigation requests per keystroke while retaining query state on reload/Back.

## Exact files changed by this worker

Routes:
- `apps/web/app/page.tsx`
- `apps/web/app/studio/[[...view]]/page.tsx`
- `apps/web/app/v2/[[...path]]/page.tsx`
- `apps/web/app/(officer)/blocks/page.tsx`
- `apps/web/app/(officer)/blocks/[areaId]/page.tsx`
- `apps/web/app/(officer)/delhi/page.tsx`
- `apps/web/app/(officer)/properties/[buildingId]/page.tsx`
- `apps/web/app/(officer)/properties/[buildingId]/prepare/page.tsx`
- `apps/web/app/(officer)/properties/[buildingId]/register/page.tsx`
- `apps/web/app/(officer)/properties/[buildingId]/workspace/page.tsx`
- `apps/web/app/(officer)/register/page.tsx`
- `apps/web/app/(officer)/register/records/[identifier]/page.tsx`
- `apps/web/app/(officer)/register/sites/[siteId]/page.tsx`
- `apps/web/app/(officer)/workspace/page.tsx`
- `apps/web/app/(officer)/workspace/[caseId]/page.tsx`
- `apps/web/app/(officer)/workspace/[caseId]/geometry/page.tsx`

Helpers and directories:
- `apps/web/lib/legacy-url.ts`
- `apps/web/lib/legacy-redirect-page.ts`
- `apps/web/features/studio/product/urls.ts`
- `apps/web/features/officer/shared/directory.ts` (new)
- `apps/web/features/officer/block/BlockHome.tsx`
- `apps/web/features/officer/block/home.css`
- `apps/web/features/officer/register/RegisterStart.tsx`
- `apps/web/features/officer/register/directory.css`
- `apps/web/features/officer/workspace/WorkspaceStart.tsx`
- `apps/web/features/officer/workspace/Workspace.module.css`

Checks and result:
- `apps/web/lib/legacy-url.test.ts`
- `tests/studio-entry.test.ts` (new)
- `tests/studio-routing.test.ts` (explicit fixture test wording/path)
- `docs/engineering-plan/tasks/T063_WORKER_RESULT.md` (this file)

## Checks actually run

- Read root and web AGENTS, T063 plan, Studio UX plan and CURRENT_WORK; read installed Next redirect, async page/searchParams and native history documentation before relevant changes.
- Applied local redesign and frontend-design skills; reviewed changed React components with react-best-practices skill. Kept existing Studio appearance and dependencies.
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/studio-entry.test.ts apps/web/lib/legacy-url.test.ts tests/studio-routing.test.ts tests/v2-state.test.ts` — **46 passed**, 0 failed.
- `pnpm typecheck` — **passed** after final changes.
- `git diff --check` over owned route/directory/helper/test changes — **passed** after final changes.
- No production build, server restart, browser acceptance claim, dataset writes, archival, source modification or snapshot operations performed by worker.

## Limits and next handoff

- Parent must run production build and browser checks for default entry, search typing, empty states, filter reload/Back, legacy redirects, identifier ambiguity and tablet layout. Existing browser script is parent-owned.
- Workspace endpoint still returns its existing maximum of 100 recent workspaces. Search operates on returned records; pagination/server search is outside this task. Dataset classification for unassigned workspaces is honestly unclassified when the endpoint has no area binding; names are not treated as evidence.
- Workspace filters represent actual assignment state, not inferred processing readiness. T065 owns preparation/resume/next-action state.
- Fixture view route parser still supports its explicit authored example defaults. Plain Studio no longer mounts it; secondary fixture navigation is labelled and starts with `selection=none`.
- Existing APIs, source processing, import form contents, preparation/ML controls, map/register scene clutter and dead-component cleanup remain for T064–T068. No capability was deleted as directory cleanup.
