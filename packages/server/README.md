# Server extraction

`@ulpin/server` owns the extracted backend implementation. The exact 73 former
`apps/web/lib/server` files and 36 complete non-UI transitive source files are listed in
[`extraction-map.json`](extraction-map.json). The old paths now contain narrow
exports for the temporary Next callers and existing tests; implementation lives
only here. The map separately records `transformPoint` as a partial extraction
from `apps/web/lib/ui/geometry.ts`; presentation helpers remain with the web
owner. `scripts/repo-env.mjs` is the 111th closure file and remains the single
`REPO_DATA` environment authority instead of being copied.

## Public imports

- `@ulpin/server` exports the central config, SQL pool/transaction/migration,
  storage health/bucket/shutdown and error helpers.
- `@ulpin/server/infrastructure/{config,db,storage,errors,loopback-host,...}`
  exposes shared backend infrastructure.
- `@ulpin/server/modules/{cases,areas,registry,officer,usp,spatial,datasets,ai}/...`
  exposes domain services and repositories by their extracted file names.
- `@ulpin/server/shared/...` exposes the pure legacy identity, geometry, URL,
  attribution and record DTO helpers used across backend and current clients.

The package exports source TypeScript for the existing `tsx` tools and Next
compatibility callers. `pnpm --filter @ulpin/server build` typechecks every
extracted file and emits independently loadable bundles for each mapped module
under `dist/`. The Nest application bundles workspace source into its own
artifact. Production startup uses the API artifact, not a Next server import.

`settings.repositoryRoot` and `settings.fixtureRoot` are anchored to this
repository, independent of the process working directory. `ULPIN_FIXTURE_ROOT`
remains an explicit override. `.env` is read from the repository root without
copying it. `REPO_DATA=true` still selects only the isolated repository
environment; `false` retains the linked environment behavior.

## Backend commands and retained web references

Root `dev` and `start` run Nest plus the existing dispatcher; root `build` and
`typecheck` target the backend packages. `web:dev`, `web:start`, `web:build`,
`web:typecheck` and `web:demo` explicitly retain the user-owned Next UI. The
compatibility UI launcher starts no processing services, migrations or seeds.
The saved-snapshot `test:fresh-install` command now exits with a retirement
notice pointing to the authorized real-source runtime guide.

Backend scripts and unit tests import canonical server modules. Remaining
`apps/web` references in tools have these bounded purposes:

- Actual browser, asset and UI checks: `scripts/spatial/browser*.mjs`,
  `scripts/copy-viewer-assets.mjs`, `scripts/studio/acquire-materials.py`,
  `scripts/ux/verify-{complete-journey,source-intake}.mjs`,
  `scripts/usp/gf/FND-06-browser.mjs`, and the icon warning tool. They remain
  legacy UI tools and do not qualify the migrated backend.
- Actual UI tests: `studio-*.test.ts`, `v2-*.test.ts`, building-scene,
  scoped-svg-export, preparation-continuation, local-session, source-purpose,
  mask-pixels, intake-routing and survey-render. The mixed spatial-core and
  ML-page tests retain only their browser/runtime or UI-helper assertions;
  their backend imports use this package.
- Source audit and historical receipts: `scripts/usp/gf/GF-CONTRACT.mjs`
  checks canonical server producers while retaining actual UI consumer rows.
  Its historical inventory receipt is preserved; the current source-only
  inventory is `docs/engineering-plan/contract-inventory.json`. Neither
  refresh establishes new runtime qualification. The lead-owned
  `scripts/api/**` checker is being migrated separately; `scripts/db/**`
  intentionally reads the original Git tree to verify SQL lineage.

Paused USP replay/preview launchers remain fail-closed. No retained web
reference permits restoring authored saved-state bundles or reseeding data.
