# NestJS backend migration and delivery ledger

Owner: lead. Authorized by the user on 26 September 2026. Read this before every migration assignment, review or integration. This is the current execution document; it supersedes older instructions to retain Next.js as the application backend. It does not change GF0–GF5 acceptance or authorize frontend work.

## Outcome and decisions

Deliver an independently runnable, modular NestJS API in `apps/api`, reusable backend/domain code in `packages/server`, canonical wire schemas in `packages/contracts`, and readable SQL in `database/`. Preserve PostgreSQL/PostGIS, private S3 originals, Redis/Celery, the TypeScript dispatcher and private Python processors. The user owns the React/Vite frontend. Do not create frontend apps, alter screens or delete `design-mockup/`.

Use `pg`, parameterized SQL, explicit transactions and typed repository results. Do **not** introduce Prisma, another ORM, a second job queue or a competing database/migration authority during this extraction. Existing spatial SQL, roles, constraints, backfills and stale-result fencing must survive. Zod validates external/runtime values; TypeScript row types alone do not prove that a SQL query matches the database. Add meaningful result validation at changed trust boundaries rather than pretending all SQL is statically checked. A future typed-query generator is a separate decision, not a prerequisite for this migration.

Make SQL understandable and executable from one authority. Extract the actual existing migration statements into named `.sql` files with an ordered manifest and a concise schema/relationship guide. Preserve transaction boundaries, locks, conditional migrations and parameterized data-dependent steps; do not flatten them into an unsafe reset script. Never run these against linked/populated services as part of extraction. A schema catalogue must say whether it is a reference or the executed authority; finish the migration with the files wired into the existing migration entry point.

Build a modular monolith. Nest modules/controllers own HTTP transport; framework-independent services own decisions, repositories own persistence, and shared infrastructure owns database/storage/config/provider boundaries. Reuse sound business logic. Improve concrete defects and coupling found by the audit; do not merely put one catch-all controller around the old Next dispatcher or add layers with no responsibility. Cross-domain calls use explicit public exports; no package may import `apps/web` after extraction.

Current baseline: `919a839c36b257d991e822d98470a2fb6d5df4da`. The accepted [audit](../api/apps-web-extraction-audit-2026-09-26.md) covers 399 web files; the [operation ledger](nestjs-operation-ledger.json) pins 132 existing operations. Reconcile staging before every new assignment. Historical D0/D1 pins remain historical.

## Compatibility and improvements

- Keep `/api/v1`, body/query shapes, explicit success statuses, error envelopes, revision/idempotency semantics, original/download hashes, content disposition and private cache policy. Nest POST defaults must not change an existing 200 response to 201 accidentally.
- Preserve JSON, bounded multipart, raw upload and binary response semantics. Centralize transport limits/error handling without buffering arbitrarily large originals or trusting only `Content-Length`. Do not enable wildcard CORS or trust forwarded headers. Bind loopback and enforce Host/origin protections; remote multiuser authentication remains a separately qualified capability.
- Replace the misleading local demo principal with an explicitly configured/local operator context where safe; never assert real human authentication. Preserve attribution of historical events. No silent rewrite of existing actors.
- Retire reachable authored synthetic generation and demo-only write branches by exact operation/branch classification, with an explicit unavailable/retired response. Preserve historical records, originals, read compatibility and genuine official-source asset paths. Synthetic-only dataset ingestion needs a provenance-backed supported profile, not a changed label. Unknown frame/permission remains unknown.
- Keep renderer decoration separate from analytical facts. Extract the server's pure identity, geometry, CityJSON and scene-compilation dependencies from frontend-named directories; do not change the user-owned renderer. Do not publish inferred architectural details as official evidence.
- Existing Next routes/re-exports are temporary compatibility adapters only. Delete `apps/web` only after the frontend owner has preserved the browser/asset/deep-link functionality and no backend runtime or tool imports it. Backend independence is required now; frontend deletion is not a reason to discard useful code or data.

