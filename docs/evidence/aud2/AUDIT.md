# AUD2 — what a judge's file does in the batch drop, after the AUD1 fixes

TASK   AUD2 — judge-format drop audit, post-roll branch      GATE P0 hygiene; no runtime gate claimed
WORKS  Each likely judge file kind is traced from drop forecast to card; ten remaining gaps are ranked.
SEE IT `git show HEAD:docs/evidence/aud2/AUDIT.md`
INPUTS None opened or executed. Static source reading of `task/int2-post-roll` at `53bf7cdc`.
GAPS   Static deduction only; no Docker, database, processor, browser or provider was used.

## Scope and verdict

Audited tree: `origin/task/int2-post-roll` head `53bf7cdc` (22 October 2026), which carries AUD1 fixes
TS2 (table selection), UP1 (reader forecast, early batch), CSV2 (delimiters/encodings), RT1 (keep, then route
by bytes), ZIP2 (mixed ZIP fan-out), PDF1 (OCR on the officer's press), NR1/NR3 (DXF, CityGML, CityJSON
readers), NR2 (point and line streaming), plus SFA1/EVF1. Only this file is added; no code is changed.

**Verdict.** AUD1 gaps 1–7 are closed in code for the cases they named. The honest "kept, not read" outcome is
now the usual failure; the remaining damage comes from four places: (a) a refused small GeoJSON *inside a ZIP*
has no fallback and is described with wrong words, (b) a layer that mixes pins with polygons cannot be laid out
as buildings at all, (c) tables with coordinates and photographed/scanned plans never reach the map, and
(d) the area normalizer stops a city-scale file after its first part wider than 50 km.

Everything below is a deduction from the cited source, not an observed screen. "Map" means the item can reach
**On the map** in the tray. "Card" means a building target can be created (`createIntakeTargetsTx`) and so,
after review and the officer's one confirmation, a property card and registry record. A table or document can
only be *cited evidence* on a card made from a footprint (evidence by key); it never creates a card itself.
Runtime prerequisites are not checked: INT2 states the processor image must be rebuilt for CSV2 and NR3
(`services/geo` changed), and the workbook reader needs `ULPIN_PROFILE_PYTHON`. Without the rebuild an uploaded
CityJSON stops with its pin code (words below) instead of being read.

## The common chain (exact functions)

1. **Drop dialog forecast.** `AddFilesDialog.NewFiles` → `dropState` / `routeWords` (`file-route.ts`) for the
   Detected column; `IntakeDropDialog.DropOutcomes` → `readerEligibility` (`upload-model.ts`) for "Reader estimate".
   The forecast is by name and size only. Kinds absent from its `readers` table say
   *"Kind not known yet: will be kept and recognised after upload"*. (The opt-in NYC profile, `demoImportEnabled`,
   is assumed off on the presentation build.) [^forecast]
2. **Retain route.** `retainBatch` → `retainOriginal` (`retain-batch.ts`). `viaUpload`: a `.geojson/.json`
   below 16 MiB + 1 byte goes to `retainMap` → `POST /sources` (`format=geojson`); a small `.zip` goes to
   `POST /intake/archives`; everything else, and any 413/422 refusal of those two, goes to `/uploads`
   (`createUploadCommand`). Then `POST /intake/items` enrols the source. [^retain]
3. **Probe card.** `IntakeService.register` → `probe` → `probeOriginal` (`intake-probe.ts`) →
   `detectIntakeKind` (`intake-signatures.ts`: `binaryKind`, `jsonKind`, `xmlKind`, text rules) →
   `probeHead` (`probeJson`, `probeDelimited`, `probePdf`, `probeLas`, `probeTiff`, …) and, for ZIP,
   `probeZip` → `officeKind`. Small `/sources` receipts also get `citeIntakeReceipt` (CRS and counts). [^probe]
