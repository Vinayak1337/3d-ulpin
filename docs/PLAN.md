# Plan to finish, 23 to 31 October 2026

This page is the only plan. A task that does not move one of its numbered steps is refused. Only the owner changes the
plan, at most once a week, with a dated line under "Changes". The tasks for each step are in [TASKS.md](TASKS.md); how
the work runs is in [WORKING-RULES.md](WORKING-RULES.md).

## The goal

At the December finale the judges hand us their own files, from a few MB up to about 1 GB, in formats we have not seen.
On a fresh, empty Studio, with no code change, each file is:

1. **Kept.** The original is stored unchanged and hashed before anything else happens.
2. **Understood.** A reading card says in plain words what the file is, what it holds, what each field means, how it
   will be drawn and what it links to.
3. **Drawn as it streams.** The first features appear within 60 seconds of the drop, not counting the officer's one
   layout confirmation. The rest arrive in parts, and the page never freezes.
4. **Linked** to the other files and records it shares a key, an address or a place with. Where there is none, the card
   says no link was found.

A file we cannot draw is still kept, described and listed, with the reason in plain words. Our own act 1 (the New York
files, from one drop to a cited property card) keeps working throughout.

**Everything is finished by Saturday 31 October**, because the owner is not available in November and December. After
that date the only work is presenting. If a selection round happens before then, the demo runtime stays as it is
(`4ffd801a`) through it and no rehearsal runs that day.

## What "any format" means

| Family | Formats |
| --- | --- |
| Maps and tables | GeoJSON, NDJSON, Shapefile (ZIP or loose), GeoPackage, KML/KMZ, GeoParquet; CSV, TSV, XLSX and ODS with coordinates, WKT, addresses or keys |
| Documents and plans | PDF (text and scanned), DOCX, DXF, plan images (PNG, JPG) |
| 3D models | CityGML, CityJSON, IFC, glTF/GLB, OBJ |
| Imagery and point clouds | GeoTIFF/COG aerial photos, DEM/DSM ground and surface height maps, drone photos, LAS/LAZ/COPC laser scans |

Size ceilings (owner, 11 October): one file 1 GB, a vector layer 500,000 features, a table 1 million rows, a raster
2 GB, a point cloud 1 GB. A file outside the list or above a ceiling is kept and described, not drawn.

## How a file is understood

Code reads a short profile of the file: layers, columns and their types, the coordinate system, the extent and some
page text. The understanding step turns that profile into the reading card. It tries, in order:

1. a layout we confirmed before (memory);
2. clear rules (for example, a height column in metres);
3. the Sarvam model on a masked profile (allowed since 11 October: column names, types and shape, no cell values, no
   contact lines; sample values only if the owner says yes, "Needs you" 3);
4. one question to the officer.

The model only names meanings, the drawing and the links. Code does every conversion of coordinates, units and values.
The officer confirms each new layout once, and nothing becomes a record without that confirmation.

## The finish line: two judge kits

- **Practice kit:** one real public file per listed format (about 26), plus the largest allowed size in each family.
  Workers build against it. Each file is recorded in `docs/api/datasets.json` and `docs/api/real-sources.md` with its
  origin, licence state (confirmed, unconfirmed or restricted) and `test_only`.
- **Closed kit:** about 12 other real public files, at least two per family, chosen by a session that never builds,
  teaches or tunes afterwards. Its list and files live outside Git under `E:/BhuAayam-data/holdout/judge-kit-closed/`;
  only the hash of its manifest is committed. It is opened only in rehearsals. It stands in for the judges' data.

**Done** means: the closed kit, dropped all at once on a fresh empty runtime on a quiet PC, passes points 1 and 2 for
every file, point 3 for every file in a drawable format, and point 4 wherever a shared key, address or place exists,
twice. Act 1 still reaches its cited card. The API never exits, and no frame takes over 100 ms in a browser performance
trace of the whole drop. The second run is recorded as the backup video.

## Steps

| # | Days | Step | Done when |
| --- | --- | --- | --- |
| 0 | Fri 23 | Paperwork: this plan, the task list, a plain status page, short rules; old plans archived | Committed on `staging` and pushed; `task/int3-pre` has merged `staging` |
| 1 | Fri 23 to Sat 24 | Choose the code version we build on: the standard checks and one rehearsal of act 1 on `task/int3-pre`; merge it into `staging` if they pass, otherwise fix only what fails | One branch; checks and rehearsal pass |
| 2 | Sat 24 | Build both kits as defined above; seal the closed kit | Practice kit catalogued; closed-kit manifest hash committed |
| 3 | Sat 24 to Mon 26 | Stay up and stay smooth: the API survives the whole practice kit at once; first features within 60 s at any size; no frame over 100 ms; the three timing fixes already on `task/int3-pre` (evidence confirmation, surface admission, dispatch latency) proven in a rehearsal | Practice-kit drop measured and passing |
| 4 | Sat 24 to Tue 27 | Understanding: a reading card for every family, from memory, rules, Sarvam and the officer, shown on the batch screen | Every practice file gets a correct card |
| 5 | Sun 25 to Wed 28 | Drawing: fill the gaps the practice kit shows, one family at a time | Every practice file drawn, or explained |
| 6 | Tue 27 to Wed 28 | Linking: shared keys, addresses and overlap between files, shown on the map and in the record panel | Practice links shown with their reason |
| 7 | Mon 26 to Thu 29 | UI: the owner's five worst problems first, then the batch screen, the map and the reading card | Owner accepts the screenshots |
| 8 | Thu 29 | Rehearsal 1 on the closed kit | A list of what failed |
| 9 | Fri 30 to Sat 31 | Fix what rehearsal 1 found; rehearsal 2, recorded; freeze on Saturday evening | Done, as defined above |

The demo runtime (`ulpin-demo`, serving `4ffd801a`) is not changed before step 9.

This is a tight plan: eight days for four families. The cut order is there for that.

## If we fall behind, cut in this order

1. OBJ and glTF models without coordinates (shown in their own frame only).
2. IFC geometry (keep its summary and its storey outline in its own frame).
3. Point clouds above 500 MB (show a thinned preview).
4. Scanned PDF pages beyond the first 20.
5. DOCX.

**Never cut:** keeping every file, the reading card, streaming of maps and tables, act 1 to the cited card, no crash, a
smooth page.

## How the work runs

[WORKING-RULES.md](WORKING-RULES.md): at most three workers at once, only one of them using this PC's runtime, Docker or
GPU; short task files; every diff reviewed; one short result per task; a five-line daily report to the owner.

## Needs you

1. Reply "signed" in chat, or say what to change; the lead writes your name and the date below.
2. List the five worst things in the UI today: which screen, and what is wrong.
3. On 11 October you allowed Sarvam to see a masked column profile of an unseen file: column names, types and shape,
   no cell values, no contact lines. May we add up to five sample values per column, with numbers and names masked,
   and short page text? If not, judges' files use the 11 October profile only.
4. The finale runs on a fresh, empty runtime, so no development record has to be erased. Yes or no?
5. Will you keep other projects' agents off this PC during the rehearsals (Thursday 29 and Saturday 31)?

## Changes

- 23 October: the owner asked for a new lead session that starts delegating from this plan and its task list. Tasks
  that depend on an open "Needs you" item wait for the answer.

Signed: ____________ Date: ____________
