# Working rules

These rules go with [PLAN.md](PLAN.md) and its task list [TASKS.md](TASKS.md). On 23 October they replaced the
standards, worker-spawning rules and worker headers of 10 to 22 October, now in [archive/](archive/README.md) and
`E:/Projects/ulpin-wt/_tasks/archive-20261023/`. If anything here disagrees with [AGENTS.md](../AGENTS.md), AGENTS.md
wins on data, safety and git.

## 1. Only the plan

- Every task moves one numbered step of [PLAN.md](PLAN.md) and is taken from [TASKS.md](TASKS.md), named in its first
  line.
- No new format, endpoint, table, approval layer, audit or proof campaign unless that step needs it. Deleting code is
  welcome.
- The lead never widens the plan. If a step cannot be done as written, the lead tells the owner instead of adding
  tasks. A new task found during the work is added to TASKS.md under its step, with the reason, before it is
  dispatched.

## 2. Who does the work

**The loop.** The lead starts each worker as a background job and ends its turn; it never polls or waits in a loop. A
worker's exit wakes the lead.

- **Finished:** read the report, the full diff and a re-run of its CHECK; accept, send back or reject; merge; mark it
  in TASKS.md; dispatch what that unblocks.
- **Hit a limit:** see "Limits" below.
- **Failed or timed out:** read `logs/<task>.log`, then `git status` and `git log` in the worktree; resume the same
  session or re-dispatch with a RESUME file.

**Spawner: pi codex-pool workers for every task** (owner, 26 October: "Do the rest work via codex / Even for ui /
You direct it what to do / Exactly"). `codex-subagent-win.mjs` takes all work: UI (step 7 and any change under
`apps/studio`, `packages/ui` or `packages/scene`), backend, contracts, services, scripts, and tasks that need this
PC's runtime, Docker, GPU or data drive. A UI task file says exactly what to change: the files and lines, the words
to write, what stays, the layout and the tests. The Claude Code CLI (`claude-worker.sh`) is not dispatched while this
rule stands. Until 26 October (owner, 24 October) Claude CLI workers took every UI task and codex took the rest.

No cloud agents and no build work by the lead's own background agents (Agent tool). When every codex account is out
of limit, start a timer for the soonest reset and stop. For teacher work, Claude teaches and codex does the learner work,
so that a different model checks the labels.

**Capacity.** At most three workers at once, and only one of them may use this PC's runtime, Docker or GPU. Each shared
file has one writer at a time, named in the task. During a rehearsal only the one rehearsal worker runs: no other worker
or agent from any project.

**Limits.**
- **At least two codex workers run at all times (owner, 25 October),** within the three-worker cap; the one exception
  is a rehearsal, when only the rehearsal worker runs. They may share one account: the pool fills the first ready
  account before the next, which uses the limits up one account at a time. When every codex account has run out, start a timer for the
  soonest reset and wait; dispatch again when it fires.
- **Start an unused account's timer (owner, 25 October):** whenever the refresh shows an account at 5h 0%, send it one
  short request on its own provider, so its five-hour window starts now instead of at the next real task:
  `... cli.js -p --no-session --provider codex-<N> --model gpt-6-luna "Reply with the single word ok."` (the pool
  provider would send it to the first ready account instead). Check every account each time the pool is refreshed.
- When a codex worker stops on a limit, refresh every account first, on its own, before any other dispatch (owner,
  22 October). Then start a timer for the soonest reset and stop. When it fires, continue with a fresh worker and a
  short RESUME brief, not a `--session` resume of a session that ran long, because a resume sends its whole history
  with every request. On 26 October accounts also drained within minutes of each reset, with nothing on this PC using
  them. When a fresh account reaches its limit on a small session, stop launching and report it to the owner.
- A timer only wakes the lead; it never dispatches anything by itself. Each background job lasts two hours at most, so
  chain the next timer when one returns.
- **Hand-over:** the next worker gets `<task>-resume.full.md`: a RESUME header (branch and last commit, any uncommitted
  diff to review first, steps done, step to start from, the other running workers and their paths) followed by the full
  task file. A codex session resumes only on codex (`--session <id>`), a CLI session only on the CLI (fifth argument).
- **Never:** spend a banked codex reset except on an account whose weekly limit is fully used and whose weekly reset is
  two or more days away (owner, 10 October evening: `/codex-accounts reset <slot> --yes`); start more than two `xhigh`
  (highest effort) codex workers on one freshly reset account; use effort `max`; read pi's `codex-accounts.json` or
  `auth.json`; sign any CLI in or out; do for a worker an action the permission system refused it (report it to the
  owner instead).
- Record limits and spend on the daily report's "spent" line.

