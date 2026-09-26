# INGEST-06 — bounded durable large-original receipt

Status: implementation and focused local recovery evidence ready for exact-code review. This is a byte-receipt handoff, not a release, semantic-conversion, learning or scale qualification.

## Pins and ownership

Accepted implementation base: `ac4d47b783886a4c39cdd45c270058a4691a6a05`. Worker branch: `task/ingest-06-large-original`, checkout `/Users/vinayak/.codex/worktrees/0bc6/3D Ulpin`.

| Commit | Scope |
| --- | --- |
| `97ea2770156b05f82e3faabbc317ff0206baaba4` | Initial contracts, durable receipt/parts, additive SQL, native routes and bounded private download |
| `c33c429ccefd48ecd732169c8f819887bca22f64` | Lead-authorized explicit API port choice, paired isolation validator and existing guard test |
| `1b77e29ce567ecbeb9dcab0d40c9e31d10a60ed7` | Harness-only checkpoint connections close before API restart; full journey served at this pin |
| `9d4e885f478793d3cbc92eea8a6a63a0ebe509f4` | Current production correction: retryable cleanup, durable zero-payload fences, conditional bounded original stream, lifetime receipt/key caps and focused recovery harness |

Assigned/observed model: `gpt-6-sol`, `max` (session turn metadata). Fast requested; configured preference `priority`; observed per-turn tier unobserved. No subagents or new implementation tasks were created. Lead owns final API catalogue/generation and acceptance; this task did not push, merge, deploy, change frontend/design, change credentials/bucket settings, reset/reseed services or call live model providers.

## Original and lineage

The retained private original is `/Users/vinayak/.codex/task-data/ulpin-nwic-boundaries-v1/district_nwic_geojson.zip`: **71,238,839 bytes**, SHA-256 `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37`. The harness streams and recomputes this hash before each real-source run. It does not reacquire, rewrite or unpack the file.

