# From 2D ULPIN to an area-wide 3D property registry

Status: theoretical product and implementation plan; no features are implemented by this document. This is the proposed primary product direction. It extends BLOCK_DEMO_PLAN.md and retains its independently calculable geometry scenarios, subject to the additions below.

## 1. Product purpose

Start with identified surface parcels and progressively document the buildings, spaces, infrastructure and recorded rights above and below them. The main product is one shared village/neighbourhood map and a persistent registry. Model generation is a preparation step within that product.

The central workflow is:

**Open area → select/import 2D parcel → link existing ULPIN → upload supporting documents → resolve missing/conflicting information → inspect proposed 3D boundaries → validate and review → record on shared map.**

An official ULPIN is a parcel identifier, not a complete building model or a substitute for parcel boundary data. Preserve it exactly as supplied, with its issuing/source context and verification status. Retrieval from government systems requires an available authorised integration; typing an identifier must never pretend to download geometry that is unavailable.

Official background: https://dolr.gov.in/en/national-digital-policy-release/

## 2. What the administrator sees

- Default home: the whole selected area, with parcel outlines, building footprints, roads and public land. The area extent stays fixed as properties are added.
- A compact area selector, search field, Plan/3D switch, Add parcel action and Conflicts action. Filters and the selected record appear in drawers only when needed.
- At area scale, label parcels, streets and buildings. Reveal floors/rooms on selection or close zoom. Avoid displaying every identifier and room label simultaneously.
- Select a parcel to see its official ULPIN, source, mapped boundary and 3D coverage: surface only, documents received, draft extracted, needs information, ready for review or recorded.
- Show completeness separately from findings. A parcel with missing height information is incomplete, not conflict-free. A recorded exterior envelope does not imply verified interior floors or rights.
- From the selected parcel, use **Add 3D details** to upload more evidence into that parcel's preparation. Never start a new area merely because another building's documents are uploaded.
- Select a building to navigate floors and spaces. Select a space to inspect its prototype ID, related official parcel IDs, elevation limits, geometry, recorded rights, evidence and history.
- Search an official ULPIN to highlight its parcel and all linked 3D records. Search a prototype space ID to locate exactly that space. Party searches use explicitly recorded associations.
- Preserve direct record links, Locate, above/below inspection, correction drafts and downloads.

The map must distinguish observed/recorded features, proposed changes, selection and findings. Colours are accompanied by labels/icons. It must remain useful without opening a preparation workspace.

## 3. Map and coordinate foundation

Start with one synthetic 250 × 250 m neighbourhood, adapted from BLOCK_DEMO_PLAN.md. It can demonstrate the village workflow without claiming village-scale operational capacity. Retain the 100-current-spatial-unit limit for the first release.

All parcels and uploads in this area share one declared local-metre frame and vertical benchmark. Build the map from explicit parcel, road, public-land and building geometry; a geographic basemap is optional context, not the source of cadastral measurements.

For future real village data, add an explicit geospatial ingestion stage: supported source CRS, surveyed boundary coordinates, validated transformation into the area's metric frame, and vertical datum alignment. Do not convert unrelated local drawings into a shared frame by renaming their frame fields. Local drawings need adequate control points and an explicit placement transform; scale alone does not establish their position or orientation within a village.

This stage has not yet been implemented as a generic GIS importer. Do not promise an arbitrary government file will upload successfully. Publish the supported formats and any required conversion.

Terrain, sloping roads, complex roofs and non-prismatic underground networks are outside the first geometry release. Constant-height single-ring prisms remain the computational model. An unsupported feature stays visible as unsupported/incomplete evidence where possible; it is not silently approximated into an authoritative volume.

## 4. Parcel-first identity and data structure

Keep permanent application IDs separate from official identifiers:

- Area/site: persistent namespace and frame.
- Parcel record: permanent application ID, official ULPIN when genuinely supplied, original source reference, boundary revision and verification status.
- Buildings, floors and spaces: existing stable P/B/F/S allocation scheme and explicit relationships. Readable hierarchy is navigation, not encoded identity.
- Roads/public grounds: surface context and source-backed use/reservation attributes. Create a separate volumetric record only where supported lower/upper limits are supplied.
- Recorded rights: source-backed party/right associations, independent from physical geometry. Document extraction can propose associations but never establish ownership automatically.

A basement shared by two buildings or a corridor crossing multiple parcels retains one ID with multiple relationships. Changing its building/floor label or linked parcels does not mint another spatial identity. Boundary subdivision/merger requires explicit lineage, not silent replacement of official parcel IDs.

Synthetic fixtures leave official ULPIN empty and use conspicuous `DEMO-PARCEL-001`-style reference aliases to rehearse lookup. Do not manufacture official-looking ULPINs. The UI distinguishes missing official linkage from a genuinely supplied official identifier.

