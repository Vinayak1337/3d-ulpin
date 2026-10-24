# REH8 - dress rehearsal on `ulpin-reh-02`: NYC data, then a sealed unseen set, through the Studio to a card

**You are the runtime owner for this task, and the only one.** No other worker starts, stops, builds or switches a
runtime while you run, and no GPU training runs (it would skew frame and request times).

**Worktree for your commits:** `<worktree>`. First: `git -C <worktree> status --short` (clean, or stop), then there
`git switch -c task/reh8-dress-rehearsal 7a6fded0` (staging `7a6fded0`; say it; if the lead names a later reviewed
commit, use that one and say so). Gate GF5 (rehearsal), GF4 (card), GF1.

Read first: `AGENTS.md` ("Data rules"); `docs/next-steps/SPRINT-SELECTION.md` §1 (what the judges see);
`docs/next-steps/INGESTION-ARCHITECTURE.md` §0 and §13 (the automatic run to a card, one officer confirmation);
`docs/backend/DEMO-RUNTIME.md` "A rehearsal runtime" (the gateway is written disabled there); the REH6 and REH7
evidence (`docs/evidence/runtime/reh6/`, `reh7/`) and their scripts (reuse `steps.mjs`, `map-wait.mjs`, `stop.mjs`);
`docs/evidence/gf5/dq1/sealed-manifest.json` (paths, bytes and hashes only; do not open the files before Act 2).

## Why
The demo is a live intake on a clean Studio: our own data (NYC), then the judges' unknown files, any size, to a
property card with one officer confirmation, without a code change and without the page freezing. No run has gone the
whole way through the Studio yet. This one does, as the presenter would, and writes down everything that breaks.

## Hard rules (each is a stop rule: if a step cannot be done inside them, stop, record it, go to the next step)
- **The demo is not touched.** No command without `--runtime ulpin-reh-02` except the demo's read-only doctor from
  `E:/Projects/ulpin-wt/demo`. No request to `127.0.0.1:3194` other than `GET /api/v1/health`. Demo doctor before
  the first command and after the last; if they differ in commit or process ids, stop everything and report.
  **`ulpin-reh-01` is not touched.**
- **Never open, print, copy or edit any file under `E:/BhuAayam-data/runtime/**`.** Never read any `.env`, `.envvv`
  or keys file. No secret value in Git, evidence, logs, screenshots or your report.
- **Only the Studio's own screens and the product's routes.** No `psql`, no SQL, no `docker exec`, no direct API
  write. Reads for evidence may use product routes. `docker ps` and `docker stats --no-stream` are allowed; nothing
  that builds, removes, prunes, tags, pushes or pulls. Never `down`, never `--create`.
- **The officer:** you act as the presenter on this rehearsal runtime only. You may answer the Studio's questions
  and give the one confirmation the screen asks for, and each such action is recorded (step, screen words, what was
  chosen). Never answer with a value the files do not hold: if a question needs a fact the files lack (a CRS, a
  unit), answer "not stated" where the screen offers it, otherwise stop that file and record the question.
- **Nothing is invented, nothing removed.** A refusal is the result: record screen words, route, status and code.
- **No provider call, no key, no GPU.** The gateway stays disabled; `keys` and `enable` are never run. Where the
  Studio offers the teacher, record what it says in manual mode.
- Never open any `heldout`, `holdout`, `evaluator`, `provisional` or `acquisitions` folder. Never push. Never edit
  product code, `scripts/platform/**` or `services/**`: a defect is reported with file and line. Only the Playwright
  Chromium already in `%LOCALAPPDATA%/ms-playwright`; if it does not start, stop and report (this task needs it).
- If Docker Desktop is not running, start it once; if it shows Reset to factory defaults, **never click Reset**.

## Part A - the runtime (commit `docs(runtime): REH8 the rehearsal ready at <sha>`)
`before.json`: demo doctor, `docker ps` by name. Roll `ulpin-reh-02` to the commit as REH7 did (check the
`services/ database/ scripts/platform/ pnpm-lock.yaml` diff from the current checkout is empty, or stop); start; its
doctor (28 PASS, 0 FAIL). The area Niagara from earlier rehearsals stays; work in **new cases** only, and say in the
report that the runtime was not empty (a fresh `ulpin-reh-03` is a lead decision, not yours).

