# INGEST-02A / INGEST-03 manual foundation

The native backend can retain an unchanged GeoJSON original, inspect its actual field paths, author a constrained manual recipe, explicitly approve it as the server-configured local operator, and execute it through the existing synchronous GIS import-package authority. The isolated official NYC API journey passed. This is the bounded manual foundation; it does not pass the complete GF-AGENT or INGEST-03 cards.

## Code and ownership

- Accepted worker base: `1b44bdfdc7940f9046bc349655dba84efc442491`.
- Implementation and executed code: `2bac19da26e11783bf02bff621d272fa9456eab1`, branch `task/ingest-02-manual-mapping`, reusable worktree `0bc6`.
- Observed session model/effort: `gpt-6-sol` / `max`. Fast requested; local preference was `service_tier="priority"`; actual turn tier unobserved. No model call, model artefact, provider configuration, delegation or new task was used for this workflow.
- Contracts: `packages/contracts/src/usp/ingestion.ts`, USP export and the necessary retained source-view type addition. Server implementation: `packages/server/src/modules/usp/ingestion/`. The existing `ingestArea` accepts a transaction-only retained-original binding, checks its hash, preserves old callers/signatures when that binding is absent, and avoids copying the source row/object.
- Native module/manifest: `apps/api/src/modules/ingestion/`; domain registration and explicit additive inventory in `apps/api/src/openapi.ts`. Seven additions use disposition `added`; all 132 accepted operation IDs/dispositions are preserved by the focused metadata check.
- Additive SQL: `database/sql/95-ingestion/manual-mapping.sql`, manifest, USP migration call and authored-addition checker. The existing USP migration lock/transaction is reused. No historical SQL file/hash changed.
- Focused check and reproducible guarded journey: `tests/manual-ingestion.test.ts`, `scripts/usp/manual-mapping-smoke.mjs`, `scripts/usp/manual-mapping-state.ts`.

## Enforced boundaries

The actual retained bytes go through the existing bounded GIS inspection service. The profile contains source ID/family/revision/hash, versioned schema fingerprint, current case revision/workspace fingerprint, inspected CRS evidence, geometry types and inventory paths. Present values, explicit nulls and absent fields have separate counts. The profile does not invent source values, identifiers, geometry, units, ownership or issuance.

`MappingPlan` is strict and versioned (`manual-geojson/1`), with manual mode and exact inventory paths. Operations have only an approved target concept, source path and versioned registry ID. Numeric factors, CRS/coordinate/entity literals, tools, arbitrary expressions, unknown paths and model mode are rejected. Supported targets are building source key, optional name and polygon geometry. Literal source keys must be complete, unique strings that survive the existing normalizer verbatim; numeric ID coercion is intentionally unsupported here.

The registry has `literal_identifier@1`, `literal_text@1` and `geojson_polygon@1`. Text has no applicable units. Polygon normalization uses the existing `canonical-area-officer-v1` authority, with degree evidence from inspected RFC 7946/recognized OGC CRS84 and the retained canonical destination frame for metre output. A recipe cannot choose a CRS, factor or geometry role. Height/unit conversions are unsupported until retained unit and meaning evidence can qualify them; a caller unit choice cannot enable one. The unchanged NYC height stays unknown.

Authoring creates `proposed`. Approval rechecks source/scope/schema/destination and stores subject, timestamp, plan hash and `server_configured_local_operator` provenance. This is local process attribution, not human authentication. Approval cannot come from the request body. Execution reparses the strict plan, checks current source family/revision/bytes/hash, workspace and destination, and requires the stored approval for that exact plan/destination hash.

Receipt, recipe and decision mutations use the existing case authority/operations and PostgreSQL transactions. Current recipe revisions guard every edit/decision; reauthoring clears current approval while immutable decision revisions remain. Source-family changes invalidate older recipes. Same-byte workspace receipt deduplication and committed request replays work without reinspection. Case locks serialize author/approve/execute; execution follows the existing seed-lock then area-lock order and participates in the same `PoolClient` as `ingestArea`. Execution becomes terminal atomically with the package, preventing duplicate imports. Original source membership/bytes are retained separately from the resulting package's case.

