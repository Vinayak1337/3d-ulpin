# REH3 - the pinned processor image built, the rehearsal rolled onto it, NYC and Niagara taken in

Rehearsal `ulpin-reh-02` at staging `9d6acc6b`, API `http://127.0.0.1:21026`. Index: [result.json](result.json).

## Part A - done
The serving checkout moved from `54d43d0b` to `9d6acc6b` while stopped (0.2 s) and installed (0.9 s); its
`services/geo` tree is the pinned `dd59ed7f`. `processor-image.mjs build` exited 0 in 6.2 s (cached layers):
`ulpin-geo:git-22003ea3d878`, id `sha256:b444427f…9985`, labels revision `22003ea3d878…` and services tree
`dd59ed7f…`. No container changed during the build.

## Part B - done, by the roll-out steps
Document runtime 12.1 s; `roll --runtime ulpin-reh-02` 21.9 s: `geo` and `worker` recreated on the pinned image
(`c1f8…` to `736d…`, `48fb…` to `240c…`), the three stores started with the same ids, the demo's six containers
unchanged. Start 15.7 s; doctor 28 PASS, 0 FAIL, with **PASS Processors run the pinned image** and **PASS Document
runtimes**. Gateway disabled, no key; no rehearsal process on the GPU. REH2's case reads back as REH2 left it.

## Part C - Niagara to packages, NYC to an explained refusal (410 s of requests)
- **NYC pack, picked whole.** The Studio's `zipRoute` says `intake`; the archive is retained (201) and its enrolment
  fans out in 1.1 s: six GeoJSON layers kept as their own originals with `zip-layer/1` lineage; the DEM, ortho,
  LiDAR and `manifest.json` stay inside the archive, whose item stays probed / undecided. The buildings layer
  (same SHA-256 as REH2's extraction; card present, 1662 MultiPolygon, EPSG:4326) asks its question at 2 s with the
  reason already set; authoring the layout is refused 409 `SOURCE_ALREADY_IN_AREA` "This file is already the source
  of the area “buildings original”." REH2's area holds these bytes; the rule is runtime-wide (`service.ts:111-116`).
- **Niagara Falls footprints** (26.7 MB, EPSG:2958). Retained in 4 parts; the read sealed in 88 s with the count
  moving through 43 values (RM1); the officer's answer (building, `OBJECTID`) pinned to case revision 8 and
  approved; 306 s later the item is `read` / `on_map`: "42247 records read; 41809 in 21 packages. 438 not
  accepted by the reader." All 21 packages REVIEWED, every extent inside Niagara Falls, heights unknown.
  **The map cannot draw it:** `/areas/{areaId}/context` and `/canonical` both answer 422 `AREA_LIMIT` "Choose an
  area with at most 2,000 display features."

"Card confirmation" was read as the layer's holdings card read and present: the Studio's intake feature calls
cases, intake (archives, items, retry), sources/profile/recipes, approve, uploads, targets and confirmations; the
last is the batch's register and property-card step, not sent here.

## What a demo roll needs (proved here)
No schema step (nothing under `database/`, no migration or lockfile changed from `99e0026e`). Stop the two native
processes; checkout `9d6acc6b`; install; document runtime build; `processor-image.mjs roll` (the image is already
on the shared engine); start; doctor. About 51 s measured between stop and start.
Before the presentation: decide how the map shows a large file's area, and check on the demo whether an area from
`buildings-original.geojson` already exists (our ZIP's buildings layer would answer as it did here).

## Left as found
The rehearsal is stopped on `9d6acc6b` and the pinned image: three volumes, six exited containers, its network and
folder kept. The demo's doctor before, after Part B and at the end: exit 0, commit `99e0026e`, pids 37204 and 44520
with the same start times, the same container ids. `ulpin-reh-01` was not touched.
