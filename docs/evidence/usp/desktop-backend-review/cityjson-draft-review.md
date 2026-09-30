# CITYJSON-DRAFT-01-R — private exterior draft review

1 October 2026. **Changes requested: one P2 lock-order finding.** No other actionable finding established in the assigned delta. Persisted runtime remains unrun and lead-owned.

## Scope and settings

- Implementation `53318fa4632fa3f29f7f4288d34ba8f20c8836ac` against exact base `004e2c342300cd874067f8a582bb022a80ebd96c`; 11 production/test files and the handoff at `c4d967be1d3525e043928c150debe9bf458df9a5`.
- Review branch `task/desktop-cityjson-draft-review`, worktree `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`. Primary staging was read-only at `93f1b1ec69d6e0a2b8c5dd0f64e16e495bfac27b`; its contracts/server/API source matches the exact base. Prior LINK review checkpoint `e8d35eea5c30361b9d4a1147e8fad5260b063070` is preserved.
- Requested Astra/xhigh/default-standard. Actual per-turn model, effort and tier are unexposed; no tier change is claimed. Supplied permissions verified as `never` / `danger-full-access`. No workers or services were launched.

## P2 — coordinate site/case locks with source-workspace creation

Changed location: `packages/server/src/modules/registry/cityjson-draft.ts:137` (existing-site lock), then `:170` (accepted source authority). Related new paths: `:107`, `:155`, `:197–198`.

Preparation takes `registry_sites S FOR UPDATE` before `acceptedCityJSONTx` takes `cases C FOR SHARE` through `usp/ingestion/cityjson.ts:56`. The existing API operation `POST /api/v1/source-workspaces` follows the reverse order: `cases/source-workspaces.ts:39` takes `C FOR UPDATE`, then `:46` requests `S FOR SHARE`. The advisory locks do not serialize these operations: preparation uses `registry-import:C`, while workspace creation uses `source-workspace:C`, with different advisory key functions as well.

Reproduction prerequisites: an unarchived case C with a current accepted CityJSON source and no import package or registry case-feature mappings; an existing nonsynthetic EPSG:7415/NAP site S with a map area A; current source/site/area pins and fresh request keys. Both requests pass their relevant guards. Creating a source workspace for an existing case with retained sources is supported; it need not already have a package.

Static reproduction schedule, **not executed against PostgreSQL**:

| Step | Native preparation transaction | Source-workspace transaction |
| --- | --- | --- |
| 1 | Acquire `registry-import:C`; lock site S `FOR UPDATE`. | |
| 2 | | Acquire `source-workspace:C`; lock case C `FOR UPDATE`; pass absence checks; lock/read area A. |
| 3 | Request case C `FOR SHARE` inside accepted authority; wait for the workspace transaction. | |
| 4 | | Request site S `FOR SHARE`; wait for native preparation. |

`FOR SHARE` conflicts with the other transaction's `FOR UPDATE` in both directions. PostgreSQL must abort a participant with `40P01`; the transaction helper rolls back without retry, and the API exception filter maps this unhandled database error to 503. This fails an otherwise valid preparation or workspace operation under concurrent use. It does not establish partial publication or data loss.

The same edge exists in dedicated reads (`lockedDraft` locks S before source authority locks C) and preparation replay. After preparing a candidate in S, a read can race the first workspace creation for C with the same schedule. Fix the shared lock protocol across the affected paths before acceptance. Preserve current source/fence checks and canonical import ordering: `registry-seed.ts:64–76` already locks site before case, so merely reversing the new preparation locks without accounting for import is insufficient. A focused contention check should cover this opposing writer and the read/replay path once runtime ownership permits it.

## Remaining review observations

