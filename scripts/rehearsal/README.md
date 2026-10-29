# Kit-drop rehearsal

## Act 1: originals to a cited card

```bash
node scripts/rehearsal/act1.mjs --runtime ulpin-reh-17 --out E:/ulpin-tmp/s9-1h/act1-run-1
```

Use a healthy, empty rehearsal runtime; create/doctor/stop it through `docs/backend/DEMO-RUNTIME.md`.
Demo and reh-01 are refused. Output must be a new folder beneath E:/ulpin-tmp, including its canonical path.
The four public NYC `test_only` originals are those in `docs/STUDIO_DEMO_GUIDE.md` Act 1; no closed kit is read.
This driver builds Studio, uses the existing E: Chromium and a free preview port 5189, and changes no product code.
It uses the officer building/bin layout, reads the register inline in the batch (no table-page URL wait), declares
BIN, accepts exact single matches and chooses a card only from the accepted keys, paging buildings when necessary.
Each step saves start/end/seconds, exact screen/alert words and a screenshot; the first failure stops the run.
After the consistent card screen, `pnpm journey:check --case <case>` must pass all eight checks, including the quote.
The checker has a fixed demo URL: a generated GET-only preload redirects it to this runtime before opening a socket.
`journey.json` retains its legacy API label; `journey-transport-*.json` records the actual destination, also named in
`result.json`. Build/preview/journey logs and screenshots stay in scratch. The driver closes only its own preview
and browser, never stops a runtime or removes storage. Stop the rehearsal separately with the documented command.
Offline argument, output, inline-reading and GET-redirection checks: `node --test scripts/rehearsal/*.test.mjs`.
The [S9.1h receipt](../../docs/evidence/step-9/s9-1h/result.json) records a product stop before card creation
(`USP_JOB_ATTEMPTS`), not a passing Act 1; its separate postmortem journey read made no retry.

## Kit drop

Ports the S1.3 presenter/recorder, upload selectors, job timing and telemetry, plus REH16's launch/wait order.
No runtime is created, started, stopped or reset. Run only later, alone, against an already-running rehearsal.

```bash
node scripts/rehearsal/kit-drop.mjs --runtime ulpin-reh-03 --kit scripts/rehearsal/mini-kit.json \
  --out E:/ulpin-tmp/kit-drop-03 --dry-run
```

Remove `--dry-run` for the live check. `--verify-hash` additionally hashes every original; sizes are always checked.
Manifests have `entries` (or `files`) with `path`, `bytes`, `sha256`, `family`; optional `root` resolves relative paths.
Output must be a **new** folder beneath E:/ulpin-tmp. Closed/protected paths, including manifest paths, are refused.
For rehearsals only, `--closed-kit` admits the exact, real closed-kit folder when its manifest matches the committed
S2.3 seal and file count; demo, reh-01, aliases and all other protected paths remain refused.
This flag prints counts only, never kit file names; named results and screenshots stay in the scratch output folder.
Runtime NN uses API port `21006 + NN*10`; Studio builds with `pnpm studio:build`, then previews on 127.0.0.1:5189.
The port must be free. There is no dev-server fallback. Demo and protected reh-01 are refused.

Prerequisites: healthy runtime on that port, local pnpm/Playwright dependencies, Chromium already installed on E:
(`PLAYWRIGHT_BROWSERS_PATH`), and read-only `docker exec` access to that runtime's PostgreSQL for job timing.
No install, image, container lifecycle or volume command is issued. Browser profiles/temp files stay on E:.
The browser is headed, ANGLE D3D11, 1440x900. Without `--answers`, the officer answers layouts in Studio.
`--minutes` bounds observation after the single multi-file retain action (default 30, maximum 120).

