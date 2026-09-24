# Local startup and officer demonstration

> **Direction note — 23 September 2026:** Keep these operational startup/isolation instructions; later feature completion requires its own evidence. Current implementation and data/testing assignments are in [USP handoff 00](usp-agent-handoffs/00-README.md) and the assigned feature file.

Updated **15 September 2026**. This release runs locally for one operator. The commands below start Next.js/Cesium, PostgreSQL/PostGIS, private S3-compatible storage, Redis, the private Python processor and Celery. They do not deploy publicly, issue official identifiers or create a statutory approval workflow.

Use the real Bronx block for source correspondence and property navigation. Use the separately labeled synthetic officer fixture for authored interior/document examples. Neither demonstrates a completed real Indian block with surveyed utilities and genuine building plans.

## Prerequisites

On a new Apple Silicon Mac, install Homebrew first if needed, then:

```sh
brew install node colima docker docker-compose
npm install --global pnpm@9.12.0
```

Node **26.7.0** and pnpm **9.12.0** were read from the presentation machine for this guide. The repository pins the package-manager version and container images. Initial installation requires network access to download dependencies and images. Normal native processing runs in containers; a host Python environment is needed only to run Python tests separately.

The platform launcher uses the dedicated Colima `ulpin` profile / `colima-ulpin` Docker context when available. Its configured VM has 4 CPUs, 6 GB memory and a 20 GB maximum virtual disk, with Rosetta support for the pinned AMD64 PostGIS image. The platform helper also supports an explicitly selected `ULPIN_DOCKER_CONTEXT` and either Compose CLI form.

Run commands from the repository root. On the current machine:

```sh
cd '/Users/vinayak/Desktop/3D Ulpin'
```

## Start or reopen

The normal entry point is:

```sh
pnpm demo
```

