# Native NestJS API for frontend integration

The backend runs independently of Next.js in `apps/api`. The [OpenAPI 3.0.3 document](openapi.json) is generated from its registered controllers and canonical validators: 139 operations and 167 named schemas, comprising 132 baseline operations (including three explicit 410 retirements) and seven added manual-ingestion operations. Known request/result/error models replace the former `UnresolvedJson` placeholders. Format-specific source properties, arbitrary fact values and recursive source geometry remain explicitly dynamic.

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

## Private extraction gateway

New officer extraction uses the shared Sarvam gateway with durable reservation/settlement, a project cap, protected ingestion allocation and a daily principal call cap. It stays disabled without explicit server configuration. The status endpoint inspects configuration only: `available` does not prove live provider health, funded capacity, residency or permission; quota remains unknown and `freeVerified` remains false. Manual preparation stays available when model inference is unavailable. Configuration and secrets belong to the backend, never to frontend request bodies.

The existing extraction routes and success statuses are unchanged. The provider enum retains historical `nous` records and adds `sarvam`; new runs may include `gatewayPolicyHash` and `principalHash`. Call receipts may include `callId`, `actualMicroInr` (a decimal integer string), `priceVersion` and `semanticError`. Reusing a historical provider request key returns 409. Current output is checked against evidence, principal and policy before POST/GET responses, cache reuse or application; stale or unauthorized output is withheld while stored history and billing remain intact. Render the returned state/message and available fields rather than filling withheld values. A failed or timed-out call is not necessarily free: uncertain usage remains reserved.

See the [gateway handoff and focused verification](../evidence/usp/deploy-01-handoff.md) and [executed gateway SQL](../../database/sql/90-model-gateway/model-gateway.sql). These controls do not establish live provider service, actual tariffs/funding, replay-corpus eligibility or real-source extraction accuracy. No new billing, credential or reset API is exposed.

## Datasets and qualification

Start with [real sources](real-sources.md) and [datasets.json](datasets.json). Entries include issuer/original links, manifests, hashes, reference systems, permission, limitations and repository-byte availability. Originals outside Git remain outside Git. A manifest is not an installed API record; use returned case/source/package IDs from the actual environment. No fictional example records or fixed installed IDs are supplied.

The [phase 2B receipt](../evidence/usp/nest-migration/runtime-source/README.md) establishes one USGS PDF upload → actual failed inspection → retry → persisted inspection, same-key replay, and a separate official NYC GIS import/read. Both original hashes, private download headers and remote-origin denial passed. [runtime-qualification.json](runtime-qualification.json) maps nine observed operations to exact receipt fields, source manifests and the served commit. The newer manual-mapping journey is separately linked above; it is not yet represented by this machine-readable qualification map, so its generated `x-runtime-verified` remains false. All those runtimes are stopped; their IDs are not records installed in another environment. The earlier [phase 2A receipt](../evidence/usp/nest-migration/runtime-foundation/README.md) also records fresh SQL execution and repeatability. See the [execution ledger](../orchestration/NESTJS_MIGRATION.md) for remaining backend dependencies. `x-code-status`, `x-disposition` and `x-runtime-verified` deliberately separate implemented/retired code from indexed observed workflows. Historical D0/D1, source accuracy, private provider execution, populated migrations, performance, frontend integration and deployment retain their own gates. All public-portal work remains full product.

## Regenerate after backend changes

```sh
python3 scripts/api/build-dataset-catalog.py
REPO_DATA=false pnpm --filter @ulpin/api exec tsx scripts/openapi.ts
python3 scripts/api/check.py
```

Use `--check` on either generator to detect drift without writing. Generation creates an in-memory Nest application, opens no listener and invokes no domain method. [source-pins.json](source-pins.json) pins current producers/contracts; the checker verifies all baseline method/path dispositions, parameter schemas and references. Review the resulting contract changes before handing a regenerated client to the frontend team.