Optional `--answers <file>` reads a `rehearsal-officer-answers/1` JSON document with `test_only: true` and an
`answers` list, each with `file`, `kind`, `nameField` (string or null for Not stated) and exactly one identifier
choice: nonempty `identifierField` text with no `identifierBy`, or `identifierField: null` with
`identifierBy: "position"`. The latter selects Position in the file (`/features/*/geometry`); if absent, words
explain the refusal.
Only `ulpin-reh-NN` runtimes are allowed (demo and reh-01 remain refused). The runner opens each listed kit
original's visible layout question once, selects the supplied kind and exact property paths, then uses and, if
shown, approves the layout through Studio. Missing or disabled options record `unavailable` with the option lists,
without submitting; failures keep the exact alert words. The report retains the supplied answers as rehearsal
officer provenance, per-file `answer.offeredAt`, `openedAt`, `usedAt`, `approvedAt`, `state` and `officerSeconds`.
Officer seconds are `(approvedAt ?? usedAt) - offeredAt` divided by 1000, beside the unchanged `firstPartOnMap`
observation measured from `dropAt` (the add press); no officer time is subtracted automatically.

`uploadsFinished` stays null until every selected file matches an original API intake item by exact name and bytes;
a hidden upload heading is not proof. A file enrolled after 180 seconds is still recorded and watched. Each original has `itemSeenAt` (first observed
item time) and `retained` (boolean); unseen files stay null/false. Derived members retain their existing retention
moments. `reloadsDuringRetention` lists `{ at }` for main-frame document starts during that window, not SPA navigation;
a reload never finishes uploads. Intake polling continues to the retention deadline even for a shorter observation.

`result.json` holds per-file observed retention/layout moments, exact row/card/limit words, first/final map moments,
non-overlapping batch/map frame captures (`maxMs`, `over100`, `longestTaskMs`), renderer, job queue/wall-exec/retries,
five-second health/pool samples and before/after S3.1 start/exit lines. Missing measurements stay null, not zero.
Map moments are upper bounds, **not proof every feature painted**. Final map observation requires all planned
parts and a complete package listing; otherwise null.
The map stays open after first observation; navigation splits its captures. Separate windows avoid hidden tabs;
hidden/unmeasured pages, unknown GPUs and software renderers give **no smoothness verdict**, even with zero slow frames.
Job exec is completion minus first dispatch, including retry/dependency wait.
CPU time and retry-wait seconds are unknown.
Exit files include historical lines; missing exit files do not prove zero exits.

Every successful intake poll records all kit files using the existing `batchItems` name/parent matching, even
when targets time out or a row cannot be read. Each file/member has a change-only `timeline` of
`{ at, state, placement, partsPlanned, partsDone, words }`. The same fields at file level hold its last matched
poll; `lastPollAt` advances even when nothing changes. `words` uses the answer's `words` if present, otherwise
`limitReason`, then `what`, or null (the current intake contract does not define an item `words` field).
`parts` remains the legacy `[partsDone, partsPlanned]` pair. No matching item leaves measurements null and
`itemReason: "No matching intake item observed."`; an earlier matched observation is never erased by a missing poll.

`firstPartAt` is the first poll observing `partsDone > 0`; `allPartsAt` is the first observing positive
`partsDone === partsPlanned`. `firstPartSeconds` and `allPartsSeconds` measure those moments from `dropAt` (the
Add press), or stay null without that press time. These are **intake counter observations, not proof of painting**:
reader phases may reset counters, and the first equality is retained even if more work appears later. Existing
`firstPartOnMap` and `lastPartOnMap` remain separate, unchanged browser measurements.

Rows match the exact text of the tray's File-cell name button, not a substring of the whole row. `rowMatch`
records `one`, `none` or `many` and the exact count; exact visible row text is kept separately as `rowWords`,
so row observation cannot overwrite the intake's `words`.

Derived intake items whose `archiveItemId` or `parentItemId` points to a kit original are recorded in its `members`.
Each member keeps its name, item ID and the same state, parts, layout, words and map observations as an original.
Collapsed or duplicate-name rows stay explicit missing/ambiguous measurements; their layouts are not opened.

