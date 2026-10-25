# AUD4 — what a judge's file can do on this base

TASK   AUD4 — judge-file routes and remaining gaps             GATE P0 hygiene; static audit only
WORKS  The presenter can distinguish retained bytes, candidate readings, map paths and card paths.
SEE IT `git show HEAD:docs/evidence/aud4/AUDIT.md`
INPUTS No real inputs executed. One ordinary and one colliding-header source-function control only.
GAPS   No combined application, browser, processor, host-profile, database or performance qualification.

## Scope and verdict

This is a trace of the checked-out base, not a forecast of several branches composed together as in AUD3.
The exact base and evidence-reference commits are in `result.json`. No fetch, service, Docker, provider,
credential file, external data original or prohibited directory was used. All shell temporary-directory variables
were set to `E:/ulpin-tmp`. Only this evidence directory is changed.

Read AUD3 first from `origin/task/aud3-judge-files:docs/evidence/aud3/AUDIT.md`, then all 32 named landed
`docs/evidence/<task>/result.json` receipts and the relevant current code. Prior test counts are **not** AUD4 runs.
NM1's requested remote ref is absent locally; its **local** branch's `result.json` was read instead, without
switching branches. GB1's remote `result.json` was read. Neither branch's code is credited to this base.
NM1 reports outline-name eligibility; GB1 reports exact same-case glTF buffer bindings, with later-buffer and
ZIP caveats. LP1, PB1, OD2 and GB2 remain excluded from the proposed build work below.

**Verdict:** ordinary keyed polygon GIS has a candidate-map-to-reviewed-card chain. Mixed pins/lines no longer
veto outline keys, including on the streamed path. Tables are kept first, promote row-bound reads to streaming,
and have placement from both batch and standalone pages. Small ODS now joins that path; XLS stays honestly kept.
Wide measurable files can produce independent cell batches. Declared-system CityGML joins CityJSON's narrow
source-ground-outline bridge. Native CAD/mesh readings still do not make located buildings or card targets.

**Most urgent newly found seam:** the server now places BOM-marked UTF-16 tables, but the Studio still removes
the placement control and says to re-save them. The other immediate word defects are an overconfident 3D forecast
and a new standalone-table help sentence that again calls prepared rows placed.

### How to read this report

All file:line citations below are at this checkout unless explicitly labelled as branch evidence.
Path aliases, used to keep the matrix readable:

- `I/` = `packages/server/src/modules/usp/ingestion/`
- `U/` = `apps/studio/src/features/intake/`
- `G/` = `services/geo/geo/`
- `C/` = `packages/contracts/src/usp/`
- `A/` = `packages/server/src/modules/areas/`
- `R/` = `packages/server/src/modules/registry/`

**Map “Yes*”** means a traced path to candidate placement, not a witnessed screen. It requires readable bytes,
accepted geometry, a usable source system, a complete literal source key and officer-approved layout. No key or
geometry is invented. Points/lines require a compatible road/utility layout and never become building outlines.
**Card “Yes*”** means building polygons can reach targets and the existing confirmation/card chain, not issuance
on upload. **E** means evidence can support an independently anchored, reviewed record; not a new card target.
**Part** means accepted subsets only. Every Yes/Part cell needs a combined-build rehearsal.

## 1. File-kind matrix

Forecast keys give the actual words in §2. Routes and reader codes are expanded with file:line in §3.
`S` = `/sources`; `U` = `/uploads`; `A` = `/intake/archives`; all batch files then enrol via `/intake/items`.
`S/U` means S through 16 MiB, U above it; S/A content refusals 413/422 fall back to U, not other refusals.
`T0` is the standalone table dialog, now U-first, with an explicit enrol-on-placement bridge.
This is the normal production route with the opt-in development import profile off; its actual deployed flag was
not inspected (`apps/studio/src/api/demo-import.ts:11`, `U/file-route.ts:16-19`). Retention still requires
private access, upload capacity and byte quotas (`U/upload-model.ts:26-33`, `C/ingestion.ts:228-243`).

