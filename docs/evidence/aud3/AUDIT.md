# AUD3 — a judge's unknown file after the intake fixes

TASK   AUD3 — judge-file forecast and remaining gaps             GATE P0 hygiene; static audit only
WORKS  A presenter can distinguish map/card paths, evidence-only readings and remaining misleading words.
SEE IT `git show HEAD:docs/evidence/aud3/AUDIT.md`
INPUTS No real files opened: neither a good nor a difficult input was executed; source traces only.
GAPS   No combined build, runtime, database, browser, Docker, processor or provider qualification.

## Scope and verdict

Fetched once before reading. `result.json` pins the fetched commits. Branch aliases below mean
`origin/task/<branch>`; citations always refer to **that branch's own line numbers**, not a hypothetical merged file.

| Alias | Branch | Role |
| --- | --- | --- |
| B | int2-post-roll | Checkout baseline: ZP1, MX1, TC1, W1, CSV2/INT2-D, RT1, NR1–3 |
| C | cw1-wide-files | Extent-aware streamed cuts; still one destination area |
| P | pl1-scanned-plans | Multi-page OCR press and honest image-plan limits |
| Z | gz1-shapefile-z | PointZ/PolylineZ/PolygonZ preservation; unresolved-CRS words |
| J | b3d1-3d-to-map | Declared-CRS CityJSON ground-outline derivative |
| N | nr4-gltf-obj-batch | Includes J; adds glTF/GLB/OBJ batch readers and forecasts |

Read AUD2 first with `git show origin/task/aud2-judge-formats:docs/evidence/aud2/AUDIT.md`.
Then read B's changes and each named held branch with `git diff` and numbered `git show` excerpts.
**This is a composition forecast, not a merge or a rehearsal.** J and N are not independent patches; do not
apply J twice. Resolve Z/J's shared `native_gis.py` and `nativeParentState` edits without losing either fix.
CW2 and CG1 were explicitly unavailable to this audit. Neither is credited below. CityGML remains evidence-only.

**Verdict:** ordinary polygon GIS files have a map-to-card chain; mixed pins no longer veto their polygons.
Tables can now produce a coordinate derivative after an officer's choices. Declared-CRS CityJSON can produce
building ground outlines. glTF/GLB/OBJ are read but stay local evidence. Scans gain bounded OCR, **not room
extraction**. The highest remaining risks are premature success words, ZIP/KMZ classification and unshown
conversion omissions; then wide-area coverage and honest unsupported inputs.

### What the AUD2 fixes actually close

- Gaps 1/6: ZP1 adds ZIP-member byte-receipt fallback and stops KML+CSV/PDF ZIPs becoming KMZ.
  It does **not** make a lone GeoJSON Feature readable, or distinguish unrelated pictures/additional KMLs in KMZ.
- Gap 2: MX1 accepts polygon layouts with pins/lines set aside and counted, not silently turned into buildings.
- Gap 3: TC1 adds column/WKT placement, preserving the table's own words/count. Its success words precede mapping.
- Gap 4: PL1 offers selected pages in sequence and 10–16 MiB OCR fallback; images and room extraction remain open.
- Gap 5: CW1 cuts by extent for its measurable systems and reports outside/wide holds; CW2 is still needed.
- Gap 7: GZ1 preserves Z types 11/13/15, refuses M rather than dropping it, and corrects unresolved `.prj` words.
- Gaps 8/9/10: W1 removes the ODS button promise, qualifies point files and derives ZIP reader eligibility from
  dispatch. NR4 additionally forecasts mesh readers. PDF and conditional-JSON forecast gaps remain below.

## Matrix: one row per likely file kind

Batch rows expand to **F → R → P → D → the named reader chain** in the next section.
**T0 exception:** CSV/XLSX dropped alone outside a batch open the table import, not batch enrolment or TC1.
The Drop column references exact words in §Forecast (Table estimates appear only in the batch dialog).
`U` is `/uploads`; `S` is `/sources`;
`A` is `/intake/archives`. `S/U` means S below 16 MiB + 1 byte, otherwise U; a 413/422 on S/A falls back to U.
All batch routes subsequently enrol with `/intake/items`. Size/receipt quotas and private access still apply.

**Map Yes** = a traced path can prepare an on-map package after layout approval, not an observed screen.
**Card Yes** = building polygons can reach targets, review and officer confirmation through K; never automatic issuance.
**E** = can be cited on a separately anchored card, not create one. **Part** = only accepted/placed features or members.
A point or line can be drawn only under a compatible road/utility layout; it cannot become a building target.
Forecasts depend on the suffix, readers on bytes. Renaming a file does not change its reader.

