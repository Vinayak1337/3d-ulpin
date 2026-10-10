# Worker spawning rules

Owner decision, 10 October 2026. This is the one place that says how the lead spawns workers, what it does when one stops, and what happens when a limit is hit. It replaces the worker lines in earlier settings. Task-file content and review rules stay in [00-STANDARDS](00-STANDARDS.md) §9 and §11 and in [SPRINT-SELECTION](SPRINT-SELECTION.md) §3.

## 1. The loop

1. **Dispatch.** The lead starts each worker as a **background task** and then ends its turn. It doesn't poll, wait in a loop or do the build work itself.
2. **Wake.** A worker wakes the lead when it stops. There are three ways it stops:
   - it **finished** (its report is the last thing in its log);
   - it **hit a limit**;
   - it **failed or timed out**.
3. **Act** on the wake, by its kind:

| The worker… | The lead… |
| --- | --- |
| finished | reviews it first (report, full diff, its key check), then accepts, fixes or rejects, integrates into `staging`, and dispatches what that unblocks |
| hit a limit | follows §4, then re-dispatches the task from its checkpoint through the next spawner |
| failed or timed out | reads the log and the worktree (`git status`, `git log`), then resumes the same session or re-dispatches with a RESUME file |

## 2. The spawners, in order

Always use the first spawner in this list that isn't limited.

| # | Spawner | Models | Limit behaviour |
| --- | --- | --- | --- |
| 1 | **pi codex-pool** (bash worker) | `gpt-6.1-sol`, effort `high` or `xhigh` | Several accounts. The pool moves to the next account when one hits its limit. The spawner is limited only when **every** account is. |
| 2 | **Claude Code CLI** (bash worker) | `haiku`, `sonnet` or `opus`, with the effort the task needs (§3) | One Claude account. Limited when the CLI prints "You've hit your … limit · resets …". |
| 3 | **The lead's own subagents** (Agent tool) | Sonnet or Opus | Fallback only, for when spawners 1 and 2 are both limited. |

- **Codex first.** While any codex account is ready, new tasks go to codex workers only.
- **One Claude limit.** On 10 October the Claude CLI and the lead's own subagents were seen to share one session limit. When spawner 2 is limited, spawner 3 is usually limited too. Then nothing can run, and the lead waits for the first timer (§4).

## 3. Choosing the Claude model and effort

| Work | Model | Effort |
| --- | --- | --- |
| Mechanical: renames, regeneration, evidence formatting, small doc edits | `haiku` | `high` or `xhigh` |
| Most build tasks: features with tests, data acquisition, diagnosis scripts, UI | `sonnet` | `high` |
| Hard backend, governance or cross-module design; work that failed once on Sonnet | `opus` | `high` or `xhigh` |

Pick the cheapest row that can do the task properly. Don't use `max`.

## 4. When a spawner hits its limit

Do these in order, as soon as the first limit is seen:

1. **Refresh, and read the reset times.**
   - **Codex:** run `/codex-accounts refresh` in pi (command in §6). Note each account's 5-hour reset and weekly state.
   - **Claude:** the reset time is in the limit message the worker printed.
2. **Start a timer** as a background task for the **soonest** reset of the limited spawner: `pool-watch.sh` for codex, `claude-watch.sh` for Claude. It wakes the lead when the limit is back. A background job lasts 2 hours at most, so for a later reset, chain a second timer when the first returns.
3. **Re-dispatch the stopped task through the next spawner** in §2, from its checkpoint (§5).
4. **If both bash spawners are limited,** the lead spawns its own subagents. They pick the work up where the bash workers left it and carry on.
5. **When a timer wakes the lead** and a bash spawner is back:
   - safely stop each of its own subagents (§5);
   - re-dispatch that work through the bash spawner that came back;
   - start the next timer if the other spawner is still limited.

**Never:**
- spend a banked codex reset unless the owner asks;
- start more than two `xhigh` codex workers on one freshly reset account (four drained one account in about 30 minutes on 10 October); stagger the rest;
- read pi's `codex-accounts.json` or `auth.json`.

