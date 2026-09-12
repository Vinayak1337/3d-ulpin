# 3D Property Registry — Product, Problem and Solution

**Document 1 of 4 · Consolidated baseline · 12 September 2026**

## How to use this document

This is the product source of truth: what we are proposing, who uses it, what information it needs, what each feature accomplishes, and where its limits are. It is a complete replacement for the scattered product explanations in the earlier conversation, not a patch to them.

Read [02_Modules_and_Architecture.md](02_Modules_and_Architecture.md) for software responsibilities and contracts. Use [03_Three_Person_Implementation_Plan.md](03_Three_Person_Implementation_Plan.md) for delivery ownership. Use [04_Product_Video_Production_Plan.md](04_Product_Video_Production_Plan.md) for the product video. Delivery assignments and video pacing do not redefine this product.

**Status:** proposed product and implementation scope. No completed application, secured dataset, deployment, practitioner study, legal authority, measured accuracy or live government integration is established by these documents.

## 1. The product in one paragraph

We are building two connected applications: an Android-first mobile app for fieldwork and administration, and a web workspace for preparing, reviewing and using three-dimensional property records. Both use one shared identity system, application API and registry. The platform connects each defined space to its boundaries, source evidence, recorded rights and relationships, review decisions and revision history. It helps people understand what supports a boundary, resolve incomplete or inconsistent submissions, and inspect what a proposed change affects before accepting a new record revision.

**Product promise:** turn plans, measurements and field observations into reviewable 3D property records, then maintain their consistency as evidence changes.

**Short description:** an evidence-linked 3D property review and registry system—not merely a city viewer, a floor-plan drawing tool, or a legal-title generator.

## 2. The problem we are addressing

### 2.1 One footprint can describe several different spaces

A surface parcel may support a multi-storey building, individual apartments, shared circulation, basement parking, and documented infrastructure spaces below ground. The wider original problem also includes elevated corridors and air-rights. A two-dimensional footprint alone cannot distinguish every vertical limit or relationship among these spaces.

This does not mean apartment ownership records do not exist. A parcel map, architectural plan, survey model and rights document already serve important purposes. The operational question is whether the particular space described by a record can be defined, checked against relevant evidence, reviewed and kept current in a coordinated workflow.

### 2.2 The tasks, not just the technology

| Practical question | Product response | Intended benefit to evaluate |
|---|---|---|
| Which exact space does this unit record describe? | A footprint and explicit vertical limits, with a declared boundary convention and reference system. | Less ambiguity than a unit label or floor number alone. |
| Why is this boundary here? | Open the relevant plan region, level record, measurement or alignment source directly from the boundary. | Less time searching through unrelated attachments. |
| What disagrees or is missing? | Version-bound findings and purpose-specific evidence requirements. | Fewer submissions that appear complete while missing important support. |
| What should happen next? | Correct the draft, clarify a source, request a measurement or return the submission. | Findings become work rather than unexplained warnings. |
| What else changes when a source is updated? | Dependent-unit list, proposed differences and stale-check indicators. | Fewer missed consequences of updates. |
| What is recorded above or below this location? | Permission-scoped vertical inspection and corridor queries with coverage information. | More understandable use of vertical records. |

These are product hypotheses, not completed user-research findings. A preparer, reviewer and relevant survey professional should validate them against real tasks before the pilot scope expands.

### 2.3 What this product does not solve by itself

The application cannot create missing measurements, infer unseen interiors from a roof image, guarantee that a document is truthful, decide contested ownership, confer title, or certify that undocumented underground space is empty. It can preserve evidence and uncertainty, provide useful spatial checks, and route a case to the people authorised to interpret it.

## 3. Existing approaches and our proposed distinction

The earlier research notes identify established capabilities in BhuNaksha, NAKSHA, ArcGIS Parcel Fabric, QField and specialist plan-to-3D products such as Netcad Yapınet. The cited materials describe cadastral records, surveying, 3D models, editing, history, validation or field collection. We have not performed a hands-on competitive benchmark. Those source descriptions must not be converted into claims that competing products lack all our features. See the source register at the end.

**Do not position the project as:** the world's first 3D cadastre; the first offline GIS app; the first system with audit history; or a replacement for every existing land-record platform.

**Position it as:** a focused, ULPIN-linked workflow connecting boundary evidence, field evidence requests, explainable review findings and controlled updates for vertical property records.

