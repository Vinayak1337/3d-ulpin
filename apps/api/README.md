# Nest API foundation

This is the independent native backend. Its registered intake, registry/officer,
evidence, spatial and AI modules cover all 132 baseline operations, including
explicit retired-operation responses. Shared domain logic lives in
`packages/server`; readable executed SQL lives in `database`.

See [the frontend API guide](../../docs/api/README.md) for models, source datasets,
startup, scope and actual qualification. `/api/docs` serves loopback Swagger;
`/api/docs/datasets.json` serves linked source metadata. Documentation does not
execute writes or establish that source records are installed.

Run `pnpm --filter @ulpin/api start` from the repository after a frozen install.
It binds `127.0.0.1:3188` by default; `API_PORT` changes only the port. Check
that the port is free before starting a preview. `pnpm --filter @ulpin/api build`
emits `dist/main.js`; `start:built` runs that artifact. Stop the owned process
with SIGINT or SIGTERM to close the Nest app, owned `pg` pool and S3 client.
`/api/v1/health` checks the configured private database, object store and
processor; it is not a deployment or remote authentication claim.

The socket Host must be a canonical loopback host on the API port. Browser
`Origin` must match Host by default. A separate local UI origin (for example a
Vite proxy) can be allowed with a comma-separated `API_ALLOWED_ORIGINS` list of
explicit `http://localhost:PORT`, `http://127.0.0.1:PORT` or
`http://[::1]:PORT` values. Non-loopback and malformed entries fail startup.
Forwarded host/proto headers and wildcard CORS are not used. This guard is a
locality boundary, not multiuser authentication.

## Controller authoring contract

1. Each batch owns an explicit Nest `@Module` and controllers for its ledger
   operations. Give the lead the module class to add to the single
   `src/domain-modules.ts` registration seam after review. No global legacy
   route dispatcher is registered.
2. Import services from the mapped `@ulpin/server/modules/...` paths. Keep
   decisions and SQL in the package. Use `@ulpin/contracts` wire schemas and
   validate runtime input with Zod at the boundary.
3. The default Nest body parser is disabled. Use `readJsonBody(req, limit)`,
   `readMultipartBody(req, limit)`, `readBoundedBytes(req, limit)` or bounded
   `toWebRequest(req, limit)` from `src/common/body.ts`. They count actual
   received bytes. The defaults are 2 MiB JSON, 17 MiB multipart envelope and
   16 MiB raw; preserve the original per-operation limits when different.
   Validate each file's allowed size separately after multipart parsing.
4. Set every operation's legacy status explicitly. Nest defaults POST to 201;
   use `@HttpCode(200)` for an existing 200, or `@Res()` with
   `sendWebResponse(res, webResponse)` for binary or existing standard-Response
   handlers. `jsonResponse(value, status)` sets a private no-store baseline.
   `sendWebResponse` copies explicit cache, hash, download and content headers
   and streams bytes with backpressure.
5. Add `@ApiOperation({ operationId: ledgerId })` and concrete
   `@ApiResponse` request/success/error schemas per operation using
   `@nestjs/swagger`. State unknown dynamic portions honestly. The lead owns
   final OpenAPI generation, source pins and readable docs.
6. The global filter keeps `AppError`, Zod and duplicate-key envelopes with
   `requestId`. The request middleware adds `X-Request-Id`, no-store and
   nosniff. Preserve explicit privacy and idempotency semantics in each
   controller. The runtime sets the canonical server loopback port, so pure
   legacy Request guards also accept the API listener without changing Next's
   default port.