4. **Reader job.** `IntakeService.publish` calls, in order, `queueShapefileSetTx`, `queueIntakeSurfaceTx`
   (TIFF/LAS/LAZ), else `queueIntakeDraftTx`, then `queueZipLayersTx` and `queueLateIntakeEvidenceTx`.
   `queueIntakeDraftTx` dispatches: ZIP → `settleZipParentTx`; PDF → `queueBatchPdfTx`; PNG/JPEG →
   `readPageImageTx`; IFC → `queueIntakeIfcTx`; DXF/CityGML/CityJSON → `queueIntakeNativeReaderTx`;
   other non-vector → `settleKeptTx`; GPKG/KML/KMZ/shapefile → `queueNativeDerivativeTx`; GeoJSON →
   `retainedGeojsonAdapterTx` → bounded `enrollDraftTx` (`intake-draft` job) or streamed `queueIntakeLargeTx`. [^dispatch]
5. **Officer words.** The item's `limitReason`, shown in the tray's Reason column with `stateWords` /
   `placementWords` (`batch-model.ts`); `IntakeTray.NextStep` offers View layout, Open the table, View structure,
   View page image, Review pages and the CRS answer. [^tray]
6. **Map.** Bounded G: `intake-draft-worker.transition` sets `on_map` when a package exists. Large G: package
   cuts (`intake-part-draft`) after layout approval and `chunk-mapping`. Surfaces: `itemPlacementTx` /
   `frameTx` place against the batch area made by drafted footprints. [^map]
7. **Card.** Only `createIntakeTargetsTx`, called from `intake-draft-worker.transition` and `intake-part-draft`,
   turns package **building** features into targets. `compileMapping` lets only Polygon/MultiPolygon be
   building, parcel or public land. [^card]

## One row per kind

Route: **S** `/sources`, **A** `/intake/archives`, **U** `/uploads`; "S→U" means the bounded route refuses
(413/422) and the browser falls back to U with the first refusal kept in the drop dialog's Reason column.
Words are literal excerpts of the server's templates; "…" omits variable text.

