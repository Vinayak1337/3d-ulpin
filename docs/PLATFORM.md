# Local demo platform

The demo preserves the planned PostgreSQL/PostGIS, private S3-compatible storage,
Redis, FastAPI, and Celery stack. Next.js and the application dispatcher run on
the host; their database migrations and start commands are documented in the
root README. The platform is for local demonstration with one fixed demo actor.

## Start and stop

On Apple Silicon macOS, install prerequisites once:

```sh
brew install colima docker docker-compose
```

Start the platform from the repository root:

```sh
bash scripts/platform-start.sh
```

The script creates `.env` only when it is absent, starts the dedicated `ulpin`
Colima VM when needed, starts persistent services, builds the geometry image,
and verifies database, object storage, Redis, FastAPI, and the Celery worker.
The VM uses 4 CPUs, 6 GB RAM, a 20 GB maximum disk, Apple Virtualization, and
Rosetta support. Images and persistent data share that virtual disk.

To bring up only the data services during development:

```sh
bash scripts/platform-start.sh --infra-only
```

Repeat the checks or stop services without removing stored data:

```sh
bash scripts/platform-health.sh
python3 scripts/platform-smoke.py
bash scripts/platform-stop.sh
```

`platform-stop.sh` preserves every named volume. To also release the VM's memory
after the demo, run `colima stop --profile ulpin`. Never run `docker compose down
-v` or `docker volume prune` to reset a demo case: those commands can destroy all
cases and uploads. Use the application’s case reset instead.

The scripts use the `colima-ulpin` Docker context when it exists and support both
`docker compose` and Homebrew's standalone `docker-compose`. They do not rewrite
Docker's global configuration. To use an already configured different Docker
runtime, set `ULPIN_DOCKER_CONTEXT` to its context name before running them.

## Connections and ownership

All published ports bind only `127.0.0.1`:

| Service | Host address | Container address |
| --- | --- | --- |
| PostgreSQL/PostGIS | `127.0.0.1:15432` | `postgres:5432` |
| S3 API | `http://127.0.0.1:19000` | `http://minio:9000` |
| MinIO console | `http://127.0.0.1:19001` | `minio:9001` |
| Redis | `redis://127.0.0.1:16379/0` | `redis://redis:6379/0` |
| Geometry API | `http://127.0.0.1:18000` | `http://geo:8000` |

The private bucket is `ulpin`. MinIO startup creates it idempotently and applies
the private policy. The application creates and verifies source objects before
finalizing uploads; public anonymous bucket access is disabled.

`.env` holds generated local-only secrets and is never committed. The host
application consumes `DATABASE_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`, `GEO_URL`, `GEO_SERVICE_TOKEN`, and
`REDIS_URL`. Compose explicitly overrides the geometry service’s S3 and Redis
addresses to their internal Docker names. Keep `.env` with the named volumes:
changing a database password in the file does not change a password already
initialized inside PostgreSQL.

The geometry API's `/health` route is unauthenticated; `/internal/ready` and
operations use the shared `GEO_SERVICE_TOKEN`. Readiness performs real Redis
and Celery worker pings. The app's `/api/v1/health` includes separate processor,
Redis, and worker booleans, so a running API with a stopped worker is unhealthy.
The geometry service owns processing only. Next.js owns application records,
authorization boundaries, revision writes, migrations, and job dispatch.
Celery uses `geo.tasks:celery_app` with concurrency 2.

## Verification and recovery

The health script executes real `PostGIS_Full_Version()`, checks Redis, uploads
and reads back an exact marker through S3, removes that marker, confirms private
bucket policy and anonymous HTTP 403, then checks the API and worker ping. It
does not print credentials. These checks verify the processing platform; they
do not replace application migrations or the end-to-end demo acceptance test.

`platform-smoke.py` submits an authenticated processing job through FastAPI,
waits for the actual Celery result, and verifies independent 96 / 102.4 m³
volumes and a 6.4 m³ overlap. It also checks rejected anonymous access, duplicate
request idempotency, and conflicting job reuse. Its synthetic units stay in the
processor's Redis job records; no application cases or source records change.

View bounded recent service logs without exposing the resolved Compose config:

```sh
docker-compose --profile app logs --tail 50 geo worker
docker-compose ps
```

If services are stopped or unavailable, rerun the start command. If a build
fails, keep the existing data volumes, inspect the relevant service logs, and
retry after fixing the cause. `platform-env.sh` always preserves an existing
`.env`; restore the original local secrets rather than generating new ones for
an existing database. Containers restart automatically with the Docker VM,
except the one-shot private-bucket initializer.

PostGIS runs as `linux/amd64` through Rosetta on this Apple Silicon machine. The
other images and Python geometry worker use native ARM64 when available.

## Image availability

The official MinIO Docker Hub server image could not be pulled during setup.
The demo uses the verified official Quay release from April 2025, pinned by
content digest, with the official August 2025 `mc` client also pinned. The
September 2025 tag shown in upstream's sample Compose file was unavailable.
MinIO now distributes community releases as source only; before a networked
deployment, build and assess an up-to-date source release instead of treating
this local demo image as a maintained production distribution. See the
[official MinIO distribution notice](https://github.com/minio/minio#source-only-distribution).

## Verified on 12 September 2026

- Apple Silicon macOS 27, Colima 0.10.3, Docker 29.8.0, Compose 5.5.1.
- PostgreSQL 17 with PostGIS 3.5.2 executes successfully through AMD64 emulation.
- Repeated data-service startup preserves initialized state and succeeds.
- S3 marker upload/readback/delete, private policy, and anonymous HTTP 403 pass.
- FastAPI and Celery worker health checks pass with native Python 3.12.
- A real queued build produces 96 / 102.4 m³ prisms and their 6.4 m³ overlap.
- Private API authentication, duplicate job idempotency, and conflicting reuse
  HTTP 409 pass in `platform-smoke.py`.
- Authenticated `/internal/ready` returns all true; missing or invalid bearer
  tokens return HTTP 401.
- With only the worker deliberately stopped, the app reports `ok:false` and
  `worker:false` while database, storage, processor, and Redis remain true.
  Restarting the worker restores all-true app health; the worker was restored
  in a `finally` block and full platform health passed afterward.

Application-level persistence and presentation flows are verified separately by
the end-to-end demo checks.

## Repeat the coordinated restart check

With no active demo or queued jobs, run:

```sh
python3 scripts/platform-restart-verification.py --run-disruptive-checks
```

This captures every case, current model, candidate revision, finding and original
source hash; stops only the worker and exercises `pnpm demo` recovery; then
stops/restarts the complete Docker stack while retaining all volumes. It verifies
that the same IPv4 localhost web listener remains and the captured data matches.
It writes a before-restart checkpoint and, on success, final evidence under
`test-results/platform-restart-before.json` and
`test-results/platform-restart-verification.json`.

The initial full-stack attempt exposed an unhandled PostgreSQL idle-pool error
that terminated the host web/dispatcher processes during database shutdown.
The lead fixed the pool error handler and rollback error handling. The complete
rerun passed: **11 cases, 9 current models and 46 original source hashes** matched
before and after restart, including candidate revisions, complete model contents
and findings. The same IPv4 localhost web listener survived both the worker-only
launcher recovery and the full Docker restart. All five application service
flags returned true. Evidence is in
[platform-restart-verification.json](../test-results/platform-restart-verification.json)
and the broader release gate is in [HACKATHON_STATUS.md](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/HACKATHON_STATUS.md).
