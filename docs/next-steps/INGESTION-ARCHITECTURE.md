# Ingestion architecture: accept the whole, stream what can be shown, hold and index the rest

**Status:** design by the lead, 11 October 2026, on the owner's direction of that night ("make the ingestion pipeline accept the whole … this is the first priority to plan and design"). It governs [P3](P3-ingestion.md) and section 1 of [the sprint plan](SPRINT-SELECTION.md). Nothing here is built yet unless a row says "exists". Sizes and the exact state of each reader are confirmed by task LV0 (parts B and C) before tasks are cut.

## 1. The idea in six sentences

1. **One front door.** Any file, any size, any mix, is dropped in one place. The browser never interprets a file; it only uploads bytes in parts.
2. **Every file is kept first.** The original is stored unchanged with its hash before anything tries to understand it. A file the product does not understand is still kept, and says so.
3. **Each file is looked at once, cheaply,** to learn what it is and what it holds. That look writes a **holdings card**: its kind, its extent on the ground if it has one, and the keys it carries (parcel numbers, survey numbers, project numbers, building and tower names, floor and unit labels, addresses).
4. **What can be placed on the map streams onto it at once,** part by part, as candidates. What cannot be placed is **held**, with its card.
5. **All cards together are the holdings index.** Each time a file arrives, the linker asks the index what the new file connects to, and what earlier held files now connect to it. A register that arrived before its map is linked the moment the map arrives.
6. **Nothing becomes a record without an officer.** Streams, links and model outputs are candidates. Review can be done in bulk, but it is done.

## 2. Two kinds of chunking (they are different, and both are needed)

| | Transport parts | Meaning parts |
|---|---|---|
| What is cut | bytes | features, rows, pages, image windows, point batches |
| Who cuts | the browser, without understanding the file | the server's reader for that kind of file |
| Why | a large file uploads reliably, can resume, never times out | work is bounded, results appear before the file is finished, one bad part does not lose the rest |
| Exists | yes: `large-original` upload, 8 MiB parts, each hashed, up to about 7 GiB | yes, per kind (section 4), but each request reads **one** part; nothing walks the whole file |

A browser cannot cut a shapefile, a LAZ cloud or a PDF into meaningful pieces: only the reader can. So the browser sends byte parts, the server assembles and verifies the original, and the reader for that kind cuts meaning parts and queues them.

**Decision:** reading starts when the upload is finalised, not while it is arriving. On a local network a 500 MB file uploads in seconds, most formats cannot be read before their last bytes are present (ZIP, GeoTIFF, LAZ, PDF), and one rule is simpler to make reliable. Reading-while-uploading for the two formats that allow it (line-delimited GeoJSON, CSV) is a later optimisation, not part of this sprint.

## 3. The path of one file

```
 drop ──► RECEIVE ──► IDENTIFY ──► PROFILE ──► PLACE? ──► READ IN PARTS ──► UNDERSTAND ──► PUBLISH ──► LINK ──► REVIEW ──► RECORD
          bytes in     by bytes,    cheap look   map /       queued jobs,      memory ►        candidates   against    officer,   registry
          parts,       not by       ► holdings   link /      one part each,    learner ►       + one event  the        in bulk    ids
          original     name; a      card         hold /      a conductor       teacher ►       per part     holdings   where
          kept         container                 ask         walks them all    officer                      index      safe
                       fans out
```

