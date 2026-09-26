# DB-READY-01 serving database handoff

Owner: DB-READY-01, `task/db-ready-01`, managed checkout `/Users/vinayak/.codex/worktrees/db-ready-01/3D Ulpin`. Accepted starting commit and original `staging` both verified as `78f44217312ae6cb545e04d844e363ac1c230ab6`. Requested Sol/max and Fast; configured host tier is `priority`, per-turn tier unobserved. Host default effort is high; it does not attest this task's effort override.

## Concrete implementation and review checkpoint

`scripts/db/serving-database.ts` has separate `preflight`, `upgrade` and `archive` invocations. It loads the explicitly named environment file internally without writing it or exposing credentials. Preflight uses PostgreSQL-enforced read-only sessions and repeatable-read transactions. It records opaque cluster/database/role/endpoint binding, exact code and SQL-manifest hashes, table counts and hashes over pre-existing columns, all declared FK orphan counts, actual illustrative-geometry violations, deliberate NOT VALID metadata and bounded unchanged original-object hash checks. Reports contain metadata/hashes, never row bodies, object keys or original content. Receipts are exclusive mode-0600 files; retain them outside Git.

Upgrade refuses changed code/environment/target/manifest/preflight, dirty code, concurrent tool invocation, observed active clients, invalid indexes, FK orphans, historical geometry violations or pending identity/area backfills. This initial path covers the inspected serving state; populated identity/area backfills need a separate exact review instead of silently weakening preservation checks. The lead must explicitly acknowledge quiesced writers. The tool cannot establish maintenance by observing one quiet moment, and never stops a process itself.

Upgrade invokes the existing `migrate()` and `ensureDatasetMl()` authorities with connection-level 2-second lock and 30-second statement limits. It does not concatenate SQL, change historical batches/USP transaction boundaries, introduce another ledger, create a bucket, seed, reset or rewrite originals. Before/after checks require every pre-existing row/count and original byte to remain unchanged. New metadata tables/markers are additive. Failure reports preserve partial-batch semantics: an earlier migration batch may already have committed. Recovery is a new read-only preflight followed by reviewed retry, never a down migration or volume reset.

Original verification uses the existing incremental `verifyObjectStream()` authority: at most 1,000 objects, 128 MiB each, 512 MiB total, 10 seconds per object within a 60-second scan deadline. It buffers no whole original, admits the accepted 71,238,839-byte NWIC ZIP numerically and does not loosen a parser or qualify NWIC import/accuracy. A source or scan outside these explicit bounds fails before upgrade; a slow read reports its existing storage timeout honestly. The initial 16/64 MiB verifier bounds were corrected after lead review to remain compatible with INGEST-06.

Archive requires a separately reviewed, hash-pinned exact-record file. It changes only `spatial_datasets.archived_at`, idempotently, in one bounded transaction under a table lock. It verifies original hash and whole-record fingerprint and compares all pre-existing records with only that archive column excluded before commit. IDs, canonical inputs, cases, sources, source bindings, jobs, identifiers, history and original/download links survive. A legacy `classification='synthetic'` or normalized scene declaration cannot authorize this operation.

`scripts/db/serving-nyc-import.ts` binds the native loopback API to the same opaque database target and manifest before any import. It uses the retained 1,763-byte official NYC OTI footprint through inspect → import → package/area/source reads, checks the package in the selected database, repeats through existing intake idempotency, and checks unchanged private original bytes and denied remote origin. No provider discovery, height mapping, fake attribute, floor, ownership, Indian or scale claim is made. This is one foreign test-only 2D footprint, not NWIC ingestion.

Health keeps existing dependency `ok`/services semantics and adds `databaseReadiness`. Its schema checks are derived from the current hash-checked SQL manifest: required relations, additive columns, USP markers and invalid-index status. `structurally_ready` explicitly qualifies only these structural checks. Counts cannot identify an official/eligible layer; populated upgrade, source suitability, actual constraint violations, map/read and product gates need their own receipts. Database target attestation is nullable if the API role lacks `pg_control_system` access; import tooling refuses an unattested target. No schema creation occurs during these health checks.

## Read-only linked audit, 26 September 2026

Private receipt: `.runtime/db-ready/linked-preflight-01.json` (passed, no mutation attempted). PostgreSQL 17.5/PostGIS 3.5.2; 53 pre-existing tables fingerprinted; 81 declared FKs checked, zero orphans; zero invalid indexes, existing unvalidated constraints or actual illustrative-geometry violations; zero pending identity/area backfills. All **61 original objects / 4,175,542 bytes** passed bounded exact SHA-256 verification. Two saved datasets account for 81 buildings, 189 floors and 55 declared scene sources. The serving database lacks 24 current USP/gateway/ingestion relations and all three USP migration markers. This is `schema_missing`, despite healthy dependencies.