Three capabilities define that workflow.

### 3.1 A boundary opens its evidence

Selecting the footprint, lower limit, upper limit or alignment component opens the relevant source revision and, where available, its page, region, entity or measurement reference. Information is labelled measured, document-derived, estimated or unknown. Uploading a file does not automatically make it suitable for a specific boundary.

Example: selecting U03's lower limit opens the level schedule used to justify it. An incomplete schedule creates a targeted request rather than an unexplained confidence percentage.

### 3.2 A finding explains a next action

A finding identifies affected revisions, highlights the relevant geometry, explains its rule and offers an appropriate next step. Invalid geometry, potentially incompatible records, documented permitted relationships and insufficient evidence are different outcomes.

Example: an incorrectly drafted lower limit creates a shared volume. The reviewer can inspect the supporting source, request clarification and have the preparer correct the draft. There is no universal “fix ownership” button.

### 3.3 A proposed change reveals its dependencies

A revised source identifies boundaries and derived records that depend on it. Changes are previewed and rechecked before review. Accepted revisions do not change simply because a new file arrived.

Example: a revised level schedule changes U03's draft boundary. U04 also needs fresh review checks because it uses the same source, even when its coordinates remain numerically unchanged.

**Combined USP:** understand what is observed, what is recorded, why they differ, and what must be reviewed before the record changes. Its value must be measured through user tasks, not claimed through novelty slogans.

## 4. Two applications, several roles, many workspaces

### 4.1 Application count and login model

There are **two client applications**, not five or six separate apps:

1. A web application for preparation, detailed spatial review, administration, registry lookup and planning.
2. An Android-first native mobile application for assigned work, field evidence, administration on the move, lookup and synchronization.

The same underlying account can be used on both where authorised. After authentication, the server resolves organisation/project memberships and permissions. A role grants actions on a defined record scope; it is not a separate database and not a rule that a person sees exactly one screen.

A person may hold more than one approved role. A workspace switch can select an already granted context, but cannot grant new authority. The header shows the active project and granted workspace. Direct API requests must enforce access even when the client hides a button.

### 4.2 Roles and their data

| Role | What they bring or change | What they can see within their scope | Main interface | Authority boundary |
|---|---|---|---|---|
| Administrator | Assignments, team membership, configured workflow settings and requests. | Permitted queues, progress and administration data; source access remains separately controlled. | Web Settings/Work queue; mobile Tasks → Team. | Being an administrator does not itself grant spatial acceptance. |
| Field officer | Task-linked photos, notes, survey-file attachments and evidence responses. | Assigned work packs, necessary plan/record summaries, outstanding requests and sync receipts. | Mobile Tasks, Lookup and Sync. | Field capture and receipt are not approval or survey certification. |
| Preparer | Source interpretation, alignment, proposed units, source bindings and submissions. | Assigned case sources, geometry, findings, differences and relevant neighbours. | Web Cases and linked editor. | Cannot turn their edit into an accepted record without the required review. |
| Reviewer | Review decisions and reasons; requests for correction or evidence. | Exact submitted revisions and the evidence/findings needed for their permitted review. | Web Review, Findings and source comparison. | Cannot accept their own submission where separation of duties is configured; initial demo uses distinct preparer/reviewer accounts. |
| Planner | Proposed query footprints/corridors and planning questions. | Permitted accepted spatial records, relevant relationships, source dates and coverage/quality summaries. | Web Planning and Registry. | Does not automatically receive personal ownership documents or editing/acceptance rights. |

An architect, owner, survey partner or utility custodian may supply files through an authorised team member without needing a separate supplier application. A citizen self-service portal is not part of the first release. Later read-only access must define its own privacy policy rather than exposing the entire registry.

### 4.3 Navigation is shared, actions are permission-aware

**Web navigation:** Work queue, Cases, Registry, Planning, Settings.

**Case tabs:** Sources, Units, Findings, Changes, Review. Assigned requests remain visible within the case.

**Unit panel:** Geometry, Evidence, Rights, History. The plan, hierarchy tree and 3D view share the selection.

**Mobile navigation:** Tasks, Lookup, Sync, Account. Authorised administrators see My tasks / Team within Tasks. Field officers see their assigned records, not every case in the organisation.