| Stage | What happens | Exists today | Missing |
|---|---|---|---|
| **Receive** | Upload in parts; original stored unchanged with SHA-256, size, time; provenance (issuer, licence, geography) asked once per batch, "unknown" allowed and recorded as unknown | chunked upload; per-kind receipt routes | one route for any file; today the Studio refuses what it does not recognise and does not store it |
| **Identify** | Kind decided from the bytes (signatures, structure), never from the name. A container (ZIP, KMZ, GeoPackage, a shapefile's sidecar files, a folder) is listed and each member becomes its own item with a link to its parent | byte sniffing in each reader; ZIP inventory (256 members) | one sniffer in front of all readers; fan-out of members into items |
| **Profile** | A bounded first look: columns and types, attribute names, CRS and extent, page count and page kinds, bands and pixel size, point count and classes. Writes the holdings card | column profiles, streamed profiles, GIS inspection, document page listing | the card itself, in one shape for every kind |
| **Place?** | Triage (section 5): on the map now, on the map through a link, held, or one question to the officer | sufficiency questions | the triage rule |
| **Read in parts** | The reader cuts meaning parts; each part is a job in the one job authority. A **conductor** queues the next part when one finishes, until the file is done or a stated limit is reached | every reader as a bounded job (section 4) | the conductor: today the caller must ask for each window, batch and chunk |
| **Understand** | Format is read by code. Meaning is decided by the ladder in section 6 | mapping memory, learner, Sarvam teacher through the gateway, verifier, document agents, roof and floor-plan models | wiring every lane to the same ladder |
| **Publish** | Each finished part becomes candidates and one event on the batch's stream. The map and the lists read what is new | case event stream; chunk reads | a read that carries a mapped part to candidates the map draws; today the map reads at most 2,000 features in one answer |
| **Link** | Section 7 | source-fusion associations between sources | the index and the re-run on every arrival |
| **Review, record** | Officer accepts or rejects; bulk actions for a streamed batch; identities are assigned after review | review, identity, card | bulk review of a streamed batch |

A batch of files is one **case**, as today. An item is one **source**, as today. No new service: the lanes are job operations in the existing job authority, each with its own bounded workers, so a slow point cloud never blocks a table.

## 4. Every kind of input, what it yields, and what exists

"Yields" is what the file can support in our model: **Parcel** (official ULPIN, issued by the authority), **Building**, **Level**, **Unit/Space** (application identities), **Evidence**, **Context** (roads, land use, imagery). Limits are today's code; "walks itself" says whether the whole file is read without a person asking for each part.

| Family | Formats | Usually holds | Yields | On the map by itself? | Reader today (limit) | Walks itself |
|---|---|---|---|---|---|---|
| **Cadastral / 2D ULPIN** | parcel layers as shapefile, GeoJSON, KML, GeoPackage; village maps as scans | parcel boundaries with ULPIN or survey number | Parcel with the official number as an *official assertion*; the anchor everything else links to | yes if it has a CRS; a scanned village map needs georeferencing first | area import (16 MiB, 2,000 features, one request); KML (16 MiB) | no |
| **Building footprints, other vector** | GeoJSON, line-delimited GeoJSON, shapefile, GeoPackage, GeoParquet, KML/KMZ, FlatGeobuf | footprints, roads, land use, boundaries, utilities | Building candidates (shape supported by the source; height only if an attribute states it); Context | yes if CRS known | streaming GeoJSON (128 MiB, 100 features a part, 4,096 parts); GeoParquet (32 MiB); FlatGeobuf: none | streaming GeoJSON yes; the rest no |
| **Tables and registers** | CSV, XLSX, ODS, DBF, JSON records | RERA projects and units, property tax rolls, record of rights, unit schedules, owner lists | Unit, Level and Building *facts* and rights *claims*, each cited to its row; never geometry | no, unless it has coordinates; otherwise through a link (section 7) | tables (16 MiB, 2,000 rows, 256 columns), chunk mapping with memory, learner and teacher | partly; the row limit is the gap |
| **Documents** | PDF born digital, scanned PDF, images of pages, DOCX | sanction and approval letters, RERA certificates, deeds, occupancy certificates, survey reports, property cards | Evidence; facts as candidates, each with the exact quote and page region | no; through a link | PDF native text and OCR (16 MiB, 100 pages), storey agent, cited proposals; DOCX: none | pages yes |
| **Plans and blueprints** | PDF sheets, DXF, DWG, scanned drawings, images | floor plans, site plans, sections, elevations | Levels and Units/Spaces as candidates: labels, room outlines **in sheet coordinates**, areas "as printed" at the sheet's stated scale; never measured | no (a sheet is not on the ground); attaches to its building by a link; a site plan with coordinates can be placed | PDF pages and regions; DXF (16 MiB, text versions only); floor-plan model for scanned rooms; DWG: none | no |
| **Imagery and rasters** | GeoTIFF, COG, JPEG/PNG with a world file, plain photos | orthophotos, satellite and drone images, DSM/DTM/DEM, scanned maps | Context picture; roofprint candidates from the roof model where no footprint exists; a height *estimate* from DSM minus DTM | yes if georeferenced; a plain photo is Evidence only | raster windows (16 MiB, 100 megapixels, 256 px windows) | no |
| **Point clouds** | LAS, LAZ, E57, PLY, XYZ | LiDAR and photogrammetry points | height and roof-form *estimates* per footprint, with their own provenance; never survey truth unless control is supplied | yes if CRS known | LAS/LAZ 1.4 format 6 (16 MiB, 5 million points, 8,192 a batch); E57, PLY, XYZ: none | no |
| **3D, BIM, city models** | IFC, CityGML, CityJSON, glTF/GLB, OBJ, 3D Tiles | buildings with storeys and spaces; LoD models | Building, Levels and Spaces directly when the model names them (IFC storeys and spaces); geometry | only if georeferenced; many IFC files are not, so they are held until placed | IFC (32 MiB, 2x3 and 4), CityGML 2.0 (32 MiB), CityJSON (8 MiB), glTF, OBJ; 3D Tiles: display only | whole file in one job |
| **Survey and control** | GNSS/total-station CSV, GPX, survey reports | control points, measured corners | Controls that qualify placement and measurement | yes (points) | survey report parser; tables | n/a |
| **Containers** | ZIP, KMZ, GeoPackage with several layers, shapefile sets, folders; 7z, RAR, File Geodatabase | any mix of the above | nothing itself; its members | n/a | ZIP inventory (256 members, 30 MiB expanded), no fan-out; 7z, RAR, GDB: none | no |
| **Sidecars** | `.prj`, `.tfw`, `.cpg`, `.xml` metadata, `.aux` | CRS, georeference, encoding, source metadata | completes another file; never an item alone | n/a | read with shapefiles; otherwise ignored | n/a |
| **Not files** | WMS/WFS/ArcGIS service URLs, database dumps, live feeds | | | | none | |
| **Unknown** | anything else | | Evidence held as "not understood" with its hash, size and first-bytes signature | no | Studio lists it as "not imported" and does not store it | n/a |

**What this table says:** almost every reader exists as a bounded piece. Three things are missing everywhere: the front door that takes any file, the conductor that reads a whole file without being asked for each part, and the path from a read part to something the map and the lists show. Limits were set for safety when each reader was qualified; they are raised lane by lane, on purpose, with a measured run each, never removed.

**Formats we will not read by 22 October** (received, kept, stated as not understood): DWG (proprietary; ask for DXF or PDF), E57, 7z/RAR, File Geodatabase, DOCX, service URLs. Each is a named gap, not a silent failure.

## 5. Can it go on the map? The triage rule

Asked once after the profile, and again whenever the index changes.

| Answer | When | What the screen does |
|---|---|---|
| **Place now** | geometry with a known CRS; a table with coordinate columns; a georeferenced raster or cloud | streams onto the map as candidates |
| **Place through a link** | no geometry, but its keys match something placed (a parcel number, a project, a tower name, an address) | appears on the record it links to: in its register, its evidence, its floor list |
| **Hold** | nothing to link to yet | listed under "Held" with its card: what it is, what keys it carries, what it is waiting for; re-tried on every arrival |
| **Ask** | CRS missing or local coordinates; two equally good links; a private document that may not go to a provider | one question to the officer, with "not sure" allowed; the file stays held until answered |

Nothing is guessed to get a file onto the map: an unknown CRS is not assumed, a missing height is not 0, an ambiguous link is not chosen.

## 6. Who understands the file: the ladder

Code reads the *format*. The ladder decides the *meaning* (which column is the unit number, which page is a floor plan, which layer is buildings). Each part climbs only as far as it must, so most parts never reach a paid model:

1. **Memory.** This layout was approved before (same fingerprint): apply the approved mapping. No model, immediate.
2. **Local learner.** Our own trained mapper is confident: apply, marked as a candidate.
3. **Teacher (Sarvam, through the gateway).** A layout nobody has seen: the teacher receives the masked profile (column names, types, a few masked samples), never the file; its answer is checked by code against the whole profile; an approved answer goes into memory and into the learner's training set, so the next part and the next similar file stop at step 1 or 2. Wide tables are asked in column groups (merged 10 October).
4. **Domain models, local.** Roof model for imagery, floor-plan model for drawings, OCR for scans, the storey agent for document text.
5. **The officer.** Whatever is still unanswered, as a short question.

**PDFs:** yes, with AI, but in this order: the PDF's own text first (exact and free); OCR when it is a scan (local); then a model to turn text into fields, where **every value must be a quote found on the page** or it is dropped. Drawings go to the floor-plan model, not to a language model: a language model is not trusted for geometry. Private or restricted documents are never sent to an outside provider; they stop at local reading and the officer.

**Private data:** the ladder is the same, minus step 3.

## 7. Linking: the holdings index

Each card carries the keys found in its file, normalised the same way for every kind:

| Key | Found in | Joins to |
|---|---|---|
| ULPIN, survey/khasra number, village and district codes | cadastral layers, record of rights, deeds, tax rolls | Parcel |
| RERA project and registration numbers, sanction and approval numbers | RERA tables and certificates, plans, letters | Building or project |
| Building, tower, block and wing names | tables, plan captions, footprint attributes | Building |
| Floor labels and ordinals; unit numbers | unit schedules, plans, deeds | Level, Unit |
| Address, locality, PIN code | almost everything | Building, Parcel |
| Extent on the ground | every georeferenced file | whatever it overlaps |
| Owner and party names | registers, deeds | kept as *present / absent* in the index; values stay in their source and are never sent to a provider |

Linking order, strongest first: exact key (a parcel number equals a parcel number); spatial (a point inside a parcel, a footprint inside a project boundary); name and address similarity, scored. An exact single match is proposed as a link; anything scored or plural goes to the officer. A link is a candidate with its two citations, never a fact, and it never creates ownership, issuance or geometry.

The index answers the two questions the owner asked for: *what do we hold?* (the Held list, by kind and key) and *what does this new file connect?* (run on every arrival, in both directions).

## 8. What the person at the screen sees

- **One drop zone**, for files and folders. Each item appears at once in the tray with its size and upload progress.
- **One line per item**, moving through: received · identified as … · reading 12 of 240 parts · on the map / linked to … / held: waiting for … / needs you · not understood.
- **The map fills part by part**, candidates drawn as candidates, without frame drops (task LV1: the scene adds only what is new, inside a frame budget; the longest frame today is 1.8 s). A large area is read by the view, not as one list.
- **Held and linked items** have their own list; opening one shows its card and what it waits for.
- **Questions** are few and plain, one at a time, with "not sure".
- **A reader's limit is said in words**: "read 409,600 of an estimated 1.2 million features; the rest is kept, not read".

## 9. Build order to the 22 October freeze

Each step is shown on the empty rehearsal runtime before the next begins. Sizes come from LV0 part C.

| Step | By | What it delivers | Proof |
|---|---|---|---|
| **A. Spine** | 14 Oct (M1) | front door for any file (upload in parts, sniff, keep, item states on one event stream); container fan-out; conductor for the vector lane; streamed parts become candidates the map draws; the scene takes parts smoothly (LV1); several files in a row all read (K13) | the NYC pack through the product's routes on an empty runtime, no file-specific code, no frame over 100 ms |
| **B. Meaning and links** | 17 Oct | conductor for tables with the row limit raised by streaming, ladder on every part; holdings card and index; linker (exact and spatial first); documents and plans listed, read and linked; Held list | a footprint layer, then its register, then a plan, dropped in any order, end up linked; an unseen table layout is learned on the spot |
| **C. Remaining lanes and limits** | 19 Oct (M2) | raster and point lanes walked by the conductor (roof candidates, height estimates); 3D lanes placed or held; every limit and every unknown format said in words; bulk review | one file per family from section 4, and one unknown file, on an empty runtime |
| **D. Rehearse** | 20–21 Oct | two full rehearsals from empty with files nobody on the team chose | recorded runs, a list of what was not understood |

Already queued and still valid: LV1 (scene), K13 (stale reads), F3i (card revision), the platform task for an empty runtime (models installed by script).

## 10. What does not bend

- Originals are immutable; every candidate cites its original and a locator (feature index, row, page and region, window, batch).
- Unknown stays unknown: no assumed CRS, no height of 0, no invented unit, parcel, floor or owner.
- Official parcel ULPINs are assertions by their issuer; application identities for buildings, levels and units are ours and are assigned only after review.
- A model's or a teacher's output is a candidate; a teacher's answer is a `pseudo_label`, never evaluation truth.
- Private or restricted files never go to an outside provider; the money caps of the gateway hold across all keys.
- One job authority, one registry, one gateway, one conversion contract: lanes extend them, nothing parallel is built.

## 11. Open decisions for the owner

1. **How large is "large" for the presentation?** The design scales by parts, but each lane's ceiling is raised only as far as we have measured. A working target is needed: for example one file up to 1 GB, a vector layer up to 500,000 features, a table up to 1 million rows, one image up to 2 GB. Smaller targets mean more lanes finished.
2. **Which families matter most if time runs short?** Proposed order: vector and cadastral, tables, PDFs and plans, imagery, point clouds, 3D models.
3. **May a judge's file be sent to Sarvam?** The ladder sends only masked column profiles and public text. If their file must be treated as private, step 3 is skipped and the officer answers instead.
