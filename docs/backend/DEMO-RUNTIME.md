# Pinned demo runtime

The demo API and dispatcher run from `E:/Projects/ulpin-wt/demo`, a detached, unedited checkout.
Current reviewed staging commit: `18b5e74c` (10 October 2026; R5c roll-out, K8b snapshot order, K11b review reads
and K12 plan entries and card preview, no schema step pending, document runtimes rebuilt on the project-owned
interpreter).
Loopback API: `http://127.0.0.1:3194`; external demo configuration stays outside every checkout.
Only the runtime owner explicitly named in a task file may roll this checkout forward.
Worker worktrees must never serve the demo: lazy imports would mix unreviewed changes into running processes.

## Roll-out (no fetch)
1. Confirm exclusive runtime ownership; notify any worker reading the API and keep downtime short.
2. From the demo checkout, stop only the two recorded native processes:
   `node --input-type=module -e "import('./scripts/platform/processes.mjs').then(m=>m.stopProcesses())"`
3. Select an already-present, lead-reviewed staging commit:
   `git -C E:/Projects/ulpin-wt/demo checkout --detach <commit>`
4. If `pnpm-lock.yaml` changed, run `pnpm install --frozen-lockfile` from that checkout.
5. **On every rollout, after checkout and before startup**, rebuild the frozen document region profile there:
   `node scripts/platform/demo-document-runtime.mjs build`
   It reuses the configured OCR interpreter (paths only), the existing frozen-profile builder and private ACL helper.
   If selecting an interpreter explicitly, append `--python <absolute existing interpreter file>`.
   It refuses a normal build outside `E:/Projects/ulpin-wt/demo` or while a recorded native process is running.
6. Start both native processes from that checkout:
   `pnpm platform:start --profile demo`
7. Run `pnpm platform:doctor --profile demo` there. Record both process entry paths, PIDs and the served commit.
   Require **PASS Document runtimes**, alongside the existing model-gateway and other checks described below.
8. Prove one existing job authority is dispatched automatically; retain API and SSE receipts outside Git.

Never edit application files in the demo checkout, copy/read credentials, use `--create`, reset/reseed,
stop or replace containers, remove volumes, fetch unreviewed code, or use `down -v`.
The platform start command resumes the existing project only; populated storage and external credentials remain intact.
If doctor fails, preserve the runtime and diagnose its specific failure; do not initialise replacement storage.
Code changes merge on staging first, then roll here in a separately authorised runtime task.

## Schema steps that a roll-out must apply first

The roll-out never creates or resets the database, and `platform:start --profile demo` refuses to start when the
served commit expects a migration the populated database has not run ("Demo schema missing"). An additive step is
applied once by its own registered runner, from the runtime owner's own worktree at the new commit (never by
moving the serving checkout under running processes), while the old API still answers, before step 2:

| Needed from commit | Migration | Command | Receipt |
| --- | --- | --- | --- |
| K5 part 2 merge (card revocation) | `usp_property_card_revocations_001` (one new append-only table) | `node docs/evidence/gf4/k5/run-migration.mjs` | `docs/evidence/gf4/k5/migration-receipt.json` (create-once). **Applied on the demo 10 October 2026** (`applied: true`) |

The K5 runner's first run anywhere was on the demo (R3, 10 October 2026): applied, card rows unchanged, the old
API answering throughout. A runner applies only its registered check/schema/mark steps in one transaction with
short lock and statement timeouts, compares the rows it names before and after, and stops if the database is not
the served one. If a runner fails, do not start the new commit: keep the previous served commit and report.
A runner is never run a second time after a failure.

## Document runtime configuration

The builder never opens or rewrites `demo.env`. It writes the non-secret `document-runtime-paths.json` beside it.
Each build creates a new ACL-restricted directory containing an immutable `packet-region-runtime/1` profile and
separate page/region scratch directories. Only the path-file pointer is atomically replaced; old profiles and
scratch directories are retained, never automatically pruned. The command prints key names and hashes, not paths
or profile contents. A failure preserves its new directory and leaves the existing pointer unchanged.

The path file permits only these keys:

| Runtime | Keys |
| --- | --- |
| Pages | `ULPIN_DOCUMENT_PAGES_PYTHON`, `ULPIN_DOCUMENT_PAGES_SCRATCH` |
| Regions | `ULPIN_PACKET_REGIONS_PYTHON`, `ULPIN_PACKET_REGIONS_PROFILE` |
| Regions (continued) | `ULPIN_PACKET_REGIONS_PROFILE_SHA256`, `ULPIN_PACKET_REGIONS_SCRATCH` |

A missing file means unconfigured; either group may be absent, but a partial group fails closed.
Paths must be absolute, existing files/directories of the right kind, and scratch must resolve outside every
checkout. The profile hash is 64 lowercase hexadecimal characters. Validation errors name keys, never values.
`readDemo()` merges these validated settings into the existing native launcher environment; no new authority is added.

Doctor's **Document runtimes** check reports `documentPagesConfigured`, `packetRegionsConfigured`,
`regionProfileSha256` and `regionRepoMatches`. It fails if either runtime is unconfigured, or if the existing
`verifiedProfile()` check refuses the configured profile hash, resolved asset bytes or serving-checkout `repo`.
The interpreter must also match the frozen profile. A pass verifies host configuration/closure only, not current
HTTP source access or a successful native crop. The existing G1 model-gateway checks remain unchanged.

**Known cause of a later FAIL (found by R3, 10 October 2026).** The frozen profile pins the bytes of the base
interpreter behind the configured environment. On this desktop that base is a Python bundled with another
application, which replaces it when it updates itself: at 18:44 IST its binaries and 70 pinned standard-library
caches changed, and the check failed from then until the roll-out rebuilt the profile. No repository file,
package or project environment had changed. Until the demo's document runtime has an interpreter the project
owns, a FAIL here after a PASS means "check whether the base interpreter was replaced", and the remedy is the
rebuild in step 5 at the next roll-out, with the cause stated in the report.

For offline development, another checkout is permitted only with `--dry-run --out <absolute temporary folder>`
(and an explicit `--python` if no OCR paths are configured). Dry runs cannot target a checkout or shared runtime.
They do not activate configuration or services. Never reuse a worker-checkout profile for the demo: its absolute
`repo` and physical closure are different. Rebuild deliberately after every reviewed checkout/runtime change.

The Tower 3 plan1 metadata frame is 2586 × 1695 pt. Whole-page raster remains unsupported because its existing
2000-pt page-side limit is exceeded. Packet regions have a separate 14,400-pt source-side bound and a 2000-pt
**selected-side** bound. The caption `[850,875,1020,910]` (170 × 35 pt) and label `[596,390,644,409]` (48 × 19 pt)
fit without changing any limit or scale: the existing 3× choice gives 510 × 105 and 144 × 57 px respectively.
Only the inward-rounded region bitmap is allocated, not the 7758 × 5085 transform canvas. These citations prove
literal labels only, never a unit boundary, numeric level, measurements, rights or current approval.