No final native-phone spatial acceptance or full native 3D CAD editor is included initially. This is a deliberate task/device boundary, not a claim that mobile administration is unimportant. Tablet/web review can use the web workspace when it remains readable and online.

## 5. The information model in ordinary language

| Record | Meaning | Important distinction |
|---|---|---|
| Surface parcel | An existing surface boundary and its external references. | Its footprint is not automatically an infinitely tall/deep ownership volume. |
| Physical asset | A building, pipe or other observed/designed object. | Physical existence does not establish a recorded right. |
| Spatial unit | The explicitly described space to which records relate. | A room, an apartment, a common area and a corridor need interpretation; labels alone are insufficient. |
| Geometry revision | A particular boundary specification with its references, method and evidence. | It differs from the simplified mesh shown by the viewer. |
| Rights/relationship record | The documented party/right/restriction/responsibility or relationship associated with a unit. | Entered and reviewed information, not ownership inferred by an image model. |
| Source revision | An original file or observation, its metadata and its lineage. | A new file version is not a geometry revision or an approval. |
| Finding | A result for specific source/geometry revisions under a specific rule set. | Old findings remain attached to the inputs they checked. |
| Evidence request | An actionable question about a component, assigned to a person/role. | “More data needed” becomes a precise task. |
| Submission and decision | A fixed set of revisions, checks and a recorded acceptance/return. | Acceptance applies to that snapshot, not unseen later edits. |
| Identifier and lineage | Stable unit identity, aliases and predecessor/successor links. | A coordinate hash or apartment label is not the entire identity lifecycle. |

The registry records both **effective time**—when a source says a change or right applies—and **recorded time**—when the system received or stored it. Neither date is invented when unknown.

Measurement values include quantity type, boundary convention, included/excluded spaces, method, units, source revision and uncertainty where provided. An interior-area value and a value including walls are not silently compared as the same measurement.

Source ancestry identifies derived products. Two outputs generated from the same observations are not automatically independent corroboration.

## 6. The inputs: who supplies them, why they matter and where they go

Not every case needs every source type. A viable initial plan-based case needs an attributable parent parcel context, a suitable outline/plan, supported vertical limits and a known reference/alignment relationship. Associating rights requires the relevant permitted records. In a synthetic fixture these are explicitly synthetic, not fictitious official documents.

Optional imagery, scans and BIM enrich that workflow or provide alternative preparation routes. Training data and background maps are not evidence of the particular property's rights.

### 6.1 Parcel layers and existing identifiers

**Question:** which surface parcel is the parent reference?

**Provider and route:** a permissioned land-record custodian, municipal/state export or survey partner; synthetic parcels for isolated testing. Initial files are supported GeoPackage or GeoJSON plus metadata. Access to a public map viewer does not establish a national parcel-download API.

**Example:** P-A is linked to building B01; adjoining P-B matters when a corridor crosses both footprints.

**Use and users:** import/provenance normalises the layer; preparers attach it to a case; reviewers inspect relationships; planners use permitted spatial context. Supplied official ULPINs are preserved rather than regenerated.

**Limit:** a surface boundary does not define every unit above/below it or establish unlimited subsurface ownership.

### 6.2 Floor plans, sections and level schedules

**Question:** what is the proposed internal outline, and where are its vertical limits?

**Provider and route:** authorised architect, owner, facility custodian or survey team. Start with a declared DXF subset or a PDF/image used for scaled, controlled tracing. Sections and level schedules are distinct supporting sources.

**Example:** E-PLAN-01 supplies U03's outline; E-LEVEL-02 supplies the lower-level evidence. Shared stairs are separate from the apartment.

**Use and users:** the preparer aligns the plan, traces or corrects regions, groups them into units and links the appropriate level evidence. The reviewer opens the same source region from the unit.

**Limit:** a floor-plan image alone may not establish height; a photographed drawing may be distorted. Repeated layouts remain unverified templates until supported for the actual floor.

### 6.3 Survey controls and GNSS/CORS-derived measurements

**Question:** where do the different sources sit in a common reference frame, and what measurements support that placement?

**Provider and route:** surveyor-provided coordinates, instrument/method information, benchmark relationship, units and reported quality. The first application imports explicit measurement files, such as a supported CSV schema; direct receiver control is later scope.

**Example:** control points align the plan and parcel; a level record establishes the relationship between floor values and the project benchmark.

