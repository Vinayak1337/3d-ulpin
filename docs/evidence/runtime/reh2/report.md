# REH2 - the presentation rehearsed on an empty runtime

Rehearsal `ulpin-reh-02` at staging `54d43d0b`, API `http://127.0.0.1:21026`. Index: [result.json](result.json).

## Part A - done
Worktree, install, create, document runtime, start and doctor all exited 0 on their first run (104 s together).
The rehearsal doctor shows 27 PASS, 0 FAIL; the gateway is disabled with no key. No rehearsal process holds the GPU
(compute process ids unchanged; the processor containers request no device). The demo's doctor before, after
Part A and at the end: exit 0, commit `99e0026e`, API pid 37204 and dispatcher pid 44520 with the same start times.

## Part B - each input to its first refusal (303 s of requests in total)
- **NYC pack, picked whole.** The Add files dialog sends a `.zip` to direct shapefile import:
  `POST /api/v1/import-packages/inspect` answers 422 `AREA_PROCESSING` "Shapefile ZIP must contain 1–100 layers."
- **NYC buildings member** (`layers/buildings-original.geojson`, extracted unchanged). Card present; the layout
  question opened 2 s after registration; the officer's answer (building, identified by `bin`, no height) was
  authored and approved with the Studio's builders; 8 s later the item was on the map. One package, REVIEWED,
  1661 ready; 1 of 1662 set aside for a self-intersecting ring, nothing repaired. The area's map read gives 1661
  buildings, all inside lower Manhattan, heights unknown.
- **Niagara Falls footprints** (26.7 MB, declares EPSG:2958), in the same case through the large path. Upload
  and hash check passed; the raw reader published all 423 chunks (42247 records) but could not seal. After 286 s
  the item stopped `not_understood`: "This file could not be read and interpreted completely; nothing was prepared
  from it." No layout question, no package, no map feature.

## What a demo roll would hit
1. The reused processor image lacks `resolve-geojson-crs` (`c7a7e720`); every large GeoJSON with a `crs` member
   stops as Niagara did. The image also predates 14 `services/**` commits already in the demo's own commit, and
   the demo's checkout names `demo-s03` while its processors run `demo-k3b`. A roll needs an image built from the
   roll commit first, then rehearsed.
2. No schema file changed between the demo's commit and staging.
3. Our pack cannot be picked as one zip; its GeoJSON members go in one by one.
4. Smaller defects: a processor 404 is retried as transient (three whole re-reads); the manifest showed 300 records
   for 284 s while 42247 were read; the doctor cannot see an image that lags the serving commit.

## Left as found
The rehearsal is stopped: three volumes, six exited containers, its network and its folder are kept. Start it
again from `E:/Projects/ulpin-wt/ulpin-reh-02` with `pnpm platform:start --profile demo --runtime ulpin-reh-02`.
`ulpin-reh-01` and the demo were not touched. The batch's one confirmation (register, property cards) was not sent.