The former writer at `3347d14^` hard-coded dataset, case and original inspection classification for every intake. Independent original-byte indicator inspection found declarations associated with synthetic/authored content, no observed real-world classification and no recognized official URL in the JSON members of the two originals:

- `2a1668dfe509b828ef8696f96eff3d024ef3eff61d8c3b5249b6911a433fdd39`: seven JSON members, two declaration indicators.
- `94d6cd80cd0b2ac4c0d7b5abf6b01dc93a70e373e6e607aae3d746579beea087`: nineteen JSON members, 32 declaration indicators.

These indicators **do not prove every member synthetic**. Binary members were not inspected as text. Both exact records remain `requires_original_review`; no archival has run and no synthetic-only decision has been fabricated. Private indicator receipt: `.runtime/db-ready/linked-lineage-indicators.json`. Lead review must supply retained provenance/evidence covering all members before exact archival; unknown/mixed originals stay active and preserved.

## Lead execution order

1. Review/integrate the owned code; coordinate INGEST-07's separate SQL/manifest/migration ownership. This tooling follows the exact manifest at execution, not an assumed future projection schema. The current audit qualifies only the accepted starting pin.
2. Pin clean serving code and explicitly quiesce writers at an authorized maintenance checkpoint. Preserve root `.env`, index and all volumes. Do not stop/restart root3188 or another lane from this worker.
3. Generate a fresh preflight on that exact serving code/environment. Read target/manifest tokens from its private receipt. Execute `upgrade`, then another fresh preflight and a same-target repeat `upgrade`. Accept only preservation/original checks plus complete required schema.
4. Supply reviewed exact archival file only for proven synthetic-only originals; preflight again, archive, then repeat with fresh preflight. Verify historical dataset/original reads through the native API. Keep unqualified records untouched.
5. Start/restart only the lead-authorized API on the reviewed code. Execute the small NYC API import and repeat; provide actual package/area/source URLs to the frontend owner from its private receipt. Do not claim complete property readiness or Indian district support.

Example commands (tokens are explicit receipt values; no default target exists):

```sh
pnpm exec tsx scripts/db/serving-database.ts preflight --env-file /absolute/private/environment-file --out /absolute/private/preflight.json
pnpm exec tsx scripts/db/serving-database.ts upgrade --env-file /absolute/private/environment-file --preflight /absolute/private/preflight.json --expect-code CODE_SHA --expect-target TARGET_TOKEN --expect-manifest MANIFEST_SHA --maintenance-ack writers-quiesced --out /absolute/private/upgrade.json
pnpm exec tsx scripts/db/serving-database.ts archive --env-file /absolute/private/environment-file --preflight /absolute/private/preflight-after-upgrade.json --expect-code CODE_SHA --expect-target TARGET_TOKEN --expect-manifest MANIFEST_SHA --maintenance-ack writers-quiesced --review /absolute/private/archive-review.json --expect-review REVIEW_SHA --out /absolute/private/archive.json
pnpm exec tsx scripts/db/serving-nyc-import.ts --env-file /absolute/private/environment-file --api http://127.0.0.1:3192/api/v1 --expect-code CODE_SHA --expect-target TARGET_TOKEN --expect-manifest MANIFEST_SHA --out /absolute/private/nyc.json
```

Archival review format: `version="serving-archive-review/1"`, exact `target`, exact `manifestSha256`, and `datasets` entries containing exact `id`, `originalSha256`, `fingerprint`, `decision="archive_active_only"`, `basis="reviewed_original_lineage_synthetic_only"`, `evidenceFile` and `evidenceSha256`. Generate pins from a fresh private preflight; evidence must be a retained review of originals, not the historical writer's default label.

## Verification and remaining qualification

Frozen dependency install (`--ignore-scripts`) exited 0. Native backend typecheck exited 0. Linked guarded read-only preflight exited 0 with exact original preservation. The initial standalone script typecheck used unsuitable non-strict defaults and exposed a ReadableStream iteration typing issue; the importer now uses its bounded reader directly, with a strict script check recorded below when run. No extra operational records or synthetic fixtures were authored.

Serving upgrade, serving archival, serving NYC import, complete populated-migration qualification and frontend use remain pending the internal lead handoff. No root environment write, shared-schema edit, live provider call, push, main merge, deployment, root runtime restart or source content export was performed.