- Preparation preserves the accepted source case frame/context/site pins. New site, empty revision-zero reservation, archived preparation case, draft candidate and operation receipt use the same transaction/client. Existing-site request-key collisions are checked before artifact I/O; same-intent reuse checks draft/site/record/input/fence pins.
- Source authority checks current case, latest source family revision, access, reader/input hash, result and accepted attempt. Preparation/read checks surround artifact I/O and retain SQL locks through completion. Job claim/accept paths acquire source authority before job/metadata/attempt locks. These static checks do not qualify real SQL concurrency; the finding above remains open.
- Selection preserves source geometry, encoded vertices, transform, LoD, semantics and actual parent context. Only the explicitly selected horizontal LoD0 single-ring face supplies draft XY. EPSG:7415/NAP remains declared and `not_assessed`; unsupported references/relationships/faces stay rejected.
- Generic create/edit/review/commit paths reject marker presence, including null/undefined markers and committed review replay. General draft/site/record/history projections remove the marker and candidate footprint. The reservation body has no private pins or derived footprint; snapshots select recorded revisions only. No reachable private candidate leak through dossier/resolver/snapshot/export was established. Citation amendments require a recorded correction and cannot amend this revision-zero candidate.
- Removal uses current local draft authority and expected revision/record, clears marker plus derived footprint, and preserves reservation/source/job/operation history without source I/O. The remaining empty record still requires ordinary valid footprint/evidence before review.
- Three additive Nest operations use the exact schemas, `PrivateSpatialGuard`, `private, no-store`, query rejection and 16 KiB mutation bodies; dedicated output is checked against 1 MiB. Generated API/client metadata remains lead-owned.

## Evidence and limits

Reused the lead's verification of `E:/BhuAayam-data/task-data/desktop-cityjson-draft-checkpoint/verification-pins.json` (9,220 bytes; SHA-256 `78ff3e318cdf496f1cb94591195600a4240355edcca6bbeb8dab6639f3537ddf`): all 11 code pins, three source pins, five evidence/helper artifacts and handoff. Inspected retained `tests.txt`, `typecheck.txt`, `routes.json` and the route helper. Owner checks report backend typecheck exit 0, 17 tests passed with zero skips, and no-listener route metadata/query/body checks exit 0. The route receipt pins bundle `4dab973aaeac3548b0d7469b19d4eff6d9291fe82409e63204da4caa078d8100`. In-memory clients test authority and draft behavior, not PostgreSQL blocking/rollback.

Unchanged retained D1 original: 6,783 bytes, SHA-256 `5dcfc3bb7ded9bbe4c6f5ed2b73fbe3ae0c27131812b221ec14996379c441af2`. Accepted native artifact: 33,168 bytes, SHA-256 `634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e`. Source is the retained Dutch 3DBAG exterior, attributed to tudelft3d/3DGI under CC BY 4.0; no Indian placement, floor/unit/rights or geometry qualification follows.

Reviewer checks: static delta/caller/SQL-order inspection; `git diff --check 004e2c342300cd874067f8a582bb022a80ebd96c 53318fa4632fa3f29f7f4288d34ba8f20c8836ac` exited 0. No review test campaign or reproduction was executed; the finding is the explicit incompatible-lock schedule above. No API/DB/Docker query/start, model/GPU execution, download, source mutation, frontend/generated change, production edit, provider call, push or deployment. Only this report is committed. Fix ownership remains with the implementation owner after lead coordination; actual retained-D1 persisted success and concurrency verification remain pending.

## Exact correction closure — 1 October 2026

**Current disposition: P2 closed at source/protocol review scope; no remaining actionable finding in the exact correction.** This supersedes the original changes-requested disposition above. Reviewed correction `b48660ceaac7c41d77249a9e44847eb7ff5fe2bd` against baseline `c4d967be1d3525e043928c150debe9bf458df9a5`, with handoff `3f1101ad3bb31104ab52abbafaf6dc370db170d0`, under the exact closure assignment at primary staging `8dd6c4a3a98be2e2c0623add7f6d7c1f09d708a5`. Inspected candidate files through Git; preserved review commit `5760a01481d8baf6ce7b85bb2c701804aa241910`, its branch and checkout. Requested Astra/xhigh/default-standard; actual model/effort/tier remain unexposed. Current supplied permissions are `never` / `danger-full-access`.