| Judge file kind | Drop | Route | Reader chain | Map | Card |
| --- | --- | --- | --- | --- | --- |
| Small polygon GeoJSON, ≤2,000 | G/JN | S/U | GB → K | Yes | Yes |
| Large/many-feature GeoJSON | G/JN | S→U/U | GL → K | Yes | Yes |
| Mixed polygon/pin/line GeoJSON | G/JN | S/U | GB/GL → K, MX | Part | Part |
| Point/line-only GeoJSON | G/JN | S/U | GB/GL | Yes* | No |
| Projected GeoJSON, no CRS | G/JN | S→U/U | GB/GL, CRS refusal | No | No |
| Single Feature/GeometryCollection | G/JN | S→U/U | GB/GL refusal | No* | No* |
| Wide city/district GeoJSON | G/JN | S/U | GB or GL+C | Part* | Part* |
| GeoJSON over 1 GiB | G-over | U | D size settlement | No | No |
| ZIP of mixed independent files | Unknown | A/U | ZIP → each reader | Part | Part |
| ZIP: KML + unrelated image/KML | Unknown | A/U | KMZ, gap 5 | KML part | KML part |
| KML, including mixed Placemarks | GIS | U | V-KML → GL → K | Part | Polygons |
| KMZ | GIS | U | V-KMZ → GL → K | Part | Polygons |
| Shapefile loose .shp/.shx/.dbf | SHP | U each | SET → V-SHP → GL → K | Yes | Polygons |
| Shapefile ZIP, 2D | Unknown | A/U | V-SHP → GL → K | Yes | Polygons |
| Shapefile Z, types 11/13/15 | SHP/Unknown | U/A | SET/V-SHP+Z → GL → K | Yes | Polygons |
| Shapefile, odd/unresolved .prj | SHP/Unknown | U/A | V-SHP, CRS settlement | No* | No* |
| GeoPackage feature tables | GIS | U | V-GPKG → GL → K | Part | Polygons |
| CSV with lat/lon columns | Table/T0 | U/T0 | T0 or T → TC → GL | Batch* | E |
| TSV with lat/lon columns | Table | U | T → TC → GL | Yes* | E |
| XLSX with lat/lon columns | Table/T0 | U/T0 | T0 or T → TC → GL | Batch* | E |
| CSV/TSV/XLSX with WKT polygons | Table/T0 | U/T0 | T0 or T → TC → GL → K | Batch* | Batch* |
| CSV ;/pipe/tab, UTF-8/1252 | Table/T0 | U/T0 | T0 or T → TC if spatial | Batch* | WKT only* |
| CSV/TSV UTF-16 with BOM | Table/T0 | U/T0 | T0/T bounded; TC refuses | No | E* |
| Table ≤16 MiB, >2,000 rows | Table/T0 | U/T0 | Bounded T/T0 row refusal | No | No* |
| ODS | Unknown | U | KEEP (no batch table reader) | No | No* |
| Text-layer PDF ≤10 MiB | PDF | U | PDF-native | No | E |
| Scanned PDF ≤16 MiB, ≤8 pages | PDF/over | U | PDF-native → OCR on press | No | E |
| Text PDF >10 to 16 MiB | PDF-over | U | Native byte stop → OCR | No | E* |
| Scanned PDF >8 pages | PDF/over | U | Native; OCR refuses whole PDF | No | No* |
| PDF >16 MiB | PDF-over | U | D PDF size settlement | No | No |
| JPEG plan photo | Image | U | IMAGE header/preview/label | No | No* |
| PNG plan image | Image | U | IMAGE header/preview/label | No | No* |
| DXF ≤16 MiB | DXF | U | ND-DXF | No | No* |
| DWG | Unknown | U | KEEP | No | No |
| IFC ≤32 MiB | IFC | U | IFC structure | No | No* |
| CityGML ≤32 MiB | GML/Unknown | U | ND-GML | No | No* |
| CityJSON ≤8 MiB | JN/Unknown | S→U/U | ND-JSON → CJ → GL → K | Yes* | Yes* |
| glTF ≤16 MiB | Mesh | U | ND-glTF | No | No* |
| GLB ≤16 MiB | Mesh | U | ND-glTF | No | No* |
| OBJ ≤16 MiB | OBJ | U | ND-OBJ or KEEP | No | No* |
| LAS (uncompressed) | Points | U | SURFACE refusal | No | No |
| LAZ 1.4 format 6 ≤16 MiB | Points | U | SURFACE-point | Yes* | No |
| GeoTIFF/raster ≤16 MiB | Raster | U | SURFACE-raster | Yes* | No |
| Raster >16 MiB / world file | Raster/over | U each | SURFACE refusal/unplaced | No* | No |
| Unknown binary | Unknown | U | KEEP | No | No |

Matrix qualifications:

- GB takes only nonempty FeatureCollections, ≤16 MiB and ≤2,000 features. Named supported projected CRS works
  with `feature.geometry`, not the older degree-only building conversion (B I/`registry.ts:137-140`).
  A lone Feature is recognised but fails `geojsonFeatures`; a GeometryCollection is refused, not expanded.
  GL likewise requests FeatureCollection framing. A collection can still map its other accepted features.
- Mixed polygon layouts set aside pins/lines in both paths: B I/`registry.ts:98-119,124-131`,
  `intake-draft-worker.ts:192-205`; GL's `pairMappedFeatures`/geometry summary retain the accounting.
- CW1 does not intercept GB. GB-wide input can still fail normalization as one package.
  GL's C extent rule measures no CRS/CRS84, EPSG:4326/3857 and WGS84 UTM only; other declared systems and
  non-UTM destination frames retain size-only cuts. Features beyond the one area's origin remain held.
- Shapefile companions must have matching stems in the batch. Missing `.prj` offers an officer EPSG answer.
  A resolvable unusual `.prj` is accepted; unresolvable/custom/three-axis WKT is kept, not relabelled.
  Z is preserved as source-coordinate heights with unknown unit/reference, not a measured building height.
  MultiPointZ (18), measured shapes and MultiPatch are still refused (Z G/`native_gis.py:661-688`).
- T requires **Open the table → Read as a table**, with sheet/header selection as needed. TC is a separate
  **Place on the map** press naming x/y or WKT columns and an EPSG code; nothing is preselected.
  TC creates a new GeoJSON item, which still needs GL's layout. Only WKT polygons can create building targets.
  `Batch*` means Yes through batch T/TC, **No through T0's standalone table UI**. TSV is always a batch route.
  WKT Z/M, collections, curves, EMPTY, invalid numbers/rings and unavailable formula cells are refused/skipped
  and counted, not converted to zero (B I/`wkt.ts:95-125`, `table-geojson.ts:45-58,77-145`).
