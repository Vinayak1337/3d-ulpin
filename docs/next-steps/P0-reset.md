# P0 — Reset: stop drift, clean instructions, stable runtime

Goal: before building anything new, make sure every agent gets the same short, consistent instructions, works against a runtime that stays up, and is aimed at gates instead of side tasks.

---

## P0.1 ⭐ Freeze breadth work and pause the ML distillation lane

**Gate:** hygiene · **Depends:** none · **Owner:** lead

```text
Read docs/next-steps/README.md and 00-STANDARDS.md, PROJECT_DEEP_DIVE_ACTION_PLAN.md and ML_REVIEW_RECOMMENDATIONS.md.

1. In docs/orchestration/ML_DISTILL_01.md and docs/evidence/usp/ml-distillation/status.md, add one dated top
   paragraph: the fragment-support lane (STUDENT-44/45 and later) is paused; history is kept; the reason is
   "task not in finale scope, data too small to measure (23 fragments, 1 dev positive)"; it resumes only under
   P10.2. Do not delete any file.
2. In docs/orchestration/NESTJS_MIGRATION.md, add a dated top paragraph: no new format readers, sufficiency
   adapters, citation/export variants or review-of-review tasks until P9.1 passes. Name the in-flight branches
   (planar and raster/point sufficiency) and say whether each is merged as is or parked.
3. Make a list of every open worker assignment (PARALLEL_* files, last 4 days). For each, write one line:
   keep (moves a gate test: name it) / park / close.

Keep each paragraph at most 6 lines, in plain English.
```

**Expect back:** three short edits plus a table of open assignments with keep/park/close. No code changes, no deleted history.

---

## P0.2 ⭐ One short, consistent instruction set

**Gate:** hygiene · **Depends:** P0.1 · **Owner:** lead

```text
AGENTS.md has grown into a stack of dated overrides (model, effort, speed) that contradict each other and the
release plan. Rewrite it so a new agent can act after reading one page.

1. Create docs/orchestration/AGENT_SETTINGS_HISTORY.md and move every dated model/effort/speed/worker-launch
   paragraph there unchanged, oldest first.
2. Rewrite AGENTS.md to at most ~120 lines: product one-liner; precedence order (release-plan.json > H00 >
   docs/next-steps/00-STANDARDS.md > feature handoff > older docs); current model/speed rule in ONE paragraph
   (the latest one, 4 October); data rules (keep the substance of "Sources, records and selective cleanup");
   permissions/safety boundaries; frontend/backend lane boundary; failure-recovery workflow (keep it, it is
   good); link to docs/next-steps.
3. Fix the contradictions:
   - docs/usp-agent-handoffs/release-plan.json → deliveryPolicy.execution: speedPreference/
     configuredServiceTier must match "default/standard";
   - H00, H22, H23 statements that Cesium is the finale runtime → the Studio uses Three.js +
     3d-tiles-renderer (apps/studio, packages/scene); apps/web is frozen legacy.
4. Run tools/validate_handoffs.py if it exists and fix only the links you broke.

Do not change any data, safety or permission rule's meaning. List every rule you moved or merged.
```

**Expect back:** AGENTS.md of about one page, a history file, the fixed release-plan fields, and a list of moved/merged rules. Validator passes.

---

## P0.3 ⭐ A runtime that stays up

**Gate:** GF-BACKEND · **Depends:** none · **Owner:** one runtime owner

```text
The local stack (PostgreSQL/PostGIS, object storage, Redis, Celery workers, API, dispatcher) runs on Docker on a
Windows desktop and has repeatedly failed (stale sailor-ingest.sock, engine restarts, "desktop-linux" pipe
missing). Recoveries became separate tasks. Make it boring.

1. Read compose.yaml, package.json scripts platform:start/health/stop, docs/DESKTOP_SETUP.md, docs/OFFICER_STARTUP.md
   and the recovery entries in docs/orchestration/NESTJS_MIGRATION.md (RUN-RECOVER-01, DOC-HTTP, 3–4 October).
2. Write scripts/platform/doctor (one command): checks engine, socket, containers, DB migrations applied,
   object store reachable, worker heartbeat, API /health, and prints one fix hint per failure.
3. Make start idempotent and restart-safe (healthchecks, restart policies, named volumes untouched, no reseed).
4. Decide with evidence: keep Docker Desktop on Windows, or move the stack into WSL2-native Docker or a small
   Linux host. Write the decision in 5 lines with the failure history that justifies it.
5. Write docs/RUNTIME.md (at most 1 page): start, stop, doctor, where the data lives, what never to delete.

Never reset populated volumes, delete originals or overwrite .env.
```

**Expect back:** `doctor` output from a cold start and from a warm restart, both green; RUNTIME.md; the runtime decision. Afterwards the API stays up across a machine reboot with one documented command.

---

## P0.4 Compact the evidence and the ledgers

**Gate:** hygiene · **Depends:** P0.2 · **Owner:** any

```text
Documentation is ~837k lines versus ~150k lines of code. Agents can't find current state. Don't delete history;
make the current state findable.

1. Create docs/STATUS.md (at most 1 page): for each gate GF0–GF5, its state, the last real receipt (link) and
   the next prompt id from docs/next-steps. For each area (backend, readers, domain AI, geometry, identity,
   card, Studio, data), one line: works / partial / missing.
2. At the top of NESTJS_MIGRATION.md, ML_DISTILL_01.md and docs/api/real-sources.md, add a 5-line "current
   state" box linking to STATUS.md. Leave the rest untouched.
3. From now on, every new ledger entry uses the 00-STANDARDS §9 report format.
```

**Expect back:** STATUS.md that a newcomer can read in two minutes, and three short boxes.
