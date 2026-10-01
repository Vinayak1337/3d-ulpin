# PACK-PLAN-01 — immutable selected-target PACK0 plans

2 October 2026. Owned branch `task/desktop-packet-plans`, worktree `C:/Users/kvina/.codex/worktrees/desktop-citygml/3d-ulpin`, exact base `e218ff37d1536482fe195153b246dc12ebf8dd74`. Prior declaration checkpoint `task/desktop-share-declarations@42fe86bdf0eec12585c2bdcc3d18131e5a735cda` is preserved. Assignment: [PARALLEL_20261002C](../../orchestration/PARALLEL_20261002C.md). Declaration publication through `8240d359` was reused, not repeated.

The private create → read → revise → confirm → execute flow persists immutable plan versions and produces existing PACK0 text/CSV bytes. One exact selected building/floor/space, at most 20 explicit entries, a fixed `pack0-exact-text-csv/1` recipe, 64 MiB aggregate selected-original bound and expiry within 24 hours are enforced. These are configured bounds, not measured performance qualifications.

Each version pins exact target/snapshot, creator principal/entitlement/access/policy, captured target/source bodies, evidence/source/excerpt hashes, required/optional choices, inclusion reasons and applicability hash. Confirmation requires the exact version/hash/snapshot and explicit `reviewed:true`, with server-derived reviewer attribution. No plan row is overwritten; SQL triggers protect versions, confirmations and execution links. Revisions retain the identical target pin; another target/revision needs a separate plan. A newer version prevents new execution of an older unexecuted version.

Direct links require explicit review and exact record-backed pointers. Shared inclusion reuses `readSelectedDeclaration` only for its accepted `declared_share` purpose, exact selected target/part/date and assessed consent. It cannot infer broader legal relevance or include siblings. Missing applicability or unavailable exact extraction becomes `blocked_required_context` for required entries, `omitted_optional` for optional entries. Required blockers and an empty supported selection prevent confirmation/execution. Optional omissions remain explicit in the immutable plan and execution receipt; no source fallback or PDF placeholder enters the derivative.

The accepted declaration reader runs outside mutation locks/connection ownership. A first read-only transaction releases before that read; the final transaction repeats authoritative receipt lookup, locks, exact target/source/declaration/population checks and access. This avoids nested pool acquisition under the recording mutex. Plan writes, confirmations, PACK0 registration, execution linkage, command receipt and ordered outbox event use one final PoolClient. Target projection checks include current project identity, aliases and successor context; sources reuse the existing capture projection including import-package parts. Execution rechecks authority and expiry after immutable object I/O and before SQL publication.

Cached requests reauthorize current private access before returning the original receipt. Benign source/target revision drift and expiry do not mutate or retarget historical receipts. New operations still require exact current context. Changed payload under the same key conflicts. One execution per version is allowed; a different execution key after success is rejected with guidance to reuse the original key. Historical plan-linked PACK0 downloads verify linkage/output hash and reauthorize before/after object I/O. Direct PACK0 rendering, selection, receipt schema and unavailable-line behavior remain compatible.

The existing pre-SQL immutable object write can leave an unreferenced generated object if final checks/SQL publication fail. The focused rollback check demonstrates that no packet/execution/receipt/event is published in that case. Originals are unchanged; this task adds no cleanup/reset or queue authority.

## Lead integration

Owned changes are additive plan contracts/server modules, dedicated controller/test, focused test, narrow PACK0 helpers/reader linkage, SQL 14–16, migration/manifest registration and authored-task verifier allowance. No shared exports, EvidenceModule registration or generated publication was edited.

1. Add `export * from './packets';` to `packages/contracts/src/usp/index.ts` and the corresponding contract root export where required by the existing barrel convention. Current worker imports the leaf by explicit relative path.
2. Import `PacketPlansController` from `./packet-plans.controller` in `apps/api/src/modules/evidence/evidence.module.ts` and add it to the existing controllers list. Production-module registration remains unqualified here; the test registers the actual leaf in an isolated Nest module.
3. Republish OpenAPI/client/catalogue through lead-owned tooling after registration. Server wildcard module exports already resolve `@ulpin/server/modules/usp/packets/plan-service`; optional root exports are lead-owned.
4. Review/run the additive `usp_packet_plans_001` check/schema/mark migration in the authorized runtime lane before serving this code. SQL was not applied here. The new plan-linked PACK0 reader depends on the additive tables.

All controller routes use the existing private guard, exception filter, 1 MiB strict JSON reader, server local principal, no-store headers and USP envelope. Routes are POST `/api/v1/usp/packets/plans/{create,read,revise,confirm,execute}`. This bounded synchronous PACK0 increment uses no job endpoint or asynchronous assembly. Operation IDs are `POST_api_v1_usp_packets_plans_<leaf>`.

