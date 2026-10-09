# Local runtime (S0.3 checkpoint)

**10 October 2026: engine recovered; GF-BACKEND BLOCKED.** Desktop is running on
`desktop-linux`. Its inventory has 24 stopped containers and 14 volumes, but **no
`ulpin` containers or `ulpin_postgres-data`, `ulpin_minio-data`, `ulpin_redis-data`**.
The existing projects are `ulpin-repo`, `ulpin-raster-worker-20260929` and two
`ulpin-usptest-*` profiles. Their contents were not inspected. Starting a new
`ulpin` project would create replacement storage, so no stack was started.

## Commands (from the checkout, Node + pnpm + Docker Desktop/Compose)

- Engine: `docker desktop start --timeout 45` (existing local Linux context).
- Start: `pnpm platform:start` — confirms existing `ulpin` volume labels and
  container mounts, then **resumes only existing** Docker services. Repeated
  starts cannot create/recreate containers, generate configuration, initialize
  buckets, migrate or reseed. `--infra-only` resumes just PostgreSQL/MinIO/Redis.
- Doctor: `pnpm platform:doctor` (also `pnpm platform:health`). Read-only checks
  cover engine/context/socket, volume attachments, container health/restart
  policies, DB/PostGIS, object-store readiness, Redis, processor, targeted Celery
  ping, dispatcher process, API `/api/v1/health`, migration structural admission
  against this checkout's manifest, and API/database binding. Exit 0 means all
  checked observations passed; dispatcher liveness is **not** a dispatch proof.
  `--infra-only` is not a full runtime pass. No secrets/configuration are printed.
- Stop: `pnpm platform:stop` — only existing `ulpin`-labelled containers; no removal.
  API and dispatcher are native processes, not services in this Compose file;
  their existing routes are `pnpm api:dev` and `pnpm dispatcher`, requiring approved
  configuration and `ULPIN_LOCAL_OPERATOR_SUBJECT`. For doctor to attest this
  checkout's dispatcher, launch the same entry with `node --import tsx` and its
  absolute `scripts/dispatcher.ts` path. Manage/stop native processes separately.
  Default API: `http://127.0.0.1:3188/api/v1/health`; an approved alternate loopback
  endpoint can be selected with `ULPIN_DOCTOR_API_URL`.

## Data and recovery

Persistent DB, objects and queues live in the **existing Docker named volumes**
inside Desktop's managed VM storage. Originals, models and archived runtime
material live under `E:/BhuAayam-data/`; credentials stay private and unchanged.
Never delete/reset volumes, virtual disks, uploads, originals, review history,
configuration or preserved socket backups. Never prune, reseed or use `down -v`.

The backend log at `%LOCALAPPDATA%/Docker/log/host/com.docker.backend.exe.log`
records startup cancellation at `2026-10-09T19:01:31Z`: rename of
`Docker/run/sailor-ingest.sock` fails, then the engine shuts down. `fsutil` also
returns Windows error 1920. With Docker stopped and WSL stopped, four verified
zero-byte reparse sockets were preserved in
`%LOCALAPPDATA%/Docker/run.saved-s03-20261010-003445`; empty directory recreation
allowed one successful startup. This matches [Docker issue 554](https://github.com/docker/desktop-feedback/issues/554),
not proof of its unclean-shutdown trigger or a permanent fix. No Docker-related
Defender event was observed; **no security setting/exclusion was changed or is
justified by this evidence**. On recurrence, inspect logs before another repair.

**Owner/lead next:** identify which retained profile contains the intended data
and approve its exact bindings/configuration; do not silently alias or restore
it as `ulpin`. Then qualify native API/dispatcher startup and cold/warm doctor.
The worker healthcheck addition needs reviewed application without recreating
storage. Evidence/checkpoint: `scripts/platform/evidence/s03/result.json`.
