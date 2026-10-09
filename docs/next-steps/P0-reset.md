# P0 — Reset: one lead, clean instructions, a runtime that stays up

Goal: before building, every worker gets the same short instructions, the old Codex queue is closed without losing anything, and the runtime stays up.

**Updated 10 October:** the owner made Claude the lead for the whole project. The Codex desktop chats (Orchestrator, D00 integration, AI-04B, GLTF-01, ML Teacher) are retired; they have been idle since 6 October. Workers now run through the pi codex-pool (SPRINT-SELECTION §3).

---

## P0.1 ⭐ Retire the old queue and preserve its work

**Gate:** hygiene · **Depends:** none · **Owner:** lead (sprint S0.1)

```text
1. Preserve every uncommitted change before anything else, each on its own branch, never integrated:
   - desktop-plan-extraction worktree: the RF-DETR launcher bridge fix (2 files) -> wip/rfdetr-bridge-fix-20261006;
   - 56f9 (fragment rank), b3eb (CityJSON), backend-review (native PDF/archive) -> wip/<name>-20261010;
   - the teacher's failure record cf85c491 already sits on task/d07-native-cpu-empty-loss-20261006: keep.
   Don't delete worktrees, branches or E:/BhuAayam-data task folders.
2. In docs/orchestration/WORK_ITEMS.md add one dated top paragraph: queue retired on 10 October; Claude leads;
   current plan is docs/next-steps/SPRINT-SELECTION.md; the RF-DETR container-harness chain and the
   fragment-support lane are closed (history kept); D04–D08 code on staging is the base.
3. Same 3-line note at the top of docs/orchestration/ML_DISTILL_01.md and NESTJS_MIGRATION.md.
```

**Expect back:** the list of preservation branches and three short notes. No deletions.

---

## P0.2 ⭐ One short instruction set

**Gate:** hygiene · **Depends:** P0.1 · **Owner:** lead (sprint S0.2)

```text
1. Move every dated model/effort/speed/worker/orchestrator paragraph from AGENTS.md unchanged into
   docs/orchestration/AGENT_SETTINGS_HISTORY.md, oldest first.
2. Rewrite AGENTS.md to about one page:
   - product one-liner;
   - precedence: release-plan.json > H00 > docs/next-steps/00-STANDARDS.md > feature handoff > older docs;
   - roles: Claude leads all lanes; workers through the pi codex-pool (gpt-6.1-sol, high/xhigh);
     spawn -> stop -> review on return -> integrate -> next; one writer per seam; one GPU owner;
     one runtime/DB owner;
   - data rules: the substance of "Sources, records and selective cleanup";
   - permission/safety boundaries; no push to main or deploy;
   - provider rules:
     - Sarvam is the runtime teacher, one configured key, no rotation across accounts to stretch free credits;
     - learning from Claude's/Sarvam's outputs is allowed for our non-competing mapping learner
       (owner decision, 10 October), with outputs recorded as pseudo_label;
     - private data never goes to an external provider;
   - the failure-recovery workflow (keep it);
   - links to docs/next-steps and docs/STATUS.md.
3. Fix contradictions:
   - release-plan.json deliveryPolicy.execution: speed/tier "default/standard";
   - H00/H22/H23 Cesium statements -> the Studio uses Three.js + 3d-tiles-renderer (apps/studio,
     packages/scene); apps/web is frozen legacy;
   - H21/H23 Sarvam-training restriction -> superseded by the owner decision above (keep the old text in
     history).
4. Bring docs/next-steps/*, PROJECT_DEEP_DIVE_ACTION_PLAN.md, ML_REVIEW_RECOMMENDATIONS.md and docs/STATUS.md
   from branch claude/magical-bardeen-31bi7c into staging as a docs-only commit (no code from that branch).
5. Run tools/validate_handoffs.py if present; fix only links you broke.
```

**Expect back:** a one-page AGENTS.md, the history file, the fixed release-plan fields, and the next-steps docs on `staging`. List any rule you moved or merged.

---

## P0.3 ⭐ A runtime that stays up

**Gate:** GF-BACKEND · **Depends:** none · **Owner:** runtime worker R1 (sole runtime/DB owner until it hands over)

```text
The local stack (PostgreSQL/PostGIS, object storage, Redis, Celery workers, API, dispatcher) runs on Docker
Desktop on Windows and has repeatedly failed (stale sailor-ingest.sock, engine restarts, "desktop-linux" pipe
missing); on 6 October the engine was down again. Make it boring.

1. Read compose.yaml, package.json scripts platform:start/health/stop, scripts/platform-*.sh, docs/DESKTOP_SETUP.md,
   docs/OFFICER_STARTUP.md, and the D07-DOCKER-AVAILABILITY / RUN-RECOVER-01 entries in
   docs/orchestration/WORK_ITEMS.md and NESTJS_MIGRATION.md.
2. Start Docker Desktop and the stack WITHOUT resets: named volumes untouched, no reseed, no `down -v`, no
   prune. Record what failed and why (logs, not guesses).
3. Write scripts/platform/doctor (one command): engine, socket, containers, DB migrations applied, object store,
   worker heartbeat, API /health; one fix hint per failure.
4. Make start idempotent and restart-safe (healthchecks, restart policies).
5. If the failures point at Windows Defender or another security setting, STOP and report the exact
   exclusion the owner should add: changing security settings is the owner's action.
6. Write docs/RUNTIME.md (≤1 page): start, stop, doctor, where data lives, what never to delete.
Never reset populated volumes, delete originals or overwrite .env.
```

**Expect back:** `doctor` output from a cold start and a warm restart, both green; RUNTIME.md; the root cause of the earlier failures, or the owner action needed.

---

## P0.4 Status board

**Gate:** hygiene · **Owner:** lead

[docs/STATUS.md](../STATUS.md) exists (6 October). The lead updates it after every integration:
- gate states;
- area lines (works / partial / missing);
- the active workers with their branches;
- the next dispatch.

Ledger entries use the 00-STANDARDS §9 format.