Compact consumer journey: capture a `targets` snapshot with exactly one pin; POST create with `{input:{target,scope,purpose,format,recipe,expiresAt,entries:[{pointer,required,inclusionReason,review}]},guard:{mode:'create',requestKey}}`; read the returned ID/version; revise with an explicit replacement input and pinned update guard if needed; confirm with ID/version/planSha256, reviewed true and the pinned update guard; execute with ID/version/confirmationId and a new create key. Read/replay always uses the original version. The result contains the normal PACK0 receipt plus exact optional-omission entry hashes. Existing PACK0 receipt/download routes serve its packet ID under current access.

## Verification and source limits

Commands ran from the assigned absolute worktree with the installed frozen-lockfile dependencies and `C:/Users/kvina/AppData/Roaming/npm/pnpm.ps1`:

| Command | Exit / evidence |
| --- | --- |
| `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/usp-packet-plans.test.ts apps/api/src/modules/evidence/packet-plans.controller.test.ts tests/usp-contract-producers.test.ts` | 0, 15 passed, no skips |
| `pnpm typecheck:backend` | 0, server and API |
| `python scripts/db/verify_extraction.py` | 0; 25 historical SQL files/136 statement hashes, 19 authored additions, 43 named migration queries |
| `git diff --check` | 0 |

The initial plan-control run returned exit 1 because its SQL dispatcher did not model the existing declaration authority's literal namespace query. Correcting that controlled transport produced the passing journeys; no live SQL/source failure was hidden. Later code corrections received the directly affected checks.

Focused controls exercise actual service/authority/renderer/controller functions with controlled PoolClient/object I/O: immutable revisions, reviewed direct links, logical multiline CSV, required versus optional missing context, missing/shared-purpose applicability, accepted selected shared context, no sibling bytes, current-access replay, benign historical drift, wrong target/retarget, changed extraction during object I/O, expiry, SQL publication rollback, bounded input, and direct PACK0 reader compatibility. The accepted-shared control permits only one connection and checks that accepted-reader reuse does not nest pool acquisition. These are technical protocol records, not operational property facts or actual PostgreSQL/MVCC isolation evidence.

The unchanged retained LGD original at `fixtures/usp/D4/gf0-structured-codes-v1/lgd-districts.csv` remains 89,622 bytes, SHA256 `b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`. The bounded literal helper check reused the [accepted native reader evidence](native-table-docx-handoff.md): row 4 retains `049`; row 5 retains the empty local-name field and `000`. It reads/rechecks original bytes and does not manufacture a property target, accepted source envelope, plan or learning label. Issuer/acquisition/GODL-India lineage remains in the existing source manifest/index. The retained [D0/PACK0 milestone](continuation-2026-09-23/README.md) at `304725d67e928f064d3951c3781592c3d706e377` remains historical protocol coverage; no services or D0 replay ran here.

Actual persistence, concurrent PostgreSQL/MVCC behavior, mounted private HTTP journey, matched real-property applicability and runtime gate passage remain unqualified. Native document citations do not automatically become legacy PACK0 text/CSV links. PDF extraction/assembly, card/QR, PACK1 and GF4 remain separate; the moving packet-region branch was untouched. No model/provider/GPU calls, learning, source acquisition, service/Docker/socket actions, migrations applied, generated publication, frontend changes, push, deployment or original alteration occurred.

## Pins and worker state

SHA256 values below are the reviewed working-file bytes before Git line-ending normalization; committed blob pins can be reproduced from the returned commit. SQL file/statement hashes and accepted base are in `database/manifest.json`.

| File | SHA256 |
| --- | --- |
| `packages/contracts/src/usp/packets.ts` | `0dbd3f02c0ec4cb3d3252d558f648da339976afe60ae4fd9d1cddb50ed932101` |
| `packages/server/src/modules/usp/packets/plan-authority.ts` | `4983df9539372692e83e4bbabc7067a6a7c83b023efe76cb46a993621255c594` |
| `packages/server/src/modules/usp/packets/plan-service.ts` | `b4543280f7c35eb7100a84d4dbab10ba620d6bcd5eebdf2819543fbd10222ab4` |
| `packages/server/src/modules/usp/packets/plan-shared.ts` | `6c17602cf011c083cc222d274f81f7225cf7ee989d41eeb9a240631a6dc392ae` |
| `packages/server/src/modules/usp/packet0.ts` | `b6bc97a774ddbb4e385cee96ad7792ce1fa91397878f615df86d793fdd9444f9` |
| `apps/api/src/modules/evidence/packet-plans.controller.ts` | `b43fdeeec65fb98c2f429ddc78c69b0429a47c9f226afee27954c876cf662c1a` |

Actual supplied permissions: `approval_policy=never`, `sandbox_mode=danger-full-access`. Assignment requested GPT-6.1 Sol/xhigh/default-standard; the actual model/effort/tier was not exposed by this turn and no speed setting was requested or claimed. Staging remained read-only. No runtime resources were started or taken over. Owned changes are committed before the single authorized lead callback; no unrelated dirty files are present. No polls, schedules, subagents or new chats were created.