**Use and users:** the geospatial pipeline checks references; the preparer confirms alignment; the reviewer can inspect the method and quality. A field officer may attach a surveyor's output without being its measurement author.

**Limit:** ordinary phone positioning is contextual evidence, not automatically a survey-grade control point. Unknown vertical transformations are not guessed.

### 6.4 Drone photographs and orthomosaics

**Question:** what visible building outline and surface context were observed?

**Provider and route:** an authorised survey partner; suitable OpenDroneMap examples for separate tests. Raw photographs require a declared preprocessing route. A georeferenced orthomosaic is a different, derived product from the raw images.

**Example:** an aerial image supports a candidate footprint for B01 that a preparer corrects.

**Use and users:** imagery import and optional extraction produce editable outlines or viewing assets for preparation and review. Derived products retain links to their original imagery and processing version.

**Limit:** imagery does not see through a roof to establish all interior units, or through the ground to discover ownership and utility rights.

### 6.5 LiDAR and other 3D point clouds

**Question:** which physical surfaces were actually measured, and what can be inferred from those observations?

**Provider and route:** a site-matched survey partner; suitable OpenTopography or verified research samples for separate importer/model tests. Initial files are LAS/LAZ with acquisition type, reference metadata, classification and quality where available.

**Example:** an exterior or airborne cloud supports observed roof/ground surfaces. An interior scan can support a level proposal only where the relevant interior surface was observed.

**Use and users:** processing produces inspected/cropped clouds, supported measurements or a physical-model preview. Preparers/reviewers compare these with recorded units.

**Limit:** an outdoor cloud does not magically contain every interior slab. Classification labels are not legal units. An unobserved surface remains unobserved.

### 6.6 Terrain and surface elevation models

**Question:** what is the surrounding terrain or observed surface context?

**Provider and route:** suitable survey-derived rasters; selected Bhuvan/Copernicus products for appropriate context or importer testing, subject to exact product terms.

**Example:** a terrain layer provides site context; a sufficiently suitable matched surface/terrain pair can support an exterior-height estimate.

**Use and users:** the pipeline checks resolution, alignment, units, dates and vertical references; the viewer displays appropriate context; review distinguishes an estimate from a measured boundary.

**Limit:** “DEM” is not a guarantee of bare-earth terrain. The earlier sources specifically identify Copernicus DEM as a surface-model product. Coarse context grids cannot establish apartment floors. Surface-minus-terrain calculations require compatible inputs, not merely convenient filenames.

### 6.7 Optional BIM/IFC submissions

**Question:** is structured building geometry already available instead of reconstructing everything from a drawing?

**Provider and route:** an authorised architect/building-model custodian. A narrowly defined IFC/IfcOpenShell adapter is conditional on suitable samples and tested support.

**Example:** the model contains storeys and spaces. The preparer maps or groups available spaces into candidate U03 and common-space records, then checks references and evidence.

**Use and users:** the importer reports units, placements, available geometry and mapped entities; the preparer reviews candidates; the reviewer checks their source linkage.

**Limit:** an IfcSpace is a functional spatial entity, not automatically a registered apartment. Geometry, georeferencing and complete coverage cannot be assumed from the extension. Do not flatten unsupported solids silently.[^ifc]

### 6.8 Rights-related documents

**Question:** what documented relationship is claimed for the defined space, by whom and over what period?

**Provider and route:** authorised record custodians or permitted submissions. Store the source and a reviewed structured association, not an invented owner field.

**Example:** a source associates a party or shared-use relationship with U03 or a corridor, with an effective date when supported.

**Use and users:** preparers enter or propose associations; reviewers interpret permitted documents under configured policy; other roles receive only the information their scope allows.

**Limit:** image segmentation and geometry validity do not establish legal title. Automated legal interpretation is outside the first product.

### 6.9 Utility and as-built records

**Question:** where is a known asset and what separate space or restriction is described by its documents?

**Provider and route:** a utility operator or other authorised custodian; a declared synthetic corridor for the demo. Initial representations must fit the supported geometry profile.

**Example:** C-UG1 lies below the basement and crosses P-A/P-B. The physical pipe is a different object inside a separately defined corridor space.

**Use and users:** preparers associate geometry/evidence; reviewers check records; planners inspect known intersections and affected parcel relationships.

