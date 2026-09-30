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
