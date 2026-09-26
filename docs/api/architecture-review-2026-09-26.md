# Backend separation review — 26 September 2026

Reviewed directly by the lead at staging `ac24ba1dca8aecafd4d49d818fbfc8f738824b4c`. This is a code-based assessment and proposed migration direction, not an adopted framework change or runtime qualification. No application files were changed or removed. RUN-01 was paused and its owned processes/containers stopped; its volumes and uncommitted work remain preserved.

## Recommendation

Use a standalone NestJS application API and React + Vite for the officer Studio if the team adopts this stack change. Extract and reuse the existing TypeScript domain services; retain the Python FastAPI/Celery processing service, PostGIS, private storage and dispatcher. Delete `apps/web` only after the backend and its non-UI dependencies have moved, consumers have switched, and the replacement passes bounded real-source compatibility checks.

Separating the API is the essential change. NestJS is a suitable organizational choice for the number of domain areas, validation/access boundaries and desired Swagger documentation; adopting it does not itself fix business logic, provenance, authentication or performance. A full rewrite, new ORM or replacement queue is not needed for this separation.

React + Vite fits Studio's interactive map/document/officer workspace. The frontend owner must explicitly select routing, data fetching and production deep-link handling; Vite alone does not supply those application concerns. Preserve the renderer and inspection capabilities independently of the frontend build-tool choice. The deferred public app can make its rendering/SEO decision later; this review does not bring public work into the finale.

## Where the backend actually lives

| Current location | What it contains | Effect of deleting `apps/web` first |
| --- | --- | --- |
| `apps/web/app/api/` | 14 tracked route files, including catch-all dispatch, representing 132 documented method/path operations over 123 paths | Application HTTP interface disappears |
| `apps/web/lib/server/` | 73 tracked files: domain logic, SQL/migrations, transactions, source storage, imports, registry, officer workflows, processing dispatch/result ingestion, AI gateway integration and evidence services | Most TypeScript application backend disappears |
| Other `apps/web/lib/` and `apps/web/features/spatial/` modules | Shared identifiers, schemas, source/package normalization, geometry helpers and spatial adapters also imported by the backend | Moving only `lib/server` leaves broken imports or missing behavior |
| `scripts/dispatcher.ts` | Durable application job dispatcher; imports processing and DB modules from `apps/web/lib/server` | Dispatcher can no longer start |
| `scripts/migrate.ts` | Schema and private-bucket setup; imports DB/storage from `apps/web/lib/server` | Migration/startup command breaks |
| `packages/contracts/` | Shared TypeScript and schema contracts | Survives, but does not contain the application backend |
| `services/geo/` | Private Python FastAPI service, Celery/Redis jobs, GIS/document inspection and geometry processing | Survives, but cannot replace the removed application authority |
| `compose.yaml` | PostGIS, object storage, Redis, processor and worker configuration | Infrastructure remains; it does not restore application services |

`apps/api`, `apps/studio`, `apps/global` and `packages/server` are not implemented directories in the reviewed staging checkout. The previously discussed package separation is still planned. Recent completed work includes plan normalization, source/legacy cleanup and the reviewed API inventory; those are not evidence of an already extracted NestJS backend.

## Existing API types

The application uses HTTP endpoints, principally JSON resource operations and POST commands, plus multipart/raw-byte uploads and binary/document downloads. Current transport is Next route handlers using standard `Request`/`Response`, not a GraphQL or tRPC server. No implemented SSE/WebSocket transport was found in the reviewed API/server code; progressive streaming requirements in the plans remain separate.

| Family | Documented operations | Examples of responsibility |
| --- | ---: | --- |
| Cases, original sources, units, jobs and health | 16 | Create/read cases, preserve source bytes, prepare/build, edit units, retry jobs |
| Area/import packages and supporting documents | 29 | Inspect GIS, acquire/import, source workspaces, review/correct/commit packages |
| Officer workflows | 23 | Work queue, dossier/register, preparation and investigations |
| Registry | 17 | Sites, draft/review/commit and identifier resolution |
| USP evidence and identity | 18 | Pinned snapshots, scoped reads, evidence originals, proposals, identity, CityJSON and packets |
| AI extraction and spatial ML | 16 | Status, jobs, review/apply and controlled artifacts |
| Saved spatial datasets and dataset ML | 7 | Package intake, search, original reads and associated ML sources |
| Spatial reads, scenes and calibration assets | 5 | Bounded scene/core projections and private asset delivery |
| API root | 1 | Entry information |

These are implemented dispatch counts from [OpenAPI](openapi.json), not 132 runtime-qualified product capabilities. Several wire payloads remain explicitly unresolved. The private Python API separately exposes job submission/polling, readiness, registry checks, area processing and ML readiness, protected by a service bearer token. It should remain inaccessible to browser clients.

## Findings that determine migration scope

