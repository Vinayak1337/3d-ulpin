# CITYJSON-DRAFT-01 — private exterior draft code checkpoint

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