| Kind | Forecast | Route → probe card | Reader job | Officer words (tray) | Map | Card | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GeoJSON small, Polygon, CRS84 or no `crs` | GeoJSON reader (`.json`: kind not known) | S → `geojson`, CRS stated by receipt | `intake-draft` → bounded area normalizer | "No approved layout matches this file…" → package | Yes, after layout approval | Yes | [^retain] [^dispatch] [^card] |
| GeoJSON small, named EPSG:3857 / EPSG:32643 | same | S → `geojson`, `crs.code` from `statedJsonMetadata` | same; `_geojson_crs` reads the named CRS | same; the older building-only layout refuses non-degree units (MAPPING_CRS) | Yes, with a kind-stating layout | Yes | [^crs] |
| GeoJSON small, projected, no `crs` member | same | S→U → `geojson` | `retainedGeojsonAdapterTx` → kept | "The original is kept, not read: The file declares no coordinate system and its coordinates are not longitude and latitude." No CRS question for GeoJSON | No | No | [^crs] [^dispatch] |
| GeoJSON small, Point / Line | same | S → `geojson` | `intake-draft` | layout question; building refused (MAPPING_GEOMETRY_KIND), road/utility allowed | Yes, only as road/utility | No | [^card] |
| GeoJSON small, >2000 features | GeoJSON reader | S (413 RECORD_LIMIT) → U → `geojson` | `intakeReaderRoute` → streamed `intake-large` | "Reading file", then layout question | Yes, after approval | Yes | [^retain] [^dispatch] |
| GeoJSON 16 MiB–1 GiB, Polygon | GeoJSON reader (within 1 GiB) | U → `geojson` | `intake-large` → `streaming-vector` → profile → `chunk-mapping` → cuts | part progress, then holds/count words | Yes, part by part | Yes | [^large] |
| GeoJSON large, Point / Line | same | U → `geojson` | same; six kinds since NR2 | "Read N Point features; they are not footprints." | Only if officer states road/utility | No | [^large] |
| GeoJSON > 1 GiB | "Will be kept, not read: larger than the 1 GiB GeoJSON reader" | U → `geojson` | none | `STREAMING_SOURCE_BUDGET` words | No | No | [^dispatch] |
| GeoJSON spanning > 50 km or > 1° | as size | S or U | normalizer refuses the package | "A part of this file could not be read as a map: Choose a bounded area no more than 50 km across…; nothing more was prepared from it." | Partly (earlier parts) | Partly | [^extent] |
| Shapefile ZIP, 2D, `.prj` resolves | Kind not known (`.zip`) | A (or U) → `zip` with shapefile member | `queueNativeDerivativeTx` (`shapefile_zip`) → `native_gis.py` → GeoJSON layer → large G | "1 layer of this … is converted to GeoJSON and taken in as its own file…" | Yes, after approval | Yes (polygons) | [^native] |
| Shapefile: no `.prj` / unresolvable `.prj` / Z | as above | same | conversion stops per layer | no `.prj`: CRS question (LayerCrsAnswer). Unresolvable: "Not converted until its coordinate reference system is stated" but no question is offered. Z: "Not converted: … (stores Z, M or MultiPatch shapes…)" | No | No | [^native] [^shpz] |
| GeoPackage | native GIS conversion (128 MiB) | U → `geopackage` | native derivative per feature table → large G | conversion words; M layers refused | Yes per layer | Yes (polygons) | [^native] |
| KML | native GIS conversion | U → `kml` (`xmlKind`) | native derivative per Document/Folder → large G | conversion words; mixed pin+polygon folder: building layout refused (MAPPING_GEOMETRY_KIND) | Yes if folder is polygons only | Same condition | [^native] [^mixed] |
| KMZ | native GIS conversion | U → `zip` → `officeKind` → `kmz` | same as KML | same | same | same | [^native] [^zipkml] |
| CSV lat/lon, comma UTF-8 | table reader; "Choose Read as a table after upload" | U → `csv`, `drawableHint` set but unused | none until **Open the table → Read as a table** (`table-profile`) | "Kept as a CSV table (…). Read it as a table with "Open the table"…"; then "creates mapped draft rows, not buildings; nothing enters the register or appears on the map" | No | Evidence only | [^table] |
| CSV with WKT column | same | same | same; no WKT reader anywhere in intake | same | No | Evidence only | [^table] |
| CSV semicolon | same | U → `csv`, delimiter `;` (`chooseTableDelimiter`) | table read with stored delimiter (CSV2) | same | No | Evidence only | [^table] |
| CSV Windows-1252 | same | U → `csv`, encoding `windows-1252` (`decodeDelimitedText`) | table read; full UTF-8 check then 1252 | same | No | Evidence only | [^table] |
| XLSX | table reader | U → `zip` → `officeKind` → `xlsx` + one child per sheet | table read after sheet/header answer | "Kept as a XLSX table…" + Open the table | No | Evidence only | [^table] |
| ODS | Kind not known | U → `ods` (`officeKind`) | none (`itemTableSource` excludes ODS) | "Kept as a ODS table (…). Read it as a table with "Open the table"…" — no such button appears | No | No | [^ods] |
| PDF with text layer (≤10 MiB) | PDF native text (within 10 MiB) | U → `pdf` | `queueBatchPdfTx` → `document-extraction` native | "N pages read. Text was found on pages … passages … name floors…: candidates…" + Review pages | No | Evidence only | [^pdf] |
| PDF scanned (≤10 MiB) | same | U → `pdf` | native read, then OCR on press (one page of 1–8 per job) | "Pages … have no text layer (scanned). Open the PDF reading to request bounded OCR." | No | Evidence only | [^pdf] |
| PDF 10–16 MiB / > 16 MiB | "Will be kept, not read" | U → `pdf` | native stops at 10 MiB; no scanned-page list, so no OCR offer | "The page reader reads a PDF of at most 10 MB…" / "Kept as a PDF document…" | No | No | [^pdf] |
| JPEG / PNG plan | page image preview (128 MiB) | U → `jpeg`/`png` | `intake-page-image` preview | "A … image, … Kept for review as a page image. What does it show: a plan, an elevation, a photo or something else?" Answer is a candidate label only | No | No | [^image] |
| GeoTIFF ≤16 MiB, embedded georef | raster (within 16 MiB) | U → `tiff` | `raster-window` parts (32 × 256²) | "Read k of n windows (…)… Display only…" + placement words | Yes, once the batch has drafted footprints; else "Read but not placed: the batch has no map area yet." | No | [^surface] |
| TIFF > 16 MiB, or TIFF + `.tfw` | "Will be kept, not read" / raster | U → `tiff`; `.tfw` → kept separately | none, or read with "the file states no coordinate system" | "Kept (…). The batch reads a raster of at most 16 MiB natively…" | No | No | [^surface] |
| LAZ 1.4 PDRF 6, ≤16 MiB, ≤5 M points | point cloud (within 16 MiB) | U → `laz` | `point-batch` parts | "Read k of n batches (…)…" | Yes, as raster above | No | [^surface] |
| LAS, or LAZ 1.2/1.3 / other PDRF | `.las`: kind not known; `.laz`: "Will be read by the point cloud reader" | U → `las`/`laz` | none | "Kept. The batch point reader takes compressed LAZ of LAS 1.4 point format 6 only…" | No | No | [^surface] [^forecast] |
| DXF ≤16 MiB | Kind not known | U → `dxf` (ASCII header must open with `0/SECTION/2/HEADER\|ENTITIES`) | `queueIntakeNativeReaderTx` → `dxf-native` | "The DXF reading states N records and M projected entities; they are candidates… states no coordinate reference system… not on the map yet; no record or card target is created." | No | No | [^native3] |
| DWG | Kind not known | U → `dwg` | none | "Kept as a DWG file (…). No reader in a batch takes this kind of file yet…" | No | No | [^kept] |
| IFC ≤32 MiB | IFC structure | U → `ifc` | `queueIntakeIfcTx` → `ifc-native` | "The file states N buildings, N storeys and N spaces; they are candidates." + View structure | No | No | [^ifc] |
| CityGML ≤32 MiB | Kind not known | U → `citygml` (`xmlKind`) | `citygml-native` | "The CityGML reading is … building/part entries…; they are candidates…" | No | No | [^native3] |
| CityJSON ≤8 MiB (`.json`) | Kind not known | S (422) → U → `cityjson` | `cityjson-native` (needs NR3 image) | "The CityJSON reading is supported… Global placement is not qualified." Without the rebuilt image: "The CityJSON reading stopped (…)…" | No | No | [^native3] |
| glTF / GLB | Kind not known | U → `gltf`/`glb` | none (readers exist, not wired) | "Kept as a GLB 3D model (…). No reader in a batch takes this kind of file yet…" | No | No | [^kept] |
| OBJ | Kind not known | U → `obj` only if a `v` and an `f` line lie in the first 64 KiB, else `unknown` | none | "Kept as a OBJ 3D model…" or "Kept (…); its kind was not recognised…" | No | No | [^kept] |
| Mixed ZIP (no KML) | Kind not known | A or U → `zip` | `intake-zip-layers` keeps ≤64 members, each enrolled by its own reader; shapefiles grouped | "N members. … taken out as their own items: … N files kept, not read: …" | Per member | Per member | [^zip] |
| Mixed ZIP containing a KML | Kind not known | A or U → `kmz` (any KML member) | KMZ conversion only; `queueZipLayersTx` skips non-`zip` | KMZ conversion words; other members unnamed | KML only | KML only | [^zipkml] |
| ZIP with a small GeoJSON the bounded route refuses | Kind not known | A or U → `zip` | `keepLayer` → `ManualIngestionService.retain` throws 413/422 | "RECORD_LIMIT: this member stays inside the archive and was not kept as its own original. Enrol the archive again to retry." | No | No | [^ziprefuse] |