**Limit:** absence from the loaded data means unknown coverage, not safe excavation. A projection-based parcel candidate still needs interpretation before it becomes an accepted rights relationship.

### 6.10 Mobile observations and evidence responses

**Question:** what specific missing information or observation did the field visit return?

**Provider and route:** the assigned officer captures permitted notes/photos or attaches an appropriate source file against a request. Local operation IDs preserve the response across interruption.

**Example:** RQ-LEVEL-01 asks for the upper-storey level record. The officer returns E-LEVEL-02 r2. The photo documents a schedule; the camera does not measure the floor level.

**Use and users:** the officer sees local/sync status; the administrator sees task progress; the preparer inspects the received source; the reviewer considers it in a later snapshot.

**Limit:** receipt does not prove the source's suitability or approve a boundary. Sensitive offline material requires tested encryption, retention and permission rules.

### 6.11 Context and model-development sources are separate

Basemaps can orient a user; dataset imagery and labels can train/evaluate extraction. Neither automatically becomes a property record. Maintain three collections: one coherent permitted or synthetic site, independent adapter tests, and model-development/held-out evaluation data. Keep geographic/site separation in evaluation and record licensing at the actual asset level.

## 7. Acquisition leads, not already connected data services

The carried-forward shortlist includes OpenDroneMap/ODMdata, OpenTopography, Bhuvan, Copernicus DEM, SpaceNet, Survey of India CORS documentation, and optional OpenStreetMap-derived context. The comparison report adds UAVPal, TALD, IIT Roorkee UAV data, Pixels/Points/Polygons, GOBS, Google Open Buildings temporal data and a Bhopal LiDAR repository.

These are **leads for the data owner to verify**, not a checklist of mandatory sources and not claims that files were obtained. The report describes access restrictions or suitability concerns for several leads. Verify the exact provider, licensing, demonstration/commercial reuse permission, geographic coverage, size, required credentials and quality before adoption. Do not repeat the report's previous “verified” label as a new acquisition result.

Select a small subset fitting actual tasks. The coherent plan-based route can progress using a clearly synthetic fixture while site permission is pending. Any real product demonstration must accurately disclose which inputs are measured, supplied, estimated or synthetic.

### Candidate-specific cautions retained from the report

The following are the supplied report's acquisition assessments, not newly verified access guarantees:

| Candidate | Useful research direction | Carried-forward caution to check |
|---|---|---|
| UAVPal, Bhopal | Indian imagery/DSM/label experiment for extraction. | The report identifies non-commercial/share-alike terms; confirm the actual asset and intended reuse before a product demonstration. |
| TALD | Outdoor airborne point-cloud classification/import experiment. | The report describes a contact-based access route limited to the Indian research community; it is not an interior-floor dataset. |
| IIT Roorkee Delhi UAV data | Dense-urban photogrammetry/import experiment. | The report describes an email request and research-use restrictions, including a commercial-demonstration restriction. Do not assume public showcase permission. |
| Pixels/Points/Polygons | Matched imagery, airborne point clouds and building labels for a genuinely multimodal test. | Start with a manageable, permitted subset; matched modalities still do not provide legal property records. |
| GOBS | Exploratory building-stock/context analysis. | The report says heights derive from Google temporal data and floor counts use assumptions; neither becomes measured floor-boundary evidence. |
| Google temporal building data | Coarse physical context or an observation-change experiment. | The report notes resolution/temporal limitations and uncalibrated scores. Do not treat a score as a probability of legal correctness. |
| Bhopal LiDAR repository | An acquisition lead to follow. | The report did not establish ready downloadable data; it is not a current project dependency until acquired and checked. |

The report's previous statements that pages were inspected do not mean this team downloaded, licensed or benchmarked those assets. The underlying broader proposal discussed by that report is not supplied as a separately verified product.

## 8. How the sources become one record

Take U03 as the continuous example:

1. The parcel source establishes the parent reference and case context.
2. The plan contributes the outline under an explicit boundary convention.
3. Appropriate level evidence supplies lower/upper limits; survey control supplies the reference relationship and alignment.
4. A rights-related document supports the recorded association, separately from geometry.
5. Optional matched imagery, point clouds or BIM add observed structure or candidate geometry. They do not override missing legal or measurement evidence.
6. The preparer creates a supported candidate and binds each component to source revisions.
7. Validation checks geometry, relationships, metadata and required evidence for that exact candidate.
8. A missing-evidence request can pass through the mobile app and return a new source revision.
9. The preparer previews dependencies, creates corrected candidates and submits a fixed snapshot.
10. An authorised reviewer accepts or returns that snapshot. Registry lookup and permitted export refer to the accepted revision; later changes go through new candidates.

