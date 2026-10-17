# REH5 - the rehearsal rolled to 2acba69a; the Niagara proposals drawn by window reads

Rehearsal `ulpin-reh-02` at staging `2acba69a`, API `http://127.0.0.1:21026`. Index: [result.json](result.json).
Before Part A, `git diff --name-only 01a11f93 2acba69a -- services/ database/ scripts/platform/ pnpm-lock.yaml`
listed only `processor-image.mjs` and two platform tests: no schema step and no new image.

## Part A - done
Checkout 0.15 s, install 0.74 s, `services/geo` is the pinned tree. Document runtime build 12.5 s. The roll printed
"ulpin-reh-02: geo and worker already run ulpin-geo:git-22003ea3d878; nothing recreated." (4.6 s), and the container
ids were unchanged. Start took 34.5 s, because the containers were cold. The doctor reported 28 PASS and 0 FAIL, with
**PASS Document runtimes** and **PASS Processors run the pinned image**. The gateway stayed disabled, and no new GPU
process appeared.

## Part B - done to the register page
- `display-summary`: 200 in 1.76 s, **41,809 features** (REH4: 0), the extent spans 13.3 by 21.6 km, revision 0.
- The whole extent paged at `limit=4000` in 11 pages (16.4 s, 22.7 MB). There were 41,809 unique identifiers in
  ascending order, with no repeat or gap. All of them are `unrecorded_proposal`, all `heightM` null with state
  `unknown` (none 0), and every vertex lies inside the extent padded by 100 m.
- Every window read costs about 1.5 s, whatever it holds: 500 m at the centre held 3 (1.52, 1.52, 1.53 s), 50 m
  held 0 (1.53, 1.56, 1.54 s), and near-centre 500 m and 50 m windows held 2 and 1. `limit=0`, `limit=4001` and
  `minX >= maxX` were each refused 422 `INVALID_INPUT` with plain words. `context` and `canonical` answered 422
  `AREA_LIMIT` "at most 10,000 display features."
- **Studio:** no banner and no empty sentence. At open the canvas shows sky only, while the line says "Showing 4,000
  of 41,809 buildings; move closer to see the rest." (`map-1.png`). After 8 wheel ticks the buildings are drawn, one
  or two pixels each (`map-2.png`). Each view fills the 15,000 budget in 4 sequential pages, 8.4 to 10 s. A
  165-point grid of clicks picked nothing (`map-3.png`). A second session zoomed over drawn pixels and picked a
  building on its 16th click: the inspector shows "Building", identifier `...:B22744` and "Open register"
  (`map-3b.png`). The register page shows "No register is recorded for this building" and "The record of this
  building could not be read · AREA_LIMIT" (register 404, canonical 422; `map-4.png`).

## Left as found
The rehearsal is stopped at `2acba69a`: six exited containers, three volumes, everything kept. The demo's doctor
matched its baseline before, after A, after B and at the end (exit 0, `9d6acc6b`, pids 26692 and 19544, the same
container ids). Only `/api/v1/health` was requested of the demo, and `ulpin-reh-01` was not touched.

## For the lead
Three items need code, listed in result.json: a building's canonical read in a large area is refused AREA_LIMIT
(`areas.ts:306-309`); the camera's 20 km far plane blanks the opening view (`engine.ts:209`); and "move closer to
see the rest" shows at every distance (`areaWindow.ts:56-60`). Rolling the demo to `2acba69a` needs no schema step
and no image roll.