## Ranked gaps

Rank = how likely a judge brings it × how bad the outcome is (wrong or missing words worst, a stop after a
partial read next, an honest "kept, not read" least). "Docker" means only that a runtime rehearsal needs the
Docker-hosted stack; "image" means a processor image rebuild is required because `services/geo` changes.

1. **A refused small GeoJSON inside a ZIP is lost, with wrong words.** `keepLayer` sends members of up to
   16 MiB to `ManualIngestionService.retain`, which keeps the original and then throws for >2000 features,
   a single Feature, GeometryCollection or an undeclared projected CRS. The member is noted "was not kept as its
   own original. Enrol the archive again to retry", which is false (a source row exists) and retrying repeats it.
   The browser has the RT1 fallback; the ZIP worker does not. *Fix:* in `intake-zip-layers.ts` `keepLayer`, catch
   `AppError` 413/422 from `dependencies.retain` and call `dependencies.retainMember` (the byte receipt) with the
   same lineage; let enrolment route by bytes as for a dropped file. Give `notKept` a non-retry sentence for
   other codes. TS only; unit test without Docker; no image.
2. **A layer mixing pins/lines with polygons cannot become buildings.** `compileMapping` refuses the whole
   layout when any feature type is not Polygon/MultiPolygon, so a Google Earth KML folder with one pin, or a
   GeoJSON/GPKG layer with a stray point, yields no footprints and no card. `area.py` already sets aside
   non-polygons per feature (`GeometryRejected`, code `GEOMETRY_KIND`) and counts them. *Fix:* in `registry.ts`
   `compileMapping` (used by `compileStreamedMapping`), accept polygon kinds when the profile has at least one
   polygon type and an explicit officer acknowledgement that the stated non-polygon count is set aside; show the
   count with the existing holds words (`intakeLargeHoldsReason`). TS and Studio layout question only; no image.
