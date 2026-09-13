# 3D ULPIN — consolidated strategy and implementation handoff for GPT-6 Pro

Prepared for Vinayak on 14 September 2026. Repository: `3d-ulpin`; inspected branch `main`, HEAD `b95e782`. This document consolidates the conversation, original Astra pack, later scope changes, implementation evidence and new proposals. It is a planning handoff, not a claim that the proposed next release exists.

**Instruction to GPT-6 Pro:** Think through and improve the strategy before implementation. Audit the product against the original problem and the user's requirements below, preserve useful working code, expose missing dependencies and produce a concrete staged plan with acceptance criteria. Challenge earlier recommendations where necessary. Do not merely repeat this document or redesign everything from scratch. Do not launch a new task, restore old budgets/delegation rules, or start coding just because the preserved Astra pack contains an old implementation command. The current request is a consolidated planning review.

**Evidence boundary:** This handoff was prepared by reading current code/contracts, fixture inventories, Git history and existing verification reports. No new build, service tests, browser rehearsal, government-data conversion or AI extraction was run for this handoff. Historical test results below remain historical, with their stated dates and scope. Local ignored screenshots/reports may not exist in a fresh clone. `PARCEL_TO_3D_PLAN.md` was an uncommitted proposal at inspection; this handoff is another new document. Application code was not changed in this pass.

**1. The product we are trying to deliver, and why the direction changed**

The original challenge is “3D ULPIN Generation and Vertical Property Mapping System.” Conventional surface-parcel records do not sufficiently distinguish multi-storey apartments, common spaces, basements, utilities, air rights and other vertically separated interests. The brief asks for unique spatial identities, vertical/underground mapping, integration of parcel GIS, plans, drone imagery, point clouds, GNSS/CORS and DEM/DSM, and AI-assisted extraction/segmentation/topology checks. Its intended outcomes are clearer property records, reduced ambiguity and better infrastructure decisions—not simply attractive 3D buildings.

Earlier we answered the user's concern that the app was “just generating a 3D model” by proposing a persistent registry with rights, evidence, controlled corrections and spatial queries. That foundation was implemented for a small synthetic site. The user then found the experience too disconnected, cluttered and workspace-oriented, and now explicitly prioritises **existing 2D ULPIN/parcel → supporting documents → reviewed 3D spaces on one shared village/neighbourhood map**. We have written a revised theoretical plan for that direction; the parcel-first import journey, AI preparation and larger area map remain unimplemented. This is the central gap GPT-6 Pro should organise the next release around.

**2. Reconcile the original Astra handoff with what was actually authorised and built**

The Astra master handoff originally required an authenticated preparer, an assigned evidence request, an actual Android response, a different authorised reviewer and accepted identity lookup. A later explicit 4–8-hour scope cut produced a local single-operator web processing demo. The user's subsequent five-stage registry plan added persistent records and technical review while still excluding authentication, legal acceptance, real-world basemap placement, AI extraction and new GIS/BIM/LiDAR importers. The latest requests now bring assisted document extraction and parcel-first area mapping into planning; they do not automatically reactivate Android, authentication or formal government acceptance.

Therefore the original Astra MVP is **not complete**, even though substantial geometry, evidence and registry functionality exists. Do not equate the old `HACKATHON_DEMO_VERIFIED` status with Astra's full `MVP_VERIFIED`, or treat every deliberately deferred feature as an accidental bug. Conversely, do not cite the old AI exclusion as a reason to ignore the user's new AI request. Keep the deterministic manual build path available alongside any optional cloud preparation step.

| Original module | Delivered foundation and remaining difference |
| --- | --- |
| M1 Cases, users and access | Persistent cases and sites exist. Authenticated actors, permissions and project-scoped multi-user authority were deferred. |
| M2 Field capture and synchronisation | Native Android request/response, assignments and offline synchronisation remain absent. |
| M3 Import, provenance and normalisation | Original files/revisions, inspection, hashes, bindings, narrow JSON/CSV/PNG/PDF profiles and a specific NYC conversion exist. General cadastral GIS normalisation and multi-document packages remain. |
| M4 Assisted extraction | Manual calibration/tracing exists. AI extraction, structured fact candidates, source disagreements and adaptive questions are proposed only. |
| M5 Spatial construction/editing | Actual persisted prism construction, linked plan/3D selection and boundary/elevation editing exist. Registry correction still needs a better graphical editor and richer floor semantics. |
| M6 Validation and evidence requests | Deterministic geometry/evidence/relationship checks exist. Formal assigned field requests, source-discrepancy review and area-wide road/public-space rules remain. |
| M7 Change impact/dependencies | Combined candidate/neighbour checks and stale-review protection exist. A general source-to-fact dependency system and Observed/Recorded/Compare workflow do not. |
| M8 Review, identity/history | Persistent prototype IDs, immutable application revision snapshots, idempotent technical recording and history exist. Separate-reviewer governance, official issuance and full split/merge lineage do not. |
| M9 Search, exchange/planning | Current record search/resolution, application JSON export, point stacks and excavation intersections exist. Official-ULPIN lookup, full area audit, standard exchange and real village operations remain. |

