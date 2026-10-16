# LP3c — checkpoint: the walk could not start

Missing: the HTTP walk (`runtime.json`), because Docker Desktop failed before the throwaway PostGIS box existed.

Branch `task/lp3b-large-file-automatic`, worktree `E:/Projects/ulpin-wt/k2`, base `c6e5cb31`. The build is committed
(`e910c1f2`, `56026eeb`); the checks in `checks.json` pass (328/328 tests).

## The failure (Docker Desktop backend log, 08:08:25Z on 16 October)

`backend cancelling with error: starting services: initializing Ingest server: listening on
unix://C:/Users/kvina/AppData/Local/Docker/run/sailor-ingest.sock: rename …/sailor-ingest.sock
…/sailor-ingest.sock.stale: The file cannot be accessed by the system.`

Its dialog offered Quit and Reset to factory defaults; Quit was pressed at 08:09:45Z, not by this task. Nothing was
reset. A factory reset would delete populated volumes and must not be used.

## To resume

1. The owner gets Docker Desktop's engine answering (`docker info`).
2. From the worktree root: `node docs/evidence/gf1/lp3c/run-runtime.mjs docs/evidence/gf1/lp3c/runtime.json`.
   It starts its own labelled PostGIS box, the product API (`apps/api/src/main.ts`) and dispatcher
   (`scripts/dispatcher.ts`) as their own processes, walks DA6 then Niagara, kills and restarts both processes
   after four cuts, and removes the box. `progress.jsonl` shows each row as it happens.
3. Write `result.json` from `runtime.json` (the four flags and step 4's numbers) and commit
   `docs(usp): LP3c evidence, 48,686 buildings from one upload to packages and three cards`.
