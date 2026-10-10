## Rehearsal runtimes (`ulpin-reh-NN`)

Draft from R5a (10 October 2026) for `docs/backend/DEMO-RUNTIME.md`. **It was derived by reading the scripts at
`57eb2bc7` (unchanged on staging `b5031a12`) and has never been executed. No rehearsal runtime exists.**
A step marked **needs Cn** cannot be run today, because a value it depends on is fixed to the demo; the changes
C1 to C9 are listed in `docs/evidence/runtime/r5a/result.json` under `changesNeeded` and summarised at the end.
Until C1 to C6 are merged, no command below may be tried: today every platform command acts on `ulpin-demo`.

The write half of the walk (review a recorded unit, assign its code, issue its card, verify it) happens once per
unit. A rehearsal runtime is a second, separate runtime filled through the product from the retained originals up
to the point just before the review, used for one rehearsal, then stopped and kept. It is never reset, reseeded or
copied from the demo, and it is never started again for another rehearsal: the next rehearsal gets the next number.

### What makes it separate

| Part | Demo | Rehearsal `ulpin-reh-NN` |
| --- | --- | --- |
| Compose project, bucket | `ulpin-demo` | `ulpin-reh-NN` |
| Runtime folder | `E:/BhuAayam-data/runtime/ulpin-demo` | `E:/BhuAayam-data/runtime/ulpin-reh-NN` |
| Volumes | `ulpin-demo_{postgres,minio,redis}-data` | `ulpin-reh-NN_{postgres,minio,redis}-data` |
| Loopback ports: API, PostgreSQL | 3194, 15434 | 3195, 15435 |
| Loopback ports: S3, S3 console, Redis, geo | 19020, 19021, 16381, 18002 | 19022, 19023, 16382, 18003 |
| Serving checkout | `E:/Projects/ulpin-wt/demo` | `E:/Projects/ulpin-wt/rehearsal` |
| Product profile (`ULPIN_PROFILE`) | `demo` | `demo` (the same product behaviour) |

One rehearsal runtime runs at a time, so every rehearsal runtime uses the one rehearsal port set and the Studio
and the journey always target `http://127.0.0.1:3195`. The six rehearsal ports were free and bound by no retained
container on 10 October 2026; ports 15433, 19010, 19011, 16380, 18001 and the 25xxx to 29xxx ranges belong to
other retained projects.

### Preconditions

1. You are the runtime owner named in a task file. The lead has merged C1 to C6 (and C7 before any write-mode
   journey run), and has created the detached checkout `E:/Projects/ulpin-wt/rehearsal`.
2. The demo is up and is left alone. From `E:/Projects/ulpin-wt/demo`: `pnpm platform:doctor --profile demo` exits 0
   with no `FAIL` line. Record the demo's two native PIDs as roll-out step 7 does; they must not change below.
3. No rehearsal runtime is running: `docker ps --format '{{.Label "com.docker.compose.project"}}'` prints no
   `ulpin-reh-` line, and nothing listens on 3195.
4. `NN` is the next unused number: no folder `E:/BhuAayam-data/runtime/ulpin-reh-NN`, no volume whose name starts
   with `ulpin-reh-NN_`, no container with that project label. The number of an abandoned create is not reused.
5. Room: at least 2 GB of free commit charge and 5 GB free on `E:` (one runtime takes about 1 GB of memory and
   under 1 GB of disk).
6. The shared, read-only inputs exist and are not written by anything below: the learner seed `v43`, the document
   interpreter environment, the OCR models, `tesseract` and tessdata, the GMDA original, and the four Tower 3
   originals under `E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/` with the hashes in
   `docs/evidence/usp/finale/GF-DATA/storey-truth/demo/haryana-2831-tower3.json`.
7. The model gateway stays off and no provider key is ever configured in a rehearsal runtime.

### Create a rehearsal runtime `ulpin-reh-NN`

Every command runs from `E:/Projects/ulpin-wt/rehearsal` unless it says otherwise.

1. **Checkout at the demo's commit.** With no rehearsal process running:
   `git -C E:/Projects/ulpin-wt/rehearsal checkout --detach <commit the demo serves>`, then
   `pnpm install --frozen-lockfile` if `pnpm-lock.yaml` changed.
   Must print: `git rev-parse HEAD` equals `git -C E:/Projects/ulpin-wt/demo rev-parse HEAD`.
   Never serve a rehearsal from the demo checkout or a worker worktree. The checkout path must stay in place: the
   PostgreSQL container binds `database/sql/00-bootstrap/postgis.sql` from it (`compose.yaml:25`).