## Batches and ownership

Use ordinary GPT-6 Sol tasks, max reasoning initially, each in its own worktree from accepted staging. Fast is requested; record configured versus observed tier honestly. The lead owns this plan, shared assignment decisions, integration, final OpenAPI/data catalogue and final cleanup. Workers do not create more workers. One writer per path; multiple implementation lanes are explicitly authorized for this migration.

| Batch | Deliverable and scope | Dependency / ownership |
| --- | --- | --- |
| NEST-00 foundation | Extract the full backend dependency closure into domain folders under `packages/server`, with narrow compatibility exports in old paths. Explicit repository/config roots, independent server typecheck/build, Nest application/common HTTP infrastructure and health/workspace/root endpoints. Repoint dispatcher/migration entry points. Return exact old→new path map and controller authoring contract. | First. Sole owner of root/app package manifests and lockfile, `apps/api` bootstrap/common, `packages/server` initial extraction, compatibility exports, dispatcher/migrate imports. No domain-controller batches or final API docs. |
| NEST-01 SQL | Extract exact existing migration SQL into readable grouped files, ordered manifest, provenance/source mapping and schema guide. Explicitly document data-dependent/conditional steps. | Parallel to NEST-00, owns `database/**`, `scripts/db/**` only. Initially no old/new server file edits. After both integrate, same worker wires SQL authority in an explicitly assigned second step. |
| NEST-10 intake | Cases, source uploads/downloads, jobs/retry/build/preparation, areas, import packages, document association, acquisitions and source workspaces. Native controllers plus bounded service/repository improvements; retire synthetic scenario/demo generation. | After NEST-00. Own `apps/api/src/modules/intake/**` and assigned cases/areas server modules. 43 baseline operations; foundation owns three general endpoints. |
| NEST-11 register | Registry/resolver/draft/review/commit/export plus officer associations, groups, preparation, investigations and work queues. Split demo-only rights branches without discarding the real importer. | After NEST-00. Own `apps/api/src/modules/register/**` and assigned registry/officer server modules. 40 operations. |
| NEST-12 evidence | USP scopes, snapshots, original evidence, proposals, immutable identity, exchange, packet/create/download and exact-revision/privacy boundaries. | After NEST-00. Own `apps/api/src/modules/evidence/**` and assigned USP service modules. 18 operations. Shared principal/error/DB seams remain foundation-owned until explicit handoff. |
| NEST-13 spatial/AI | Spatial reads/scenes/external assets, datasets/search/originals, dataset ML, spatial ML and officer AI. Preserve private provider/job authority and replace/retire synthetic-only operational paths. | After NEST-00. Own `apps/api/src/modules/spatial/**`, `apps/api/src/modules/ai/**` and assigned spatial/dataset/AI services. 28 operations. |
| NEST-20 integration | Register reviewed modules, remove backend dependency on web paths, synchronize SQL wiring/build/container/runtime commands, bounded official-source live API qualification and meaningful recovery/privacy checks. | After relevant batches; lead coordinates one integration owner and an independent bounded reviewer when useful. No fixture seeding or live provider calls. |
| NEST-21 handoff | Lead updates OpenAPI schemas/operations/statuses, source pins/checker, Swagger UI/readable docs, linked dataset catalogue, actual API startup instructions and remaining qualification gaps. Merge all accepted work, then delete completed worktrees/branches after reconciliation. | Lead, after implementation stabilizes. Every baseline operation explicitly retained/replaced/retired; new ones documented. |

Counts come from the operation ledger, not guessed controller counts. If actual dependencies cross ownership, ask the lead for a narrow handoff; do not silently edit another lane. Code transport helpers may adapt standard Request/Response for bounded existing parsers, but route families need explicit Nest controllers and operation mappings, not a hidden catch-all router.

## Acceptance and lean checks

