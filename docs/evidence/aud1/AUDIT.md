# AUD1 — unknown data dropped into Studio

TASK   AUD1 — unknown-data drop audit            GATE P0 hygiene; no runtime gate claimed
WORKS  The drop paths, screen outcomes and eight ranked demo risks are traced below.
SEE IT `git show HEAD:docs/evidence/aud1/AUDIT.md`
INPUTS No real inputs opened or executed; good and difficult live-input checks were prohibited.
GAPS   Static audit only; retention, reading, map placement and a property card are different outcomes.

## Scope and verdict

Audited checkout: `task/aud1-unknown-data-audit`, source head `0af36554`, on 22 October 2026.
Only this report is changed. No Docker, application, processor, database, provider or data-drive access was used.
The architecture and STATUS are intent/history, not proof that this checkout or the presentation runtime works.
The board names different staging and deployed heads; this report does not certify that deployed runtime.

**The promise “any kind, any size, streamed to a card with one confirmation” is not supported by this code.**
There is a useful retained-original front door, bounded vector-to-package/card flow, surface display flow,
PDF text reading, image preview and IFC structure reading. Several formats stop honestly at kept-only.
Some small files are parsed before retention, some ordinary table encodings/delimiters disagree with the probe,
and the multi-file table UI has a missing selection action.

All outcomes below are **static deductions from the cited branches**, not observed screenshots or test results.
Quoted screen words are literal labels or excerpts of literal templates; ellipses omit variable text.
A successful reader still needs the configured processor, dispatcher, storage and schema; their availability
was not checked. No timings, frame-rate guarantees, successful unseen-file import or accuracy are claimed.

## Route/job key

Paths here are relative to `/api/v1/ingestion/cases/:caseId`, unless written otherwise.
Every retained batch original is enrolled with `POST /intake/items`, then read with `GET /intake`.
Enrollment probes ranges and queues a family-specific job; it is not a registry write. [^api] [^enrol]

- **U**: `GET /api/v1/ingestion/upload-limits`, `POST /uploads`, `PUT /uploads/:id/parts/:n`,
  `POST /uploads/:id/finalize`; then enrollment. Browser hashes the entire file first, sends 8 MiB slices
  sequentially, and follows finalization. v2 finalization uses a storage job. [^upload] [^upapi] [^upserver]
- **B**: small `.geojson`/`.json`: multipart `POST /sources` with `format=geojson`;
  small `.zip`: multipart `POST /intake/archives`. Files above 16 MiB and all other names use U.
  The choice is by filename/size, not byte detection. [^retain]
- **G**: bounded source → `intake-draft` → existing area normalizer/package/targets;
  large-original GeoJSON → `intake-large` → `streaming-vector` → `streamed-profile` → approved layout →
  `chunk-mapping` → package cuts → `intake-run` review/confirmation/card steps. [^draft] [^large] [^target]
- **N**: `intake-native-derivative` → `POST /internal/area/convert-native` in the geo service →
  `native_gis.py` → retained GeoJSON derivative per layer + locator sidecar → enrollment → large G.
  Even a tiny converted layer takes the large-original G path. [^native] [^nativeworker] [^pyconvert]
- **T**: isolated `.csv`/`.xlsx` opens the table dialog; small files use `POST /sources`;
  large files use U then `POST /sources/:sourceId/table` → `table-profile` job.
  A kept batch CSV/XLSX needs **Read as a table**, calling the same `/table` route.
  Parsing uses `tabular-source.ts`, `tabular-stream.ts` and the workbook subprocess.
  Mapped table rows are not independent building records. [^route] [^tableui] [^tableapi] [^tabsource]
- **D**: U → `document-extraction` in `native_only` mode → document native extraction →
  geo PDF extractor (`native_pdf.py`); no automatic OCR selection. [^pdfqueue] [^pdfnative]
- **P**: U → `intake-page-image` → native header + bounded preview → candidate label question. [^image]
- **I**: U → `ifc-native` → IFC processor → `native_ifc.py`, including its structure scan. [^ifc]
- **S**: U → `raster-window` or `point-batch` jobs per planned part → `raster_window.py` / `point_batch.py`;
  accepted display parts use `GET /intake/items/:id/parts` and `/parts/:n/display`. [^surface] [^surfpy]
