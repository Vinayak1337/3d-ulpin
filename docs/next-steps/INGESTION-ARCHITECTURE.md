# Ingestion architecture: probe everything, map files first, every part converted and shown as it is read

**Status:** technical design by the lead, 11 October 2026 (second version, after the owner asked for the architecture itself: chunking, per-format handling at any size, order of work, linking). It governs [P3](P3-ingestion.md) and section 1 of [the sprint plan](SPRINT-SELECTION.md). Nothing here is built unless a line says "exists". Lines marked **(read)** were checked by the lead in code on 11 October; lines marked **(LV0)** come from the worker's audit of 24 readers, merged on 11 October (`docs/evidence/gf5/lv0/readers.json`, `gaps.json`), which also corrected this document's first version. Constants marked *proposed* are starting values; each is fixed by a measured run, not by this document.

## 0. The answer in ten lines

1. **Upload is dumb, reading is smart.** The browser cuts bytes (8 MiB parts) and nothing else. The server cuts *meaning parts* (features, rows, pages, image windows, point chunks) with the reader for that format.
2. **Probe everything first, read nothing yet.** Within about a second of each upload finishing, a header-only probe says what the file is, its size class, its CRS and extent, and the keys it carries. That is the batch manifest (the "map of what we hold").
3. **Then a one-directional order, decided from the manifest:** wave 1 anchors (parcels, building footprints, boundaries) go to the map; wave 2 pictures and heights (imagery, elevation, point clouds) sit on them; wave 3 registers and tables attach to them; wave 4 documents and plans attach to them. Automatic by default; the officer can pin or reorder.
4. **Every part runs the same five steps, ending in one transaction:** read → normalise → map fields → write candidates and keys → publish one event. The map draws that part before the next one is finished.
5. **The plan for a file's fields is made once, on part 0,** and reused for every later part and every later file with the same layout. A model is asked per layout, never per part.
6. **Linking happens inside the write step:** the keys of each part are looked up against the anchors already there (index lookups, exact then spatial). A closing pass per file does what needs the whole file (duplicates, fuzzy names).
7. **A file that arrives out of order** (a register before any map) is read and indexed anyway and marked *waiting for an anchor*; when an anchor arrives, the same lookup runs from the other side.
8. **Sequential formats** are read by one cursor in one forward pass. **Indexed formats** (COG, LAZ, shapefile, GeoPackage, Parquet, PDF, ZIP) are planned from their index and their parts run in parallel, most useful part first (coarse before fine, on-screen before off-screen).
9. **A scheduler with reservations** picks the next part: probes first, then waves in order, round-robin between files inside a wave, and a part starts only if its stated memory and scratch disk fit in what is free.
10. **Nothing is dropped and nothing is guessed:** over-limit or unknown files are kept and say so; unknown CRS is a question, not an assumption; everything on the map is a candidate until an officer reviews it.

## 1. What the code does today, and the seven things that block this design