Each API worker also returns an operation manifest plus exported request/response/error schema metadata derived from actual validators and service types. The current catalogue uses `UnresolvedJson` in 122 of 132 operations; the migration must replace avoidable placeholders with known envelopes and model schemas, while genuinely unconstrained values remain explicitly typed as such. Workers own metadata beside their module, not the final OpenAPI. The lead assembles and checks the published specification.

Each worker: inspect producer/consumer contracts, typecheck owned packages, run directly relevant existing checks once, verify one meaningful affected success/failure path when the isolated environment is available, and return commit(s), actual commands/exits, exact operation disposition and any unresolved source/runtime limits. No new exhaustive test project. Small tests for real transport, privacy, transaction, source integrity or stale-publication risks are appropriate. Test process control with existing real source bytes; never manufacture operational facts.

Integration: frozen install and backend build/typecheck; complete 132-operation disposition with no silent drop; backend dependency closure has no `apps/web` imports; visible SQL agrees with runtime migrations; API startup works without Next; current guarded health/source→job→record plus failure/recovery receipt; changed access/private-download semantics checked; preserved original hashes and unchanged protected assets. Runtime failures are fixed or explicitly block the affected acceptance, never marked passed from documentation alone.

OpenAPI must expose models, request/response/error shapes, limits, idempotency/revision rules and code/runtime availability. Dataset entries link issuer/original URLs, local manifest, hashes, format/profile, geography/frame, permission/limitations, route journey and actual availability. Restricted originals stay outside Git. Community OSM is not official; DATA-10 Karnataka district boundaries have unresolved use permission and do not qualify a 3D city. Do not invent installed IDs or example records. Swagger UI is loopback documentation served by the API, with no automatic write actions.

## Continue the backend after migration

Resume the dependency-ready backend plan from actual code/evidence, not its old task wording: finish GF-BACKEND/RUN-01 on Nest; resolve official Indian scale-source permission/coverage; implement INGEST-06 only for a real receipt-size need; then private generation/streaming TILE-01 and bounded GF-SCALE-1. Follow GF1–GF5 dependencies for IDs/exchange, qualified geometry, evidence/readiness and scoped cards. All public portal work remains full product. Missing official data blocks only the dependent claim, not unrelated coding. No push, main merge, deployment, provider call or public activation is authorized.

## Resume checklist and current status

1. Read this ledger and the operating guide; inspect current staging and user index.
2. Read only active worker completion/progress and affected contracts; do not restart accepted work.
3. Review and merge one owned result, then dispatch dependency-ready non-conflicting work.
4. Keep OpenAPI final edits with the lead. Record real runtime limitations and preserve originals.
5. Reconcile every worker commit/dirty file before removing its worktree. Preserve the user's staged skills.

| Batch | State | Accepted commit / next action |
| --- | --- | --- |
| NEST-00 | running | Sol/max task `01a0db54-338c-7950-8101-46012dd75688`, worktree `45f5`, base `39a70488`. |
| NEST-01 | running | Sol/max task `01a0db54-6463-72c3-85e2-67b10711c080`, worktree `a1f7`, base `39a70488`. Phase 1 extracts SQL; phase 2 wires after foundation. |
| NEST-10–13 | waiting for foundation | Assign exact moved paths from NEST-00 map. |
| NEST-20–21 | pending | Integration/runtime checks, lead docs and cleanup. |

Framework references checked for this decision: [Nest controllers](https://docs.nestjs.com/controllers), [Nest database integration](https://docs.nestjs.com/techniques/database), [node-postgres parameterized queries](https://node-postgres.com/features/queries), [Prisma unsupported-field/raw SQL guidance](https://docs.prisma.io/docs/orm/prisma-client/using-raw-sql/safeql). These inform the architecture; they do not prove this repository's runtime behavior.

Worker metadata observed for both initial tasks: model `gpt-6-sol`, effort `max`; per-turn service tier not exposed. Both own separate worktrees.
