# T068 worker result — bounded presentation cleanup and workflow guide

20 September 2026. Scoped worker work is complete and stable for parent
integration. This report does not claim full journey, visual or user acceptance.
The parent owns final production build, running app, API/browser qualification
and task acceptance.

## Dependency and capability audit

Read root and web AGENTS, T068 plan, T066/T067 results, relevant current workflow
components, and the installed Next.js Server and Client Components guide before
editing. Preserve the entire inherited dirty tree and the prior T060–T067 work.

The post-cleanup dependency audit used TypeScript's installed module resolver
and the web tsconfig aliases. It traversed static/dynamic imports from all 35
app page/layout/route/error/loading/template/not-found entrypoints. It reached
251 local modules. All 91 remaining TSX presentation modules under web
`components` and `features` were reachable. This is a dependency result, not
proof that every branch or CSS selector is used; the specific removals below
also received caller/state/selector inspection.

The earlier duplicate page presentations were replaced by thin Studio URL
resolvers in T063. Those URL files are intentionally retained. Current shared
components including AreaViewer, AreaSection, PlanView, SpatialViewer,
PreparationBuild and PreparationPlacement still provide reachable capabilities.
No calibration, advanced geometry, investigation, source review or export tool
was deleted merely because its implementation predates Studio.

## Removed code and proof

- `apps/web/features/officer/shared/Shell.tsx`: removed unused pathname/family
  computation, routes/mainNavigation/Button imports, search state, an unregistered
  keyboard callback and the permanently closed SearchDialog mount. No live
  event could set that state to true. The working ProductHeader search and its
  registered Cmd/Ctrl+K handler remain untouched.
- `apps/web/features/officer/shared/SearchDialog.tsx`: deleted after confirming
  Shell was its only import/caller. Parent reviewed and authorized the deletion.
  Shared search-target resolution remains used by ProductHeader and the Studio
  route; no resolver or canonical identity lookup was removed.
- `apps/web/features/officer/shared/shell.css`: removed the abandoned topbar,
  brand, old global search/navigation/actions, local/avatar, eyebrow and
  search-results selectors plus their unused responsive children. A full web
  source search found no remaining non-CSS references. Parent reviewed and
  authorized this boundary. Retained `ui-search-input` because BlockRails uses
  it; also retained generic kbd, status, content, skip-link and mobile header
  height styling that affects live surfaces.

The three runtime files total 361 removed lines and two added lines. There are
no queue/header/route/backend/schema/source/geometry changes from this worker.
The test-referenced historical `navigation.ts` definition and shared search
helpers remain; neither creates a duplicate UI surface.

## Guide

Added `docs/STUDIO_DEMO_GUIDE.md`, based on current controls and implementation:

- Work queue as entry, separately labelled Lake View/Reference quarter and real
  datasets, no reseed/reset requirement.
- Exact Add files → Review details → Check & record actions, accepted extensions
  and 10/16 MiB limits; GIS content validation still applies.
- Document receipt without block/property, context selected later for imagery,
  local model availability and retained attempts, documented control evidence,
  footprint draft review, property assignment only when needed.
- Source fact review, placement and vertical evidence, manual/corrective tools,
  separate document assistance status and honest unavailable-model fallback.
- Separate GIS and detailed-property recording actions; resumed current receipt
  versus recorded history; per-scope export formats and original-byte ZIPs.
- Explicit limits: raw GNSS/LAS/DEM, general ML accuracy, Nous free-route
  qualification and statutory/official issuance are not promised.

## Verification

- `pnpm typecheck` passed after runtime edits.
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test
  tests/studio-entry.test.ts tests/studio-routing.test.ts tests/v2-state.test.ts
  apps/web/lib/legacy-url.test.ts`: 46 passed, zero failed/skipped.
- `git diff --check` on the three runtime files passed.
- Module-resolution and selector/caller audits completed as described above.
- No server build/restart, fixture mutation, source upload, database write,
  snapshot refresh or commit performed by this worker. Parent is independently
  qualifying the running integrated journey and exact preservation evidence.

The guide describes supported behavior; recorded integration results belong in
the parent's T068 result and evidence. Prior automated evidence does not replace
user visual acceptance or outstanding real-data/ML/statutory gates.