3. **CSV/XLSX with lat/lon or WKT never reaches the map.** The probe sets `drawableHint`, the forecast says
   "Will be read by the table reader", but reading only creates draft rows; there is no point/WKT bridge.
   The words are honest. *Fix:* a table-to-GeoJSON derivative beside `queueNativeDerivativeTx` that converts
   officer-named coordinate columns and a stated EPSG (never guessed) into a retained GeoJSON with row locators,
   then the large G path (points as road/utility, WKT polygons as buildings). New officer question in
   `BatchTableSection.tsx`. TS-only if written in the server; image if added to `native_gis.py`; Docker to rehearse.
4. **Scanned or photographed plans stop early.** A PDF above 10 MiB ends `NATIVE_READER_BYTE_LIMIT`, so
   `documentScannedPages` returns nothing and no OCR is offered; OCR reads one page of pages 1–8 per press; a
   JPEG/PNG labelled "plan" stays a candidate label. Words are honest. *Fix:* in `pdf-reading.ts` /
   `BatchPdfSection.tsx` offer page-1 OCR when the native read ended on its byte limit and the original is
   ≤16 MiB (`queueBatchPdfTx` already admits it); route a "plan" label from `intake-page-image.ts` to the same
   `document-ocr.ts` job. Needs the document runtime: Docker yes; image only if OCR dependencies change.
5. **City-scale vector files stop after the first wide part.** `normalize_area` refuses a package whose extent
   exceeds 1°, 50 km, or 50 km from the area origin; package cuts are in file order, so a district or city file
   reads, maps some parts, then rests with "nothing more was prepared from it". *Fix (words first):* use the
   streamed reader's kept bounds in `intake-large.ts` at the question phase to say before approval that the file
   spans more than one 50 km area. *Real fix:* cut by a spatial grid in `intake-package-cuts.ts` and bind each
   cell to its own area in `intake-destination.ts`. TS only; Docker to rehearse; no image.