## 5. Assisted multi-document import

Accept supported images and PDF pages as a submission attached to a selected parcel or explicit group of parcels. Preserve originals, source revisions and checksums. Preview which documents are being sent to the configured cloud extraction service.

The proposed extraction pipeline is:

1. Inspect file type, render bounded PDF pages, preserve page numbers and reject unsupported/encrypted/unreadable inputs clearly.
2. Classify documents: site plan, floor plan, section/elevation, measurement schedule or rights evidence.
3. Extract candidate facts per document: labels, dimension annotations, units, floor names, floor repetition statements, height/elevation values and tentative boundaries in image coordinates.
4. Associate candidates with the selected parcels/buildings/floors. Ambiguous associations require confirmation; repeated room/floor names are not enough to merge records.
5. Compare measurements with compatible meaning, units, reference levels and document revisions. Retain disagreements explicitly.
6. Present a source-aligned boundary preview, missing fields and discrepancies for confirmation/correction.
7. Transform confirmed boundaries into the common metric frame using validated calibration/control data.
8. Generate the application spatial JSON/levels CSV through deterministic schema-validating code, then use the existing build/check/review pipeline.

Users do not author JSON/CSV. Keep one canonical structured draft and derive both files from it so they cannot disagree. AI responses are untrusted candidate data: validate their structure, values and referenced source locations. Extracted text is document content, not application instructions.

Each candidate fact keeps value, units, semantic type, source revision, page/region, extraction run/model and status (extracted, confirmed, supplied, disputed or superseded). Model confidence is only a prioritisation hint. Arithmetic, schema validation, coordinate transformations, geometry validity and intersections remain application calculations.

Nous Portal's current public recommendation identifies `stepfun/step-3.7-flash:free` as a free vision candidate: https://portal.nousresearch.com/api/nous/recommended-models . Its suitability for our plans is untested. Verify availability, authentication, limits and image/structured-output behaviour with a bounded benchmark before choosing it. Keep the model configurable and do not silently fall back to paid models.

Persist extraction runs and confirmed edits. Retry failures without duplicating records or overwriting operator corrections. Cloud extraction requires internet; persisted prepared inputs and the registry demonstration must continue working offline. An offline fallback may use manual preparation or clearly labelled saved extraction results from an actual prior run, never a pretend live model response.

## 6. Missing data and contradictory documents

Ask focused questions next to the relevant document, rather than one long form. Typical questions include:

- Which parcel/building does this drawing describe?
- What scale or control points place it in the area?
- Does this height mean clear ceiling height, slab thickness, floor-to-floor height or elevation above a benchmark?
- Where is the ground level relative to the shared benchmark?
- Which floors use this repeated plan?
- Are the basement/roof limits actually documented?

Missing geometry-critical information blocks the corresponding build or keeps it explicitly incomplete. Missing rights do not need to block recording a geometric record, but the record must say rights are unrecorded. One incomplete building should not block independently reviewable buildings in the submission; dependency checks determine what can proceed.

If one document says 3.0 m and another 3.2 m for the same measurement, show both source regions. The operator may select a supported value with a reason, supply revised evidence or leave it unresolved. Do not average values or assume newer means authoritative. Any demo assumption is explicit and remains visible in provenance/exports.

Document interpretation and discrepancy decisions have revisions. Any change invalidates dependent extraction confirmations, builds or review snapshots as appropriate. Current registry geometry remains unchanged while the replacement is unresolved.

## 7. Area-wide findings

The **Conflicts** action checks the selected area's known records and optional draft proposals. Its results identify the exact registry/draft revisions and disclose incomplete or excluded features.

Keep four categories distinct:

1. Document discrepancies: incompatible source claims about the same fact.
2. Geometric intersections: measured positive-area/positive-volume intersections, plus boundary contact separately.
3. Rule findings: e.g. a documented road reservation intersects a proposed building, or a footprint crosses a recorded public-land boundary. The applicable rule and source must be explicit.
4. Completeness issues: missing elevation, placement, evidence or unsupported geometry.

An overlap is not automatically a violation. Road and underground utility plan footprints may overlap validly at separate heights. Parcel/building containment, shared walls and a single shared-rights volume are not duplicate ownership conflicts. An actual building footprint outside its linked parcel is a review finding; software does not decide legal title.

For a 2D road/public-ground polygon without supported height limits, report a horizontal intersection in square metres and state that vertical impact is unknown. Do not invent a 3 m road/public-space volume. Source-backed volume reservations can support cubic-metre calculations.

Highlight blocking findings red, warnings amber and contact/incomplete status distinctly. Clicking a result focuses the affected records and exact calculated intersection, with source evidence and a correction/proposal action.