| # | Finding | Where | Consequence |
|---|---|---|---|
| B1 | Every job pins the **case revision** and re-checks it at claim and at each heartbeat; finalising any upload advances the case revision. **(read)** | `streaming-vector.ts` `assertStreamingInputTx`; `streaming-vector-worker.ts:135,178`; `large-original.ts:267,438`; the same `UPDATE cases SET revision=revision+1` in `documents.ts:126`, `ifc.ts:170`, `kml.ts:170` and six more | Adding a second file to a batch ends the read of the first with a conflict. REH1 saw it for documents (`DOCUMENT_INPUT_STALE`); from the code it is general (not yet run for the other readers). **A batch cannot work until this is changed.** |
| B2 | Lifetime and concurrency caps set for qualification: 128 streaming requests ever and 2 active; 128 upload receipts (v1), 8 receipts and 1 active (v2); 64 raster and 64 point sources; 1 active chunk mapping; 1 active streamed profile. **(read)** | `streaming-vector.ts` (`STREAMING_CAPACITY`, `STREAMING_HISTORY_CAPACITY`); `LARGE_ORIGINAL_LIMITS`, `LARGE_ORIGINAL_V2_LIMITS`, `RASTER_WINDOW_LIMITS`, `POINT_BATCH_LIMITS`, `CHUNK_MAPPING_LIMITS`, `STREAMED_PROFILE_LIMITS` | A horde of files exhausts them in one sitting. |
| B3 | The dispatcher takes the 12 oldest jobs, first in first out. **(read)** | `cases/processing.ts:206` | No lanes, no priority, no fairness: one large file's parts would starve a ten-row table. |
| B4 | The table reader collects the whole file in memory and stops at 2,000 rows. **(read)** | `streaming-vector-reader.ts:169-178`; `TABULAR_LIMITS` | Tables do not stream. |
| B5 | The map's area read returns one answer of at most 2,000 features; nothing carries a streamed part to something the map draws. | `areas.ts:240-242` **(read)**; `canonicalScene.ts:55-70` **(LV0)** | The streamed parts exist but are invisible. The NYC pack alone has 2,363 features (2,362 accepted, 1 quarantined) and is answered `AREA_LIMIT`. |
| B6 | **A table is admitted only if its hash and size are in the D8 development set**; any other table is refused `TABULAR_DATA_DENIED`. **(read, LV0)** | `tabular-source.ts:51-60` | A judge's table is refused at the door today. Admission must become: any table whose provenance the officer states, with the privacy rule deciding whether the teacher may see its profile. |
| B7 | Table mapping proposes and reads rows, but turning mapped rows into registry candidates is refused as unqualified. **(LV0)** | `ingestion/service.ts:225-268` | A register can be read but cannot become facts on a building. |

What already works and is kept: upload in 8 MiB hashed parts up to 7 GiB; the GeoJSON reader as a true stream (one object-store stream, a JSON cursor with byte offsets, parts of 100 features, ordered publication with a look-ahead of 8 parts, quarantine of a bad feature without losing the file) **(read)**; fenced job attempts with a 180 s lease, 30 s heartbeat and three attempts **(read)**; the chunk-mapping job, which follows the raw parts as they are published **(LV0)**; header-level readers for GeoPackage, shapefile ZIP, workbook (SAX), IFC (metadata only, no geometry), GeoParquet (windows of 1,000 rows), LAZ/COPC (laspy), rasters (rasterio), PDFs (PyMuPDF, pypdf; native parse to 10 MiB and 100 pages, OCR on request for pages 1 to 8), DOCX paragraphs and tables **(LV0)**; the document receipt keeps bytes it does not understand **(LV0)**; mapping memory, learner, teacher; case event stream with part notifications that carry job, index, hash and counts, never geometry **(LV0)**.

Readers that read one part per request and have nothing asking for the next: raster window, point batch, GeoParquet continuation, PDF OCR, archive members. Readers that read their whole bounded file in one job: area import, KML, DXF, IFC, CityGML, CityJSON, glTF, OBJ **(LV0)**. These are where strategy B's plan job and the scheduler are added.

## 2. The model: batch, item, part

- **Batch** = a case (exists). **Item** = one file or one member of a container = a source (exists). **Part** = one bounded piece of an item's meaning.
- One new additive ledger, visible SQL, no new service:

```
usp_intake_items   item_id (= source id), case_id, parent_item_id, family, format, size_bytes, size_class,
                   wave, state, placement, plan_ref, parts_planned (null = not known yet), parts_done,
                   records_seen, limit_reason, probe_ref, pinned_by_officer
usp_intake_parts   item_id, part_index, locator (byte range | record range | page | window+level | chunk | row group),
                   priority, state, job_id, cost_memory_mb, cost_scratch_mb, counts, result_ref, issue_code
usp_holding_keys   item_id, part_index, key_type, key_norm, key_raw, locator          index (key_type, key_norm)
usp_holding_extent item_id, part_index, bbox in EPSG:4326, crs_state                    GiST index
```