6. **A ZIP holding any KML is read as a KMZ, silently dropping its other members.** `officeKind` sets `kmz`
   when any member is KML; `queueZipLayersTx` then returns early, so PDFs, CSVs or shapefiles inside are never
   taken out or named. *Fix:* in `intake-zip.ts` `officeKind`, mark `kmz` only when every independent member is
   KML or a KMZ resource; otherwise keep `zip`, and let fan-out give the KML its own original (it then takes the
   KML native derivative). TS only; no Docker for the unit check; no image.
7. **Shapefile CRS and Z refusals.** An unresolvable `.prj` (`statesCrs`) gets "Not converted until its
   coordinate reference system is stated" but no answer is offered (only `!statesCrs` layers are asked); PolygonZ
   and other Z shapefiles are refused outright. *Fix:* words in `intake-native-derivative.ts` `nativeParentState`
   for `statesCrs` layers ("states a system that does not resolve to one EPSG code; it is not converted"); accept
   shape types 11/13/15 in `native_gis.py` `_shapefile_layer`, keeping Z as written like GeoJSON Z. Image yes.
8. **ODS words promise a button that does not exist.** `keptWords` tells every table to use "Open the table";
   `itemTableSource` omits ODS. *Fix:* in `intake-draft.ts` `keptWords`, say "Open the table" only for
   csv/tsv/xlsx and "No table reader in a batch takes ODS yet" otherwise (also fix "a XLSX/ODS" to "an").
   Wiring `native_ods.py` into `tabular-source.ts` is the larger fix (image yes). Words fix: TS only.