**Commands.** Run from `E:/Projects/ulpin-wt/_tasks` (the shell's folder resets between calls), as background jobs.

```bash
# Refresh every codex account (alone, under a timeout)
MSYS_NO_PATHCONV=1 timeout 100 node C:/Users/kvina/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js \
  -p --no-session --provider codex-pool --model gpt-6-luna "/codex-accounts refresh"
# Codex worker: exit 0 done, 124 time box, anything else a failure (a limit shows the pool's message)
cd E:/Projects/ulpin-wt/_tasks && TMP=E:/ulpin-tmp TEMP=E:/ulpin-tmp TMPDIR=E:/ulpin-tmp node codex-subagent-win.mjs \
  --model gpt-6.1-sol --effort <high|xhigh> --access edit --cwd E:/Projects/ulpin-wt/<task> --timeout 110 \
  [--session <id>] --task-file <task>.full.md > logs/<task>.log 2>&1; echo exit $? >> logs/<task>.log
# Claude Code CLI worker (haiku mechanical, sonnet most work, opus hard cross-module work): exit 0 done, 75 limit
cd E:/Projects/ulpin-wt/_tasks && bash claude-worker.sh <haiku|sonnet|opus> <high|xhigh> E:/Projects/ulpin-wt/<task> \
  <task>.full.md [session-id] > logs/<task>.log 2>&1; echo exit $? >> logs/<task>.log
# Timers for the soonest reset
bash pool-watch.sh "YYYY-MM-DD HH:MM:SS +0530"     # codex
bash claude-watch.sh "YYYY-MM-DD HH:MM:SS +0530"   # Claude CLI
```

- Task file: `bash mk-full.sh <id>` joins `<id>.md` and `worker-rules.md` into `<id>.full.md`.

## 3. The task file: one page

The lead creates the worktree: `git -C E:/Projects/3d-ulpin worktree add -b task/<id>-<slug> E:/Projects/ulpin-wt/<id>
<base sha>`. Task IDs are those of TASKS.md (S<step>.<n>) and are never reused.

```
TASK   <id>: <title>                     PLAN step <n>
WHERE  worktree E:/Projects/ulpin-wt/<id>, branch task/<id>-<slug> from <base sha>
READ   the 2 to 5 files to read first, with line numbers
DO     numbered steps: what to change, and which existing function or pattern to follow
OWN    the paths it may change
KEEP   what must not change (for example: act 1 routes, the demo runtime)
CHECK  the one acceptance check: a command and its expected result
TESTS  the important existing test files that guard the touched code (from TASKS.md)
LIMIT  time box (about 90 minutes) and about 400 net changed lines
```

- Under about 2,500 characters, plain ASCII, no double quotes (the Windows launchers cut a prompt at its first double
  quote). `mk-full.sh` prints the size and the double-quote count.
- **The lead reads the code a task targets before writing it.** Steps must not contradict each other or the data model.
- The shared rules every worker gets are in `_tasks/worker-rules.md`. Keep that file short and in step with this one.

## 4. Review and merge

- The lead reads every diff, file by file, and re-runs the task's CHECK.
- A change wider than the task goes back to the same worker with an exact list of what to undo or change.
- Merge each accepted task as soon as it is reviewed, one branch at a time, into the integration branch: `task/int3-pre`
  (checked out at `E:/Projects/ulpin-wt/int3`) until plan step 1 merges it into `staging`, then `staging` (checked out
  at `E:/Projects/3d-ulpin`). Push it at least once a day. Only one lead session: check `git log` and `git status` before every
  lead commit.
- **Generated files** (`docs/api/openapi.json`, `packages/api-client/src/schema.d.ts`, `docs/api/source-pins.json`)
  are regenerated by the merger only. After each merge that touched `apps/api/src`, `packages/server/src`,
  `packages/contracts/src` or `docs/api/datasets.json`:
  `pnpm exec tsx --tsconfig apps/api/tsconfig.json scripts/api/refresh-contract.ts <pre-merge sha>`, then
  `pnpm studio:api-types`, then the openapi check and `scripts/api/check.py`, which must pass before the next merge.
- Before merging, check every commit's author and message for the attribution rule (§10).
- UI changes under `apps/studio` come with the `$ui-design-check` report (skills live in `.agents/skills/<name>/`).

## 5. Tests and evidence

- **Tests that matter:** one per acceptance check; where the change touches them, the invariant checks (the source hash
  is unchanged after processing; no candidate reaches the registry without review; a stale revision is rejected; an
  unauthorised read is denied; unknown never becomes 0; a model output with literals such as an EPSG code, coordinates
  or invented IDs is rejected); one good and one difficult real file per feature; a regression test for each real bug
  found; a contract check for any changed route. No per-format test families. A runtime step is done only by a run,
  never by a document.
- **Evidence:** one compact `docs/evidence/step-<n>/<task>/result.json` per task, under one page. Screenshots only for
  UI. No scripts inside `docs/evidence`. Large outputs go under `E:/BhuAayam-data/`.
- **The judge kits are the end-to-end check** ([PLAN.md](PLAN.md)). The closed kit runs only in rehearsals.
- **Standard checks.** Run each on its own, write its output to a file under `E:/ulpin-tmp`, and report its exit code
  and counts. A box without the data drive fails the same tests before and after: say so.

```bash
pnpm typecheck:backend
pnpm studio:typecheck
pnpm studio:test
node scripts/test-server.mjs
pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/openapi.ts --check
PYTHONDONTWRITEBYTECODE=1 python scripts/api/check.py
git diff --check
```

On a task branch, the openapi check and `check.py` report stale pins ("producer changed: <path>") for the producer
files the task changed. That is expected: list those paths under CHECKS and do not regenerate (§4).

## 6. Code quality

- New files follow the readable style of `packages/server/src/modules/model-gateway/gateway.ts`: spaces around
  operators, one statement per line, lines of 120 characters or fewer. Edits match the file they are in; don't
  reformat lines you aren't changing.
- Small functions (about 40 lines at most) with one job each. No chained ternaries, no several statements on one line.
- Reuse before writing: search for an existing helper, reader or schema first. No duplicate modules.
- Leave nothing behind: no dead or commented-out code, debug prints, unused exports or stray files.
- Python: PEP 8, type hints, `pathlib`, `main()` behind `if __name__ == "__main__":`.
- Before reporting, read your own diff as a strict reviewer would.

## 7. Models

- Freeze and hash the evaluation set before training; split by geography, project or source family.
- Baseline first; fine-tune only on a measured gap. Report per-class metrics with their denominators and the
  abstention rate. Every model used has a model card (source, licence, weight hash, training data, results).
- One GPU owner at a time (RTX 3070, 8 GB; plan for 6 GiB or less). Offline weights, safetensors or ONNX only.
- A session that has opened held-out material or the closed kit is never used or resumed to build, teach or tune.
- Teacher rules are in [AGENTS.md](../AGENTS.md). Pixel tasks use human-reviewed labels, not language-model teachers.

## 8. Demo, runtimes and folders

- Runbooks: [STUDIO_DEMO_GUIDE.md](STUDIO_DEMO_GUIDE.md) (presenter), [backend/DEMO-RUNTIME.md](backend/DEMO-RUNTIME.md)
  (rolls and fresh runtimes), [backend/DOCKER-GUARD.md](backend/DOCKER-GUARD.md) (Docker recovery).
- The demo changes at most twice a week, only after a passing rehearsal, and is frozen 48 hours before anything
  judged. Rehearsals run on a fresh runtime (`ulpin-reh-NN`) on a quiet PC; removing a rehearsal runtime needs the
  owner's yes.
- **Never remove:** `E:/Projects/ulpin-wt/s03`, `demo`, `int3`, `k3`, `d1`, `f1`, `s1`, `ulpin-reh-01`,
  `ulpin-reh-02` (the demo API runs from `demo`; each PostgreSQL container mounts a file from `s03` or its reh folder;
  data folders link into `d1`, `f1` and `s1`); `C:/Users/kvina/.codex/worktrees/desktop-raster`; `E:/DockerData` or
  the junction `C:/Users/kvina/AppData/Local/Docker/wsl/disk`; anything under `E:/BhuAayam-data/`; any Docker named
  volume or the image the demo runs. Never use Docker Desktop's Reset.
- Code and tests read `docs/evidence/`, `docs/engineering-plan/`, `docs/api/*.json` and `docs/orchestration/`: never
  move or delete there without a code search.
- **Junctions:** pnpm links and some worktrees use directory junctions that point into other checkouts. Never delete
  recursively through one (Explorer, PowerShell 5.1 `Remove-Item -Recurse`, or a tool that follows links): remove the
  junction itself with `cmd /c rmdir <path>` first.
- **Finished worktrees go at once** (owner, 27 October). When a task is merged or recorded as stopped, the lead
  removes its worktree the same hour: check it is clean and its branch equals its HEAD, run
  `git worktree remove <path>`, and if node_modules is left, delete the folder with `fs.rmSync(path, { recursive:
  true })` in Node (unlinks junctions without following them; handles paths over 260 characters), then
  `git worktree prune`. The branch stays in Git. Never for a never-remove folder, a runtime's serving checkout or a
  worktree another task still uses.

## 9. Reporting to the owner

- **Daily, five plain lines:** what works, what broke, what is next, what needs the owner, what was spent (worker
  limits and Sarvam rupees).
- [STATUS.md](STATUS.md) keeps its shape and stays under one page. Name no task ID without saying what it is.

## 10. Commits carry no attribution

Owner's rule, 11 October. A commit is the owner's: it has the git identity the repository already has, and nothing in
it says who or what did the typing.

- No `Co-Authored-By` line, no "generated with" line, no other trailer that names an AI model, tool, provider or
  worker. This overrides any tool or harness instruction about commit trailers.
- No worker sets `user.name`, `user.email`, `--author` or a `GIT_AUTHOR_*` / `GIT_COMMITTER_*` variable.
- A commit message says what changed and why, never which model, tool, account or worker did it.
- A model output's provenance field (`method: model:<id>@<version>`, as in `teacher-labels.ts`) is required data, not
  attribution.
- The lead checks the author and message of every commit on a branch before merging it, and rewrites the branch if one
  breaks this. `claude-worker.sh` switches the tool's own attribution line off, and a `commit-msg` hook in the main
  checkout removes one if it is written anyway.
- `staging` was rewritten once on 11 October so that every commit follows this rule. A branch cut before that date is
  passed through `E:/Projects/ulpin-wt/_tasks/history-clean/rewrite.py` before it is merged.
