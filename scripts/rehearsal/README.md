# Kit-drop rehearsal

Ports the S1.3 presenter/recorder, upload selectors, job timing and telemetry, plus REH16's launch/wait order.
No runtime is created, started, stopped or reset. Run only later, alone, against an already-running rehearsal.

```bash
node scripts/rehearsal/kit-drop.mjs --runtime ulpin-reh-03 --kit scripts/rehearsal/mini-kit.json \
  --out E:/ulpin-tmp/kit-drop-03 --dry-run
```

Remove `--dry-run` for the live check. `--verify-hash` additionally hashes every original; sizes are always checked.
Manifests have `entries` (or `files`) with `path`, `bytes`, `sha256`, `family`; optional `root` resolves relative paths.
Output must be a **new** folder beneath E:/ulpin-tmp. Closed/protected paths, including manifest paths, are refused.
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

Rows match the exact text of the tray's File-cell name button, not a substring of the whole row. `rowMatch`
records `one`, `none` or `many` and the exact count; state and parts are still recorded when words cannot be read.

Derived intake items whose `archiveItemId` or `parentItemId` points to a kit original are recorded in its `members`.
Each member keeps its name, item ID and the same state, parts, layout, words and map observations as an original.
Collapsed or duplicate-name rows stay explicit missing/ambiguous measurements; their layouts are not opened.

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

Each watch pass reads the case intake and targets with a 15-second limit; the health sample keeps its 4.5 seconds.
Every read is kept in `process.polls` as wall time `at`, monotonic `startMono`, `path` and elapsed `ms`.
A read that fails or times out adds the error `name` and skips that pass: the runner waits a second and reads again,
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
