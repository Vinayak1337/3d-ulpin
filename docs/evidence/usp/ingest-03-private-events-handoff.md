# INGEST-03B — private case ingestion events

Delivered 26 September 2026; awaiting independent lead review. This is bounded backend evidence, not release-gate acceptance.

## Pins and ownership

- Accepted staging base: `1ce939e347b8c448924954b43d3c648d1df06ac5`.
- Worker checkout: `/Users/vinayak/.codex/worktrees/0bc6/3D Ulpin`, branch `task/ingest-03-private-events`.
- Implementation: `3b84065433d3142cfc3e55deb71fe32cd3397136`.
- EventSource reconnect correction and final served code: `18e2923871e5279b7a8fb911daaa43a8355c9c5c`.
- Observed task model/effort: `gpt-6-sol` / `max`. Fast requested, configured preference priority; per-turn service tier was not reported. No provider/model call was made; no model artifact hash exists for this change.
- Owned changes: canonical ingestion event contracts, shared outbox extraction/re-export, ingestion producers/reader, native ingestion controller/transport/module/manifest, one additive index and its migration/manifest/checker wiring, focused protocol check and guarded runtime harness, this receipt.
- No frontend, protected mockup, root plan, API documentation generation, baseline operation ledger, lockfile, credential or root `.env` changes. No push, main integration, deployment or public activation.

## Result and protocol

`GET /api/v1/ingestion/cases/{caseId}/events` is the sole new route. Native metadata retains the 132 baseline operations plus all 15 declared ingestion additions (147 total). The existing registration and registry event contract remain intact.

`case-ingestion/1` is a separate strict envelope. Notifications contain case ID/revision, a source ID/revision/status, recipe ID/revision/source ID/status, or upload ID/revision/status, plus durable sequence and the stored outbox insertion timestamp. They contain no original bytes, geometry, filename, provenance/error text, operator subject, object key, registry body, snapshot or manifest. Every notification and control says `requiresRefresh: true`; consumers obtain current records from the existing APIs. Timestamps are not claims of commit time or progress.

Manual retention, recipe author/revision, approval and execution append at their actual write points. Exact request replays and same-byte source deduplication append nothing. Large-upload creation and each actual revision-bearing state save append an upload notification, including fenced part/finalization failures and cleanup transitions. These share the mutation transaction through the existing `usp_outbox_streams` / `usp_outbox` helper. Rollback removes both the mutation and its sequence/event. No second queue, event store, generated progress or opaque-source snapshot was introduced.

The internal stream is derived from the canonical case UUID and server-owned local subject/access-view/policy/entitlement binding. Caller-selected streams and extra query fields are rejected. Decimal SSE IDs encode the SHA-256 case/access binding multiplied by `10^19`, plus the durable PostgreSQL bigint sequence. They are strings (up to 97 decimal digits), not JavaScript numbers or unscoped outbox sequence numbers. UUID casing is normalized.

- Neither cursor supplied: tail the current committed head.
- Query `cursor=0`: replay the retained stream from its beginning.
- Positive first query cursor or `Last-Event-ID`: require the authorized case/access binding and a canonical decimal representation.
- Both supplied: validate both scopes, then use `Last-Event-ID` if its sequence is at or beyond the first query cursor. A backwards header conflicts. This supports a browser retaining its original EventSource URL during reconnect. Header `0` is invalid.
- Duplicate query/header values and malformed decimals reject with 422. Scope/backwards conflicts reject with 409. Ahead, excessive or missing/nonconsecutive/malformed event ranges require explicit resync, with a typed 409 before headers or a `resync` frame during delivery.
- `ready` repeats the chosen starting ID; it never skips an outstanding replay range. `resync` has no SSE ID and tells the consumer to refresh before using its head cursor. Heartbeats are comments with no ID or progress value.

The loopback Host/Origin and cross-site read boundaries apply before headers and again before delivery. The configured local access binding is checked each read/write. Missing or archived cases reject. Each consistent read fingerprints the current case revision, frame/context, timestamp, site/package/registry association and bounded retained-source pins; changes result in committed minimal notifications followed by explicit context resync/closure. Access loss or failed private reads after headers close the stream without JSON/error-text injection. This qualifies the existing configured single-operator process boundary, not human authentication, multiuser permissions or replica-wide revocation.

## Bounds and migration

| Resource | Fixed bound |
| --- | --- |
| Readers | 4 per process, 2 per configured operator, 1 per case |
| Replay | 32 events per indexed page; at most 256 per connection/range |
| Source pins | At most 256 revisions per case; oversized context rejects |
| Event/frame/response buffer | 1,024 / 2,048 / 4,096 bytes |
| Poll/heartbeat | 500 ms / 10 seconds |
| Connection/write deadline | 60 seconds / 2 seconds |
| DB reads | At most 121 per connection; 2-second statement, 500-ms lock, 4-second idle-transaction and 6-second overall page deadlines; existing pool-connect deadline 5 seconds |

Delivery awaits backpressure and does not create an unbounded producer queue. Each read uses a short repeatable-read, read-only transaction; no DB connection survives a page/poll. Disconnect cancels waits, releases the reader reservation and destroys an acquired reader connection if a query is pending. Timers/listeners are removed on completion. Pending pool acquisition remains subject to its existing five-second bound.

The existing `(stream_id, sequence)` primary key serves ordered replay. The only SQL addition is `import_packages_case_idx` for the case-association check, through hash-pinned `ingestion.events.index`. Registry mapping and source-pin checks use existing case-prefix indexes. No data was reset or reseeded.

## Checks and actual exits