- **Z**: archive probe → `intake-zip-layers`; only unrefused GeoJSON members become independent originals/G.
  A ZIP containing a detected shapefile instead goes to N; a detected KMZ goes to N. [^zip] [^zipprobe]

Screen state/placement labels are centralized: **File checked**, **Layout prepared**, **Reading file**, **Read**,
**Read to the limit**, **Part could not be read**; **Not placed yet**, **On the map**, **Needs an answer**,
**Not understood**, **Waiting for a matching map record**. The tray displays the server's `limitReason`. [^words]

## Input trace table

Evidence footnotes expand to exact repository **file:line** ranges. Outcomes assume the input meets each
stated bound and the needed runtime dependency is available; exceptions are named rather than guessed.

| Input | Path taken | Outcome in screen words / boundary | Evidence |
| --- | --- | --- | --- |
| GeoJSON 2D, small | B → G | “Needs an answer” → “On the map” after approval. | [^retain] [^draft] |
| GeoJSON 2D, large | U → large G | “Reading file”; closure before map packages. | [^large] |
| GeoJSON with Z | B/U → G | Same flow; source Z is not building height. | [^zheight] |
| Shapefile ZIP | B/U → N → G | “…converted to GeoJSON…”; CRS may need an answer. | [^native] [^shppy] |
| Loose SHP/SHX/DBF | U each → N | “Shapefile part: waiting for…” until complete. | [^set] |
| KML | U → N → G | “…converted to GeoJSON…”; overlays/links not read. | [^native] [^kmlpy] |
| KMZ | U → probe → N | Same; archive limits can stop conversion. | [^zipprobe] [^kmlpy] |
| GeoPackage | U → N → G | “…converted to GeoJSON…”; missing CRS asks. | [^native] [^gpkgpy] |
| CSV comma UTF-8 | T; U in batch | “Read as a table”; draft rows only. | [^tableui] [^draft] |
| CSV semicolon/pipe | T; U in batch | Can appear as one column, not refusal. | [^csv] [^streamcsv] |
| TSV | U → tsv | “Not understood”; no table action for tsv. | [^sniff] [^tableui] |
| CSV Windows-1252 | T; U in batch | “The literal reader requires valid headers…” | [^csv] [^tabsource] |
| CSV UTF-16 + BOM | T or U → T | Small decodes; large: “…UTF-8 only.” | [^csv] [^streamcsv] |
| XLSX | T; U in batch | “Read as a table”; sheet/header question first. | [^tableapi] [^tableui] |
| XLS binary | U → unknown | “Kept…its kind was not recognised…” | [^sniff] [^kept] |
| ODS | U → probe → ods | “Kept as an ODS table…”; no batch reader. | [^zipprobe] [^kept] |
| Scanned PDF plan | U → D | “…no OCR runs in a batch.” | [^pdf] |
| Vector PDF plan | U → D | “Text was found on…”; not room geometry. | [^pdf] [^pdfnative] |
| JPEG photo/plan | U → P | “Kept for review as a page image…” | [^image] |
| PNG photo/plan | U → P | “What does it show: a plan…a photo…?” | [^image] |
| DXF drawing | U → kept-only | “Kept as a DXF 3D model…” | [^kept] [^separate] |
| DWG drawing | U → dwg | “Kept as a DWG file…”; no batch reader. | [^sniff] [^kept] |
| IFC | U → I | “…building[s]…storey[s]…space[s]; they are candidates.” | [^ifc] |
| CityGML | U → kept-only | “Kept as a CityGML 3D model…” | [^kept] [^separate] |
| CityJSON small .json | B → wrong parser | “Refused”: “…FeatureCollection originals only.” | [^inventory] |
| CityJSON via U | U → kept-only | “Kept as a CityJSON 3D model…” | [^kept] |
| GeoTIFF/COG photo | U → S | “On the map” or “Read but not placed…”. | [^surface] [^surfwhere] |
| GeoTIFF/COG DEM | U → S | Same; display only, not a height fact. | [^surface] [^surfpy] |
| LAS uncompressed | U → S refusal | “…LAZ of LAS 1.4 point format 6 only…” | [^surface] |
| LAZ / COPC | U → S if eligible | “Read” / “On the map”, or kept with reason. | [^surface] [^surfpy] |
| Mixed ZIP | B/U → Z, or N | GeoJSON fan-out; other members “Not taken in:…”. | [^zip] [^zipwords] |
| File over 2 GB | U/v2 | “Uploading…”; semantic limits remain. | [^uplimits] [^bounds] |
| No extension | U → probe | Matching path, or “Kept…kind was not recognised…”. | [^sniff] [^kept] |
| Wrong extension | Name route first | Can be “Refused” before durable retention. | [^retain] [^tableapi] |

