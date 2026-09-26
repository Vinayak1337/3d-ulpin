# Local backend startup boundary

Updated 26 September 2026. Active planning is [backend-only](usp-agent-handoffs/current-delivery-policy.md); the user owns the UI. This page replaces old synthetic-demo and snapshot-bootstrap instructions. See the [native API guide](api/README.md) for current commands, Swagger, schemas, dataset links and bounded runtime receipts. A standing preview is not maintained.

The independent application backend is NestJS in `apps/api`, domain modules in `packages/server`, and visible SQL in `database`, with PostgreSQL/PostGIS, private object storage, the application dispatcher, a private Python job API, Redis/Celery and processing workers. The dispatcher is required for queued application work to reach the private worker. Keep one registry, source store and job authority. See [architecture](ARCHITECTURE.md), [H01](usp-agent-handoffs/01-shared-contracts-and-ownership.md) and the [backend route/cleanup plan](usp-agent-handoffs/backend-cleanup-plan.md).

The API defaults to `127.0.0.1:3188`. Use the [guarded nonce runtime](../scripts/usp/REAL_SOURCE_RUNTIME.md) for fresh isolated service checks. Root `pnpm build` builds the backend; `pnpm dev`/`pnpm start` run the API and dispatcher. Both require an explicit `ULPIN_LOCAL_OPERATOR_SUBJECT` before startup. The temporary Next UI has separate `web:*` commands and is not required by the backend.

## Before an assigned local run

1. Pin the accepted `staging` revision in the assigned worker worktree and coordinate service/port ownership with the lead. Inspect current package/service configuration after cleanup; do not copy command sequences from historical reports.
2. Preserve credentials and all populated volumes. Select the existing isolated test environment explicitly; `REPO_DATA=true` must not be treated as permission to restore a retired snapshot or synthesize a dataset. The linked environment is not a disposable test service.
3. Use locked dependencies and existing build/server isolation guards. Start only the services needed for the assigned check, with providers disabled unless separately authorized. Record exact command, exit, process/container/volume identities and stop command without secrets.
4. If a UI preview is specifically needed, follow the operating guide: check loopback port 3187 is free, do not kill unrelated listeners, and stop owned application processes afterward while preserving data. RUN-01 schedules backend API startup and real-source smoke checks; UI redesign is not part of that task.
5. Import only explicitly selected unchanged official-source inputs through existing supported services, with provenance and permission. Missing source coverage stays unqualified; no implicit seeds, historical D0 replay or mixed-bundle restore.

## Retired instructions and preserved evidence

The old repository/Uttam bootstrap, synthetic officer/registry/Lake View walkthroughs and fresh-install reseeding recipes are retired. Their source code and historical run records are not a current startup contract. Previous guide text is recoverable at `92e4d04cdeaaa2d8ccc65680c6fea1675dcee88a:docs/OFFICER_STARTUP.md`.

Keep real NYC/D1 and other gathered originals with hashes, reference frames and limitations; [source reference notes](../DEMO_DATA.md) describe their lineage. Recorded D0/PACK0 and D1 receipts remain historical evidence. Runtime qualification requires an actual current service run; a reachable UI, historical screenshot or documentation change does not establish it.
