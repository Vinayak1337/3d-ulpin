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
The browser is headed, ANGLE D3D11, 1440x900. The officer answers layouts in Studio; meanings are never chosen here.
`--minutes` bounds observation after the single multi-file retain action (default 30, maximum 120).

`result.json` holds per-file observed retention/layout moments, exact row/card/limit words, first/final map moments,
non-overlapping batch/map frame captures (`maxMs`, `over100`, `longestTaskMs`), renderer, job queue/wall-exec/retries,
five-second health/pool samples and before/after S3.1 start/exit lines. Missing measurements stay null, not zero.
Map moments are upper bounds: canvas + package caption + two animation frames, with screenshots; **not proof every
feature painted**. Final map observation requires all planned parts and a complete package listing; otherwise null.
The map stays open after first observation; navigation splits its captures. Separate windows avoid hidden tabs;
hidden/unmeasured pages, unknown GPUs and software renderers give **no smoothness verdict**, even with zero slow frames.
Job exec is completion minus first dispatch, including retry/dependency wait.
CPU time and retry-wait seconds are unknown.
Exit files include historical lines; missing exit files do not prove zero exits.

Rows match the exact text of the tray's File-cell name button, not a substring of the whole row. `rowMatch`
records `one`, `none` or `many` and the exact count; state and parts are still recorded when words cannot be read.

Derived intake items whose `archiveItemId` or `parentItemId` points to a kit original are recorded in its `members`.
Each member keeps its name, item ID and the same state, parts, layout, words and map observations as an original.
Collapsed or duplicate-name rows stay explicit missing/ambiguous measurements; the runner does not open layouts.

Batch and opened map frame counters are captured and reset every 10 seconds, independently of row/map waits.
Each capture has browser-clock `from` and `to` timestamps; navigation and finish also flush partial windows.
The smoothness rules are unchanged; an unopened map remains unmeasured.

`process.queue` adds a timestamp and counts for `queued`, `dispatched` and `running` every 10 seconds once the
case ID is known. It uses one SELECT with the same runtime/case validation and read-only psql guard as job timing.
A failed query records null counts, never invented zeroes; nothing writes to the database.

The opt-in S3.1 hook appends one minimal `start` line (event, PID, time), and timestamps/redacts `exit` lines.
`process.api` and `process.dispatcher` report `exitHook` and `exitsDuringDrop`, filtering exits by `dropAt`.
No start line means `exitHook: missing`, not proof of no exit. Historical lines remain in before/after snapshots;
no message text or environment values are recorded. Existing processes need the updated hook on their next
authorized start.

The mini kit is test_only NYC GeoJSON plus Tweed GPKG. The requested external practice-kit manifest was absent;
the GPKG path/hash came from its existing sibling receipt. The recorded fixture retains S1.3's figures, not a new run.
Checks: `node --test scripts/rehearsal/*.test.mjs`, and `node --check` on every `.mjs`.