2. **Folder and configuration (create-once per runtime). Needs C1, C2.**
   `pnpm platform:start --profile demo --runtime ulpin-reh-NN --create`
   As the code orders it today (`demo-config.mjs:295-322`): the six ports are checked free, the folder is made with
   `logs` and `models`, its access list is restricted, and the configuration file is written create-once with new
   generated secrets. It must then stop with exactly
   `Demo tabular paths missing; configure tabular-paths.json first.` and no container may exist yet
   (unless C4 has folded step 3 into this command, in which case it goes on to step 5).
   Never open the configuration file; never run this without `--runtime`: without it the command is the demo's.
3. **Path files (create-once per runtime). Needs C4: no command writes them today.**
   A new command writes the two non-secret path files into the runtime folder after making two new, empty
   directories inside it (a learning directory and an OCR scratch directory):
   `tabular-paths.json` with `ULPIN_PROFILE_PYTHON`, `ULPIN_TABULAR_LEARNING_DIR`, `ULPIN_TABULAR_LEARNER_SEED`, and
   `ocr-paths.json` with `ULPIN_DOCUMENT_OCR_PYTHON`, `_MODELS`, `_TESSERACT`, `_TESSDATA`, `_SCRATCH`.
   The learning directory and the scratch must be inside this runtime's folder (the launcher refuses otherwise);
   they are never the demo's. Must print the key names only.
4. **Document page and region runtime (once per runtime and per checkout commit). Needs C5.**
   `node scripts/platform/demo-document-runtime.mjs build --runtime ulpin-reh-NN --python <interpreter>`
   Must print `Configured keys:` followed by the six `ULPIN_DOCUMENT_PAGES_*` and `ULPIN_PACKET_REGIONS_*` names,
   then `ULPIN_PACKET_REGIONS_PROFILE_SHA256:` and 64 hex characters. The hash need not equal the demo's.
   It refuses while this runtime's API or dispatcher is recorded as running. Without this step the first record
   request answers `503 DOCUMENT_PAGES_RUNTIME_UNAVAILABLE` and the doctor prints `FAIL Document runtimes`.
5. **Storage, schema and start (create-once per runtime). Needs C1, C2, C3.**
   The command of step 2 again. Must print, in this order, `Creating/resuming the explicitly approved new
   ulpin-reh-NN project.`, `Applying existing additive migrations to ulpin-reh-NN only (no seeds).`,
   `ulpin-reh-NN running: http://127.0.0.1:3195/api/v1/health (gateway disabled).`, then the doctor's lines with no
   `FAIL`, including `PASS Document runtimes` and `regionRepoMatches: true`; exit code 0.
   It creates the three storage containers and volumes, the bucket, the whole schema (all manifest steps in one
   run: the K4a and K5 runners are for the populated demo only and are never run here), the processor image and
   containers, the marker `bootstrap.complete.json`, and starts the API and the dispatcher.
   If it fails part-way, nothing is removed. The same command resumes it once (the create path is written to
   resume, `demo.mjs:53-61`); if it fails again for the same reason, stop, report, and leave it as it is.
6. **Prove it is not the demo.** `GET http://127.0.0.1:3195/api/v1/health` answers 200 and its
   `databaseReadiness.schema.targetToken` is **not** the demo's
   (`41f7e091b5d652b19f97ce9d1cb6f8881fe65f8bb821ca1fbc6d6b05b554a597`). It is empty: `databaseReadiness.data`
   answers `sourceCount`, `importPackageCount` and `physicalFeatureCount` 0 (the demo answered 38, 7 and 67 on
   10 October). Repeat precondition 2: the demo doctor exits 0 and the demo PIDs are unchanged.
7. **Fill through the product. Needs C6: the existing scripts are fixed to the demo and must not be run here.**
   A parameterised fill script takes the runtime name, refuses the demo by the guard below, writes its receipts
   create-once under `E:/BhuAayam-data/task-data/ulpin-reh-NN/fill/` (never into Git) and reads every identifier
   from the previous step's response:
   1. the reference area: the GMDA area import, prepare and commit (on the demo: by hand, 9 minutes with its
      review; no script or request body was retained) - must print the new area id and state `COMMITTED`;
   2. Tower 3: `POST /api/v1/import-packages` with `format=document_buildings` and the four hash-checked PDFs,
      then `/prepare` and `/commit` with the K2 acknowledgement - must print state `COMMITTED`, one building id
      and four source ids; the plan source is the one whose SHA-256 starts `2b9f8803`;
   3. the floor and the unit: `POST /api/v1/buildings/{buildingId}/source-spaces` with the K4c statements
      (`2ND FLOOR PLAN` at `[850,875,1020,910]`, `UNIT-3B` at `[596,390,644,409]`, page 1 of the plan source) -
      must answer `201` with `floorCreated: true`, and the same receipt when the same key is sent again.