A parent's `cellBatches` references are discovered from that same intake answer (including archive members).
Its `cells` list records each `cellKey`, `caseId`, `itemId`, name once observed, the same timeline/counters/times,
and any derived `members`. Reference state/placement alone are not treated as a child intake measurement.
Accessible child cases use the existing intake GET with the same 15-second timeout, at most once per case per
10 seconds after the previous request finishes, including failed reads. Cases are deduplicated across references,
polled sequentially, and capped at 30 unique cases for the run; no child targets, browser navigation or layout
presses are added. Null case/item references and over-cap cells stay unmeasured with `itemReason`; missing child
items and failed reads also record their reason without erasing prior observations. `lastAttemptAt` records each
attempt, and `process.polls` includes child reads and failures. Parent intake/targets frequency is unchanged;
slow child requests can lengthen a pass, never create overlapping or faster retry loops.

Map moments wait up to 15 seconds each for a canvas and the exact package ID in the canvas container's
space-separated `data-drawn-packages`, then two animation frames before recording and taking a screenshot.
No visible words are required. The attribute must come from post-render scene state, not package arrival.
Both regular and windowed area canvases publish it only from rendered building IDs. In a large area, the named
package's identifier range is read first, wrapping to the start of the window within the 15,000-feature budget;
package metadata supplies only the starting cursor, never display geometry or permission to draw.

Slow frames retain epoch `start`, `duration`, matching buffered long-animation-frame entries, `blockingDuration`
(null without an entry), and the three longest scripts (URL path only, function, invoker, duration).
`cause` is `script` when overlapping entries name scripts, otherwise `not_script` (including unavailable attribution).
`browserWide` marks opposite-page slow-frame starts within 50 ms; without scripts, cause `browser_wide` (correlation).
`cpu` is the nearest `process.cpu` sample (`at`, signed `offsetMs`, total `percent`, top five names/PIDs/CPU percents),
null when absent; Windows samples every five seconds through asynchronous read-only performance counters, not commands.
`frames.activities` records start/end intervals for screenshots, page navigation, attempted officer answers and job
queries. Each frame lists overlapping activities, including activity on the other window; `frames.causes` counts
`script`, `not_script`, `browser_wide` and `runner_activity`. The last is an additional overlap count, not causation;
`longAnimationFramesUnavailable` marks unsupported browsers. Long-task counters remain separate.

`uploadRows` captures every visible upload row every 10 seconds, independently of API polls and layout/map waits,
plus a final sample. Each sample has `at` and `rows` with the exact File-cell `file`, the row's `phase` exposed by
Studio, and full visible row `words`. This includes queued and stopped files before an intake item exists.
An absent upload table records an empty list; a failed observation records null rows and its error, never success.
`consoleErrors` records batch-page console errors and uncaught page errors with timestamps and exact words from before
the drop until observation ends. Neither observation changes the page or requires an officer press.

Batch and opened map frame counters are captured and reset every 10 seconds, independently of row/map waits.
Each capture has browser-clock `from` and `to` timestamps; navigation and finish also flush partial windows.
The smoothness rules are unchanged; an unopened map remains unmeasured.

`process.queue` adds a timestamp and counts for `queued` and `running` every 10 seconds once the
case ID is known. It uses one SELECT with the same runtime/case validation and read-only psql guard as job timing.
A failed query records null counts, never invented zeroes; nothing writes to the database.