Open [the local 3D block workspace](http://127.0.0.1:3000) and keep the terminal open. `scripts/demo-start.sh` installs locked JavaScript dependencies, starts the platform, runs additive migrations, builds production assets, and starts both the web server and application dispatcher. If the application is already healthy, it reuses that instance. To rebuild changed application code, stop its web/dispatcher terminal with **Ctrl+C** first, then run `pnpm demo` again.

For an explicit first start, the same sequence is:

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm build
pnpm start
```

`platform:start` creates a private ignored `.env` only when one is absent. An existing `.env`, database and object volumes are retained. Keep their credentials together; replacing the `.env` password does not change the initialized database password. Migrations also create/verify the private source bucket. `pnpm start` launches the dispatcher as well as Next.js; running only `next start` does not dispatch application jobs.

The authoritative Compose definition is [`compose.yaml`](../compose.yaml). Use [`scripts/platform-lib.sh`](../scripts/platform-lib.sh) for its project directory, `.env` and Docker-context handling. For a targeted service start after environment setup:

```sh
bash -c 'source scripts/platform-lib.sh
ulpin_compose --profile app up -d --build --wait'
```

The higher-level `pnpm platform:start` additionally initializes the runtime as needed and runs platform checks. Use `pnpm platform:health` and [application health](http://127.0.0.1:3000/api/v1/health) to confirm database, storage, processor, Redis and worker readiness.

| Service | Loopback port |
| --- | ---: |
| Web | 3000 |
| PostgreSQL | 15432 |
| MinIO API / console | 19000 / 19001 |
| Redis | 16379 |
| Private processor | 18000 |

For development, stop the production web terminal and use `pnpm dev` after platform startup and migration. To stop without deleting evidence, stop the web/dispatcher terminal with **Ctrl+C**, then run `pnpm platform:stop`. This preserves named volumes. `colima stop --profile ulpin` additionally releases VM memory. Do not delete data volumes to obtain an empty demonstration; use a new application workspace or the isolated rehearsal below.

## Real Bronx block: source and navigation demonstration

The retained presentation area was checked read-only while writing this guide: **62 observed buildings**, area `9e77c608-bac7-4d56-9ac7-3032cc49074d`.

1. Open [the retained Bronx block](http://127.0.0.1:3000/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d).
2. Enter **353927** in the global identifier search. No State/district selection is required. It resolves Building 353927, own identifier `3DU-4YEZ30HEP79NB9NHSG6B64J1TD:B023`.
3. Inspect its Register and Evidence panels. Use **Focus property** for a close view and **Block** to return; ordinary property selection retains surrounding context.
4. Select another building to inspect that property's own record. Exterior height does not imply supplied floors or apartment interiors. Use **Add plans to this building** only with evidence actually belonging to that building.
5. Run an area check to inspect supported geometry and the listed coverage gaps. Missing parcels, public boundaries or vertical references cannot establish the absence of a discrepancy.

[Open Building 353927 in its block](http://127.0.0.1:3000/areas/9e77c608-bac7-4d56-9ac7-3032cc49074d?feature=7ca4fba1-6c6a-44aa-89c8-d17b97bf159f).

On a fresh database, these retained-instance IDs do not exist. Start from **Data sources → NYC building footprints → Open saved snapshot**, review the proposed observations and record them with the source acknowledgement. Then search **353927** in the newly created area. The application allocates that installation's own persistent IDs. Opening a saved snapshot reads preserved bytes; **Refresh source** makes a new bounded provider request and can fail when the provider/network is unavailable.

The preserved original is `fixtures/real-area/original.geojson`, accompanied by its manifest. Its SHA-256 is `869c5dc4fb50d71be4f62f4a2936c29bd95ade14c712bdf4f51986841d82771a`. It contains actual NYC exterior footprints and reported roof heights, transformed to a common EPSG:32618 frame and retained origin. Heights use building-relative bases. The source identifier is not an official ULPIN, and this foreign building-only sample is not an Indian pilot or a source of real interior/utility measurements.

## Synthetic officer fixture: related documents and detailed records

The separate retained area is **Synthetic officer UI test · not a real survey**, containing three synthetic properties. Open [the synthetic block](http://127.0.0.1:3000/areas/8c61a45e-3ae9-4c7c-95f2-78918f23582a).

| Property | Own search identifier | Existing building ID |
| --- | --- | --- |
| Synthetic Property A | `3DU-4CC6J5WEQ99HY9BWKRJ67J6P1A:B001` | `2c2aa2dc-b83e-4c64-842e-9790407afb0d` |
| Synthetic Property B | `3DU-4CC6J5WEQ99HY9BWKRJ67J6P1A:B002` | `2d5d12c8-1fa5-42a1-a3a9-80f8fad10ff6` |
| Synthetic Property C | `3DU-4CC6J5WEQ99HY9BWKRJ67J6P1A:B003` | `022597b5-41ed-495b-8318-6ccb0452b58b` |

1. [Open Property A in the shared block](http://127.0.0.1:3000/areas/8c61a45e-3ae9-4c7c-95f2-78918f23582a?feature=2c2aa2dc-b83e-4c64-842e-9790407afb0d). Inspect Register, the recorded floor/space and its source evidence.
2. Open **Prepare** or the selected property's **Plan Workspace**. The existing preparation package is `73a38abb-727a-464e-adf7-56c571c0df16`; its linked case is `a99b91c8-c5d7-4a65-83f9-b56e49548010`. Continue that preparation rather than creating an unrelated legacy case.
3. Inspect the two authored CSV sources, selected native candidates, reviewed placement and benchmark. The initial verified sample was one 6 × 6 m space with 0–3 m vertical limits; its later reviewed source correction is 0–4 m in `BM-SYNTHETIC-UI-ONLY`. Its floor ID is `cdddf5f2-44f5-4492-a3fa-06ec51f256d6`; its space ID is `bd0cd76b-809e-4ed2-b131-6c436a62a76b`. The building exterior remains a separate representation.
4. Select **Investigate** and reopen `SYNTHETIC-UI-INV-A-FINAL` (case `63143c47-3e9d-4037-88ad-29f83f5b8db6`). It is CLOSED revision6 with the authored20m² finding, answered source question, exact input snapshot and JSON/CSV/print-PDF exports. Closure is technical only. The older pending case remains in history.
5. Select the synthetic utility to inspect its supplied centre-level section and explicit circular/sloping-volume limitation.
6. Return to the block and select B or C. Their panels must retain their own identities and evidence; A's details are not shared by default. Review newly supplied documents and placement before building or recording another revision.

These existing IDs describe this machine's retained UI rehearsal, not a seed automatically installed on every database. The authored files are retained in `demo-data/synthetic-officer`, with working capture metadata under `/tmp/ulpin-officer-proof`; originals accepted by the application are retained in its source storage. See [the actual UI verification](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/OFFICER_UI_VERIFICATION.md) for what was performed through the interface and the current visual/regression evidence.

Exact 20 m² outside-parcel and utility examples in the three-property UI fixture are independently authored **software tests**, not claims about real properties. The separate processing suites also verify public-union and 3 m³ prism examples. `pnpm test:officer` runs its own allocated synthetic API/worker regression fixtures and removes them afterward; it is not a persistent demonstration seed. [Geometry verification](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/OFFICER_GEOMETRY_VERIFICATION.md) records G01–G07/V01–V04, native format limits and evidence requirements. Circular or sloping utility profiles do not receive exact collision volumes, and unknown depth is not assigned an underground position.

## Isolated fresh-install verification

The implemented fresh-data rehearsal passed on **15 September 2026**. It started from an empty application schema, imported/reviewed/committed the 62-building saved source, exercised browser same-property search and the native CSV/dispatcher/Celery publication regression, then restarted all isolated services and reopened identical IDs, package, current check and original hashes. Only its allocated containers, network and new volumes were removed. See [the exact report](https://github.com/Vinayak1337/3d-ulpin/blob/f623cff897f91bb3ebd4c225f700ac263f7beb72/docs/FRESH_INSTALL_VERIFICATION.md).

To repeat with a completed production build and free alternate ports:

```sh
pnpm exec playwright install chromium
pnpm test:fresh-install
```

The harness allocates a unique `ulpin-fresh-*` Compose project on ports **25432, 29000, 29001, 26379, 28000 and 3001**. It reuses the installed dependency tree and local geo image; it does not claim a clean-OS installation. Avoid rebuilding the shared `.next` output while its second production web server is running. Its browser captures verify property interaction/persistence, not completed 3D painting or frame rate; use the dedicated UI verification for those results.

Native workflows and saved data do not require an AI account. Optional Nous assistance is a retired baseline path ([history](https://github.com/Vinayak1337/3d-ulpin/blob/7472730980fd3d79e7364b5cac3e6c7ebff7dd3d/docs/OFFICER_AI.md)); the finale build disables it and uses the governed gateway in handoffs 19 and 20, with reviewed source-bound candidates and no paid fallback. The recorded verification had no authorized `NOUS_API_KEY`, so it did not establish actual inference acceptance. Real Indian layer reuse/acquisition, actual building-specific plans and surveyed same-area utility depth remain separate evidence gates. No startup or test command turns the synthetic examples into that evidence.
