# INGEST-02A / INGEST-03 manual foundation

The native backend can retain an unchanged GeoJSON original, inspect its actual field paths, author a constrained manual recipe, explicitly approve it as the server-configured local operator, and execute it through the existing synchronous GIS import-package authority. The isolated official NYC API journey passed. This is the bounded manual foundation; it does not pass the complete GF-AGENT or INGEST-03 cards.

## Code and ownership

- Accepted worker base: `1b44bdfdc7940f9046bc349655dba84efc442491`.
- Initial implementation and full manual-journey code: `2bac19da26e11783bf02bff621d272fa9456eab1`, branch `task/ingest-02-manual-mapping`, reusable worktree `0bc6`. The reviewer-requested lock-order correction and its separately pinned targeted run are recorded below.
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

Initial-run cleanup: both owned nonce projects above are stopped with no unresolved process groups. The passing nonce's `minio-data`, `postgres-data` and `redis-data` volumes, and the failed nonce's volumes, remain preserved. No populated volume was reset, reseeded, exported or deleted. Worker code was clean at those run starts and after cleanup. Their full manual-journey evidence remains pinned to `2bac19d`; it was not silently reassigned to the correction below.

## Reviewer P2 lock-order correction

Reviewer found a concrete case/area cycle: manual execution locked source case C before map area A UPDATE, while existing source-workspace assignment locked A SHARE before C UPDATE. Concurrent legal commands could deadlock and surface a generic 500. Correction commit **`f5fcbcdd48bc66c6a6895b902ec5b02a656f3ade`** moves the existing-case lock and its association/package checks ahead of the area lock in `packages/server/src/modules/cases/source-workspaces.ts`. Both routes now acquire C before A. The existing transaction, replay behavior, area/reference/frame guards and source-context conflict checks remain; no nested transaction, source rewrite or new authority was introduced.

Targeted check: `scripts/usp/manual-mapping-lock-order.mjs` verifies a clean owned nonce and launches `manual-mapping-lock-order.ts` using only its generated environment. All source/case/recipe/package setup is through the native API on unchanged official NYC bytes. The direct PostgreSQL participants hold and release locks only; they insert or change no operational rows. The check deliberately exercises the existing-area route, rather than repeating the unrelated full manual smoke.

Fresh corrected runtime: project `ulpin-usptest-95ebcd725962de40`, nonce `95ebcd725962de40`, served code **`f5fcbcdd48bc66c6a6895b902ec5b02a656f3ade`**. Private receipt `.runtime/run01/95ebcd725962de40/manual-lock-order.json`, SHA-256 **`cf364167189492515f9a730ed614b8921ecbda5206d2c01ba510b67b955dd881`**, observed completion `2026-09-26T09:08:31.344Z`.

| Forced schedule | Actual response / preserved state |
| --- | --- |
| Execute owns C and waits on the existing destination seed lock; assignment starts while C is held | PostgreSQL activity/lock checks found assignment waiting on C with **zero granted map-area locks**. Releasing the seed barrier produced execute **200**, then assignment **201**. Assignment replay returned the same workspace; a new execution request after assignment returned **409** for current context. History remains proposed/approved/executed. |
| Assignment queues on a held C before execute queues on the same C | Releasing the case barrier produced assignment **201**, then execute **409 STALE_REVISION**. Recipe history remains proposed/approved, with no execution publication. Assignment replay returned the same workspace. |

Actual executed-case IDs: `f68bd489-2ae4-48cd-b775-0ca7af92d7bb`, source `b4c32ce0-10e4-4fb8-af8a-0fff718259d2`, recipe `1cbb6d9f-ecf6-48b9-952e-5e37286d1b94`, assigned workspace `5d744df3-4bd5-4226-ae21-bb8c452d0130`. Actual assignment-first IDs: case `064bd1f8-9c66-457b-810a-6af199d3df54`, source `bad62ab2-395e-4d77-bae8-a80fb9ef6921`, recipe `656edd33-51a1-4c9d-bb70-7832af40db6b`, workspace `44a18b3e-3690-46c1-932a-c77db73de370`.

Whole fresh database counts were exactly **3 sources, 2 recipes, 5 decision revisions, 4 expected packages, 0 jobs and 0 model calls**. The sources are the official seed import and two API-created source cases receiving the unchanged original. The four packages are seed, executed manual package and two source workspaces; assignment-first execution added none. Both retained-source downloads and the repository fixture still match original SHA-256 `6a0035cd7abe0f96da0fb7c9fc61067fd63c1894675e13e234173643e143ffda`. No synthetic operational record, source identifier or geometry fixture was introduced.

