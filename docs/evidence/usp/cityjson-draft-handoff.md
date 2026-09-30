# CITYJSON-DRAFT-01 — private exterior draft

**1 October runtime continuation completed:** retained D1 prepare/private read/replay, projection privacy, review exclusion and recoverable denials pass at the bounded draft scope. One actual-row rollback-only PostgreSQL gate observation passes. The useful unrecorded draft remains; processing is stopped and storage/history retained. See [runtime continuation](#retained-d1-runtime-continuation-1-october) below. Earlier code-only ownership/status statements describe their historical checkpoints.

**1 October lock correction:** `b48660ceaac7c41d77249a9e44847eb7ff5fe2bd` addresses the independently reviewed P2 protocol finding; see the correction section below. Original implementation/handoff and external receipts remain preserved. Runtime remains unrun and lead-owned.

1 October 2026. Implementation `53318fa4632fa3f29f7f4288d34ba8f20c8836ac`, based on `004e2c342300cd874067f8a582bb022a80ebd96c`, branch `task/desktop-cityjson-draft`, worktree `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`. Reconciled staging `d4fd93d884c4b08bf87b39091c8951f5e8b58329`: no difference from the base under contracts/server/API source; the later lead changes are handoff metadata. Primary staging remained read-only.

Assignment: [CITYJSON-DRAFT-01](../../orchestration/CITYJSON_DRAFT_01.md). Requested GPT-6.1 Sol/xhigh/default-standard; actual per-turn model, effort and tier are unobserved. Supplied permissions are `never` / `danger-full-access`. No new chats or subworkers.

## Delivered behavior

| Private operation | Contract | Bound |
| --- | --- | --- |
| POST `/api/v1/registry-cityjson-drafts` | `RegistryCityJSONPrepareSchema` → `RegistryCityJSONReceiptSchema` | 16 KiB JSON |
| GET `/api/v1/registry-drafts/:draftId/native-exterior` | `RegistryCityJSONReadSchema` | 1 MiB response |
| POST `/api/v1/registry-drafts/:draftId/native-exterior/remove` | `RegistryCityJSONRemoveSchema` → `RegistryCityJSONRemovalReceiptSchema` | 16 KiB JSON |

All use `PrivateSpatialGuard`, `private, no-store` and no query fields. Existing RegisterService/module and exact Zod documentation are reused; the operation manifest adds three operations. Generated OpenAPI/client/catalogue remain lead-owned.

Preparation reuses the canonical registry allocator and draft transaction, with one new application building UUID distinct from source IDs and official ULPIN. `destination.kind=source_site` creates a separate nonsynthetic EPSG:7415/NAP site and archived preparation case atomically; no existing site/record is assumed. Existing destinations require the exact declared frame and expected site revision. The accepted source case frame/context/site ID remain unchanged.

The draft carries immutable input/result/artifact/accepted-fence and native selection pins plus the existing core `asset` representation. Native geometry stays in the accepted artifact: encoded vertices, transform, exact Solid/MultiSurface boundaries, LoD, semantics and actual Building/BuildingPart parent context are resolved without reconstructing a shell. The draft XY footprint is the traceable projection of an explicitly selected supported Building LoD0 horizontal face with one ring. Closed rings normalize only that projection; the native ring is unchanged.

Same-client source/case/job/accepted-attempt checks hold canonical SHARE locks and run before/after object I/O. Preparation serializes on the existing case-import advisory lock, locks an existing destination site before source authority, and creates fresh source sites only within its transaction. Current-access reads lock site/draft before source authority. Request replay and different-key same-intent reuse require unchanged draft/site/input/fence pins. Amended/removed intent and an unrelated canonical draft request-key collision conflict without overwrite or duplicate reservation.

General registry projections omit private pins and the candidate-derived footprint. The revision-zero registry identity reservation contains an empty footprint, without private geometry. Generic creation/edit/review/commit reject marker presence, including absent legacy `geometry` and committed replay. Removal increments the draft revision, clears the marker and derived footprint without source I/O, and preserves identity/source/job history. Its remaining empty record needs fresh ordinary footprint/evidence before generic review.

## Code checks and preserved source pins

Focused tests protect loss of exact source geometry, stale/revoked authority, duplicate writes, unrelated draft overwrite and accidental recording/disclosure. Technical controls use in-memory authorities and application references; they create no persisted operational records or qualification receipts. The unchanged source and saved accepted artifact supply the representation checks.

| Actual command/check | Result |
| --- | --- |
| `ULPIN_CITYJSON_DRAFT_ARTIFACT=E:/BhuAayam-data/task-data/desktop-cityjson-api/native.json` then `pnpm exec tsx --test tests/registry-cityjson-draft.test.ts tests/registry-document-evidence.test.ts` | exit 0; 17 passed, 0 skipped (8 new + 9 affected citation/projection regressions) |
| `pnpm typecheck:backend` | exit 0; server and API |
| `node E:/BhuAayam-data/task-data/desktop-cityjson-draft-checkpoint/check-routes.mjs` | exit 0; three route/guard/cache/schema metadata checks, three direct query denials, direct 16,385-byte body rejection (413); no listener |
| `git diff --cached --check` before implementation commit | exit 0 |

These are code/technical checks, **not HTTP/runtime or analytical qualification**. Existing accepted CityJSON/OCR/LINK runtime journeys were not repeated. Only the affected citation/projection regressions were exercised.

| Retained input | Bytes | SHA-256 |
| --- | --- | --- |
| `fixtures/usp/D1/single-roof/original.json` | 6,783 | `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2` |
| `E:/BhuAayam-data/task-data/desktop-cityjson-api/native.json` | 33,168 | `634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e` |

Origin/attribution: [unchanged 3DBAG Building API response](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.1655100000500568), © 3DBAG by tudelft3d and 3DGI, CC BY 4.0 as retained in the [manifest](../../../fixtures/usp/D1/single-roof/manifest.json). Dutch declared EPSG:7415/NAP is not independently qualified or Indian placement. Source-supplied null floor information remains null; no floors, units, rights or volumes are inferred.

External code/source/Git-blob/receipt hashes and exact commits are saved in `E:/BhuAayam-data/task-data/desktop-cityjson-draft-checkpoint/verification-pins.json`, alongside `tests.txt`, `typecheck.txt`, `routes.json` and the no-listener route script. The route receipt pins its executed bundle SHA-256. Original and accepted artifact bytes were rechecked unchanged.

## Limits and runtime ownership

This bounded profile supports one Building exterior or its explicit single-parent BuildingPart geometry, declared EPSG:7415/NAP and one supported source LoD0 horizontal single-ring footprint. Missing/incompatible references, parent relationships, geometry or footprint return recoverable 422; excessive private views return 413. Geometry/reference/topology remain `not_assessed`, state `unrecorded`. No P3 issuance, positive geometry qualification receipt, FIND/READY relaxation, global conversion, geometry exchange, interior, learning, performance, release or deployment claim is made.

**Runtime unrun and lead-owned.** No API/DB/Docker/worker/dispatcher query/start, source mutation, download, GPU/model execution, frontend change, provider call, push or deployment occurred. No owned listener/service was created; temporary route bundle was removed. Tracked changes are committed; the pre-existing untracked `.pnpm-store/` and completed OCR branch remain preserved. After acceptance, the lead may transfer the bounded actual-D1 API journey; this code checkpoint does not authorize or claim it.

## P2 lock correction checkpoint, 1 October

Correction `b48660ceaac7c41d77249a9e44847eb7ff5fe2bd` continues the unchanged branch/worktree from `c4d967be`; no rebase, restart or original-candidate rewrite. Read review `5760a014` from lead `6da5fb7`, correction assignment `20ed401`, and manual-writer extension `de661bbb` via read-only Git. Reconciled primary `de661bbb8199fdf6fa34d96e26d96f93a333e196`: no intervening changes to the opposing writer/converter seams. Requested Sol 6.1/xhigh/default-standard; actual turn metadata remains unobserved. Supplied `never` / `danger-full-access` permissions are unchanged.

`cases/source-case-lock.ts` centralizes the existing `registry-import:<lowercase case UUID>` / `SELECT pg_advisory_xact_lock(hashtext($1))` transaction gate. Every coordinated path acquires it before conflicting row locks or its own advisory locks. There is no global gate, weaker row lock, retry loop or sleep. The previous site/case and case/area row orders are retained:

| Path | Coordinated protocol |
| --- | --- |
| Native preparation and replay | Gate → site/draft as applicable → exact accepted source case/job/attempt authority |
| Private native read | Nonlocking draft site/source-case lookup → gate → pinned site/draft rows → revalidate both identities → source/job/attempt authority |
| Registry case import | Same gate → site → case, with current build/frame/identity checks preserved |
| Source workspace for an existing case | Same gate → existing workspace-specific advisory lock → case → area → site |
| Manual `author` / `decide` | Same gate as first transaction action → existing workspace/case/source/recipe/destination checks and locks |

New-case workspace creation keeps its existing request-key gate; it has no pre-existing source case to coordinate. Replay checks the locked candidate still names the protected source case before accepted authority. Native read rejects case/site identity drift during gate acquisition before resolving a different source. Removal retains its site/draft-only protocol without source lookup, gate, or I/O; replay after removal still conflicts.

The authorized `service.ts` change is exactly one import plus gate calls in `author` and `decide`. `workspace` / exported `lockUnassignedSourceCase`, `manualProfileForLockedSourceTx`, and large-original code are unchanged. This avoids adding a gate after large-original callers have already locked the case.

**Converter impact:** `chunkMappingConverterSha` hashes all of `service.ts`, so the pin changes despite unchanged conversion/profile semantics. The existing 13-file digest algorithm/list and all saved fences/pins remain unchanged. Measured host-file bytes and Git-normalized bytes are recorded separately:

| Encoding | Old digest | New digest |
| --- | --- | --- |
| Host bytes (primary old / correction worktree new) | `6371fbcaacdd3f4134fc4ce76097dac6fb5414cdc37937b48d877605df195424` | `209f51e445e476def1023b87dac36582b94f722bdcfbc4951cbb47515fc56659` |
| Git blob bytes (`c4d967be` / correction) | `368e28693b37f7b8c10dca83c4d0fd64eba4c7e1f72c76ffc7206f036637f39a` | `2f7c4695d1421cf57fa0384c7533a182b01f6a3f8bba2f137a56ac2c1b4acae0` |

`assertChunkMappingInputTx` still rejects another converter pin with 409 when earlier source authority passes. Status and chunk reads, including post-I/O checks, and worker validation use that fence. Enqueue replay includes the current converter in its payload hash and rejects an old hash with 409. Stored history/originals are preserved; no whitelist, compatibility redesign, automatic reprocessing or DB inventory occurred. The gate helper is imported into `service.ts` but invoked only by manual destination-writing entry points; the hashed chunk conversion/profile path calls the unchanged `manualProfileForLockedSourceTx`, never this gate. No further converter-dependency edit is needed. These measured digests do not establish any persisted job's served-byte pin; lead must reconcile retained jobs and served code before runtime transfer.

Focused correction checks: `pnpm exec tsx --test --test-name-pattern='lock protocol' tests/registry-cityjson-draft.test.ts` exit 0 (3 passed, 0 skipped); `pnpm typecheck:backend` exit 0 (server/API); `git diff --cached --check` exit 0; `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-cityjson-draft-lock-correction/converter-pins.ts b48660ceaac7c41d77249a9e44847eb7ff5fe2bd` exit 0. The checks run actual entry points against in-memory query doubles: opposing workspace/native sequencing, native read/replay and lookup drift, manual author/approve/execute entry gates, and canonical import. They are **protocol evidence, not PostgreSQL contention or persisted API success**. Completed native/source/API/OCR/LINK tests were not repeated.

Correction code/Git/source/receipt pins live in `E:/BhuAayam-data/task-data/desktop-cityjson-draft-lock-correction/verification-pins.json`, with `protocol-tests.txt`, `typecheck.txt`, `converter-pins.json` and its measurement script. Prior `desktop-cityjson-draft-checkpoint` receipts are untouched. No source bytes, candidate/result pins, qualification, frontend, generated API, services, provider, GPU/model, deployment or paused goal-tracker state changed. No owned processes were created; only preserved `.pnpm-store/` is untracked. The actual retained-D1 API journey and PostgreSQL contention check remain pending explicit lead acceptance/transfer.

## Retained-D1 runtime continuation, 1 October

Merged authorized final handoff `0bd5628c6e8d86238d9a2573993f5cb7fc35e7cb` in the preserved worker branch. Served merge `4bc3e76841c2f27b14c94af10f7360ae0f2767ff` matches its accepted tree. Supplied permissions are `never` / `danger-full-access`; GPT-6.1 Sol/xhigh/default-standard requested, actual model/effort/tier unobserved. Primary staging/root `.env` remained untouched. Accepted code/reviews/typechecks/offline validity were reused.

Project `ulpin-usptest-b050544f3d2cb99e`, config `E:/BhuAayam-data/runtime/prefix-worker-20260929`, API `http://127.0.0.1:3192`. Actual geo/worker image is `sha256:f522efd1bf4975575b016cdeb587c1d12f0236697b9e20c45fcf64e9947e6a30`; IDs `bd0355de03e8e82eeee224fc192f93db95fda22e4d0a7dbcca71be0a1525e516` / `7853e43f49830d14cce72caaa34114b5adefed47f2171469d0a9eee7c682d893`. Both containers' 45 actual Python file hashes match the worktree. Host receipt pins 41 files, running API/dispatcher identities, their executable and private configuration-file hashes.

### Observed recovery

First preparation returned `409 STALE_REVISION` before publication: Windows CRLF reader copies hashed to `5b3acfc03646043ceac58813551709f878b9e76c7878a14ffc9a3c6a4849c633`, while the accepted D1 job pins LF Git bytes `377edfe71f3d08e0a1f4fb710441022b9a26fdadd0efa70724d0d1dea0f3d398`. Preserved the initial response/bytes, restored only the two worker reader files to their exact accepted Git blobs, and rebuilt/recreated only stopped owned geo/worker with identical mounts/configuration. There is no Python text/algorithm diff, changed hash rule, saved-pin rewrite or reprocessing. Storage container IDs, images, running state and volumes remained identical. **Future execution must preserve these LF reader bytes; another checkout EOL conversion would correctly stale the saved job.**

The canonical-byte API run completed all HTTP/source assertions, then its evidence helper exited 1 comparing `pg` Date objects with saved ISO strings. A narrow recovery compared the exact serialized snapshot hash and finished persisted-data assertions without repeating the journey. Initial baseline's incorrect chunk operation filter was corrected before startup; both files remain. Final guarded launch restored the accepted whole-page OCR scratch path/config hash `a3d4f6a75198745af23627104ae353eee45b048f8c97fda59612b52861c66030`; earlier launches used the older retained scratch path. No OCR ran. One final private draft read returned the unchanged result.

### Actual result

| Observation | Outcome |
| --- | --- |
| Exact retained-D1 prepare → native read → same-key replay | 201 → 200 → 201; identical receipt, exact native building/part/LoD2.2 geometry/vertices/transform and source LoD0 footprint; private read `private, no-store` |
| Generic draft/site projections | Private marker/source/job/result/asset/selection pins absent; exposed draft footprint empty |
| Generic review | 422 `REGISTRY_CITYJSON_UNRECORDED`; no review or recorded revision created |
| Commit with created record UUID as nonexistent review ID | 404, no write; this is not a forged-review test. Review exclusion is the recording barrier |
| Actual slanted LoD2.2 RoofSurface `/boundaries/0/16` selected as footprint | 422 `REGISTRY_CITYJSON_FOOTPRINT`; root Building LoD0 footprint is required |
| Stale source-case revision 0 | 409 `STALE_REVISION`, no partial publication |
| Original download and retained source/history comparison | Exact 6,783 bytes/hash; source case/frame/context/site/revision, D1 sources/jobs/metadata/attempts/prior operations and all ten historical chunk jobs/metadata/attempts unchanged |
| Actual-row gate protocol | T2 waits on the same advisory gate before acquiring destination/case relation locks; after T1 releases, opposing rows complete. Both transactions roll back; finite 5-second lock / 7-second statement limits |

Useful draft `bacc6fee-3156-438b-9720-8e7a531f9a47`, revision 1; record reservation `9ed65d91-836b-4760-b8cc-5d2160882fea`, revision 0; separate site `5c79a3c1-ac30-4f2c-b318-d20121976926`. Its preparation case is separate/archived; the retained source case stays unassigned. Exactly one preparation operation, site, record and draft persist; zero reviews/recorded revisions. Reservation has empty body footprint and null SQL geometry. State remains `unrecorded` / `not_assessed`, with declared Dutch EPSG:7415/NAP and null source floors. No canonical geometry/reference, analytical, accuracy, learning, release, scale or broader concurrency qualification follows.

Accepted job/result remain `b1afbd0e-f480-45c8-b28b-4c9f19fe09a3` / `c43beea3877c207a49c99f1348f390e7ae92627013f0bfc3cf95a0dc7f4db855`; source/original and accepted artifact hashes remain those above. The exact retained snapshot SHA is `febbba01db49493ab5a0c312076b6e44bca3f48f593c9fb3b4d073562f7e8133` before/after. Ten completed chunk jobs keep five old converter pins, two each; current host converter remains `209f51e445e476def1023b87dac36582b94f722bdcfbc4951cbb47515fc56659`. Historical strict stale/replay fences remain; there is no compatibility claim or reprocessing.

Primary receipt: `E:/BhuAayam-data/task-data/desktop-cityjson-draft-runtime/verification-pins.json`, SHA `4111f258464a0bbdf5a04a4d93cda0e62ca78d4beb63fc106cd020e2668caecc`. It pins 37 retained artifacts, including actual responses, before/after snapshots, process/container/host/source hashes, recovery helpers and cleanup. `verify.mjs baseline-complete/container-*/finish-api/lock/final`, canonical-byte recreation, host capture and cleanup exit 0. Both API-helper exit-1 observations and their limited causes are disclosed above. Guarded `preflight/start/stop/status` exit 0; final API/dispatcher PIDs are absent, ports 3192/28000 free, geo/worker stopped and all three populated storage services remain running. Goal tracker stays paused as reference. Only the owned handoff is committed; preserved `.pnpm-store/` remains, and Git may report the two LF-restored reader files as stat/EOL modifications although their normalized text/index diff is empty.
