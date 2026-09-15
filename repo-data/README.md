# Complete repository data snapshot

This is the saved local application state exported on 15 September 2026, not a new seed. It includes 44 application tables (7,211 rows), every one of the 497 stored object keys (88 distinct byte payloads), retained PDF/PNG/CSV/JSON originals, source and geometry revisions, reviews, archived scenarios, investigations, identities and processing history. Ten presentation assets already tracked under `apps/web/public/scene-assets/` are hash-bound in the manifest. Total snapshot size is approximately 5.9 MB; Git LFS is not required.

`manifest.json` maps each original object key to its content-addressed file and retains its MIME type, metadata, byte count and SHA-256. `database.dump` is a PostgreSQL custom-format archive without roles, ownership or grants. Restore uses the application `public` schema over the pinned PostGIS image's preinstalled extensions. The manifest records exact per-table row counts and hashes. Checkout attributes preserve bytes on Windows as well as macOS/Linux.

## Start from this data

Install Node.js, pnpm 9.12 and a running Docker engine with Linux containers and Docker Compose. On Windows, the `repo:*` commands use Node directly with Docker Desktop; the older `platform:*`/`demo` Bash launchers require WSL. Native Windows execution has not been tested.

From the project folder:

```sh
pnpm install --frozen-lockfile
pnpm repo:check
pnpm repo:init
```

Create or edit the root `.env` and set:

```dotenv
REPO_DATA=true
```

Keep existing database/storage settings if present; they remain the linked-mode configuration. Then:

```sh
pnpm db:migrate
pnpm build
pnpm start
```

Open `http://127.0.0.1:3000/blocks`. Lake View and the real Bronx example are already present, with their original IDs. No seed commands are needed. For development, use `pnpm dev` instead of build/start. The generated private `.runtime/repo-data.env` holds newly generated local credentials; never commit it.

## Select a mode

| Root `.env` | Selected services |
| --- | --- |
| `REPO_DATA=true` | Isolated `ulpin-repo` Compose project: database port 15433, object storage 19010, processor 18001, Redis 16380; dedicated volumes and credentials |
| `REPO_DATA=false` or omitted | Existing `DATABASE_URL`, `S3_*`, `GEO_*` environment configuration; original linked services unchanged |

Stop and restart **both the web app and dispatcher** after changing the flag. Their pools/clients are process-local. No mode switch copies, clears or replaces the other dataset. `/api/v1/health` reports `dataMode: "repository"` or `"linked"`. `pnpm demo` refuses to reuse a running app in the wrong mode. `platform:start`, `platform:health` and `platform:stop` select the appropriate Compose project from the same flag.

Repository data is writable in its dedicated volumes. Repeating `pnpm repo:init` preserves local edits and history. It validates the bundled files first, refuses a different/nonempty snapshot, and never drops a populated database. An interrupted initial object upload can resume only when existing objects match the snapshot. An unmarked database after an interrupted restore is retained for manual recovery, never automatically cleaned.

## Verify or deliberately refresh the bundle

```sh
pnpm repo:check
pnpm repo:verify
pnpm test:repo-data
```

`check` verifies committed file and presentation-asset hashes without a database. `verify` compares every restored table and all 497 object payloads to the snapshot; expected local edits will make this strict comparison fail, without changing anything. Run it immediately after a fresh restore.

To export the currently selected dataset after processing jobs are idle:

```sh
pnpm repo:export --output .runtime/repo-data-next
```

Inspect the new bundle and its redistribution/privacy suitability, then explicitly replace the committed snapshot and review the Git diff. The exporter refuses to overwrite an existing bundle. It uses a shared PostgreSQL transaction snapshot for table hashes and the database archive, verifies every `sources` record against its original, and checks that object storage did not change during export. It currently exports the selected **local Compose database**; remote linked databases fail explicitly rather than exporting a different database. New files over 95 MiB require a separate Git LFS decision.

## Provenance and exclusions

The snapshot contains authored fictional training/test inputs and previously retained NYC Open Data observations. NYC attribution and limitations remain in [real-area documentation](../fixtures/real-area/README.md), its exact cached source/terms evidence, and [real-NYC documentation](../fixtures/real-nyc/README.md). Lake View and demo parcel identifiers are fictional; no official ULPIN issuance or real Indian interior/survey data is implied. Originals have not been rewritten or relabeled.

Credentials, `.env` files, database roles, Redis execution queues/caches, and browser-local preferences/measurement notes are intentionally excluded. Database processing history is retained; pending work is not exported. Temporary download ZIPs/PDF reports can be regenerated through the application. Live assistance still requires separately configured credentials. Future private uploads must not be published just because an export command exists.
