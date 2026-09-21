# 98 · Engineering readiness audit: data → useful 3D → evidence → complete workflows

**Audit date:** 22 September 2026. **Status:** remediation proposed; implementation and external qualification remain open.

## 0. Decision and audit boundary

The handoffs contain useful product mechanisms and several good correctness boundaries. They are **not yet ready for an unrestricted parallel implementation run**. Their principal weakness is not missing feature ideas: it is the missing executable connection between available source data, supported geometry, a convincing active-product 3D view, exact property evidence, and shared persistence contracts.

The recommended first deliverable is **one visually strong, persisted, selectable building/floor/unit journey in the active Studio**, with source inspection and a genuinely scoped evidence packet. Prove it using a small coherent fixture, and separately prove that actual external 3D geometry can retain its shape and identity. Do not make this first result wait for universal ingestion, public authentication, every ML modality, remote MCP, or ten independently finished feature modules.

This document is an audit and remediation proposal. It does not silently change the scopes of handoffs 01 or 10–19/99. Proposed contracts, new paths, limits and acceptance thresholds below must be adopted by the responsible owner and then tested. **An issue is not closed merely because a fix is written here.**

| Audited item | Verified value |
| --- | --- |
| Repository | `Vinayak1337/3d-ulpin` |
| Documentation branch | `docs/usp-agent-handoffs`, obtained from existing PR #7 |
| Documentation revision reviewed | `12b3dcb34fb105991aff87ac864d7b92a0117807` |
| Application baseline | `f623cff897f91bb3ebd4c225f700ac263f7beb72` |
| Application baseline subject | `Record hosted floor registry verification` |
| PR | [#7](https://github.com/Vinayak1337/3d-ulpin/pull/7), open and unmerged when inspected |
| Inventory | All 14 original Markdown documents in this folder; individual review in section 2 |
| Review method | Complete supplied handoff contents, refreshed branch/index/shared/UI reads, targeted source-code inspection and current primary-source data research |
| Executed checks | Independent synthetic area/volume and source-coordinate arithmetic, described in section 11; not application tests |
| Not executed | Application build, DB migrations, browser/GPU tests, authenticated citizen flow, live model calls, MCP client handshake, full dataset acquisition or field survey |

The main ref still matched the application baseline when checked. Future implementing agents must check drift again. The audit did not access the previously documented Windows acquisition directory. A container checkout/download attempt was unavailable; connected GitHub reads remained available. No missing dataset archive or image was reconstructed from its filename. Existing comparison-image metadata was inspected, not freshly rendered browser captures.

**Evidence labels used below:** **C** = confirmed source/document fact; **D** = confirmed specification gap or contradiction; **R** = plausible failure requiring a test; **P** = proposed decision; **E** = external evidence/access not yet obtained. A source-code risk is not described as a reproduced production incident.

## 1. Preserve these decisions

Keep the existing registry and case/import authorities, immutable originals, stable IDs and revision history. Keep official parcel ULPIN assertions separate from application building/floor/space identifiers. Keep observed, planned, estimated and synthetic information distinguishable. Keep technical review separate from legal acceptance.

Keep Batches / Map / Register, quick inspection on the map, the full register and contextual source viewing. Keep one shared map boundary and coordinated selection. Do not rebuild the application around a second property database, queue, global state store, chatbot or GIS engine. Preserve working original-archive export as a separate permissioned capability; the new scoped packet has a different purpose.

Keep deterministic geometry and constrained mapping recipes; AI proposes interpretations, not measurements or rights by assertion. Keep absent/withheld/conflicting values explicit. Preserve local single-operator restrictions until public paths are individually qualified. Keep optional split/merge writes, complex solids and external interoperability out of the first thin workflow.

## 2. Complete document-by-document review

All 14 documents were reviewed in full against the pinned set. Source links below name actual existing files; later proposed paths are labelled as such. Verdicts describe implementation readiness, not product desirability.

| Document | Accurate/reusable foundation | Material gap or scope correction | Verdict and closure references |
| --- | --- | --- | --- |
| [00 Index](00-README.md) | Correct baseline, existing authorities, ownership intention and distinction between fixtures and live integration. | No owned, versioned test-data pack; broad F0→many-agents recommendation precedes a proven useful visual slice. Historical delivery checks are not runtime readiness. | **Ready after specified corrections:** ER-01, 23–25. |
| [01 Shared contracts](01-shared-contracts-and-ownership.md) | Correct core reference/value concepts, synthetic-store constraint, access distinctions and same-transaction event intention. | Ports remain mostly behavior descriptions. No complete job, unassigned-workspace, immutable-membership or transaction-sharing contract. Existing commit functions own transactions. | **Blocked pending design decisions:** ER-04–06; define the minimal slice first. |
| [10 Packets](10-scoped-evidence-packets.md) | Correctly distinguishes scoped derivatives from full originals and recognizes hidden PDF leakage. | Renderer/dependency and release-decision mechanics are unqualified; cumulative page/pixel limits conflict with bounded worker execution; shared-clause applicability needs a reviewed rule. | **Ready after specified corrections:** ER-14–16; first text/CSV slice can precede complex PDF handling. |
| [11 Readiness](11-evidence-readiness-and-review-queue.md) | Reuses actual work queue and explicit missing states; avoids a misleading universal score. | No concrete first technical policy, complete aggregate manifest or access-aware requirement denominator. Producer states and actionable filtered results need contract fixtures. | **Ready after specified corrections:** ER-04, 05, 19. |
| [12 Findings](12-rights-aware-spatial-findings.md) | Correct about context containment, bounded prism geometry, unknown accuracy and existing investigation history. | Parcel-only findings cannot be linked directly to the building-required investigation API. Exclusive/compatible rights and component case identity need definitions. | **Ready after specified corrections:** ER-11–13. |
| [13 Citizen](13-citizen-evidence-and-corrections.md) | Correct no-ownership-by-email rule, read-only public projection and quarantine gate. | Unresolved target is incompatible with always-required common scope/digest. Durable quarantine receipt, reviewed source promotion and notification semantics are not fully contracted. | **Ready after local corrections; public activation blocked:** ER-04, 15, 16, 22. |
| [14 Ingestion](14-adaptive-ingestion-and-progressive-review.md) | Correct schema-vs-format distinction, reusable recipes, chunk-vs-tile separation and separate recording. | No durable draft-scene producer; existing scene endpoint reads current recorded data. Batch limits exceed renderer/worker profiles. Drift cannot always be inferred from unchanged values. Existing compiler already emits 3D Tiles. | **Blocked for promised progressive integration:** ER-07–10, 21; deterministic small intake can start earlier. |
| [15 History](15-property-history-and-comparison.md) | Correct available-history reuse and optional split/merge write boundary. | Exact historical source/relationship/geometry manifest reconstruction is not supplied by a generic current-target resolver. | **Ready after specified corrections:** ER-05, 20; keep read-only first. |
| [16 Rights](16-shared-spaces-and-vertical-rights.md) | Correctly identifies legacy `serves` endpoint restrictions and avoids conflating access cycles with containment cycles. | Additive relation store needs an explicit authority/receipt contract. A duplex with different outlines per level cannot safely become one union-footprint prism. | **Ready after specified corrections:** ER-06, 11, 13. |
| [17 Impact](17-infrastructure-impact-screening.md) | Reuses actual point/volume inquiry and clearly rejects an excavation all-clear. | Exact qualified geometry/utility adapter output, assessment coverage and supported input limits are not frozen. | **Re-scope first release to qualified prisms:** ER-08, 11; richer utility solids wait for evidence and adapter tests. |
| [18 Assistance](18-grounded-assistance-and-mcp.md) | Correct native/private versus remote/public separation and read-only domain tools. | Citation membership alone does not establish factual entailment. Native F1 availability conflicts with UI2 wording. Provider/client qualification remains external. | **Defer remote MCP; native ready after corrections:** ER-21, 22, 25. |
| [19 Deployment](19-india-contained-deployment.md) | Correct S3-region caveat, legacy provider governance, standalone stack and explicit residency boundary. | Working images/entrypoints, complete route/egress inventory, scanner integration and restore performance are unproven. These must not block a local no-AI visual milestone. | **Ready for bounded policy tests; deployment claims blocked:** ER-22, 23. |
| [90 Human tasks](90-required-human-tasks.md) | Human work is appropriately limited to evidence, responsible review and authorization. | H1 needs specific candidate files and a match/metadata checklist, not just a broad request for samples. Agents should handle open-data acquisition themselves. | **Ready after concrete data-task additions:** ER-01 and section 12. |
| [99 UI/integration](99-ui-ux-and-integration.md) | Correct active-route distinction, contextual surfaces, invalid-record warning and shared selection intention. | Reference matching is optional; there is no data-linked visual acceptance contract or actual external-mesh integration proof. First final journey waits on several later gates. | **Ready after visual and sequence corrections:** ER-02, 03, 17, 18, 23–25. |

### 2.1 Important implementation facts checked

| Existing path | Confirmed behavior | Consequence |
| --- | --- | --- |
| [Studio route](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx) | Active officer pages resolve through the Studio route and modules under `features/officer`. | A beautiful separate showcase is not evidence that the main workflow improved. |
| [SavedSceneViewport](../../apps/web/features/studio/product/SavedSceneViewport.tsx) and [MapViewport](../../apps/web/features/spatial/MapViewport.tsx) | Existing scene/selection adapters and viewport source union. Selected interior records are displayed separately from compiled exteriors. | Extend these boundaries rather than create a renderer per feature. |
| [Compiler](../../apps/web/features/spatial/compiler/compile.ts) | Emits **3D Tiles 1.1** with coarse/detail GLBs. One frame; at most 2,000 visible entities, 50,000 input positions, 12,000 schematic facade bays, 80 MiB generated assets; local coordinates bounded to 5 km from origin. General CityJSON solids/triangle meshes are not direct inputs. | Reuse existing tiling. External roof meshes need an asset adapter, not flattening through an extrusion-only conversion. |
| [Scene service](../../apps/web/lib/server/spatial-core-scene.ts) | Current-data compilation, per-process cache up to 96 MiB/three entries, expiry after 20 minutes. Cache miss for an old digest attempts current reconstruction and can return 409. | It is not an immutable historical or draft-ingestion asset service. |
| [Registry commit](../../apps/web/lib/server/registry.ts) | `commitRegistryReview` opens its own transaction, locks shared recording/site/draft state and checks input fingerprints. | A caller cannot gain atomic event+commit behavior by wrapping this call in another transaction. |
| [JobStore](../../services/geo/geo/store.py) | Claim/release checks lease ownership, but `update` uses optimistic Redis updates without owner/attempt fencing. | Reuse needs a fenced completion contract before long/bulk jobs. No late-result incident was reproduced here. |
| [Tasks](../../services/geo/geo/tasks.py) and [dispatcher processing](../../apps/web/lib/server/processing.ts) | Bounded task execution and retry logic; different queue/execution-time handling by operation. | New operations need explicit time budgets and recovery; do not globally raise old limits. |
| [Registry checks](../../services/geo/geo/registry.py) | 100 volumetric spaces per bounded site/query path; some hole-bearing intersections are rejected. | Handoff acceptance for holes and large scopes requires an actual compatible adapter. |
| [Investigations](../../apps/web/lib/server/officer-investigations.ts) | Investigation creation begins with a building dossier. | Parcel-only or road-only cases need a scoped bridge or a narrower declared first workflow. |
| [Scoped export](../../apps/web/lib/register-scope.ts) and [source bundle](../../apps/web/lib/server/source-bundle.ts) | Record selection is scoped; original bytes can still cover other properties. | Preserve archival export; build and test a separate derivative selector. |
| [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), [useBlock](../../apps/web/features/officer/block/useBlock.ts) | Invalid/missing requested selection can fall back to broader/default context in relevant paths. | The existing 99 warning must become a launch gate for scoped actions. |
| [Shared hooks](../../apps/web/features/officer/shared/hooks.ts) | Resource reads are shared; successful mutations globally invalidate resources. | Do not trigger full dossier/scene reloads for every progressive tile event. |
| [Comparison manifest](../../apps/web/public/studio-review/comparison-manifest.json) | Names reference images and historical T058 captures, including differences from the generated illustration. | Lock actual reference assets and cameras, but do not call historical `current-map` images a fresh baseline. |

## 3. Data must be chosen by the visible outcome

### 3.1 Three different products are being conflated

[Google Open Buildings](https://sites.research.google/gr/open-buildings/) supplies predicted vector outlines, not its underlying satellite imagery. Its polygons are useful inputs, but do not supply interiors or a complete textured city model. [Google's temporal product](https://sites.research.google/gr/open-buildings/temporal/) adds estimated height rasters; it is not a floor schedule. [Google Maps Tile API](https://developers.google.com/maps/documentation/tile/policies) is a different service with visualization, caching and extraction restrictions. It is not the canonical open-data ingestion source for this project.

**Proposed product distinction:** a rich context mesh helps people recognise a place; semantic building geometry lets them select an object; supported floor/space geometry lets them inspect vertical records. These are three different layers. Do not expect one satellite image, point cloud or textured mesh to provide all three.

### 3.2 Input capability contract

The output column is a proposed supported outcome, not a claim that every adapter already exists. Each adapter must declare which stages it actually implements.

| Input type | What to accept/retain | Useful visible output | Additional evidence needed / prohibited inference |
| --- | --- | --- | --- |
| Footprint vectors | GeoJSON, supported GIS layers, CSV with WKT; IDs, CRS, original geometry and attributes | Selectable outlines; extruded exterior only with a supported height observation | A footprint is not a legal parcel or a flat plan. No guessed floors. |
| Height/surface raster | GeoTIFF or qualified raster window; geotransform, nodata, units, height meaning, date | Estimated massing or supported terrain/surface context | Relative height versus absolute elevation must be resolved; pixel spacing is not accuracy. |
| CityJSON/CityGML building models | Original object IDs, LoD, boundaries, semantics, transforms and CRS | Roof-shaped selectable buildings; optional semantic roof/wall inspection | Separate adapter required. Keep missing interiors missing. |
| Textured OBJ/GLB or photogrammetry mesh | Mesh, material/texture dependencies, coordinate placement and licence | Detailed neighbourhood context and recognisable roofs/facades | Continuous mesh may lack object IDs. No automatic unit/owner attribution from triangles. |
| Floor plan plus section/level schedule | Original pages, unit labels, scale/dimensions, orientation, lower/upper levels | Exploded levels, selected spaces, sectional inspection, source highlight | Room segmentation is not legal unit delineation; typical-floor scope and placement must be evidenced. |
| IFC/BIM | Original model, supported element IDs/placements/units and relevant level relationships | Detailed structural/space representation when a qualified adapter exists | Architectural spaces do not automatically equal cadastral rights; unsupported IFC remains retained. |
| LiDAR LAZ/LAS | Original point data, classification, CRS/vertical reference and acquisition metadata | Qualified ground/roof observations or point-cloud context | No internal ownership from roofs; ground classification and extraction need evaluation. |
| Drone image set | Images plus available camera/calibration/control metadata | Photogrammetric context/model only through a qualified reconstruction process | A single oblique image is not sufficient to reconstruct reliable parcel coordinates. |
| Registry/inventory PDF, CSV, JSON | Literal identifiers, named quantities, source locations, supplied rights assertions | Searchable records, source evidence, missing-data tasks and scoped extracts | A flat listing alone has no unit polygon and may not be a complete building inventory. |
| Parcel and recorded road-land GIS | Published/surveyed geometry and its stated status, dates, identifiers and accuracy | Boundary context and evidence-linked discrepancy review | OSM centreline/assumed buffer is not recorded road land. |
| Utility drawings/profiles | Alignment, dimensions, depth/elevation meaning, datum and evidence | Underground inspection or qualified impact screening | Missing depth/diameter is unassessed; no safety clearance. |
| GNSS/CORS/control observations | Coordinate observations, solution/control metadata and references | Evidenced placement/alignment operations | Reference services do not supply the unknown corners of a particular building. |

### 3.3 Concrete acquisition and test packs

**Verification states:** `catalogue_checked`, `payload_inspected`, `bytes_preserved`, `parsed`, `rendered`, `workflow_verified`. A higher state requires its own evidence; a portal link is not a usable local file. Large archives were not downloaded during this audit.

#### D0 — Golden vertical-workflow fixture: first integrated milestone

**Source:** existing authored Lake View/reference materials, [comparison manifest](../../apps/web/public/studio-review/comparison-manifest.json), [reference seed](../../scripts/reference/seed.ts), [complete-data generator](../../scripts/reference/complete-data.py), existing registry/export fixtures. **Status:** repository paths and documented synthetic provenance; no fresh local restore performed.

**Proposed pack:** a new isolated fixture namespace containing 3–5 buildings and no more than 30 spatial units. Include an irregular footprint/courtyard, basement, unequal floor heights, mezzanine, one duplex described by separate level components, shared stair, two parcel relations, a true overlap, a boundary-only contact and missing-evidence records. Use coherent authored plans, schedule rows and mixed-property document pages with unique test sentinels. Derive every view from the same stored geometry/evidence, not separate hand-authored UI mock responses.

**Unlocks:** first attractive live 3D workflow, scoped packets, deterministic readiness, rights/findings, history and negative permissions. **Does not unlock:** actual Delhi title, real residents, survey accuracy or generalisation claims. Reuse originals/generator knowledge without reseeding someone else's populated database.

#### D1 — Real roof-shaped geometry: 3DBAG

**Source:** [official services and download instructions](https://docs.3dbag.nl/en/delivery/webservices/); [single-building API sample](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.1655100000500568). **Status:** actual JSON response inspected; model not imported or rendered in this app.

The sample includes a building and building part, sloped roof geometry, multiple LoDs and a null `b3_bouwlagen` field. Preserve that missing floor count. The API uses EPSG:7415; metadata supplies a coordinate scale/translation. Provider 3D Tiles are separately served in ECEF and use compressed GLB feature metadata. Their buildings are uniformly coloured, not photographic facades.

**Acquisition recipe:** save one complete response and its original hash; preserve metadata plus feature. Test one object before collecting a bounded 25–100-building extent, following actual pagination links. For provider tiles, pin a release and qualify the existing viewer's metadata picking and compression support. Keep originals/licence attribution, not just a flattened output mesh.

**Visible result/test:** retain slanted roofs and source IDs, show unknown interior records, pick the right building, and preserve shape when changing LoD. No conversion into a generic rectangle or a fabricated floor stack. No Dutch geometry relabelled as Uttam Nagar. **Owner proposal:** DATA agent for pack; UI for display adapter; FND for coordinate/identity bridge.

#### D2 — Textured context: Helsinki 3D

**Source:** [City of Helsinki 3D](https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d) and its linked [mesh directory](https://3d.hel.ninja/data/mesh/). **Status:** official catalogue/directory checked; no mesh archive rendered.

The city offers reality meshes and semantic city models, with textured options and stated CC BY 4.0 licensing. Some export paths omit building attributes, while CityGML deliveries preserve them. Select a small built-up area and keep the stated coordinate/vertical system; do not infer survey year from a server modification timestamp.

**Acquisition recipe:** start with a bounded urban crop/export, preserving OBJ/MTL/textures or the supplied equivalent and a dependency manifest. Inspect expected transfer size before downloading multi-gigabyte regional archives. Do not choose an empty offshore tile merely because it is small. Validate texture paths, scale, axis order, placement and attribution.

**Visible result/test:** recognisable roof/facade context with missing-texture recovery, bounded GPU memory and independent selectable semantic overlay where matched IDs exist. Mesh-only regions remain context, not clickable invented property records. **Role:** visual benchmark; it is not mandatory before D0 succeeds and does not supply Indian rights.

#### D3 — Real Delhi context and larger-batch ingestion

**Source:** [existing acquisition notes](../GOOGLE_UTTAM_NAGAR.md), [Google Open Buildings](https://sites.research.google/gr/open-buildings/), [temporal heights](https://sites.research.google/gr/open-buildings/temporal/) and [Geofabrik India extracts](https://download.geofabrik.de/asia/india.html). **Status:** prior local acquisition documented; large Windows extract not rechecked here.

The repository documents 91 detections in the selected Uttam Nagar block, 15 retained at the chosen confidence threshold, and separate fictional interiors/road assumptions. The sparse high-threshold subset is not a complete neighbourhood. Reuse the existing bounded data before another regional download. Show lower-confidence candidates separately, without representing them as equally reliable observations.

**Proposed scale progression:** existing block → approximately 500 exterior objects → at most 2,000 per current compiled publication; larger batches must be spatially paged. Preserve observed/estimated/scenario worlds. Heights from the temporal product are estimates with approximately 4 m effective resolution, not verified individual levels.

**Visible result/test:** accurate source outline placement, understandable uncertainty, incremental map loading and source inspection. Missing heights remain outlines/unavailable 3D. OSM road centrelines are labelled as such; authored road-width buffers and conflicts remain a separate scenario. Do not increase evidence coverage when illustrative details are added.

#### D4 — Real Indian document rows: DDA inventory

**Source:** [DDA Premium Housing Scheme 2026 inventory PDF](https://dda.gov.in/sites/default/files/Housing_Department/list_of_flats_and_garages_dda_premium_housing_scheme_2026.pdf). **Status:** PDF opened and first-page table visually inspected; no complete parsed dataset or geometry join established.

**Concrete oracle:** first-page row 22 lists flat `C-01-3`, `1st floor`, Block `NA`, Pocket `E`, Loknayakpuram, with a `Plint Area` value `134.259`. Preserve literal labels. Do not infer Block C from the identifier or assign a measurement unit from the number alone when its basis has not been established. Adjacent table columns must not collapse into a invented `NAE` field.

**Visible result/test:** source-highlighted unit inventory, record search and explicit missing-placement/geometry states. This tests real document normalization; it does not by itself produce a building model, current owner register or all units in the building. Obtain matching drawings separately. Review reuse terms before publishing source copies; public viewing is not blanket redistribution permission.

#### D5 — One coherent Indian planned building

**Candidate sources:** Haryana RERA [4S THE AURRUM, project 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831) and [SIGNATURE GLOBAL CITY 37D-(2), project 2079](https://haryanarera.gov.in/view_project/project_preview_open/2079). **Status:** document indices checked; selected drawing downloads failed in the audit environment. No dimension/coordinate sufficiency is claimed.

**Required acquisition, before selecting the real pilot:** one site/demarcation drawing; a named tower/building; one or two floor drawings with their applicable levels; a section/level schedule; relevant shared-space/context clauses. Confirm names, dates/revisions, units and drawing relationships. Use approved/permitted copies. Initially classify promoter/planning drawings according to their source, not automatically as current as-built survey.

**Visible result/test:** local-frame planned building, correctly labelled floors and spaces, section view and source-linked records. Geographic placement remains unavailable until control evidence is sufficient. If downloads or necessary drawings remain unavailable, use a permitted campus/known-property plan and section, or D0 for implementation. Do not append a random plan to a Delhi polygon to manufacture a coherent example.

#### D6 — Modality-specific ML packs, not the UI prerequisite

Use [UAVPal institutional metadata](https://research.utwente.nl/en/datasets/uavpal/) for paired imagery/surface-data research, [CubiCasa5k](https://github.com/CubiCasa/CubiCasa5k) for plan segmentation, [IIT Roorkee dataset request page](https://www.iitr.ac.in/uasg2023/sdata.html) for the listed dense-Delhi imagery, and [TALD](https://sites.google.com/view/taldiist/home) for the Indian LiDAR request route. These are separate benchmark/acquisition leads from the earlier catalogue; no archives or new grants were obtained in this audit. Confirm the specific version, annotation content and research/non-commercial/demo permissions before use.

**Required agent output per selected modality:** tiny preserved sample, input schema/reference metadata, independent labels, training/evaluation split, actual inference output, error cases and runtime measurements. Start with one modality. Do not transplant these locations into the Delhi example or equate room labels with ownership boundaries. A native parser and the existing reviewed-proposal path can be tested before model tuning.

#### D7 — Same-area cadastral/road/utility truth: externally gated

**Source route:** [DoLR NAKSHA](https://dolr.gov.in/en/about-naksha/), the appropriate survey/revenue/urban authority, [Delhi Land Records](https://dlrc.delhi.gov.in/), a consenting record holder and relevant infrastructure custodian. NAKSHA describes integrated urban survey work; this is not proof of a public downloadable complete block.

Request one small matched area, with available parcel/recorded-road boundaries, survey/control metadata, source identifiers, imagery/elevation outputs and permitted record references. For underground assessment request actual profile/as-built evidence or keep the example explicitly planned. No complete open Uttam Nagar parcel+ULPIN+floor-rights crosswalk was established.

**Unlocks only after receipt and validation:** real boundary/rights-linked pilot qualification. **Fallback:** D0 known-truth scenarios and a visibly incomplete D3 reference map. Missing official evidence does not block code; it blocks official/real-world claims.

### 3.4 Data-pack manifest and acquisition acceptance — proposed

Proposed owner DATA is a bounded acquisition/fixture role, not another schema authority. FND owns the shared manifest contract; each feature owns its test expectations. Proposed files are `fixtures/usp/<pack>/manifest.json`, `expected.json`, and permitted small originals, plus `scripts/usp/data/<pack>.ts` or `.py` only when actually implemented. Large/restricted originals stay outside Git with approved storage references and reproducible acquisition instructions.

```json
{
  "schemaVersion": "usp-data-pack/1",
  "packId": "D1-roof-sample",
  "version": 1,
  "acquisitionState": "payload_inspected",
  "sourceFamily": "3dbag",
  "classification": "external_reconstructed",
  "geographicPlacement": "requires_qualified_transform",
  "assets": [],
  "externalEvidence": [],
  "expectedCapabilities": ["exterior_display", "building_selection"],
  "unavailableCapabilities": ["verified_floor_layout", "apartment_rights"],
  "workflowVerified": false
}
```

This is an illustrative record, **not a delivered pack or new canonical-world enum**. The provenance adapter maps source classification into existing supported concepts without losing the literal provider description. An empty `assets` list cannot pass `bytes_preserved`. Acquired asset entries must include original URL/version/date, actual SHA-256 and bytes, media type, licence/permission, source IDs, horizontal/vertical references, units, dependencies and parser result. Never put invented hashes in a manifest. Expected outputs name stable target refs, numeric oracles, unavailable states and visual shot IDs. Every cross-source association records its join method, evidence, reviewer state and unresolved alternatives.

### 3.5 While building X, test with Y and produce Z

| Workstream | Primary pack | Necessary negative input | Smallest useful visible/persisted outcome | Separate real-data gate |
| --- | --- | --- | --- | --- |
| UI / scene integration | D0 and D1 | Missing height, irregular roof, empty interior, failed texture/asset | Active map → building → floor/unit where supplied → matching quick/full register; same IDs after reload | D1 adapter/renderer succeeds on preserved actual payload; D2 optional context |
| PACK | D0 mixed-property source; D4 table rows | Sibling sentinel on same PDF page; missing shared clause | Reviewed selection → durable job → artifact containing only permitted scope | Permitted multi-property source plus verified extraction/release rules |
| READY | D0 requirement truth; D4 missing geometry | Unknown applicability, absent check, duplicate evidence | Named-step readiness → exact missing fact → working next action | Reviewer-approved local technical policy, not an invented statutory policy |
| FIND | D0 known geometry; D7 later | Vertically separate shapes, boundary contact, missing datum, parcel-only pair | Measured result → evidence → correctly scoped review case | Survey/recorded-boundary and rights inputs for actual local claims |
| CITIZEN | D0 two contributors and reviewer | Wrong building, unlisted unit, malicious file, revoked session | Own submission → clarification → reviewed proposal receipt | F2, public-release policy and actual quarantine/scanner |
| INGEST | D3 plus D4; D1 as a separate adapter family | Quoted CSV, same header/different declared units, bad record, out-of-order chunks | Receipt → mapping → persisted draft scene → selected review group → recorded revision | Measured independent source-family adaptation; not repeated chunks of one schema |
| HISTORY | Two D0 revisions | Missing old source, changed frame, retired ref | Exact before/after comparison with source pins and current state unchanged | Real historic pair with compatible meaning; lineage writes remain optional |
| RIGHTS | D0 shared stair and duplex; D5 clauses later | Two claims, access cycle, missing extent, stale endpoint | Relationship proposal → review receipt → same shared space shown once | Applicable clauses and defined target spaces; no rights from geometry alone |
| IMPACT | D0 trench/basement and elevation scenarios | Unknown utility depth, incomplete inventory, hidden asset | Saved proposed volume → reproducible affected-space list and gaps | Supported survey utility profile and coverage metadata |
| ASSIST | Actual D0 feature-service outputs | Injected document instructions, incorrect citation, switched target | Grounded answer → exact evidence/next screen | Actual configured model or template fallback; remote client separately tested |
| DEPLOY | D0 non-personal restricted-labelled fixture | Model/scan/mail outage, blocked egress, restore interruption | Measured policy enforcement and working manual workflow | Approved infrastructure/provider/IdP and real environment tests |

## 4. Cross-feature contract and ownership audit

Matching names in documents do not establish type compatibility. The following are explicit producer/consumer obligations to freeze before the affected work starts.

| Producer → consumer | Entities / contract | API or event | Shared state / UI | Sole owner and unresolved obligation |
| --- | --- | --- | --- | --- |
| FND → every feature | Core refs, backing mapping, scope and target pins | `resolveTarget`, `readScope`, typed errors | URL selection, exact target header | FND: discriminated workspace/snapshot scopes and exact read projections, ER-04/05 |
| FND registry bridge → RIGHTS/CITIZEN/HISTORY | Reviewed command, accepted revision pins, commit receipt | `commitProposal` and transactional domain event | Updated record and history | FND: same-client transaction operation, ER-06 |
| FND job adapter → PACK/FIND/INGEST/IMPACT | Logical job, attempt, lease, input fingerprint, result reference | Enqueue/read/cancel/retry/apply | Durable progress, not React-only state | FND: executable signatures and attempt fencing, ER-04/09 |
| INGEST → UI | Draft scene manifest, entities, assets and coverage | Status snapshot + `tile.ready`/reset | Existing viewport and stable selection | INGEST owns artifact producer; UI owns display consumer; FND owns storage hook, ER-07/10 |
| FIND → READY/IMPACT/PACK | Applicability, coverage, measures, participant/source pins | Result projection, assessment changed | Checks, readiness, impact panels | FIND: compatible result schema and qualified geometry export, ER-11/12 |
| RIGHTS → FIND/PACK/IMPACT | Explicit relationship/assertion state, validity and evidence | Rights projection, accepted receipt event | Relations and relevant context | RIGHTS: distinguish claim/review/authority; no implicit sibling inheritance, ER-13 |
| CITIZEN → READY/FIND | Evidence request version and reviewed response outcome | Request/submission events | Next action and review queue | CITIZEN: upload is not satisfaction; FND supplies targetless intake binding, ER-16/19 |
| HISTORY → RIGHTS/ASSIST/UI | Historical pinned composition and optional lineage | Exact revision reads, comparison references | Before/after view | HISTORY: no current-source substitution, ER-20 |
| DEPLOY → INGEST/ASSIST/CITIZEN | Model, scanner, mail and policy outcomes | Gateway/scan/receipt ports | Capability states and safe fallback | DEPLOY implementations; FND definitions/wiring. No second provider client, ER-22 |
| PACK → UI/public-release consumer | Plan version, source pins, omission reasons, released derivative | Plan/job/download | Single evidence drawer | PACK: proof of extraction and separate derivative-release policy, ER-14/15 |
| UI → feature leaves | Selection generation, target scope, allowed actions | Typed panel callbacks | One foreground panel, map/quick/full register | UI: stale-response suppression and invalid-scope actions, ER-17/18 |
| FND outbox → INGEST/CITIZEN | Stream ID, commit-ordered sequence, minimal payload | Replay and notification consumption | Progress/notification state | FND persists; INGEST replays; CITIZEN delivers. Atomic state/cursor and delivery semantics, ER-10/16 |

No genuine dependency cycle needs to be introduced: READY can consume an explicitly unavailable request/check provider; FIND can perform bounded geometric checks without new RIGHTS; RIGHTS can inspect current assertions without new HISTORY lineage writes. However, absence must disable the relevant conclusion/action. An unavailable FIND provider cannot let INGEST label cross-chunk checking complete.

The remaining ownership problem is **integration throughput**, not merely overlapping files. FND presently owns nearly every shared seam; UI owns nearly every visible seam. Feature agents need a published patch-request format and frequent integration, otherwise apparently independent branches will wait for the same two owners.

## 5. Proposed minimum contract corrections

These payloads illustrate the required decisions. They are **not existing exports or agreed migrations**. Adopt them only through FND/UI review, preserving equivalent existing concepts where possible.

### 5.1 Intake context is not a recorded snapshot

```ts
type WorkScope =
  | { kind: 'intake'; caseId: string; batchId: string | null }
  | { kind: 'snapshot'; scopeId: string; world: CoreRevisionRef;
      manifestId: string; snapshotDigest: string };

type CommandExpectation =
  | { kind: 'create'; resourceMustNotExist: true }
  | { kind: 'update'; resourceRevision: number; manifestId: string };

type ReadProjection<T> =
  | { state: 'available'; manifestId: string; data: T;
      coverage: { completeForReceivedInputs: boolean; reasons: string[] } }
  | { state: 'unavailable'; reasonCode: string };
```

A source can be received before any property/world exists. Do not fabricate a world or target revision to satisfy a common DTO. Submission status and upload creation need a workspace/resource version, not an invented spatial snapshot. Public errors may intentionally suppress details.

### 5.2 A snapshot is a reproducible composition

A proposed manifest pins its membership definition and ordered member refs, entity revisions, representation revisions, source parts/revisions, relationship/assertion versions, placement operations and method/policy versions. Its digest is computed by a specified canonical encoding. A current pointer may advance; the pinned historical manifest does not mutate.

Pagination cursors bind to manifest ID, filter digest and access-view version. Either materialize immutable membership or reject stale cursors; do not keep a database transaction open across browser page requests. A property-only revision does not detect a changed shared-stair clause or coordinate transformation. Caches and findings must use the actual dependency digest.

### 5.3 Same-transaction recording and events

Proposed internal adapter:

```ts
commitReviewedChangeTx(tx, ctx, command): Promise<{
  receiptId: string;
  previousManifestId: string;
  acceptedManifestId: string;
  acceptedTargets: CoreRevisionRef[];
}>
```

The existing public commit entry can retain its current interface and open a transaction that delegates to the internal function. New coordinated callers pass that **same** client to commit, audit, receipt and outbox operations. Do not call an independently committing service inside an outer transaction and call it atomic. If a separate system cannot share the transaction, specify an explicit durable reconciliation workflow instead of asserting atomicity.

### 5.4 Draft display manifest and replay

```json
{
  "schemaVersion": "usp-scene-manifest/1",
  "kind": "draft",
  "manifestId": "example-manifest-reference",
  "revision": 4,
  "previousManifestId": "example-prior-reference",
  "coverage": {"received": 120, "placed": 38, "needsInput": 4, "complete": false},
  "entityIndexRef": "example-authorized-index-reference",
  "assets": [],
  "eventCursor": {"streamId": "example-stream", "sequence": "42"}
}
```

Example IDs are placeholders, not hashes or actual stored objects. The producer writes immutable assets, verifies their bytes, then commits a manifest referencing those assets and its outbox event. Status snapshot and cursor are read from a consistent committed state. Browser events reference a manifest/asset, not an entire source file. Deletion/tombstones and superseded tiles need explicit manifest changes; otherwise old geometry remains on screen after a correction.

Map asset identity differs from property identity. Same entity in two tiles must select the same canonical object. Source metadata lives separately from GPU payloads. Missing/expired assets lead to a coherent reload or an explicit unavailable state, not silent fallback to current geometry under an old digest.

### 5.5 Job result application

The logical job persists independently of attempts. Each attempt has a monotonically advanced attempt number or fencing token, owner, lease deadline, started/completed times and input fingerprint. Result acceptance is conditional on the currently authorised attempt and dependencies. Store output references durably before acknowledging accepted completion. Repeating an accepted result returns its receipt; old attempts cannot resurrect cancelled or superseded work.

Pause stops new claims. Define whether in-flight work may finish into a retained draft or must be discarded; do not leave that decision to each worker. Cancellation does not delete originals. Queue waiting, upload time, execution time and model-call budgets are separate measurements.

## 6. Stable findings and precise closure paths

**Severity:** Blocker prevents the affected integrated promise; High can produce incorrect scope/results or substantial wasted implementation; Medium causes a bounded usability/operational problem. All findings below are **OPEN**. A proposed design correction and an executed closure test are tracked separately.

### ER-01 · No qualified, owned data-to-outcome packs

**Severity/class:** High, D/E. **Evidence:** 00 execution matrix; 90 H1; 10–19 acceptance examples; 99 final journey. These identify broad fixtures or unavailable real evidence, not a reproducible shared acquisition manifest and oracle.

**Failure/impact:** agents build against incompatible imaginary datasets, then cannot populate the final map or demonstrate exact-space documents. All features are affected.

**Proposed fix/required edits:** adopt D0/D1 first; add named pack IDs, source state, required fields, expected outputs, known absences and fallback to each handoff J. Add DATA ownership and acquisition gates to 00/90; reference section 3 instead of sending teammates on generic searches.

**Owner/closure:** DATA prepares packs; FND freezes manifest; feature owners approve oracles. Close when originals/allowed fixtures and hashes exist, two independent consumers read the same IDs, and unsupported outputs are recorded. Catalogue existence alone does not close it.

### ER-02 · Rich external 3D cannot be assumed to fit the current extrusion compiler

**Severity/class:** High, C/D. **Evidence:** 14 C; 99 map rules; [compiler](../../apps/web/features/spatial/compiler/compile.ts) accepts a bounded planar/extrusion profile, already emits 3D Tiles and excludes interior level/space entities from exterior compilation.

**Failure/impact:** an agent downloads CityJSON sloped roofs, flattens them to footprints, and produces boxes; or adds another viewer that cannot select the existing register. UI/INGEST/FND are affected.

**Proposed fix/required edits:** add a qualified external-asset display lane to 99/14 with preserved geometry/LoD/metadata, alongside the existing analytical lane. Reuse the existing viewport and compatible tile loader. Qualify mesh compression and picking before accepting a provider tileset. Do not claim arbitrary mesh measurement or IFC support.

**Owner/closure:** UI with FND identity/frame adapter. Close with actual D1 roof geometry in the active route, correct building selection and unchanged missing-interior state. D2 textures are optional; a separate demo page is insufficient.

### ER-03 · Visual quality has no source-linked pass gate

**Severity/class:** High, D. **Evidence:** 99 section 4 makes reference images optional; section 9 prescribes screenshot sizes but not expected scene content. [Comparison manifest](../../apps/web/public/studio-review/comparison-manifest.json) refers to historical images, not a fresh current capture.

**Failure/impact:** all tests pass while the main map is sparse, generic, unreadable or non-interactive. A polished showcase masks an unchanged officer route.

**Proposed fix/required edits:** add section 9's shot/interaction contract to 99, nominate reference files by actual hash and capture fresh active-route baseline. Require geometry silhouettes, floor isolation, evidence context, incomplete states and pointer interaction, not just a screenshot file.

**Owner/closure:** UI; user visual review remains distinct from deterministic tests. Close on side-by-side active-product captures and repeatable input interactions for D0/D1, with unresolved differences listed. Do not claim pixel identity to a generated illustration or fabricate an approval score.

### ER-04 · Shared ports are not yet implementable contracts

**Severity/class:** Blocker for parallel feature integration, D. **Evidence:** 01 section 3 defines illustrative types and port behavior; multiple leaf handoffs consume jobs, `RequestContext`, new creates and unresolved intake without complete signatures.

**Failure/impact:** one agent invents `enqueueJob`, another expects a Celery ID; a submission without a matched property fabricates a world/digest; incompatible return envelopes compile only against local mocks.

**Proposed fix/required edits:** in 01 publish minimal strict request/result/error schemas and executable contract fixtures for the first slice. Add intake/snapshot and create/update unions from section 5, typed job operations, explicit unavailable projections and consistent cancellation semantics. Keep future ports unavailable rather than implementing empty-success stubs.

**Owner/closure:** FND. Close before affected feature branches integrate: producer and consumer tests use the same exported schemas and exact examples, including errors and pending outcomes. A types-only file without a connected producer closes only the interface portion.

### ER-05 · Revision pinning lacks an immutable composition and membership contract

**Severity/class:** Blocker for exact evidence/history/stream claims, D. **Evidence:** 01 `UspScope` and `currentSnapshot`; 11 aggregates; 15 comparisons; 16 assertion changes; 14 replay.

**Failure/impact:** property revision stays constant while a shared clause, placement transform or relationship changes. A queue count and page two refer to different populations. Old history silently uses current evidence.

**Proposed fix/required edits:** define section 5.2 manifests, dependency pins and cursor semantics in 01; update 10/11/12/14/15/16 caches and expected-revision rules to consume them. Separate local resource versions from spatial composition versions.

**Owner/closure:** FND, consumed by all features. Close with concurrent source/relationship changes, stable pagination or explicit stale rejection, and historical reads resolving the exact pinned constituents. Hashing a partial JSON object is not sufficient.

### ER-06 · Atomic outbox/receipt promises do not match transaction-owning legacy commits

**Severity/class:** Blocker for coordinated writes, C/D/R. **Evidence:** 01 same-transaction rule; 13 accepted proposal; 16 accepted receipt; [commitRegistryReview](../../apps/web/lib/server/registry.ts) opens its own transaction and obtains shared locks.

**Failure/impact:** a legacy commit succeeds, outer event transaction fails and consumers never receive it; nested callers can also wait on locks held by another connection. This is a code-supported scenario, not a reproduced deadlock.

**Proposed fix/required edits:** specify one transaction-aware internal adapter and exact accepted revision receipt in 01, with FND-owned narrow changes to legacy services. Update 13/15/16 to consume it. Do not replace legacy safety checks.

**Owner/closure:** FND. Close with injected failure between record and event operations proving both commit or both roll back; duplicate command returns one receipt. Verify lock order and ensure the receipt references post-commit revisions rather than the old review payload.

### ER-07 · Progressive draft rendering has no durable producer

**Severity/class:** Blocker for INGEST's progressive promise, C/D. **Evidence:** 14 sections D/E; 99 INGEST integration; [scene service](../../apps/web/lib/server/spatial-core-scene.ts) reads current normalized area data and stores generated assets only in a process cache.

**Failure/impact:** `tile.ready` fires but the map still reads the recorded area; a restart loses draft assets or rebuilds a different current version. UI shows progress without usable draft geometry.

**Proposed fix/required edits:** 14 must specify immutable draft manifests, authorised asset storage, entity index, incremental replacement/tombstones and review-group binding. 99 consumes that producer through the same viewport. Preserve the recorded snapshot separately.

**Owner/closure:** INGEST producer, UI consumer, FND storage/route bridge. Close when an actual unrecorded chunk is selectable in the main workflow, survives process restart and never overwrites recorded data. A simulated timer animation does not qualify.

### ER-08 · Proposed batch sizes exceed qualified downstream profiles

**Severity/class:** High, C/D. **Evidence:** 14's 100,000 structured records and 256 MiB batch; compiler limits in section 2.1; [registry query](../../services/geo/geo/registry.py) 100-space profile; per-process scene budget.

**Failure/impact:** parsing succeeds but publication/checking fails late, or an agent removes every cap to show a large dataset. The app becomes unusable despite a successful import receipt.

**Proposed fix/required edits:** define workload profiles and separate uploaded/processed/resident counts in 14/12/17/99. Use spatial partitions, bounded candidate queries and viewport loading; keep complete canonical objects and global run deduplication. Reject/segment unsupported work before expensive execution.

**Owner/closure:** INGEST/FIND/UI, FND shared limits. Close on declared workloads with measured peak memory, tile bytes, pair counts and recoverable limits. Increasing a constant is not scalability evidence.

### ER-09 · Lease ownership does not fence all result writes

**Severity/class:** High, C/R. **Evidence:** [JobStore.update](../../services/geo/geo/store.py) lacks owner/attempt checks; [tasks](../../services/geo/geo/tasks.py) and [processing](../../apps/web/lib/server/processing.ts) have bounded but differing timeout behavior; 14 expects stronger recovery.

**Failure/impact:** a delayed old attempt updates a job after a newer attempt/cancellation, or queued work times out before execution. Existing short task bounds reduce some risk but do not prove new bulk operation safety.

**Proposed fix/required edits:** add section 5.5's conditional result-application contract to 01/14; explicitly separate queue and execution clocks, attempt exhaustion and logical job retry. Ensure every new worker operation uses the gate.

**Owner/closure:** FND worker hooks; INGEST scheduler. Close with killed-worker, lease-expiry, delayed-old-result, cancel/retry and duplicate delivery tests against real services. Redis WATCH alone is not ownership fencing.

### ER-10 · SSE replay and status/asset consistency are underspecified

**Severity/class:** High, D/R. **Evidence:** 01 outbox ordering is sound in principle; 14 section E5 requires a snapshot and cursor but does not specify their atomic read or asset lifecycle.

**Failure/impact:** an event commits between an unrelated status query and cursor query and is skipped. Replayed event names an expired asset. Removed objects remain loaded because no replacement/tombstone exists.

**Proposed fix/required edits:** in 14 define consistent snapshot/cursor reads, immutable manifest advancement, versioned event schemas, durable replay window, reset behavior and bounded client backpressure. Pin assets to their manifest and apply updates idempotently; do not use pub/sub as the only record.

**Owner/closure:** FND outbox; INGEST replay/producer; UI application. Close with the race above, reversed completion order, duplicate events, expired cursors, missing assets and revoked access. Live updates must match a fresh authoritative snapshot.

### ER-11 · Geometry capabilities differ between core, legacy storage and promised vertical cases

**Severity/class:** High, C/D. **Evidence:** 12 holes/multipart tests; 16 duplex; 17 utility profiles; [core representation schema](../../packages/contracts/src/spatial/core/geometry-schema.ts) versus [legacy registry](../../packages/contracts/src/registry.ts) and Python query restrictions.

**Failure/impact:** a courtyard is filled, a duplex becomes a prism covering space it does not occupy, or unrelated vertical datums are combined. A valid core fixture does not establish that the legacy persistence/query path can carry it.

**Proposed fix/required edits:** add a profile matrix to 01/12/14/16/17: retained asset, display mesh, analytical planar polygon, analytical prism, and multiple supported components. Preserve unsupported shapes as unavailable for that operation. Multi-level identity can reference multiple components without fabricating a single bounding prism.

**Owner/closure:** FND contract bridge; FIND qualified calculations; UI display. Close with holes/multipart/unequal-level/duplex round trips through actual persistence and the relevant operation, or a documented unsupported result without geometry loss.

### ER-12 · Parcel-only findings cannot use a building-only investigation unmodified

**Severity/class:** High, C/D. **Evidence:** 12 includes parcel–parcel and road findings; [createInvestigation](../../apps/web/lib/server/officer-investigations.ts) starts from a required building dossier.

**Failure/impact:** the officer clicks a parcel overlap and there is no compatible review target; an agent invents a building association to satisfy the API. The finding has no complete action loop.

**Proposed fix/required edits:** choose in 12/01 either a minimal scoped case envelope with participant refs and an optional legacy building-case link, or explicitly limit the initial action loop to building-related findings and retain parcel cases as pending. The recommended envelope reuses existing history/review mechanisms rather than creating a second full case platform.

**Owner/closure:** FND bridge with FIND. Close with two parcels and no building: result → evidence → saved scoped review → reopen/history, without an invented building ID.

### ER-13 · Rights compatibility and shared-context applicability need explicit rules

**Severity/class:** High, D. **Evidence:** 12's exclusive-space/document rules; 16 assertions; 10 shared-clause traversal. Legacy rights do not establish a universal exclusivity or document-relevance classifier.

**Failure/impact:** ordinary overlapping rights are called competing ownership, an unreviewed easement clears a crossing, or every parent clause enters every unit packet.

**Proposed fix/required edits:** define a narrow rule table in 12/16: geometric relation, stated right category, target/extent, supplied validity, review state and result `possible_incompatibility` or `not_assessed`. PACK accepts only an explicit reviewed applicability edge. Unknown compatibility cannot auto-clear or auto-block legal ownership.

**Owner/closure:** RIGHTS/FIND; PACK consumer; human H2 for local terminology. Close on shared use, conflicting exclusive claim, overlapping valid-time assertions, unknown extent and irrelevant sibling clause fixtures. No broad legal-adjudication engine is required.

### ER-14 · Packet extraction has an unqualified renderer and unrealistic cumulative work envelope

**Severity/class:** High, D/R. **Evidence:** 10 E permits 50 pages, 40 million pixels per page and 120-second generation; [PDF helper](../../apps/web/lib/server/pdf-pages.ts) counts pages; [worker](../../services/geo/geo/tasks.py) has 110/120-second limits.

**Failure/impact:** many decoded images exhaust memory or the job dies while appearing eligible. Cropping PDF display bounds leaves hidden sibling text/attachments in the derivative.

**Proposed fix/required edits:** choose and pin the local renderer through a bounded spike; use per-page jobs/checkpoints, explicit decoded memory and cumulative pixel/work budgets, safe output rebuilding and final assembly. Start with one mixed page, not the maximum batch. In 10 distinguish omission, blocked-required-context and complete output.

**Owner/closure:** PACK; FND dependencies/job hooks. Close by inspecting generated raster/text/object layers, ZIP members and metadata for sibling sentinels, plus memory/time and restart tests. No whole-original fallback is permitted.

### ER-15 · Restricted-source access and separately released derivatives have conflicting interpretations

**Severity/class:** High, D. **Evidence:** 01 describes grant intersection and separately released derivatives; 10 download rechecks all contributing evidence grants; 13/18 permit public released projections.

**Failure/impact:** either public redacted output is unusable because viewers need private-source access, or a feature treats any AI summary as public. A revoked release remains served from a cached URL.

**Proposed fix/required edits:** define in 01/10/13/18 two explicit paths: private derivative inherits source restrictions; a separately reviewed release pins exact output bytes, redaction/applicability decision, audience, policy version and revocation state. Public viewers need the release grant, not private originals. No automatic downgrade of classification.

**Owner/closure:** FND policy; PACK/CITIZEN producers. Close with private source + approved public derivative, unauthorised unapproved derivative, release revocation and cache invalidation. Revocation prevents future service access; it cannot recall bytes already downloaded by an authorised user.

### ER-16 · Upload, source-promotion and notification outcomes need durable lifecycle semantics

**Severity/class:** High, C/D/R. **Evidence:** 13 upload/acceptance flow; 14 resumable intake; [receiveCaseDocument](../../apps/web/lib/server/source-cases.ts) extracts before saving its receipt; notification idempotency is described but transport acknowledgements are not.

**Failure/impact:** closing a browser loses a pre-receipt operation, accepted quarantine bytes are duplicated as unrelated sources, or retry after an uncertain mail response creates duplicate messages while the UI promises exactly once.

**Proposed fix/required edits:** 13/14 must retain a bounded upload receipt before extraction, hash-bound quarantine verdict, idempotent promotion linkage and orphan cleanup policy. Add explicit withdrawal/clarification/finalization commands. Use at-least-once notification processing with deduplication and provider idempotency where supported; document uncertain delivery rather than promising universal exactly-once email.

**Owner/closure:** CITIZEN/INGEST; FND receipt/storage; DEPLOY transports. Close with interruption at each transition, scanner outage, same bytes/different submission intent, accepted-source linkage and mail acknowledgement loss. Content deduplication is not evidence or ownership deduplication.

### ER-17 · Invalid or stale selection can broaden the action scope

**Severity/class:** High, C/D/R. **Evidence:** 99 already notes the invalid-record issue; [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), [useBlock](../../apps/web/features/officer/block/useBlock.ts) use fallback context in relevant paths.

**Failure/impact:** an invalid unit URL falls back to a building-wide export, or rapid switching shows the old unit's document/actions under the new header. The warning exists but is not an early acceptance gate.

**Proposed fix/required edits:** in 99/01 define explicit `invalid_selection` and `selection_generation`; refuse scoped actions until exact parent/world/record validation succeeds. Pin a packet plan to its original target even while browsing another property. Filters may hide the selected object but must not silently replace it.

**Owner/closure:** UI, FND server validation. Close with invalid unit/area/world/source links, delayed A response after selecting B, back navigation and filters. Header, map pick, evidence and mutation payload must agree exactly.

### ER-18 · Cache keys and invalidation do not yet implement the proposed entitlement/snapshot model

**Severity/class:** High for public data, Medium for local performance; C/D/R. **Evidence:** 01/99 require scope/digest/access-view keys; [shared hooks](../../apps/web/features/officer/shared/hooks.ts) globally invalidate after mutations; existing resources were designed for a local operator.

**Failure/impact:** public rollout reuses a broader response, or every tile event reloads the whole scene/dossier and destroys progressive responsiveness. Old request completion repopulates a cleared cache.

**Proposed fix/required edits:** 99/01 define key composition and generation-aware invalidation; use dependency-specific invalidation for asset arrivals versus committed record changes. Abort/ignore outstanding responses after entitlement changes. Server authorization remains mandatory.

**Owner/closure:** UI cache/session owner with FND access-view version. Close with two-principal tests, revocation during a pending request, measured request counts during streaming, and no cross-target flash after navigation.

### ER-19 · Readiness needs a concrete policy and reproducible denominator

**Severity/class:** High, D. **Evidence:** 11 E defines dimensions and proposed precedence but no complete first policy or aggregate input manifest.

**Failure/impact:** two agents interpret `ready` differently; documents with no placement count as completed 3D; hidden or unknown requirements are counted as zero; dashboard clicks do not reproduce the displayed count.

**Proposed fix/required edits:** supply one demonstration technical policy with fact requirements, applicability, evidence purpose, check coverage and task-specific output in 11. Give each aggregate a manifest/filter and return the corresponding target set/cursor. Missing evidence is not negative evidence and provider absence is not no finding.

**Owner/closure:** READY; FND snapshot/access projection; H2 qualifies real local policy. Close with ten known targets, zero/unknown denominators, duplicate documents, one case touching two targets and identical card-to-list results.

### ER-20 · Historical comparisons lack a qualified historical composition adapter

**Severity/class:** High, D/R. **Evidence:** 15 E and existing [record history](../../apps/web/features/officer/register/RecordHistory.tsx); 01 generic resolver; current-only [scene service](../../apps/web/lib/server/spatial-core-scene.ts).

**Failure/impact:** a historic unit is rendered with new source geometry/rights or current placement. The comparison appears plausible but does not represent either recorded state.

**Proposed fix/required edits:** 15 must consume ER-05's manifests and explicitly report unavailable historic parts. Compare known quantities by definition/unit, not unknown-as-zero. Keep read-only lineage independent of optional write support.

**Owner/closure:** HISTORY with FND exact reads and UI overlays. Close by changing current data while reopening an old comparison and proving its referenced constituents remain exact; missing constituents cannot be replaced silently.

### ER-21 · Mapping drift and answer grounding have limits that are not mechanically testable as written

**Severity/class:** High, D/R. **Evidence:** 14 E2/J requires detecting changed semantics with the same header; 18 E validates references but allows generated factual prose.

**Failure/impact:** values remain plausible after an undocumented unit change and the mapper cannot detect it; a cited answer reverses the source meaning even though the citation ID is valid.

**Proposed fix/required edits:** 14 must qualify mappings by source-family/schema/declared semantics, run invariant checks and route ambiguous cases to review. Undetectable source changes require provider/version confirmation, not a universal drift guarantee. In 18 prefer typed service facts and deterministic templates for measurements/status; separately evaluate generated explanations for entailment and unsupported claims. Extraction and interpretation remain distinct.

**Owner/closure:** INGEST/ASSIST, DEPLOY gateway. Close with held-out source families, deliberately contradictory metadata, undetectable-change cases labelled uncertain, injected instructions and wrong-but-cited answers. Three to ten samples are bootstrap, not demonstrated generalisation.

### ER-22 · Deployment qualification remains an external and operational gate

**Severity/class:** High, E/R. **Evidence:** 19 E; 01 F2; existing [compose](../../compose.yaml), [config](../../apps/web/lib/server/config.ts) and [Nous provider](../../apps/web/lib/server/officer-ai-provider.ts).

**Failure/impact:** a new Sarvam gateway is controlled while old calls, browser tiles, logs, backups or a remote MCP response cross the declared boundary. A standalone YAML lacks a proven web/dispatcher build or restore path.

**Proposed fix/required edits:** 19 must enumerate actual entrypoints, images, destinations and evidence required for each profile; keep current local setup unchanged. Pin capabilities, budget and no-fallback behavior. Check every API and server-rendered source/scene route before public activation. Provider documentation is not an environment audit.

**Owner/closure:** DEPLOY/FND; H3 accountable owner. Close per environment with live synthetic-data egress/identity/scanner/restore tests and approved provider terms. Never label a configured region, hash or endpoint as residency proof. Local no-AI implementation is not blocked.

### ER-23 · Foundation/integration roles are too broad for a useful first delivery

**Severity/class:** High, D. **Evidence:** 00 F0/F1 execution order, 01 ownership table, 99 UI stages. FND owns many shared backend seams and UI owns almost every final mount.

**Failure/impact:** many agents produce isolated modules while two owners become a queue; the first usable map is delayed by general abstractions, migration machinery or public auth.

**Proposed fix/required edits:** change 00/01/99 execution proposal to the thin slice in section 10. Limit initial concurrency to two or three bounded owners, establish a small shared contract and integrate continuously. Publish a patch-request protocol with exact base SHA, affected interface and acceptance evidence. Expand interfaces only as a proven second consumer requires them.

**Owner/closure:** lead/FND/UI. Close when D0's active map→unit→evidence→packet works through real services before more feature branches launch. A folder of passing mocks is not this milestone.

### ER-24 · Acceptance does not separate visual proof, numeric truth and ML generalisation

**Severity/class:** High, D. **Evidence:** feature J sections and 99 final demos. Good negative scenarios exist, but no shared independent expected-output pack, data-version pin or quantitative visual/performance baseline is delivered.

**Failure/impact:** tests assert values generated by the implementation itself, evaluate training data as test data, or accept a screenshot unrelated to saved records. More chunk tests of one CSV do not prove unfamiliar-schema adaptation.

**Proposed fix/required edits:** bind each feature J to section 3.5 and sections 8–11. Keep synthetic exact oracles, real-source interpretation checks, measured UI tests and held-out ML evaluation separate. State unsupported profiles explicitly; do not conflate source quality with application correctness.

**Owner/closure:** each feature owner supplies tests; a separate reviewer checks expected values. Close on reproducible manifests, independent oracles, actual service/browser evidence and recorded limitations—not on test count alone.

### ER-25 · Cross-document gate wording can force unnecessary dependencies or false completion

**Severity/class:** Medium, D. **Evidence:** 18 permits native F1 assistance while 99 UI2 groups qualified native assistance after F2; 14 needs FIND reconciliation while 00's INGEST dependency cell omits it; 99's primary journey includes citizen recording before initial overall acceptance.

**Failure/impact:** native local help is unnecessarily delayed, or ingestion says review-ready without the required check provider; teams wait for public rollout to demonstrate a local officer result.

**Proposed fix/required edits:** distinguish local native versus remote/public gates in 00/18/99. Add FIND as a dependency for INGEST's completed cross-chunk assessment, not parsing/preview. Split initial local, expanded workflow and public release acceptance. Mark optional features disabled, not fake-complete.

**Owner/closure:** lead reconciles 00/14/18/99 with FND/UI. Close when one gate/dependency table drives each assignment and an unavailable provider prevents only its specific conclusion/action.

## 7. Explicit edge-case verification matrix

The tests named here are proposed test IDs, not scripts already present. Each row supplies a trigger, observable behavior, affected code/contract and closure issue.

| Test | Trigger | Expected behavior / oracle | Contract or code / issue |
| --- | --- | --- | --- |
| EC-01 | One building intersects two parcels | One building ID, two independently reviewed parcel relationships; no automatic ownership inference | Target/relations; 01/16; ER-04/13 |
| EC-02 | Two buildings occupy one parcel | Distinct building IDs; no parcel-to-building one-to-one assumption | Identity adapter; ER-04 |
| EC-03 | Same flat label occurs in two buildings | Explicit match alternatives; no automatic document attachment | Resolver/submission; ER-04/17 |
| EC-04 | Same source feature arrives in two overlapping tiles | One canonical source/object mapping, two display placements only as needed | Chunk/entity index; ER-07/10 |
| EC-05 | Polygon has a courtyard or multiple disjoint parts | Preserve supported rings/components; unsupported operation is explicit | Geometry bridge; ER-11 |
| EC-06 | Invalid/self-intersecting ring | Quarantine that geometry with source locator; preserve original and unaffected records | INGEST/FIND; ER-08/11 |
| EC-07 | CRS missing or axes swapped | No guessed placement; request specific reference; orientation test fails visibly | Frame adapter; ER-02/11 |
| EC-08 | Relative height mixed with NAP/other absolute elevation | Reject analytical comparison until a supported transformation exists | Snapshot/vertical refs; ER-05/11 |
| EC-09 | Basement, mezzanine and unequal storeys | Labels and supplied lower/upper intervals drive geometry; no floor-index × 3 m | D0/UI; ER-03/11 |
| EC-10 | Duplex footprints differ between floors | One space identity, supported per-level components; no filled envelope between unrelated extents | RIGHTS/geometry; ER-11 |
| EC-11 | Identical XY, non-overlapping Z | Zero positive shared volume; contact only where boundaries meet | FIND; oracle O-02; ER-11 |
| EC-12 | True prism overlap | Intersection area 10 m² and volume 20 m³ in O-01 | FIND/IMPACT; ER-24 |
| EC-13 | Road centreline with no width/land polygon | Context alignment or unassessed road-land test, not recorded encroachment | FIND/D3; ER-11/13 |
| EC-14 | Accuracy bound exceeds a small crossing | Show uncertainty-sensitive result, never statistical certainty from arbitrary epsilon | FIND; ER-13/24 |
| EC-15 | One document names two units on one page | Approved unit-only extract plus applicable shared context; sibling sentinel absent everywhere | PACK; ER-14/15 |
| EC-16 | Several duplicate documents support one fact | Evidence coverage does not increase by file count | READY; ER-19 |
| EC-17 | Missing page or unstructured locator | Omission or blocked-required-context; never whole-file fallback | PACK; ER-14 |
| EC-18 | Source replaced after plan/review | Reject stale unexecuted decision or retain exact historical output with explicit status | Manifest/receipt; ER-05/06/20 |
| EC-19 | Uploaded claim contradicts recorded information | Preserve proposal and source; review required; no immediate registry rewrite | CITIZEN/RIGHTS; ER-13/16 |
| EC-20 | Malware/active content/scanner outage | Keep quarantine; deny inline preview and source promotion | Upload gateway; ER-16/22 |
| EC-21 | Two reviewers accept different updates concurrently | One expected-version commit succeeds; stale operation reports conflict without lost history | Tx command; ER-06 |
| EC-22 | Missing evidence versus explicit contrary evidence | Distinct needs-input and disagreement states; neither becomes zero risk | READY/FIND; ER-19 |
| EC-23 | Rapid A→B selection with A response delayed | B header, map, source and actions remain consistent; A response is ignored/cached under A only | Selection generation; ER-17/18 |
| EC-24 | Filter hides selected object | Show selection hidden/offer clear or reveal; no substitution | UI state; ER-17 |
| EC-25 | Invalid unit/retired/deleted deep link | Explicit mismatch or historical retired view; broad export disabled | Register routes; ER-17/20 |
| EC-26 | Permission revoked while download/AI/read pending | Future reads denied, in-flight response suppressed where possible, caches cleared; already received bytes cannot be recalled | Access views; ER-15/18/22 |
| EC-27 | Extraction succeeds but placement/geometry fails | Retained extracted record remains usable; spatial capability stays unavailable | Stage result union; ER-04/07 |
| EC-28 | Worker dies and old attempt finishes late | Only current fenced attempt applies; no duplicate records or resurrection | Jobs; ER-09 |
| EC-29 | SSE disconnect, duplicate, expired cursor | Idempotent replay or explicit reset to consistent snapshot; no missing accepted state | Events; ER-10 |
| EC-30 | Tile replaced or removed after correction | Old render asset is evicted by manifest update; selection follows canonical ID or explicit retirement | Scene delta; ER-07/10 |
| EC-31 | Byte/pixel/vertex budget exhausted | Specific stage pauses/rejects with receipt; no silent truncation or auto-spend | Workload profile; ER-08/14/21 |
| EC-32 | Unreviewed shared-access claim intersects a flat | Explain both assertions; claim cannot automatically clear/block legal ownership | Rights compatibility; ER-13 |
| EC-33 | DDA PDF neighbouring fields merge during extraction | Row 22 retains Block NA and Pocket E, not an invented merged value | D4 parser oracle; ER-01/24 |
| EC-34 | Document instructs the AI to reveal other properties | Instruction remains untrusted content; tools and answer scope unchanged | ASSIST gateway; ER-21/22 |
| EC-35 | Same headers, undocumented plausible unit change | Do not claim guaranteed detection; mapping applicability requires confirmation or explicit uncertainty | INGEST recipe qualification; ER-21 |
| EC-36 | Readiness card clicked after concurrent update | Open same manifest/filter or show stale snapshot and refresh; count/list never silently disagree | Scope/cursor; ER-05/19 |

Not applicable to the first milestone: nationwide federation, general non-prismatic solid booleans, statutory adjudication, excavation certification, a new mobile app and autonomous legal publication. Keep their unsupported capability explicit instead of adding speculative infrastructure.

## 8. Useful end-to-end outcomes, not component completion

| Capability | Required complete path | Incomplete substitute to reject |
| --- | --- | --- |
| Visual property exploration | Preserved pack → stored source/identity → actual geometry → active Studio pick → exact record/evidence → reload and reopen | Textured screenshot, separate showcase or hard-coded inspector |
| Evidence packet | Exact target → qualifying pointers → reviewed extraction plan → job/storage → inspected artifact → authorised download | ZIP of every original attached to the building |
| Readiness | Named policy + pinned inputs → reasons → matching filtered queue → exact next action | Coloured score with no input or missing-data explanation |
| Findings | Qualified check → measured result/coverage → exact participants → evidence → saved review action | Red polygon with no scoped case or sources |
| Citizen contribution | Find/review target → private durable upload → clarification → reviewed proposal → linked actual outcome | Public upload form with no review or own-status isolation |
| Ingestion | Real receipt → qualified mapping → persisted partial output → useful preview → dependencies reconciled → reviewed coherent group | Streaming log or animation, followed by one unbounded final payload |
| History/rights | Exact revisions/assertions → readable difference/relationship → evidence → supported review action | Current records labelled as a historical timeline |
| Impact | Saved proposed bounds → qualified spatial query → coverage/gaps → exact affected spaces → retained report | Green empty-result route presented as safe |
| Assistance | Authorised service facts → grounded explanation → exact evidence or existing action screen | Generic chatbot trained on the project description |
| Deployment | Known configuration → actual boundary tests → safe capability state → working fallback/restore | A country flag and a vendor name |

## 9. Visual-result contract and measurable UI gates — proposed

### 9.1 The scene the team should aim to deliver

The first accepted scene should be a bounded neighbourhood with recognisable, non-identical building shapes, readable road/context geometry and purposeful lighting. Selecting a supported building should isolate it without losing location; selecting a level should expose its real/authored source-supported outline and units; selecting a unit should show matching source evidence and one useful action. Basement/section mode should make vertical relationships understandable, not merely hide the ground plane.

Use a clear semantic scene as the default work view. Optional photographic context is a separate layer. It must not obscure selection or supply invented evidence. Unknown geometry can coexist as an outline or unavailable record, without making all surrounding supported geometry ugly or forcing every building into a box. Materials, lighting and non-semantic decorations may improve presentation; they must never change analytical areas, volumes, readiness or documented floor counts.

### 9.2 Eight required shot/interaction cases

| Shot | Data | Required on-screen result | Required behavioral proof |
| --- | --- | --- | --- |
| V1 Neighbourhood | D0; separate D1 area | Varied supported silhouettes, clear context, restrained labels and readable depth | Pan/orbit/zoom work over the actual map; no full-screen reference image used as geometry |
| V2 Building selection | D0/D1 | Exact outline highlighted, compact identity and availability status | Map pick and record ID agree; missing interiors have an honest action/state |
| V3 Vertical stack | D0 or qualified D5 | Basement/mezzanine/unequal levels; selected unit visibly distinct | Exploded offsets are display-only; original lower/upper values and measurements unchanged |
| V4 Section/underground | D0 | Basement, surface and upper unit distinguishable in one controlled view | A vertically separated pair is not highlighted as positive-volume overlap |
| V5 Evidence action | D0 mixed source; D4 table | Correct unit header and highlighted relevant source location beside the map/register | Packet plan cannot silently broaden after navigation; sibling data absent from derivative |
| V6 History | Two D0 revisions | Before/after/difference labels, clear changed geometry or unavailable state | Same camera and explicit manifests; no current-source fallback for old snapshot |
| V7 Progressive review | Chunked D0/D3 after INGEST gate | Usable placed objects plus visible unresolved list, not only a progress bar | Selected entity survives out-of-order updates, reload and replay |
| V8 Narrow/error state | D0, 390×844 | One readable sheet, accessible actions, coherent missing-data/asset failure | Touch scrolling does not block map gestures outside sheet; keyboard/numeric alternative works |

Capture these on the active officer route at 1440×900, 1024×768 and 390×844 as applicable, with fixed data, camera, fonts, theme and viewport readiness. Read/hash the referenced mock and baseline assets before comparison. Historical T058 captures are reference material, not proof of the current run. Image-generation previews do not satisfy runtime acceptance.

### 9.3 Initial performance targets to qualify, not claimed measurements

Use a declared reference machine/browser/GPU and record cold/warm runs separately. Proposed first workload: 25–100 exterior buildings, up to 30 detailed spaces, two bounded source previews and one analysis overlay; no whole-city preload. Begin with a 25 MiB visible-geometry transfer budget and measure before adjusting. These are proposed product budgets, not existing compiler limits or provider guarantees.

Suggested gates for the local reference setup: useful first view within 8 seconds on a cold start after services are ready; cached selection feedback within 100 ms; steady desktop orbit at least 30 fps under the chosen pilot workload. Mobile performance must be measured separately, with reduced shadows/detail and no claim inferred from desktop emulation. Report p50/p95 frame and interaction times, first-view timing, loaded asset bytes, active WebGL contexts, peak JS/GPU estimates and requests during streaming.

After ten building/world/drawer switches, resources should return to a stable plateau rather than grow monotonically. Hidden views should stop unnecessary rendering. Essential actions remain usable at 200% zoom and with reduced motion. A test running with software WebGL qualifies that environment only; it is not proof of performance on the user's GPU or phone. If the target is missed, reduce resident content/effects first; do not hide data errors or silently alter analytical geometry.

### 9.4 UI acceptance separates three judgments

**Geometry correctness:** IDs, coordinate transforms, supported shapes, measurements and source linkage match independent oracles. **Interaction correctness:** selection, permissions, navigation, gestures, failure and retry work through real services. **Visual quality:** silhouettes, composition, contrast, materials and density are reviewed against locked references and the intended task. Passing any one does not substitute for the others.

## 10. Prioritized closure and revised agent execution

### 10.1 What must happen when

| Timing | Required closure | What it unlocks |
| --- | --- | --- |
| Before launching a broad feature swarm | Choose D0 and D1, define the first active-product outcome, freeze minimal scope/target/job/read contracts and shared owners; ER-01/03/04/23 | Compatible small tasks rather than incompatible speculative modules |
| Before coordinated recording or exact historical/derived outputs | ER-05/06 transaction and snapshot contracts, including failure tests | PACK/FIND/RIGHTS/CITIZEN/HISTORY live integration |
| Before claiming richer external 3D support | ER-02 adapter/decoder/picking spike and data preservation | D1 real roof geometry; optional D2 context |
| Before progressive ingestion integration | ER-07–10 draft assets, bounded workload, fencing and snapshot/cursor behavior | Actual selectable streaming review |
| Alongside each feature | ER-11–21 applicable spatial, extraction, selection, access and grounding tests | Useful complete feature, not just interface compliance |
| Before public or India-private deployment claims | ER-15/16/18/22 and responsible H3 approvals | Qualified citizen/public MCP or private controlled deployment |
| Safe to defer | External MCP, general IFC/solid processing, broad ML tuning, new split/merge editor, city-scale processing and high availability | Protects the first useful result from scope expansion |

### 10.2 Execution waves

**Wave A — bounded proof, not platform construction.** DATA prepares D0 and one actual D1 sample; FND and UI agree the smallest target/source/scene seam. Maximum initial concurrent work: two implementation owners plus one bounded data/verification task. Conduct S1–S4 below before committing to expensive adapters or broad foundations.

**Wave B — first useful integrated slice.** In one isolated local integration environment, reuse normal ingestion/record mechanisms for D0. Deliver active map → selected building → supplied floor/unit → source inspection → one scoped packet → reload. Add minimal readiness reasons, not the whole area dashboard. No public identity provider or LLM is necessary to prove this slice.

**Wave C — genuine parallel work.** After the shared producer/consumer tests and Wave B pass, PACK hardening, READY/FIND and bounded INGEST can proceed in separate owned modules. UI integrates each completed leaf serially; FND applies narrow shared patches. Keep at most three unfinished integration-dependent workstreams. HISTORY/RIGHTS follow their actual interfaces; IMPACT reuses the qualified geometry provider.

**Wave D — authentic data and intelligence.** Qualify one D5 planned building or permitted equivalent. Improve the selected ML modality against D6 and schema mapping against independent source families. Compare source interpretation, runtime and unsupported cases rather than counting AI calls. D3 tests scale separately from the detailed-unit scene.

**Wave E — public and deployment expansion.** Qualify F2, public projections, quarantine and environment boundaries. Then activate citizen access and, separately, remote public-only MCP. Native read-only assistance can be added earlier over working local services and a configured permitted model/template route.

### 10.3 Shared patch and merge protocol

Each owner uses an isolated worktree/branch from a recorded integration SHA. A shared patch request contains: consumer, required interface version, exact existing/proposed paths, compatibility reason, test fixtures, migration/dependency impact and desired observable behavior. The sole shared-file owner applies the patch. Do not let two agents independently edit a router, lockfile, scene adapter, global store or base migration.

Merge prerequisites before consumers; run contract and live slice tests after each integration. Keep feature flags unavailable until their real producer is connected. Return actual changed paths, commits, tests executed, artifacts and remaining gates. Do not mark a mocked consumer finished. Never overwrite populated repository data or refresh committed snapshots just to obtain a green run.

FND should not implement future platform abstractions without a present consumer. UI should not create a mock backend to hide an unavailable FND service. Escalate a blocked seam with a concrete small patch, not another general architecture document.

## 11. Bounded experiments and independent oracles

### 11.1 Necessary spikes

Every spike ends with evidence, a decision and a fallback; no open-ended research assignment.

| Spike | Question and method | Decision threshold | Fallback |
| --- | --- | --- | --- |
| S1 Real geometry | Preserve one D1 JSON response; decode transform/LoD and display through active viewport with source ID picking | Sloped roof preserved; decoded bounds/IDs correct; null floor count remains null | Display asset-only exterior with explicit non-analytical status; do not flatten to fake levels |
| S2 Visual product | Load bounded D0 through live services; perform V1–V5 and V8 on active routes | Exact target/source linkage and interactive scene; comparable captures reviewed | Fix the existing scene/selection seam before adding features |
| S3 Atomic command | Inject failures around legacy commit, receipt and outbox using isolated DB | One commit receipt/event or full rollback; no nested-lock hang | Narrow the mutation path until a same-client adapter is proven |
| S4 Scoped extraction | One mixed-property PDF page, two sentinels and applicable shared clause | Desired pixels/content only; no hidden sibling data; source unchanged; bounded memory/time | Start supported text/CSV extraction; PDF stays blocked, no whole-file fallback |
| S5 Progressive durability | Three real worker chunks, reversed completion, one failure, restart and SSE reconnect | Accepted manifest matches fresh read; no lost/duplicate/reanimated objects | Poll durable status and load a coherent completed chunk until replay is qualified |
| S6 Indian plan sufficiency | Retrieve one D5 plan+section+site bundle; inspect identifiers, units, level applicability and placement | Supported building/level relations and explicit unknowns; permission recorded | Permitted campus plan or D0; real cadastral claim remains blocked |
| S7 Source adaptation | Separate source-family train/development and held-out records; inject ambiguous metadata | Supported fields/units/IDs correct; uncertain semantics rejected; cost measured | Manual reviewed recipe with deterministic execution |
| S8 Environment | Synthetic restricted-labelled workflow with denied external destinations and model outage | No unapproved requests; no-AI workflow still works; restore is consistent | Stay local-only; no India-private/public qualification badge |

Spikes S1–S8 are proposed implementation experiments. The fact that this audit defines them is not a pass result.

### 11.2 Checks actually performed during this audit

Independent calculations were run with Python/Shapely, not the repository geometry implementation:

| Oracle | Inputs | Computed result |
| --- | --- | --- |
| O-01 Positive prism overlap | A footprint `[0,0]–[10,10]`, B `[9,0]–[19,10]`; Z intervals A `[0,3]`, B `[1,4]` | Intersection area **10 m²**, positive volume **20 m³** |
| O-02 Vertical separation/contact | Same footprints, Z A `[0,3]`, B `[3,6]` | Positive overlap volume **0 m³**; touching level is not positive volume |
| O-03 Courtyard preservation | 10×10 m outer square minus 2×2 m courtyard | Area **96 m²** |
| O-04 Source transform arithmetic | Transcribed D1 vertex `[0,8188,919]`, scale `[0.001,0.001,0.001]`, translate `[91447.4215,398435.80225,0.0005041809082015902]` | Decoded EPSG:7415 coordinate approximately `[91447.4215,398443.99025,0.9195041809082016]` |

O-04 uses values transcribed from the inspected provider response; it is not an archived original payload. It verifies the oracle arithmetic, not a parser, reprojection, renderer or field accuracy. Tests must preserve the actual acquired bytes separately. Apply quantization once; any further coordinate conversion needs its own qualified reference operation.

The DDA row in D4 was visually checked using the PDF page image. Its interpretation remains bounded to the visible source columns. No OCR accuracy or complete document extraction result is claimed.

### 11.3 Verification commands and new tests

Existing commands remain those in [package.json](../../package.json), including `pnpm typecheck`, `pnpm test:studio`, `pnpm test:registry`, `pnpm test:register-scope`, `pnpm test:register-exports`, `pnpm test:api` and `pnpm test:e2e`. Service tests require an explicitly isolated configured stack. They were **not run by this audit**.

Proposed new test locations: `tests/usp-data-pack.test.ts`, `tests/usp-contract-producers.test.ts`, `tests/usp-snapshot-consistency.test.ts`, `tests/usp-command-atomicity-integration.ts`, `tests/usp-draft-scene-integration.ts`, `tests/e2e/usp-visual-slice.spec.ts`, and feature tests already named in 10–19. Run new files through the installed `tsx`/Playwright/pytest mechanisms only after those files exist. No `pnpm test:usp-*` script is claimed to exist.

Acceptance reports must name code SHA, pack/version/hash, environment, command, actual result, output manifest and unsupported states. Distinguish unit mocks, real service integration, browser behavior, external provider compatibility and user observation. Source-dependent accuracy metrics need independent labels; do not compare a model to its own output or split adjacent chunks of one delivery and call that independent-source generalisation.

## 12. Necessary human inputs and exact agent responsibilities

**Agents, not teammates, should:** obtain permitted open-data samples, preserve originals/hashes, inspect schemas/CRS, prepare de-identified fixtures, implement adapters, build tests, measure rendering and write integration patches. DATA is an agent role, not a request that a nontechnical teammate solve GIS architecture.

**H1 matched real evidence:** a teammate/record holder may obtain the D5 drawing trio or a permitted campus/building plan+section, and relevant document context. Required output is a small manifest listing file, publisher/holder, permitted use, drawing date/revision, named building/levels, supplied units/controls and unknowns. Private originals stay in restricted storage. Missing real evidence blocks only the real-data outcome, not D0 implementation.

**H2 review policy/context:** show a reviewer the proposed D0 cases and ask what evidence applies, what remains unknown and what the next action should be. Distinguish an interview preference from a documented rule. READY/PACK/RIGHTS agents translate confirmed answers into a versioned policy and tests.

**H3 deployment:** the responsible owner authorises IdP, infrastructure, model/backup/log locations, scanner and any released public projection. Credentials go through secrets configuration, not Git or chat. Mail absence does not block in-app receipts; missing public identity/quarantine does block public uploads.

**H4 usability:** after Wave B, observe a reviewer selecting a unit and producing a scoped packet without coaching. Later observe a contributor submission only after its gate. Record wrong-property selections, misunderstood statuses and dead ends; engineers reproduce and fix them. Human feedback supplements, not replaces, automated geometry/security checks.

## 13. Exact remediation edits proposed, not silently applied

| Document | Sections to revise | Concrete edit |
| --- | --- | --- |
| 00 | Execution matrix, gate order, delivery status | Link this audit; add pack ownership and thin visual slice; distinguish historical documentation checks from open readiness issues; align dependencies |
| 01 | 3, 5, 6, 7, 9 | Freeze minimal scope/job/result schemas; define manifests/cursors and same-client commit adapter; resolve derivative release and selection generation |
| 10 | E, I, J | Qualified extraction/release plan; per-page/cumulative budgets; D0/D4 tests and actual leakage artifacts |
| 11 | E, J | Concrete demonstration technical policy, denominator/target-set manifest and action-to-list equality |
| 12 | E, J | Parcel-only case bridge, rights applicability table, supported geometry profiles and numeric oracles |
| 13 | E, I, J | Targetless receipt, quarantine/promotion lifecycle, explicit commands and notification delivery uncertainty |
| 14 | C, E, H, J | Reuse existing 3D Tiles output; add durable draft producer; stage budgets/fencing; FIND gate for completed reconciliation; honest drift limits |
| 15 | E, J | Exact historical manifests, unavailable-source behavior and actual stored-revision tests |
| 16 | E, J | Per-component duplex geometry, accepted assertion authority, compatibility/applicability and shared-clause tests |
| 17 | C, E, J | Qualified prism/utility profile matrix, workload bounds and partial inventory tests |
| 18 | E, H, J | Typed-fact grounding, entailment evaluation and native F1 versus remote F2 gates |
| 19 | E, I, J | Actual build/route/destination inventory and measured per-environment qualification; keep local milestone independent |
| 90 | H1, H4 | Specific D5/D7 sample request outputs and early active-UI observation |
| 99 | 4, 5, 8, 9 | External asset lane, V1–V8 visual contract, performance/reference qualification and first local slice before public flow |

Only this audit and the master-index link/status annotation are intended changes in this audit task. Feature scopes and application code remain unchanged. Original feature authors should apply the above changes deliberately, one owned document/seam at a time, after the relevant decision or spike. Preserve this issue history and append evidence/status changes rather than deleting unresolved findings.

## 14. Completion and remaining limitations

The audit covers each original document, shared producers/consumers, source availability, useful end-to-end results, spatial/document/security/job/UI edge cases, visual acceptance and agent sequencing. It supplies a concrete closure path for each material issue found.

It does **not** certify that all possible defects have been eliminated, that a complete authentic Indian vertical-rights dataset has been acquired, or that runtime feasibility has been proven. Provider pages and a sample payload were inspected; full external archives, RERA drawing contents, authenticated land records, actual GPU performance and deployed boundaries remain unqualified. The isolated oracle calculations establish test expectations only.

**Recommended next assignment:** FND/UI/DATA jointly close the minimal contracts and D0/D1 acquisition/visual spikes, then deliver the real local map→unit→evidence→scoped-packet slice. Do not launch the whole feature matrix until that slice is demonstrably useful.