### Lock correction

- `cases/source-case-lock.ts:9–11` normalizes the case UUID and centralizes the existing `registry-import:<lowercase UUID>` / `pg_advisory_xact_lock(hashtext($1))` transaction gate. It does not weaken row locks or introduce a global gate.
- Native preparation/replay (`registry/cityjson-draft.ts:137`), canonical import (`registry/registry-seed.ts:39`), existing-case workspace creation (`cases/source-workspaces.ts:29`), and manual author/approve/execute (`usp/ingestion/service.ts:141,167`) acquire that same gate before their row locks and caller-specific advisory locks. The original opposing schedule cannot proceed past both first row locks concurrently. Existing site/case and case/area ordering is retained behind the gate.
- Native read performs a nonlocking draft lookup, acquires the source-case gate, then locks the looked-up site and current draft (`cityjson-draft.ts:200–207`). It rejects changed site or source-case identity under row locks before accepted source authority. Replay separately compares the candidate source case to the protected request case before authority lookup. Existing current-access, input/fence, artifact and post-I/O checks remain intact.
- Removal remains site/draft-only, without the source gate or private I/O. It cannot wait back on the source case; concurrent read/removal resolves under the existing draft locks, and replay after removal remains rejected.
- Confirmed the exported `workspace` / `lockUnassignedSourceCase` body and large-original implementation are unchanged. Large-original callers can already hold case/upload locks before invoking that helper; it acquires no new gate. Manual retain/inspect and `manualProfileForLockedSourceTx` also do not enter the new gate. The correction therefore adds no case-before-gate inversion through these callers. New-case workspace creation retains its request-key protocol because its case does not yet exist for another native request.

### Converter consequence and evidence

`chunkMappingConverterSha` still hashes all 13 existing files, including `service.ts`; its three added lines change the digest despite unchanged profile/conversion semantics. The helper is called only by manual author/decide and is not reached by the chunk profile/conversion path. The unchanged `assertChunkMappingInputTx` rejects a differing converter pin; status, chunk reads (including their post-I/O recheck) and worker validation retain that fence. Enqueue replay still hashes the current converter and conflicts on the previous payload hash. No saved pins, compatibility whitelist or automatic reprocessing were added. The handoff explicitly describes the resulting stale status/chunk/replay behavior and distinguishes host bytes from Git-normalized bytes. Served historical jobs must still be reconciled by the lead before runtime transfer; this review makes no compatibility pass.

Reused the lead's verified correction receipt `E:/BhuAayam-data/task-data/desktop-cityjson-draft-lock-correction/verification-pins.json` (8,047 bytes; SHA-256 `8eb3194f96de2c95cf2d6a7cb1512fb5e388ad8e2958f5106c022cfb1efd59e6`), six physical/Git code pins, source/evidence/prior-receipt/handoff pins. Inspected the three actual entry-point protocol controls and retained `protocol-tests.txt` (3 passed, 0 skipped), `typecheck.txt` (server/API exit 0), `converter-pins.json` and its measurement script. The cooperative query doubles verify gate sequencing, read/replay identity drift, removal behavior and manual/import entry ordering; they do not execute PostgreSQL contention. No concrete residual concern required repeating those checks.

Reviewer `git diff --check c4d967be1d3525e043928c150debe9bf458df9a5 b48660ceaac7c41d77249a9e44847eb7ff5fe2bd` exited 0. Only this appended closure is committed. No production/generated edits, services, DB/API queries, validity rerun, new workers, source mutation or goal-tracker change. Actual persisted retained-D1 success, PostgreSQL contention and historical served-pin compatibility remain unrun and lead-owned; prior qualification limits remain unchanged.
