# 3D ULPIN — local property model workbench

Upload property footprints, level measurements and plan references; prepare
editable spaces; compute a 3D model; inspect evidence and overlaps; apply a
correction and rebuild. The application uses real private file storage,
PostGIS records and queued Python geometry processing.

This is a **single-operator hackathon demonstration with synthetic inputs**.
Its draft models do not establish ownership, surveyed location or an official
ULPIN. The release is **HACKATHON_DEMO_VERIFIED**: 46 Python tests, 19 API
scenarios and 6 production browser workflows passed. Exact evidence and the
original scope distinction are in [HACKATHON_STATUS.md](docs/HACKATHON_STATUS.md).

## Start the demo

On this configured Mac, double-click **Start Demo.command** in the project
folder, or run this from the repository root:

```sh
pnpm demo
```

Open [the workbench](http://127.0.0.1:3000) and keep its terminal open. The launcher
installs locked JavaScript dependencies, starts the platform, applies database
migrations, builds the production web application and runs both the web server
and application job dispatcher. It reuses an already running workbench; stop
that terminal with **Ctrl+C** before requesting a fresh production build.
If the workbench is reachable but a processing service is unhealthy, `pnpm demo`
recovers the platform and migrations before returning to the existing server.

For an immediate look, open the [prepared C-001 showcase](http://127.0.0.1:3000/?case=d34cacf3-f4fc-4ac2-a282-9058fc4ea0e5).
It contains seven spaces and the initial **6.4 m³** overlap, ready to inspect
and correct. Create a new workspace for another full rehearsal from raw inputs.

On a new Apple Silicon Mac, install Node.js, pnpm and the container runtime first:

```sh
brew install node colima docker docker-compose
npm install --global pnpm@9.12.0
```

The current machine was tested with **Node 26.7.0, pnpm 9.12.0, Colima 0.10.3,
Docker 29.8.0 and Compose 5.5.1**. Initial setup needs internet access for
dependencies and images; the core demonstration needs no AI service or map API
key. Colima uses the dedicated **ulpin** profile / **colima-ulpin** Docker
context, with 4 CPUs, 6 GB RAM and a 20 GB maximum virtual disk. PostGIS uses
AMD64 emulation; geometry processing uses native ARM64.

The first platform start creates a private, ignored `.env` with local secrets.
Keep that file with the initialized data volumes. Do not replace its database
password independently of the running database. See [PLATFORM.md](docs/PLATFORM.md)
for runtime recovery and the pinned legacy MinIO image limitation.

The local production build disables client minification to avoid a Cesium
compatibility failure. Its client JavaScript is about **17.6 MB uncompressed**;
server optimization remains enabled. This is a performance task before wider
distribution.

## Try the five-minute story

1. Click the **+** next to the workspace selector, name a new workspace, and
   choose **Create workspace**.
2. Select **C-001 · Reference building** and **Load sample inputs**. Wait for
   inspection, then choose **Prepare geometry** and **Prepare draft spaces**.
3. Choose **Build model**. Inspect seven spaces and the U01/U03 **6.4 m³** overlap.
4. Under **Sources**, choose **Load revised demo levels**. Inspect
   `levels-r2.csv`, then **Apply this level evidence**.
5. Choose **Rebuild model**. The positive overlap becomes **0 m³**. Refresh to
   reopen the persisted model and its source/revision history.

The complete narration, exact expected values and recovery steps are in
[DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). Use a new workspace for each rehearsal;
this leaves earlier cases intact. The second sample, C-002, uses different
geometry and has an initial **14.4 m³** overlap.

For your own inputs, choose **Import files** and the matching profile. Supported
inputs are local metric JSON, level CSV, control CSV, PNG and PDF, up to 16 MiB
per file. PNG/PDF references require manual two-point calibration and tracing.
[INPUT_GUIDE.md](docs/INPUT_GUIDE.md) explains formats, blank measurements,
calibration and the supplied [synthetic fixtures](fixtures/README.md).

## Understand and change it

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow, then
[IMPLEMENTATION_CONTRACT.md](docs/IMPLEMENTATION_CONTRACT.md) for API behavior.
The key learning path is:

| Area | Start here |
| --- | --- |
| Workbench, linked views and editing | `apps/web/components/Workbench.tsx`, `SpatialViewer.tsx`, `PlanView.tsx`, `SourcePreview.tsx` |
| Cases, sources, evidence and saved revisions | `apps/web/lib/server/domain.ts` |
| Durable jobs and stale-result protection | `apps/web/lib/server/processing.ts`, `scripts/dispatcher.ts` |
| Input inspection and prism calculations | `services/geo/geo/inspection.py`, `geometry.py` |
| Shared application types | `packages/contracts/src/index.ts` |

The important distinction is **received → inspected → prepared → computed**.
Uploading revised evidence does not apply it. Applying evidence or editing a
candidate requires a fresh build. Changing the camera, visible floor or floor
separation changes only the presentation.

For development, stop the production terminal first, then run:

```sh
pnpm platform:start
pnpm db:migrate
pnpm dev
```

All published services are local-only: web **3000**, geometry **18000**,
PostgreSQL **15432**, Redis **16379**, and MinIO **19000 / 19001**. Use
[application health](http://127.0.0.1:3000/api/v1/health) to inspect database,
storage, processor, Redis and worker readiness.

## Verify and stop

With the web server and dispatcher running:

```sh
pnpm platform:health
python3 scripts/platform-smoke.py
pnpm test:demo
pnpm test:api
pnpm test:e2e
```

Before the first browser test on a new machine, run
`pnpm exec playwright install chromium` to install the test browser.

The commands have different roles: platform checks exercise actual services;
`test:demo` executes both source-to-model correction journeys; `test:api` checks
adversarial requests; `test:e2e` exercises browser controls. API test cases are
labelled **Regression** and remain available for inspection. All six production
browser workflows passed, including three consecutive C-001 rehearsals and
actual PNG/PDF tracing. See [browser evidence](docs/BROWSER_TEST_EVIDENCE.md)
for exact cases, snapshots, screenshots and recordings, and
[HACKATHON_STATUS.md](docs/HACKATHON_STATUS.md) for the completed release gates.

The coordinated full-stack restart check also passed with **11 cases, 9 current
models and 46 original source hashes** preserved. To repeat it during a
coordinated idle window with no demo or queued processing in progress:

```sh
python3 scripts/platform-restart-verification.py --run-disruptive-checks
```

This briefly stops the worker, tests launcher recovery, and restarts the Docker
stack while retaining volumes. Exact evidence and recovery details are in
[PLATFORM.md](docs/PLATFORM.md).

Stop the web terminal with **Ctrl+C**, then run `pnpm platform:stop`. This
preserves cases, uploaded originals and queues. Optionally run
`colima stop --profile ulpin` to release VM memory. Do not delete Docker volumes
to reset a demonstration; create another workspace instead.

Authentication, Android collection, offline sync, formal reviewer acceptance,
official identity issuance, IFC/point clouds and automatic plan extraction are
deferred. The original handoff and its 36-row acceptance gate remain preserved
in [Astra_MVP_Handoff_Pack](Astra_MVP_Handoff_Pack/01_ASTRA_MASTER_HANDOFF.md).