1. **Deletion is currently destructive to the backend.** Dispatcher and migration imports above demonstrate this directly. A source/import dependency scan also found 23 scripts and 22 tests referring to backend paths under `apps/web`; those references need explicit relocation or retirement review.
2. **The domain code is relatively portable, but the dependency boundary is incomplete.** No direct `next/*` imports were found in the server modules or API handlers. Next-specific route discovery/exports, promised route params and build/start setup remain. `config.ts` loads `.env` and fixtures using current-directory assumptions. Migrate those to explicit application configuration without leaking or copying credentials.
3. **Backend code depends on directories named as frontend features.** `spatial-datasets.ts` imports `features/spatial/reference-import/browser` and reference identifier code; `spatial-core-http.ts` imports the legacy adapter/types there; `spatial-ml.ts` imports `lib/ui/geometry`. Move the required pure normalization/geometry/contract code according to responsibility. Do not copy the entire viewer into the API or delete these dependencies because their directory names look visual.
4. **A synthetic-only intake path remains.** `features/spatial/reference-import/adapter.ts:13,33` requires literal synthetic classification. `lib/server/spatial-datasets.ts:44,50,58` writes a fictional description and synthetic world/classification values. This is a legacy synthetic-reference workflow, not qualified official-source ingestion. Earlier asset cleanup did not remove this code path. It needs an explicit replacement/retirement decision and provenance-backed intake; renaming the values to real/official would be incorrect. Existing uncertain records must not be silently relabelled or bulk deleted.
5. **Local guards are not production identity.** `lib/server/usp/principal.ts` enforces loopback and supplies a fixed local operator principal. Preserve that restriction during extraction. Multi-officer authentication, roles and ownership enforcement need their actual planned implementation before remote deployment. Nest guards are a mechanism, not proof this is implemented.
6. **HTTP behavior must survive the framework change.** Keep `/api/v1` paths, precise status codes, error envelopes, upload limits, multipart/raw parsing, UUID/revision/idempotency rules, private cache headers, byte hashes and download names. Nest's default POST status is 201, while existing commands also use 200/202; configure deliberately. Do not let a controller framework consume multipart/raw streams before the required bounded parser.
7. **Keep the current processing authority split.** The TypeScript application owns canonical DB writes; the dispatcher submits/polls Python work and validates results. Keep stale-result protection, fingerprints and transactions. Moving controllers must not introduce a second job queue, store, inferred geometry or duplicate source authority.

## Proposed structure

```text
apps/studio/          React + Vite frontend, owned by the frontend team
apps/api/             NestJS HTTP controllers, access guards and API documentation
packages/server/      Reused application/domain/DB/storage/job services
packages/contracts/   Shared canonical schemas and wire contracts
services/geo/         Existing private Python FastAPI + Celery processing
scripts/dispatcher.ts Existing dispatcher, updated to import packages/server
```

The API and dispatcher can consume the same canonical server package without putting business rules in two places. Put each HTTP route family in a cohesive Nest module, but avoid a service/class per trivial function. Keep existing `pg` SQL/PostGIS transactions and shared Zod contracts; do not introduce an ORM or a competing DTO validation truth merely to satisfy framework conventions. Connect Swagger to the same published contracts. Retain unresolved schema labels until the producer is specified and checked.

The browser should use the API, never DB/private worker credentials. Prefer a same-origin `/api` reverse proxy for the frontend deployments and Vite development proxy so existing relative URLs remain useful. If separate browser origins are required, define exact origin/session/CSRF policy rather than enabling wildcard access.

## Migration sequence and deletion gate

1. Establish the standalone API entrypoint and configuration. Extract the server dependency closure and shared contracts, preserving domain behavior. Keep old routes as temporary compatible adapters during the transition.
2. Move one vertical slice: health, official-source intake, read/download, and its existing job lifecycle. Use actual permitted bytes and the actual supported source profile. Test byte equality and one retry/recovery boundary; do not manufacture a source to satisfy the route.
3. Move the remaining required route families by domain. Fix/retire the synthetic-only dataset workflow explicitly. Keep provider/public features disabled until their own requirements are met.
4. Point the user-owned frontend at the API; move required asset delivery and saved-URL compatibility. Update dispatcher/migrations/configuration, build scripts, existing affected checks and the API source pins.
5. Remove `apps/web` only when no backend/runtime/script/contract dependency needs it, selected source→job→read journeys work on the standalone API, access/status/upload behavior is preserved, and the frontend owner has retained the needed inspection/renderer assets. Obsolete routes require explicit classification, not an assumption that all 132 deserve indefinite preservation.

RUN-01 has uncommitted preparatory scripts and private partial runtime observations in its own worktree. Its worker reported health, real NYC GIS byte-preserving intake and a separate derivative/job path; this was not one original→queued-job proof and was not reviewed or accepted as GF-BACKEND. All owned services are stopped. Reuse useful isolated-run tooling after the architecture decision; do not repeat or certify the old Next startup merely because it was started once.

## Framework references

- [Nest controllers](https://docs.nestjs.com/controllers): route modules, response handling and explicit status behavior.
- [Nest OpenAPI](https://docs.nestjs.com/openapi/introduction): framework-supported API documentation integration.
- [Vite guide](https://vite.dev/guide/): React/TypeScript frontend build setup.
- [React guidance on a build-tool-based app](https://react.dev/learn/build-a-react-app-from-scratch): routing, data fetching and rendering concerns that a build tool alone does not supply.
