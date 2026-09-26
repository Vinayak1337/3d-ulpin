# Native NestJS API for frontend integration

The backend runs independently of Next.js in `apps/api`. The [OpenAPI 3.0.3 document](openapi.json) is generated from its registered controllers and canonical validators: 147 operations and 173 named schemas, comprising 132 baseline operations (including three explicit 410 retirements) and fifteen added ingestion operations. Known request/result/error models replace the former `UnresolvedJson` placeholders. Format-specific source properties, arbitrary fact values and recursive source geometry remain explicitly dynamic.

After starting the local API, open [Swagger UI](http://127.0.0.1:3188/api/docs). Its [OpenAPI JSON](http://127.0.0.1:3188/api/docs/openapi.json) and [dataset catalogue](http://127.0.0.1:3188/api/docs/datasets.json) are served by the same loopback backend. Swagger is light-only and opens schemas first. Write execution and the external validator are disabled. These links describe the configured default address; they do not mean a server is currently running.

## Start and connect

Use a frozen install, then `pnpm build`. Root `pnpm dev` starts Nest and the existing dispatcher; `pnpm start` starts the built API and dispatcher. Dependencies are PostgreSQL/PostGIS, private S3-compatible storage, Redis and the existing private Python processor/Celery worker. Starting the API does not run SQL migrations or create these services. Configure the intended environment explicitly; never restore a snapshot or seed operational records to make the UI appear populated.

For a fresh isolated local run, follow the [guarded runtime guide](../../scripts/usp/REAL_SOURCE_RUNTIME.md). It allocates exact nonce-scoped services, runs the existing migration authority and preserves volumes on shutdown. [The SQL guide](../../database/README.md) explains tables, relationships, migration order and transaction boundaries; [the SQL manifest](../../database/manifest.json) points to the executed `.sql` files. We use `pg` and PostGIS SQL, with Zod at runtime boundaries. TypeScript row types alone do not validate SQL results.

The default API base is `http://127.0.0.1:3188/api/v1`. `API_PORT` changes the port; binding remains loopback. `ULPIN_LOCAL_OPERATOR_SUBJECT` identifies the explicitly configured local process/operator for new attributable events and USP contexts; it is server configuration, never a request field or proof of human authentication. Missing or invalid configuration prevents API/dispatcher startup and fails closed at attributable operations. Historical actors remain unchanged.

For Vite, proxy `/api` to the local API and configure `API_ALLOWED_ORIGINS` with the exact local UI origin if the proxy forwards Origin. The backend validates Host and Origin; it does not enable permissive CORS or trust forwarded host/protocol. Direct cross-port browser clients need a proper local proxy. Frontend routes, components and renderer remain user-owned. The temporary Next UI is available through explicit `web:dev`, `web:build` and `web:start` commands.

## Available families

| Family | Operations | Backend responsibility |
| --- | ---: | --- |
| Foundation | 3 | Root, configured workspace capability flags and five-service health |
| Intake | 43 | Cases, retained originals, inspect/build jobs, GIS imports, acquisitions, source workspaces, package review and commit |
| Registry/officer | 40 | Registry sites/drafts/records, resolution, reviews, officer preparations/associations/groups/investigations, work queues and private exports |
| Evidence | 18 | Exact-scope snapshots, source access, proposals, immutable application identity, CityJSON exchange and private packets |
| Spatial/AI | 28 | Private area/scene reads, saved dataset history/originals/search, existing ML lifecycle and officer extraction services |
| Manual ingestion | 7 added | Retained GeoJSON profile, constrained conversion registry, source-pinned recipes, explicit approval and atomic execution through existing GIS intake |
| Large original receipt | 7 added | Durable byte parts, resume/status, whole-original verification, one source publication and scoped abort/retry cleanup; conversion remains unsupported |
| Private ingestion events | 1 added | Committed case-ingestion notifications with scoped SSE cursors, bounded replay and explicit context resync |

Explicitly retired: `POST /areas/{areaId}/scenario`, `POST /spatial-datasets`, and `GET /spatial/calibration/{kind}/{assetPath}`. New `demo_ulpin` assertions are also rejected within `/external-identifiers`. Historical recorded data stays readable. The `real-nyc` compatibility URLs still expose genuine retained official-derived inputs; their names do not make the sources synthetic. AI crop previews remain an intentional privacy denial. A present provider-backed operation is not authorization or qualification for live provider calls.

## Contracts, concurrency and bytes

Use the operation's exact media type, status and schema. Case uploads accept multipart `file` and supported `profile`; GIS imports accept either the documented multipart fields or a JSON acquisition reference. These are different shapes. Actual received-byte limits apply, including chunked requests: common JSON 2 MiB, officer/USP JSON 1 MiB, multipart 17 MiB with service file limits, ML/extraction JSON 100,000 bytes, AI apply 20,000 bytes. PDF document intake is capped at 10 MiB where the document profile specifies it; other source profiles retain their own caps.

Preserve `Idempotency-Key`, request keys, expected revisions, exact source/manifest pins and selected IDs across retries. Do not generate a new intent when retrying the same one. USP results have `{data,meta}`; ordinary domain results retain their own shapes. Errors carry operation-family-specific envelopes. Inspect the published error models rather than assuming all failures have the same fields.

Source downloads verify retained size/hash before returning bytes. Original-source hash headers, packet artifact hash headers, ETags, content disposition and cache policy are separate contracts. Binary replies use the source/artifact media type; do not parse them as a JSON error/result blindly. Private data is not eligible for shared public caches. Unknown/withheld/conflicting values remain distinct; source geometry is not ownership, an issued parcel ULPIN or verified global placement.

## Manual source mapping

The new private `/api/v1/ingestion` family supports one bounded GeoJSON building profile without a model or provider. Begin with an existing unassigned source case; use IDs and revision/fingerprint values returned by the running API. The unchanged [NYC official source](../../fixtures/real-nyc/provenance.json) was exercised in the [manual journey and lock-order receipt](../evidence/usp/ingest-02-manual-handoff.md). The much larger projected NWIC district layer has a different semantic/reference profile and cannot be imported through this building mapping route.

| Relative to `/api/v1/ingestion` | Request / result |
| --- | --- |
| `GET /conversions` | Versioned conversion IDs, supported targets, units and limitations. |
| `POST /cases/{caseId}/sources` | Multipart `file`, `format=geojson`, `requestKey`, `expectedWorkspaceRevision`; source revisions also require `familyId` and `expectedSourceRevision` together. Returns 201 with `SourceProfile`: exact source pins, field paths, separate missing/null counts and inspected CRS evidence. |
| `GET /cases/{caseId}/sources/{sourceId}/profile` | Current `SourceProfile`; consume the returned paths and pins rather than inventing property names or reference metadata. |
| `POST /cases/{caseId}/sources/{sourceId}/recipes` | `AuthorMapping` contains request key, expected recipe revision, strict `MappingPlan` and destination; returns 201 with a proposed `MappingReceipt`. |
| `GET /cases/{caseId}/recipes/{recipeId}` | Array of retained `MappingReceipt` revisions; preserve the history rather than assuming this is a single current object. |
| `POST /cases/{caseId}/recipes/{recipeId}/approve` | `MappingDecision` with request key and expected recipe revision; returns 200. Approval attribution comes from server configuration. |
| `POST /cases/{caseId}/recipes/{recipeId}/execute` | Same decision shape; returns 200 only for a current approved plan and destination. `execution.packageId` links to the existing import-package APIs. |

`manual-geojson/1` accepts exact inventory paths with `literal_identifier@1`, `literal_text@1` and `geojson_polygon@1`. It requires a source-supported building key and polygon, with optional name. Arbitrary expressions, literals, tools, caller-selected CRS/factors and model mode are rejected. Height, geometry role, rights and issuance remain unknown when unsupported by the source. Admission retains the 16 MiB/2,000-complete-feature bound; an over-limit request fails rather than truncating or silently splitting an original.

Use the latest returned revision for approval/execution and retain a request key across a retry of the same intent. Reauthoring invalidates approval; changed source/workspace/destination context fails closed. Same-key concurrent execution returns one committed package, and source-workspace assignment now follows the same case-before-area lock order. Both concurrency orders were exercised on unchanged official NYC bytes at the correction pin. The full initial journey and targeted correction have separate served commits in the receipt; they do not establish other formats, model proposals, human authentication, Indian operational accuracy or scale.

## Durable large-original receipt

The private `/api/v1/ingestion` family also accepts an opaque ZIP/octet-stream original larger than 16 MiB and no larger than 128 MiB. This profile retains evidence; it does not unpack archives, verify companion completeness, parse districts/buildings or place geometry. The [NWIC source manifest](../../fixtures/usp/D3/nwic-boundaries-v1/manifest.json) and [real-original/recovery handoff](../evidence/usp/ingest-06-large-original-handoff.md) pin the exercised 71,238,839-byte archive. Its 168,356,689-byte projected GeoJSON member remains outside this receipt profile and unconverted. Submitted provenance is labelled `caller_declared`; byte verification does not independently verify an issuer or grant permission.

| Relative to `/api/v1/ingestion` | Request / result |
| --- | --- |
| `GET /upload-limits` | Current byte/part/concurrency/lifetime limits, `opaque_original_only` profile and `unsupported` conversion. |
| `POST /cases/{caseId}/uploads` | Request key, expected case revision, filename, allowed media type, exact original size/SHA-256 and source provenance. Returns 201 with durable upload ID/revision, part layout, expiry and progress. |
| `GET /cases/{caseId}/uploads/{uploadId}` | Current receipt, case revision, part state/hashes, source reference when retained, cleanup state and any error; use this to resume after interruption. |
| `PUT /cases/{caseId}/uploads/{uploadId}/parts/{partNumber}` | Raw `application/octet-stream`, with `X-Request-Key`, `X-Upload-Revision`, `X-Case-Revision` and `X-Part-Sha256`. Parts are 8 MiB except the final remainder, at most 16 total. Returns 200 with updated status. |
| `POST /cases/{caseId}/uploads/{uploadId}/finalize` | Request key, expected upload/case revisions and original SHA-256. Returns 200 only after complete-part and whole-object verification, with one retained source. |
| `POST /cases/{caseId}/uploads/{uploadId}/abort` | Request key and expected upload/case revisions; fences only the incomplete upload and reclaims its payload. Retained canonical originals are protected. |
| `POST /cases/{caseId}/uploads/{uploadId}/cleanup` | Same guarded decision shape; retries pending reclamation without changing the original request binding. Zero-byte fences remain intentionally; cleanup does not erase the receipt history. |

Keep request keys stable for the same intent and use returned revisions. Incomplete or mismatched originals cannot become sources. Completed finalization replays the same source; it does not create a conversion job. Read/download that source through the existing case/source APIs. The original download checks hash/size in a bounded first read, rechecks current access, then streams a conditional second read with backpressure and final integrity checking. This costs two storage reads per full download; failures after response headers terminate the stream.

Current limits include two active uploads per case/operator, four globally, a 512 MiB tracked original reservation and a 1 GiB logical payload allowance including temporary copies. The 128-receipt cap is **lifetime capacity**, counting retained and aborted receipts, not 128 simultaneous uploads. At most 17 registered object keys per receipt remain: up to 16 parts and one original, including permanent zero-byte fences. These are logical accounting bounds, not measured physical disk or metadata usage. Read `/upload-limits` instead of hard-coding capacity in the frontend.

Runtime evidence covers the pinned private, unversioned MinIO profile. Enabled/suspended versioning or a failed versioning query is rejected; a versioning query alone does not establish conditional-write atomicity on an arbitrary S3-compatible service. Prior multipart producers must be stopped before upgrading. The delayed-writer check paused a producer before dispatch until its lease expired; it does not claim an already-dispatched remote PUT reproduction. The handoff separates that check from reviewed storage implementation semantics and the earlier full upload/restart journey.

## Private live ingestion events

`GET /api/v1/ingestion/cases/{caseId}/events` returns `text/event-stream` for the current authorized local case. It uses the existing transactional outbox. Event producers cover manual source retention, recipe changes and revision-bearing large-upload changes; this is not an all-job or scene/tile event feed. The [canonical event contracts](../../packages/contracts/src/usp/ingestion-events.ts) define `case-ingestion/1`; OpenAPI exposes JSON data schemas through `x-change-data-schema` and `x-control-data-schema` on the stream response.

| Frame | Client action |
| --- | --- |
| `ready` | Records the chosen starting cursor. With no cursor supplied, start at the current head; open the stream before fetching current records so later changes can trigger refresh. |
| `ingestion.change` | Read minimal case/source/recipe/upload IDs, revisions and status, then refresh the corresponding current API record. `requiresRefresh` is always true; no original, geometry, filename, provenance, operator or error text is sent. |
| `resync` | Close this EventSource, refresh current records, then reconnect using its supplied `headCursor`. The frame has no SSE ID and does not silently acknowledge skipped history. |
| Heartbeat comment | Keep the connection alive; it carries no cursor or progress. |

Keep SSE IDs as **strings**, including `MessageEvent.lastEventId`: they are case/access-bound decimal values up to 97 digits, not JavaScript numbers or raw database sequence numbers. `cursor=0` explicitly requests retained history; otherwise pass a previously received cursor or omit it to tail. A reconnecting browser's `Last-Event-ID` may advance beyond the fixed first query cursor. Both must name the same case/access context, and a backwards header conflicts. Invalid/duplicate cursor fields reject with 422, context/cursor conflicts with 409; ahead, missing or excessive history requires resync. Do not copy a cursor between cases or choose an internal stream name.

Connections last at most 60 seconds and support reconnect/replay. Bounds are four readers per process, two per configured operator, one per case; pages contain at most 32 events and a connection/replay range at most 256. Heartbeats occur every 10 seconds; writes, buffers and database reads are bounded. Current private access is rechecked during delivery. A failed private read after headers closes the stream without injecting an error body; no database transaction remains open while waiting on the client.

The [SSE handoff](../evidence/usp/ingest-03-private-events-handoff.md) records the unchanged official NYC manual-source journey: four ordered events, actual pre-commit visibility barrier, idempotent/stale no-event controls, fixed-query/offline replay and disconnect cleanup. Large-upload producers are wired but their actual part/finalization event delivery was not exercised in that run. Broader job coverage, multiuser/replica behavior, frontend consumption, tiles and GF-STREAM/GF-SCALE remain separately unqualified.

## Private extraction gateway

New officer extraction uses the shared Sarvam gateway with durable reservation/settlement, a project cap, protected ingestion allocation and a daily principal call cap. It stays disabled without explicit server configuration. The status endpoint inspects configuration only: `available` does not prove live provider health, funded capacity, residency or permission; quota remains unknown and `freeVerified` remains false. Manual preparation stays available when model inference is unavailable. Configuration and secrets belong to the backend, never to frontend request bodies.

The existing extraction routes and success statuses are unchanged. The provider enum retains historical `nous` records and adds `sarvam`; new runs may include `gatewayPolicyHash` and `principalHash`. Call receipts may include `callId`, `actualMicroInr` (a decimal integer string), `priceVersion` and `semanticError`. Reusing a historical provider request key returns 409. Current output is checked against evidence, principal and policy before POST/GET responses, cache reuse or application; stale or unauthorized output is withheld while stored history and billing remain intact. Render the returned state/message and available fields rather than filling withheld values. A failed or timed-out call is not necessarily free: uncertain usage remains reserved.

See the [gateway handoff and focused verification](../evidence/usp/deploy-01-handoff.md) and [executed gateway SQL](../../database/sql/90-model-gateway/model-gateway.sql). These controls do not establish live provider service, actual tariffs/funding, replay-corpus eligibility or real-source extraction accuracy. No new billing, credential or reset API is exposed.

## Datasets and qualification

Start with [real sources](real-sources.md) and [datasets.json](datasets.json). Entries include issuer/original links, manifests, hashes, reference systems, permission, limitations and repository-byte availability. Originals outside Git remain outside Git. A manifest is not an installed API record; use returned case/source/package IDs from the actual environment. No fictional example records or fixed installed IDs are supplied.

The [phase 2B receipt](../evidence/usp/nest-migration/runtime-source/README.md) establishes one USGS PDF upload → actual failed inspection → retry → persisted inspection, same-key replay, and a separate official NYC GIS import/read. Both original hashes, private download headers and remote-origin denial passed. [runtime-qualification.json](runtime-qualification.json) maps nine observed operations to exact receipt fields, source manifests and the served commit. The newer manual-mapping, large-original and SSE journeys are separately linked above; they are not yet represented by this machine-readable qualification map, so their generated `x-runtime-verified` remains false. All those runtimes are stopped; their IDs are not records installed in another environment. The earlier [phase 2A receipt](../evidence/usp/nest-migration/runtime-foundation/README.md) also records fresh SQL execution and repeatability. See the [execution ledger](../orchestration/NESTJS_MIGRATION.md) for remaining backend dependencies. `x-code-status`, `x-disposition` and `x-runtime-verified` deliberately separate implemented/retired code from indexed observed workflows. Historical D0/D1, source accuracy, private provider execution, populated migrations, performance, frontend integration and deployment retain their own gates. All public-portal work remains full product.

## Regenerate after backend changes

```sh
python3 scripts/api/build-dataset-catalog.py
REPO_DATA=false pnpm --filter @ulpin/api exec tsx scripts/openapi.ts
python3 scripts/api/check.py
```

Use `--check` on either generator to detect drift without writing. Generation creates an in-memory Nest application, opens no listener and invokes no domain method. [source-pins.json](source-pins.json) pins current producers/contracts; the checker verifies all baseline method/path dispositions, parameter schemas and references. Review the resulting contract changes before handing a regenerated client to the frontend team.