### Important qualifications to the table

- **GeoJSON:** small B accepts at most 2,000 features and a FeatureCollection, despite the 16 MiB byte bound.
  A small dense collection can therefore fail before retention. Large G allows at most 1 GiB / 500,000 features,
  and its raw validator accepts only Polygon/MultiPolygon. A small Point/Line GeoJSON can enter B, but a native
  Point/Line layer converted through N is sent to that polygon-only validator. GeometryCollection is not supported
  by the bounded manual profile either. Modern RFC GeoJSON without a `crs` member gets the existing inspection's
  CRS evidence on B; this audit is not alleging that every missing `crs` member is an error. [^inventory] [^raw]
- **Z:** `area.py` keeps the original geometry and a min/max/count of source Z with unknown unit/reference;
  it uses XY for the horizontal footprint. Mixed XY/XYZ within a feature and fourth/M ordinates are refused,
  not silently flattened. Z is not an extrusion, storey height, datum qualification or issued identity. [^zheight]
- **Native GIS:** conversion input, loose-set total and each derivative have a 128 MiB ceiling, up to 100 layers.
  GeoPackage conversion reads feature tables, not raster tiles or arbitrary tables; rows need stable rowid or
  integer-primary-key order. Shapefile Z/M/MultiPatch are explicitly not converted; `.cpg` is used, absent `.cpg`
  defaults to UTF-8. Missing `.prj` can take an officer-stated EPSG answer; a conflicting/unresolvable existing
  declaration is not overwritten. [^gpkgpy] [^shppy] [^pyconvert]
- **Loose sets:** grouping uses retained source names with a common stem in the case, case-insensitively;
  the browser sends `File.name`, not `webkitRelativePath`. Folder identity preservation was not found in this
  drop path, so same-named components from different directories can collide: inference from those two seams.
  `.shp` name and matching header are required; extensionless shapefile components cannot form this set. [^set]
- **KML:** names/ExtendedData and coordinates are retained through a streamed Placemark conversion with
  WGS84 basis. Network links and Ground/Photo/Screen overlays are counted, never fetched. Nonpolygon KML layers
  meet the same large-G polygon restriction; conversion is not a promise of successful map placement. [^kmlpy]
- **Tables:** comma parsing does not use the delimiter recorded by the probe. A semicolon/pipe table without
  commas can pass as a single literal column: that is a code deduction, not a measured sample result.
  Windows-1252 is not accepted as an encoding when non-UTF-8 bytes occur; ASCII-only content is indistinguishable
  and valid UTF-8. BOM-marked UTF-16 works only in the bounded reader; BOM-less UTF-16 is not established.
  An unsupported delimiter outside comma/tab/semicolon/pipe may be unrecognized altogether. [^csv] [^streamcsv]
- **XLSX:** small T is bounded to 2,000 rows/256 columns; above 16 MiB, the streamed table path allows up to
  7 GiB/1,000,000 rows but still needs an exact sheet and header rows. Scratch must be configured outside Git
  with room for the source plus 1 GiB. Macro/embedded-object and expansion limits can refuse the workbook.
  ODS has a separate native reader in the repository, but this batch dispatcher does not select it. [^tabsource]
- **PDF:** batch admission is 16 MiB, actual native text extraction is 10 MiB and at most 100 pages.
  Over-limit content is kept, not processed beyond the ceiling. Encrypted PDF says to add an unlocked copy.
  Vector text is not vector plan/room extraction, and scanned pages are explicitly unread without OCR. [^pdf]
- **Images:** preview is bounded to a 128 MiB original / 250 million pixels / 1,024-pixel preview side.
  Larger images only have their first 1 MiB inspected. EXIF location presence is recorded, not a placement.
  Neither “plan” nor “photo” answers launch a plan/roof model or create a building/card. [^image]