## Part B - the run, in the Studio (one commit per act: `docs(runtime): REH8 act <n> ...`)
Studio dev server from the rehearsal checkout (`ULPIN_API_TARGET=http://127.0.0.1:21026`, `pnpm studio:dev`, port
5188). One Playwright script `dress.mjs`, 1440x900, with video recording on (Playwright's own, no download) and, on
every page, a frame recorder: `requestAnimationFrame` deltas and `PerformanceObserver` long tasks. Per act and per
file: seconds from drop to first probe words, to first drawn part, to the last part; the largest frame and the count
of frames over 100 ms while parts stream (the architecture's target: no frame over 100 ms); every question asked and
its answer; what was held or refused and the screen's words; page errors.
- **Act 1, our data:** verify path, bytes and SHA-256 first, then drop through the Studio's front door, in this
  order: `E:/BhuAayam-data/datasets/nyc-10013/nyc-10013-multimodal.zip` (14,621,643 bytes); the DA6 NYC file under
  `E:/BhuAayam-data/datasets/nyc-second-area/` (43,263,076 bytes, receipt beside it); Tower 3's
  `E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-tower3-plan1.pdf` and `...-section.pdf`; and
  `E:/BhuAayam-data/datasets/rera-storeys/RERAP2311201700019-3/bihar-magnolia-sanctioned-layout-original.pdf`.
  Then follow the Studio to a property card for one target it says is ready: the confirmation, the card preview,
  issue, and the verification link opened in a second page (record its verdict).
- **Act 2, the sealed set:** only now open `sealed-manifest.json`'s files; verify bytes and SHA-256; drop them all at
  once, as a judge would hand them over. Same records as Act 1, then a card for one target if any becomes ready.
  If DQ1 kept no file, use the DA1 files not yet rehearsed (Halifax GeoJSON, Tweed GeoPackage, Shapefile ZIP and KMZ)
  and label the act "team-chosen, not unseen".
- Stop the dev server.

## At the end, whatever part you reached
- `pnpm platform:stop --profile demo --runtime ulpin-reh-02`; `docker ps` by name; the demo's doctor. **The
  rehearsal is left stopped, everything kept.**
- `docs/evidence/runtime/reh8/result.json`: per act and file, the timings, frame figures and outcome
  (`card | ready_not_carded | held | refused | broke`); `breaks`: every step where the run did not do what §13 of the
  architecture says, as `{ act, file, step, screen, route, status, code, expected, evidence }`; `needsCode` (file
  and line) kept separate; `officerActions`: every answer and confirmation given. `report.md`, 80 lines at most;
  screenshots of each stage and the video path under `E:/BhuAayam-data/task-data/reh8/` (not in Git).

## Stop rule and success
- **Success:** both acts run to a card or to a recorded break, with timings and frame figures for every file.
- **Stop:** the same step failing twice (record it and go to the next file); the demo doctor changing.

## You own
`docs/evidence/runtime/reh8/**` (new) in your worktree; the serving checkout `E:/Projects/ulpin-wt/ulpin-reh-02`
(checkout and install only); `E:/BhuAayam-data/task-data/reh8/**` for scratch and video.

## Checks
`git diff --check`; lines of 120 characters or fewer in files you write (PNGs excepted); each PNG under 1 MB; no video
in Git; a scan of every text file under `docs/evidence/runtime/reh8/` for a 64-hex or longer run that is not a
recorded SHA-256 or an image id, for the text of any `*_PASSWORD`, `*_SECRET*`, `*_TOKEN` or `DATABASE_URL` value, and
for `postgresql://`: none.

## Git (owner's rules, binding)
Commit on `task/reh8-dress-rehearsal` only; never push; never touch `staging` or `main`. Author and committer are the
owner's configured identity. No attribution of any kind: no Co-Authored-By line, no "generated with" line, and no
commit message or evidence line that names an AI model, tool, provider or worker as the one who did the work. If time
runs short, commit `wip(...)` with one line on what is missing, the same line in
`docs/evidence/runtime/reh8/CHECKPOINT.md`.

## Final answer
```
TASK   REH8 - dress rehearsal: NYC, then the sealed set, to a property card      GATE GF5
WORKS  <one line per act: files, outcome, card or not>
BRANCH <branch name and head sha>
BREAKS <count, and the three that would hurt most on stage>
COMMITS <short sha + subject, one per line>
CHECKS <each command with its exit code; demo doctor before/after; rehearsal doctor; worst frame>
NEXT   <needsCode with file:line; anything needing the lead or the owner>
```
Time box: 120 minutes. Act 1 with the demo proven untouched comes first.
