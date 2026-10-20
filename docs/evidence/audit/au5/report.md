# AU5 - the AU2 gaps recounted on staging `872a57dd`, read from the code

Read only; no runtime, Docker or test run. Data: [recount.json](recount.json). Source list:
[AU2 gaps.json](../au2/gaps.json) (24 gaps and three in-progress items, 11 October).

**Count:** 14 closed, 6 partly, 7 open, and 5 new gaps (N01-N05). Nothing merged since 20 October has run on a live
stack yet (STATUS line 34), so "closed" means closed in the code, not proven on the runtime.

| Id | State | Merge | What is left, in plain words |
| --- | --- | --- | --- |
| G01 | closed | `9765270f` CD1 | Any file of any size joins the batch through `/uploads` (`file-route.ts:11`, `retain-batch.ts:55-57`). |
| G02 | closed | `b3d6fe8a` NU1 | A kept file no reader takes rests `not_understood` with words naming what it is (`intake-draft.ts:94-106`). |
| G03 | closed | `da2f1ffc` HB1 | The run renews its lease after each package; a lost lease is a fault, not a refusal (`intake-run-worker.ts:71-74`). |
| G04 | partly | `b9380fe6` CC1 | Cards only from the batch page, 100 a press in stored order; the map inspector of a recorded building has no card action (`MapWorkspace.tsx:377-385`). |
| G05 | open | - | No rehearsal has pressed confirm through to a card; REH8 waits for Docker Desktop. |
| G06 | closed | `494e68a5` PX1 | Window reads take every package of the area (`areas.ts:311-312`). |
| G07 | partly | `494e68a5` PX1 | Outlines found by the GiST index, but each read still unnests every package body; REH7: 1.8 s floor for an empty window. |
| G08 | open | - | Commit cost unmeasured; one global advisory lock (`areas.ts:1652-1654`). Waits for G05. |
| G09 | partly | `ad660383` TB1 | Contracts and tables exist; the evidence routes answer 501 and nothing writes them. AU4-B2 (running) builds the matching. |
| G10 | closed | `f46d9671` G10 | A batch PDF is read by the document reader, in words (`intake-draft.ts:161`, `244-260`). |
| G11 | partly | `0b77c7dd` SH2 | The server converts a batch GPKG or shapefile ZIP, but the Studio still sends them to direct import (`file-route.ts:9`); KML has no batch recipe. CR1 merged after the base. |
| G12 | closed | `6d038782` ZL1, `f861dfa2` ZL2 | A layer over 16 MiB is streamed out as its own large original (`intake-zip-layers.ts:321-346`). |
| G13 | open | - | Tables still 16 MiB / 2,000 rows (`ingestion.ts:126`). The G13 branch (running) streams them. |
| G14 | open | - | Raster and point cloud rest kept only (`intake-draft.ts:94-97`). SB1 (running) is the backend half. |
| G15 | partly | `05b4565b` IFC1, `c3d4659b` IFC2 | Scan and batch view exist, but a batch IFC is `model3d` and rests kept only, so no scan starts from the drop. IFC3 (merging) closes it. |
| G16 | closed | `3bfcdf39` G16 | Reader ceilings are 1 GiB and 500,000 features (`streaming-vector.ts:4-12`). Confirming and drawing that size: N02, N03. |
| G17 | closed | `8a5c6373` G17 | Caps count open receipts only (`large-original.ts:101-104`). An abandoned receipt still holds its slot: N04. |
| G18 | closed | `35bf9ba0` MB2 | A picked proposal links "Open batch to confirm" (`WindowedArea.tsx:140-141`). |
| G19 | open | - | The owner's keys are not on the runtime; no live Sarvam call. |
| G20 | closed | `8a2e0632` G20 | Retire and restore an area; the same file in a new case gets its own area (`service.ts:104-105`, `117-123`). Not yet run on the demo. |
| G21 | open | - | No waiting keys or closing pass; the coverage table has no writer. AU4-B3 is cut, not merged. |
| G22 | open | - | The dispatcher takes operations in turn; no waves, memory reservation or GPU lane (`processing.ts:229-233`). |
| G23 | partly | `2644eb6c` G23, `66edca23` G23S | Read, previewed and labelled by the officer as a candidate; no OCR or plan model runs on a scan. |
| G24 | closed | `217dec60` LC1 | An approved layout carries to the next file of the same layout in its case (`service.ts:397`). |
| RG1 | closed | `7bf0203a` RG1 | One building's register reads that building; REH6 saw 200 where REH5 saw 422. |
| LA4 | closed | `a7057d23` LA4 | Far plane and fog follow the framed area; REH6 opened on the ground, no sky. |
| LA5 | closed | `2ddefbbb` LA5 | The window line says "move closer" only when the budget cut the view; REH6 found it true. |
| N01 | new | - | One mixed drop splits three ways: GeoJSON, ZIP, PDF and other files to the batch, `.gpkg` and shapefile ZIP to the 16 MiB direct import, each table to its own dialog with the case chosen again (`AddFilesDialog.tsx:40-44`, `177-186`, `303`). |
| N02 | new | - | The target page lists the first 100 packages by id, committed or not (`intake-targets.ts:220`, `229`, `242`); a file of more than 100 packages (500,000 features is 250) never offers packages 101 and up. |
| N03 | new | - | The area summary sends every proposal id of every package into the API and back on each read (`area-display-window.ts:94-99`, `103-105`); unmeasured above 41,809. |
| N04 | new | - | After a reload, the files not added and still to add are gone (navigation state only, `BatchPage.tsx:50-52`); a stopped upload is not resumed and its v2 receipt holds the one service-wide slot for up to 7 days (`ingestion.ts:226`, `229`). |
| N05 | new | - | A shapefile dropped as loose parts is not assembled: the `.shp` asks a question naming an API route, the `.dbf` rests kept as a table (`intake-draft.ts:111-115`, `intake-signatures.ts:49`). |

## Branches merging now

- **CR1** (merged at `8223ce93`, after this base): an officer states a GPKG or shapefile layer's CRS; a G11 follow-up.
  The Studio routing half of G11 (N01) is not in it.
- **IFC3**: a batch IFC is read on drop; closes G15.
- **AU4-B2**: batch evidence matching by exact key; moves G09 towards closed. G21 needs AU4-B3 as well.
- **G13**: streamed tables; closes G13 and lets a table in a mixed drop (N01) stay in the batch.
- **SB1**: the ortho, DEM and LAZ backend for G14; the map and drop halves are still to come, and G22 follows it.

## What most blocks the demo, by this reading

1. G05 and G08: the press from confirmation to card has never run on a rehearsal.
2. N02: a 500,000-feature file can be read (G16), but only its first 100 packages can be confirmed.
3. N01: a judge's GeoPackage dropped in the Studio never reaches SH2's batch conversion.
4. N04: one reload during a file over 128 MiB blocks the next large file for up to 7 days.
