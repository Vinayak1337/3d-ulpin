# Database SQL authority (NEST-01)

INGEST-06 adds [large-original receipt SQL](sql/95-ingestion/large-original.sql): `usp_source_uploads` stores case/operator scope, request binding, revision/state, reserved original size and durable lease; `usp_source_upload_parts` stores bounded numbered parts, hashes, immutable object keys and attempt/lease state. `migrateLargeOriginalTx()` runs in the existing USP migration transaction. Object writes occur outside database transactions; fenced state controls publication of one canonical `sources` row. Exact zero-byte storage markers prevent expired producers from restoring reclaimed payload. The [large-original handoff](../docs/evidence/usp/ingest-06-large-original-handoff.md) records the bounded profile, finite lifetime receipt capacity and separately pinned recovery evidence. This metadata extends the existing source authority and creates no separate conversion queue.

INGEST-02A adds [manual mapping SQL](sql/95-ingestion/manual-mapping.sql): `usp_mapping_recipes` links one current recipe to a retained `sources` row and owning `cases` row; `usp_mapping_recipe_revisions` keeps immutable decision bodies by recipe/revision. The strict wire contract validates the versioned JSON bodies. `migrateManualIngestionTx()` executes this authored manifest step inside the existing USP migration transaction/advisory lock. Approval and execution preserve source/workspace pins, and successful execution commits its terminal recipe revision and existing import package in one transaction. The [manual mapping receipt](../docs/evidence/usp/ingest-02-manual-handoff.md) records fresh/repeated schema execution and a corrected case-before-area concurrency check. No populated-data migration qualification follows from it.

DEPLOY-01 adds [the model gateway migration](sql/90-model-gateway/model-gateway.sql) as a new authored, hash-pinned manifest step after the historical extraction. `migrateOfficerAi()` invokes it through `migrateModelGateway()` during the existing migration command. It creates one `usp_model_calls` reserve/settlement ledger and a singleton `usp_model_budget` control row for pinned policy/credential identity, exhaustion and shared pacing. The control row is first populated from explicit approved configuration at admission; there is no automatic allocation, seed or reset. Short admission/settlement transactions lock that row; provider transport always runs after commit. Unknown exposure remains deducted across restart. Historical SQL below remains unchanged. Fresh control-only schema execution/repeat was verified; populated migrations and live billing remain unqualified.

This directory is an exact, ordered extraction of the PostgreSQL/PostGIS SQL at
`39a70488f44800567ff42ef175b94d42c2ee66b5`. The `.sql` files are now
the **executed SQL authority**: the existing migration functions call
`packages/server/src/infrastructure/sql-loader.ts` by named manifest ID, and
`compose.yaml` mounts the bootstrap file here. The [manifest](manifest.json)
records both the pinned historical source path/function/line and current
runtime caller, SHA-256 of each query batch and SQL statement, order, timing,
transaction scope, lock, condition and parameter. Each file preserves one
complete original query string, including its whitespace and any multiple
statements. The files contain no generated rows. Static wiring and hash checks
have passed. The [phase 2A runtime receipt](../docs/evidence/usp/nest-migration/runtime-foundation/README.md)
records fresh schema execution and same-database repeatability. Populated-data
migration is separately unqualified.

## Execution order and boundaries

1. **New PostgreSQL data directory only:** Docker's `/docker-entrypoint-initdb.d`
   mounts [sql/00-bootstrap/postgis.sql](sql/00-bootstrap/postgis.sql) from
   `compose.yaml`. An existing populated volume does not replay Docker init.
2. **Migration command:** `scripts/migrate.ts` invokes `migrate()` in `db.ts`,
   then private bucket setup. `migrate()` sends the core, registry, area,
   officer, officer AI and spatial ML files as six *sequential* `pg` query
   batches. There is no explicit transaction spanning those six calls. Keep
   each multi-statement file in one query call: splitting statements into
   separately committed calls would change partial-failure behavior. The
   core batch includes two historical identity backfills; the area batch
   backfills `map_areas` from existing registry sites.
3. **USP inside the same `migrate()` call:** `migrateUsp()` opens one explicit
   transaction and acquires advisory transaction lock `usp-migration-ledger`.
   It creates the ledger, checks `usp_f1_min_001`, conditionally executes the
   snapshot/job/packet batch and records its marker; then does the same for
   `usp_identity_001`. `migrateUspGeometryTx()` runs in that *same* transaction,
   checks `usp_geometry_separation_001`, and conditionally executes its role,
   constraint, function, trigger, view and grant batch before recording its
   marker. A present marker skips that batch. The `$1` values and guarded
   branches are in the manifest; executing all files in filename order would
   be wrong. Geometry's six `NOT VALID` constraints preserve incompatible
   historical rows while rejecting new writes. Its role validation and
   grants require the same privilege behavior as the old function.