- **IFC:** automatic structure/metadata reading is at most 32 MiB. The processor expressly produces no geometry,
  tessellation or measurement. This queue settles the item and exposes structure; it does not create G packages
  or the targets the batch card run consumes. That last consequence is inferred from the separate queue/target
  creation call paths, not a live refusal. [^ifc] [^target]
- **Surfaces:** 16 MiB original, raster at most 100 million pixels / 4 bands; point cloud at most 5 million points,
  LAZ 1.4 format 6, no extra dimensions. Only 32 raster windows of 256×256 are planned, so larger valid grids can
  end **Read to the limit**. Each window/batch fetches and hashes the whole original into scratch again; COG is
  not range-read as a pyramid. Surfaces cannot originate building/card targets. [^surface] [^surfpy] [^bounds]
- **ZIP:** directory probe is 2 seconds / 2,000 members / 1 MiB directory / ratio 100 / 7 GiB expanded bytes.
  Non-UTF-8 names, unsafe paths, encrypted members, ZIP64 layouts or incomplete member heads can prevent useful
  probing. Budget exhaustion returns the item to **Original received** with `INTAKE_PROBE_BUDGET`; it is not proof
  of “unknown format”. Child cards alone are not extracted originals/read jobs. A mixed ZIP containing SHP
  selects shapefile N and bypasses generic GeoJSON Z fan-out. [^enrol] [^zipprobe] [^zip]
- **Over 2 GB:** v2 capacity must be configured; otherwise upload pauses with the server's capacity reason.
  Above 7 GiB the browser says **This file exceeds the upload maximum of…bytes** before creating a receipt.
  There is no register-in-place alternative on this Studio path. A 2–7 GiB CSV/XLSX has a possible bounded T path;
  GeoJSON, native GIS, PDF, IFC, raster and point semantic readers do not accept that size. No elapsed-time or
  large-browser-memory claim was verified. [^uplimits] [^upserver] [^bounds]
- **Name/content disagreement:** sniffing recognizes many bytes, but it runs only after the chosen retain route.
  Small PDF renamed `.json` goes to the GeoJSON parser; PDF renamed `.zip` fails “This file is not a ZIP archive”.
  CSV renamed `.xlsx` asks for workbook selection. A valid file with no suffix generally reaches U and sniffing;
  a no-suffix GeoJSON then uses large G even when tiny. `nameDisagrees` is metadata and is not a routing repair.
  A root JSON `type` outside the first 64 KiB can also evade the bounded signature detector. [^sniff] [^retain]

## Eight gaps most likely to damage the live demonstration

Ranked by likely presentation impact, not implementation order. Hours are planning estimates for the smallest
bounded improvement described, including a good and difficult input check, not promises of universal support.
“Runtime: yes” means an authorized runtime rehearsal is needed to qualify the end-to-end result; this audit
performed none. Docker is only needed if that runtime/processor is supplied by Docker, not for source inspection.

### 1. A table in a multi-file batch cannot be selected to read as a table

**Failure:** the tray has no table selection action, so with multiple items the table detail is never opened.
`BatchPage` defaults `current` only when exactly one item exists; only `NextStep` calls `choose`, and it has no
CSV/XLSX branch. `BatchTableSection` therefore cannot expose **Read as a table** for these rows. An unread XLSX
also has no headers and is absent from **Link a register by a key**; CSV can use that separate evidence path.
This is a deterministic source-level UI inference, not a reproduced browser observation. [^select] [^tableui]

**Smallest fix:** in `IntakeTray.tsx`, offer a table action using shared `itemTableSource`; call `choose(item)`.
Add one regression in `batch-page.test.tsx` for map+XLSX → select → read. Do not auto-approve mappings.
Then in a separate small change, optionally queue a uniquely determined table read on enrollment; ambiguous
workbooks must still ask sheet/header questions.
**Runtime:** browser/unit check without Docker for wiring; yes for read-to-cited-card qualification.
**Estimate:** 2–4 hours for the selection fix, not automatic workbook interpretation.

### 2. Successful large upload is easily mistaken for a readable large file