- Small UTF-16 can be read whole, but TC always uses the window reader, which refuses UTF-16 even then.
  Above 16 MiB table reading also refuses it. A ≤16 MiB table with >2,000 data rows still takes the bounded
  reader and stops; only the byte-large table automatically selects streaming (gap 9). In T0, a 413/422
  refusal occurs before the original is kept; unlike batch R, T0 supplies no byte-receipt fallback.
  Other legacy encodings are not auto-detected beyond 1252;
  decimal-comma coordinates are not parsed as decimal points. XLSX needs the pinned host workbook interpreter.
- OCR can open only a PDF of **at most eight total pages**, one page/job, maximum 32 document jobs/source.
  PL1 now reads selected pages in sequence; it does not make pages 1–8 of a longer PDF readable.
  OCR results are cited candidate words, not rooms, levels, units or world placement.
- `No*` on native models/images means no traced batch card-target bridge, not that their retained original
  could never be cited through another reviewed workflow. ODS is honestly kept; its separate native document
  capability is not wired to T. A fully scanned >8-page PDF yields no text/OCR evidence through this batch path.
- CJ needs a declared EPSG resolving to a known 2D horizontal system and a **Building's own** LoD0 MultiSurface
  or semantic GroundSurface. BuildingPart outlines are not assembled into a Building; absent/null/local CRS
  stays unplaced. Missing qualifying outlines are not invented. All native byte/record budgets still apply.
- OBJ recognition needs a matching `v` line plus `f`, `vn` or `vt` inside the first 64 KiB, not necessarily a face.
  An ASCII DXF beginning with `999` comments can miss the signature. Valid but late JSON/XML type declarations
  can likewise miss the bounded probe. These originals stay kept, not read by extension alone.
- SURFACE is display-only and additionally needs a stated CRS, a batch area/reference/extent, a local transform
  and intersection. The reader covers only bounded parts; it names the unread remainder. A world-file sidecar
  is retained separately, not used to place an unreferenced image. No surface creates a card or a height fact.

## Exact chain catalogue

