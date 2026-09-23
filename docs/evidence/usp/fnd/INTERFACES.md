# FND → DATA and UI handoff (23 September 2026)

Base SHA: `777c978c`; isolated branch: `codex/fnd-f0-f1`. F0a's common/data-pack/codec schemas remain the source of truth. New consumers import `@ulpin/contracts/usp` (opt-in package subpath). No root contract index was regenerated.

## UI-owned live Studio seam

The server route is `/api/v1/usp/[...path]`, loopback and same-origin only. It derives the local operator from the request; callers must not send actor, role or principal fields. JSON responses have `{data,meta:{schemaVersion:'usp/1',requestId,scope}}`; typed errors have `{error:{code,message,retryable,requestId}}`.

1. `POST /snapshots` with `{scopeId,world:{namespace:'world',id:'registry-site/<scopeId>'},stage:'recorded',selection:{kind:'site'}}` returns an exact immutable manifest/scope.
2. `POST /scope/read` with `{scope,cursor:null,limit:1..100}` returns frozen membership and a signed next cursor.
3. `POST /targets/vertical` with `{scope,building,floor,space}` (exact target pins) returns available building/floor/space only when their recorded links form that chain. An invalid chain returns `unavailable` with `invalid_vertical_membership`.
4. `POST /targets/resolve` with `{scope,pin}` returns source pointers and application/parcel identifier assertions. `POST /evidence/original` with `{scope,pointer,action:'original'}` returns verified original bytes as an attachment. No inline safe preview is qualified yet.
5. `POST /packets` with `{scope,target,evidence:[pointer],format:'text'|'csv',guard:{mode:'create',requestKey}}` saves a private scoped derivative and returns its hash/status. `GET /packets/<packetId>` reopens the verified artifact. `incomplete` explicitly means the exact linked part could not be extracted; the original remains available separately.

UI owns its parent route, selection generation, viewport, cache and slots. This patch does not mount a second map or alter Studio components. UI should connect only after DATA's full D0 aliases are mapped to server-issued pins by actual import receipts. A typed response shape is not evidence that a given property is rendered.

## DATA-owned fixture seam

`fixtures/usp/D0/contract-smoke` still checks only declared bytes. Full D0 remains DATA-owned: 3–5 synthetic buildings, no more than 30 spaces, two revisions, mixed-source sentinels and independent expected values in `00-README.md`. Keep `ONLY_A101`, `NEVER_A102` and `SHARED_STAIR_CONTEXT` in separately addressable parts/regions. A part is included in PACK0 only if exactly one stored part locator matches the selected pointer; whole-page or ambiguous text yields `incomplete`. Do not copy database UUIDs into fixture aliases. D1 roof geometry is a separate real-source/render qualification.

## Verification boundary

`scripts/usp/verify-live.ts` is wired into the existing hosted, disposable `scripts/engineering/isolated-baseline.mjs` after its preservation checks. It exercises real HTTP/SQL/S3 against the retained synthetic Nandan baseline, including snapshot membership, exact original checksum, cross-building rejection, packet persistence/replay, reviewed commit revisions/receipt/outbox and SQL-fenced job attempts. The script refuses non-isolated environments through `assertIsolation`. It is not a full D0 or UI V0 test. Redis worker dispatch for `usp:` jobs, bounded multipart upload promotion, current source-grant/release checks, full D0, real D1 roof rendering and browser V0 remain open gates.