**Failure:** a 2–7 GiB file can consume the presentation uploading and then be retained but unread by its reader.
Semantic ceilings are GeoJSON 1 GiB; native conversion 128 MiB; IFC 32 MiB; PDF native 10 MiB;
raster/point 16 MiB, with only 32 raster windows. Surface jobs repeatedly copy the full source. [^bounds] [^surfpy]

**Smallest fix:** expose per-reader eligibility/ceiling beside upload progress before the full upload, without
blocking retention. Use the existing limit constants in `upload-model.ts`, `IntakeDropDialog.tsx`,
`intake-surface.ts` and the contracts; state **will be kept, not read** rather than implying a card.
For actual 2 GiB rasters, extend `raster_window.py` to reserve/hash/cache scratch once and range/window reads,
then adjust `raster-window.ts`, its contract and surface planning together; do not only raise a constant.
**Runtime:** no for disclosure logic; yes for capacity, full-source memory/disk and large-reader qualification.
**Estimate:** 3–5 hours disclosure; 16–24 more for one qualified large-raster path, not every family.

### 3. The probe's CSV delimiter/encoding promise is not the actual reader's behavior

**Failure:** semicolon/pipe data can become a misleading single column, TSV has no table entry, and UTF-16
works small but is refused large while Windows-1252 fails when it contains non-UTF-8 bytes. [^csv] [^streamcsv]

**Smallest fix:** carry an explicit encoding/delimiter choice from `intake-text.ts` into the tabular selection
contract; use it in `column-profile.ts` and `tabular-stream.ts`, and expose it in `TableImportFields.tsx`.
Admit TSV through `file-route.ts` / `BatchTableSection.tsx`. Fail to **Needs an answer** on ambiguity; do not
silently transcode/replace invalid bytes. Keep original byte-range citations valid across incremental decoding.
**Runtime:** no Docker for parser regressions; yes for upload → stored rows → exact citation qualification.
**Estimate:** 8–12 hours for these delimited-text cases with bounded readers.

### 4. Filename routing can refuse genuine content before the “keep every original” door

**Failure:** a normal small CityJSON `.json`, wrong-suffix PDF, or dense small GeoJSON fails on B before storage.
`service.ts` runs `geojsonInventory`/inspection before `putOriginal`; changing the name or crossing 16 MiB
changes the outcome for the same kind of bytes. [^retain] [^inventory] [^tableapi]

**Smallest fix:** use U for every original in `retain-batch.ts`, then let enrollment select the reader by bytes;
reuse the existing small G adapter behind the durable receipt instead of maintaining a second classifier in
the browser. Update `intake-draft.ts` so small retained Point/Line/Polygon collections use the correct bounded
adapter and >2,000-feature collections take large G rather than being refused for their small byte size.
Keep table-dialog choices advisory until the byte kind agrees.
**Runtime:** unit checks can prove route choice; yes for durable-before-parse and card regression.
**Estimate:** 8–12 hours for unifying these existing formats, not a new format reader.

### 5. “Mixed ZIP” is not heterogeneous recursive intake

**Failure:** PDF/CSV/images/GPKG/nested archives stay inside the ZIP without their readers, and a shapefile member
switches off generic GeoJSON extraction for that archive. [^zip] [^zipwords]

**Smallest fix:** extend `intake-zip-layers.ts` / `intake-zip-layers-worker.ts` to approved member-original
extraction and re-enrollment, retaining parent/member/hash lineage and existing path/ratio/expanded-byte guards.
Group shapefile sidecars first, but also enroll unrelated members; do not let the shapefile branch own the pack.
Add explicit bounded nesting continuation rather than only child cards. Reuse each family's existing queue.
**Runtime:** parser/fan-out unit checks without Docker; yes for object-store copies, job fencing and mixed pack.
**Estimate:** 10–16 hours for bounded ZIP member fan-out; not arbitrary archive sizes/compression formats.

### 6. Dropping a plan does not start the plan-reading pipeline

**Failure:** scanned PDFs explicitly run no OCR, vector PDFs only yield text passages, and JPEG/PNG stop at
metadata/preview plus a candidate label rather than rooms, scale, levels or a card. [^pdf] [^image]

