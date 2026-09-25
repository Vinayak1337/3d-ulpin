# 30 — Real reference scene, incomplete data and every input family

**Current scope:** [25 September delivery policy](current-delivery-policy.md) overrides older instructions here: official-source data only; desktop-first and light-only. Do not generate synthetic fixtures or invent scene data. Unavailable source coverage stays unqualified.

**Added 25 September 2026. Release: `finale_v1` for requirements R-SCENE and R-SUFFICIENCY (GF2); the parts marked full_product stay in FP-ENRICH and FP-FORMATS. Owners: DATA for the reference area, INGEST for intake and sufficiency decisions, UI for the scene, DOMAIN for reconstruction routes, FND for shared fields.** Everything here is planned; nothing in it has passed a runtime gate.

The finale map must look good and stay honest. It looks good because it is built from a real Indian area: its photoreal drone mesh where a permitted capture exists, and real open layers dressed by deterministic rules everywhere else. It stays honest because every generated visual is a labelled display derivative of the formal records, never a record. Incomplete input is handled one way everywhere: fill for display, ask one bounded question, park the object, or reject it for 3D. The ingestion agent accepts every data family (GIS, tables, plans, CAD/BIM, 3D models, LiDAR, elevation, imagery, survey, services) and mixes of them.

## A. What already exists, and what this file adds

Keep using these; this file does not restate them.