| Likely judge file | Words | Route | Reader / fact | Map | Card |
| --- | --- | --- | --- | --- | --- |
| Small polygon GeoJSON | G | S/U | GB, I/registry.ts:30 | Yes* | Yes* |
| Large/many-feature GeoJSON | G | S→U/U | GL, I/intake-draft.ts:223 | Yes* | Yes* |
| Mixed polygon/pin/line GeoJSON | G | S/U | MX, I/registry.ts:167 | Part | Part |
| Point/line-only GeoJSON | G | S/U | GB/GL, I/registry.ts:167 | Yes* | No |
| Wide GeoJSON, measurable CRS | G | S→U/U | CW, I/intake-large-worker.ts:251 | Part* | Part* |
| Wide GeoJSON, other stated CRS | G | S/U | I/intake-package-cuts.ts:112 | Not assured | Not assured |
| Projected GeoJSON, no CRS | G | S→U/U | G/area.py:386 | No | No |
| Lone GeoJSON Feature | G | S→U/U | I/registry.ts:34 | No | No |
| GeometryCollection geometry | G | S→U/U | I/streaming-vector-reader.ts:259 | No for it | No for it |
| GeoJSON above 1 GiB | G-over | U | I/intake-draft.ts:303 | No | No |
| GeoJSON with late root type | G | S/U | I/intake-signatures.ts:56 | Not assured | Not assured |
| ZIP of independent kinds | Unknown | A/U | Z, I/intake-zip-layers.ts:244 | Part | Part |
| ZIP: several KMLs / extra photo | Unknown | A/U | Z, I/intake-zip.ts:219 | Part | Polygons* |
| KML | GIS | U | V, G/native_gis.py:1107 | Part | Polygons* |
| KMZ, one proven KML/resources | GIS | U | V, G/native_gis.py:1079 | Part | Polygons* |
| Loose .shp/.shx/.dbf set | SHP | U each | SET, I/intake-native-derivative.ts:207 | Part | Polygons* |
| Shapefile ZIP, 2D | Unknown | A/U | V, G/native_gis.py:583 | Part | Polygons* |
| Shapefile Z: 11/13/15 | SHP/Unknown | U/A | G/native_gis.py:682 | Part | Polygons* |
| Shapefile M / MultiPointZ | SHP/Unknown | U/A | G/native_gis.py:663 | No | No |
| Shapefile, missing .prj | SHP/Unknown | U/A | G/native_gis.py:642 | After answer* | Polygons* |
| Shapefile, odd stated .prj | SHP/Unknown | U/A | G/native_gis.py:647 | If resolved* | Polygons* |
| GeoPackage feature tables | GIS | U | V, G/native_gis.py:501 | Part | Polygons* |
| GeoPackage tiles only | GIS | U | G/native_gis.py:507 | No | No |
| CSV, lat/lon | Table/T0 | U/T0 | T→TC, I/table-geojson.ts:79 | Yes* | E |
| TSV, lat/lon | Table | U | T→TC, U/BatchTableSection.tsx:32 | Yes* | E |
| XLSX, lat/lon | Table/T0 | U/T0 | T→TC, I/tabular-stream.ts:438 | Yes* | E |
| CSV/TSV/XLSX, polygon WKT | Table/T0 | U/T0 | TC, I/wkt.ts:108 | Yes* | Yes* |
| CSV ; / pipe / tab, UTF-8/1252 | Table/T0 | U/T0 | I/delimited-text.ts:17 | If spatial* | WKT only* |
| BOM UTF-16 LE/BE CSV/TSV | Table/T0 | U/T0 | I/tabular-stream.ts:148 | API Yes; UI No | UI E |
| Other legacy text encoding | Table/T0 | U/T0 | I/delimited-text.ts:25 | Unqualified | Unqualified |
| Small table above 2,000 rows | Table/T0 | U/T0 | I/service.ts:685 | If spatial* | WKT only* |
| ODS within whole-read bounds | ODS/T0 | U/T0 | I/tabular-stream.ts:480 | If spatial* | WKT only* |
| ODS over whole-read bounds | ODS-over | U/T0 | I/tabular-workbook.ts:35 | No | No |
| Excel 97–2003 .xls | XLS | U | KEEP, I/intake-draft.ts:168 | No | No* |
| Text-layer PDF ≤10 MiB | PDF | U | PDF, I/document-native.ts:63 | No | E |
| Scanned PDF ≤16 MiB, ≤8 pages | PDF/OCR | U | OCR, U/pdf-reading.ts:51 | No | E |
| Text PDF >10–16 MiB | OCR | U | I/document-native.ts:69 | No | E via OCR* |
| Scanned PDF >8 total pages | PDF/OCR | U | U/pdf-reading.ts:57 | No | No text* |
| PDF >16 MiB | PDF-over | U | I/intake-draft.ts:367 | No | No |
| JPEG plan photo | Image | U | IMG, I/page-image-read.ts:167 | No | No* |
| PNG plan image | Image | U | IMG, I/page-image-read.ts:167 | No | No* |
| DXF ≤16 MiB | DXF | U | ND, I/dxf-worker.ts:112 | No | No* |
| DWG | Unknown | U | KEEP, I/intake-signatures.ts:39 | No | No |
| IFC ≤32 MiB | IFC | U | IFC, I/ifc-worker.ts:112 | No | No* |
| CityGML ≤32 MiB | GML | U | ND→OUT, G/citygml_outline.py:212 | Part* | Part* |
| CityJSON ≤8 MiB | CJ/JSON | S→U/U | ND→OUT, G/cityjson_outline.py:113 | Part* | Part* |
| glTF ≤16 MiB | Mesh | U | ND, G/native_gltf.py:464 | No | No* |
| GLB ≤16 MiB | Mesh | U | ND, G/native_gltf.py:154 | No | No* |
| OBJ ≤16 MiB | OBJ | U | ND, G/native_obj.py:122 | No | No* |
| LAS uncompressed / other LAZ | Points | U | I/intake-surface.ts:55 | No | No |
| LAZ 1.4 format 6 ≤16 MiB | Points | U | SURF, G/point_batch.py:35 | Yes* | No |
| GeoTIFF/raster ≤16 MiB | Raster | U | SURF, G/raster_window.py:54 | Yes* | No |
| Raster >16 MiB | Raster-over | U | I/intake-surface.ts:47 | No | No |
| Unreferenced TIFF / world file | Raster/Unknown | U each | I/page-image-read.ts:25 | No* | No* |
| Unknown binary | Unknown | U | KEEP, I/intake-draft.ts:165 | No | No |

Important boundaries:

- Small means ≤16 MiB **and** ≤2,000 features, unless a derivative or measured-wide file selects streaming.
  GL is at most 1 GiB / 500,000 features, with geometry/record budgets too (`C/streaming-vector.ts:5-9`).
  A bare GeometryCollection is not recognised by `rootJsonType`; a collection containing one cannot map that
  geometry. A lone Feature is recognised but the bounded adapter requires a FeatureCollection.
- MX uses outline-only identity facts in both paths (`I/registry.ts:70-108`, `I/streamed-mapping.ts:29-42`).
  Optional names still require whole-file completeness here; NM1 is not merged. Choosing no name avoids that
  name-only refusal. Pins/lines are counted aside, never buffered into buildings.
- CW creates children only for outside-first-area features, at EOF; it does not put the entire city on one map.
  Each cell has its own case, layout and confirmation. First 64 cells, 128 MiB per child; oversized atomic
  features remain held. Other source systems/non-UTM destination frames can still take size-only cuts and stop
  at normalization (`I/intake-package-cuts.ts:112-135`). See N7.
- GIS conversion needs complete companions and usable CRS. Missing shapefile CRS may take an officer EPSG
  answer; an unresolved source-stated `.prj` cannot. Z remains source positions, not measured height. M values,
  MultiPatch and MultiPointZ are not converted (`G/native_gis.py:637-678`).
- T/TC preserves the source and requires table read, coordinate/WKT selection, explicit EPSG, then the child
  GeoJSON's layout. Lat/lon makes points, not buildings. WKT is 2D Point/LineString/Polygon and Multi variants;
  Z/M, curves and collections are refused, EMPTY/blank is skipped. Formula/error/unstored coordinate cells
  are skipped and counted (`I/table-geojson.ts:79-89`, `I/wkt.ts:108-125`).
- CSV/XLSX streaming is capped at 7 GiB / 1 million records / 256 columns, not unlimited
  (`C/ingestion.ts:128-133`). BOM UTF-16 is supported by the server, including source-byte locators; Studio
  still suppresses placement. Other encodings are not identified beyond BOM/UTF-8/1252 fallback. No decimal
  comma coordinate parser is provided (`I/wkt.ts:13-20`).
- ODS is bounded whole-file reading, not OD2's future stream: 16 MiB, native XML-element budgets, 2,000
  resulting data rows, 256 columns. Repeats are expanded; see W5 for the imprecise cell-budget words.
  XLS has no cell reader; `No*` does not prohibit some other reviewed workflow citing a retained original.
- PDFs: OCR opens at most eight **total** pages, not pages 1–8 of a longer PDF, one page/job, with 32 document
  jobs/source (`U/pdf-reading.ts:30-59,164-181`). Text extraction has its own page/content/output limits
  (`G/native_pdf.py:149-175`). Scanned/text mixes may yield only their text-layer passages. None extracts rooms.
- `No*` for JPEG/PNG/CAD/IFC/mesh means no traced batch target/card bridge, not a ban on later source citation.
  Page images supply metadata/preview/label only. IFC supplies structure candidates; local meshes are not maps.
- OUT requires a Building's own source-ground geometry, not a bounding box, roof silhouette or composed parts.
  Missing/local/unusable CRS, absent outlines or unusable dimensions stay unplaced. Supported EPSG alone does
  not ensure a child, layout or map. CityGML handles inline polygons, not unresolved XLinks.
- SURF additionally requires a batch area/reference/extent, available transform and intersection
  (`I/intake-surface.ts:429-469`). It is display-only. World files are not a loose-upload placement bridge;
  unreferenced TIFF can become a page image. LAZ also needs standard 30-byte format-6 records without extra
  dimensions (`G/point_batch.py:67-69`). Raster/point part caps leave a named unread remainder.

## 2. Exact forecast words

These are name/size forecasts, not byte validation. `U/upload-model.ts:73-152` is the source for all entries.
Below a plain reader ceiling the template is **“Will be read by the {name} reader (within {limit})”**;
above it, **“Will be kept, not read: larger than the {limit} {name} reader”**. The special cases are:

| Key | Reader name / ceiling, or exact special forecast |
| --- | --- |
| G | GeoJSON / 1 GiB; G-over uses the above-limit template |
| GIS | native GIS conversion / 128 MiB |
| SHP | GIS plus “A complete shapefile set is needed.” |
| Table | table / 7 GiB plus “Choose Read as a table after upload.” |
| ODS | ODS table / 16 MiB plus the same table instruction |
| XLS | “Excel 97-2003 workbook.” plus W6's kept/cell-unread words |
| PDF | PDF native text / 10 MiB |
| OCR | “Text layer not read above 10 MiB, but its pages can be read by OCR when the PDF has at most” |
| OCR continued | “8 pages, checked after upload (within 16 MiB)” |
| PDF-over | PDF document / 16 MiB, above-limit template |
| Image | page image preview / 128 MiB |
| DXF | DXF / 16 MiB plus “Its reading is kept as evidence, not placed on the map.” |
| IFC | IFC structure / 32 MiB |
| Mesh | glTF / 16 MiB plus the same evidence-only sentence |
| OBJ | OBJ / 16 MiB plus the same evidence-only sentence |
| Raster | raster / 16 MiB |
| Unknown | “Kind not known yet: will be kept and recognised after upload” |

Additional special forecasts:

- **JSON**: “Read as GeoJSON, CityJSON or glTF JSON once its bytes are checked (within 1 GiB).” Then:
  “A CityJSON is read up to 8 MiB and glTF JSON up to 16 MiB; other JSON is kept, not read.” It continues with
  the overconfident ground-outline clause quoted in W2, and the evidence-only alternative for glTF.
- **CJ**: “Read by the CityJSON reader when its bytes show a CityJSON city model (within 8 MiB).” Then W2.
- **GML**: “Read by the CityGML reader when its bytes show a CityGML city model (within 32 MiB).” Then:
  “Other GML is kept, not read.” Then W2. `.xml`/`.citygml` suffixes still get Unknown, though bytes can select it.
- **Points**: “Points are read when the file is compressed LAZ of LAS 1.4 point format 6 with at most
  5 million points (within 16 MiB). Other point files are kept, not read.” This remains correct on this base;
  do not update it for unmerged LP1 in an audit.
- **T0** is not a reader estimate in the standalone picker: “Table · opens the table import”. In a batch it
  becomes “Table · kept in the batch, then read there as a table” (`U/file-route.ts:39-46`).

Other route words: ZIP “ZIP · the batch reads what it holds”; GIS “Map file · joins the batch”;
IFC “Building model · joins the batch”; meshes/CAD otherwise “Original · kept in the batch”. XLS's explicit
kept route is at `U/file-route.ts:51`. TSV remains a batch route rather than T0.

## 3. Traced route/reader catalogue

- **Front door / retention:** `NewFiles` → `dropState` → `IntakeDropDialog` or `TableImportDialog`
  (`U/AddFilesDialog.tsx:132-204`, `U/file-route.ts:9-19`). Batch `retainBatch` serially keeps then enrols
  each original; `viaUpload` and 413/422 fallback are `U/retain-batch.ts:32-106`.
  `IntakeService.register/prepare/probe/publish` checks retained-source pins, byte-probes, then dispatches
  shapefile-set, surface, draft/native and ZIP work (`I/intake-service.ts:113-194`).
- **Probe:** `probeOriginal` → `initialCard/detectIntakeKind` → head/ZIP structure
  (`I/intake-probe.ts:29-56,84-113`, `I/intake-signatures.ts:16-249`). First 64 KiB governs signatures;
  SG1 accepts leading DXF comment groups, more OBJ numbers and XML prologs, not arbitrary late root types.
- **GB:** `retainedGeojsonAdapterTx/prepareRetainedGeojsonTx` → inventory/inspection → bounded draft job →
  approved recipe execution → `ingestArea/normalizeAreaImport` → geo `normalize_area` → K.
  `I/intake-draft.ts:249-320`, `I/service.ts:562-590`, `I/intake-draft-worker.ts:153-231`,
  `A/areas.ts:632-657`, `G/area.py:349-535`. Source coordinates and review fences remain in that chain.
- **GL / MX:** `queueIntakeLargeTx/runIntakeLargeJob` → raw streamed reader + cumulative profile → officer
  layout → chunk mapper → `pairMappedFeatures` → `IntakePackageCutter` → proved-part draft → K.
  `I/intake-large-worker.ts:136-158,182-207,302-373`, `I/streaming-vector-reader.ts:129-170`,
  `I/intake-package-cuts.ts:81-95,149-195`, `I/proved-area-part.ts:33-51,94-123`.
  Mixed key validation uses `I/registry.ts:153-204` and `I/streamed-mapping.ts:29-76`; set-aside accounting
  is in `I/intake-large-worker.ts:75-105` and `G/area.py:327-343,417-425`.
- **CW:** SW1 measures bounded bytes and diverts wide files (`I/service.ts:487,568-579`,
  `I/intake-draft.ts:223-231`). The cutter holds outside-first-area ranges; at EOF `deriveCellFiles` replays
  sealed pairs, writes byte-exact child FeatureCollections and enrols each independent case.
  `I/intake-large-worker.ts:251-299`, `I/intake-cell-files.ts:24-49,128-185`.
- **Z / SET / V:** ZIP independent members → retain byte receipt or bounded GeoJSON with fallback → enrol;
  grouped shapefile companions instead use native conversion (`I/intake-zip-layers.ts:114-121,244-329`).
  Loose sets use `queueShapefileSetTx` (`I/intake-native-derivative.ts:207-237`).
  `convertNativeLayers` → geo `/internal/area/convert-native` → per-layer converter → retained GeoJSON
  child → GL (`I/intake-native-derivative.ts:404-458`, `G/native_gis.py:1154-1171`).
  KML/KMZ is `G/native_gis.py:786-837,1079-1135`; GPKG is `:501-574`; shapefiles are `:583-735`.
- **T0 / T / TC:** standalone `readKeptTable` uploads once, then follows the table read
  (`U/table/useRetainTable.ts:20-31,35-64`). `TablePlacement` enrols that same source, no re-upload
  (`U/table/TablePlacement.tsx:25-55`). Batch `itemTableSource/ItemTable` opens the shared table read and
  placement dialog (`U/BatchTableSection.tsx:26-79`).
  `ManualIngestionService.tableFromOriginal` reads whole or queues streaming, promoting `TABULAR_ROW_LIMIT`
  (`I/service.ts:667-699`). Delimited windows, workbook windows and bounded ODS windows are in
  `I/tabular-stream.ts:143-289,438-549`. Officer `placeTable` → fenced `queueTableGeojsonTx` →
  `writeTableGeojson/placeTableRows` → byte receipt and child enrolment → GL
  (`I/intake-service.ts:313-340`, `I/table-geojson.ts:120-165,215-244,367-413`).
  WD1's parent words now say “Prepared”; they do not prove the child's placement (`I/table-geojson.ts:273-286`).