**Smallest fix:** add a bounded page-classification/continuation step beside `queueBatchPdfTx` in
`intake-draft.ts` / `document-worker.ts`; reuse `document-ocr.ts`, `services/geo/geo/raster_plan.py` and the
offline `services/geo/geo/vector_plan.py` reader through candidate contracts. Connect an image-plan label
in `intake-page-image.ts` to that queue. Missing scale, placement or parent building remains a question;
never fabricate a room/unit from the label. Surface the bounded page coverage on the tray.
**Runtime:** yes, including local OCR/model dependencies; a mocked job does not qualify a scanned plan.
**Estimate:** 12–20 hours for one bounded scanned/vector-plan-to-candidate bridge, not reliable automatic cards.

### 7. Existing native readers are not automatically available through the batch door

**Failure:** DXF/CityGML/CityJSON/ODS are kept-only (or CityJSON is refused as GeoJSON), IFC stops at structure,
and N sends Point/Line layers to a polygon-only reader. DWG has recognition but no batch reader. [^kept] [^raw]

**Smallest fix:** reuse source-pin admission and queue adapters beside `intake-ifc.ts` for the already existing
`dxf.ts`, `citygml.ts`, `cityjson.ts` and native ODS reader; publish their accepted candidate summaries in
`intake-ledger.ts`. Extend `streaming-vector-reader.ts` validation to the geometry kinds the canonical area
normalizer actually supports, with kind compatibility kept at mapping. If an IFC/native result is to become
a card target, add an explicit cited package/candidate bridge before `intake-targets.ts`; merely enqueueing
its reader is insufficient. Leave DWG honestly unsupported pending a qualified converter/licence decision.
**Runtime:** yes for each activated native dependency and one real card/citation path.
**Estimate:** 12–20 hours for bounded existing-reader admission and geometry parity; IFC-to-card is additional
8–16 hours. DWG and arbitrary BIM/city conversion are not estimated as a small fix.

### 8. The current interaction and closure barriers are not a single continuously streaming drop-to-card

**Failure:** the uploader holds the dialog until every file is retained, large G waits for full read/profile and
mapping closure before drafting, and new layouts/evidence use separate approvals before card confirmation.
The map is not the first-read consumer promised by architecture §6.2. This is code-backed ordering; actual
freeze or smoothness is unmeasured. [^upload] [^retain] [^large] [^select] [^confirm]

**Smallest fix:** open the batch immediately after case creation and keep bounded upload progress in that page
(`useRetainBatch.ts`, `BatchPage.tsx`, `upload-command.ts`). Show source-backed preview parts in a separate
candidate display layer while the reader runs; retain EOF/hash/duplicate closure before registry/card readiness
(`intake-large.ts`, `intake-large-worker.ts`, `apps/studio/src/features/map/WindowedArea.tsx` and its scene).
Consolidate layout/key answers on the readiness screen without removing approvals or trusting unseen mappings.
**Runtime:** yes, browser frame-time measurement plus a good and difficult multi-file rehearsal is essential.
**Estimate:** 6–10 hours for visible batch/upload progress; 16–24 more for provisional-part display and measured
back-pressure. One-press evidence/card orchestration beyond these changes needs its own bounded scope.

## Evidence index (repository file:line)

[^api]: `apps/api/src/modules/ingestion/ingestion.controller.ts:41-76,196-213` — enroll, archive and table routes.
[^enrol]: `packages/server/src/modules/usp/ingestion/intake-service.ts:109-206` — probe, dispatch and budget states.
[^retain]: `apps/studio/src/features/intake/retain-batch.ts:29-101` — filename routes, sequential retain/enroll.
[^route]: `apps/studio/src/features/intake/file-route.ts:9-57` — table-only CSV/XLSX and batch routing words.
[^upload]: `apps/studio/src/features/intake/upload-command.ts:61-108` — prehash, sequential parts, finalization.
[^upapi]: `apps/studio/src/features/intake/upload-api.ts:16-40` — exact upload transport routes.
[^upserver]: `packages/server/src/modules/usp/ingestion/large-original.ts:191-208,448-536` — capacity and v2 jobs.
[^uplimits]: `packages/contracts/src/usp/ingestion.ts:224-265` and
  `apps/studio/src/features/intake/upload-model.ts:18-45` — 128 MiB/v1, 7 GiB/v2 and browser refusal/progress.