A selected-region OCR result keeps every box as read: the render starts and ends on whole pixels, so a box may
pass the region by up to one rendered pixel (1.229 pt at the site plan's 0.814 px per pt), the result states
this as `regionEdge` (`renderScalePxPerPt`, `boxesBeyondRegion`, `largestOverhangPt`), and a box further out
refuses the whole result as `OCR_BOX_OUTSIDE_REGION`.

## Changing the document interpreter

Runtime owner only, after lead review of `docs/evidence/gf1/k9/result.json` and `docs/evidence/gf1/k9c/result.json`.
K9, K9b and K9c ran both actions only as dry runs on synthetic copies. The switch was made by R5c on 10 October
2026 at 16:16:06 UTC, during its roll-out; the file it saved, which a rollback needs, is
`ocr-paths-profile.previous-2026-10-10T16-16-06-121Z.json`.
The project-owned environment is `E:/BhuAayam-data/ml/venv-demo-documents-20261010`.
Its `pyvenv.cfg` binds the full `base/cpython-3.12.14-windows-x86_64-none` directory, not uv's patch alias.
The new environment/base deny ordinary writes; retain that ACL and rebuild deliberately after any owner change.

K3b's `docs/evidence/gf-t16/k3b/activate-demo.mjs` created the demo-only `ocr-paths-profile.json` override.
It is create-once and cannot update an existing override. **Never edit a runtime file by hand.** The interpreter
in that override is changed only by the builder's `switch-ocr-python` action. It reads the override through
`readDemoOcrPaths`, the reader the runtime itself uses, and never creates one.
Do not edit `demo.env`, the original OCR path file, model weights, tessdata or any existing environment.

**The switch (forward).** After roll-out steps 2–4 (native processes stopped, reviewed checkout selected) and
before step 5, from the demo checkout; then step 5 with the same interpreter:

```sh
PYTHON='E:/BhuAayam-data/ml/venv-demo-documents-20261010/Scripts/python.exe'
node scripts/platform/demo-document-runtime.mjs switch-ocr-python --python "$PYTHON"
node scripts/platform/demo-document-runtime.mjs build --python "$PYTHON"
```

The switch refuses, and writes nothing, unless all of these hold:

- the override exists and the shared reader accepts it as demo-scoped;
- `--python` is an absolute path to an existing file;
- the `pyvenv.cfg` of its environment names one base **inside** that environment. A base outside it is refused
  and named in the message; no flag relaxes this rule;
- started with `-I -B` and `CUDA_VISIBLE_DEVICES` empty, the interpreter imports what the OCR and region steps
  import (`fitz`, `psutil`, `pypdfium2`, `pypdfium2_raw`, `PIL.Image` and the four `docling` modules) within
  180 seconds. Only imports run; no model is loaded.

It then saves the current file beside it as `ocr-paths-profile.previous-<UTC>.json` and replaces the override by
one rename, with only `paths.ULPIN_DOCUMENT_OCR_PYTHON` changed and every other byte as it was. It must print one
JSON line and nothing else: `restored: false`, `previousPython`, `newPython` (equal to `$PYTHON`),
`baseInsideEnvironment: true`, `savedPreviousFile`, `previousSha256` and `newSha256`. Keep that line in the owner's
receipt: `savedPreviousFile` is what a rollback needs.

The build's `--python` changes pages/regions, **not OCR**; omitting the switch leaves OCR on the old base. The build
now runs the same import check first, then prints the configured key names, the profile hash and the
document-runtime path-file hash, as before.
Continue steps 6–7: `pnpm platform:start --profile demo`, then `pnpm platform:doctor --profile demo`.
Require PASS Document runtimes. Read the new profile's `repo`, `python`, `base` and pinned paths: its repo must be
`E:/Projects/ulpin-wt/demo`, its interpreter/base must be the new environment, and every pin must be under that
checkout or data `ml`. Use K9's `profile-files.mjs <profile-file>` to classify the inventory; compare classes with
`environment.json` (stdlib caches retained, package/hook caches absent), not a worker hash.
Run K9's `stability.mjs` once against the demo `document-runtime-paths.json` and a fresh owner evidence output:
it starts ten interpreters and repeats the same doctor profile check. Never reuse K9's `f1` profile for the demo.
Also check OCR once with the existing complete demo prefix; K9's no-runtime comparison used the retained split
prefix plus an absolute, hash-checked TSV config, not a copy of or a read from the demo's tessdata.

**The rollback (restore).** Stop the recorded native processes (step 2), then restore the saved file and rebuild.
Without `--python`, the build takes the interpreter the restored override names:

```sh
node scripts/platform/demo-document-runtime.mjs switch-ocr-python --restore "$SAVED_PREVIOUS_FILE"
node scripts/platform/demo-document-runtime.mjs build
```

`--restore` takes a file name only, never a path: `ocr-paths-profile.previous-<UTC>.json`, in the override's own
folder. The saved file must pass the same reader (demo-scoped, its interpreter and four other paths present). The
action saves the current override first, exactly as the switch does, then publishes the saved file's bytes by one
rename. It does **not** apply the private-base rule, because what it restores is what ran before, and it says so
in its one JSON line: `restored: true`, `previousPython`, `newPython` (the interpreter configured again),
`baseInsideEnvironment` (`true`, `false`, or `null` when no `pyvenv.cfg` can be read), `savedPreviousFile` (the
file just saved, which restores the state before this rollback), `previousSha256` and `newSha256`. `newSha256`
must equal the `previousSha256` the switch printed. For K9's previous environment expect
`baseInsideEnvironment: false`: its base belongs to another application, so the known cause of a later FAIL above
applies again until the next switch. Then start and doctor (steps 6–7). Rebuild rather than restoring a historical
profile: its repo/base bytes may have changed. K9's image check accepts the new hook sources without changing the
reviewed table, but historical image bindings have different interpreter/decoder pins and require a separately
reviewed binding.

Neither action deletes anything. Saved `previous-` files accumulate beside the override. If the rename itself
fails, the override is unchanged and an inert `ocr-paths-profile.json.pending-<id>` file stays beside it.
Like the build, both actions refuse outside `E:/Projects/ulpin-wt/demo` or while a recorded native process runs.
Elsewhere they run only with `--dry-run --out <absolute temporary folder>`, on an override already placed in that
folder with its scratch inside it. A copy of the real override does not validate there, because its scratch
belongs to the runtime folder; the rehearsal on a synthetic override is `docs/evidence/gf1/k9c/rehearsal.mjs`.

## A rehearsal runtime

A rehearsal is a second runtime beside the demo, for trying a roll-out or a journey on empty storage. Its name is
`ulpin-reh-NN` with two digits; any other name is refused before anything is read. The demo's commands above are
unchanged: without `--runtime` every script works on `ulpin-demo` with the values it had before.

What a name gives `ulpin-reh-NN`, with `ulpin-reh-01` as the example:

| Thing | Value |
| --- | --- |
| Folder | `E:/BhuAayam-data/runtime/ulpin-reh-01`, settings in `runtime.env` there |
| Compose project and bucket | `ulpin-reh-01` |
| Database and its user | `ulpin_reh_01` |
| Loopback ports | `21000 + 10 × NN + k`: Postgres 21011, S3 21012 and 21013, Redis 21014, geo 21015, API 21016 |
| Operator subject | `rehearsal-runtime-ulpin-reh-01` |
| Serving checkout | `E:/Projects/ulpin-wt/ulpin-reh-01` |
| Processor image | the demo's reviewed `ulpin-geo:demo-k3b`, reused; never built, tagged or pulled |

No rehearsal port equals a demo port (3194 included) or a port of another rehearsal. The gateway is written
disabled, and no real key goes into a rehearsal ([DEMO-GATEWAY.md](DEMO-GATEWAY.md)).

Run the commands from the rehearsal's own checkout, a worktree at a lead-reviewed commit with `pnpm install
--frozen-lockfile` done; start and the builder refuse a rehearsal name from any other checkout.

1. Create: `pnpm platform:start --profile demo --create --runtime ulpin-reh-01`
   It refuses when a volume or a container of that project exists but its settings file does not, and when one of
   its ports is taken. It writes the folder with new secrets, an empty `learning` folder and `ocr-scratch`, and
   `tabular-paths.json` and `ocr-paths.json`: those two name the demo's interpreter, seed, models and Tesseract
   (read, never written) and the rehearsal's own two folders. Then it brings up storage, applies the schema with
   no seed, checks that the reviewed image is on the engine and brings up the processors. It ends there: the API
   and dispatcher are not started yet. Run again after a failure, it resumes and writes no file twice.
2. Build or reuse: the processor image is reused and no command builds one. The document runtime is built:
   `node scripts/platform/demo-document-runtime.mjs build --runtime ulpin-reh-01`
   It writes `document-runtime-paths.json` and a new private profile directory in the rehearsal's folder.
3. Start: `pnpm platform:start --profile demo --runtime ulpin-reh-01`
4. Doctor: `pnpm platform:doctor --profile demo --runtime ulpin-reh-01`
5. Stop: `pnpm platform:stop --profile demo --runtime ulpin-reh-01`
   It stops that runtime's two recorded processes and the containers of its project, and removes nothing.

Stop for one name never touches another: it goes by that runtime's own process records and project label. After
any rehearsal step, the demo's doctor from the demo checkout must still show the same commit and process ids.
A rehearsal runs the reviewed image as it is, so a commit that changes `services/**` is not tried by it, and its
`models` folder starts empty. Removing a rehearsal (its folder, volumes and containers) is a separate,
owner-approved step; no script does it.