- **PDF / OCR:** dispatch queues the document reader within 16 MiB (`I/intake-draft.ts:361-378`);
  native text reader stops above 10 MiB (`I/document-native.ts:63-70`, `G/native_pdf.py:34-60`).
  Settlement differentiates text/no-text/refusal (`I/intake-draft.ts:424-453`). OCR page metadata, selection
  and sequential existing jobs are `U/pdf-reading.ts:51-59,113-142,164-181`; native OCR work is
  `I/document-worker.ts:52-78`, `I/document-ocr.ts:133`. No target creation in this route.
- **IMG:** `readPageImageTx/queuePageImageTx` → header + bounded sharp preview → stored candidate label only.
  `I/intake-draft.ts:340-344`, `I/intake-page-image.ts:35-85`, `I/page-image-read.ts:167-222`.
- **IFC / ND / OUT:** IFC queue and settlement are `I/intake-ifc.ts:25-75`; its worker invokes `processIFC`
  at `I/ifc-worker.ts:112`. Native dispatch table, admission and settlement are
  `I/intake-native-readers.ts:28-68,104-129,235-260`; DXF/CityGML/glTF/OBJ workers call their existing
  host processors (`I/dxf-worker.ts:112`, `I/citygml-worker.ts:112`, `I/gltf-worker.ts:112`,
  `I/obj-worker.ts:112`). CityJSON calls geo (`I/cityjson-worker.ts:23-42,77-96`).
  Accepted CityGML or declared-system CityJSON queues OUT, retaining the native reading id.
  `G/citygml_outline.py:72-87,154-243` and `G/cityjson_outline.py:36-51,68-151` select only source-ground
  outlines, then V/GL. Other native summaries stay candidate evidence, with no K.
- **SURF:** `surfaceReader/queueIntakeSurfaceTx` → existing raster/point part jobs → accepted parts →
  source-to-local transform/intersection → display, never K. `I/intake-surface.ts:40-108,169-210,429-539`;
  `G/raster_window.py:54`, `G/point_batch.py:35`.
- **KEEP:** `keptOnly/settleKeptTx` uses the byte-probed kind and keeps unsupported originals with their hash,
  not a conversion success (`I/intake-draft.ts:159-179,329-336`).
- **K, map to card:** only building features make automatic intake targets (`I/intake-targets.ts:71-90`).
  Prepare/review/readiness precede officer `confirmIntake`; commit and source citation precede snapshot,
  packet and `generatePropertyCard`; verification gates the final carded state.
  `I/intake-confirmations.ts:153-181`, `I/intake-run-worker.ts:87-105,139-183,205-302,325-375`.
  Neither teacher output, a table derivative nor surface display bypasses confirmation.

### Cross-cutting changes are not measured speedups

ZP2 folds enrolled members once (`I/intake-ledger.ts:71-74`) and recovers event replay refusal
(`U/case-subscription.ts:115-139`). MF1 batches authority reads (`I/intake-service.ts:196-213`).
TR1 and SL1 share item-only refreshes between tray and map (`U/item-refresh.ts:20-122`,
`U/BatchPage.tsx:36-58`, `apps/studio/src/features/map/surface/useSurfaceLayer.ts:31-34`).
TC2/TC3 preserve the package fence while naming the actual batch parent for derived receipts
(`I/large-original.ts:351-378`, `I/service.ts:52-60,599-607,632-637`).
IL1 removes dispatch-selection barriers (`packages/server/src/modules/cases/processing.ts:244-253`);
CC1 chains bounded ready card jobs (`I/intake-run-worker.ts:554-566`). RV1 reads matching stored envelopes
without rewriting records (`R/registry-record-evidence.ts:69-76`, `R/registry.ts:101-114`).
These are code facts, not evidence that a judge's drop is fast or that all SQL paths work together.

## 4. Every AUD3 gap, revisited

“Closed” here means its specific code defect is removed, **not** a runtime gate pass.

1. **Closed — premature table-parent placement words.** WD1's `tablePlacementWords` distinguishes prepared,
   retained-but-not-enrolled and child placement (`I/table-geojson.ts:273-286`). The new T0 help reintroduces
   a smaller related wording defect, W3/N3; it does not undo the server correction.
2. **Closed — PDF 10–16 MiB forecast.** The conditional OCR band and >16 MiB refusal are now separate
   (`U/upload-model.ts:106-109,123-139`). Page-count rehearsal remains necessary.
3. **Closed — impossible answer for unresolved stated `.prj`.** Only `asked` missing-system layers produce
   `needs_answer`; unresolved declarations get corrected-export words (`I/intake-native-derivative.ts:327-351`).
4. **Closed — `.json` excludes glTF.** Forecast includes glTF JSON with its own ceiling
   (`U/upload-model.ts:85-90`); byte dispatch remains authoritative.
5. **Closed, bounded policy — KML ZIP hides independent documents.** Exactly one KML and proven resources are
   needed for KMZ; ambiguous extras fan out (`I/intake-zip.ts:219-243`). References beyond the head, case
   mismatches and unrelated pictures inside an accepted referenced `files/` folder remain policy limits.