4. **Lazy dataset setup:** `ensureSpatialDatasets()` runs on first dataset,
   identifier or work-queue access, not in `migrate()`. One explicit transaction
   acquires `spatial-dataset-schema-v1`, then executes the table, two additive
   columns and identifier table in order. An in-process `ready` promise
   coalesces calls and is cleared on failure.
5. **Lazy dataset ML:** `ensureDatasetMl()` first calls
   `ensureSpatialDatasets()`, then opens its own transaction under
   `dataset-ml-schema-v1`, creating runs, reviews and indexes in one query
   batch. It has the same promise/failure behavior.

The migration command is a deliberate invocation; an API process start alone
does not establish that it ran. This is **not** a reset script. Do not
concatenate the files, run them with `psql`, or replay them against a
linked/populated service. The existing TypeScript functions retain the
conditional control flow and transaction boundaries. No database was opened
to prepare or verify NEST-01.

## Schema groups and relationships

| SQL group | Existing tables and relationship |
| --- | --- |
| [Core](sql/01-core/core.sql) | `cases` own `sources`, `units`, `jobs`, `snapshots`, `events` and idempotent `operations`. `unit_revisions` retain unit history. `identity_floors` and `identity_spaces` assign application floor/space ordinals within a case; the SQL backfills historical units, including inactive ones. `jobs` links an optional source and has the pending index. |
| [Registry](sql/10-registry/registry.sql) | `registry_sites` scope `registry_records`, revisions, links, rights, drafts, reviews, aliases and case import/mapping records. `cases.site_id` links the older case store to a site. Registry footprints have a GiST index. |
| [Area](sql/20-area/area.sql) | `map_areas` link one registry site. `administrative_units`, relationships and memberships provide area context. `import_packages` and revisions link cases to areas. `physical_features` and revisions retain native and geographic geometry; source links, external identifier assertions, check runs, scene bindings and acquisitions attach to that area/feature graph. The SQL includes two geometry GiST indexes and scoped identifier indexes. |
| [Officer](sql/30-officer/officer.sql) | Associations and revisions, block groups and memberships, building preparations and revisions, and investigations and revisions refer to canonical cases, areas, features or packages. An association's `to_id` has no declared foreign key in the source SQL; this extraction does not add one. |
| [Officer AI](sql/40-officer-ai/officer-ai.sql) | `officer_ai_runs` attach to import packages; `officer_ai_derivatives` attach to runs. Their input index is retained. These are existing run/derivative receipts, not an H20 provider funding ledger. |
| [Spatial ML](sql/50-spatial-ml/spatial-ml.sql) | Adds `jobs.started_at`; `spatial_ml_batches`, items and footprint drafts link packages, sources and jobs. Existing package/job indexes remain. |
| [USP](sql/60-usp/03-f1-schema.sql), [identity](sql/60-usp/06-identity-schema.sql), [geometry](sql/60-usp/09-geometry-schema.sql) | `usp_snapshots` and bodies, command receipts, outbox, job attempts/metadata, releases and packets add evidence and fencing around existing authorities. Project identity reviews, permanent `usp_project_codes`, state, audit and lineage reference registry records. Geometry qualifications annotate canonical records; a guarded `usp_analytic_geometry` view exposes qualified geometry, while `usp_display.derivatives` is separate, immutable display-only storage. Reader roles/grants and triggers are preserved byte-for-byte. |
| [Spatial datasets](sql/70-spatial-datasets/01-schema.sql), [dataset ML](sql/80-dataset-ml/01-schema.sql) | Lazy `spatial_datasets` link cases and original sources; `spatial_dataset_identifiers` attach to datasets. Dataset ML runs link `jobs`, datasets and sources; reviews link runs. The existing dataset table's `classification='synthetic'` constraint remains exactly as found. The active intake profile must be resolved separately, with historical records preserved. |

Canonical originals are `sources` plus private object keys, and the registry
and physical-feature tables remain the record authority. USP metadata,
qualifications and display derivatives do not establish legal ownership or
official ULPIN issuance. The application P3 code is distinct from a sourced
official parcel assertion. A geometry view or display asset is not a new
canonical registry. SQL files preserve the current constraints rather than
claiming that unimplemented policy is already enforced.

The H20 provider budget/reservation/queue tables are **not present** in the
SQL or schema-producing code at this pinned revision. The current
`officer-ai-provider.ts` computes an in-memory request budget and
`officer_ai_runs` stores run bodies; neither implements the planned durable
provider funding ledger. This is an inventory gap, not an invitation to
invent that schema in NEST-01.

## Source integrity check

Run `python3 scripts/db/verify_extraction.py` from the repository. It reads
the pinned historical source with `git show`, compares exact UTF-8 SQL bytes
and hashes, checks manifest/file coverage, scans the pinned server tree for
unlisted schema-bearing query literals, and checks current runtime wiring in
the moved server modules and Compose mount. It imports no application modules
and does not connect to PostgreSQL. A future SQL change needs a reviewed SQL,
manifest and migration update; the historical source comparison remains a
separate provenance check.