File bytes live in private storage. Source metadata, permissions, units, revisions, relationships and decisions live in the shared registry. Neither the phone cache nor the browser mesh is the authoritative registry.

## 9. Product screens and their behaviour

| Screen/workspace | User action | Visible result | Important failure state |
|---|---|---|---|
| Work queue / case setup | Open/create an assigned case and select its parcel context. | Next task, source checklist and responsibilities. | Empty or denied scope does not expose private records. |
| Sources | Upload, inspect metadata and confirm supported alignment. | Received/processing/usable-for-purpose status; retained original. | Missing reference or unsupported format becomes a specific action, not silent repair. |
| Units | Select a unit, edit an outline, bind supported levels, save candidate. | Linked tree/plan/3D selection and component evidence. | Estimated/unknown values stay labelled; unsupported geometry is rejected or deferred. |
| Findings | Open an affected region and its source; correct or request evidence. | Rule explanation, exact inputs and next task. | No legal verdict or combined “trust score”. |
| Mobile Team / task | Assign online, download work pack, attach response. | Matching case/request IDs and explicit local state. | An unacknowledged assignment is not “delivered”; an uncached pack cannot appear offline. |
| Mobile Sync | Retry or send queued work on reconnection. | Received acknowledgment or actionable conflict. | No silent last-write-wins for boundaries, decisions or source replacement. |
| Changes | Compare old/new source bindings and affected records. | Candidate changes and stale validation list. | Numerical equality does not conceal changed evidence. |
| Review | Inspect and accept/return the exact submission online. | Decision, revision and stable published prototype identity. | Changed inputs, revoked authority or self-approval policy block the decision. |
| Registry | Search by permitted identity/alias; inspect history; export. | Same accepted space and its permitted source references. | An identifier/QR does not bypass evidence permissions. |
| Planning | Inspect a defined vertical column or corridor. | Ordered spaces or known intersections with date/coverage context. | No-match does not establish complete underground clearance. |

Add **Observed physical / Recorded units / Compare** as view modes in the web workspace. Compare shows dates and provenance and labels differences as requiring interpretation, not automatically violations.

A **vertical inspection column** is a specifically defined point/footprint query, ordered by elevation, added after ordinary querying works. It is not a new app or an undefined “nearby” search.

## 10. Geometry, meaning and uncertainty

The initial editable geometry family is a planar polygon, optionally with supported holes, and constant lower/upper limits in a common metric frame. Support for multi-component or more complex shapes must be declared and tested before exposure. Arbitrary sloping/curved solids are not an implied first-release capability.

The boundary profile states treatment of walls, slabs, voids and common circulation. The synthetic example is a simplified geometry partition, not a universal legal convention. Run completeness/no-gap rules only when a complete partition is declared; a shaft or intentionally unmapped region is not automatically an error.

Record five separate concepts: measurement quality, extraction score, evidence completeness, geometry findings and review decision. A weighted average cannot conceal missing mandatory evidence. Numerical computation tolerance is separate from survey uncertainty.

For two simple prisms in the same frame, positive interior overlap requires both positive-area footprint intersection and positive shared height. Boundary contact alone is not positive volume. More general solid operations need their own supported representation and tests. Basic 2D validity is not sufficient for a solid-validity claim.[^postgis]

## 11. States, identifiers and later changes

**Transfer states:** Saved locally → Queued → Uploading → Received; failures/conflicts/access expiry remain explicit.

**Source usability:** Received → Checks/processing → Usable for stated purpose, Needs metadata, or Blocked.

**Candidate/review:** Working candidate → Submitted snapshot → Accepted or Returned. A later edit creates a new candidate. UI readiness is derived from requirements; it is not an arbitrary green toggle.

Supplied official ULPINs remain unchanged and retain their source. DoLR's public generation description points to the surface parcel; this pack does not establish an authorised 3D issuance specification.[^ulpin]

Internal draft keys exist before validation so records can reference one another. Acceptance publishes/resolves the stable prototype spatial identity and accepted revision. Keep the identity separate from the human alias and mutable geometry fingerprint. Fingerprints support contextual duplicate review, not automatic merging of distinct rights, historical revisions or submissions.