6. **Partly — native omissions.** WD1 shows per-layer written/not-written counts
   (`I/intake-native-derivative.ts:361-370`). The locator sidecar is still not a batch-review control; N6.
7. **Partly — wide files.** CW3 adds cell child cases; SW1 diverts measurable small-wide collections
   (`I/intake-cell-files.ts:151-185`, `I/intake-draft.ts:223-231`). Unsupported extent systems, atomic wide
   features, caps, EOF delay and cross-case presentation remain limits; N7.
8. **Closed — standalone CSV/XLSX lacks placement bridge.** Same kept original is explicitly enrolled from
   `TablePlacement` (`U/table/TablePlacement.tsx:25-66`); `U/table/TablePage.tsx:52` renders it.
9. **Closed — small table row bound has no automatic promotion / no retained original.** U-first T0 and
   `TABULAR_ROW_LIMIT` promotion keep the file and use the existing queued reader
   (`U/table/useRetainTable.ts:20-31`, `I/service.ts:675-687`). ODS deliberately has its own bounded refusal.
10. **Open — plan pixels/OCR are not rooms.** Labels still only change metadata
    (`I/intake-page-image.ts:77-85`, `I/page-image-read.ts:204-208`); OCR remains words and has byte/page caps.
    PB1 owns the photo-to-rooms build, not credited or duplicated here. Longer PDFs remain N10.
11. **Partly — UTF-16 placement.** U16 implements fatal LE/BE decoding and exact source-byte windows
    (`I/tabular-stream.ts:148-190,214-237`), and server placement no longer refuses that encoding
    (`I/table-geojson.ts:215-240,335-365`). Both Studio callers still invoke the obsolete refusal; N1.
12. **Partly — CityGML / narrow CityJSON outline bridge.** CG1 adds the actual CityGML path and envelope
    declarations (`I/intake-native-readers.ts:235-256`, `G/citygml_outline.py:211-243`). Building-owned,
    inline supported ground geometry remains required; parts/local systems are intentionally not invented away.
13. **Partly — ODS / point / raster variants.** Small ODS reads and places (`I/tabular-stream.ts:478-549`),
    XLS is named but not read (`I/intake-signatures.ts:207-223`). ODS streaming belongs to OD2; LAS variants
    to LP1. Raster 16 MiB, band/pixel/part limits and world-file placement remain unchanged
    (`I/intake-surface.ts:40-62,471-489`).
14. **Open — CAD/mesh to located building/card and companions.** IFC and non-outline native readers settle
    evidence only (`I/intake-ifc.ts:67-75`, `I/intake-native-readers.ts:132-205,252-260`). External glTF buffers
    still need input here (`G/native_gltf.py:236-237`); GB1 reports a held fix, GB2 is running. OBJ materials
    remain declarations (`G/native_obj.py:198-205`). No global placement/card bridge is present.
15. **Partly — signatures and DWG.** SG1 recognises DXF comments, OBJ variants and XML prologs
    (`I/intake-signatures.ts:97-179`). Root type beyond the head, GL's root-member order, lone Feature and
    unsupported geometry remain limits (`I/streaming-vector-reader.ts:150-162`, `I/registry.ts:34`). DWG has
    only signature recognition (`I/intake-signatures.ts:39`).

## 5. Newly isolated gaps, ranked

Ranking is qualitative: misleading words first, silent derivative/text loss next, then honest retained stops.
Within a tier, likely judge exposure and consequence decide order. S = local control/function fix;
M = bounded contract/reader/review bridge; L = cross-area/reader redesign. “Offline possible” is implementation
and isolated checks, never runtime qualification. No work below duplicates LP1, PB1, OD2 or GB2.
The word-only micro-fixes W4 and W5 in §6 rank 3b and 3c, just after N3 and before the silent-loss findings.

### N1. UTF-16 works behind a Studio refusal — high impact, medium exposure

**Fact:** `placementRefusal` returns the old `TABLE_PLACEMENT_UTF16` text for every read UTF-16 CSV
(`U/table-placement-command.ts:38-41`, `C/intake.ts:124-126`). Batch `ItemTable` substitutes that paragraph for
`PlaceOnMap` (`U/BatchTableSection.tsx:69-76`); T0 does the same (`U/table/TablePlacement.tsx:52-63`). Server
`queueTableGeojsonTx/writeTableGeojson` accepts it using U16's byte windows. Thus API Yes is not UI Yes.
**Fix:** remove obsolete `placementRefusal` gating and retire/update the contract words; exercise both callers
with BOM LE/BE table profiles and source-byte assertions. **S; image No; offline Yes.**

### N2. 3D forecast says a stated EPSG puts outlines on the map — wrong success, medium exposure

**Fact:** `groundOutlines` and the JSON clause promise placement on the single EPSG condition
(`U/upload-model.ts:74-75,87-90`). Conversion can honestly produce no outline, reject dimensions, reject
XLinks, reject a horizontal CRS, or still need the child's source key/layout and confirmation
(`G/cityjson_outline.py:36-51,128-135`, `G/citygml_outline.py:95-128,154-184`).
**Fix:** `readerEligibility/groundOutlines` should say source-ground outlines **may be prepared** when a usable
stated horizontal system and supported ground geometry exist; the child's state decides placement.
**S; image No; offline Yes.**

### N3. Standalone table help again calls prepared rows placed — wrong words, high exposure

