# Continue BhuAayam on another desktop

This is a companion to the private **29 September 2026 full desktop transfer**. Clone `staging` for code; the transfer supplies data and runtime state that Git does not contain. The package's `MANIFEST.json` pins the exact pushed commit and every included file's SHA-256. No Git patches or old unmerged branch bundles need applying.

## What travels separately from Git

| Content | Location in the extracted transfer |
| --- | --- |
| Official NYC buildings/context, LiDAR, DEM, imagery; Indian source inputs and acquisition evidence | `data/task-data/` with original manifests and receipts |
| Existing Lake View and NYC upload selections | `data/picker-datasets/` and `data/studio-datasets/` |
| E5 base model, saved learner adapters and corpus snapshots | `data/task-data/ai-06a-learning/` |
| Pinned Docling model, document inputs and extraction receipts | `data/task-data/ai-04a-docling/` |
| Building and floor ONNX checkpoints | `data/runtime-ml-models/` |
| Saved local NYC demo jobs and deployment-preparation references | `data/task-data/nyc-stream-demo*` and `data/task-data/oci-release-20260928/` |
| Original product recordings used by the launch reel | `data/launch-recordings/` |
| Actual private configuration, database dumps, object stores, queue state and worker runtime receipts | Authenticated encrypted `private.aesgcm`; key delivered separately |

Existing source/fixture classifications and training permissions stay unchanged. Copying a checkpoint does not qualify or promote it. Browser cookies, browser-local edits, SSH keys, old Docker VM images, dependencies, caches and obsolete test volumes are excluded. Older test volumes and original source files remain on the Mac. This is a local snapshot, not a fresh backup of OCI.

## Restore files after cloning

Extract the ZIP into its own directory, outside the clone. The following commands use a Bash/Linux/WSL shell; use paths belonging to the same environment that will run the project. Mac virtual environments and `node_modules` cannot be reused on the new system.

```sh
cd /path/to/extracted/BhuAayam-desktop-full-2026-09-29
python3 restore.py --verify-only
python3 restore.py --repo /path/to/clone
python3 restore.py --repo /path/to/clone --apply
```

The helper verifies the package before copying and refuses to replace any different existing file. Defaults are `~/.codex/task-data`, `~/Desktop/datasets`, `<repo>/apps/studio/datasets`, `<repo>/.runtime/ml-models` and `<repo>/video/launch/rec`. Override `--data-root` or `--picker-dir` if needed. Historical Mac paths inside receipts remain evidence; supply current paths to model scripts rather than rewriting those originals.

To authenticate and extract the private payload, install `cryptography` into a small transfer-only Python environment. Keep the separate key file out of Git:

```sh
python3 -m venv .transfer-python
.transfer-python/bin/python -m pip install cryptography
.transfer-python/bin/python decrypt-private.py \
  --key /path/to/BhuAayam-desktop-full-2026-09-29.key.json
.transfer-python/bin/python decrypt-private.py \
  --key /path/to/BhuAayam-desktop-full-2026-09-29.key.json \
  --output /path/to/new-private-restore --extract
```

Extraction requires a new output directory and authenticates the complete encrypted payload first. It does not install configuration or restore a database automatically. The private `EXPORT_MANIFEST.json` records database names, users, counts, dump hashes and the source volume associated with each profile.

## Choose the saved runtime before starting services

Four environments were exported independently. **Do not combine their database rows, object directories or queues.**

| Profile | Purpose | Saved application rows: cases / jobs / sources |
| --- | --- | --- |
| `linked` | Main local `ulpin` environment | 5 / 8 / 64 |
| `repository` | Isolated `ulpin-repo` environment | 132 / 567 / 489 |
| `prefix-worker` | AI-03C isolated prefix-mapping work | 3 / 18 / 3 |
| `large-source-worker` | AI-06A worker's earlier isolated runtime | 2 / 2 / 1 |

The private directory contains:

- `databases/<profile>/*.dump`: PostgreSQL custom-format logical dumps, suitable for migration across CPU architectures.
- `databases/<profile>/roles.sql`: private role definitions; inspect before applying to a destination cluster.
- `volumes/<profile>/minio.tar.gz`: cold object-storage volume, including original uploaded bytes and derived assets.
- `volumes/<profile>/redis.tar.gz`: cold queue/AOF/RDB volume, including saved pending jobs.
- `machine-files/configuration/main.env` and `repo-data.env`: saved local configuration.
- `machine-files/worktrees/`: worker runtime configuration and receipts. These are recovery material, not ready-to-run desktop configuration.

Restore only into **new, empty destination databases and volumes**. A safe restore sequence is:

