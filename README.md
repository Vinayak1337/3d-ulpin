# 3D ULPIN — local area and property registry

Import a bounded area and keep its shared 3D block in view while searching a
property, opening its own register and evidence, preparing source-linked floors
and spaces, and reviewing discrepancies. The centered navigator connects the
block, property register and selected property's preparation workspace.
The saved NYC snapshot contains 62 actual footprints and reported roof heights.
The redesigned interface starts at **[/v2](http://127.0.0.1:3000/v2)**. The previous
interface, synthetic neighbourhood and rights-volume workbench remain available
at **[/legacy](http://127.0.0.1:3000/legacy)**; former page links redirect there.

Read the **[V2 delivery and demo guide](docs/V2_DELIVERY.md)** for exact routes,
actual UI captures, test results and remaining limits, and **[V2 architecture](docs/V2_ARCHITECTURE.md)**
for the component, state and route conventions. The white/green/gray design uses
a centered floating navigator, contextual map rails, register tabs and a single
document canvas with Measure, Calibrate, Compare and Build Details modes.

This is a **local, single-operator demonstration** with separately labeled real
observations, estimates, and synthetic scenarios. It does not issue
official ULPINs or confer ownership. The stack
retains Next.js, Cesium, PostGIS, private object storage and Python processing.

Start with **[local startup and officer demonstration](docs/OFFICER_STARTUP.md)**,
the **[implementation ledger](docs/REAL_BLOCK_EXECUTION.md)** and
**[current verification](docs/OFFICER_DELIVERY.md)**. Native related-document
preparation, exact parcel/public-context checks, evidenced utility profiles and
persisted investigations run locally. Optional [Nous assistance](docs/OFFICER_AI.md)
requires an authorized, verified free route; no live inference was available in
the recorded run. Permitted coherent Indian sources, building-specific plans
and surveyed utility evidence remain external acceptance gates.

[AREA_WORKFLOW.md](docs/AREA_WORKFLOW.md) preserves the earlier area ingestion
workflow. The root
**[REGISTRY_DEMO_GUIDE.md](REGISTRY_DEMO_GUIDE.md)** retains the
complete correction and excavation presentation. See [registry data/API](docs/REGISTRY.md)
and [verification evidence](docs/REGISTRY_TEST_EVIDENCE.md). The later
[deep review](DEEP_REVIEW.md) records corrected edge cases and remaining gaps
against the agreed plan.

**Hosting:** the complete stack cannot run unchanged on Vercel alone. See
[HOSTING.md](docs/HOSTING.md) for the existing deployment assessment.

## Start the demo

**Use the complete saved dataset from this repository:** follow
[repository-data setup](repo-data/README.md). Run `pnpm repo:init`, set
`REPO_DATA=true` in `.env`, then build/start the app. The bundle includes the
saved database, plans, PDFs, source revisions and presentation-asset bindings.
`REPO_DATA=false` keeps using your existing linked environment settings.
The two modes use separate persistent services; restart the app and dispatcher
after switching. No reseeding or overwriting of existing data is required.

For the illustrated user guide, run `pnpm guide` from the repository root and
open [the visual guide](http://127.0.0.1:3011) in your browser or Codex's in-app
browser. It serves the 13 annotated tutorials independently of the application;
The launcher uses Node.js on Windows, macOS and Linux; Python, Bash and the
database/processing services are not required for the guide. Use `pnpm guide --port 3012`
for another port, or `node scripts/guide.mjs` without pnpm. Keep
the terminal open; **Ctrl+C** stops the guide. You can also open
`docs/tutorial-images/index.html` directly for offline viewing.

On this configured Mac, double-click **Start Demo.command** in the project
folder, or run this from the repository root:

```sh
pnpm demo
```

Open [the area workspace](http://127.0.0.1:3000) and keep its terminal open. The launcher
installs locked JavaScript dependencies, starts the platform, applies database
migrations, builds the production web application and runs both the web server
and application job dispatcher. It reuses an already running workbench; stop
that terminal with **Ctrl+C** before requesting a fresh production build.
If the workbench is reachable but a processing service is unhealthy, `pnpm demo`
recovers the platform and migrations before returning to the existing server.

On a fresh database, open **Data sources → Open saved snapshot**, review the
62 building observations, and record them with an acknowledgement of the source
limitations. Use **Refresh source** only when a new bounded download is wanted.

For the older demonstration, open [Legacy registry](http://127.0.0.1:3000/registry)
and choose **Load synthetic neighbourhood**. The seed runs
actual inspection, preparation, Python building and registry review. Subsequent
loads preserve operator revisions. The default property-volume view displays
both adjoining buildings, one shared basement and one cross-parcel corridor.
The old [C-001 showcase](http://127.0.0.1:3000/workbench?case=d34cacf3-f4fc-4ac2-a282-9058fc4ea0e5)
and **Preparation workspaces** remain available.

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

The local production build retains the baseline client-minification exception
for Cesium compatibility; server optimization remains enabled. The earlier
baseline measured about 17.8 MB uncompressed client JavaScript. Current local
interaction measurements are in the [officer verification](docs/OFFICER_DELIVERY.md);
public distribution would need a separate delivery/performance assessment.

## Legacy workbench story

**New: visible prototype 3D ULPINs and a real-data example.** The parent ID is
above the viewer; **View identifiers** opens the floor/space register. These
are prototype workspace IDs, not government-issued ULPINs. See
[the identifier format](docs/PROTOTYPE_IDENTIFIERS.md).

For downloadable demo files and public data, open **Sources → Demo files &
public data** or [DEMO_DATA.md](DEMO_DATA.md). A new workspace can load
**NYC · Public building footprint**, a real public footprint/roof-height sample
converted into an exterior envelope. Interior floors remain unknown. C-001 and
C-002 remain synthetic examples for the interior-space correction workflow.

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

For the legacy workbench walkthrough, open the [UI demo guide](3D_ULPIN_UI_Demo_Guide.docx) at the repository root. A copy is also available in `docs/`.
It includes current screenshots, exact clicks, expected results and a five-minute
presenter script, from a fresh C-001 workspace through correction and refresh.

For your own inputs, choose **Import files** and the matching profile. Supported
inputs are local metric JSON, level CSV, control CSV, PNG and PDF, up to 16 MiB
per file. PNG/PDF references require manual two-point calibration and tracing.
Choose **Preview** beside a source or **Preview file** next to its download
action to read the original inside the workbench. Evidence bindings and
contributing sources in findings open the same viewer. CSV files appear as
tables with an original-text toggle, JSON is formatted for reading, and PNG/PDF
plans support zoom (and page selection for PDFs). Previews are read only;
downloads and explicit evidence application remain available. Large text/table
previews show their display limits; the download always contains the full file.
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
pnpm test:scene
pnpm test:e2e
```

Before the first browser test on a new machine, run
`pnpm exec playwright install chromium` to install the test browser.

The commands have different roles: platform checks exercise actual services;
`test:demo` executes both source-to-model correction journeys; `test:api` checks
adversarial requests; `test:scene` verifies architectural presentation geometry;
`test:e2e` exercises browser controls. API test cases are
labelled **Regression** and remain available for inspection. All eight production
browser workflows passed, including architectural presentation, three consecutive
C-001 rehearsals and actual PNG/PDF tracing. See [browser evidence](docs/BROWSER_TEST_EVIDENCE.md)
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