**Fact:** the new `PlacementBody` says the table's line reports “how many rows were placed”
(`U/table/TablePlacement.tsx:65-66`). That line now deliberately reports only prepared features; even a
retained/enrolled child still needs mapping (`I/table-geojson.ts:273-286,387-391`).
**Fix:** `PlacementBody` should say prepared/skipped and direct map status to the GeoJSON child's own line,
as `PlaceOnMapForm` already does (`U/PlaceOnMapDialog.tsx:52-55`).
**S; image No; offline Yes.**

### N4. Duplicate-header disambiguation can overwrite a different column — silent derivative loss

**Fact:** `propertyNames` disambiguates against names already seen but never checks whether its generated
fallback also collides (`I/table-geojson.ts:69-76`). Headers may repeat (`I/tabular-stream.ts:130-137`).
For test-only headers `key`, `key (column 3)`, `key`, the function emits two `key (column 3)` names;
`featureJson`'s `Object.fromEntries` overwrites one cell (`I/table-geojson.ts:94-97`). The isolated actual-function
control confirmed three columns become two property keys; no application or real file was executed.
**Fix:** `propertyNames` must allocate collision-free names against the entire header set and earlier generated
names, retaining source-column positions; verify both collision directions. **S; image No; offline Yes.**

### N5. Unknown legacy bytes are always decoded as 1252 after UTF-8 fails — silent-text risk

**Fact:** no-BOM UTF-8 decode failure selects Windows-1252, not “encoding unknown”
(`I/delimited-text.ts:17-28`, `I/tabular-stream.ts:239-276`). A valid different legacy encoding can therefore
produce wrong displayed labels/text while still retaining exact original bytes. The profile presents the chosen
decoder as “Windows-1252” (`U/table/SourceHeader.tsx:6-13`); this is not evidence of its publisher encoding.
No particular real file's text was judged wrong in this audit.
**Fix:** `decodeDelimitedText/csvProbe`, `TableSelectionFields` and `tableReadingWords` should distinguish a
fallback decoder from a verified encoding and offer an explicit re-read with a supported, officer-stated one.
Never silently transcode or infer Indic encodings. **M; image No for existing decoders; offline Yes.**

### N6. Native readings and refusal locators have no batch review opener — medium exposure

**Fact:** `intakeItem` returns `nativeReaderJobId` (`I/intake-ledger.ts:95-96`), but batch `ItemDetail/NextStep`
only offer layout, IFC, page image, PDF and table controls (`U/BatchPage.tsx:106-117`,
`U/IntakeTray.tsx:47-66`). There is no Studio consumer of `nativeReaderJobId` in this checkout.
WD1's “stored locator file” is lineage (`I/intake-native-derivative.ts:69-77,361-370`), not a link or locator list
in `intakeItem`. The officer sees counts but cannot inspect those omissions from this batch page.
**Fix:** extend the existing item detail to open the already-authorised native job reads; project a bounded
per-layer refusal list through the original's authority, using its stored sidecar, not private object-key URLs.
**M; image No; offline Yes, private-route and browser rehearsal required.**

### N7. A wide file's other cell batches are counted but not navigable from its parent — medium/high exposure

**Fact:** `retainCellFiles` creates and enrols separate cases, but its result retains only aggregate counts
(`I/intake-cell-files.ts:151-172`). `cellFileWords` names no child case/item (`:174-185`), and the parent item
projection has no child-cell references (`I/intake-ledger.ts:76-99`). A wide judge file can therefore have
accepted features elsewhere while its visible batch offers no link to their layouts/maps/cards.
The independent-batch design is deliberate, not permission to claim all features are on the current map.
**Fix:** `CellFileResult/retainCellFiles`, `writeEndTx/intakeItem` and `NextStep` should carry bounded,
authorised child case/item references and review progress. Keep one case/area authority per child.
Additional CRS families remain a separate AUD3 gap-7 limit; navigation need not wait for that larger work.
**M; image No; offline Yes.**

### N8. Valid large GeoJSON member order remains a content stop — honest kept, common export risk

**Fact:** GL requires root `type` before `features` (`I/streaming-vector-reader.ts:150`). A large valid
FeatureCollection ordered `features` then `type` may not even be byte-recognised, because `rootJsonType` uses
the fixed head (`I/intake-signatures.ts:56-77`, `I/intake-probe.ts:88-91`). SG1 deliberately did not fix this.
Small bounded parsing accepts arbitrary JSON member order, so size can change this result.
**Fix:** bounded root-envelope scanning tied to the existing queued reader; accept root-member order without
trusting suffixes or publishing features before container/CRS validation seals. Reuse retained ranges.
**M; image No; offline Yes.** A generic “read any GeoJSON” claim needs this qualification meanwhile.

### N9. Native derivative lineage is not atomic with its receipt — interruption/replay risk

**Fact:** native `keepDerivative` finalizes a new receipt, then writes `inspection.nativeDerivative` in a
separate transaction (`I/intake-native-derivative.ts:483-493`). Recovery lookup requires that lineage
(`:463-467`). A stop between those writes can leave an unlinked retained child and create another receipt on
retry. Unlike table/cell lineage, native lineage is not in the finalizer's lineage union/map
(`I/large-original.ts:25-31,373-380`). This is a traced crash window, not an observed duplicate.
Also `queueNativeDerivativeTx` checks terminal status `completed` (`I/intake-native-derivative.ts:245-246`),
while `acceptUspJobAttempt` writes `succeeded`
(`packages/server/src/modules/usp/jobs.ts:268-294`): a fresh enrolment can rerun a successful conversion.
**Fix:** pass native lineage through `receiveLargeLayer` and the existing atomic finalizer, and reconcile the
terminal-status check; do not delete orphan originals. **M; image No; offline Yes, interruption rehearsal needed.**