Original issuing portal: National Water Informatics Centre; portal metadata lists Geological Survey of India as producer. Original [download URL](https://nwdp.nwic.gov.in/dataset/6c1af675-1dec-4927-882c-c1ba9d73f76b/resource/8d9aa2e9-9806-4f26-a4ac-48ba21e9b96d/download/district_nwic_geojson.zip), acquisition `2026-09-26T08:44:40+00:00`. Existing admission records are `fixtures/usp/D3/nwic-boundaries-v1/manifest.json` and `docs/evidence/usp/nest-migration/nwic-boundaries/source-check.json`. Conditional deterministic test use is documented under the resource's Other (Open) designation and [NWIC copyright policy](https://www.nwdp.nwic.gov.in/footer/copyrightPolicy); no public redistribution or training occurred. Training permission remains unconfirmed. The API preserves supplied provenance as **caller_declared**, independently of its byte hash/size proof.

The prior independent source check recorded one `district_nwic.GeoJSON` member, **168,356,689 expanded bytes**, SHA-256 `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201`, 733 MultiPolygons/3,125,505 positions and explicit projected EPSG:7755 metres. Those are prior format observations, not results of this ingestion path. The expanded member exceeds the existing parser profile; this path does not parse/convert it. Archive/member/companion completeness remains `single_original_only_archive_dependencies_not_assessed`.

## Implemented native contract

Seven additions are appended to the existing ingestion operation manifest with per-entry batch `INGEST-06`; the old top-level `INGEST-02A` and its seven entries remain intact. Native metadata reconciles **146 operations** (the unchanged 132 baseline plus fourteen ingestion additions). No new runtime claim was written into the lead-owned published API artifacts.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/api/v1/ingestion/upload-limits` | Fixed bounded profile/capabilities; conversion unsupported |
| POST | `/api/v1/ingestion/cases/{caseId}/uploads` | Strict declared original/provenance, request key, current case revision; server allocates keys |
| GET | `/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}` | Durable part progress, immutable request/hash bindings, current/pinned revisions, cleanup state |
| PUT | `/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/parts/{partNumber}` | Raw octet-stream; bounded actual bytes/hash; request/upload/case/part-hash headers |
| POST | `/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/finalize` | Complete ordered parts + actual whole hash/size; one canonical source, idempotent successful replay |
| POST | `/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/abort` | Fence incomplete receipt; retained originals cannot be aborted |
| POST | `/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/cleanup` | Retry scoped payload reclamation; completed replay has no I/O |

The existing `/api/v1/sources/{sourceId}/file` identity remains. Large native downloads recompute full hash/size before headers, recheck source/case/operator/receipt pins, then conditionally read the same sealed ETag and stream with backpressure and a final hash/size check. ETag guards identity; it does not prove the hash. This costs two complete reads and holds the two-reader allowance through completion under a total 120-second deadline. Disconnect aborts the transfer. Failure after headers terminates the response and records a structured failure; it cannot retract bytes already sent or emit a success JSON envelope. Partial ranges return 416; cross-site reads return 403. The legacy whole-byte storage reader rejects `large-originals/` keys before fetching them; small byte downloads remain unchanged.

Source publication uses the existing `sources` authority: profile `large-original-v1`, status `needs_input`, conversion `unsupported`, verified hash/size/ETag and declared provenance. It creates no conversion, extraction, model, package, placement or publication job. Existing case/workspace/operator/revision locks and source membership are reused. `usp_source_uploads`/`usp_source_upload_parts` hold receipt metadata beside that source authority; they are not a semantic batch registry or queue. Storage I/O is outside database transactions. Additive named SQL is `ingestion.large.schema`; historical SQL bytes/hashes remain unchanged.

## Bounds and storage fencing

| Limit | Value |
| --- | --- |
| Original | Greater than 16 MiB, at most 128 MiB; ZIP or octet-stream opaque original |
| Byte part | Fixed 8 MiB, final part exact remaining bytes; at most 16 parts; one active part per receipt |
| Active receipts | 2 per case, 2 per configured operator, 4 globally |
| Lifetime receipt capacity | **128 total rows forever in this bounded profile**, including active, retained and aborted rows; no retention/eviction system added |
| Registered key ceiling | At most17 keys per receipt, therefore at most 2176 registered keys; not a measured physical metadata/disk bound |
| Payload reservation | 512 MiB total declared non-aborted original payload; worst-case managed temporary+original copies bounded by 1 GiB; object metadata/storage-engine overhead separate |
| Admission lifetime / producer lease | 24 hours /180 seconds |
| Raw read / individual storage read | 30 seconds /30 seconds |
| Finalization / cleanup / full download | 120 seconds each |
| Part / finalization attempts | At most3 each |
| Download readers | At most2 in this process |
| Required object store profile | Confirmed unversioned private bucket with conditional PUT semantics; enabled/suspended/non200/failed capability probes fail closed |

The lifetime row cap does not reset on abort, expiry or a new day. Exhaustion rejects admission with 429; cleanup cannot manufacture new lifetime capacity. Payload reservation is released only after scoped cleanup reaches its fenced terminal state.

Parts use `If-None-Match:*`. Fresh state/token/lease validation precedes I/O, while **permanent zero-payload fences** protect the subsequent check/write window: cleanup replaces exact owned temporary keys with empty objects carrying the upload owner, verifies zero bytes, and never removes these markers. Aborted allocated-original keys receive the same fence. Canonical source references are checked before reclamation, and retained original keys are preserved. Durable receipt/part metadata retains key ownership after abort. `cleanupPending=false` means temporary **payload** was reclaimed with fences retained; it does not mean all objects were deleted. The row/key ceilings bound object-count growth; physical metadata overhead was not measured.

A failed/expired cleanup claim can resume the **same immutable request** under current row/state/lease fencing. Only completed cleanup qualifies for its replay shortcut. A changed payload under the saved cleanup key conflicts. Live producers/cleanup leases remain explicitly pending until they finish or expire.

Original assembly now preflights actual ordered-part hash/size, then re-reads verified bounded parts into one conditional streaming PUT, using a byte-mode 64 KiB high-water mark, and verifies the stored original again before source publication. It has no independent new multipart-upload parts. The 128 MiB profile fits the [documented single-PUT capacity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html). The fencing reasoning relies on [documented conditional-write behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html), supported here by actual configured-store tests, not by documentation alone.

Exact-key legacy MPU cleanup remains for previously pinned implementations. It assumes old producers are quiesced. All older owned runtimes are stopped; fresh nonce tests do **not** qualify a hot upgrade with live old MPU producers. No bucket settings were changed. An external administrator or lifecycle policy removing fences is outside the tested profile.

## Runtime observations, kept at their original pins

| Nonce / served pin | Observation |
| --- | --- |
| `1c24e431ae6c655f` / `97ea277…` | Prepare only; start refused because 3188 was occupied by original staging API. No worker services started. Original prepared files preserved. Lead authorized 3189; the staging process was never stopped. |
| `493bb6b7ee42c39e` / `c33c429…` | Startup/schema repeat/API-only restart passed. Full harness failed on post-restart GET with observed `fetch failed`. Keepalive reuse is a **suspected** cause, not proven. A fresh 200 status read proved rev 5, two exact received parts and 16,777,216 bytes survived. Failed receipt and stopped volumes preserved. |
| `5de0baf1b120d51b` / `1b77e29…` | Full native journey passed seven grouped checks: admission/replay/conflict/scope; partial finalize denial; two-part restart/resume; nine-part wrong declared whole-digest rejection without source; peer-only abort/replay/cleanup; successful nine-part finalize/replay; exact private download and separate official NYC small-GIS retain/download compatibility. Counts in the NWIC case: `{"sources":1,"uploads":2,"retained":1,"aborted":1,"parts":9,"jobs":0,"modelCalls":0}`. |
| `92f0eab6f400311c` / `9d4e885…` | Focused corrected-code recovery/finalization passed five grouped checks; details below. Counts: `{"sources":1,"uploads":3,"aborted":2,"reserved":"71238839","jobs":0,"modelCalls":0}`. |

The full journey retains source `6f09412c-0a54-47ca-9e32-1391c8677f60` and upload `dbd2eed9-3f92-49f9-9eb4-3dbaa21971f0` at its older exact code pin. It has not been silently reassigned to corrected code. The earlier wrong declared digest was a protocol control over unchanged real NWIC bytes, not a fabricated operational record. The NYC input stays in a separate foreign source case.

Current focused source: `06e9eb77-f726-4e75-a6d5-c601a0e18914`. Recovery observations:

1. Stored a real 8 MiB part with durable writing intent, interrupted metadata publication, and aborted while its producer was fenced. Injected one reclaim failure. The same immutable cleanup request resumed from failed revision 6 to completed revision 8, reclaimed actual payload, then replayed without further storage I/O. Changed binding returned 409.
2. Paused a part producer **after its fresh database validation and before storage dispatch**, from `2026-09-26T09:47:49.399Z`. Its actual lease expired at `2026-09-26T09:50:49.383Z`. Cleanup completed and verified the zero fence at `2026-09-26T09:50:49.639Z` before releasing the delayed producer. The configured store refused replacement; publication failed with `SOURCE_INTEGRITY` and the receipt remained aborted with cleanup complete.
3. Attempted the actual conditional streaming original PUT against that aborted original fence. SDK precondition failure 412 was observed (`alreadyExists=true`); remaining payload stayed 0 and no exact-key MPU existed. The SDK emitted its expected non-retryable-stream warning for this denied control; the harness completed successfully.
4. A fresh nine-part corrected finalization/replay retained and privately downloaded exactly 71,238,839 bytes with the original SHA-256. Cleanup of its temporary payload preserved the canonical original.
5. Scoped read-only Head/count audit observed **14 registered objects: 13 zero-payload fences and one unchanged original**, total payload 71,238,839 bytes. Reserved payload equals one original; two aborted receipts hold no payload reservation. Jobs/model calls remain 0.

These barriers do not hold an **already-dispatched remote PUT** in flight. They prove the post-validation/before-dispatch schedule and a conditional request after a fence exists. General concurrent commit ordering remains the storage semantic assumption; exact pinned MinIO implementation review and AWS documentation support the reasoning. No claim is made for arbitrary S3-compatible endpoints, provider cancellation guarantees, versioned buckets or other network schedules.

The tested store is `quay.io/minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e`, actual container image ID matching that digest. All started owned API listeners were 127.0.0.1:3189; other fixed ports and nonce/database/bucket/process/operator guards remained intact. Health's `dataMode=linked` reflects `REPO_DATA=false`; verified saved endpoints selected the fresh isolated nonce resources, not linked populated services.

## Commands and evidence

| Command/check | Observed exit/result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | 0; dependencies already locked/up to date |
| Initial affected six-file test set (`large-original`, `manual-ingestion`, `source-intake`, `gis-inspection`, `nest-intake`, API boundary) | 1 initially: 27/28; operation-ID manifest typo only. Corrected manual test rerun:0, 2/2. |
| Current directly affected `large-original` + `manual-ingestion` tests | 0, 5/5; all 146 native identities reconcile |
| Existing `engineering-isolation.test.mjs`, extended with port guards | 0, 33/33; no other profiles relaxed |
| Current `pnpm typecheck:backend` and `pnpm build` | 0; server/API typechecks and builds |
| `python3 scripts/db/verify_extraction.py` | 0; 25 historical exact files/136 statement hashes, 3 authored additions, 27 named runtime queries |
| Harness/helper syntax and `git diff --check` | 0 |
| Guarded schema repeat, nonce 493 | 0; all required services ready |
| Full native smoke, nonce 5de /1b77 | 0, seven grouped checks |
| Focused recovery, nonce 92 /9d4 | 0, five grouped checks plus scoped fence audit |
| Owned runtime stop/status | 0; no containers, no owned process-group members; named volumes retained |

Private receipts remain outside Git under `.runtime/run01/`; credential files were not copied into this handoff. SHA-256 pins:

| Relative private evidence path under `.runtime/run01/` | SHA-256 |
| --- | --- |
| `493bb6b7ee42c39e/large-original-smoke.json` | `3ba1992bc58efb588f137f1110b7ca4e333b0763da12dc124bcc4778ec64a25d` |
| `5de0baf1b120d51b/large-original-smoke.json` | `9f2c1ddf56a2f7e67b3881c7d9d85a9d239578457f6d358fd7babdcfb4f899b0` |
| `92f0eab6f400311c/large-original-recovery.json` | `1ad233e9ffb163a57b69a85afbf4a97a89108f56b1d86f2c06dc878ea8824ea7` |
| `92f0eab6f400311c/fence-audit.json` | `5c5d127e2e811cef6984f40524f151f1371f6b964c8928068e6fb2f6a32f7f4e` |
| `92f0eab6f400311c/stopped-status.json` | `9e963ecb962c0daaa3c5dffdf784c89b514908dc338cd8826e245c4839f44371` |
| `92f0eab6f400311c/preserved-volumes.txt` | `1c5cae9b317f44fc40bb60078a2674e54bf6eba1748f09926443b5b13d1b857d` |

Current code/artifact hashes (the runtime served TypeScript at its clean commit, not this bundle):

| File | SHA-256 |
| --- | --- |
| `apps/api/dist/main.js` | `1651ac0a6e5f1ed54f3ba259f4ae8eef66b6be01c0462fd89426656e9163b3c8` |
| `packages/server/src/modules/usp/ingestion/large-original.ts` | `93702dc7c2e88e4b300397018229a12e010d3f5026f8581b4ac2c58e187f54fa` |
| `packages/server/src/infrastructure/storage.ts` | `3de23897e2ca1257d2c67161710464141b9a7898e8d5b794b81c270860d2b65e` |
| `packages/contracts/src/usp/ingestion.ts` | `5878bd4651fb438fe14ff3fac2176fc10b72cffb24beaeffab42e329f6708a1a` |
| `database/sql/95-ingestion/large-original.sql` | `d2c2cfd914818e5bbcc2c1b334cc630c4e871875cf4421852acf52ca1152aaf0` |
| `pnpm-lock.yaml` | `f90787f4e7ca2881cca77b0700f40a09a16a2745d53ffa4e2c73a3a84813af61` |

Owned runtime shutdown is complete for nonce 493,5de and92: recorded API/dispatcher groups are gone and their Compose containers are absent. Each nonce preserves its `minio-data`, `postgres-data` and `redis-data` volumes. The initial nonce 1c24 has no started runtime. No volume deletion, broad bucket cleanup, reset/reseed, replacement snapshot or linked/staging service stop occurred.

## Remaining qualification and review

Archive expansion, companion/member completeness, semantic parsing/conversion, CRS transformation, geometry accuracy/currentness, placement, property rights/official ULPIN issuance, officer approval, model training/accuracy, performance/distributed scale and GF release gates remain unqualified. Receipt provenance and original-byte integrity are separate. No model artifacts exist for this task.

The current correction is ready for targeted exact-code review. Final catalogue/runtime-qualification wiring and integration belong to the lead after acceptance. Workers stop here with all owned runtimes down and retained evidence intact.
