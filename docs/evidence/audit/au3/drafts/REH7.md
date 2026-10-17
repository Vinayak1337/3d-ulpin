# REH7 - where the slow window pages go: `ulpin-reh-02` at staging `7a6fded0`, timed through the product's routes

**You are the runtime owner for this task, and the only one.** No other worker starts, stops, builds or switches a
runtime while you run. No GPU training may run while you measure (it pins the performance cores; see Hard rules).

**Worktree for your commits:** `<worktree>`. First: `git -C <worktree> status --short` (clean, or stop), then there
`git switch -c task/reh7-window-timing 7a6fded0` (staging `7a6fded0`; say it). Gate GF5 (rehearsal), GF1.

Read first: `AGENTS.md` ("Data rules"); `docs/backend/DEMO-RUNTIME.md` sections "Roll-out (no fetch)" and "A rehearsal
runtime"; `docs/evidence/runtime/reh6/result.json`, `report.md`, `part-b-map-wait.json` and its scripts (reuse
`map-wait.mjs`, `steps.mjs`, `stop.mjs`; REH5's `window.mjs`); the read you are timing:
`packages/server/src/modules/areas/area-display-window.ts` (`boundedRead`, `chosenProposals`),
`packages/server/src/modules/areas/area-display-proposals.ts` (`areaProposals`),
`packages/server/src/infrastructure/db.ts` (the pool, `max: 8`), `apps/studio/src/features/map/areaWindow.ts` (how
the Studio pages and abandons reads).

## Why
REH6 drew Niagara's 41,809 proposals, but two window pages took 31.2 s and 34.8 s against 1.7 to 2.6 s for the
others (`part-b-map-wait.json` stages 4 and 5; both are `after` cursor pages). The cause is unknown. The read sets a
15 s statement timeout (`area-display-window.ts:61`), so no single statement can take 31 s: the time sits elsewhere.
The judges will watch this map. Find where the seconds go before anyone changes code.

**Hypotheses to separate (each gets a measurement, none is assumed):**
- H1 browser or dev-proxy queueing: the request waits in Chromium or the Vite proxy before it reaches the API.
- H2 pool wait: superseded or abandoned reads still hold the 8 pooled connections, and the next read queues.
- H3 API CPU: every read loads the area's packages and re-chooses its proposals (`chosenProposals`) in Node; a GC or
  event-loop stall on that work delays the response.
- H4 cold reads: the first touch of a page's rows after a quiet spell is slow in the database.

## Hard rules (each is a stop rule: if a step cannot be done inside them, stop, record it, go to the next part)
- **The demo is not touched.** No command without `--runtime ulpin-reh-02` except the demo's read-only doctor from
  `E:/Projects/ulpin-wt/demo` (`pnpm platform:doctor --profile demo`). No request to `127.0.0.1:3194` other than
  `GET /api/v1/health`. Demo doctor before the first command and after the last; if they differ in commit or process
  ids, stop everything and report. **`ulpin-reh-01` is not touched.**
- **Never open, print, copy or edit any file under `E:/BhuAayam-data/runtime/**`** (the API log is there: do not
  read it). Never read any `.env`, `.envvv` or keys file. No secret value in Git, evidence, logs or your report.
- **No SQL of your own:** no `psql`, no `EXPLAIN`, no `docker exec`. Every number comes from the product's routes,
  the browser's own request timing, and process reads: `Get-Process` for the API's native process, and
  `docker stats --no-stream` for the rehearsal's Postgres container. `docker ps`, `docker image inspect` and
  `docker volume ls` are allowed; nothing that builds, removes, prunes, tags, pushes or pulls. Never `down`, never
  `--create`.
- **Nothing is removed, nothing is written to the area.** Reads only; no import, no decision.
- **No provider call, no key, no GPU.** Before Part B run `nvidia-smi --query-compute-apps=pid,name --format=csv`;
  if a training process is listed, stop and report (its core pinning would skew every timing).
- Never open any `heldout`, `holdout`, `evaluator`, `provisional` or `acquisitions` folder. Never push. Never edit
  `scripts/platform/**`, `services/**` or product code: a defect is reported with file and line. Only the Playwright
  Chromium already in `%LOCALAPPDATA%/ms-playwright`; if it does not start, skip Part C and say so.
- If Docker Desktop is not running, start it once; if it shows Reset to factory defaults, **never click Reset**.

## Part A - roll to `7a6fded0` (commit `docs(runtime): REH7 the rehearsal rolled to 7a6fded0`)
1. Confirm `git diff --name-only 2ddefbbb 7a6fded0 -- services/ database/ scripts/platform/ pnpm-lock.yaml` is
   empty (it was at audit time); if not, stop and report. `before.json`: demo doctor; `docker ps` by name.
2. `git -C E:/Projects/ulpin-wt/ulpin-reh-02 checkout --detach 7a6fded0`; `pnpm install --frozen-lockfile` there;
   `HEAD:services/geo` equals the pin's `servicesTree`. `processor-image.mjs roll` (expect nothing recreated);
   `pnpm platform:start --profile demo --runtime ulpin-reh-02`; its doctor (require 28 PASS, 0 FAIL). Record the
   API's native process id from the doctor output for Part B.

