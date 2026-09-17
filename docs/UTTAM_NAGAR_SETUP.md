# Get the Uttam Nagar data after git pull

This is the normal update path. It transfers the exact saved records and source
files; it does **not** rerun a scrape, regenerate rooms, or replace the database.

## Windows PowerShell — existing clone

Start Docker Desktop with Linux containers. Run from your existing `3d-ulpin`
folder on `main`. Stop a running app with **Ctrl+C before pulling/building**.
Keep your existing `.env`, with **`REPO_DATA=true`**. Do not paste somebody else's
database credentials or copy their `.runtime` folder.

```powershell
git pull
pnpm.cmd install --frozen-lockfile
pnpm.cmd repo:init
pnpm.cmd db:migrate
pnpm.cmd data:uttam:install
pnpm.cmd data:uttam:verify
pnpm.cmd exec playwright install chromium
pnpm.cmd build
pnpm.cmd start
```

Open **http://127.0.0.1:3000/delhi** for the three studies, or
**http://127.0.0.1:3000/blocks** for all saved blocks. Keep the final terminal open.

The data install works before the web server is started; a second terminal is
not required. No separate host Python/PostgreSQL/Redis/MinIO installation and no
AI key is needed. The Node/pnpm prerequisites are the same as the repository's
existing setup. On macOS/Linux, use `pnpm` instead of `pnpm.cmd`.

If Chromium is already installed for the locked Playwright version, its install
command simply reuses the installation. It supports property PDF exports too.

### A clone that was never initialized

Use the same sequence above. Before `repo:init`, create `.env` **only if absent**:

```powershell
if (-not (Test-Path -LiteralPath .env)) {
    "REPO_DATA=true" | Set-Content -Encoding ascii -LiteralPath .env
}
```

For an existing `.env`, edit its `REPO_DATA` entry to `true` and preserve the other
entries. `repo:init` creates local credentials, starts the isolated Docker
services, and restores the original Lake View/Bronx snapshot only if the database
is empty. It preserves an already initialized copy of that snapshot.

If `git pull` reports local changes or a merge conflict, resolve that first. Do
not use `git reset --hard`, remove volumes, or overwrite `.env` as a shortcut.

## What is transferred

The versioned **`data-bundles/uttam-nagar`** package contains **4,440 scoped database
rows across 32 tables and 53 original-file keys**. The compressed database payload
is approximately 11.3 MB. The bundle covers these six areas:

| Study | Public reference | Separate fictional scenario |
|---|---|---|
| Google Open Buildings + OSM | 15 selected Google predictions + 35 road segments | 15 invented-height buildings + 36 road corridors; 9 floors, 27 spaces |
| Larger OSM window | 113 building outlines + 35 road segments | 114 buildings + 36 roads + 3 demo parcels; 9 floors, 36 spaces |
| Smaller OSM road block | 20 building outlines + 9 road/path segments | 21 buildings + 10 roads + 3 demo parcels; 9 floors, 27 spaces |

The synthetic copies include the saved fictional resident/common-use allocations,
reviewed room geometry, supporting plans/schedules, source references, identifiers,
workspaces and computed-check history. There are **90 detailed spaces** across the
three separate scenarios; do not combine their statistics into a single physical
neighbourhood. Reference layers do not invent heights, occupants or legal parcels.

The Google-specific data provenance and confidence selection are documented in
[GOOGLE_UTTAM_NAGAR.md](GOOGLE_UTTAM_NAGAR.md). The small source files are under
`fixtures/google-uttam`, `fixtures/uttam-nagar` and `apps/web/public/datasets`.

**Not included in Git:** the approximately 7.19 GB regional Google shard, the
236 MB Delhi-wide extract, full screen recordings, `.env`, local credentials,
PostgreSQL roles or Redis execution queues. Those large acquisitions are not
needed to reproduce the saved Uttam Nagar blocks. The repository includes their
acquisition scripts, provenance and the bounded inputs actually used by the app.

## Commands and preservation guarantees

`pnpm data:uttam:check` validates the packaged row payload, dependencies and all
original-file checksums without accessing your database.

`pnpm data:uttam:install` only selects the isolated repository data mode. It checks
schema compatibility and existing identities, uploads missing originals using
create-only object writes, and inserts missing database rows in dependency order
inside a transaction. Constraints remain enabled. It never issues UPDATE/DELETE
against application data, drops tables, truncates data or resets Docker volumes.

An already existing exact copy is adopted without duplication. A conflicting
record encountered on the first installation causes a refusal and database
rollback rather than an overwrite. A failed attempt may leave newly uploaded,
unreferenced immutable objects; an unchanged retry checks and reuses those objects.

After installation, the database stores a bundle receipt. Repeating the same
install preserves subsequent local edits rather than reapplies the old records.
The complete before-import database is not copied into this addon: Lake View,
Bronx and any unrelated project stay outside its scope.

`pnpm data:uttam:verify` checks every transferred row value and original file
against the bundle. Run it immediately after installation. Later editing a
transferred record can correctly make this exact comparison fail; do not delete
your edits to force a pass. Appended check history alone does not invalidate the
required original rows.

Do **not** run the older source-replay scripts after installing the saved bundle.
Those are advanced acquisition/import workflows, with their own local checkpoint
requirements, not the update path above. No machine-specific checkpoint file
needs to be transferred for the normal data-bundle installer.

`repo:verify` is different: it compares the entire database against the old
15 September base snapshot. After adding Uttam Nagar it is expected to report
additional data. Use `data:uttam:verify` for this addon; do not reset the database.

## Direct saved links

Google source reference:
http://127.0.0.1:3000/blocks/276dc595-97c4-4253-bf47-db4a12fd542b

Google-derived fictional 3D registry:
http://127.0.0.1:3000/blocks/457bac4c-1c6c-4157-a12a-1d44ba3c1bcf

Building A in that fictional registry:
http://127.0.0.1:3000/properties/32de2af6-bf96-49e4-8730-f8f856dcee6b/register

The bundle preserves saved identifiers, so these links remain valid on another
computer using this transfer method. `localhost` only refers to that computer;
this does not deploy the app publicly.

## Validation

`pnpm test:uttam:transfer` creates its own disposable database and bucket, restores
the original repository database there, adds an unrelated case and a custom edit,
then installs this bundle. It checks exact row/geometry/source preservation,
unchanged existing data, repeat-install no-ops, preservation of later edits,
conflict refusal/rollback, and adoption of a pre-existing exact copy. Only the
test database and bucket created by that invocation are removed afterward.

This transfer test passed on native Windows with Docker Desktop. It validates
the fresh target-database path on the same PC, not a claim that a second physical
computer was remotely operated. The focused tests are `pnpm test:uttam`.

## Evidence limits and licences

Public geometry remains Google model predictions and OpenStreetMap observations,
not an official cadastral survey. All generated heights, interiors, demo parcels,
residents, common-use assignments and deliberately introduced conflicts remain
labelled fictional. The programme does not issue official ULPINs or determine
ownership or actual encroachment.

Credit Google Research Open Buildings V3 and OpenStreetMap contributors. The
combined geographic datasets use ODbL 1.0, including Google's offered ODbL option;
retained authored sources disclose their fictional/derived nature. No actual
resident directory, private identity documents or service credentials are part
of this addon.