`lock-waits.jsonl` sits beside `result.json`. An independent sampler starts immediately before `drop()` and stops
when observation finishes (including an incomplete/failed drop). Every five seconds it issues one read-only SELECT
against the runtime database's backends, keeping only `wait_event_type = Lock` waits older than five seconds.
Age uses the earliest ungranted `pg_locks.waitstart`, falling back to `pg_stat_activity.state_change` when absent.
Each `event: wait` line has database-clock `at`, waiter `pid`, `wait_event`, `xact_start`, `query_start`, `query`,
`wait_start`, `waited_s`, ungranted `locks` (type/mode, relation name/OID, advisory classid/objid/objsubid and other
lock keys), and `blockers` from `pg_blocking_pids` with PID, state, transaction/query starts, wait event and query.
Queries retain at most 300 characters; parameter markers remain markers. Email-like and 24-or-more-character hex
literals are redacted before truncation and again before saving. Bind parameters and private stderr are never read.
A missing blocker activity row (including PID 0 for a prepared transaction) keeps null fields, not an invented holder.

Only waiter/lock/blocker changes append another wait line; advancing `at`/`waited_s` alone does not. A successful
sample no longer seeing that PID/wait-start pair appends `event: no_longer_observed`, not proof of its exact end time.
Failed samples do not clear waits. There is at most one in-flight sample, with busy ticks skipped, a four-second
client timeout and PostgreSQL statement timeout; failures never stop the drop. The file is created exclusively,
even with no waits, and capped at 2,000 total lines (including disappearance lines); summaries continue after the cap.

`process.lockWaits` records `started`, completed `samples`, `failedSamples`, `skippedTicks`, saved `records`, `capped`,
`waitsOver5s` (distinct observed PID/wait-start episodes), `longestSeconds` (largest observed age, null if unmeasured),
and `blockerQueries`: each distinct redacted query and `totalBlockedSeconds`. Blocked seconds sum intervals between
adjacent successful observations of the same wait and blocker query, once per query per waiter. They exclude the
unknown interval before first sighting, after last sighting and across failed samples; simultaneous waiters add.
These are sampled lower bounds, not exact transaction durations. No waits/zero seconds with failed samples does not
prove absence of contention. A file-open failure records `started: false` and a failure without stopping the drop.

Each watch pass reads the case intake and targets with a 15-second limit; the health sample keeps its 4.5 seconds.
Every read is kept in `process.polls` as wall time `at`, monotonic `startMono`, `path` and elapsed `ms`.
A read that fails or times out adds the error `name` and skips its dependent work; intake observations already
captured survive a failed targets read. The runner waits a second after each pass and reads again,
so a slow intake is a measurement, not the end of the run. An error thrown while observing a file's row or answering
its layout is kept on that file in
`watchErrors` (`at`, `name`, the first 300 characters of the message, and `count` and `lastAt` when the same error
repeats); the runner moves on to the next file.

Job/queue queries are asynchronous, with the same read-only guard and 30-second timeout. `process.runnerLoop`
records each capture window's maximum and p99 event-loop delay in ms (`monitorEventLoopDelay`, 20 ms resolution),
plus monotonic intervals located by a 20 ms heartbeat when the loop stalls over one second. Polls and health samples
carry wall time `at` and `performance.now()`-based `startMono`; overlapping intervals set `runnerBlocked: true`.
`process.slowReads` counts reads over 1000 ms separately with and without that mark, for polls and health. The mark
warns of runner interference, not server latency or proof of causation; missing histogram measurements stay null.

The opt-in S3.1 hook appends one minimal `start` line (event, PID, time), and timestamps/redacts `exit` lines.
`process.api` and `process.dispatcher` report `exitHook` and `exitsDuringDrop`, filtering exits by `dropAt`.
No start line means `exitHook: missing`, not proof of no exit. Historical lines remain in before/after snapshots;
no message text or environment values are recorded. Existing processes need the updated hook on their next
authorized start.

The mini kit is test_only NYC GeoJSON plus Tweed GPKG. The requested external practice-kit manifest was absent;
the GPKG path/hash came from its existing sibling receipt. The recorded fixture retains S1.3's figures, not a new run.
Checks: `node --test scripts/rehearsal/*.test.mjs`, and `node --check` on every `.mjs`.