1. Match the versions in `compose.yaml`: PostgreSQL 17/PostGIS 3.5, Redis 7.4.2 and the pinned MinIO release. Use the new machine's Docker context; do not transplant the Mac's `colima-ulpin` context or VM disk.
2. Select one profile and its matching private configuration. Copy configuration only if the destination file does not exist; review filesystem paths, loopback ports, database/object-store endpoints and active provider permissions. Keep the existing saved files as originals.
3. Create a fresh Compose project or explicitly new volume names. Keep geo, Celery, API, dispatcher and Studio stopped during restoration. Unpack that profile's MinIO and Redis archives into its **empty** corresponding volumes while those services are stopped. Check that the target is empty before extraction; never unpack over an initialized MinIO store.
4. Start PostgreSQL alone and create an empty application database from `template0`. Use the database/user names recorded in the private manifest, and restore any required roles deliberately. Restore the matching `.dump` with `pg_restore --exit-on-error`. If assigning objects to the destination application's database role, use `--no-owner --no-privileges`; otherwise preserve the saved roles and grants. Do not restore the optional empty `postgres.dump` over another environment's maintenance database.
5. Start MinIO and Redis only. Verify the selected profile's recorded table counts and source/object availability. Use existing additive migrations against the selected restored database if the code requires them; do not reseed or replace records.
6. Inspect saved job statuses and queue entries before starting Celery or the dispatcher. Restoring Redis is not permission to re-run paid providers, failed operations or training. Start the API alone first with `pnpm --filter @ulpin/api dev`; root `pnpm dev` also starts the dispatcher and is therefore inappropriate for the initial restore check.

Use the repository's normal platform scripts only after selecting and checking the restored profile. `REPO_DATA=false` uses `.env` and project `ulpin`; `REPO_DATA=true` selects `.runtime/repo-data.env` and `ulpin-repo`. Worker snapshots should remain archived until specifically needed, or be restored into separate projects with different ports.

The export checks verified every SHA-256, read each database dump's catalogue using `pg_restore --list`, and decompressed every member of the object/queue archives. **A full restore on the destination has not yet been run.** The source Colima VM was stopped again after export; no volume was reset or removed.

## Dependencies and the two application paths

Install the repository's `pnpm@9.12.0` dependencies with `pnpm install --frozen-lockfile`, using a Node version compatible with the locked dependencies (the source machine used Node 26.7.0). The geo container pins Python 3.12. Recreate separate local Python environments for the learner, optional document models and demo importer using their own checked-in requirement files. Do not merge those dependency sets into one environment.

On Windows, `database/sql/**` must retain its exact Git bytes: the SQL loader checks every file against `database/manifest.json`. The repository attributes now disable text conversion for these files. An older checkout with CRLF-converted SQL can report database readiness as unavailable even when PostgreSQL is reachable. Preserve any local edits before refreshing affected files, and verify their manifest hashes; do not change the expected hashes to accommodate checkout conversion.

The transfer helper also compares existing files byte-for-byte. On the first Windows restore, three tracked Studio dataset text files differed only in LF/CRLF endings. Their local contents were preserved, the unchanged transfer copies retained, and all other copied files were hash-verified. A content difference needs separate reconciliation, not the same line-ending exception.

For the normal backend, read [the API guide](api/README.md), [SQL guide](../database/README.md) and [startup guide](OFFICER_STARTUP.md). The OpenAPI contract is `docs/api/openapi.json`; backend typecheck and contract checks are recorded in the delivery ledger.

For the existing deterministic upload demonstration, `pnpm studio:demo` enables the separate local demo adapter and local frontend data mode. Install `scripts/demo-import/requirements.txt` into a new Python environment and set `ULPIN_DEMO_PYTHON` to its executable. Set `ULPIN_DEMO_DIR` to the restored `nyc-stream-demo` directory if it is not under the default `~/.codex/task-data`. This saved filesystem demo state is separate from NestJS's canonical database. Lake View's tracked definitions and the restored upload documents are both retained; prior browser-only requests/edits require their own browser export and are not included here.

For the launch reel, recordings restore to `video/launch/rec`; code and accepted narration are already in Git. Follow `video/reel/README.md` for FFmpeg/Playwright dependencies. The optional MLX voice-cloning route is Mac-specific; existing narration can be rendered on the desktop without regenerating voices.

## Resume ingestion work deliberately

AI-03C's approved-prefix implementation is merged into staging. Backend typecheck, the three focused event checks and generated OpenAPI/client checks passed. Prefix-before-EOF overlap, difficult-source behavior, replay/failure and end-to-end SSE runtime qualification remain pending. Exporting existing records does not pass those gates.

AI-06A's latest retained adapter remains the offline V4 candidate in `run-08-v4-correction`. Its coverage checkpoint records the additional Chesterfield/Halifax inputs and unresolved next-source/calibration work. No new fit or production promotion was performed during transfer.

Read [the migration ledger](orchestration/NESTJS_MIGRATION.md), [execution plan](orchestration/ADAPTIVE_INGESTION_EXECUTION.md), [learning guide](api/learning.md) and [source index](api/real-sources.md) before resuming. The old hold concerned the Mac Docker disk. On 29 September the user authorized Astra workers for model training and local GPU training if useful. The RTX 3070 has 8 GiB VRAM; choose CPU or GPU for the bounded frozen run based on measured suitability, preserve other processes, and retain untouched evaluation data. This does not expand cloud resources or authorize paid provider calls or a new larger model.