## Part B - direct timings, no browser (commit `docs(runtime): REH7 window timings by route`)
Area `a1c1252a-949f-42a7-a879-5ad2aaa7cc46`, API `http://127.0.0.1:21026`. One script `timing.mjs` (Node `fetch`,
`performance.now()`), writing `part-b-timing.json`. The two REH6 windows exactly: W4 = 6583 x 6733 m at centre
[4737, 12151] (four pages) and W5 = 3145 x 3217 m at centre [5715, 11151] (two pages); compute bounds as REH6's map
script did. Per request: status, seconds to headers, seconds to last byte, bytes, features, `next`.
Sample every 250 ms throughout: API process CPU seconds and working set (`Get-Process -Id <pid>`), and Postgres
container CPU% (`docker stats --no-stream`), in `part-b-samples.json`.
1. **Cold:** the first W4 page 1 after start, then W4 pages 1-4 and W5 pages 1-2 in order. (H4)
2. **Warm, sequential:** the same six pages, five rounds. Also `display-summary` and a 50 m window at the centre,
   five each: their time is the per-read floor (the packages load and proposal choice without rows). (H3, H4)
3. **Concurrent:** 1, 2, 4, 8 and 12 copies of W4 page 2 started together, three rounds each. Look for times that
   step up past 8 copies (pool, H2) or rise with API CPU (H3).
4. **Abandoned:** start 6 W4 page reads, abort them client-side after 0.5 s (as a view change does), then at once
   read W5 page 2 alone; five rounds. A late answer after abandoned reads points to H2 or H3.

## Part C - the Studio as REH6 ran it (commit `docs(runtime): REH7 window timings in the Studio`)
Studio dev server from the rehearsal checkout (`ULPIN_API_TARGET=http://127.0.0.1:21026`, `pnpm studio:dev`, port
5188), REH6's `map-wait.mjs` adapted, 1440x900, two runs. For every `display-window` request record the browser's
own timing (Playwright `request.timing()`: queued/stalled, sent, waiting for the first byte, download) and whether
the page aborted it. A slow request whose time is in queueing is H1; in waiting for the first byte it is the
server (match it against Part B). Keep the same 250 ms process samples. Stop the dev server.

## At the end, whatever part you reached
- `pnpm platform:stop --profile demo --runtime ulpin-reh-02`; `docker ps` by name; the demo's doctor. **The
  rehearsal is left stopped, at `7a6fded0`, everything kept.**
- `docs/evidence/runtime/reh7/result.json`: for every request over 10 s, its seconds split into the named parts;
  for each hypothesis H1-H4, `supported | not supported | not tested`, with the measurement that decides it;
  `needsCode` (file and line) kept separate from findings; restart commands. `report.md`, 60 lines at most.

## Stop rule and success
- **Success:** at least one page over 10 s reproduced, and 80% or more of its seconds attributed to one named part
  (browser queue, pool wait, API CPU, database), or every page under 3 s across Parts B and C (then "not reproduced",
  with the conditions tried).
- **Stop:** the same runner failing twice; a page answering anything but 200 twice in a row (record route, status,
  code, words); the demo doctor changing.

## You own
`docs/evidence/runtime/reh7/**` (new) in your worktree; the serving checkout `E:/Projects/ulpin-wt/ulpin-reh-02`
(checkout and install only); `E:/BhuAayam-data/task-data/reh7/**` for scratch.

## Checks
`git diff --check`; lines of 120 characters or fewer in files you write (PNGs excepted); each PNG under 1 MB; a scan of
every text file under `docs/evidence/runtime/reh7/` for a 64-hex or longer run that is not a recorded SHA-256 or an
image id, for the text of any `*_PASSWORD`, `*_SECRET*`, `*_TOKEN` or `DATABASE_URL` value, and for
`postgresql://`: none.

## Git (owner's rules, binding)
Commit on `task/reh7-window-timing` only; never push; never touch `staging` or `main`. Author and committer are the
owner's configured identity. No attribution of any kind: no Co-Authored-By line, no "generated with" line, and no
commit message or evidence line that names an AI model, tool, provider or worker as the one who did the work. If time
runs short, commit `wip(...)` with one line on what is missing, the same line in
`docs/evidence/runtime/reh7/CHECKPOINT.md`.

## Final answer
```
TASK   REH7 - window page timings on ulpin-reh-02 at 7a6fded0                     GATE GF5
WORKS  <one line per part>
BRANCH <branch name and head sha>
CAUSE  <the slow page's seconds by part; H1-H4 verdicts>
COMMITS <short sha + subject, one per line>
CHECKS <each command with its exit code; demo doctor before/after; rehearsal doctor>
NEXT   <needsCode with file:line; anything needing the lead or the owner>
```
Time box: 90 minutes. Parts A and B with the demo proven untouched come first.
