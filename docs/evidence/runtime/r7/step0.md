# R7 step 0: the demo before the roll, and its schema steps to staging

Recorded 16 October 2026 by the runtime owner of R7. Roll-out target: staging `99e0026e` (the commit
`task/r7-roll-live-proof` starts from). Served commit: `18b5e74c` (demo checkout detached there, clean).

## Before

| Fact | Value |
| --- | --- |
| Served commit | `18b5e74c` |
| API / dispatcher PIDs | none: neither recorded process is alive; nothing listens on 3194 |
| Containers | the five `ulpin-demo` services up and healthy (about 4 hours) |
| `pnpm platform:doctor --profile demo` | exit 1: five FAILs, all from the stopped API and dispatcher; PASS Document runtimes, gateway `enabled: false` |
| Health `databaseReadiness` | not readable (API down). The same structural check run read-only against the served manifest: 131 of 131 requirements present |

The old API was therefore not answering while the schema steps ran; nothing served the database during them.

## The schema steps between `18b5e74c` and `99e0026e`

`git diff 18b5e74c 99e0026e -- database/` changes three manifest steps, not six. `ingestion.manual.schema`,
`ingestion.large.schema`, `ingestion.large.capacity`, `ingestion.events.index` and `ingestion.projected.schema` are
in both manifests unchanged and their objects are on the demo. A read-only catalogue query of the target's 142
structural requirements (the regexes of `schemaRequirements()`) found exactly these missing:

| Step | File | Additive? | On the demo before |
| --- | --- | --- | --- |
| `model-gateway.schema` (ordinals 7-11 new, GK1) | `database/sql/90-model-gateway/model-gateway.sql` | yes: 3 `ADD COLUMN IF NOT EXISTS` (nullable), `CREATE TABLE IF NOT EXISTS usp_model_key_marks`, `CREATE UNIQUE INDEX IF NOT EXISTS` | no: table, `usp_model_calls.credential_hash`, `usp_model_budget.reconciled_at`/`reconciled_reason` absent |
| `ingestion.intake.schema` (new, IN1) | `database/sql/95-ingestion/intake-ledger.sql` | yes: 4 `CREATE TABLE IF NOT EXISTS`, 5 `CREATE INDEX IF NOT EXISTS` | no: none of the four tables |
| `ingestion.intake.targets` (new, E1/ZB1) | `database/sql/95-ingestion/intake-targets.sql` | yes: 2 `CREATE TABLE IF NOT EXISTS`, 2 nullable `ADD COLUMN IF NOT EXISTS` on the new `usp_intake_items`, a guarded `ADD CONSTRAINT`, 2 `CREATE INDEX IF NOT EXISTS` | no |

No step drops, renames, narrows or rewrites a column, and none touches a row.

## The command, and why it reaches the demo database only

The registered runner is `scripts/platform/demo.mjs` `migrate()`: `pnpm db:migrate` (server `migrate()`, whose
`migrateOfficerAi()` runs `model-gateway.schema` as one query call and whose `migrateUsp()` runs both intake steps
inside its one USP transaction under the advisory lock), then `scripts/platform/demo-schema.ts`. Every other step
it calls is `IF NOT EXISTS` or ledger-guarded and already applied. `migrate()` is not exported, so a
wrapper outside Git (`E:/BhuAayam-data/task-data/r7/demo-migrate.mjs`) repeats its two commands from the
worktree at `99e0026e` with the same environment: `readDemo()` for `ulpin-demo` (the external demo settings,
never the checkout `.env`), `safeEnvironment()`, and the `isolated-env.cjs` preload that refuses the checkout
`.env` and requires `ULPIN_PROFILE=demo`. The database URL therefore comes only from the demo's own settings
file. No `--create`, no seed, no reset. Row counts of every table in `public` and `usp_display` are taken before
and after.

`pnpm-lock.yaml` changed (3 lines), so roll-out step 4 (`pnpm install --frozen-lockfile`) applies.
