# Native NestJS API for frontend integration

The backend runs independently of Next.js in `apps/api`. The [OpenAPI 3.0.3 document](openapi.json) is generated from its registered controllers and canonical validators: 132 baseline operations, including three explicit 410 retirements. Known request/result/error models replace the former `UnresolvedJson` placeholders. Format-specific source properties, arbitrary fact values and recursive source geometry remain explicitly dynamic.

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

Explicitly retired: `POST /areas/{areaId}/scenario`, `POST /spatial-datasets`, and `GET /spatial/calibration/{kind}/{assetPath}`. New `demo_ulpin` assertions are also rejected within `/external-identifiers`. Historical recorded data stays readable. The `real-nyc` compatibility URLs still expose genuine retained official-derived inputs; their names do not make the sources synthetic. AI crop previews remain an intentional privacy denial. A present provider-backed operation is not authorization or qualification for live provider calls.

## Contracts, concurrency and bytes

Use the operation's exact media type, status and schema. Case uploads accept multipart `file` and supported `profile`; GIS imports accept either the documented multipart fields or a JSON acquisition reference. These are different shapes. Actual received-byte limits apply, including chunked requests: common JSON 2 MiB, officer/USP JSON 1 MiB, multipart 17 MiB with service file limits, ML/extraction JSON 100,000 bytes, AI apply 20,000 bytes. PDF document intake is capped at 10 MiB where the document profile specifies it; other source profiles retain their own caps.

Preserve `Idempotency-Key`, request keys, expected revisions, exact source/manifest pins and selected IDs across retries. Do not generate a new intent when retrying the same one. USP results have `{data,meta}`; ordinary domain results retain their own shapes. Errors carry operation-family-specific envelopes. Inspect the published error models rather than assuming all failures have the same fields.

Source downloads verify retained size/hash before returning bytes. Original-source hash headers, packet artifact hash headers, ETags, content disposition and cache policy are separate contracts. Binary replies use the source/artifact media type; do not parse them as a JSON error/result blindly. Private data is not eligible for shared public caches. Unknown/withheld/conflicting values remain distinct; source geometry is not ownership, an issued parcel ULPIN or verified global placement.

## Datasets and qualification

Start with [real sources](real-sources.md) and [datasets.json](datasets.json). Entries include issuer/original links, manifests, hashes, reference systems, permission, limitations and repository-byte availability. Originals outside Git remain outside Git. A manifest is not an installed API record; use returned case/source/package IDs from the actual environment. No fictional example records or fixed installed IDs are supplied.

The [phase 2B receipt](../evidence/usp/nest-migration/runtime-source/README.md) establishes one USGS PDF upload → actual failed inspection → retry → persisted inspection, same-key replay, and a separate official NYC GIS import/read. Both original hashes, private download headers and remote-origin denial passed. [runtime-qualification.json](runtime-qualification.json) maps nine observed operations to exact receipt fields, source manifests and the served commit. The runtime is stopped; its IDs are not records installed in another environment. The earlier [phase 2A receipt](../evidence/usp/nest-migration/runtime-foundation/README.md) also records fresh SQL execution and repeatability. See the [execution ledger](../orchestration/NESTJS_MIGRATION.md) for remaining backend dependencies. `x-code-status`, `x-disposition` and `x-runtime-verified` deliberately separate implemented/retired code from observed workflows. Historical D0/D1, source accuracy, private provider execution, populated migrations, performance, frontend integration and deployment retain their own gates. All public-portal work remains full product.

## Regenerate after backend changes

```sh
python3 scripts/api/build-dataset-catalog.py
REPO_DATA=false pnpm --filter @ulpin/api exec tsx scripts/openapi.ts
python3 scripts/api/check.py
```

Use `--check` on either generator to detect drift without writing. Generation creates an in-memory Nest application, opens no listener and invokes no domain method. [source-pins.json](source-pins.json) pins current producers/contracts; the checker verifies all baseline method/path dispositions, parameter schemas and references. Review the resulting contract changes before handing a regenerated client to the frontend team.