For the original 36-row Astra matrix, existing evidence supports important portions of source receipt, processing, geometry, web editing, identity persistence and freshness. AC02/03/06's user-authorisation guarantees, AC21–24's assigned/native loop, AC27's distinct reviewer and AC32's cross-client completion cannot be called passed. Other mixed rows need re-evaluation under their exact original wording. Do not mechanically map the later demo tests to all 36 passes.

**3. Existing 2D ULPIN should anchor the workflow, but does not itself contain a building**

We replied that the official parcel identifier should be preserved and linked to the new 3D records, rather than replaced or decoded into imaginary floors. The data model already has an optional `officialUlpin` field, and review rejects an asserted official ULPIN on a synthetic site. However, current search and the resolver look at application identifiers/aliases/names/rights and do not implement official-ULPIN lookup. There is no government record-fetch integration or complete parcel-first upload UI.

The next design should let an administrator select/import a parcel, preserve its supplied official ULPIN and boundary provenance, then choose **Add 3D details**. Searching that ULPIN should resolve the parcel plus its associated buildings/spaces; searching a space ID should locate one space. Typing a ULPIN cannot promise a map download without a usable authorised source. Plan manual parcel-data upload first, with a separate adapter boundary for any future government lookup. Official context: [DoLR's ULPIN description](https://dolr.gov.in/en/national-digital-policy-release/).

Synthetic fixtures must keep official identifiers empty and use explicit aliases such as `DEMO-PARCEL-001`. This rehearses the workflow but is not proof of successful conversion of an actual issued ULPIN. A real Indian demonstration requires both a genuine identifier and associated usable parcel data, not merely any Indian building image.

**4. Short persistent 3D identifiers, hierarchy and the “super identifier”**

We proposed one permanent namespace and stable child IDs so identifiers do not grow as floors/rooms are added. This is implemented in the registry as `3DU-<26-character encoded site UUID>` with `:P001`, `:B001`, `:F001` and `:S001` suffixes. Allocation is serialised within the site and retries reuse allocations. A building has its own B identifier; a site groups multiple buildings. Hierarchy is carried by relationships and readable navigation, not by concatenating every child's ID or changing an ID when its floor name changes.

One shared basement/corridor has one identity linked to multiple buildings/parcels. Older workbench identifiers remain separate legacy meanings; explicit import retains lookup aliases. The UI displays prototype identifiers in workbench/registry records and offers record links/exports. Remaining work is discoverability: an obvious official-parcel-to-prototype relationship, qualified floor names, a real hierarchical explorer and unified lookup. These IDs are a documented prototype profile, not a certified national standard, title certificate or officially issued 3D ULPIN.

**5. A usable whole-area map, not one isolated building per workspace**

We first implemented a shared Nandan site: two adjoining buildings, two parcels, four floor context records and fourteen spatial units, including one shared basement and cross-parcel utility corridor. A later redesign made the registry the default home, enlarged the map, defaulted to 3D with no preselected record, put search/details in drawers and retained linked Plan/3D views. This solves part of the original small-view problem, but the user still wants an area map containing streets, public grounds and incremental property additions.

The current `RegistryMap.tsx` is a fitted SVG based on supplied record bounds. It supports selection and query/drawing clicks, but has no independent plan pan/zoom or fixed area extent. The current schema has apartment/common/basement/utility uses, not a complete road/public-land layer model. It is not a village GIS viewer. Cesium's current site display is a local-metre scene; no real geolocation is asserted.

The proposed next map is one 250 × 250 m synthetic area with Block A/B/C groups, parcel outlines, roads, public ground and multiple selectable buildings. Keep a stable area extent while uploads accumulate. Use zoom-dependent labels, scale bar, Fit area, floor/underground filters and focus-on-building; keep surrounding context visible. Decide whether Plan should be the initial whole-area view with an immediate 3D switch, versus 3D by default. The user's need is usable spatial context in both views, not a particular renderer. Do not replace Cesium/PostGIS without a concrete reason.

For real village placement, plan explicit source CRS ingestion, metric transformations and vertical-datum alignment. Two local drawings cannot share a map merely by renaming their frame fields. The first 250 m fixture demonstrates the interaction, not production village-scale capacity: the existing limit is 100 current volumetric spaces and 2,000 total context/spatial records per check.

**6. Import files should prepare the required build inputs automatically**

We replied that users should upload source documents, inspect extracted results, fill gaps and build without authoring JSON/CSV. Currently structured JSON/CSV preparation works, and PNG/PDF images can be inspected, calibrated and manually traced. Uploading a PNG does not automatically extract its building/room geometry, infer its floor schedule or create the complete build package. This distinction resolves the earlier “does it accept images?” question: it accepts supported images as sources, but automatic interpretation is still missing.

The proposed pipeline is upload a related document set → classify pages → extract candidate facts and boundaries → associate them with the selected parcel/buildings → reconcile discrepancies → ask for missing values → preview over the originals → validate confirmed data → generate the app's canonical spatial JSON/level CSV → run the existing build/review flow. Generate both files from one canonical draft so they cannot independently disagree. AI must not invent a second hidden registry or bypass the existing source/revision pipeline.

Add direct JPEG ingestion or documented conversion because the identified DDA files are JPEGs; current declared image support is PNG. Keep originals unchanged and register conversions as derivatives. Define PDF page/file/pixel budgets, supported formats, cancellation, retry and readable failure states. Existing per-file upload limit is 16 MiB; design multi-document processing limits rather than silently broadening it.

**7. Nous/free AI is a candidate for preparation, not yet a working integration**

We checked Nous Portal and identified `stepfun/step-3.7-flash:free` in its public recommended free-vision field on 14 September 2026. No model call, authentication setup, extraction benchmark or provider integration has been implemented or tested. [The recommendation endpoint](https://portal.nousresearch.com/api/nous/recommended-models) is a dated discovery source; GPT-6 Pro should recheck availability, image support, output behaviour and free-tier limits before committing to it. “Any free model” is insufficient if that model cannot read images reliably.

Propose a bounded pilot on a clean plan, a section, a missing-height document, a contradictory pair and a deliberately unreadable/misleading sample. Measure missed features, dimension errors, boundary agreement and operator correction effort against authored ground truth. Valid JSON is not evidence of accurate geometry. Use application validation for schema, units, transforms and calculations. Ask whether a dedicated OCR/line-detection stage materially improves performance before adding complexity.

Keep provider/model configurable and credentials server-side. Treat document text/model output as untrusted data. Preserve extraction run metadata and source page/region references; cache completed results without overwriting later manual edits. No automatic paid fallback. Live cloud extraction needs internet, whereas already prepared cases should still build and demonstrate offline. Saved results must be labelled as a previous real run, never presented as a live AI response. Local manual preparation remains the failure/offline path.

**8. Multiple documents can disagree; preserve their individual claims**

We proposed an explicit discrepancy review rather than averaging conflicting heights or trusting the newest document automatically. Existing source revisions, evidence bindings and suitability checks provide a useful base, but the application does not automatically compare a plan's measurement with a section's measurement or provide a source-fact resolution workflow.

The next design needs extracted fact candidates with value, units, meaning, affected feature, page/region, source revision and review status. Compare like with like: clear ceiling height, slab thickness, floor-to-floor height and benchmark elevation are different facts. Surface area conventions also matter. A 3.0 m versus 3.2 m discrepancy for the same fact should show both sources, accept a supported choice or revised measurement with a reason, and preserve the rejected/superseded claim.

Missing geometry-critical data keeps the affected draft incomplete; missing rights remain explicitly unrecorded rather than invented. Ask only unresolved questions and allow independent complete buildings to proceed when dependencies permit. Define which downstream checks become stale after a document, calibration, association or resolution changes. Current registry revisions must stay unchanged until fresh review. Model confidence is a triage hint, not an accuracy certificate.

**9. Conflicts across roads, homes and public areas need distinct meanings**

We proposed one **Conflicts** action for the whole area with selectable red highlights. Current draft review computes neighbour-aware prism findings, and excavation computes actual proposal/current intersections. A whole-area current/draft audit with road/public-ground semantics is not implemented.

The new audit must separate document disagreements, geometric intersections, source-backed rule findings and missing coverage. A positive intersection does not itself adjudicate encroachment or ownership. Roads/public grounds without evidenced vertical limits support horizontal intersection results in m²; do not assign arbitrary heights to manufacture m³. A documented reserved volume can support vertical conflict calculations. Parcel/building context containment and boundary-only shared-wall contact are not competing ownership overlaps. A utility beneath a road can legitimately overlap in plan without intersecting in volume.

Check current/current records, a proposed replacement against effective current neighbours, and interactions between distinct proposals separately. Exclude a replacement's old revision and do not stack alternative drafts as simultaneous buildings. Return exact intersection pieces, quantities, affected IDs, evidence and revision stamps. Mark incomplete/unsupported coverage so “no detected conflict” cannot become an all-clear. Proposed changes remain drafts; a red demo must not require bypassing the registry's blocking rules to publish a known-invalid claim.

**10. Workbench navigation, Add to map and the frame error**

We explained that the registry is the site map at `/`, while the preparation workbench remains at `/workbench` and legacy `/?case=...` URLs. The registry has **Add records → Import workspace**, and can open source preparation in the current site's frame. The user nevertheless cannot easily discover the transition. A first-class **Back to area map / Review for map** action carrying the destination parcel/site and draft status is still proposed, not delivered as a direct workbench action.

The reported “same declared frame and benchmark” failure was addressed in commit `211dc33`: the UI shows incompatible frames and offers **Import into separate site**, creating/reusing that site and draft atomically while preserving coordinates. Compatible imports remain strict. This fixes importing a legacy case safely; it does **not** align it into Nandan or solve the user's requirement for multiple buildings in one block. Prepare new shared-area submissions in one frame from the start; require explicit supported transformations for genuinely different frames.

A confirmed remaining code gap is version-aware re-import: `importRegistryCase()` selects the earliest draft for a case and returns it if present. A later build therefore does not automatically become a new correction draft. Plan a persistent source-feature-to-registry mapping, operation key/content revision and an explicit new revision path that preserves identities and current records. Also prevent independent building packages from minting duplicate parcel/building/floor context just because they repeat shared context metadata. Same-name matching alone is unsafe.

**11. Minimalist UI and source viewing**

We applied frontend-design and Taste/minimalist guidance in earlier frontend work. The registry now has a map-first shell, on-demand search/details, collapsible rights/evidence/history sections and fewer always-visible controls. Duplicate rehearsal workspaces were archived rather than deleted; archive visibility and legacy URLs remain. These changes are delivered, but they do not prove the newer area/parcel workflow is usable. Rehearse it as a user, rather than declaring success because colours and spacing changed.

The request to preview files wherever evidence/download links appear is substantially implemented through a shared `SourceFileDialog`: local PDF.js, native PNG rendering, Papa Parse CSV tables and formatted JSON. It is used by source lists, original-file sections and evidence/finding links while preserving original downloads. Remaining improvement is jumping directly to a referenced row, page, feature or image region, plus a consistent preview entry point in the new import flow. Existing preview limits are explicit; multi-page behaviour was not fully exercised in the recorded preview test.

Do not add implementation terminology, large explanatory panels or every status badge to the main map. Use a concise record panel and progressive disclosure. Show the original parcel reference and selected prototype ID where the user can find/copy them, without spraying long IDs across the whole area.

**12. What files really exist, and where the data came from**

We answered the dataset questions with an important distinction: most examples are synthetic, and only one externally sourced building example has actually been added. The current repository contains:

| Local files | Actual provenance and usable scope |
| --- | --- |
| `fixtures/c001/` | Authored synthetic JSON, initial/revised level CSV, controls and PNG/PDF. Seven spaces; 6.4 m³ overlap corrected to zero. |
| `fixtures/c002/` | Independent authored synthetic outlines, levels, controls and PNG/PDF. Five spaces; 14.4 m³ overlap corrected to zero. |
| `fixtures/registry/` | Authored synthetic Nandan spatial JSON, levels CSV, plan PNG/PDF and fictional rights PDF. The real inspection/build/review seed creates the connected registry site. |
| `fixtures/real-nyc/` | Unchanged NYC public GeoJSON plus a specific documented conversion to local spatial JSON/roof-height CSV, with provenance. Exterior envelope only; no interior floors/rooms, Indian parcel or rights evidence. |

NYC's source is [NYC Open Data BUILDING](https://data.cityofnewyork.us/City-Government/BUILDING/5zhs-2jue), selected OTI/DOITT **353927**, BIN **2019299**, retrieved 13 September 2026 using [this exact query](https://data.cityofnewyork.us/resource/5zhs-2jue.geojson?doitt_id=353927). `scripts/convert-nyc-demo.ts` preserves the original, transforms EPSG:4326 to EPSG:2263, subtracts a retained origin, converts survey feet to metres and uses the reported 33.49 ft roof height. Approximate derived envelope quantities are 123.950241 m² and 1265.253317 m³ at 10.207752 m relative height. This is a limited envelope approximation, not a ready-made 3D cadastre. [City metadata](https://github.com/CityOfNewYork/nyc-geo-metadata/blob/main/Metadata/Metadata_BuildingFootprints.md) and [terms](https://opendata.cityofnewyork.us/overview/#termsofuse) are retained research references.

Other links were suggestions, not imported assets: [Google Open Buildings](https://sites.research.google/gr/open-buildings/), its [temporal height product](https://sites.research.google/gr/open-buildings/temporal/), [Microsoft Global ML Building Footprints](https://github.com/microsoft/GlobalMLBuildingFootprints), and [buildingSMART IFC examples](https://technical.buildingsmart.org/standards/ifc/ifc-examples/). The original Astra source documents also contain older leads such as P³, Copernicus and Bhopal LiDAR; their appearance in a source register is not evidence we acquired them. Google/Microsoft India coverage is not Indian-government cadastral evidence.

**13. Small Indian government samples: researched, not yet imported**

We found the official [DDA zone-wise layout listing](https://www.dda.gov.in/zone-wise-layout-plan) and verified HTTP metadata for three Pitampura JPEGs: [MP-Block parking](https://www.dda.gov.in/sites/default/files/layoutplan/Planning%20Zone-H/9_PARKING_PITAMPURA.jpg), about 1.78 MB; [BU-Block/Outer Ring Road](https://www.dda.gov.in/sites/default/files/layoutplan/Planning%20Zone-H/64_OUTER_RING_ROAD.jpg), about 2.27 MB; and [AU-Block land](https://www.dda.gov.in/sites/default/files/layoutplan/Planning%20Zone-H/71_AU-BLOCK_PITAMPURA.jpg), about 4.30 MB. Their dimensions/scale legibility and suitability were not visually verified, and they were not downloaded into the project or converted. Do not claim they contain floor elevations or current ownership records.

The [GHTC India Gujarat drawings listing](https://ghtc-india.gov.in/content/GUJ.html) is another official lead for layout, floor-plan, elevation and section drawings, including DWG. Individual drawings were not acquired/parsed and DWG is unsupported. BMTPC demonstration-housing PDFs and PMAY-G PAHAL typology books were also research leads; large PDFs were not inspected/converted, and a house typology is not an actual cadastral record. No Indian government dataset currently has a completed upload→build demonstration in this repository.

The useful next task is to acquire and inspect one small official example, determine what it actually supports, preserve terms/provenance, then prepare a truthful demo. If it supports only footprints, show only that scope. A separate synthetic plan/section example should demonstrate interiors and controlled contradictions. Do not hold the whole synthetic demo hostage to an unavailable government endpoint, or silently combine government imagery with invented heights/rights under a single “real data” label.

**14. Actual supported formats versus the original source ambition**

We clarified that JSON is not inherently fake data: GeoJSON is a geospatial format, while our local JSON is a narrower application schema. Current supported profiles are `parcel-local-json-v1`, `levels-csv-v1`, `control-csv-v1`, `plan-png-v1` and `plan-pdf-v1`. PNG/PDF can be calibrated and traced manually. Arbitrary GeoJSON, SHP/GPKG, DWG/DXF, IFC/BIM, LAS/LAZ/LiDAR and DEM/DSM/drone processing are not general current importers; the NYC converter does not change that.

The user's earlier “BIS etc” wording was not resolved to an exact format. Do not claim BIS support or silently reinterpret it as BIM. Explain the input purposes in plain language, list concrete supported extensions, and only add adapters when a usable sample and validation contract exist. AI reading a screenshot of a GIS/CAD file is not equivalent to ingesting its original spatial metadata.

**15. The larger demo kit was planned, not delivered**

We wrote and pushed `BLOCK_DEMO_PLAN.md` in `b95e782`. The intended `demo-data/pitampura-250/` folder, independent upload packages, block map and global Conflicts feature do not exist yet. That plan describes a fictional 250 × 250 m area with eight buildings across A/B/C, including two adjoining buildings; three floors and two apartments/common strip per floor; one shared basement, one utility and one explicitly defined road reserve, totalling 75 current spatial units. Public-ground context was added in the subsequent theoretical direction and needs a concrete fixture/rule scenario.

Create a reproducible root-visible demo kit with an area manifest, multiple independently uploadable building packages in the same named frame, plans/sections, measurements, explicit external feature keys, fictional rights evidence, and correction scenarios. Provide a human-readable file index; distinguish required live-upload files from references/derived files so the UI does not reintroduce duplicate-looking choices. Preserve operator edits on repeat load and make a fresh rehearsal an intentional new area. A “load complete sample” button must use the real pipeline, not stored fake findings.

Keep the independently authored expected results distinct:

| Scenario | Expected calculation and delivery status |
| --- | --- |
| Legacy C-001 | 32 m² × 0.2 m = **6.4 m³**, then zero; implemented and historically tested. |
| Legacy C-002 | 48 m² × 0.3 m = **14.4 m³**, then zero; implemented and historically tested. |
| Nandan apartment correction | 40 m² × 0.2 m = **8 m³**, then zero; implemented and historically tested. |
| Nandan excavation | Proposal `[10,11]–[14,14]`, z −5–0: basement **12 m³**, utility **4 m³**; implemented and historically tested. |
| Proposed large-area road widening | A03 east ground apartment intersected by reserve `[105,40]–[115,50]`, z 0–3: 5 × 10 × 3 = **150 m³**. Corrected x 110–115 touches only. Planned, not implemented. |
| Proposed large-area floor correction | A01 west apartment 8 × 20 m, lower 3→2.8: 160 × 0.2 = **32 m³**. Planned, not implemented. |
| Public-ground scenario | Needs authored geometry, explicit source/rule and an independent expected horizontal area; no value or implementation exists yet. |

Nandan's small 8 m³ correction must not be confused with the planned larger 32 m³ case, or the legacy 6.4 m³ case. The road's 0–3 m reserve is a declared synthetic scenario assumption, not a general rule that roads have that height.

**16. Review, correctness and what must not regress**

The implemented local registry has explicit draft targets, combined candidate/current-neighbour checks, immutable application revision snapshots, site locking, expected draft/site revisions, fingerprints, blocking findings, written warning acknowledgement and idempotent commits. Later edits leave the current record unchanged. Rights refer to source revisions/locators; geometry does not create a party/right. Queries use PostGIS candidate selection and Python polygon/interval calculations, return the registry revision and distinguish positive-volume overlap from boundary contact.

The deep review fixed closed-ring canonicalisation, unsupported-field validation, source/frame mismatches, relationship containment/building consistency, actual source-binding preservation during import, partial CSV handling, stale query responses, repeated aliases and acknowledgement reuse. It added footprint comparison and real Locate camera movement. These are useful foundations, not work to discard in an AI/map rewrite.

Remaining correctness/design gaps include evidenced floor elevation bands (floors are currently horizontal context), a richer history/source-decision comparison, region-specific evidence navigation, explicit treatment of measurement uncertainty/tolerances, version-aware re-import, and general discrepancy dependency invalidation. Equality/contact tolerances must be defined without hiding a real 0.2 m overlap. A graphical registry boundary editor should preserve the same save/check/review isolation.

**17. Additional issues GPT-6 Pro should examine, including documentation debt**

- Official-ULPIN lookup is missing despite the stored field. Define duplicate/superseded identifier handling and parcel lineage without changing the permanent spatial ID for ordinary corrections.
- Current registry classification is site-wide, and import sets record `synthetic` from its destination site. This code observation is a potential provenance limitation when mixing real references and synthetic extensions, not a newly reproduced runtime failure. Decide per-source/per-fact provenance and explicit site policy; test that importing NYC/government evidence cannot be misleadingly relabelled as entirely synthetic or entirely surveyed.
- Current floor records cannot carry a geometry volume under the context rule. Plan separate evidenced elevation-band semantics instead of turning floor/building context into competing claims.
- The simple whole-site revision lock is conservative and adequate for a local demo but may invalidate unrelated reviews. Do not optimise it away before defining race tests and realistic larger-site needs.
- Site-wide audit needs bounded runtime, spatial candidate filtering, progress/cancellation and a useful partial/failed result. Do not turn a failed calculation into zero conflicts.
- Registration should distinguish physical observations, recorded assertions and proposals. A full Observed/Recorded/Compare product is still absent; decide the smallest useful version for the next story.
- `docs/HACKATHON_STATUS.md` predates registry delivery and still lists registry records as deferred. Read it as a dated legacy report, not current authority. `fixtures/README.md` says every file is synthetic even though the later `real-nyc/` folder exists; its blanket statement needs correction. Resolve these without rewriting historical test evidence as a new run.
- The legacy status report documents a Cesium/minifier workaround and about 17.8 MB uncompressed client output. Its current performance impact needs remeasurement before promising larger scenes. Preserve working assets/build behaviour while investigating.
- The latest theoretical plans did not re-estimate the old 4–8-hour delivery constraint. GPT-6 Pro should propose a realistic bounded release and dependencies, not pretend all government integration, AI extraction and village-scale operation fit that historic time box.

**18. Current demo operation and evidence to preserve**

The current root guide is `REGISTRY_DEMO_GUIDE.md`. `pnpm demo` starts the local platform, migrations, production build and web/dispatcher using Bash; `Start Demo.command` is the Mac entry point. Windows WSL is the documented launcher path; native Windows end-to-end operation was not tested. The browser/container architecture is not inherently WSL-only. Initial dependency/image installation needs internet; prepared demo assets and services are local.

The guide demonstrates Nandan lookup, correction/review, above/below and excavation, and shows originals in `fixtures/registry/`. Exact workspace/site UUIDs are local installation state, not fixtures to hardcode. The seed creates sources, inspects, builds and records through real services; repeated load preserves later operator changes. Rehearsal tests may add history/cases, so don't run disruptive suites in the middle of the user's presentation or reset database/storage volumes to tidy the UI.

Historical evidence: 13 September registry report records 53 Python tests, registry/allocation integrations, 17 legacy API checks, seven scene tests and real browser/offline-asset rehearsals. `DEEP_REVIEW.md` records a subsequent 59-Python/eight-focused-TypeScript audit plus API/scene/registry/C-001/C-002 reruns. Later import-fix work passed the focused import/contracts checks, typecheck and production build. These numbers describe different checkpoints and are not additive or a new certification of HEAD. The full Astra native/auth/reviewer acceptance was never established.

Useful repeatable checks include `pnpm typecheck`, `pnpm build`, `pnpm test:registry`, `pnpm test:registry-allocation`, `pnpm test:api`, `pnpm test:demo`, `pnpm test:scene`, focused TypeScript registry tests, `scripts/verify-registry-import.ts`, and the Python suite. Inspect prerequisites and side effects before running. Browser rehearsal must use the currently authorised browser tooling and report actual results, including unreadable documents and failure paths.

**19. Proposed delivery strategy for GPT-6 Pro to improve**

First deliver one complete vertical slice: select a surface parcel on a shared area map → attach a plan/section → resolve one missing measurement and one discrepancy → build/check → review → record → search its parcel/space IDs → inspect a neighbouring proposal conflict. Expand the fixture and extraction coverage after that slice works.

The current proposed order is: (1) parcel-first map/navigation, fixed area/frame and context model; (2) canonical extracted-fact, evidence and question/resolution contracts, usable with manual data first; (3) bounded Nous vision pilot and a provider adapter; (4) automatic schema generation and version-aware preparation-to-registry import; (5) whole-area current/proposed audit with road/public-ground semantics; (6) incremental demo packages, offline prepared fallback, browser rehearsal and updated guide. GPT-6 Pro should improve this order if a dependency or a smaller demonstrable slice warrants it.

Keep the Next.js/Cesium/PostGIS/storage/Redis-Celery/private Python stack. Use additive migrations, preserve legacy sources/URLs/identities/history, and avoid introducing a second application backend or a large agent framework for a bounded extraction job. Reuse the shared preview, geometry routines and review transaction. Explicitly decide map defaults, minimum supported document types, placement/calibration contract, fact-resolution policy, truthful real/synthetic classification and scope of area audit before writing dependent UI.

The large demo should prove incremental same-area placement, distinct repeated floor names, one shared basement/corridor identity, official-reference/demo-reference distinction, persistence across corrections/restart, duplicate-safe imports and stale-review rejection. AI acceptance must prove useful extraction on actual files, not only mocked response parsing. Spatial acceptance must compare independently derived quantities and test boundary contact, vertical coexistence, invalid frames and incomplete coverage.

**20. What the next GPT-6 Pro response should produce**

Return a candid assessment of what is useful today and why the desired user story remains incomplete, followed by a revised product flow and a prioritised implementation strategy. For each work area, explain the proposal, existing implementation and remaining work together, as this handoff does; do not give three disconnected lists of promises, completed tasks and omissions. Include schema/API implications, reuse versus changes, dataset/model validation gates, independently testable acceptance and a short presentation story.

Identify genuinely blocking user decisions, but resolve ordinary reversible details with judgement. Keep official data acquisition, live AI availability and production village-scale support explicitly conditional until tested. Keep future Android/authentication/official governance visible as deferred original scope rather than secretly deleting or reactivating it. The next release should be judged by whether an administrator can complete the parcel-to-3D and area-conflict stories through the UI, without hand-writing JSON or navigating unrelated workspaces.

**Repository reading map**

| Purpose | Files |
| --- | --- |
| Original mandate and acceptance | `Astra_MVP_Handoff_Pack/01_ASTRA_MASTER_HANDOFF.md`, `04_ACCEPTANCE_MATRIX.md`, and the preserved product/architecture/guardrail files under `reference/three_person_implementation_plan/reference/` |
| Superseding narrow demo scope | `docs/HACKATHON_PLAN.md`, `AGENTS.md`; the latest user instructions take precedence over historic launch prompts |
| Current demo and audit | `REGISTRY_DEMO_GUIDE.md`, `DEEP_REVIEW.md`, `docs/REGISTRY.md`, `docs/REGISTRY_TEST_EVIDENCE.md`, `docs/SOURCE_PREVIEW_EVIDENCE.md` |
| Proposed next product | `PARCEL_TO_3D_PLAN.md`, `BLOCK_DEMO_PLAN.md`; both are plans, not delivered features |
| Input/provenance documentation | `DEMO_DATA.md`, `docs/INPUT_GUIDE.md`, `fixtures/real-nyc/provenance.json`, `docs/PROTOTYPE_IDENTIFIERS.md` |
| Shared data contracts | `packages/contracts/src/index.ts`, `packages/contracts/src/registry.ts` |
| Registry persistence/review/import | `apps/web/lib/server/registry-db.ts`, `registry.ts`, `registry-routes.ts`, `registry-seed.ts`, `registry-import-evidence.ts` |
| Main UI and evidence | `apps/web/components/RegistryWorkbench.tsx`, `RegistryMap.tsx`, `RegistryCreate.tsx`, `RegistryEditor.tsx`, `RegistryFootprintDiff.tsx`, `Workbench.tsx`, `SpatialViewer.tsx`, `SourceFileDialog.tsx`, `SourcePreview.tsx` |
| Geometry and fixtures | `services/geo/geo/registry.py`, other processor modules, `services/geo/tests/test_registry.py`, `fixtures/generate.py`, `fixtures/generate_registry.py`, `scripts/convert-nyc-demo.ts` |
| Integration checks | `scripts/verify-registry.ts`, `verify-registry-allocation.ts`, `verify-registry-import.ts`, `verify-demo.ts`; `tests/registry-validation.test.ts`, `registry-import-evidence.test.ts` |
| Frontend guidance previously requested | Project `.agents/skills/taste-skill/SKILL.md`, `minimalist-skill/SKILL.md`, `redesign-skill/SKILL.md`; installed `frontend-design` skill. Read applicable instructions when implementing UI; this handoff made no frontend edits. |

Provide this file as the standalone conversation handoff. For repository-aware review, provide the repository and the reading map as well; otherwise code-level conclusions here are inspected evidence to assess, not a substitute for running the next release.