9. **The drop forecast misdescribes some kinds.** `readerEligibility` promises the point reader to every
   LAZ ≤16 MiB (only LAS 1.4 PDRF 6 is read), and says "Kind not known" for `.json`, `.dxf`, `.gml`, `.zip`,
   `.las` that the server reads or refuses predictably; after a fallback the drop dialog still shows the first
   refusal ("…FeatureCollection originals only") beside "Added to batch". *Fix:* extend the `readers` table in
   `upload-model.ts` (DXF 16 MiB, CityGML 32 MiB, LAZ note "LAS 1.4 point format 6 only", `.json` "GeoJSON or
   CityJSON, checked after upload") and prefix a fallback reason in `retain-batch.ts` with "Kept through upload:".
   Studio only; no Docker; no image.
10. **ZIP parent words call read members unread.** `zipMemberHasReader` lacks `dxf`, `citygml`, `cityjson`
    and `tsv`, so the archive row lists them as "kept, not read (own item; no batch reader)" while their own items
    are read. *Fix:* add those formats in `intake-draft.ts` `zipMemberHasReader`. TS only; no Docker; no image.

Not ranked: DWG, glTF/GLB and OBJ are honestly kept (readers for glTF/OBJ exist but are not wired; DWG needs a
licensed converter); IFC, DXF, CityGML and CityJSON are read as candidates only, with no map or card bridge
(no Studio path reaches `source-fusion*`). An ASCII DXF beginning with a `999` comment, or an OBJ whose first
64 KiB holds no face line, is probed as `unknown` and kept with "its kind was not recognised".

## Evidence index (repository file:line)

[^forecast]: `apps/studio/src/features/intake/upload-model.ts:62-93`, `IntakeDropDialog.tsx:177-190`,
  `file-route.ts:9-56`, `AddFilesDialog.tsx:149-166`, `apps/studio/src/api/demo-import.ts:11`.
[^retain]: `apps/studio/src/features/intake/retain-batch.ts:32-115`;
  `packages/server/src/modules/usp/ingestion/service.ts:404-434,518-529` (retain first, then count/inspect).
[^probe]: `packages/server/src/modules/usp/ingestion/intake-probe.ts:29-112`, `intake-signatures.ts:16-130`,
  `intake-text.ts:35-55,113-165`, `intake-zip.ts:178-201`, `intake-ledger.ts:175-208`.
[^dispatch]: `packages/server/src/modules/usp/ingestion/intake-service.ts:133-166`,
  `intake-draft.ts:140-154,157-182,203-273`.
[^tray]: `apps/studio/src/features/intake/IntakeTray.tsx:18-68`, `batch-model.ts:7-17`.
[^map]: `packages/server/src/modules/usp/ingestion/intake-draft-worker.ts:186-205`,
  `intake-surface.ts:421-500`.
[^card]: `packages/server/src/modules/usp/ingestion/intake-targets.ts:71-95`, `registry.ts:98-104`,
  `packages/contracts/src/usp/ingestion.ts:36`.
[^crs]: `services/geo/geo/area.py:77-96,158-162`; `packages/server/src/modules/usp/ingestion/registry.ts:109-112`;
  `intake-draft.ts:212-230`.
[^large]: `packages/server/src/modules/usp/ingestion/intake-large.ts:124-168`, `intake-large-worker.ts:52-67`,
  `streaming-vector-worker.ts:330-370`.
[^extent]: `services/geo/geo/area.py:35,467,478,486`; `packages/server/src/modules/usp/ingestion/intake-large.ts:96-103`;
  `intake-package-cuts.ts:7-10,50-55`.
[^native]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:40-54`,
  `intake-native-derivative.ts:218-262,299-330`; `services/geo/geo/native_gis.py:515-540,640-665,697-730`.
[^shpz]: `services/geo/geo/native_gis.py:661-662`; `intake-native-derivative.ts:54-56,312-322`.
[^mixed]: `packages/server/src/modules/usp/ingestion/registry.ts:98-104`; `services/geo/geo/area.py:437-447`.
[^zipkml]: `packages/server/src/modules/usp/ingestion/intake-zip.ts:197-200`, `intake-zip-layers.ts:151-153`.
[^table]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:140-154`, `delimited-text.ts:17-74`,
  `intake-text.ts:35-55`, `intake-evidence.ts:280-285`; `apps/studio/src/features/intake/BatchTableSection.tsx:23-31,107-119`;
  `docs/evidence/csv2/result.json` (decisions).
[^ods]: `packages/server/src/modules/usp/ingestion/intake-zip.ts:191-196`, `intake-draft.ts:146-151`;
  `apps/studio/src/features/intake/BatchTableSection.tsx:23-26`.
[^pdf]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:324-395`, `document-native.ts:69`;
  `packages/contracts/src/usp/document-ingestion.ts:5-7,13-16`; `apps/studio/src/features/intake/BatchPdfSection.tsx:45-92`.
[^image]: `packages/server/src/modules/usp/ingestion/page-image-read.ts:25,204-215`, `intake-page-image.ts:39-85`.
[^surface]: `packages/server/src/modules/usp/ingestion/intake-surface.ts:33-58,79-101,421-500`.
[^native3]: `packages/server/src/modules/usp/ingestion/intake-native-readers.ts:23-49,87-112,114-182`;
  `intake-signatures.ts:96-104,119-121`; `docs/evidence/nr3/HANDOFF.md`; `docs/evidence/int2/HANDOFF.md`.
[^kept]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:131-154,291-298`, `intake-signatures.ts:39-40,122-123`.
[^ifc]: `packages/server/src/modules/usp/ingestion/intake-ifc.ts:9-76`.
[^zip]: `packages/server/src/modules/usp/ingestion/intake-zip-layers.ts:113-120,243-261,290-318`,
  `intake-draft.ts:71-109`; `docs/evidence/zip2/HANDOFF.md`.
[^ziprefuse]: `packages/server/src/modules/usp/ingestion/intake-zip-layers.ts:202-215,290-318`,
  `service.ts:518-529`, `registry.ts:44-50`.

## Verification

Source reading with `git show`, `grep`, `sed` and `cat` on the named branch; no application, test, Docker,
database, processor, provider or data-drive access. No real input was opened; no timings or accuracy are claimed.
Line ranges were taken from the audited head. Before relying on any row, rehearse one good and one difficult
input of that kind on an authorized runtime with the rebuilt processor image.
