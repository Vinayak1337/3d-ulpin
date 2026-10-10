# 3D ULPIN — agent entry point

3D ULPIN (BhuAayam, SIH26011) turns fragmented survey, imagery, plan and document inputs into cited, reviewed building/level/unit/space records with 3D identities: **Identify → Prove → Govern**.

Consolidated application baseline: `45d033baae7ec4e5a572d82459b0062c70a12c95`; sprint base `e95273e5`.

<!-- plan-next-gate: GF0 -->

**Read first:** [the selection sprint plan](docs/next-steps/SPRINT-SELECTION.md), [the live board](docs/STATUS.md) and [the shared standards](docs/next-steps/00-STANDARDS.md). Prompts P0–P10 in [docs/next-steps](docs/next-steps/README.md) hold task detail. The release manifest is [release-plan.json](docs/usp-agent-handoffs/release-plan.json); handoffs H00–H99 supply feature requirements, not assignments. Dated settings, queues and lane rules before 10 October are history in [AGENT_SETTINGS_HISTORY.md](docs/orchestration/AGENT_SETTINGS_HISTORY.md) and the retired `docs/orchestration/` ledgers.

## Roles (owner decision, 10 October 2026)

- **Lead: Claude (Opus 5.5)** for every lane — frontend, backend, ML and agents. The lead plans, designs models and the teacher/learner method, writes task files, reviews every return, integrates into `staging`, keeps STATUS.md current and pushes at milestones. The lead does not do build work itself.
- **Workers:** spawned by the rules in [WORKERS.md](docs/next-steps/WORKERS.md). Two bash spawners, in this order: pi codex-pool `codex-subagent` (model `gpt-6.1-sol`, effort `high` or `xhigh`, several accounts), then the Claude Code CLI on the terminal's own login (`haiku`, `sonnet` or `opus` at the effort the task needs). The lead's own subagents are the fallback when both are limited. One task per worker, in its own worktree `E:/Projects/ulpin-wt/<task>` on branch `task/<id>-<slug>` cut from `staging`. Workers touch only the paths their task file names, never push, and stop at their time box with a resumable checkpoint and the report from 00-STANDARDS §9.
- **The rule:** dispatch as background tasks, then stop; a worker wakes the lead when it finishes or hits a limit. On a finish, review it first (report, diff, its key check), then accept, fix or reject, integrate, and dispatch what that unblocks. On a limit, refresh to read the reset time, start a timer for it, and re-dispatch from the checkpoint through the next spawner. No polling or wait loops.
- **Exclusive owners:** one GPU owner (RTX 3070, 8 GB), one runtime/DB owner, one writer per shared seam — each named in the task file.
- **Teachers:** no model is the development teacher or the learner's builder by name (owner decision, 10 October evening). Teacher work and learner work each go to a provider that has limit at the time, and the model follows the provider: Claude Code CLI or a Claude desktop background task → Opus 5.5; pi codex-pool → `gpt-6.1-sol`. Either may take one role or both; the rules are in [WORKERS.md §8](docs/next-steps/WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider). Sarvam (`sarvam-105b`, through the model gateway) stays the runtime teacher inside the product. Our mapping and extraction learners may train on verified teacher outputs: on 10 October the owner removed the old H21 restriction for this use because these learners do not compete with any provider. Teacher outputs are `pseudo_label`, never evaluation truth; no teacher sees held-out families; officer corrections outrank teachers. Private or restricted documents never go to an external provider.
- **Sarvam keys:** one configured key at a time. No automatic rotation across accounts to stretch free credits (H20). When credits or the network fail, calls fail closed to replay or manual mode; switching the key is the owner's call.

## Stack

- Backend: modular NestJS in `apps/api`, domain services in `packages/server`, contracts in `packages/contracts`, published schema `docs/api/openapi.json`. TypeScript, PostgreSQL/PostGIS with visible SQL and `pg` (no Prisma), private object storage, Redis/Celery, Python processing in `services/`. Extend the one registry, job authority, model gateway and conversion contract; don't add competing services.
- Frontend: `apps/studio`, `packages/scene`, `packages/ui`, `packages/api-client` — React + Vite + TypeScript with Three.js + `3d-tiles-renderer` (no Next.js, no Cesium). Plan: [docs/frontend/GOAL.md](docs/frontend/GOAL.md) and [PLAN.md](docs/frontend/PLAN.md). `apps/web` is frozen legacy; don't add UI there or delete it. Desktop-first, light-only; keep keyboard, contrast and zoom. `design-mockup/` and [the design system](docs/design-system/README.md) are protected references — never copy their sample values. Read `apps/web/AGENTS.md` before touching `apps/web`.

## Data rules

- **Originals are immutable.** Keep issuer, original URL and bytes, acquisition date, SHA-256, licence/permission, geography and CRS. Every derivative points back to its original and a locator. Large and restricted inputs live under `E:/BhuAayam-data/`, outside Git. Consult [real-sources.md](docs/api/real-sources.md) and [datasets.json](docs/api/datasets.json) before acquiring anything; update them when acquisition changes.
- Official operational data comes from data.gov.in or the issuing authority. Public research data (RAMP, CubiCasa and similar) is allowed for development and evaluation, labelled `test_only` with its origin. A mirror or vendor prediction is not official.
- **Never invent** records, identifiers, geometry, heights, controls, documents, images, ownership, rights or expected facts. Keep `unknown | absent | null | withheld | conflicting | estimated | candidate | source_supported | reviewed` distinct; unknown never becomes 0.
- Official parcel ULPINs differ from application building/level/unit/space IDs. Buildings can span parcels; units can span floors; a floor is not a unit. Geometry and scene display don't establish ownership or issuance. Estimates and illustrative massing carry their own provenance and never affect measurement, rights, packets or learning truth.
- **Every model or agent output is a candidate.** Nothing reaches the registry without officer review. Screens show values read from records, never hard-coded samples.
- Never reset populated volumes, implicitly reseed, export a replacement snapshot, or read, overwrite or commit `.env` or credentials. Don't delete mixed bundles, unknown records, originals, uploads or review history; retire assets only by reviewed exact-path classification.
- Indian operational data follows H23/H28; foreign tests stay in their own geography.

## Failure recovery

When the same failure recurs, or a finished experiment misses its target, don't repeat the command. Locate the actual failure (logs, last good checkpoint; separate runtime faults from data, objective and integration defects), read prior attempts in the task ledger, research analogous failures and working public recipes, then run **one** bounded comparison with a stated hypothesis, baseline, success criterion and stop condition. Keep source-family splits and frozen holdouts closed to tuning. Record the failure signature, attempt, result and next decision in the existing ledger, then return to delivery. If progress needs missing data, access or an owner action, report that prerequisite and preserve the checkpoint.

## Verification and git

- Lean checks from [00-STANDARDS §8](docs/next-steps/00-STANDARDS.md#8-verification-policy-lean): contract check, touched invariants, one good and one difficult real input, a regression test only for a bug actually found. Numbers go in `docs/evidence/<gate>/<task>/result.json`. No documentation-only claim passes a runtime gate.
- Before handing off UI changes under `apps/studio`, run `$ui-design-check` and include its report. Skills live in `.agents/skills/<name>/`.
- `staging` is the integration branch. The lead pushes it at milestones using the owner's `gh` login. Never push to `main`, never force-push, never deploy or activate public services without the owner's go-ahead. Commits never contain secrets, `.env`, large originals or weights.