| Command | Result |
| --- | --- |
| `pnpm build` on final code | Exit 0; server/API typecheck and both builds pass |
| `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/ingestion-events.test.ts tests/manual-ingestion.test.ts` | Exit 0; 5/5 pass, including native baseline/addition metadata |
| `pnpm exec tsx --test tests/ingestion-events.test.ts tests/manual-ingestion.test.ts tests/large-original.test.ts` | Initial exit 1: 7 passed; metadata import lacked Nest experimental-decorator configuration. Correct API-config rerun passed. The three unchanged large-original checks passed in this invocation. |
| `pnpm typecheck:backend` during implementation | Initial exit 2: Swagger/Zod schema annotation incompatibility; corrected before either served pin. Subsequent builds run both typechecks successfully. |
| `python3 scripts/db/verify_extraction.py` | Exit 0; 25 exact historical SQL files/136 statement hashes, four authored additions and 28 named migration queries |
| `node --check scripts/usp/ingestion-events-smoke.mjs`; `git diff --check` | Exit 0 |
| Guarded runtime `prepare --api-port 3189`, `start`, smoke harness and `stop` | All exit 0 on each recorded pin |

The first real-source journey passed on `3b84065`. Review of normal EventSource behavior then required the cursor advancement correction. A fresh clean run repeated the focused journey on `18e2923` to qualify that changed protocol. No 71 MB large-upload suite, broad suite or model/provider route was replayed.

## Final pinned real-source observation

- Project/nonce: `ulpin-usptest-40322d1b778b8ad3` / `40322d1b778b8ad3`; served `http://127.0.0.1:3189/` from `18e2923871e5279b7a8fb911daaa43a8355c9c5c`.
- API/dispatcher identities reported by the guarded helper: PID 90413 / 90296; helper verifies nonce, process group and start identity. No listener on 3188 was stopped.
- Unchanged official NYC OTI bytes: `fixtures/real-nyc/original.geojson`, 1,763 bytes, SHA-256 `6a0035cd7abe0f96da0fb7c9fc61067fd63c1894675e13e234173643e143ffda`.
- Issuer/source: City of New York Office of Technology and Innovation, original URL `https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?doitt_id=353927`; terms and acquisition lineage remain in `fixtures/real-nyc/provenance.json`. New York City test geography only.
- Actual case/source/recipe IDs: `067a1ab6-54e2-4cdb-8368-ea5508465f83`, `df92b2a2-baeb-40c9-81d2-98d1fd9f9c3c`, `c8a6f02e-5a00-46d8-be23-93a8c5edab36`. Separate empty case `3c13d95c-de45-4383-bdf3-0d16c185c668` is a cursor-boundary control, not invented operational evidence.
- Observed sequences 1–4: retained source (`needs_input`), proposed recipe, approved recipe, executed recipe. The source change caused explicit context resync.
- An actual approval transaction was held at the existing outbox sequence lock. Other sessions and a newly opened reader still saw the proposed recipe and sequence 2. Releasing the barrier committed approval and produced sequence 3 once.
- Exact retain/author/approval replay, same-byte deduplication and stale author/approval controls produced no extra success events. Cross-case, malformed/duplicate, extra stream selector, backwards-conflicting and ahead cursors rejected before SSE headers.
- Reconnection with fixed `cursor=0` plus advanced `Last-Event-ID` resumed without repeating sequence 1. Execution while disconnected replayed sequence 4. Full explicit beginning replay returned four ordered unique changes. A heartbeat carried no ID. Payload field/size assertions passed.
- Same-case reader reopening after disconnect passed; read cleanup left zero idle reader transactions. Final counts: events 4, streams 1, canonical sources 1, recipe revisions 3, model calls 0.

Private final receipt: `.runtime/run01/40322d1b778b8ad3/ingestion-events-smoke.json`, SHA-256 `62405638cf3bd1f7f0ec2fe3bfd1696a4d51379e302bb538e4ea88631fb62123`. Ownership receipt SHA-256: `ea4a3025e900ca932703c2a98663f9786d23ffae1b4a3684259b32bbab3dbcef`. Credential-bearing run configuration stays private and is not reproduced here.

Code-byte hashes: event contract `b5740d12b9220f2cb397b0e34b7115dd88e5bb63b0f4bd93d02f56dfbdd15234`; harness `d0c40f16e37452856cde13c8fe188dea72660e2a710dd4dec5df22e59cf6f7bd`; additive SQL `ce1a8ea8cc8682689e604a41ac1b4dc7478ac8e4868e94dfeb316d2ab7380623`.

The earlier private receipt at `.runtime/run01/06a3e992569832e1/ingestion-events-smoke.json` also passed four checks on `3b84065`, SHA-256 `e103376b385b0ae9ebe0c114ac233f95cad106da3a1f820580cbb784b00d8e2c`. It does not qualify the subsequent cursor correction.

Both owned runtimes were stopped with `node scripts/usp/real-source-runtime.mjs stop <their exact private run directory>` (exit 0). Post-stop checks found no owned containers or listener on 3189. Each nonce's `minio-data`, `postgres-data` and `redis-data` named volumes remain preserved. The separate staging listener on 3188 remained running.

## Qualification limits and handoff

This proves the specific committed NYC manual-ingestion notification/recovery path and listed protocol controls in one local process. Large-upload producer wiring is present and the existing focused checks pass; actual part/finalization/failure/cleanup event delivery was not replayed here. Gap/excess-range handling is implemented but no destructive retention test or 257-mutation runtime was manufactured. Replica budgets, slow-network performance, all job/source producers, tiles, scale, learning, Indian operational data, frontend integration and any TILE/GF-STREAM/GF-SCALE/release gate remain unqualified.

Lead owns independent review, integration in original staging, final API documentation/runtime qualification generation and migration/release ledger updates. Return these code pins plus the separate receipt commit; worker stops after callback.
