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
