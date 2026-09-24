# FND → DATA and UI handoff (23 September 2026)

Historical FND base: `777c978c` on former `codex/fnd-f0-f1`; merged into staging. Current continuation is `codex/usp-staging-continuation-20260923` from staging `2838e798af838d7646ff92b1120c62c8458103da`, PR #13. F0a's common/data-pack/codec schemas remain the source of truth. New consumers import `@ulpin/contracts/usp` (opt-in package subpath). No root contract index was regenerated.

The F0 `UspPorts` interface names upload, model, scanner and delivery dependencies so their eventual owners share one signature. Only the registry snapshot/evidence, reviewed command, packet and SQL attempt functions documented below have live producers here. The other port declarations do not activate a provider or establish authorization.

## UI-owned live Studio seam

The server route is `/api/v1/usp/[...path]`, loopback and same-origin only. It derives the local operator from the request; callers must not send actor, role or principal fields. JSON responses have `{data,meta:{schemaVersion:'usp/1',requestId,scope}}`; typed errors have `{error:{code,message,retryable,requestId}}`.

1. `POST /snapshots` with `{scopeId,world:{namespace:'world',id:'registry-site/<scopeId>'},stage:'recorded',selection:{kind:'site'}}` returns an exact immutable manifest/scope.
2. `POST /scope/read` with `{scope,cursor:null,limit:1..100}` returns frozen membership and a signed next cursor.
3. `POST /targets/vertical` with `{scope,building,floor,space}` (exact target pins) returns available building/floor/space only when their recorded links form that chain. An invalid chain returns `unavailable` with `invalid_vertical_membership`.
4. `POST /targets/resolve` with `{scope,pin}` returns source pointers and application/parcel identifier assertions. `POST /evidence/original` with `{scope,pointer,action:'original'}` returns verified original bytes as an attachment. `POST /evidence/part` with `{scope,pointer,action:'extract'}` returns one verified, linked native text line or CSV logical row, or an explicit unavailable result. It never returns a whole mixed PDF page as a safe preview.
5. `POST /packets` with `{scope,target,evidence:[pointer],format:'text'|'csv',guard:{mode:'create',requestKey}}` saves a private scoped derivative and returns its hash/status. `GET /packets/<packetId>` reopens the verified artifact; `GET /packets/<packetId>/receipt` reopens its typed receipt after checking scope, target, evidence links and artifact hash. `incomplete` explicitly means the exact linked part could not be extracted; the original remains available separately.

UI owns its parent route, selection generation, viewport, cache and slots. Studio now connects these services through its existing shared viewport and quick-register boundary. DATA's full D0 aliases are mapped to server-issued pins by actual import receipts. A typed response shape is not evidence that a given property is rendered.

## DATA-owned fixture seam

`fixtures/usp/D0/contract-smoke` still checks only declared bytes. Full D0 `golden-v1` is DATA-owned and now imported by `scripts/usp/data/import-d0.ts`: 3–5 synthetic buildings, no more than 30 spaces, two revisions, mixed-source sentinels and independent expected values in `00-README.md`. Keep `ONLY_A101`, `NEVER_A102` and `SHARED_STAIR_CONTEXT` in separately addressable parts/regions. The existing registry review may accept exact imported text/CSV parts in `record.evidence` without creating a rights claim; geometry bindings remain geometric. Capture freezes the imported package parts into each source snapshot without altering the source row. A part is included in PACK0 only if exactly one stored part locator matches the selected pointer; whole-page or ambiguous text yields `incomplete`. Do not copy database UUIDs into fixture aliases. D1 roof geometry is a separate real-source/render qualification.

## Verification boundary

Current bounded milestone: `304725d` passed the local D0/PACK0 and single-real-D1
journeys (19 runner commands, three browser tests, all 59 tables unchanged across
each import replay). Independent review accepted source-linked geometry, exact
unit picking, evidence/packet reload and the captured desktop/mobile interactions.
The [continuation evidence](../continuation-2026-09-23/README.md) separates this
result from global placement, GPU/scale, PDF, provider and deployment gates.

`scripts/usp/isolated-live.mjs` restores the committed snapshot into a unique hosted disposable DB/S3 scope, checks every original hash, runs additive migrations and then executes `scripts/usp/verify-live.ts` through real HTTP/SQL/S3 against the retained synthetic Nandan baseline. The latter checks snapshot membership, exact original checksum, cross-building rejection, packet persistence/replay, reviewed commit revisions/receipt/outbox and SQL-fenced job attempts. Both scripts refuse non-isolated environments through `assertIsolation`. The continuation runner also checks migrated Uttam bundle installation/replay without changing restored originals, D0 import/replay and browser journeys, and one retained D1 roof through the shared local display adapter. Consult [saved receipts](d0/README.md) for executed results; runner code alone is not a pass. Redis worker dispatch for `usp:` jobs, bounded multipart upload promotion, current source-grant/release checks, full visual acceptance, wider D1 qualification and public deployment remain separate gates.