[^draft]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:162-200` and
  `packages/server/src/modules/usp/ingestion/intake-draft-worker.ts:194-233` — family dispatch/layout/package.
[^large]: `packages/server/src/modules/usp/ingestion/intake-large.ts:70-80,125-139` and
  `packages/server/src/modules/usp/ingestion/intake-large-worker.ts:78-100,147-160` — G stages and closure.
[^target]: `packages/server/src/modules/usp/ingestion/intake-targets.ts:70-95` — package buildings → card targets.
[^native]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:44-49` and
  `packages/server/src/modules/usp/ingestion/intake-native-derivative.ts:218-255,299-338,363-414,429-450`
  — native dispatch, layer words, derivative retention/re-enrollment.
[^nativeworker]: `packages/server/src/modules/usp/ingestion/intake-native-derivative-worker.ts:24-31,42-49,77-106`
  — internal conversion route, failure words and fenced job.
[^pyconvert]: `services/geo/geo/native_gis.py:354-360,1131-1155,1178-1214` — bounds and hashed conversion.
[^set]: `packages/server/src/modules/usp/ingestion/intake-native-derivative.ts:94-134,180-208` and
  `apps/studio/src/features/intake/upload-command.ts:128-136` — loose names, required parts, missing/duplicate words.
[^gpkgpy]: `services/geo/geo/native_gis.py:495-573` — feature layers, CRS and keyset windows.
[^shppy]: `services/geo/geo/native_gis.py:600-604,635-694` — companions, encoding and Z/M refusal.
[^kmlpy]: `services/geo/geo/native_gis.py:699-724,935-982,1040-1096` and
  `packages/server/src/modules/usp/ingestion/intake-native-derivative.ts:331-338` — KML layers/basis/exclusions.
[^zip]: `packages/server/src/modules/usp/ingestion/intake-zip-layers.ts:46-56,111-116,151-164`
  — archive format check, GeoJSON-only extraction and shapefile branch exclusion.
[^zipprobe]: `packages/server/src/modules/usp/ingestion/intake-zip.ts:13-50,187-216,219-255` and
  `packages/contracts/src/usp/intake.ts:7-11` — office/KMZ detection and bounded directory/member probe.
[^zipwords]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:71-87` — parent taken/not-taken sentences.
[^tableui]: `apps/studio/src/features/intake/BatchTableSection.tsx:21-27,50-66,92-112`
  — only CSV/XLSX, chosen item, manual read and draft-only help text.
[^tableapi]: `apps/studio/src/features/intake/table/retain.ts:5-23,45-67` and
  `packages/server/src/modules/usp/ingestion/service.ts:394-457,476-505` — table selection and retain/read ordering.
[^tabsource]: `packages/server/src/modules/usp/ingestion/tabular-source.ts:78-90,118-130,180-210` and
  `packages/server/src/modules/usp/ingestion/tabular-stream.ts:210-238,249-268`
  — unknown originals admitted; bounded parser/native workbook and scratch refusals.
[^csv]: `packages/server/src/modules/usp/ingestion/intake-text.ts:20-38` and
  `packages/server/src/modules/usp/ingestion/column-profile.ts:357-390` — guessed probe vs fixed-comma parser.
[^streamcsv]: `packages/server/src/modules/usp/ingestion/tabular-stream.ts:35-36,64-105,145-157`
  — UTF-8-only cells, fixed separator and explicit UTF-16 refusal.
[^sniff]: `packages/server/src/modules/usp/ingestion/intake-signatures.ts:6-51,59-134,148-151` and
  `packages/server/src/modules/usp/ingestion/intake-probe.ts:83-111` — byte detection, name mismatch, head boundary.
[^kept]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:100-113,162-168,216-223`
  — unsupported-family settlement and exact kept-only screen templates.
[^inventory]: `packages/server/src/modules/usp/ingestion/registry.ts:27-45` and
  `packages/server/src/modules/usp/ingestion/service.ts:394-457` — bounded GeoJSON refusal before retention.
[^raw]: `packages/server/src/modules/usp/ingestion/streaming-vector-reader.ts:145-170,225-257`
  — FeatureCollection order and polygon-only feature validation.
[^zheight]: `services/geo/geo/area.py:130-159,310-316,435-455` — source Z, XY derivation, mixed/M refusal.
[^pdfqueue]: `packages/server/src/modules/usp/ingestion/documents.ts:58-77` — batch native-only job.
[^pdfnative]: `packages/server/src/modules/usp/ingestion/document-native.ts:63-70,96-98` and
  `services/geo/geo/native_pdf.py:34-44,149-180` — bounded native text extraction; no plan-room executor here.