Rights updates generally retain the spatial identity and add history. Corrections create geometry revisions. Splits/merges create successor units with explicit predecessor links. The exact authority-specific profile is an open pilot dependency. No identifier grants title.

A mobile **Report observed change** action can open a review case after the basic workflow exists. This differs from dependency impact: one notices a possible physical difference; the other determines which records depend on a proposed source/geometry change. Automatic observation-based detection is later scope and cannot silently rewrite accepted records.

## 12. The continuous reference case

The fixture is synthetic, with no claimed real geolocation, custodian data or survey certification.

| Element | Fixed meaning |
|---|---|
| C-001 | Initial-registration case. No accepted unit revision exists before the final review. |
| P-A / P-B | Adjoining surface parcels; B01 sits on P-A. |
| B01 | Two above-ground storeys, four apartments, separate common circulation and one basement. |
| U01 / U02 | Lower-storey units, 0–3 m in BM-DEMO-A. |
| U03 / U04 | Upper-storey units, correctly 3–6 m. U03 sits above U01 and remains the selected unit. |
| BSM-01 | Basement, −3–0 m. Negative local offset is not a claim of negative absolute elevation. |
| E-LEVEL-02 r1 | Incomplete upper-storey evidence. U03's erroneous lower value 2.8 m is unverified; U04's 3.0 m still needs support. |
| RQ-LEVEL-01 | Request for appropriate upper-storey lower-level evidence and reference. |
| E-LEVEL-02 r2 | Received field response supporting 3.0 m in the shared illustrative benchmark; suitability is checked before binding. |
| F-OVERLAP-01 | Highlights only the 2.8–3.0 m shared interior of the erroneous U03/U01 drafts. |
| U04 dependency | Needs fresh evidence/checks when its binding changes, even if its coordinates do not. |
| C-UG1 | Separate supported corridor below the basement, crossing both parcels. It must not acquire a fabricated basement collision. |

The scenario compares Draft 1 and Draft 2 before initial acceptance. A later lifecycle illustration may compare accepted/current with proposed/new, but it must be labelled as a later case. Parcel projection guides do not assert unbounded vertical ownership.

## 13. What is in scope now and what is conditional

**First complete lifecycle:** cases/access, usable source intake, manual plan-based unit editing, component evidence, supported geometry checks, a thin online mobile evidence loop, review, identity and lookup. History and permissions are foundational, not final polish. Basement geometry is represented early.

**Planned completion of the baseline:** reliable offline fieldwork, richer actionable review, source-change dependencies, compare modes, evaluated extraction, declared additional importers, cross-parcel corridor, bounded vertical inspection and supported exchange.

**Conditional extensions:** narrow IFC route with secured suitable samples; advanced point-cloud level proposals where observations justify them; additional native read-only spatial inspection.

**Later/not initial:** arbitrary solids, universal BIM support, native precision 3D editing, automatic citywide physical-change monitoring, direct instrument/drone control, public citizen portal, unrelated chatbot, property marketplace, tax computation or blockchain title.

These labels prevent a concept demonstration from implying every possible capability is already built or equally prioritised.

## 14. Trust, operational fit and value to prove

Cases, source previews, queries, signed file links and exports all enforce project/record scope on the server. Administrative, preparer and reviewer permissions are not interchangeable. Non-sensitive fixtures are preferred for public demonstrations.

Offline drafts require a persistent outbox, stable operation IDs, explicit receipts and comparison of concurrent edits. Independent observations may append; conflicting record changes need reconciliation. Storage in an app directory is not itself a claim of encryption. Offline approval and guaranteed remote wiping of a disconnected device are not promised.

The initial integration route is reviewed file exchange with manifests. External API connectors require documented authority, credentials, field/reference mapping, failure behaviour and version semantics. We have not established live access to a national registry or survey service.

The initial pilot is one supported workflow with a participating custodian/practitioner and a coherent small dataset. Measure task completion, evidence retrieval, correct finding resolution, missed dependencies, offline recovery, correction effort versus manual tracing, and export/import preservation. Record sample counts and hardware. Technical fixture success is not real-world extraction accuracy or national-scale readiness.

## 15. Open decisions to resolve without inventing answers

