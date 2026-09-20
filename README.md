# 3D ULPIN — local area and property registry

Studio is the single officer interface. Open **[the Work queue](http://127.0.0.1:3000/studio/work)** and follow **Add files → Review details → Check & record**. Documents can be retained before choosing a property; supported GIS details are inspected before asking for missing information. Saved work resumes from the queue.

Read the current **[Studio source-to-record guide](docs/STUDIO_DEMO_GUIDE.md)** for exact actions, input limits, review and export. **[Saved blocks](http://127.0.0.1:3000/studio/datasets)** keeps real datasets and fictional demonstrations separately selectable. Map, Property Register and contextual plan review share Studio navigation. Historical URLs redirect into Studio; they do not open another interface.

The **[revised references and comparisons](design/officer-studio-v3/index.html)** and **[implementation comparison](design/officer-studio-v3/implementation.html)** document this UX pass. Earlier [V2 delivery](docs/V2_DELIVERY.md) and [architecture](docs/V2_ARCHITECTURE.md) documents retain historical implementation evidence.

This is a **local, single-operator demonstration** with separately labeled real
observations, estimates, and synthetic scenarios. It does not issue
official ULPINs or confer ownership. The stack
retains Next.js, Cesium, PostGIS, private object storage and Python processing.

Start with **[local startup and officer demonstration](docs/OFFICER_STARTUP.md)**,
the **[implementation ledger](docs/REAL_BLOCK_EXECUTION.md)** and
**[current verification](docs/OFFICER_DELIVERY.md)**. Native related-document
preparation, exact parcel/public-context checks, evidenced utility profiles and
persisted investigations run locally. [Local spatial extraction](docs/local-spatial-extraction.md)
adds pinned floor-plan and building models, persisted batches, exact raster inspection
and calibrated proposals through the existing review process. Optional [Nous assistance](docs/OFFICER_AI.md)
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

**Already cloned? Add the saved Uttam Nagar datasets after `git pull`:**
follow [Uttam Nagar update and transfer](docs/UTTAM_NAGAR_SETUP.md).
`pnpm data:uttam:install` adds the six saved reference/scenario areas, their
actual recorded rooms, fictional party allocations, checks and retained source
files without replacing Lake View, Bronx or local edits. The original 15 September
`repo-data` snapshot is unchanged; Uttam Nagar is a separate additive bundle.

**Use the complete saved dataset from this repository:** follow
[repository-data setup](repo-data/README.md). Run `pnpm repo:init`, set
`REPO_DATA=true` in `.env`, then build/start the app. The bundle includes the
saved database, plans, PDFs, source revisions and presentation-asset bindings.
`REPO_DATA=false` keeps using your existing linked environment settings.
The two modes use separate persistent services; restart the app and dispatcher
after switching. No reseeding or overwriting of existing data is required.

For the current officer walkthrough, use [STUDIO_DEMO_GUIDE.md](docs/STUDIO_DEMO_GUIDE.md). The older annotated tutorials remain historical references in `docs/tutorial-images/`; `pnpm guide --port 3012` serves those without starting the app.

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

Use **Add files** for new sources and **Browse saved blocks** for the persisted Lake View demonstration or separately labelled real data. Resume existing cases instead of reseeding a rehearsal. Historical record, workspace and geometry bookmarks preserve their identifiers when opening Studio.

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

## Historical fixtures and contracts

C-001/C-002 correction fixtures, original documents and revision history remain available to the shared backend and contextual geometry tools. Their earlier [demo script](docs/DEMO_SCRIPT.md), [input contract](docs/INPUT_GUIDE.md), [identifier explanation](docs/PROTOTYPE_IDENTIFIERS.md) and [source catalogue](DEMO_DATA.md) are retained for traceability. Their old button-by-button walkthroughs are superseded by the [Studio guide](docs/STUDIO_DEMO_GUIDE.md).

## Understand and change it

Read [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow, then
[IMPLEMENTATION_CONTRACT.md](docs/IMPLEMENTATION_CONTRACT.md) for API behavior.
The key learning path is:

| Area | Start here |
| --- | --- |
| Studio navigation and officer workflows | `apps/web/features/studio/product/`, `apps/web/features/officer/` |
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


## Shared renderer development branch

The reusable spatial-map foundation is developed on `feat/reusable-spatial-map-core`.
On that branch, open `/map-lab` to inspect two explicitly synthetic neighbourhoods
through the same canonical contract, compiler and streamed renderer. Panel changes
retain the same canvas and selected object. This is a calibration surface, not an
official registry or a claim that the visual reference benchmark is already passed.
See [implementation boundaries and checks](docs/SHARED_MAP_IMPLEMENTATION.md).
