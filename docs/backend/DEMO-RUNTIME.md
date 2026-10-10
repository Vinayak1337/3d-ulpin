# Pinned demo runtime

The demo API and dispatcher run from `E:/Projects/ulpin-wt/demo`, a detached, unedited checkout.
Current reviewed staging commit: `fbe525f7` (10 October 2026; R3 rollout, K5 revocation table applied first,
document runtimes rebuilt).
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

## Changing the document interpreter

Runtime owner only, after lead review of `docs/evidence/gf1/k9/result.json`; no switch was made by K9.
The project-owned environment is `E:/BhuAayam-data/ml/venv-demo-documents-20261010`.
Its `pyvenv.cfg` binds the full `base/cpython-3.12.14-windows-x86_64-none` directory, not uv's patch alias.
The new environment/base deny ordinary writes; retain that ACL and rebuild deliberately after any owner change.

K3b's `docs/evidence/gf-t16/k3b/activate-demo.mjs` created the demo-only `ocr-paths-profile.json` override.
It is create-once and cannot update an existing override. **There is currently no platform CLI for switching
its OCR interpreter:** the runtime owner must edit only `paths.ULPIN_DOCUMENT_OCR_PYTHON` in the existing
`E:/BhuAayam-data/runtime/ulpin-demo/ocr-paths-profile.json`, setting it to the new `Scripts/python.exe`.
Preserve `profile: "demo"` and the other four path values verbatim; retain the previous non-secret JSON for rollback.
Do not edit `demo.env`, the original OCR path file, model weights, tessdata or any existing environment.
A minimal follow-up is an owner-only action on the existing document builder: copy the five validated OCR paths,
change only the absolute interpreter, and atomically publish the override while retaining its previous version.
K9 does not implement that shared configuration writer.

After roll-out steps 2–4 (native processes stopped, reviewed checkout selected), perform that OCR path switch,
then the existing step 5 from the demo checkout:

```sh
PYTHON='E:/BhuAayam-data/ml/venv-demo-documents-20261010/Scripts/python.exe'
node scripts/platform/demo-document-runtime.mjs build --python "$PYTHON"
```

The explicit builder option changes pages/regions, **not OCR**; omitting the override edit leaves OCR on the old base.
Continue steps 6–7: `pnpm platform:start --profile demo`, then `pnpm platform:doctor --profile demo`.
Require PASS Document runtimes. Read the new profile's `repo`, `python`, `base` and pinned paths: its repo must be
`E:/Projects/ulpin-wt/demo`, its interpreter/base must be the new environment, and every pin must be under that
checkout or data `ml`. Use K9's `profile-files.mjs <profile-file>` to classify the inventory; compare classes with
`environment.json` (stdlib caches retained, package/hook caches absent), not a worker hash.
Run K9's `stability.mjs` once against the demo `document-runtime-paths.json` and a fresh owner evidence output:
it starts ten interpreters and repeats the same doctor profile check. Never reuse K9's `f1` profile for the demo.
Also check OCR once with the existing complete demo prefix; K9's no-runtime comparison used the retained split
prefix plus an absolute, hash-checked TSV config, not a copy of or a read from the demo's tessdata.

Rollback: stop the recorded native processes, restore the previous OCR interpreter path in that same override,
rebuild at step 5 with the old interpreter, then start and doctor again. The old path is recorded in K9 Step 0.
Rebuild rather than restoring a historical profile: its repo/base bytes may have changed. Rollback restores the
external-application update risk. K9's image check accepts the new hook sources without changing the reviewed table,
but historical image bindings have different interpreter/decoder pins and require a separately reviewed binding.