Path abbreviations in citations: **I/** = `packages/server/src/modules/usp/ingestion/`;
**U/** = `apps/studio/src/features/intake/`; **G/** = `services/geo/geo/`;
**A/** = `packages/server/src/modules/areas/`. Prefix B/C/P/Z/J/N identifies the branch above.
The matrix composes these shared chains rather than repeating the same front door in every row.

### Shared front door, words and card tail

- **F:** `AddFilesDialog.NewFiles` → `dropState`/`routeWords` (B U/`AddFilesDialog.tsx:132-165`;
  `file-route.ts:9-19,40-56`); `IntakeDropDialog.DropOutcomes` → `readerEligibility`
  (B U/`IntakeDropDialog.tsx:51-57`; N U/`upload-model.ts:68-116`).
  This is name/size-only, not content inspection. The opt-in development import profile is assumed off.
- **R:** `retainBatch` → `retainOriginal` → `viaUpload` → `retainMap` or `createUploadCommand.run`
  (B U/`retain-batch.ts:32-56,64-78,82-106`). `retainMap` chooses A for ZIP and S otherwise;
  `retainOriginal` catches only 413/422 for U fallback. It then calls `/intake/items`.
  `ManualIngestionService.retain` retains original bytes before attaching inspection
  (B I/`service.ts:404-438,547-550`); uploaded originals are retained by the large-original receipt.
  S decides 413/422 content refusals before keeping (`manualInventory`/`readManualOriginal`,
  B I/`service.ts:441-464`); batch R then falls back to U. Standalone T0 does not.
- **P:** `IntakeService.register` → `prepare` → `probe` → `probeOriginal` → `initialCard` →
  `detectIntakeKind` → `binaryKind`/`jsonKind`/`xmlKind` → `probeHead`/`probeZip` → `officeKind`.
  B I/`intake-service.ts:110-176`; `intake-probe.ts:29-56,84-111`;
  `intake-signatures.ts:16-47,80-129`; `intake-zip.ts:178-212`.
- **D:** `IntakeService.publish` → `queueShapefileSetTx`, else `queueIntakeSurfaceTx`, else
  `queueIntakeDraftTx`; additionally `queueZipLayersTx` and `queueLateIntakeEvidenceTx`.
  B I/`intake-service.ts:134-158`; `intake-draft.ts:270-309`.
  The tray reads `stateWords`/`placementWords` and `item.limitReason`, not a parallel computed success
  (B U/`batch-model.ts:7-17`; `IntakeTray.tsx:32-40,47-66`).
- **K:** `createIntakeTargetsTx` filters `pkg.features` to `kind === 'building'`, queues prepare;
  `runIntakeRunJob` → `prepare` → `reviewPackage` → `prepareIntakeTargetsTx`.
  Officer `confirmIntake` → `storeTx` → commit run → `commitOne` → `commitPackage` → `recordPackageTargetsTx`;
  `carryTarget`/`carryOn` → snapshot/evidence plan → confirm/execute plan → `card` → `generatePropertyCard`
  → `verify`. B I/`intake-targets.ts:71-90,115-125`; `intake-confirmations.ts:131-169`;
  `intake-run-worker.ts:32-37,87-105,139-150,259-301,325-339,352-375`.
  Targets are not cards; package review, current pins, readiness and confirmation can still hold them.

### Reader chains used in the matrix

- **GB:** D → `retainedGeojsonAdapterTx` if uploaded → `prepareRetainedGeojsonTx` →
  `geojsonFeatureCount`/`inspectRetainedGeojson`; `enrollDraftTx` → `runIntakeDraftJob` → `advance` →
  `proposeRecipe`/officer layout → `ManualIngestionService.decide('execute')` → `ingestArea` →
  `normalizeAreaImport` → geo `normalize_area` → `transition` → K.
  B I/`intake-draft.ts:245-265,285-309,455-476`; `service.ts:510-534,683-728`;
  `registry.ts:30-49`; `intake-draft-worker.ts:153-167,192-231,294`;
  B A/`areas.ts:470,632-640`; B G/`area.py:318,463-487`.
- **GL:** D → `queueIntakeLargeTx` → `runIntakeLargeJob` → `startReaders` →
  `StreamingVectorService.enqueue` + `StreamedProfileService.enqueue` → `runStreamingVectorJob` →
  `readStreamingFeatures`; after an approved streamed layout, `startMapping` → chunk mapper →
  `draft` → `IntakePackageCutter.consume/close` → `draftIntakePartTx` → `ingestProvedAreaPart` →
  `normalizeAreaImport`/`normalize_area` → `createIntakeTargetsTx` → K.
  B I/`intake-draft.ts:292-299`; `intake-large-worker.ts:123-143,268-303,362`;
  `streaming-vector-worker.ts:247`; `streaming-vector-reader.ts:129`; `proved-area-part.ts:33-51,122`;
  B A/`areas.ts:561-587,632-640`.
  C replaces the fold/cutter/part step: C I/`intake-large-worker.ts:155-199,295-329`;
  `intake-package-cuts.ts:109-182`; `intake-part-draft.ts:65-93`;
  `intake-large.ts:168-181,414-437`. End/wait/held counts are stored, not estimated from sample features.
- **ZIP:** D → `queueZipLayersTx` → `fanOutZipLayers` → `keepMembers` → `keepLayer` →
  `retainMapLayer` (small GeoJSON; 413/422 → `retainMember`) or `keepLargeLayer` → `enrolMember` → P/D.
  Grouped shapefile members instead take V-SHP. B I/`intake-zip-layers.ts:113-119,151-180,221-258,272-328`.
  `zipParentWords`/`zipMemberHasReader` derive eligibility from the child card
  (B I/`intake-draft.ts:73-126`), not successful completion of that child's job.
- **SET/V:** `queueShapefileSetTx` → `queueNativeDerivativeTx` (SET) or D → `queueNativeDerivativeTx` (V);
  `runIntakeNativeDerivativeJob` → `runDerivativeJob` → `convertNativeLayers` → `convert` →
  geo `/internal/area/convert-native` → `convert_native`.
  B I/`intake-native-derivative.ts:180-255`;
  `intake-native-derivative-worker.ts:24-31,98-135`; B G/`api.py:104-129`.
  J I/`intake-native-derivative.ts:375-429` retains/enrols each derivative through `keepDerivative`/P/D → GL;
  its parent words compose J's reading preservation with Z's `nativeParentState` CRS wording.
  V-GPKG: B G/`native_gis.py:1178,499-571` → `_gpkg_layers`/`_gpkg_layer`.
  V-SHP: B G/`native_gis.py:581-633` → `_shapefile_layers`/`_shapefile_set_layer`;
  Z G/`native_gis.py:635-731` → `_shapefile_parts`/`_shapefile_geometry`/`_shapefile_z_geometry`.
  V-KML/KMZ: B G/`native_gis.py:1040-1096` → `convert_kml_file` → `_kmz_document` if KMZ → `_kml_parse`.
- **T0:** `NewFiles` → `TableImportDialog` → `useRetainTable`: small CSV/XLSX → `retainTable` → S;
  large → `streamedTable`/`createUploadCommand` → U → `followTable`/`tableFromOriginal`.
  Both open `TablePage`, with no `/intake/items` enrolment in that chain and no TC1 opener there.
  B U/`AddFilesDialog.tsx:191-204`; `table/TableImportDialog.tsx:16-27`;
  `table/useRetainTable.ts:17-30,34-69`; `table/retain.ts:35-59`; `table/TablePage.tsx:16-48`.
  This route says “Table · opens the table import” (B U/`file-route.ts:45-46`), not a batch reader estimate.
- **T/TC:** `BatchTableSection` → `itemTableSource` → `createItemTableRead` → `followTable` →
  `tableFromOriginal` → `ManualIngestionService.tableFromOriginal` →
  `inspectTabularSource`/`readTabularSource`, or `queueTableProfileTx` →
  `runTableProfileJob` → `inspectTabularStream` → `readTableWindows`.
  B U/`BatchTableSection.tsx:25-46,55-74`; `table/useFollowTable.ts:20-35`;
  B U/`table/retain.ts:54-59`; B I/`service.ts:615-645`;
  `tabular-source.ts:158-183,185-235`; `table-profile-worker.ts:33,101-127`;
  `tabular-stream.ts:231-246,384-430`.
  Then `PlaceOnMap`/`createTablePlacementCommand` → `placeTableOnMap` → `IntakeService.placeTable` →
  `answerItem` → `queueTableGeojsonTx` →
  `runIntakeTableGeojsonJob`/`runDerivativeJob` → `placeTableRows` → `writeTableGeojson` →
  `rowGeometry`/`parseWkt` → `keepTableDerivative`/`receiveLargeLayer` → `enrol` → P/D → GL → K if polygons.
  B U/`PlaceOnMapDialog.tsx:14-38`; `batch-queries.ts:71-75`; B I/`intake-service.ts:303-328`;
  `table-geojson.ts:77-145,214-241,293-302,359-404`;
  `table-geojson-worker.ts:6-14`; `wkt.ts:108-125`. `placedTx` is not a GL completion callback.
- **PDF-native/OCR:** D → `queueBatchPdfTx` → `queueBatchDocumentTx` → `runDocumentJob` →
  `extractSourceDocument` → geo extraction → `extract_native_pdf_pages` → `settleBatchPdfTx`.
  B I/`intake-draft.ts:361-376`; `documents.ts:63-76`; `document-worker.ts:18,52-59`;
  `document-native.ts:63-98`; B G/`native_pdf.py:34`; P I/`document-worker.ts:78`;
  `intake-draft.ts:399-453`.
  OCR: `BatchPdfSection` → `usePdfOcr` → `pdfNeedsPageCount`/`readPdfPageCount`/`pdfOcrOffer` →
  `createPdfOcrRun` → `createPdfOcrPress` → document retry → `runDocumentJob` → `runSourceOcr`.
  P U/`BatchPdfSection.tsx:45-75,94-122`; `pdf-reading.ts:41-64,101-129,153-167`;
  B I/`document-worker.ts:54`; `document-ocr.ts:133`. No target creation occurs in this chain.
- **IMAGE:** D → `readPageImageTx` → `queuePageImageTx` → `runIntakePageImageJob` → `readPageImage` →
  `readPageImageHeader`/`pageImagePreview` → `settlePageImageTx`; officer answer → `labelPageImageTx` only.
  B I/`intake-draft.ts:338-341`; `intake-page-image.ts:35-85`;
  `intake-page-image-worker.ts:103-123,145-160`; `page-image-read.ts:167,184`;
  P I/`page-image-read.ts:204-222` explicitly says a labelled plan is not extracted.
- **IFC:** D → `queueIntakeIfcTx` → `ifcSourceTx`/`insertIFCJobTx` → `runIFCJob` → `processIFC` →
  G/`native_ifc.py` `extract`/`scan_structure` → `settleIntakeIfcTx` → candidate summary, no K.
  B I/`intake-ifc.ts:25-43,49-75`; `ifc-worker.ts:57,112`;
  `ifc-processor.ts:81-90`; B G/`native_ifc.py:382,440`.
- **ND:** D → `batchNativeReader`/`queueIntakeNativeReaderTx` → native source/insert → native job worker →
  native processor → `settleIntakeNativeReaderTx` → `intakeNativeReadWords`, except CJ below.
  N I/`intake-native-readers.ts:23-68,104-129,195-257`.
  ND-DXF: B I/`dxf-worker.ts:57,112` → `dxf-processor.ts:73-82` `processDXF` →
  B G/`native_dxf.py:467` `inspect_dxf` → `read_dxf:266`.
  ND-GML: B I/`citygml-worker.ts:57,112` → `citygml-processor.ts:84-93` `processCityGML` →
  B G/`native_citygml.py:89` `extract`. No outline bridge in audited branches.
  ND-JSON: B I/`cityjson-worker.ts:59-96` → `nativeCityJSON:23-42` → geo native endpoint →
  B G/`native_cityjson.py:227` `read_cityjson`.
  ND-glTF: N I/`gltf.ts:62-105` `gltfSourceTx`/`insertGltfJobTx` →
  N I/`gltf-worker.ts:57-58,112,132` → B I/`gltf-processor.ts:83` `processGltf` →
  B G/`native_gltf.py:464` `inspect_gltf`; N's settlement is at N I/`gltf-worker.ts:132`.
  ND-OBJ: N I/`obj.ts:62-104` `objSourceTx`/`insertObjJobTx` →
  N I/`obj-worker.ts:57-58,112,132` → B I/`obj-processor.ts:86` `processObj` →
  B G/`native_obj.py:122` `inspect_obj`; N's settlement is at N I/`obj-worker.ts:132`.
- **CJ:** ND-JSON terminal acceptance → `outlinesConverted` → `queueNativeDerivativeTx` → V →
  `convert_native_file` → `convert_cityjson_file` →
  `_placement`/`_features`/`_outline_faces`/`_polygon` → GL → K.
  N I/`intake-native-readers.ts:235-250`; J I/`intake-native-derivative.ts:81-99,230-269`;
  J G/`native_gis.py:1100-1124`; `cityjson_outline.py:36-51,68-110,113-151`.
- **SURFACE:** D → `surfaceReader`/`queueIntakeSurfaceTx` → `admitSurfaceItemTx` →
  `enqueueRasterWindowTx` or `enqueuePointBatchTx` → `runRasterWindowJob`/`runPointBatchJob` →
  geo `read_raster_window`/`read_point_batch` → accepted part capture → `settleSurfaceItemTx` →
  `itemPlacementTx`/`frameTx` → `localPartsTx`; display only, no K.
  B I/`intake-surface.ts:40-62,87-108,169-210,429-506,515`;
  `raster-window-worker.ts:64`; `point-batch-worker.ts:71`;
  B G/`api.py:134-151`; `raster_window.py:54`; `point_batch.py:35`.
- **KEEP:** D → `keptOnly` → `settleKeptTx` → `keptWords`, no reader, map or K.
  B I/`intake-draft.ts:156-171,277,328-334`. Unsupported vectors instead reach `intakeDraftLimit:175-199`.

## Forecast words (Drop column)

Source for every entry: N U/`upload-model.ts:56-59,68-116`;
values are existing contract limits, not measured here.
For an ordinary reader entry, the exact template is:
**“Will be read by the {name} reader (within {limit})”**.
Above that limit it becomes **“Will be kept, not read: larger than the {limit} {name} reader”**.

| Key | Exact name/limit or special words |
| --- | --- |
| G | GeoJSON / 1 GiB; G-over uses the above-limit template |
| GIS | native GIS conversion / 128 MiB |
| SHP | GIS words + “A complete shapefile set is needed.” |
| Table | table / 7 GiB + “Choose Read as a table after upload.” |
| T0 | “Table · opens the table import”; standalone CSV/XLSX, no batch reader estimate |
| PDF | PDF native text / 10 MiB; PDF-over uses the above-limit template |
| Image | page image preview / 128 MiB |
| DXF | DXF / 16 MiB + “Its reading is kept as evidence, not placed on the map.” |
| IFC | IFC structure / 32 MiB |
| Mesh | glTF / 16 MiB + “Its reading is kept as evidence, not placed on the map.” |
| OBJ | OBJ / 16 MiB + the same evidence-only sentence |
| Raster | raster / 16 MiB |
| Unknown | “Kind not known yet: will be kept and recognised after upload” |

Special entries, including their exact conditional words:

- **JN** (`.json`): “Read as GeoJSON or CityJSON once its bytes are checked (within 1 GiB).
  A CityJSON is read up to 8 MiB; other JSON is kept, not read.” A `.cityjson` suffix instead gets Unknown.
- **GML** (`.gml`): “Read by the CityGML reader when its bytes show a CityGML city model (within 32 MiB).
  Other GML is kept, not read. A CityGML reading is kept as evidence, not placed on the map.”
  `.xml`/`.citygml` get Unknown; their bytes can still select ND-GML.
- **Points**: “Points are read when the file is compressed LAZ of LAS 1.4 point format 6 with at most
  5 million points (within 16 MiB). Other point files are kept, not read.”

Route words are separate from these estimates. KML/GPKG/GeoJSON say “Map file · joins the batch”; ZIP says
“ZIP · the batch reads what it holds”. IFC says “Building model · joins the batch”; DXF, DWG, CityGML,
CityJSON, glTF and OBJ otherwise say “Original · kept in the batch”. B U/`file-route.ts:45-56`.

## Remaining gaps, ranked

Likelihood is a qualitative presentation risk, not a measured frequency. Within that judgement, wrong words
rank above invisible omissions, then partial stops, then an honest kept/not-read result.
S = local function/UI fix; M = bounded bridge/accounting work; L = cross-area/model/converter work.
“Offline Yes” means implementation and lean source/unit checks are possible;
**every runtime claim still needs rehearsal**.

1. **Table placement announces the map before there is a map. High likelihood; wrong success words.**
   Fact: `tablePlacementWords` says “Placed … on the map” from writer counts; `placeTableRows` merely retains
   and enrols the derivative, and `placedTx` writes those words without waiting for GL's layout/package.
   An enrolment refusal still follows the same success prefix. B I/`table-geojson.ts:268-280,359-404`.
   Fix `tablePlacementWords`/`placedTx` to say rows were prepared in a GeoJSON, with a link/status for the child;
   reserve “on the map” for the child's actual placement. Clarify `PlaceOnMapForm`'s started text too.
   **S; new processor image No; offline Yes.**

2. **The PDF forecast still says “not read” for the new OCR fallback. High likelihood; wrong refusal words.**
   Fact: the 10 MiB native ceiling drives the drop estimate, while PL1 offers OCR up to 16 MiB if ≤8 pages.
   N U/`upload-model.ts:94,111-116`; P U/`pdf-reading.ts:51-57,184-186`.
   Fix `readerEligibility`'s PDF special forecast: separate text-layer and OCR byte/page ceilings; say it is
   conditional, since the dialog has not read page count. **S; image No; offline Yes.**

3. **An unresolved stated `.prj` still asks an impossible answer. Medium likelihood; misleading state.**
   Fact: GZ1 fixes the reason to “Kept, not converted”, but `nativeParentState` still sets `needs_answer` for
   every `crs_unstated`, while only `!statesCrs` layers enter `asked`/the CRS control.
   Z I/`intake-native-derivative.ts:312-332`; B U/`batch-model.ts:13-16`; `IntakeTray.tsx:66`.
   Fix `nativeParentState` placement from `asked.length`, with an explicit corrected-export instruction for
   unresolved stated metadata. Never override a source-stated system by guessing. **S; image No; offline Yes.**

4. **The `.json` forecast excludes a reader that NR4 now wires. Lower likelihood; wrong conditional words.**
   Fact: the JN estimate says other JSON is kept, not read, but `jsonKind` recognises glTF JSON and N's native
   dispatch reads it regardless of its `.json` suffix. N U/`upload-model.ts:78-80`;
   B I/`intake-signatures.ts:69-86`; N I/`intake-native-readers.ts:43-47,104-124`.
   Fix `readerEligibility`'s JSON entry to include glTF and its 16 MiB ceiling without promising that every JSON
   is readable. Keep the bytes authoritative. **S; image No; offline Yes.**

5. **KML-containing ZIP can still hide independent files. Medium likelihood; silent reader coverage loss.**
   Fact: `kmzShape` treats *every* PNG/JPEG/TIFF/DAE as a KMZ resource by suffix, without checking a KML
   reference, and accepts multiple KML documents. `queueZipLayersTx` skips `kmz`.
   `_kmz_document` reads root `doc.kml` preferentially, not all KMLs, so other KMLs and an unrelated plan photo
   remain only in the archive. B I/`intake-zip.ts:203-212`; `intake-zip-layers.ts:151-154`;
   B G/`native_gis.py:1040-1051,1076-1085`.
   Fix `kmzShape`/`officeKind`: fail conservatively to ZIP for ambiguous extra documents/unproven resources;
   or fan out independent members alongside the KMZ document. Do not fetch references or reinterpret a photo
   as a footprint. **M; image No for classification/fan-out; offline Yes.**

6. **Native conversion omissions are stored but not told to the officer. Medium likelihood; silent loss.**
   Fact: `_Derivative.refuse` records locators/reasons and increments `notWritten`; GPKG binary/unsafe numeric
   attributes can omit whole rows. CityJSON refuses Buildings without their own outline when others convert.
   `convertNativeLayers` stores `notWritten` in lineage, but `nativeParentState` reports successful layers,
   not these feature omissions. B G/`native_gis.py:402-426,554-561`;
   J G/`cityjson_outline.py:124-145`; J I/`intake-native-derivative.ts:311-350,402-407`.
   Fix `nativeParentState` to show written/not-written counts per layer and expose sidecar refusal locators.
   Keep original bytes and the distinction between unsupported and absent. **S/M; image No; offline Yes.**

7. **Wide files still exceed the one-area design, and small files miss CW1. High likelihood; partial map/stop.**
   Fact: C's `largeDestination` chooses one area; `ExtentRule.measure` holds outside features, and unmeasurable
   systems retain size-only cuts. GB bypasses this cutter entirely. C I/`intake-large-worker.ts:155-197`;
   `intake-package-cuts.ts:106-132`; `intake-package-extent.ts:100-125`;
   B I/`intake-draft.ts:221-228,290-309`; B G/`area.py:467-487`.
   Finish/review CW2: cell-bound destinations in `largeDestination`, `foldContext`, `IntakePackageCutter` and
   `intakeDestination`, with resumable cell/feature locators; route bounded-wide input into that same path.
   Preview counts/extent limits before approval. Do not split one original or invent geometry.
   **L; image No for the existing normalizer/cell solution; offline Yes, runtime throughput unqualified.**

8. **CSV/XLSX dropped alone do not expose the new map action. High likelihood; missing bridge.**
   Fact: standalone routing goes to T0; `useRetainTable` returns a table page without enrolling an intake item,
   and `PlaceOnMap` is only rendered by `BatchTableSection`, not `TablePage`.
   B U/`file-route.ts:9-19`; `AddFilesDialog.tsx:196-204`; `table/useRetainTable.ts:42-69`;
   `table/TablePage.tsx:21-48`; `BatchTableSection.tsx:66-73`.
   Fix `TablePage`/`useRetainTable` with an explicit reuse-original enrolment into the existing intake case and
   the shared `PlaceOnMap` opener; do not retain another original or auto-select coordinates/CRS.
   **M; image No; offline Yes.**

9. **A small table with more than 2,000 rows still cannot use streaming automatically. High likelihood; stop.**
   Fact: `tableFromOriginal` chooses the bounded path solely at ≤16 MiB; `readColumnCsv` aborts past 2,000 rows,
   and `readTabularSource` enforces the same ceiling for a workbook sheet. The standalone small-file import
   uses that bounded reader too; a 413/422 there can leave no retained original, because T0 lacks R's fallback.
   B I/`service.ts:441-464,615-640`; `tabular-source.ts:158-183`;
   `column-profile.ts:364-380`; B U/`table/useRetainTable.ts:50-62`.
   Fix `tableFromOriginal` and `useRetainTable` to retain first and promote a bounded row-limit refusal to the
   existing `queueTableProfileTx` path; keep its selected sheet/headers and encoding pins. Never truncate to fit.
   **M; image No; offline Yes.**

10. **Scanned/photo plans still do not become rooms; OCR is only words. High likelihood; honest limitation.**
   Fact: labelling a page image calls no OCR/plan extractor; PL1 explicitly says so. PDFs >8 total pages cannot
   use this OCR reader, and >16 MiB PDFs are not read. P I/`page-image-read.ts:204-222`;
   `intake-page-image.ts:77-85`; P U/`pdf-reading.ts:51-57,171-175`;
   B I/`intake-draft.ts:365-371`.
   Bridge `labelPageImageTx` and selected PDF pages to a queued candidate-only plan step, reusing existing
   B G/`raster_plan.py:126,149,279` `resolve_scale`/`segment_bytes`/`panel_result`; extend `pdfOcrOffer` only
   alongside a reader that safely opens longer PDFs. Keep `no_scale` and no world placement without anchors.
   **L; image Yes if shipping this processor-side plan bridge; offline code Yes, weights/runtime needed to qualify.**

11. **UTF-16 table can be read but cannot take TC1, even when small. Medium likelihood; honest stop after promise.**
   Fact: bounded decoding supports UTF-16 BOMs, but `writeTableGeojson` always calls `readTableWindows`, whose
   CSV branch refuses UTF-16. B I/`delimited-text.ts:4-28`; `table-geojson.ts:119-128,328-349`;
   `tabular-stream.ts:201-203,231-245,425-430`.
   Fix `readTabularWindows` to maintain correct UTF-16 source-byte row locators, or use the same bounded
   table read for ≤16 MiB and explicitly disable placement with actionable words above it. No silent transcoding
   or 1252 claim for an unverified Indic legacy encoding. **M; image No; offline Yes.**

12. **CityGML has no outline bridge yet; CityJSON's bridge is intentionally narrow. Medium likelihood; kept/read only.**
    Fact: N `outlinesConverted` admits only declared-CRS CityJSON. J takes Building-owned outlines only and
    requires a resolvable 2D horizontal EPSG. CityGML settles through evidence words.
    N I/`intake-native-readers.ts:145-160,235-256`; J G/`cityjson_outline.py:36-51,68-110`.
    Review CG1 when available; extend `outlinesConverted`, `derivativeFormat`/`convertNativeLayers` and
    `convert_native_file` for source-stated ground geometry, never a bounding box or inferred building.
    Update the forecast **in the same change**, not before. **M/L; image Yes; offline Yes.**

13. **ODS and ordinary point/raster variants remain outside batch readers. Medium likelihood; honest keep.**
    Fact: T formats are csv/tsv/xlsx only; point reading requires compressed 1.4/format 6; rasters cap at
    16 MiB/100 million pixels/4 bands and need an area. B `packages/contracts/src/usp/intake.ts:15-16`;
    B I/`intake-surface.ts:40-62,429-448`.
    ODS: extend `itemTableSource` and `readTableWindows` using the existing native ODS reader, retaining cells
    and sheet locators. Surfaces: change `surfaceReader` and the matching `read_point_batch`/`read_raster_window`
    receipt profiles together; add bounded streaming, not just bigger numbers. World-file grouping needs reviewed
    exact companion association and a CRS answer. **M/L; image Yes for processor reader changes; offline Yes.**

14. **CAD/mesh structure is not a located footprint/card, and companions do not join. Medium likelihood; honest read.**
    Fact: ND-DXF/IFC/mesh settle summary candidates, not K. glTF external buffers and OBJ material declarations
    are inventoried, not supplied from sibling uploads. N I/`intake-native-readers.ts:132-205,252-257`;
    B I/`intake-ifc.ts:67-75`; B G/`native_gltf.py:196-232`; `native_obj.py:166-176`.
    Fix `queueIntakeNativeReaderTx`/native reader inputs to accept exact reviewed companion bindings;
    only add a derivative-to-GL bridge after source units, CRS and a ground-outline role are established.
    **L; image No for a host-reader bridge, host profile rebuild/pins Yes; offline Yes, no global-placement claim.**

15. **Some valid file openings miss byte recognition; DWG has no reader. Lower likelihood; honest keep.**
    Fact: DXF/OBJ/head JSON/XML signatures are bounded and syntactic; DWG only has a signature.
    B I/`intake-signatures.ts:39-45,56-103,119-129`; B `packages/contracts/src/usp/intake.ts:7-10`.
    Extend `detectIntakeKind` for bounded DXF comments/valid OBJ variants, then let the existing reader validate;
    do not trust extensions. DWG needs an approved licensed converter through the same retained derivative route.
    **S/M for signatures, L for DWG; image No for signatures, Yes if a containerized DWG converter is chosen;
    offline signatures Yes, DWG qualification blocked on converter/licence.**

## Exact wrong or misleading officer words after these merges

Quotes are source templates; `{…}` denotes the source's variable interpolation, not an invented observed value.

1. **“Placed {rows} on the map”**;
   **“Their GeoJSON file, {name}, was kept but not taken in ({code}); place the rows again to retry.”**
   The first sentence can claim placement even when the next admits enrolment failed. Even successful enrolment
   has not proved GL mapping. B I/`table-geojson.ts:273-279`; B U/`PlaceOnMapDialog.tsx:50-51` repeats the promise.
2. **“Will be kept, not read: larger than the 10 MiB PDF native text reader”** for a 10–16 MiB PDF.
   Correct for native text alone, misleading as the file's overall forecast now OCR is offered.
   N U/`upload-model.ts:94,111-116`; P U/`pdf-reading.ts:184-186`.
3. **“Needs an answer”** beside an unresolved source-stated `.prj`, with no eligible CRS answer control.
   B U/`batch-model.ts:15`; Z I/`intake-native-derivative.ts:313-326,331`.
4. **“A CityJSON is read up to 8 MiB; other JSON is kept, not read.”**
   glTF JSON named `.json` is also byte-recognised and now read by NR4; the catch-all “other JSON” is false
   for it. N U/`upload-model.ts:78-80`; B I/`intake-signatures.ts:69-86`; N I/`intake-native-readers.ts:43-47`.
5. **“{n} are wider than one map area (50 km or 1 degree across) and are held.”**
   CW1 uses this bucket even when `featureExtent` cannot produce a finite convertible position, so an invalid
   coordinate need not actually be wide. C I/`intake-package-cuts.ts:124-128`;
   `intake-large.ts:175-176`. Separate unmeasurable/invalid-position words from measured extent holds.
6. **“Tables produce mapped draft rows, not buildings. Nothing enters the registry or the map.”**
   B U/`table/TablePage.tsx:36-38`. True of that page's table mapping alone, but an unqualified statement about
   tables is misleading after TC1 and remains visible if a placed table is opened there. Name the table-only
   step and point to the separate batch placement action; do not imply the derivative cannot reach a card.

**Do not misreport a future mismatch as present:** the CityGML forecast's
**“A CityGML reading is kept as evidence, not placed on the map.”** (N U/`upload-model.ts:87`) is correct
for this audited composition. It becomes stale only if CG1 is merged without updating it. There is **no matching
CityJSON evidence-only forecast** here: `.json` has the conditional words above, `.cityjson` gets Unknown.
N's CityJSON evidence suffix applies only when the declared-CRS outline conversion is not queued
(N I/`intake-native-readers.ts:246-256`); it must not be quoted as the successful CJ derivative's final state.
The table-only “nothing … appears on the map” help (B U/`BatchTableSection.tsx:113-114`) is also still true
of **Read as a table alone**, not a claim that TC1 does not exist.

## Qualification and next decision

No real input bytes, restricted paths, credentials or runtime configuration were opened. No tests or previous
branch result counts are promoted into AUD3 runtime evidence. All “Yes” cells need a combined-build rehearsal.
Rebuild the combined geo processor for the existing CSV2/NR3 plus GZ1/B3D1 Python changes; refresh/pin host
reader profiles after their code changes. NR4 itself adds no processor code, but its glTF/OBJ host profiles must
exist (B I/`gltf-config.ts:32-38`, `obj-config.ts:32-38`); a queued job does not prove an available reader.

Recommended order: fix ranks 1–6 words/coverage/accounting first; finish CW2/CG1 with source-bound provenance;
then rehearse one ordinary and one difficult real file through the fully combined front door to map/card or an
honest kept state. In particular exercise mixed KML+plan-photo ZIP, omitted native rows, UTF-16 placement,
10–16 MiB scanned PDF and a scattered wide vector. These are **recommended future inputs, not runs performed**.
