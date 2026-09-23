# 3D ULPIN — current agent entry point

## Branch flow

`main` retains the previous implementation. `staging` is the integration branch
for the current USP work. Start new implementation branches from `staging` and
target their pull requests to `staging`; reconcile and verify there. Do not merge
`staging` into `main` without a separate user request. The merged historical
Studio branch `feat/studio-reference-rebuild` is retained as an archive.

## Adopted direction and what to read

Effective 23 September 2026, follow `docs/usp-agent-handoffs/00-README.md`,
`01-shared-contracts-and-ownership.md`, the assigned feature's complete A–K
sections, relevant `99-ui-ux-and-integration.md`, and current code. The handoffs
originate at `e167b1f` and include explicitly dated updates; new paths/types are
implementation requirements, not existing capabilities. Read `apps/web/AGENTS.md`
and the installed framework documentation before applicable web changes.

Deliver the active **Studio** product: one shared map/data/selection boundary,
Batches / Map / Register, contextual quick register and full register. First prove
F0 → F1-min → V0: supplied building/floor/unit → exact evidence → scoped PACK0
artifact → reopen saved state; separately qualify D1 real roof geometry. Follow
I1 and feature/F2 gates afterwards. Do not make local V0 wait for public identity,
all ML modalities, live Sarvam, remote MCP or an authentic complete cadastral set.
Do not substitute a beautiful isolated showcase or mock APIs for integration.

Old T-number plans, the engineering backlog, dated screenshots and prototype
readmes are historical/test/reference material, not the current execution order.
`docs/engineering-plan/tools` and its required records remain CI inputs. Do not
reset their history or delete tests to make a new task appear complete. The old
orchestration pack is preserved in pinned Git history through the cleanup index.

## Preserve data, identities and existing mechanisms

Keep Next.js/TypeScript, the existing shared Three/Cesium runtime boundaries,
PostgreSQL/PostGIS, private S3-compatible originals, Redis/Celery, dispatcher and
private Python processing. Extend the recorded registry and case/import draft
services, not another property database, map or job broker. Keep compatible legacy
URLs and unique document/GIS/raster/point-cloud/ML inspection capabilities.

Preserve original bytes/hashes, source and geometry revisions, exact locators,
reference systems, quantity definitions, attribution, identities and review
history. Official supplied parcel ULPIN is distinct from system building/floor/space
IDs. A floor is not necessarily a unit; one building can span parcels and one unit
can span floors. Never fabricate ownership, official issuance, heights, floors,
control points or positive-volume conflicts. Display-only decorations/exploded
floors are not measurement/evidence authority. Unknown/withheld/conflicting is
not zero. Keep observed, planned, estimated and synthetic information explicit.

Use the DATA role's named D0–D7 runbooks. Check actual bytes before claiming a
local path or external archive exists. Preserve D0 donors and D3 Google/OSM packs.
Acquire small permitted samples, retain hashes, test independent expected outputs,
and use the stated fallback when access fails. Do not send private records to an
unapproved external model. Live provider/account/real-source qualification stays separate.

`REPO_DATA=true` selects isolated repository services; false preserves the linked
environment. Never reset populated volumes, run implicit `repo:init`/reseeding,
export a replacement committed snapshot or overwrite `.env`/credentials. Dataset
cleanup permits only the exact verified redundant copies recorded in
`docs/cleanup-review/applied-cleanup.json`, not a general data purge. Canonical
originals, upload ZIPs and manifest-bound scene assets remain protected.

## Ownership and execution

Use an isolated branch/worktree and record its base SHA. FND owns shared backend,
contracts, migrations, configuration, dependencies and API/worker wiring. UI owns
shared frontend parents, route state, caches and map/runtime integration. DATA owns
fixture/acquisition directories and independent expected cases. Feature agents
own their bounded leaves/tests; transfer ownership explicitly. Submit a narrow
patch with reproducer to a shared owner rather than writing a competing service.

Start with at most two implementation owners plus DATA; after V0 keep at most
three unfinished integration-dependent workstreams. FND may explicitly hold PACK0
initially. No recursive agent spawning, force push, unrelated reformatting,
implicit main merge, public activation, credit purchase or secret commits.

Keep local/single-operator restrictions until F2 and DEPLOY qualify every relevant
API, asset, SSR and public path. Do not globally remove local guards. Sarvam is
planned governed processing; integrity, confidentiality and residency need separate
evidence. Manual mapping and deterministic answers remain valid fallbacks.

### Current worker and runtime-provider rules

Read `docs/usp-agent-handoffs/02-lead-agent-execution.md`: Astra Max is the
hands-on lead; only GPT-6 Sol/Astra workers may be spawned with explicit,
verified model/effort settings. Spawn useful independent work within existing
ownership limits, at most two child threads initially; only the lead spawns.
Unsupported model selection means explicit serial fallback, not another family.

Read `docs/usp-agent-handoffs/20-model-gateway-and-budget-pools.md` for runtime
Sarvam integration. DEPLOY owns provider clients, shared organisation wallets,
per-key usage, exact cost reservations, account throttles and retirement memory.
Rs100 signup credit is not per key. Never revive retired keys, bypass account
limits, farm signup credits, purchase funding or expose secrets. Use fake
providers/no-AI paths until authorised account and live-call gates are met.
These runtime budgets and data permissions are separate from coding-agent usage.

## Verification and cleanup discipline

Read the task's named tests and data before editing. Use locked dependencies,
`scripts/engineering/isolation.mjs`, existing runners and the build-server guard.
Never build against another agent's live worktree. Report actual commands, exit
status, code/data hashes, saved receipts, exact expected/actual results and relevant
fresh browser captures. Separate contract, local integration, real-source, visual
and deployment results. A file named final/current or a test-plan document is not
proof. Do not print secrets or binary contents; bound command output.

This branch's cleanup removes only approved redundancies and retired reference
material after checks. Remaining runtime/CI-dependent candidates in the review
are **not** an executable deletion list. Keep donors, unique visual inputs,
working originals and regression coverage until a tested replacement exists.
