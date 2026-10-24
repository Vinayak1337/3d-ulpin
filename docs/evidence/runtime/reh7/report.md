# REH7 - where the slow window pages go: `ulpin-reh-02` at staging `67959045`

Index: [result.json](result.json). API `http://127.0.0.1:21026`, area `a1c1252a-...`. Reads only; no SQL, no log.
**Part 0 - Docker.** Booted 13:30 IST, Docker not running, four stale sockets in its `run` folder. Both socket
folders were renamed aside in one step (`run-stale-reh7-20261018`, `docker-secrets-engine.saved-reh7-20261018`),
Docker started once and answered in about 2 s. Reset was not chosen ([docker-recovery.json](docker-recovery.json)).

**Part A - rolled.** The diff of `services/ database/ scripts/platform/ pnpm-lock.yaml` from `2ddefbbb` was empty.
Checkout 0.2 s, install 1.1 s, `services/geo` is the pinned tree, the roll printed "nothing recreated", start
42.5 s, doctor 28 PASS and 0 FAIL. API native process 30824.

## Part B - straight to the API, no browser: no page over 10 s
- Cold: W4 page 1 2.6 s, then 1.5 to 2.1 s. Warm, five rounds of the six pages: 1.4 to 2.1 s.
- Floor: a 50 m window with 0 features takes 1.8 s, `display-summary` 2.2 s; the API's CPU is 0.3 to 0.4 s of it.
  Every read pays this, so a four-page view costs about 7 s before drawing.
- Concurrent W4 page 2: x1 1.9 s, x4 2.5-2.7 s, x8 2.8-3.5 s; at x12 the first eight 3.0-3.5 s and copies 9-12
  5.0-5.7 s (the eight pooled connections). Every Part B answer over 3 s is in this step.
- After six reads abandoned at 0.5 s, W5 page 2 takes 2.2 to 2.7 s against 1.4 s alone: the abandoned reads run on.

## Part C - the Studio, Chromium 1440x900: reproduced
Two runs as REH6 zoomed, plus a third with Chromium's CPU profiler. Browser queueing never passed 2 ms; the
server's time to first byte through the Vite proxy was 1.6 to 2.4 s.

| run | slow page | queued | server to 1st byte | download | longest main-thread task |
|---|---|---|---|---|---|
| 1 | 3.75 s | 2 ms | 1.81 s | 1.82 s | 3.3 s |
| 2 | **27.0 s** | 0.5 ms | 1.61 s (6%) | **25.4 s (94%)** | **26.9 s** |
| 3 (profiled) | 3.95 s | 0.7 ms | 1.86 s | 1.97 s | 3.5 s |

Each slow page is page 2 of the 5,555 x 5,681 m view at the 200 m stage, the first page after the new view's
page 1 replaced the 15,000 drawn buildings, as REH6's two (both `after` pages). During the 27 s page the API used
0.36 s of CPU and Postgres averaged 8%. The body sat unread while the page's main thread ran one 26.9 s task.

The profiled 3.5 s task ([part-c-profile-run3.json](part-c-profile-run3.json)) is `SceneEngine.setBuildings`,
from the scene's React effect (`react.tsx:72`): 3.0 of its 3.3 s in `removeBuilding`, 2.25 s of that in
`removeBuildingPad` -> `padGeometry`. Each removed building rebuilds the merged pad of every building left in its
batch, so the cost grows with the batch size squared and varies run to run (3.3, 26.9, 3.5 s).

## Verdicts
- H1 browser or proxy queueing: **not supported** (at most 2 ms queued; the proxy adds about 0.2 s).
- H2 pool wait: **not supported as the cause**; seen only past 8 concurrent reads (+2 s) and after abandoned reads.
- H3 API CPU: **not supported** (0.2 to 0.7 s per read; 0.36 s during the 27 s page).
- H4 cold reads: **not supported** (cold 2.6 s against warm 2.0 s).
- Found instead: the browser's main thread tearing down the old view's buildings: **94%** of the 27 s page.

## For code (the lead decides; nothing was changed)
1. `packages/scene/src/engine.ts:1077-1091` with `look.ts:246`: pad rebuilt once per removed building; removing
   in bulk (`engine.ts:705-708`) and rebuilding each touched batch once would remove the squared cost.
2. `engine.ts:1046`: `Object3D.remove` per mesh and edge on a group of ~30,000 children (0.5 s self in 3.5 s).
3. `area-sources.controller.ts:121-123`, `area-display-window.ts:73`: a client abort does not stop the read.
4. The 1.8 s floor per read is mostly outside the API's CPU; splitting it by statement needs SQL (not run here).

Headless Chromium draws with software WebGL (main thread never idle); a GPU laptop may be faster, but the removal
is plain JavaScript. With LA7's clamp, the 100 m stage now issues no new read.

## Left as found
The rehearsal is stopped at `67959045` with six exited containers and three volumes kept, and the dev server is
stopped. The demo's doctor matched its baseline before Part A, after A, after B and at the end: commit
`9d6acc6b`, the same container ids, no native process, health 000 (not started by this task). Only
`/api/v1/health` was asked of the demo. `ulpin-reh-01` was not touched. No GPU training was listed.