- **Item states:** `uploading → received → probed → planned → reading (n of m) → read | read_to_limit | failed_part` and, beside it, **placement:** `on_map | attached | waiting_for_anchor | needs_answer | not_understood`.
- **Part states:** `planned → queued → running → published | quarantined`. A part is retried up to three times by the existing job authority; a part that still fails is quarantined with its locator and the item continues.
- **Identity of a part's work** = hash(source SHA-256, reader version, locator). Running it twice is a no-op; a restart continues from the ledger; a changed reader marks old results stale, it does not delete them (the freshness field exists).
- **Fix for B1 (decision):** a job pins what it reads: source id, source revision, source SHA-256, reader version, access binding. It does **not** pin the case revision. A read is stale only if its own source is superseded, the case is archived or access changed. K13 becomes this rule for every operation, in one shared check, not per reader. **How it is checked (lead, 11 October, after K13's Step 0):** the job's input is rebuilt from current state and compared field by field with the pinned input; it is current when every field except `caseRevision` is equal and the case revision has not gone backwards. No history is consulted: K13 found twenty writers of the case revision (fourteen kinds of receipt, unit preparation, source levels, a unit's outline, a manual unit, a placement review, a detail derivative) and no stored record of what changed between two revisions (`docs/evidence/gf1/k13/step0.json`), so "only other files were added" cannot be proved and is not the rule. The counter is the writers' concurrency check; none of its writers changes what a read of a source's bytes depends on, and it never guarded access, policy, reader or frame changes (none of them advances it). A consumer that writes case-level state (a proposal, an association) keeps its own revision pin. The shared function is `packages/server/src/modules/usp/ingestion/source-pin.ts`.

## 3. Upload: transport parts (the browser's only job)

- `File.slice` in fixed 8 MiB parts (exists); 3 parts in flight *(proposed)*; each part hashed in a Web Worker; retry a part with back-off; **resume** by asking the server which parts it holds (`GET` upload exists). Browser memory is bounded by parts in flight, never by file size.
- The server hashes the assembled original at finalise; the same SHA-256 already held in this batch is not read twice (the new item points at the existing source).
- Folder drops keep relative paths, so sidecars can be grouped (section 4.2).
- Size classes, by bytes, decide the upload profile and the reader's strategy, never whether the file is understood:

| Class | Bytes | Upload | Reading |
|---|---|---|---|
| S | ≤ 16 MiB | one or two parts | may be read in one job, still published in parts |
| M | ≤ 128 MiB | v1 multipart | streamed or planned in parts |
| L | ≤ 7 GiB | v2 multipart | parts only; needs scratch reservation; derivatives built in bounded windows |
| XL | > 7 GiB | refused at the door with the size said; alternative: *register in place* from a server folder the operator names (original hashed by stream, not copied) | as L |

- Reading starts at finalise. Reading while uploading is not built: most formats keep their index at the end of the file (ZIP, Parquet, PDF, many TIFF and LAZ files).

## 4. Probe and plan

### 4.1 Probe (lane `probe`, highest priority, target under one second per file)
Reads headers only, by range requests on the stored object; never the body.

| Signature | Reads | Learns |
|---|---|---|
| magic bytes, then structure | first 64 KiB, last 64 KiB | format and version; text files: encoding, JSON/XML root, delimiter |
| GeoJSON | first value keys | collection or sequence framing, `crs` member, first feature's geometry type and properties |
| shapefile set | `.shp` header (100 bytes), `.shx` length, `.dbf` header, `.prj`, `.cpg` | record count, bbox, fields, CRS, encoding |
| GeoPackage | `gpkg_contents`, `gpkg_geometry_columns`, `gpkg_spatial_ref_sys` | layers (each becomes a child item), counts, bbox, CRS |
| GeoParquet | footer | row groups, schema, `geo` metadata (CRS, bbox) |
| CSV / XLSX / ODS / DBF | first rows; workbook's sheet list | sheets (child items), header rows, columns, types, coordinate columns if any |
| GeoTIFF / COG | IFDs | size, bands, type, CRS, transform, tiling, overviews, nodata |
| LAS / LAZ | public header, VLRs | point count, format, scale and offset, bbox, CRS, chunk table present |
| PDF | trailer, page tree, first pages | page count, per-page: text layer, page size, image-only, vector operators; encrypted or not |
| IFC | STEP header, a streaming count of entity types | schema, counts of buildings, storeys, spaces; site latitude/longitude or map conversion present |
| CityGML / KML / GML | root and first members | version, member kinds, `srsName` |
| ZIP / KMZ | central directory (end of file) | members (section 4.2) |

The probe writes the **holdings card** (`probe_ref`): family, format, size class, CRS state (`stated | sidecar | absent | conflicting`), extent, counts, the key types present, and first keys found. The union of cards is the batch manifest.

### 4.2 Containers and sidecars
- ZIP members are listed from the central directory without extracting. Guards: member count, total expanded bytes charged to the reservation, compression ratio, nesting depth 2, no absolute or parent paths. Each wanted member is extracted by stream into storage as a **child original** (own SHA-256, pointing at parent and member path).
- Files with the same folder and base name are one item: `.shp+.shx+.dbf+.prj+.cpg`; raster + `.tfw/.jgw/.pgw` + `.prj` + `.aux.xml`; `.tab` sets. A sidecar is never an item alone. A missing `.prj` gives CRS state `absent` → question.
- A pack with a manifest (the NYC pack) is an ordinary ZIP: its manifest is read as one more source of declared kinds, never trusted over the bytes.

### 4.3 Waves: the one-directional order (owner's question, 11 October: yes, map files first)
The planner assigns each item a wave from its card. Work of wave *n* is scheduled ahead of wave *n+1*; later waves still read in the background if capacity is free, but they attach **to** earlier waves, never the other way round.

| Wave | Items | Why here | Result |
|---|---|---|---|
| 0 | every file | probe | manifest; each placeable item's **extent rectangle drawn on the map at once** as "arriving" |
| 1 Anchors | cadastral parcels, building footprints, administrative and project boundaries, georeferenced 3D/BIM with building identity | everything else attaches to these | candidates on the map, keys in the index |
| 2 Surface | orthophotos, DSM/DTM, point clouds | need anchors to mean anything; heavy | picture under the anchors; roofprint candidates where no footprint exists; height estimates per footprint |
| 3 Attributes | registers and tables (RERA, tax, rights, unit schedules), survey control | attach by key or coordinate | facts and claims on anchors; rows with coordinates also drawn |
| 4 Evidence | PDFs, scans, plans, drawings, photos, ungeoreferenced models | slowest (OCR, models); attach by key | cited fields, levels and units, evidence on anchors |

Rules: automatic by default; the tray shows the order before reading starts and the officer can pin an item to wave 1 or hold one back; a batch with no anchor at all skips to what it has (a lone register is read and indexed, placement `waiting_for_anchor`); a file dropped later joins its wave and the linker runs from its side (section 7).

## 5. Meaning parts: how each format is cut, at any size

Two cutting strategies. Which one a format gets depends on whether it has an index.

**Strategy A, one cursor (sequential formats).** One job opens one stream on the object and walks forward. Memory = one record plus the look-ahead window. A part closes at the first of: *R* records, *B* bytes of output, *T* ms of work (*proposed*: 500 records, 512 KiB, 250 ms), so a few huge geometries make a small part and many tiny ones a large part. Parts are published in file order with a bounded look-ahead (8, exists). Part boundaries are recorded as record index and byte range, so a locator always points into the unchanged original. Line-delimited formats may additionally be split by byte ranges across workers with the usual rule: *a part owns the records that start inside its range; it reads past its end to finish the last one and skips forward to the first record start*.

**Strategy B, plan then fan out (indexed formats).** A plan job reads the index and writes all parts with locators and priorities into `usp_intake_parts`. Part jobs are independent, run in parallel, and may finish in any order. Priority is *usefulness*: coarse before fine, on-screen before off-screen, first pages before last.

| Format | Strategy | Part = | How it is cut | Memory bound | Notes at L size |
|---|---|---|---|---|---|
| GeoJSON collection | A (exists) | ≤ R features | JSON cursor, byte offsets per feature | 1 MiB a feature (exists) | lift 128 MiB and 4,096-part caps; cursor is already constant-memory |
| GeoJSON sequence, NDJSON | A, splittable | ≤ R features | record-separator framing exists (RFC 7464); plain newline framing is added; byte-range rule | one line | parallel by ranges |
| Shapefile | B | record range | `.shx` gives each record's offset; `.dbf` rows are fixed width | N records | 2 GiB per component by format; encoding from `.cpg` |
| GeoPackage | B | rowid range per layer | keyset `WHERE rowid > ? ORDER BY rowid LIMIT n`; geometry = GPKG header + WKB | n rows | needs the file on scratch disk (reserved); R-tree gives on-screen first |
| GeoParquet | B | row group (or a slice of one) | footer lists groups and their byte ranges | one row group | column statistics give bbox per group where written |
| KML / KMZ | A | ≤ R placemarks | SAX over `Placemark`; styles ignored | one placemark | always WGS 84 |
| GML, CityGML | A | ≤ R members | SAX over `featureMember` / `cityObjectMember` | one member | building members carry storeys and LoD |
| CityJSON | whole | one job | shared vertex array | file size × k | ceiling stays; CityJSON sequence is strategy A |
| DXF (text) | A in two passes | layer, then ≤ R entities | pass 1 header, tables, blocks (kept); pass 2 entities | blocks table | drawing units from `$INSUNITS`; sheet coordinates unless georeferenced |
| CSV / TSV | A, splittable if no quoted newlines | ≤ R rows | streaming decoder; delimiter and header rows from the probe | one row | replaces today's whole-file buffer (B4) |
| XLSX | B over sheets, A inside a sheet | ≤ R rows of one sheet | ZIP member per sheet; SAX rows; shared strings loaded first, spilled to scratch above a bound | shared strings | formulas: cached values, flagged; merged headers via header rows (exists, ≤ 5) |
| ODS, DBF, JSON records, HTML tables | A (DBF also B) | ≤ R rows | existing readers made to yield | one row | |
| PDF | B | page (text pages in runs of ≤ 8) | page tree; each page classified at probe | one page raster at the stated dpi | routes per page, section 6.3; priority to first pages and pages holding keys |
| Page images (JPEG, PNG, TIFF without georeference) | one part each | the image | classified: document scan, plan, photo (EXIF position → a point), aerial | image | |
| GeoTIFF / COG | B | window at a pyramid level | tile grid from the IFDs; overview levels coarse → fine | one 256–512 px window × bands | if untiled or without overviews: one derivative job builds a tiled pyramid copy by strips (original untouched), then as COG |
| LAS | B | record range | fixed record length: offset = header + i × record | N points | formats 0–10 of 1.2–1.4 *(today the reader takes compressed 1.4 format 6 only; an uncompressed LAS is refused)* |
| LAZ, COPC | B | LAZ chunk (≈ 50,000 points); COPC octree node | chunk table; COPC levels coarse → fine | one chunk | |
| IFC | scan, then B | storey | pass 1: streaming scan keeps only spatial-structure entities and their relations (small) → building, storeys, spaces without geometry; pass 2 (optional, under a ceiling): geometry per storey | pass 1: structure only; pass 2: one storey | multi-GB files still yield storeys and spaces; geometry above the ceiling is "kept, not read" |
| glTF/GLB, OBJ, 3D Tiles | whole / already tiled | display only | never a source of records | file | placed only if georeferenced |
| ZIP | B over members | member | central directory | stream copy | then each member by its own row above |

**Display is cut separately from analysis.** A raster is shown through its pyramid (coarse first, so the whole image appears at once and sharpens), while the roof model reads its own grid of chips at the model's ground resolution with overlap, on the GPU lane, on-screen chips first, results merged across chip edges. A point cloud is never sent to the browser as points: its parts are folded into a height grid (highest and lowest return per cell) that both draws and feeds per-footprint height estimates, plus a thinned preview.

## 6. The part pipeline: read → normalise → map → write → publish

One job per part (strategy B) or one loop iteration per part (strategy A). Steps 4 and 5 are **one database transaction**, so a part is either fully visible or not at all.

1. **Read** the part by its locator from the unchanged original. Bad records are quarantined with their locator; the part continues.
2. **Normalise.** Geometry is validated and transformed for display to EPSG:4326 by the one existing normaliser; the source coordinates and CRS stay with the candidate. CRS `absent` or `conflicting` → the item stops at `needs_answer` after part 0 (which is shown in a neutral frame, not on the globe). Units, dates and numbers are parsed by the conversion registry, never by a model.
3. **Map fields** with the item's mapping plan (section 6.1).
4. **Write** candidate rows for the part (state `candidate`, citing item, part and record locator), their display geometry, their keys into `usp_holding_keys`, the part's extent, the link proposals found for those keys (section 7), the part's counts and state.
5. **Publish** one event on the case stream: `{item, part, counts, cursor}`. No payload in the event.

### 6.1 The plan is made once
Part 0 is profiled (columns, types, samples). Its layout fingerprint goes down the ladder: **memory** (approved before) → **local learner** → **Sarvam teacher** (masked profile only, through the gateway, wide tables in column groups) → **officer question**. The resulting plan is stored on the item and applied to every later part without a model call. Each part checks drift cheaply (new columns, type change); drift produces a new fingerprint and one more trip down the ladder for the changed columns only. So a million-row table costs at most a handful of teacher calls, and the second file with the same layout costs none. While a plan waits for the teacher or the officer, raw parts keep being read and stored; they are mapped as soon as the plan exists (reading never blocks on a model).

### 6.2 What the map does with an event
The Studio holds one subscription per batch. On an event it fetches that part's display features and hands them to the scene. The first version of this needs no new contract **(LV0)**: the existing part notification names job and index; the Studio reads the mapped part and the raw part it points at (`geometryRef`), joins them by source, job, revision, index and hash, and keeps them in a candidate scene state keyed by locator, separate from registry identities. A shared `GET …/items/:id/parts/:n/display` read replaces the join once the ledger exists. Either way the scene adds only what is new inside a frame budget (task LV1). **The client pulls at its own pace; the server never pushes geometry.** If the tab is slow, parts wait on the server, already stored; nothing is lost and nothing floods. Beyond a drawn-feature budget the map switches from per-part fetches to viewport reads (`bbox` + cursor on the candidate table's spatial index) with flat merged footprints when zoomed out and extruded buildings when near; that replaces the 2,000-feature list (B5).

### 6.3 Documents and plans, per page
- **Text page:** the page's own text with coordinates. **Scan:** local OCR. **Table page:** table extraction → rows → the table path above. **Drawing page** (large format, vector operators or line image): vector extraction when the PDF is vector, else rendered and given to the floor-plan model; results are rooms and labels in sheet coordinates, areas "as printed".
- Fields (project number, tower, floors, unit numbers, areas) are extracted over bounded batches of page text; **every value must be a quote found on a named page region or it is dropped** (exists for storeys).
- Encrypted PDF → `needs_answer` (an unlocked copy is asked for; no password is stored). Private or restricted documents stop at local reading and the officer.

## 7. Linking: during the stream, at its end, and for late arrivals

- **Keys** are normalised the same way for every format: parcel ULPIN; survey/khasra number with village and district codes; RERA project and registration numbers; sanction numbers; building, tower, wing names; floor label and ordinal; unit number; address, locality, PIN code. Party names are indexed only as *present*, their values stay in the source.
- **During the stream (step 4 of each part).** For each key of the part: one index lookup `(key_type, key_norm)` among keys of earlier waves. For each geometry or coordinate: one spatial lookup (point in parcel, footprint in boundary, extent overlap). Exactly one exact match → a **link proposal** stored through source-fusion with its two citations and method `exact_key` or `spatial`. Several matches, or none → nothing is chosen; the key waits in the index. Cost per part is a few index lookups; it does not grow with the batch.
- **At the end of an item (closing pass, one job).** What needs the whole file: duplicate keys inside the file, many-rows-to-one-building grouping (a unit schedule under its tower), name and address similarity inside a blocking key (same PIN code or locality), conflicts between sources on the same anchor (kept as a conflict, never resolved by a model).
- **Late or out-of-order files.** The lookup is symmetric: when an anchor part is written, its keys are looked up among *waiting* keys of later-wave items already read, and proposals are created from that side. So order affects only how soon a link appears, not whether.
- **Review.** A link is a candidate. Exact single links can be accepted in bulk per file; scored or plural ones are officer questions. A link never creates ownership, issuance or geometry.

## 8. The scheduler: lanes, waves and reservations (replaces first-in-first-out, B3)

- **Lanes** with their own concurrency: `probe` (many, tiny), `vector`, `table`, `document`, `raster`, `point`, `model3d`, `link`, `gpu` (exactly 1: roof model, floor-plan model, OCR when on GPU), `teacher` (paced by the gateway; money and call caps global).
- **Pick rule** each tick: (1) any probe; (2) lowest wave with runnable parts; (3) inside the wave, deficit round-robin between items, each item earning a quantum of work per round, so a 5 GB raster cannot starve a 40-row table and small files finish first; (4) inside an item, highest part priority.
- **Reservation rule (admission):** every part states its worst-case memory and scratch disk. It starts only if both fit in what is unreserved; it holds nothing else while it waits, so the machine never over-commits and no two jobs can wait on each other. The same rule already guards upload storage (`maxReservedOriginalBytes`); it is extended from bytes on disk to worker memory, scratch and the GPU.
- **Back-pressure:** strategy A readers stop producing when their look-ahead is full; strategy B part jobs are released at most *W* ahead of what is published; the browser pulls. Three independent valves, no shared queue that can flood.
- **Quotas instead of lifetime caps (B2):** active jobs per lane, reserved bytes per batch and in total, retention of finished parts by age. Finite, but renewable.
- All of this is the existing dispatcher tick and job tables with a different `ORDER BY` and an admission check; no second broker.

## 9. Limits said out loud
For every lane a ceiling stays (bytes, records, pages, pixels, points). At the ceiling the item ends `read_to_limit` with what was read, what was not, and why ("409,600 of about 1.2 million features read; the rest is kept, not read"). Formats with no reader by 22 October are received, kept and marked `not_understood` with their signature: DWG, E57, PLY, 7z/RAR, File Geodatabase, FlatGeobuf, service URLs.

## 10. Build order

| Step | By | Work | Proof on the empty rehearsal runtime |
|---|---|---|---|
| **A1 Foundation** | 12 Oct | B1 (jobs pin their source, not the case); B6 (table admission by stated provenance); ledger tables; probe lane for vector, table, ZIP; scheduler pick rule and quotas (B2, B3) | twenty files added one after another to one batch all read; manifest lists every file with wave |
| **A2 Spine** | 14 Oct (M1) | one front-door route; ZIP fan-out with sidecar grouping; part pipeline steps 1–5 for GeoJSON, shapefile, GeoPackage; display read by part and by viewport (B5); LV1 scene | the NYC pack and one Indian parcel layer through the product's routes, extents at once, parts drawn as read, no frame over 100 ms |
| **B Attach** | 17 Oct | table reader as a stream (B4) with the plan-once ladder; mapped rows become candidates on their anchor (B7); keys and during-stream linking; closing pass; PDF page lane routed per page; waiting-for-anchor list | footprints, then their register, then a plan PDF, in any order, end linked; an unseen table layout learned once and reused |
| **C Surface and models** | 19 Oct (M2) | raster pyramid display and roof chips; LAS/LAZ parts into a height grid; IFC structure scan; limits in words; bulk review | one file per family, one L-class file, one unknown file |
| **D Rehearse** | 20–21 Oct | two runs from empty with files the team did not choose | recorded; list of what was not understood |

## 11. What does not bend
Originals immutable, every candidate cites original and locator. Unknown stays unknown (no assumed CRS, no height 0, no invented unit, parcel, floor or owner). Official parcel ULPINs are their issuer's assertions; application identities are assigned only after review. Model and teacher outputs are candidates (`pseudo_label`, never evaluation truth). Private files never leave for a provider. One job authority, one registry, one gateway, one conversion contract.

## 12. Decisions for the owner
1. **Size targets for the presentation** (they set which ceilings are raised and measured): proposed one file ≤ 1 GB, a vector layer ≤ 500,000 features, a table ≤ 1 million rows, a raster ≤ 2 GB, a point cloud ≤ 1 GB.
2. **Automatic waves with officer override** (proposed), or the officer always picks the anchor files by hand before anything is read.
3. **May a judge's file go to the Sarvam teacher** as a masked column profile? If not, a new layout stops at the officer question.