[^pdf]: `packages/server/src/modules/usp/ingestion/intake-draft.ts:249-266,291-319` and
  `packages/contracts/src/usp/document-ingestion.ts:5-10` — PDF limits, encrypted/scanned/text page wording.
[^image]: `packages/server/src/modules/usp/ingestion/intake-page-image.ts:68-87`,
  `packages/server/src/modules/usp/ingestion/intake-page-image-worker.ts:91-123`,
  `packages/server/src/modules/usp/ingestion/page-image-read.ts:204-214` and
  `packages/contracts/src/usp/intake.ts:97-106` — preview, limits, location presence and label-only settlement.
[^ifc]: `packages/server/src/modules/usp/ingestion/intake-ifc.ts:25-56,67-76` and
  `services/geo/geo/native_ifc.py:36-41,382-429,611-618` — IFC bounds, scan and no geometry.
[^surface]: `packages/server/src/modules/usp/ingestion/intake-surface.ts:32-58,91-109,276-295,349-356,501-524`
  — admission, parts/caps and settlement.
[^surfwhere]: `packages/server/src/modules/usp/ingestion/intake-surface.ts:413-435,568-587`
  — placement reasons and accepted display read.
[^surfpy]: `services/geo/geo/raster_window.py:21-25,54-94,121-144` and
  `services/geo/geo/point_batch.py:16-19,35-85` — repeated whole fetch, native limits and CRS metadata.
[^bounds]: `packages/contracts/src/usp/streaming-vector.ts:5-11`,
  `packages/contracts/src/usp/raster-window.ts:4-7`, `packages/contracts/src/usp/point-batch.ts:5-7`,
  `packages/contracts/src/usp/ifc-ingestion.ts:4-7`, `packages/contracts/src/usp/ingestion.ts:126-133` and
  `services/geo/geo/native_gis.py:354-360` — reader ceilings, not upload ceilings.
[^words]: `apps/studio/src/features/intake/batch-model.ts:7-18` and
  `apps/studio/src/features/intake/IntakeTray.tsx:31-40` — state/placement labels and visible server reason.
[^separate]: `apps/api/src/modules/ingestion/dxf.controller.ts:26-50`,
  `apps/api/src/modules/ingestion/citygml.controller.ts:26-50`,
  `apps/api/src/modules/ingestion/cityjson.controller.ts:18-42` and
  `services/geo/geo/native_dxf.py:23-30`, `services/geo/geo/native_cityjson.py:14-21`
  — separate bounded APIs/processors; not selected by batch kept-only branch.
[^select]: `apps/studio/src/features/intake/BatchPage.tsx:63-85,94-103`,
  `apps/studio/src/features/intake/IntakeTray.tsx:45-66`,
  `apps/studio/src/features/intake/evidence/model.ts:74-88` and
  `apps/studio/src/features/intake/useRetainBatch.ts:34-40` — selection, evidence fallback, delayed navigation.
[^confirm]: `apps/studio/src/features/intake/run/Confirm.tsx:32-63,69-83`,
  `apps/studio/src/features/intake/run/IntakeRunPanel.tsx:61-84` and
  `apps/studio/src/features/intake/evidence/EvidenceByKey.tsx:22-40,64-85`
  — card selection/acknowledgement, package pages and separate evidence declaration/confirmation.

## Verification and next action

Verification is source tracing and report integrity only: no golden journey, real good/difficult input,
contract execution, UI screenshot or runtime gate is claimed. Source commands were `read`, `rg`, file listing,
and Git inspection; exploratory searches naming nonexistent files returned exit 2 and were corrected by listing
actual paths. They are not failed application checks.

Before integration: inspect this report's diff, ensure only this path changed, check Markdown line lengths and
that every evidence path/range exists. The final handoff records those check commands and exit codes.
Recommended first delivery is gap 1 plus honest pre-upload limits, then one authorized empty-runtime rehearsal
with the presenter's NYC pack and an independently supplied difficult workbook/encoded table. No evaluation or
restricted input needs to be opened for this audit. Do not market retained bytes as a completed property card.
