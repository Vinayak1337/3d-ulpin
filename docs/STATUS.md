# Status

**30 October 2026, midday.** The plan is [PLAN.md](PLAN.md) and its tasks are in [TASKS.md](TASKS.md). The
demo runtime stays up and unchanged. This page stays under one page; the board before today is in
[archive/STATUS-2026-10-27.md](archive/STATUS-2026-10-27.md).

## Where each step stands

| Step | State |
| --- | --- |
| 0 Paperwork | Done. The plan is not yet signed (Needs you 1). |
| 1 Code version | `task/int3-pre` is the version we build on; it reaches `staging` after rehearsal 1. |
| 2 Kits | Done. The practice kit is catalogued; the closed kit is sealed (12 files, 4 families, hash only in Git). |
| 3 Stay up, stay smooth | Drop 2 run 3 (S3.11e): all 17 files arrived in 6 minutes, no reload, the API never stopped; 15 read or kept with words. Fixed since: the India file (S5.29), Berlin drawing (S5.30), Halifax keyed by BLPOLY_ID, the batch status read from 2 s to 0.1 s (S5.32), and the runner now times the map and names slow frames (S3.16d, S3.16e). Drop 2 run 4 (S3.11f): 90 minutes, the API never stopped and no read was slow (all under 0.6 s), but only 11 of 17 files got in: one part of the 800 MB India upload failed, Studio's resend was refused and it waited for an officer, so the five files after it never started (fix S5.33). The India file stops at 500,000 features and its field inventory crashed (S5.34); Niagara took 263 s to reach the map because the read runs at about 180 buildings a second and mapping waits for all of it (S5.35); 50 slow frames with no script behind them (S3.16f). Fixed and merged: a failed part is resent by itself and later files keep going (S5.33); the India inventory crash was a counter limit left at 4,097 parts (S5.34); geometry checks run per part instead of per building, the Niagara read modelled at about 5 s instead of 236 s (S5.35); the map opens the named part first and slow frames carry the PC load (S3.16f). The India file now reads its first 500,000 buildings and keeps the rest with words (S5.34b). Halifax's cell files now take the parent's answer by themselves (S5.36). Drop 2 run 5 (S3.11g): 90 minutes with no exit and no slow read, Niagara read in 47 s instead of 236 s, but only 8 of 17 files got in (a TIF upload part failed and was never resent: S5.39), Niagara's first part reached the map at 290 s (mapping 200 s and queue waits behind Halifax's cells: S5.37, S5.38), and the slow frames fall on the 5-minute Docker guard runs. Three fixes are running. |
| 4 Understanding | Reading cards exist for every family; drop 2 measures whether each practice file gets a correct one. |
| 5 Drawing | Readers exist for every family in the plan. New since the 27th: Berlin CityGML placed by its stated AdV system (S5.25), a gzip file gives out its member (S5.26), a file with no key field is keyed by each feature's position (S5.27), ZIP and gzip members above 128 MiB are kept through the large receipt (S5.28). |
| 6 Linking | Done: links by key, address and place, shown on the map and in the record panel (S6.1 to S6.4). |
| 7 UI | The batch page layout is fixed at 1440 wide (S7.27, S7.27b). The screenshot set for your acceptance (S7.16) follows drop 2. |
| 8 Rehearsal 1 | Done on the closed kit (S8.1); its fixes merged as S9.1. |
| 9 Rehearsal 2 and freeze | Run 1 (S9.2a): all 12 originals kept and hash-matched, act 1 reached its cited card, no API exit, demo unchanged; but no map drew. The diagnosis (S9.3a) found one exact cause per file. Merged: large GeoTIFFs (S9.3e), the city-model coordinate name (S9.3g), CSV header cells with no name (S9.3b), the map-area extent (S9.3f), headerless workbook sheets (S9.3d), no table profile asked too early (S9.3h), the converted city layer's approval (S9.3c) and the image cube and huge raster (S9.3e2). Running: the raster result accepted by the contract so those two rasters publish (S9.3e3) and workbook sheets with a few irregular rows (S9.3d2), both on codex-4; the processor image rebuild (IMG9) on a Claude worker. Then run 2 twice (the second recorded) and the freeze on Saturday evening. |

## Known limits

- The Microsoft building file (about 800 MB) is above the streaming ceiling of 500,000
  features; it is kept and explained in words, not drawn.
- A CityJSON file above 8 MiB is kept with words, not drawn. A real 21 MB 3DBAG tile was measured (S5.18b): its
  reading would be 79.5 MB, so admitting it needs a reading that points into the original; that waits until after
  the freeze.

## Where things are

| Thing | State |
| --- | --- |
| Demo runtime `ulpin-demo` | Up, serving `4ffd801a` from `E:/Projects/ulpin-wt/demo`; not changed before step 9 |
| `task/int3-pre` | The newest code, in `E:/Projects/ulpin-wt/int3`, at `46ed75bf`; pushed; not yet in `staging` |
| `staging` | In `E:/Projects/3d-ulpin`; last pushed `5454ce56` on 27 October; holds the plan, tasks and this page |
| `main` | Never pushed or built on |
| Processor image | `ulpin-geo:git-a156988dee58`, pinned on `task/int3-pre` (IMG8); IMG9 for `46ed75bf` building |
| Rehearsal runtimes | `ulpin-reh-13` (S3.11k, at `a1fed760`, stopped, data kept); `ulpin-reh-12` (S3.11j, at `8454b17d`, stopped, data kept); `ulpin-reh-11` (S3.11i, at `8454b17d`, stopped mid-drop, data kept); `ulpin-reh-10` (S3.11h, at `df9b805a`, stopped, data kept); `ulpin-reh-09` (S3.11g, at `f5d3ed64`, stopped, data kept); `ulpin-reh-08` (S3.11f, at `9180d490`, stopped, data kept); `ulpin-reh-07` (S3.11e, at `d7baef36`, stopped, data kept); `ulpin-reh-06` (S3.11c, created at `2b72f962`); `ulpin-reh-05` stopped (first drop 2 try); `ulpin-reh-01` to `04` kept |

## Next

1. Merge S9.3e3, S9.3d2 and IMG9 as they finish.
2. Rehearsal 2 runs again on a fresh runtime, twice; the second recorded as the backup video. Then the freeze on Saturday evening.

## Needs the owner

The five items under "Needs you" in [PLAN.md](PLAN.md).