| Topic | Already in the plan |
| --- | --- |
| Evidence-linked, estimated and illustrative layers; poor-data behaviour; `DataSufficiencyPolicy` | [H22](22-rendering-and-sparse-data.md) C, D and Z1 |
| `representation`, `geometryClass`, `analyticEligible`, display-derivative store, `levelKind` | H22 Z1–Z3 |
| Partition rules per source family; hostile-input rules; model proposes mappings; `manual_mapping` | [H14](14-adaptive-ingestion-and-progressive-review.md) C, Z1–Z3 |
| All-format ambition; generative enrichment ("Route 2") | [H25](25-all-format-agent-and-ux4g.md) A–B (full_product) |
| Drone, extraction, plan, storey and delineation routes; the site pipeline, including the photogrammetry context mesh (Helsinki's two models from one capture) | [H27](27-domain-ai-and-cadastral-checks.md) B and Z1 |
| Packs D0–D7, data.gov.in shortlist, acquisition contract, licences | [H28](28-data-acquisition-and-finale-tests.md) sections 2–5 and Z4 |

This file adds five things the plan lacked:

1. A real reference area to replace the hard-coded demo content.
2. A finale-bounded Enhanced view.
3. Rules that keep formal records and generated visuals in sync.
4. One fill / ask / park / reject rule for incomplete data, with a question budget.
5. An intake matrix for every data family, with precedence rules for mixed inputs.

## B. Real reference area (DATA-09, then UI-08)

The Studio's area map, the 3D view and every capture use one real Indian reference area, not hard-coded arrays. DATA chooses the area by these criteria, in order:

1. Permitted open context layers of useful resolution cover it.
2. It contains or adjoins a real planned multi-unit building whose sanctioned drawings DATA already holds (D5). Use its location only when the source record states it (address, coordinates, khasra with a published map); never place a building by name or proximity.
3. It is small: roughly 0.5–2 km², so the scene streams within the H22 budgets.
4. Preferably, a permitted drone capture covers it (C, tier 1). Without one, the open layers alone carry the scene (tier 2); this is not a reason to reject an area.

Candidates from sources already acquired: the Haryana RERA project 2831 site (tower plan, basement plan and section acquired by DATA-05), if the RERA record gives its location, or another area covered by official D4 context; the old Uttam Nagar community-source pack is historical only. Any permitted Indian geography qualifies; none is a prerequisite.

| Layer | First choice, then alternatives | Role in the scene | `geometryClass` |
| --- | --- | --- | --- |
| Administrative codes and boundaries | LGD (data.gov.in, acquired); municipal or PMRDA-style boundary GIS where published on data.gov.in; pincode boundary GeoJSON (data.gov.in) | Area context, labels, scope strip | `evidence_linked` context, never parcels |
| Terrain | Copernicus DEM GLO-30 or SRTM (open, attribution as downloaded); CartoDEM from Bhuvan where the download terms allow | Ground surface and hillshade | Context only; never floor, basement or height measurement |
| Roads, water, land use, parks, trees | Official road/water/land-use/tree releases; NWIC rivers via data.gov.in where permitted | Road ribbons, water, green areas, tree points | Sourced lines/polygons only; do not invent widths or tree shapes |
| Context building footprints | Official municipal/survey building footprints with issuer and licence verified | Surrounding massing | Footprint `evidence_linked` only with source provenance; missing heights remain unknown |
| Imagery | Officially issued permitted orthophotos or drone capture (DATA-06) | Optional ground texture, extraction input | Context; Bhuvan or other WMS is view-only and never baked into assets |
| Hero building | D5 sanctioned plans and section → level register → unit prisms (H27) | The building officers inspect | `evidence_linked` planned geometry, labelled *Planned*; not as-built |
| Point cloud | A permitted LiDAR or drone point cloud of the same area, if one exists; otherwise IIT Hyderabad LiDAR as a separate `test_only` scene | Heights, roofs, terrain | Per H27 qualification |
| Underground | Only real depth or profile data; usually none is open | Underground mode | Without data the column shows *No survey*; missing official corridor/depth coverage stays unqualified |

Rules:

- Every layer is a pack asset under H28 section 5: source, release, hash, licence, attribution, CRS, vertical reference and the stage reached (`discovered → acquired → inspected → qualified → tested`).
- The map carries the official issuer and required attribution for every layer shown. Source-specific redistribution limits remain attached to each derivative; context layers are not silently included in property-record exports.
- The scope strip shows the area's geography and each dataset's recorded classification. Nothing is labelled "fictional", "demo" or "demonstration data" (AGENTS.md).
- Hard-coded generators (the Lake View district and document generators) are not reachable from finale routes. D0 authored cases remain protected historical material; create no new synthetic fixtures. Protected datasets are kept, not deleted or re-seeded.

## C. Evidence view and Enhanced view

H22's two views stay. The **Evidence view** is the default for recording, checks and measurement. The **Enhanced view** is a toggle, remembered per viewer. The finale Enhanced view uses only real capture and deterministic rules over real layers and records. Generative enrichment remains a future design option requiring a new explicit user scope decision; it is not authorized source data.

**Two tiers of context, following the hardened plan review's Helsinki lesson (two models from one capture):**

**Tier 1: a permitted drone capture exists.** Its OpenDroneMap textured mesh (H27 Z1 step 2) is the Enhanced view's context layer. The semantic models from the same capture (LoD1.2 prisms, LoD2.2 roofs, reviewed interiors) carry the records.
- The mesh stays `representation: context_mesh`: display-only, never measured, never a property.
- A pick passes through the mesh to the semantic model's `recordId` (3D Tiles feature metadata). Floor isolation, sections and underground mode clip or hide the mesh so it never hides evidence.
- The mesh shows its capture date. A newer capture is a new revision; a record change does not regenerate the mesh.
- Where the mesh and a record disagree, the record and its evidence win. The mesh is never evidence for a deviation; H15 uses the semantic model and nDSM.
- Outside the mesh's coverage, tier 2 continues seamlessly, with no gap and no stretched texture.

**Tier 2: no capture of the area.** The deterministic dressing in the table below, from open layers.

The [design mockup](../../design-mockup/README.md) draws only the Evidence view. Keep its frame, chrome and selection behaviour in the Enhanced view; the Enhanced scene itself follows this section and the map rules until a mockup of it exists.

If DATA-06 acquires a foreign official capture, it is `test_only`. It qualifies tier 1 as a separate labelled scene; it is never moved onto an Indian area.

| Element | Rule (finale) |
| --- | --- |
| Terrain | Mesh from the DEM with soft hillshade; context layers draped. No DEM: a flat ground at the site's stated level, labelled "terrain unknown" |
| Roads | Render official centrelines; use ribbon widths or lane markings only when supplied by the source |
| Water, parks, land use | Fills from official polygons; tree locations only from official tree records, no seeded placement |
| Context buildings | Use only source-supplied building geometry/heights and levels under section G. Missing roofs/storeys/heights remain unavailable; no default parapet or massing |
| Façades | Source-supplied façade geometry only; no invented windows or balconies |
| Hero building | Evidence-linked levels and unit prisms; Colour by applies only here; context around it at context opacity |
| Light | Sun from date, time and latitude; soft shadows and ambient occlusion within the H22 frame budget; atmosphere and fog; reduced-motion safe |

Visual encoding in the Enhanced view:

- Generated objects are fully shaded and look finished, but they carry a fine texture pattern visible on hover and focus.
- The legend reads "Enhanced view: generated context". Screenshots and exports keep the legend and generation metadata (H22 C).
- A context building is never a property. Selecting one shows "Context building · no record" with its source layer and the rule that shaped it, and offers **Add files**. It never opens a property inspector.
- The same inputs, generator version and seed always produce byte-identical derivatives.

## D. Formal records and generated visuals stay in sync

1. **One direction only.** A derivative is a function of pinned record revisions, context-layer revisions, generator version and seed. It is stored in H22's display-derivative store keyed by `recordId` and revision, and it never writes back.
2. **Invalidate on change.** A new record revision, source or layer marks dependent derivatives stale and regenerates them in the background.
   - Until regeneration finishes, the last valid derivative shows with an "Updating" marker.
   - A removed or retired record removes its derivative at once.
3. **Evidence always wins.** When an evidence-linked height, footprint or level arrives, the next build replaces the illustrative or estimated one. The illustrative flag clears only through recorded evidence, never by editing the derivative.
4. **No leakage.** Measurement, readiness, findings, rights, the Property Card, exports and training read canonical tables only. GF-SCENE proves that switching the view changes no hash, quantity, readiness value, finding or export (the SQL-level check planned for FP-ENRICH-TEST, brought forward).
5. **Stable identity.** Selection always maps to the canonical record ID. Derivative objects have display IDs only.

## E. Incomplete data: fill, ask, park or reject

Each object gets a `SufficiencyDecision` per task. This extends H22's `DataSufficiencyPolicy`; FND adds the shared type.

`SufficiencyDecision {object, task, outcome, missing[], unlocks[], question?, reason, policyVersion}`

The outcome is one of `complete`, `fill_display`, `ask`, `park` or `reject_for_3d`.

| Outcome | When | What the user sees |
| --- | --- | --- |
| `complete` | Everything the task needs is present | Normal |
| `fill_display` | Only presentation styling is missing; official geometry already exists | Apply neutral colour, lighting or material to that geometry. Do not add missing objects, dimensions or source facts; those remain *Unknown*. |
| `ask` | One fact the files cannot supply would unlock a whole class of objects or a critical task | One bounded question, with the evidence and choices |
| `park` | A needed fact is missing and asking is not allowed or over budget | The object stays unplaced or unbuilt. It is listed under "Needs input" on the batch with the exact missing item and what it would unlock; **Request evidence** |
| `reject_for_3d` | The source cannot yield placement or geometry for the task at all | Kept as evidence (documents list), not on the map, with the reason. The original is never deleted |

**Never filled, only asked or parked:**

- coordinates, CRS and vertical reference;
- level elevations used for analysis;
- unit boundaries;
- ownership, shares and rights;
- identifiers;
- utility depths;
- control points;
- anything a finding, card or export would read.

**The agent's order for any gap:**

1. Read it from the file itself: `.prj`, GeoTIFF tags, LAS header, IFC units and storeys, EXIF, title block, legend or scale bar.
2. Reuse an approved mapping recipe.
3. Propose a traceable association or calculation from other official source evidence for review, such as scale from drawn endpoints and a source dimension. Never infer a CRS solely from bounds or fill a source fact from a visual default.
4. Ask.
5. Park.

**Question budget:**

- At most five open questions per batch, grouped by file.
- Each question must resolve a whole class of objects, never one object: never "What is the height of building 1 to 500?"
- It shows the evidence (sample values, bounds, the page crop) with bounded choices, plus "Not sure", which parks the object.
- Questions beyond the budget go to the "Needs input" checklist.
- The batch always continues with what it has.

**When 3D is impossible or near it.** These rules are per task, not per file. A file that fails one task can still serve another.

| Task | Minimum evidence | Otherwise |
| --- | --- | --- |
| Place on the map | Declared or verified CRS; or at least 3 control correspondences with a georeferenced layer, as a reviewed proposal | Local-frame preview only (named); `park` for global placement |
| Building massing (evidence) | Footprint plus height from section G's evidence tiers | Footprint only: retain 2D in both views; height remains unavailable |
| Floors | Level register or a section with scale and a named vertical reference | Storey count only: retain the literal count; no invented slab positions or level analysis |
| Units | Plan with scale (or one confirmed dimension to calibrate) plus level association | `ask` for one known dimension, then `park` |
| Underground | Depth or profile plus quality level | *No survey* band, never shown as clear |
| Anything | Aggregate statistics only; text with no location; photos without overlap, position or scale; a DEM alone for buildings | `reject_for_3d` for that task; kept as evidence |

## F. Every input family

The agent accepts every family, and mixed bundles of them. Finale state says what GF2 must qualify with one real sample each; everything else is registered as *Planned* and handled by H25's adapter tasks, never silently dropped.

| Family | Formats | Contributes | Minimum to place or build | If incomplete | Finale state |
| --- | --- | --- | --- | --- | --- |
| Vector GIS | Shapefile, GeoPackage, GeoJSON, KML/KMZ, GML, FileGDB, GeoParquet | Parcels, footprints, roads, water, utilities | Geometry and CRS | No CRS: infer from bounds as a proposal, then ask; unmapped attributes kept | Shapefile, GeoPackage, GeoJSON qualified; KML/KMZ one sample; others Planned |
| Tables | CSV, XLSX, ODS, JSON | Unit inventories, level schedules, shares, codes, coordinates | A join key to geometry, or coordinate columns with a CRS | No join key: kept as table evidence; ambiguous units: one question | Qualified (H14) |
| Documents and plans | Vector PDF, scanned PDF or image, DOCX | Plans, sections, deeds, declarations | Scale and level association for geometry; text for facts | No scale: ask for one known dimension; illegible: abstain | Qualified through H27 plan route; OCR assistive only |
| CAD and BIM | DXF, DWG (via a qualified converter), IFC 2x3 and 4 | Storeys, spaces, walls, elevations | Units and storey elevations; georeference optional | No georeference: local-frame preview, then placement by reviewed control correspondences | One DXF and one IFC sample qualified |
| 3D models | CityJSON, CityGML, 3D Tiles, glTF/GLB, OBJ | Buildings, roofs, LoD, context meshes | CRS or transform; semantics for anything beyond context | Mesh without semantics: `context_mesh`, never measured | CityJSON qualified (D1); one glTF context sample; others Planned |
| Point clouds | LAS, LAZ, COPC, E57, PLY, XYZ | Terrain, roof planes, heights, façades | CRS and vertical reference; density and roof coverage for roofs | No classification: ground filter first; no CRS: local frame; sparse: heights `estimated` | LAS/LAZ qualified with H27 gates |
| Elevation rasters | GeoTIFF or COG DEM/DSM/DTM, ASC, HGT | Terrain; heights from DSM minus DTM (nDSM) | Georeference, vertical datum, resolution | DEM only: terrain context; DSM without DTM: `estimated` heights; 30 m products: terrain only | Qualified as context; nDSM with control per H27 |
| Imagery | Orthophoto GeoTIFF, drone photos with EXIF, oblique | Footprint extraction, ground texture, photogrammetry | Orthophoto: georeference. Photos: overlap, position, and control for anything measured | Photos without control: context mesh only; without overlap: `reject_for_3d`, kept as photo evidence | Orthophoto qualified; drone route per H27 and DATA-06 |
| Survey and GNSS | Control-point CSV, RINEX, total-station exports | Control, heights, datum | Named horizontal and vertical reference | Missing datum: ask; never assumed mean sea level | One control-point sample qualified |
| Web services | WMS, WMTS (view), WFS or OGC API Features (download where licensed), ArcGIS REST | Context layers | A licence that permits download for anything stored | View-only services are shown live and never stored | Planned; view-only display allowed |
| Utilities and underground | Line layers with depth attributes, profiles, GPR exports | Depth bands, quality levels | Depth or profile plus quality level | No depth: "depth unknown" band | Per [H17](17-infrastructure-impact-screening.md) |
| Registry and administrative | LGD codes, pincode lists, RERA pages | Identifiers and context | Literal identifiers | Never geometry | Qualified (D4) |
| Archives | ZIP, 7z, TAR mixing the above | All | H14 Z1 hostile-input limits | Unsupported members listed with their reason | Qualified within limits |

## G. Mixed inputs: which source wins

Each field of a fused object lists every contributing source (H14 `NormalizedObservation`). Disagreements beyond tolerance keep both values as `conflicting` and open a finding; they are never averaged.

| Field | Precedence, highest first |
| --- | --- |
| Building height | Official control-checked point cloud or DSM-minus-DTM → official supplied model → official sanctioned section/level schedule, labelled *Planned*. Keep provenance and conflicts; if none qualifies, height is unknown. No class defaults or multiplied storey guesses. |
| Footprint | Official survey/cadastral polygon → officially sourced georeferenced plan → reviewed extraction from official imagery as a candidate. No community/vendor substitute. A roofprint is not a footprint. |
| Levels | Official section/schedule or IFC storeys with elevations/reference → qualified source slab evidence. Count alone does not establish elevations or equal spacing. |
| Terrain | Local survey or LiDAR ground model → drone ground model → official DEM → otherwise terrain unavailable (a neutral display plane is not terrain data) |
| Placement of a local-frame plan | At least three reviewed, source-supplied control correspondences with a georeferenced footprint; never name or proximity |
| Planned against observed | Never fused: kept as separate revisions and compared by the deviation check ([H15](15-property-history-and-comparison.md)) |

## H. Proposed shared fields

FND owns the contracts and decides the final names:

- `SufficiencyDecision`, as in section E;
- a `sceneDerivative` record (derivative ID, input pins, generator version, seed, hash, stale flag);
- `layerAttribution` per context layer.

UI adds proposed Enhanced-view tokens (terrain, vegetation, façade and window tones) to UI-01. They are synced back to the team design system before use, so the repository and team copies stay identical.

## I. Tests

**GF-SCENE (UI, GF2).** On the DATA-09 reference area:

- the scene is built only from manifests: no hard-coded arrays and no "fictional" strings;
- every layer's attribution is shown;
- switching the Enhanced view changes no hash, quantity, readiness value, finding, card or export;
- the same inputs give byte-identical derivatives;
- a new record revision marks the derivative stale and regenerates it;
- a context building never opens a property inspector;
- where a tier 1 mesh is loaded (DATA-06 scene at least), picks pass through it to `recordId`, floor isolation and underground mode clip it, and no measurement reads it;
- screenshots keep the legend;
- the H22 G frame and first-scene targets are met on declared hardware.

**GF-SUFFICIENCY (INGEST, GF2).** One mixed batch of unchanged official-source inputs acquired by DATA-02, with independent source-derived expectations. Seek the cases below as naturally occurring source conditions; do not remove metadata or manufacture samples. Each unavailable case stays a named coverage gap:

- a vector layer without `.prj` whose bounds are inside India;
- a table with an ambiguous area unit;
- a plan with no scale but one dimension string;
- drone photos without overlap;
- a DEM alone;
- a DSM without a DTM;
- a point cloud with no CRS;
- an IFC without georeference;
- an address list;
- an aggregate statistics table;
- a ZIP with one unsupported member.

**It passes when:**

- every object gets its expected outcome;
- no more than five questions are asked, each resolving a class;
- answering them unlocks the dependent objects without re-import;
- the batch continues past every gap;
- no original is deleted;
- nothing in the "never filled" list is ever filled.

## J. Cards

In [H29](29-agent-task-cards.md):

- DATA-09 reference area;
- UI-08 (now on the real area);
- UI-09 Enhanced view and scene sync;
- INGEST-04 sufficiency decisions and question budget;
- INGEST-05 one sample per finale input family.