Correction commands/exits: `pnpm typecheck:backend` **0**; `node --check scripts/usp/manual-mapping-lock-order.mjs` **0**; `git diff --check` **0**; existing guarded runtime `prepare` **0**, `start <95ebcd725962de40-dir>` **0** (all five service checks true); `node scripts/usp/manual-mapping-lock-order.mjs <nonce-dir>` **0**; guarded `stop` **0** and `status` **0**. Cleanup reported no containers, live leaders or group members, and preserved named volumes. The earlier full tests/SQL audit/manual journey were not duplicated for this local lock-order correction.

Additional correction file pins: `source-workspaces.ts` SHA-256 `edab23839f418d60dd3559f6f5d24e924e2c276cee25cfe75719861cdfa8c7df`; targeted launcher `e9146b3a00df6d1aa5c5c90a6632cedd17d94720b9d532bd0bac11fe303f5230`; targeted check `daa1c372582b98284d52dacdc75c21d51699d7f59fcaa8fd4040b1a41a0a3f6d`. Other implementation/source pins above remain unchanged. The targeted result covers this reported lock pair and both scoped outcomes; other lock paths and the previously listed product/source gates remain unqualified. Correction is returned for targeted Astra re-review before lead integration, not declared accepted by this worker.

## D05 — constrained proposal attribution and identity refusal, 5 October 2026

Accepted base `f196cd28a7f54471f2d2bdd5a194061dbcf5075c`; branch `task/d05-constrained-mapping-20261005`. The existing proposal → manual author → explicit operator approval → deterministic execution path is already connected and reused. Changes are limited to [adaptive contract](../../../packages/contracts/src/usp/adaptive-mapping.ts), [proposal service](../../../packages/server/src/modules/usp/ingestion/adaptive-mapping-service.ts), [validator](../../../packages/server/src/modules/usp/ingestion/adaptive-mapping.ts), [focused controls](../../../tests/adaptive-mapping.test.ts) and this amendment. Old source/runtime receipts and D04 remain unchanged.

The canonical gateway's optional `replayed` flag now reaches the adaptive response and its nested chunk proposal. `true` denotes replay, with no new provider-call receipt; absence is historical/no returned attribution, not proof of live inference. Existing `mechanics_only`, `reviewRequired:true` and chunk `proposalTrainingEligible:false` remain. The validator returns `needs_input/MODEL_FIELD_SEMANTICS` for clear measurement/date source-key candidates that become mechanically unique on a one-feature source. Identifier-named fields are not refused solely because they also contain a measurement word. These conservative naming cues do not qualify meaning; issuer evidence and operator review remain necessary. The manual registry/compiler is unchanged and remains available for reviewed semantics.

Consumer flow under `/api/v1/ingestion`: read `cases/{caseId}/sources/{sourceId}/profile`; POST `.../mapping-proposals` with a request key and returned source/schema/workspace pins; for `proposed`, inspect the allowed operations and author `.../recipes` with that unchanged plan, a new command key, expected recipe revision and operator-selected destination. Then POST `cases/{caseId}/recipes/{recipeId}/approve` with the returned revision, followed by `/execute` with the approved revision. Use a new scoped key for each decision. Model proposals never approve or execute themselves. On `disabled/unavailable/needs_input`, author a manual plan from the same current inventory through those existing routes. No model/provider is required for approval or deterministic execution; current recipe/source/workspace/destination pins still govern both paths.

Checks reuse the unchanged 1,763-byte NYC original and its exact provenance hashes above, literal `doitt_id=353927` and retained issuer dictionary. Name is explicitly null; Feature.id is absent. Roof height is present source text but is unmapped, with no conversion/unit qualification. The file-backed baseline failed both new assertions (exit1): `height_roof` became a proposed identity and the gateway replay flag disappeared. The corrected `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/adaptive-mapping.test.ts` passes 4/4, exit0; `pnpm typecheck:backend` passes server/API, exit0. The first inline probe returned no output and is uncounted. Actual canonical gateway/ReplayAdapter uses a disclosed test-only loader of manual operation tokens and controlled authority/configuration, never an enrolled provider response or independently qualified label. Author-contract compatibility, canonical compiler/normalizer, literal ID, unknown unmapped name/role, exact raw-byte references, unavailable/manual fallback and existing stale/access controls are checked. No current approval persistence, live DB/HTTP/native runtime or source-semantic accuracy is claimed; the accepted manual runtime evidence above is reused, and D01 owns the later live phase.