8. **Stop point: the rehearsal starts here.** Check, with reads only:
   `GET /api/v1/buildings/{buildingId}/canonical` shows one floor `2ND FLOOR PLAN` and one unit `UNIT-3B` whose
   application code is unknown, and `GET /api/v1/buildings/{buildingId}/snapshots` answers `"items": []`.
   Nothing after this is run by the runtime owner. The first `POST /api/v1/usp/snapshots`, the plan, the review,
   the assignment and the card are the rehearsal itself. In script terms: everything up to and including
   `r2-live.ts record` and `record-read`; not `r2-live.ts snapshot`, and nothing from `r3-live.ts snapshot`
   onward. (On the demo R2 had captured one snapshot before the review, so the demo lists one more than a
   rehearsal will.)
   A rehearsal runtime whose snapshot listing has an item is used: stop it and create the next number.

### Point the Studio and the journey at it

- **Studio.** `ULPIN_API_TARGET=http://127.0.0.1:3195 pnpm studio:dev` (`apps/studio/vite.config.ts:7`; bash
  syntax, in PowerShell set `$env:ULPIN_API_TARGET` first). The dev server's port is fixed at 5188 with
  `strictPort` (`:33-34`), so only one Studio dev server runs on this machine: stop the one that targets the
  demo first, or wait for C8. Check the target before a rehearsal:
  `GET http://127.0.0.1:5188/api/v1/health` must answer the rehearsal token of step 6, not the demo's.
- **Journey, reads.** Needs C7. `pnpm journey:check` accepts only `--profile demo` (`scripts/golden-journey/run.ts:13`)
  and takes its address and every pin from committed demo evidence (`inputs.ts:12-43`). With C7 it takes
  `--runtime ulpin-reh-NN` and reads its pins from the fill receipts of step 7.
- **Journey, write mode.** Needs C7. `--write` is refused today (`run.ts:12`). When it is built it must **refuse
  before any request** unless all of these hold:
  1. the runtime name matches `^ulpin-reh-[0-9]{2}$` (so `ulpin-demo` cannot be named);
  2. the target port is that runtime's recorded API port and is not the demo's `API_PORT` 3194
     (`scripts/platform/demo-config.mjs:255`);
  3. the target's health `databaseReadiness.schema.targetToken` differs from the demo's recorded token;
  4. the target's snapshot listing for the building has no item (an unused rehearsal runtime).
  The guard belongs in two places: `options()` in `scripts/golden-journey/run.ts:11-14`, which replaces today's
  refusal, and the `Reader` class in `scripts/golden-journey/read.ts` beside `postRead` (`:56-61`), the only
  place a POST leaves the journey process, so that a write request cannot be built without passing the guard.
  The demo's project name, port and token come from one module that both places import.

### Stop it

`pnpm platform:stop --profile demo --runtime ulpin-reh-NN` (needs C2). Must print
`ulpin-reh-NN API/dispatcher and containers stopped; all data volumes preserved.` Then the demo doctor of
precondition 2 again. Never run `pnpm platform:stop --profile demo` for this: without `--runtime` it stops the
demo's containers.

### After use

A used rehearsal runtime is stopped, not removed, and never started for another rehearsal. It holds uploaded
copies of originals, source records, a review, an assigned code and an issued card: review history and uploads,
which the data rules do not let anyone delete. Nothing is pruned, no volume is removed, and `down -v` is never
used. Retiring one is an owner decision on an exact-path list (`result.json`, `q5.dispositionWouldList`).
A card issued in a rehearsal runtime is known only to that runtime; it is never shown as the demo's card.

### Changes needed before the first one can be created

| Id | Change | Files |
| --- | --- | --- |
| C1 | The runtime name is a parameter; folder, project, bucket, ports follow it | `scripts/platform/demo-config.mjs` |
| C2 | Start, stop, doctor and the process records accept the runtime | `demo.mjs`, `processes.mjs`, `doctor`, shell |
| C3 | The processor image tag and its K3b environment are per runtime | `demo.compose.json`, `demo.mjs` |
| C4 | A command writes the two path files for a named runtime | new, beside `demo-config.mjs` |
| C5 | The document runtime builder accepts the runtime and its checkout | `demo-document-runtime.mjs` |
| C6 | A parameterised fill script, with the area step written down | new; replaces fixed K2 and R2 drivers |
| C7 | The journey takes a runtime, per-runtime pins and a guarded write mode | `scripts/golden-journey/*` |
| C8 | Optional: a Studio dev port variable, and the served runtime shown | `apps/studio/vite.config.ts` |
| C9 | Optional: the R2 and R3 drivers take address, ids and root as parameters | `scripts/agent/r{2,3}-live.ts` |