Only the supported GeoJSON profile is admitted. The existing 16 MiB bound remains, and more than 2000 complete features return 413 with split guidance before processor inspection; nothing truncates records. No new parser authority, registry master, queue, source store, gateway or frontend was added.

## Official input and runtime evidence

Input: unchanged `fixtures/real-nyc/original.geojson`; original SHA-256 `6a0035cd7abe0f96da0fb7c9fc61067fd63c1894675e13e234173643e143ffda`. Retained provenance SHA-256: `762ad8fe4b28a65715810961b65e1a1610a6b3525467177d2f75bb94806349f4`.

The retained provenance identifies City of New York OTI, [original download](https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?doitt_id=353927), [terms](https://opendata.cityofnewyork.us/overview/#termsofuse), acquisition date 2026-09-13 and literal `doitt_id=353927`. Geography is New York City, USA; this is test-only evidence. No source discovery, new acquisition, transformed original or Indian operational claim was introduced.

Successful nonce/project: `5ba0facb64891e64` / `ulpin-usptest-5ba0facb64891e64`. The existing guarded launcher verified its own clean code pin, no root `.env`, fresh scoped database/bucket/volumes, server-derived OS operator and loopback ports. `REPO_DATA=false` selected explicit generated nonce configuration; its generic health label `linked` does not mean the user's populated linked services were used.

Private receipt: `.runtime/run01/5ba0facb64891e64/manual-mapping-smoke.json`; SHA-256 `bdf3fde7445a1d51a410ffc91039bae6b203eea97c5be818fc67ae6f8545b8da`. Completed at observed `2026-09-26T09:02:59.264Z`. Actual returned IDs:

| Resource | Actual ID |
| --- | --- |
| source case | `b7c9c4a5-6a90-4511-a879-c6dbff03659b` |
| retained source revision | `8830d5fb-17bb-4c0a-844c-6d0a38a8f0ea` |
| recipe | `9d24da63-4e10-45a8-ba2f-ab5d281e5f53` |
| import package | `d1fdf3b9-b282-4fa1-bb09-b68fce6edadf` |
| canonical area | `deac2d8e-d878-44df-841b-e0eeabca4f0c` |

The journey checked exact/same-hash receipt replay; source-derived path/presence/null inventory; registry/private-origin boundary; rejection of the five literal/tool control inputs, an unknown path, model mode and stale source/workspace pins; unapproved execution and caller attribution denial; stale recipe revisions; idempotent server approval; two concurrent same-key executions returning the same package; different-key repeat denial; retained proposed/approved/executed revisions; canonical package, candidate, source evidence and area reads; literal source ID and source geometry equality; unknown height/geometry role; exact private original download and unchanged fixture hash. Invalid plans were inert API controls; no operational fixture or geometry was fabricated.

Read-only checks in that nonce found exactly **1 source, 1 recipe, 3 recipe revisions, 1 import package, 0 jobs and 0 model calls**, with the exact original SHA-256. Package source/evidence pointers reference the already retained source, without an additional source row/object.

## Commands and exits

| Command | Exit / observed result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 0; lockfile up to date; no dependency changes |
| `pnpm typecheck:backend` | 0; server + API |
| `pnpm build` at the executed code pin | 0; server + API typecheck/build |
| `pnpm exec tsx --test tests/gis-inspection.test.ts tests/source-intake.test.ts` | 0; 17 checks passed |
| `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/manual-ingestion.test.ts` | 0; 2 checks passed, including 132 baseline + 7 declared additions |
| `node --check scripts/usp/manual-mapping-smoke.mjs` | 0 |
| `python3 scripts/db/verify_extraction.py` | 0; historical 25 files/136 hashes unchanged, 2 authored additions, 26 runtime queries + bootstrap |
| `git diff --check` | 0 |
| `node scripts/usp/real-source-runtime.mjs prepare` then `start <nonce-dir>` for `5ba0facb64891e64` | 0 / 0; five service health checks true |
| `node scripts/usp/real-source-runtime.mjs migrate-repeat <nonce-dir>` | 0; additive migrations repeat without reset |
| `node scripts/usp/manual-mapping-smoke.mjs <nonce-dir>` | 0; passed receipt above |
| `node scripts/usp/real-source-runtime.mjs stop <nonce-dir>` and `status <nonce-dir>` | 0 / 0; no containers, live owned leaders or group members |

Before the passing code checks, local harness/type corrections included a UUID inference type error (typecheck exit 2), root package resolution and missing API decorator configuration (test exit 1), and comparing the historical ledger's `pending-review` disposition rather than accepted catalogue dispositions (test exit 1). Each was corrected before the executed commit; the final commands above passed. An attempted stdout redirection to absent `.runtime/` failed before the OpenAPI generator executed or modified any catalogue.

The first fresh nonce `fabf2ae026e1e5f2` had startup exit 1: PostgreSQL terminated its connection at `db:migrate` before any API journey. The launcher stopped that nonce automatically and preserved its volumes. Its stopped status has no containers or process groups. The exact environmental cause was not established; a fresh nonce then passed startup and repeat migration without code changes.

## Relevant file pins at the executed commit

| File | SHA-256 |
| --- | --- |
| `packages/contracts/src/usp/ingestion.ts` | `f43a78492a13c859534616d8fec52fcef466791bf18fb818dba581a0ca4479eb` |
| `packages/server/src/modules/usp/ingestion/registry.ts` | `682ac3b7a71a495fc484ebd13edda4281ad7c82c0fef90b9a3792f43d427b790` |
| `packages/server/src/modules/usp/ingestion/service.ts` | `cd296a5ca85fe363f8720c34b3df30366816995288e7893e9a97df08783eba82` |
| `packages/server/src/modules/areas/areas.ts` | `6731fc9d1414a7d0156f6b2664775c3388211896bf541a7c3236f35b5352a7c3` |
| `apps/api/src/modules/ingestion/ingestion.controller.ts` | `1ffaa00029f4d1f5aad425e785c9dc83b28a686237c2fbba09b95444b4921370` |
| `apps/api/src/modules/ingestion/operation-manifest.json` | `5568ac5fff21ddfaeb527fa85d524977e9268a1548896214d07667a6321d14c4` |
| `database/sql/95-ingestion/manual-mapping.sql` | `9e5a2eedba0c88f4f9dc87bf4ae88305c36c13a4317784bc9bf6c0beb9ce8538` |
| `database/manifest.json` | `b28025c5547a5ba8c8d582a9e10bbc412fb24aa7fd7ba63d1d06a3a273c74436` |
| `scripts/usp/manual-mapping-smoke.mjs` | `3e1295f4df36cb12be4d7fefa30d8aca7045018e29260841c9371b5e62af3f23` |
| `scripts/usp/manual-mapping-state.ts` | `00846c96abb0608e2b8023bb28c46112f7c7a68ade1c14276672be2c5a17d517` |

## Integration and qualification limits

Lead integrates the owned code/receipt and its separate accepted `427955db2719657e889c3870e130baa2fec2f9ae` API checker/generator change, then owns final `docs/api` generation/pins/runtime catalogue. This worker did not edit the baseline ledger, final catalogue, root plans, gateway/AI core, frontend, protected design references, NWIC source worker paths, package/lockfiles or credentials. Nothing was pushed, merged to main, deployed or activated publicly.

This receipt qualifies the exercised manual route and guards on one retained official GeoJSON profile. It does not qualify height/unit conversion, other formats/concepts, source-semantic accuracy on held-out layouts, independently reviewed geometry/ownership/issuance, genuine changed-source row reconciliation, oversized official-source split/recovery, provider outage mid-batch, model proposals or per-batch caps, PII/injection coverage, streaming/SSE, learning, renderer, performance/scale or Indian operational data. The single NYC original contains no separately revised source and supplies no height-unit declaration. INGEST-02B and broader INGEST-03 work remain explicit follow-ons.

Cleanup: both owned nonce projects are stopped with no unresolved process groups. The passing nonce's `minio-data`, `postgres-data` and `redis-data` volumes, and the failed nonce's volumes, remain preserved. No populated volume was reset, reseeded, exported or deleted. Worker code was clean at run start and after cleanup; this handoff is the only subsequent documentation change.
