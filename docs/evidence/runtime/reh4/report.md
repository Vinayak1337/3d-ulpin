# REH4 - the rehearsal rolled to 01a11f93; the Niagara area read by window; already-in-area; ZIP words

Rehearsal `ulpin-reh-02` at staging `01a11f93`, API `http://127.0.0.1:21026`. Index: [result.json](result.json).
Before Part A: `git diff --name-only 9d6acc6b 01a11f93 -- services/ database/ scripts/platform/ pnpm-lock.yaml`
listed nothing, so there was no schema step and no new image.

## Part A - done
The serving checkout moved from `9d6acc6b` to `01a11f93` (0.2 s) and was installed (0.8 s). Its `services/geo` is
the pinned tree `dd59ed7f`. Document runtime build 15.6 s. `processor-image.mjs roll` took 21.7 s and recreated `geo`
and `worker` on the same image `ulpin-geo:git-22003ea3d878`; the stores and the demo's containers were unchanged.
Start took 16.4 s. The doctor reported 28 PASS and 0 FAIL, with **PASS Processors run the pinned image** and **PASS
Document runtimes**. The gateway stayed disabled and no rehearsal process was on the GPU. REH3's area still holds its
21 REVIEWED packages (41,809 ready).

## Part B - the routes answer, but the area has nothing they can read
- `context` and `canonical`: still 422 `AREA_LIMIT` "Choose an area with at most 2,000 display features."
- `display-summary`: 200 in 0.26 s with **`featureCount` 0, `extent` null**, area revision 0 (REH3 counted 41,809).
  The window reads (`area-display-window.ts:14`) count only recorded features (`revision > 0`). Niagara's
  buildings are unrecorded proposals in reviewed packages that were never confirmed. `areaContext` counts those
  proposals (`area-display-proposals.ts:21,36`), which is why it refuses. A probe window of 100 km at the area's
  origin answers 200 with 0 features in 0.2 s.
- So nothing could be paged, centred or height-checked. `limit=0`, `limit=4001`, `minX >= maxX` and `minX = maxX`
  are each refused 422 `INVALID_INPUT` with plain words.
- **Studio** (`/studio/areas/:areaId`, dev server from the rehearsal checkout, Chromium headless 1440x900): it reads
  context (422) and then display-summary (200), and makes no display-window read. There is no status line, no
  banner, and no inspector after a click. The officer sees an empty ground with "Revision 0" in the header
  (`map-1.png` to `map-3.png`). The dev server was stopped and port 5188 is free.

## Part C - done, as expected
In a new case, the NYC pack (14,621,643 bytes; SHA-256 checked before upload) routes `intake` and fans out in
1.1 s. The ZIP's own item rests `read`/`undecided` with "6 map layers in this ZIP are taken in as their own
files: ... Not taken in: ... (not a map layer)". The buildings layer rests `read`/`undecided` in 2 s with "This
file is already the source of the area “buildings original”. ..." and `existingAreaId` `e4874150` (REH2's area),
not `needs_answer`. The other five layers ask their question within 6.1 s. The dispatcher log was not read: it lives
inside the runtime folder (`processes.mjs:42`), which this task may not open.

## Left as found
The rehearsal is stopped at `01a11f93`: six exited containers, three volumes, everything kept. The demo's doctor
matched its baseline before, after A, after B and at the end: exit 0, `9d6acc6b`, pids 26692 and 19544, the same
container ids. Only `/api/v1/health` was requested from the demo. `ulpin-reh-01` was not touched.

## For the lead
A demo roll from `9d6acc6b` to `01a11f93` needs no schema step and no image roll (about 33 s of measured steps). It
does not by itself draw a large file's area: that waits on a decision (needsCode 1 and 2 in result.json).