Compare current/current, each candidate/current and distinct candidate/candidate combinations explicitly. A replacement excludes its own old revision; alternative drafts are not simultaneous physical spaces. Use spatial indexing and existing Python calculations. Stale results cannot support a new commit.

## 8. Review and administrative use

Keep the existing lifecycle: prepare draft → build and check → review changes → record in demo registry. Reviews include geometry, rights, evidence, source decisions, affected neighbours and unresolved findings. Blocking errors prevent recording; warnings require written acknowledgement. Commits remain locked, stale-safe and idempotent.

Core administrator stories:

- Find a parcel using its existing ULPIN and see which above/below-ground spaces have been documented.
- Add building details to a surface-only parcel without duplicating the parcel or creating another disconnected site.
- Inspect occupants/claimants only through recorded rights and supporting evidence.
- Review competing measurement documents before changing vertical boundaries.
- Review a road/public-area proposal against known buildings and record the impact findings.
- Inspect an elevation-ordered stack at a point or run excavation intersections.
- Follow a permanent identifier through corrections, showing exactly which source and decision produced each revision.

Results describe known records and technical review; they do not certify clearance, decide ownership or issue an official 3D ULPIN.

## 9. Delivery order and demonstrations

1. **Parcel-first shared map:** area extent, surface parcels/roads/public ground, parcel reference lookup, coverage status, whole-area navigation and direct Add 3D details flow. Reuse existing registry geometry/reviews, minimise workspace exposure.
2. **Evidence and gap model:** document-to-feature association, candidate facts, source locations, discrepancy decisions and structured missing-data questions. Support manual confirmation before adding AI.
3. **AI extraction pilot:** test one free vision model on known plans, sections, a missing-height sample and a contradictory pair. Measure dimension/label errors and boundary agreement with authored ground truth. Do not claim general plan understanding from one successful image.
4. **End-to-end conversion:** confirmed extraction generates canonical build inputs, source-linked revisions and a reviewable draft in its existing area. Verify retries, invalidation and record identity persistence.
5. **Whole-area audit:** horizontal and vertical conflicts, public/road rules, exact highlights, proposal comparison and incomplete-audit reporting.
6. **Demo kit and rehearsal:** independent uploads in the same 250 m area, source files and root guide. Include a complete prepared offline dataset and a separate live AI extraction story.

Adapt the eight-building block fixture to include an explicit public-ground context polygon and its proposal scenario. Preserve its 75-volume baseline (public ground need not be a volume). Use independently specified geometry to calculate any new expected horizontal intersection; do not derive expected results from the code under test.

Demonstration sequence:

1. Open the populated surface map and select `DEMO-PARCEL-001`, clearly labelled as synthetic with no official ULPIN.
2. Upload its plan and section; inspect extraction; answer a deliberately missing benchmark/height field.
3. Resolve a second document's deliberately conflicting measurement, retaining the rejected candidate and written reason.
4. Build and record; show the building on the same map and locate a stable space ID and its parent parcel link.
5. Add another building from separate files in the same frame and show valid shared-wall contact.
6. Introduce the road proposal (150 m³) and floor correction (32 m³) from BLOCK_DEMO_PLAN.md; audit, inspect and correct without changing current records prematurely.
7. Demonstrate a public-ground horizontal intersection, distinguishing area from unknown vertical impact.
8. Demonstrate above/below and excavation with known expected results; show an unsupported/incomplete record is not declared clear.
9. Restart/offline-reopen the prepared demo and resolve the same identifiers, evidence and saved decisions.

Existing Nandan 8 m³ correction and 12/4 m³ excavation scenarios remain regression checks. Preserve legacy sources, URLs, histories and original downloads. A real official-ULPIN demonstration is a separate later exercise requiring a genuine identifier and its associated parcel data; it is not implied by the synthetic rehearsal.

## 10. Completion criteria and later scope

Complete when an operator can start from a surface parcel, upload documents, resolve missing/conflicting facts, review a computed 3D result, record it on a shared area map, and inspect area-wide findings through the UI. The user should never need to construct JSON/CSV or navigate unrelated workspaces for this story.

Proof includes stable IDs after correction/restart, no duplicate imports, unchanged current records before review, source-linked fact decisions, invalidation after edits, explicit unsupported inputs/frames, measured intersection results, and no false all-clear when coverage is incomplete.

Later scope: authorised government lookup integrations, real village GIS/CRS ingestion, terrain and richer solids, larger datasets/tiling/background audits, GNSS/DEM/LiDAR/BIM adapters, specialist extraction, authentication and official governance processes. Do not claim these are delivered by the first synthetic area demo.