## 5. Safe stop and hand-over

A task moves between spawners without losing work, because the state is in the worktree and not in the worker.

- **Safe stop of a running worker.** The lead tells it to stop. The worker then:
  1. finishes or reverts the edit in hand, so the tree builds;
  2. commits a checkpoint on its task branch;
  3. reports what is done, what remains and any command still running.

  The lead stops the worker only after that report. It never kills a worker in the middle of a write to the database, the runtime or `E:/BhuAayam-data/`.
- **A worker that died on a limit** gave no report. The lead reads its log, `git status` and `git log` in the worktree instead.
- **The RESUME file.** The next worker gets `<task>-resume.full.md`: a short RESUME header followed by the original full task file. The header says:
  - the branch and the last commit;
  - any uncommitted change, and that the worker must review that diff first, then keep it or restore it;
  - which steps are done and which step to start from;
  - which other workers are running and which paths they own.
- **Sessions don't cross spawners.** A codex session resumes only on codex (`--session <id>`), and a Claude CLI session only on the CLI (5th argument of `claude-worker.sh`). Moving to another spawner always means a new session with a RESUME file.
- **Same rules for every worker,** whichever spawner started it: one task, its own worktree and branch, owned paths only, no push, the data rules, the time box and the report block. A refused action is reported under NEXT. The lead never performs an action that the permission system refused a worker; it reports it to the owner.

## 6. Commands

All launchers live in `E:/Projects/ulpin-wt/_tasks/`. Task files are `<task>.md` + `_common.md` → `<task>.full.md`. Logs go to `logs/<task>.log`. Every launch is a background Bash job.

**Codex worker:**

```bash
node codex-subagent-win.mjs --model gpt-6.1-sol --effort xhigh --access edit \
  --cwd E:/Projects/ulpin-wt/<worktree> --timeout 110 [--session <id>] \
  --task-file <task>.full.md > logs/<task>.log 2>&1; echo "exit $?" >> logs/<task>.log
```

- The log footer names the account, the minutes and the session id.
- Exit 124 is the time box; a limit shows as a failure with the pool's limit message.

**Claude Code CLI worker:**

```bash
bash claude-worker.sh <haiku|sonnet|opus> <effort> E:/Projects/ulpin-wt/<worktree> \
  <task>.full.md [session-id] > logs/<task>.log 2>&1; echo "exit $?" >> logs/<task>.log
```

- It runs `claude -p` in the worktree with `--permission-mode auto`.
- Exit 0 is finished. **Exit 75 is the Claude limit,** with a `LIMIT claude: … resets …` line. Anything else is a failure.
- The footer gives the session id for a resume.

**Refresh the codex pool:**

```bash
MSYS_NO_PATHCONV=1 node C:/Users/kvina/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js \
  -p --no-session --provider codex-pool --model gpt-6-luna "/codex-accounts refresh"
```

**Timers:**

```bash
bash pool-watch.sh   "<YYYY-MM-DD HH:MM:SS +0530>"   # codex: waits, then refreshes the pool
bash claude-watch.sh "<YYYY-MM-DD HH:MM:SS +0530>"   # Claude: waits, then checks with one small call
```

**The lead's own subagents:** the Agent tool, `general-purpose`, `sonnet` or `opus`, in the background, with the same full task file. To stop one safely, send it the safe-stop message from §5 and wait for its report.

## 7. Commit trailers

Each worker ends its commit messages with its own line:

| Spawner | Trailer |
| --- | --- |
| codex | `Co-Authored-By: gpt-6.1-sol worker <noreply@openai.com>` |
| Claude CLI or own subagent | `Co-Authored-By: Claude <Haiku\|Sonnet\|Opus> 5.5 <noreply@anthropic.com>` |

`_common.md` carries the codex line. For a Claude worker, swap it when building the `.full.md` file.