Integrator: no new route/module/export/SQL wiring. Republish the optional response flag in OpenAPI/client and current code pins; changing these existing converter-authority leaves intentionally stales old mapping jobs, requiring fresh normal admission rather than a hash alias. Independent bounded adoption/attribution review accepted exact `1d858467` with no fix required; code integrates as `3fad1f618c58b9f35a9c51be54fb958c1fb5af0b`. Geography stays foreign `test_only`, with no Tower-3/Indian placement, height/rights/ULPIN or learning qualification. Requested Sol6.1/xhigh/default-standard 1×, actual per-turn settings unexposed; supplied permissions `never`/`danger-full-access`. No services, DB/provider/GPU/model processes or acquisitions were launched; staging stayed read-only.

**D05 integration/publication:** all five owner blobs matched before this amendment. OpenAPI/client publish optional `replayed?: boolean` both on the adaptive response and nested chunk proposal; explicit false is retained, absent stays absent, and no value is independent proof of fresh inference. Current source pins cover only the three changed contract/validator/service authorities; their inclusion in `chunkMappingConverterSha` intentionally invalidates old mapping-job bindings. Fresh normal admission is required; historical results/hashes are preserved with no aliases. Owner 4/4 controls/backend types and independent review are reused; client types and normal API/pin/handoff/whitespace checks pass, 277 operations/310 schemas. This code-publication step acquired no API/DB/model/provider/native resources; the later bounded D01 functional run is recorded below. Automatic adoption, source-semantic accuracy and learning remain unqualified.

## D05 observed disabled/manual runtime, 5 October 2026

The accepted [scoped metadata](nest-migration/runtime-source/d05-manual-mapping-20261005.json) pins served code **`0b94e2463aacaa058afeaba0c23a27da3cf163f8`** and the retained 19,950-byte private proof (SHA-256 `71af930af7db4d6020c4de95c2a415907ab4485aae587e9e24f8b05f3285c5cb`). On the unchanged 1,763-byte official NYC feature, intake/replay returned201; profile and the default `disabled/MODEL_DISABLED` proposal returned200 with null plan/call and no replay attribution. Manual author/replay201 → server-configured local-operator approval/replay200 → deterministic execution/replay200 produced one package, three immutable decision revisions and one candidate. Recipe/package/area/private-original read-back200 preserves literal353927, original geometry, source-null name, unknown height/role and unmapped roof text. Wrong source hash/stale revision/unapproved/different-key-repeat409, foreign-Origin conversion read403 and unauthenticated processor inspect401 were observed. This is foreign `test_only`, with no provider inference, human-login, source-semantic, Indian/property or learning qualification. Twelve public operations receive only these input/state-specific scopes; old receipts and source authorities remain unchanged.

**Ordered preflight did not pass.** The orchestration cell continued after initial readiness exit1, caused by classifying the exact pinned-image public `GPG_KEY` fingerprint as a credential. A corrected read-only audit exited0; it did not rerun the native journey or repair that execution order. The later accepted private fail-closed wrapper is linked in the same metadata: an inert readiness exit23 prevented the domain sentinel, while exit0 allowed only the inert sentinel. Those controls add no native/HTTP/DB/service run and no retroactive pass. Every required future stage must return actual exit0 without signal/spawn error, using fresh assigned paths/head; the completed D05 proof is sealed and existing identity-checked owned cleanup still applies after failures.

At this run's cleanup snapshot, its API/processor/task storage were stopped, ports3192/28000 absent, 24 original container IDs and14 exact volumes preserved, and eight profile pins unchanged; Docker remained available. Preservation covers small global counts, the exact NYC family, four D04 operation rows, two full queued RERA job rows and D04 claims/source/snapshot hashes, rather than a full historical-table audit. No jobs, attempts or model calls were added. D04 remains qualified at its earlier served `a9d1f960`; fresh normal chunk admission is required for changed D05 converter authorities, and no old-chunk stale denial was witnessed. Other formats, unit conversions, changed-source reconciliation, streaming/scale, frontend and release gates remain open. Publication reuses the owner checks and retained run without another native campaign.