### N10. Longer/larger scans still cannot yield OCR passages — honest kept, high plan-document exposure

**Fact:** OCR refuses the whole PDF above eight pages (`U/pdf-reading.ts:51-59`); native text stops at
10 MiB and batch document admission at 16 MiB (`I/document-native.ts:69`, `I/intake-draft.ts:367-374`).
Reading a selected page does not bypass the whole-PDF opening cap. This is separate from PB1's photo-to-rooms.
**Fix:** `pdfOcrOffer/createPdfOcrPress` plus the existing supervised OCR page renderer need a bounded selected-
page path for longer originals with page/region provenance and unchanged original pins, before changing words.
**M/L; geo image No for a host-only OCR change, host OCR profile refresh Yes; offline code Yes.**

## 6. Exact wrong or misleading words still present

Quotes concatenate source strings; placeholders denote template variables, never observed judge results.

- **W1 — newly stale after U16:** “This table is UTF-16 text. Its rows are placed on the map only from UTF-8 or
  Windows-1252 text, so that each placed row cites its exact bytes. Save the table as CSV UTF-8 and add it again;
  this original stays kept unchanged.” `C/intake.ts:124-126`; actually rendered by both N1 callers.
- **W2 — WD1's new 3D overpromise:** “Building ground outlines are placed on the map when the file states an
  EPSG system; otherwise its reading is kept as evidence.” `U/upload-model.ts:74-75`.
  JSON also says “are placed on the map when the file states an EPSG system” (`:89-90`). N2 lists additional
  real preconditions. Replace the promise, not the conservative converter.
- **W3 — newly stale after TB2/WD1 composition:** “Its line in the batch says how many rows were placed and
  how many were skipped, and why.” `U/table/TablePlacement.tsx:65-66`. It reports prepared features, not map
  completion; the child owns map status.
- **W4 — incomplete shapefile refusal:** “stores M or MultiPatch shapes, or its shapes and records differ in
  number” (`G/native_gis.py:663-664`) also covers valid type 18 MultiPointZ with matching counts and no populated
  M. That file is unsupported, but not for the stated reasons. Name MultiPointZ/unsupported shape type in
  `_shapefile_parts`. **Micro-fix rank 3b; S; image Yes (processor Python words); offline Yes.**
- **W5 — XL1 cell-budget ambiguity:** “An ODS workbook is read whole, never as a stream: up to 16 MiB,
  2,000 records and 2,000 cells.” `I/tabular-stream.ts:528` and `I/tabular-workbook.ts:35-38`.
  The native 2,000 bound counts XML cell **elements** (`G/native_ods.py:175-177`); XL1 expands repeated cells
  up to a separate grid budget (`I/tabular-workbook.ts:74-86`). These are not 2,000 expanded spreadsheet cells.
  Clarify the units of the bound in `odsNotes/odsLimit`. OD2's future stream is not credited here.
  **Micro-fix rank 3c; S; image No; offline Yes.**

Metadata caveat, **not a traced visible batch sentence**: “Loose sidecar kept at signature depth; grouping
separate sources is out of scope.” (`I/intake-probe.ts:39`) is stale for loose shapefile companions after N05;
current `queueShapefileSetTx` groups them. `IntakeTray` does not render all `card.limits`, so do not claim the
presenter currently sees this string there. Similarly, do not present an old receipt's “Placed …” example from
TC1/TC2 evidence as the current WD1-corrected server sentence.

Corrected words must stay corrected: PDF's OCR band, `.json` glTF inclusion, unresolved `.prj` export instruction,
measured versus unmeasured extent holds, layer omission counts, ODS eligibility and XLS kept/cell-unread state
are all present on this base. **W6 (correct XLS words):** “It is kept as evidence; this version does not read its
cells. Save it as XLSX or ODS and add that file to place its rows on the map.” (`C/intake.ts:19-21`).
The label-plan “no plan reader … yet” remains true until PB1 is actually integrated; do not mark it stale now.

## 7. Rehearsal / next decision

Fix N1–N3 and the small loss bug N4 first; review held NM1/GB1 rather than assigning their work again.
Keep all existing access/review/pin fences. Rebuild the combined geo processor for the already-landed Python
changes, and generate checkout-bound native host profiles with NP1's existing builder
(`scripts/platform/demo-native-readers.mjs:77-123,129-163`). A builder in Git is not an installed profile.
Do not reuse another checkout's profiles or old accepted-reader fixtures as current qualification.

Then, on a lead-owned authorised rehearsal only, run one ordinary real keyed footprint/register drop and one
messy real judge-style bundle through the combined front door. The difficult choice should include the newly
found UTF-16 UI seam or a wide parent with cell children, and verify actual reviewable child links/status.
For native partial conversion, inspect refusal positions, not just counts. Check original hashes, layout approval,
confirmation, map placement and verified card separately; record drop-to-first-map and confirm-to-verified-card
times rather than inferring speed from IL1/MF1/CC1/SL1. None of these runs was performed in AUD4.
