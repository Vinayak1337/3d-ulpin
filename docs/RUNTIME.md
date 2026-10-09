# Selection-demo runtime

**10 October: `ulpin-demo` is running; cold/warm doctor passed.** Existing
`ulpin-repo`, worker, `ulpin-usptest-*` and `docsetu-*` projects remain untouched
and stopped. Demo is explicitly new, not a replacement or a restored snapshot.

## Commands (from any checkout with locked pnpm dependencies)

- Engine: `docker desktop start --timeout 45` on `desktop-linux`.
- **First creation only:** `pnpm platform:start --profile demo --create`.
  Generates random configuration once, starts infrastructure, private bucket
  initialization, `pnpm db:migrate`, existing lazy schema producers, then builds
  the demo-specific processor image and starts geo/Celery/API/dispatcher.
  If demo volumes exist but configuration is missing, it refuses to generate
  replacement passwords. Interrupted bootstrap requires explicit `--create`.
- **Resume / repeat safely:** `pnpm platform:start --profile demo`.
  Only starts existing containers and identity-checked native processes; no
  container recreation, migration, bucket initialization or seed on resume.
- **Doctor:** `pnpm platform:doctor --profile demo` (or `platform:health`).
  Read-only engine/context/socket, volume bindings, health/restart policies,
  DB/PostGIS, object readiness, Redis, targeted Celery heartbeat, native process
  ownership, API health and manifest/schema/database-binding checks. Exit 0 is
  green. Dispatcher liveness is not a job-execution proof.
- **Stop all demo services:** `pnpm platform:stop --profile demo`.
  Stops only owned API/dispatcher and demo containers; all volumes preserved.
  `ULPIN_PROFILE=demo` is an alternative process-only selector.

| Loopback service | Port |
| --- | --- |
| API (`/api/v1/health`, `/api/v1/areas`) | 3194 |
| PostgreSQL / Redis | 15434 / 16381 |
| MinIO S3 / console | 19020 / 19021 |
| Geo processor | 18002 |

## Configuration, data and limits

Shared private configuration: `E:/BhuAayam-data/runtime/ulpin-demo/demo.env`;
random secrets, restricted operator/SYSTEM/Administrators ACL, never printed or
committed. Native logs/process records and the empty model mount live beside it.
The demo launcher supplies configuration and blocks the legacy server's checkout
`.env` probes before importing it. Model gateway is disabled; no provider key or
call. Operator subject is process attribution, not human authentication.

Data lives in `ulpin-demo_{postgres,minio,redis}-data` inside Desktop's managed
VM. Schema setup inserted **no domain records**: only seven migration markers
and PostGIS's CRS catalog. Existing-unit/site backfills inserted zero rows.
K2 must populate through real import routes. Legacy linked/`REPO_DATA=true`
commands retain their setup route, but require their original configuration and
existing volume bindings; missing credentials never authorize regeneration.

**Never delete/reset/prune volumes, VM disks, uploads, originals, review history,
configuration or socket backups; never reseed or use `down -v`.** Originals and
models remain under `E:/BhuAayam-data/` outside Git.

**Desktop recurrence remains unresolved:** even a graceful engine stop/start
reproduced the inaccessible `sailor-ingest.sock` rename in the backend log.
Inspected socket-only directories were preserved as `*.saved-s03-cold-20261010-010439`
and recreated empty, allowing the measured cold start. See [issue 554](https://github.com/docker/desktop-feedback/issues/554)
and `%LOCALAPPDATA%/Docker/log/host/com.docker.backend.exe.log`; no Defender
block evidence or justified exclusion. No security-product setting changed.
Do not repeat repairs blindly; the owner should pursue the Desktop defect.
Evidence: `scripts/platform/evidence/s03/result.json`.