A real pilot still needs permission for actual site evidence; boundary/measurement conventions; the horizontal/vertical reference relationship; jurisdiction-specific review requirements; expected 3D identifier requirements; approved role assignments; sensitive-data retention; declared supported import profiles; and realistic operating resources. Contributors own the research/delivery tasks in Document 3. The product can be exercised with explicit synthetic assumptions while these decisions remain open.

## 16. Reconciliation and source basis

The available conversation and supplied baseline files were reconciled with the user's later corrections. Earlier brief-video targets, monologue wording, six-person staffing suggestions and detailed build-phase narration are not current requirements. Two apps, role-scoped workspaces, mobile early, nine modules and six implementation phases remain. Detailed phases belong to delivery documents, not the product film.

The supplemental `Pasted markdown(6).md` is a comparison/design assessment, not the unseen proposal it describes. Accepted refinements are measurement basis, source ancestry, effective/recorded time, compare views, scoped inspection, and conditional IFC/observed-change work. Weighted-confidence acceptance, universal no-gap rules and inferred unseen interiors were not adopted.

**Primary internal sources:** the visible original problem wording; `02_Product_and_Build_Handoff_v2.md`; `03_Data_and_Integration_Handoff_v2.md`; `06_Product_Walkthrough_and_Screen_Contract_v2.md`; the two latest branch prompts; and `Pasted markdown(6).md`. The transcript is evidence of communication problems, not an implementation specification. This consolidation does not claim access to unexposed messages from other branches.

**Original challenge scope, retained for traceability only:** the user supplied problem 26011, “3D ULPIN Generation and vertical Property Mapping System,” attributed to DoLR, Ministry of Rural Development. Its requested source/AI/vertical-and-underground coverage is retained above. Competition framing is excluded from product-video copy.

### Source register and verification limits

The following references support or were supplied for the external context. This consolidation rechecked only the ULPIN surface-description, the 2D validity limitation and IfcSpace semantics. Other entries are carried-forward research routes, not new access confirmations or a new competitive audit. Dataset suitability and current permissions must be verified during acquisition.

- DoLR ULPIN: https://dolr.gov.in/en/ulpin/
- NIC BhuNaksha: https://www.nic.gov.in/project/bhunaksha/
- DoLR NAKSHA: https://dolr.gov.in/en/about-naksha/
- ArcGIS Parcel Fabric: https://doc.esri.com/en/arcgis-pro/latest/help/data/parcel-editing/whatisparcelfabric.html
- QField: https://docs.qfield.org/get-started/
- Netcad Yapınet: https://en.netcad.com/en/products/yapinet
- OpenDroneMap examples: https://github.com/OpenDroneMap/ODMdata
- OpenTopography catalog: https://portal.opentopography.org/datasets
- Bhuvan access route: https://bhuvan-app3.nrsc.gov.in/data/download/help/source/html/steps_to_download_data.htm
- Copernicus DEM: https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- Survey of India CORS: https://surveyofindia.gov.in/pages/continuously-operating-reference-stations-cors-
- SpaceNet: https://spacenet.ai/datasets/
- UAVPal: https://research.utwente.nl/en/datasets/uavpal/
- TALD: https://sites.google.com/view/taldiist/home
- IIT Roorkee UAV lead: https://www.iitr.ac.in/uasg2023/sdata.html
- Pixels/Points/Polygons: https://github.com/raphaelsulzer/PixelsPointsPolygons
- GOBS: https://gobs.aeee.in/about
- Google temporal buildings: https://sites.research.google/gr/open-buildings/temporal/
- Bhopal LiDAR lead: https://github.com/geoai4cities/Bhopal_LiDAR_Dataset

[^ulpin]: DoLR, “Bhu-Aadhar: Unique Land Parcel Identification Number,” generation description; rechecked 12 September 2026. The page does not supply our proposed unit-level 3D issuance profile.
[^postgis]: PostGIS, `ST_IsValid`, https://postgis.net/docs/ST_IsValid.html; rechecked 12 September 2026. Validity is tested in 2D even when additional coordinates are present.
[^ifc]: buildingSMART, `IfcSpace`, https://standards.buildingsmart.org/IFC/RELEASE/IFC4_3/HTML/lexical/IfcSpace.htm; semantic definition rechecked 12 September 2026. The optional importer remains a product proposal, not a tested integration.
