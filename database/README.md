# Database SQL extraction (NEST-01 phase 1)

This directory is an exact, ordered extraction of the PostgreSQL/PostGIS SQL at
`39a70488f44800567ff42ef175b94d42c2ee66b5`. **Runtime wiring is pending
NEST-01 phase 2.** At this revision, `scripts/migrate.ts` still calls the
TypeScript migration functions; the Docker init script still comes from
`infra/postgres/001-extensions.sql`. The [manifest](manifest.json) gives every
old query call (or init file), source function and line, SHA-256 of the whole
query batch and of each SQL statement, order, timing, transaction scope, lock,
condition and parameter. Each
`.sql` file preserves one complete original query string, including its
whitespace and any multiple statements. The files contain no generated rows.

## Execution order and boundaries

1. **New PostgreSQL data directory only:** Docker's `/docker-entrypoint-initdb.d`
   mounts `infra/postgres/001-extensions.sql`; its exact copy is
   [sql/00-bootstrap/postgis.sql](sql/00-bootstrap/postgis.sql). An existing
   populated volume does not replay Docker init.
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
does not establish that it ran. This extraction is **not** a reset script.
Do not concatenate the files, run them with `psql`, or replay them against a
linked/populated service. Phase 2 must route the existing migration functions
through this manifest while retaining their conditional control flow and
transaction boundaries. It also must decide with the lead how the fresh-volume
Docker init mount should point at the extracted bootstrap file. No database
was opened to prepare or verify phase 1.

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
the pinned source with `git show`, compares exact UTF-8 SQL bytes and hashes,
checks manifest/file coverage, and scans the pinned server tree for any
unlisted schema-bearing query literal. It imports no application modules and
does not connect to PostgreSQL. A changed migration literal needs a reviewed
manifest/SQL update in phase 2, not a silent overwrite of the extracted file.
