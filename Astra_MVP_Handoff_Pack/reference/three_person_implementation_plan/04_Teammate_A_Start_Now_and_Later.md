# Teammate A — Start Now and Later Assignment

**3D Property Registry · 12 September 2026 · Planning only; tasks are not marked executed**

## Your responsibility

**Data acquisition, input samples, bounded inspectors/adapters and data-focused tests.** This assignment fits basic backend/frontend/app experience by giving you bounded engineering deliverables and a supplied integration pattern. It is not an assignment to build a whole specialist backend.

Vinayak is the technical lead and owns architecture, shared contracts, security, geometry, review transactions, sync design and difficult processing. The other teammate owns their separate packet. You remain accountable for completing, documenting, testing and fixing the code assigned here.

**Start now:** A01 → A02 and A03. You can research sources, assemble examples and test pure parsers before the app exists. Agree exact fixture geometry/result schemas with Vinayak before publishing shared artifacts.

**Boundary:** Do not take ownership of auth, application review, database migrations, sync protocol, arbitrary geometry algorithms, advanced model design or accepted registry writes. Vinayak supplies those mechanisms; you supply usable data and tested bounded operations.

## Read in this order

Read [01](reference/01_Product_Problem_and_Solution.md) §§4–6 and §§11–13 for the product/input/fixture meaning, then [02](reference/02_Modules_and_Architecture.md) §§2–3 and the modules relevant to your current task. Use [the revised master plan](03_Three_Person_Implementation_Plan_REVISED.md) for staffing and dependencies. The [reviewed addendum](reference/Reviewed_Additions_and_Guardrails.md) remains a guardrail.

The old staffing instruction that assigns all specialist backend work to A/B is superseded by Vinayak’s latest team-skills allocation and this plan. The product architecture is not being replaced.

## Shared fixture facts you must retain

C-001 is an explicitly synthetic initial-registration case. B01 is a two-storey building with four apartments, separate common circulation and a basement. U01/U02 are 0–3 m; U03/U04 correctly occupy 3–6 m in BM-DEMO-A. U03’s erroneous draft starts at 2.8 m. E-LEVEL-02 r1 is incomplete; RQ-LEVEL-01 requests support; r2 supports 3.0 m after suitability is checked. U04 can need fresh checks without moving. No accepted unit revision exists before the initial review. The later corridor lies below the basement and crosses two parcels without an invented basement collision.

The documents do not provide exact XY dimensions. Vinayak freezes an explicitly synthetic layout in V00. Do not invent a real geolocation, official ID or survey accuracy. Keep coherent case files, separate importer tests and model evaluation data distinct.

## The input families and division of work

| Input family | What A prepares/researches | What B receives/stores through shared intake | Processing decision / priority |
|---|---|---|---|
| Parcel vector + supplied identifier | Small permitted vector sample, original identifier/source, frame/units and purpose; explicit local synthetic alternative | Original file, case link, source revision, identifier provenance and metadata | Core now: one declared GeoJSON or other chosen profile; Vinayak owns reference conversion/spatial meaning. GeoPackage may follow once its reader exists. |
| Plan / section / level schedule | E-PLAN-01 and E-LEVEL-02 examples, scale/reference notes, page/region or row locators, r1/r2 | Originals, kind/purpose, revision, supplied metadata and locators | Core now: PDF/image reference plus manual tracing; typed level CSV where selected. DXF is a declared later profile, not automatic plan understanding. |
| Survey control / level measurement | Supported CSV columns, benchmark, method, units, reported quality and invalid examples | Original measurement file and attribution; validated structured rows only through the approved importer | Core now: a supported small CSV. No guessed datum, receiver-control app or automatic survey certification. |
| Mobile notes/photos/attachments | Request-linked example, acquisition/reference/quality caveats | Attributable response, finalized source references, operation ID, original request context and server receipt | Core online now; offline later. Phone location is context, not automatically a survey control. |
| Rights / relationship evidence | Minimal permitted document or synthetic party/right records and intended association | Restricted original + reviewed association through approved schema | Minimal synthetic records where required for C-001; no inferred owner/title or automatic legal interpretation. |
| Utility / as-built record | Defined simple basement/corridor fixture and evidence/coverage caveat | Original source + supported asset/corridor candidate reference | Basement in the core. Expanded cross-parcel corridor/queries in phase 6; no clearance assertion. |
| Drone photos / orthomosaic | Acquisition type, source ancestry, suitable small sample, permissions and metadata | Registered originals or derivative links, not point-cloud bytes in relational rows | Phase 5 selected route. Raw photos require their own preprocessing; orthomosaic is not the same input. |
| LAS / LAZ point cloud | Small sample, acquisition type, covered surfaces, reference/units and limits | File reference, inspection/job metadata, restricted derived assets | Phase 5 selected profile. Outdoor scans do not provide unseen interior floors. |
| Terrain / surface raster | Product type, resolution, dates and reference compatibility | Original raster reference, metadata and purpose-specific status | Phase 5 context or a justified supported operation; no floor boundaries from coarse context. |
| IFC / BIM | Permission/sample, units/placements/entities, available geometry and unsupported examples | Original model + inspection/proposal/entity references | Conditional after a tested V06 engine. An IfcSpace is not automatically a registered apartment. |
| Training / held-out data / basemap context | Separate manifest, splits, reuse terms and upstream ancestry | Separate development/context collection, never silently bound as property evidence | Research now; selected evaluation in phase 5. Unrelated data must not masquerade as C-001 evidence. |

## Your ordered queue

| Task | Phase | Start / dependency |
|---|---|---|
| A01 — Make the input-source register and acquisition decisions | 1 | START NOW — only the supplied project documents are required. |
| A02 — Assemble the minimal fixture pack and independent expected results | 1 | START NOW for the folder, manifest and source examples. Freeze the exact synthetic XY geometry and final schemas with V00 before publishing numeric fixtures. |
| A03 — Implement small, independently testable input inspectors | 1 | START NOW with pure parsing helpers and local tests. Align their public result shape with V00 before integration; no database, login or live backend is needed. |
| A04 — Expose basic inspectors and approved core-data acquisition operations | 2 | After the relevant V01 processing template, controlled storage reader and job/result schema are available. Do not wait for the 3D editor. |
| A05 — Prepare attributable lightweight previews and locators | 2 | After source registration works and Vinayak provides the supported preview/rendering helper and source locator contract. |
| A06 — Run independent input and basic spatial fixture checks | 2 | After B03/A04 endpoints and V02 geometry outputs exist. Expected cases can be written earlier. |
| A07 — Verify evidence preservation through offline collection and sync | 3 | After V04 publishes the work-pack/sync primitives and B08 has a testable client. |
| A08 — Supply source-change and dependency test cases | 4 | After the V05 dependency/change-preview contract is frozen; prepare the r1/r2 examples earlier. |
| A09 — Add one approved richer input or external acquisition adapter at a time | 5 | After A01 establishes usable access/permissions for that exact asset and V06 provides the required processing operation. Proceed only with an explicitly selected profile. |
| A10 — Run reproducible model/evaluation experiments from a supplied recipe | 5 | After V06 defines the task, baseline, preprocessing, metrics and runnable evaluation command, and the required input/model permissions are checked. |
| A11 — Prepare an unfamiliar case and independent planning/exchange expectations | 6 | After V07 publishes supported query and exchange profiles. Fixture design can start once the geometry conventions are stable. |
| A12 — Deliver the final reproducible data and processing handoff | 6 | After the selected data/adapters/tests are implemented; maintain this incrementally. |

## Detailed assignments

### A01 — Make the input-source register and acquisition decisions

**Phase:** 1  
**Start condition:** START NOW — only the supplied project documents are required.

**Do:** Inventory every source family in the input matrix below. For the first manual case, prioritize parcel context, a plan, level evidence and reference/control information. For each needed family choose one practical primary route and one fallback. Research the actual provider/access route and intended-use conditions; distinguish a public viewer, a downloadable file, a documented API and permission-based access. Record what you actually acquired and inspected, not just what a portal advertises. Keep deferred data leads brief.

**Deliver:** `docs/data/source-register.md`; `docs/data/source-decisions.md`; provider/asset references and acquisition instructions. Use the supplied source-register template.

**Done when:** Every core input has a concrete acquired sample, a specifically described permission/access blocker, or an explicitly synthetic fallback. Download/inspection status and permission status are separate. All other input families are marked deferred, optional or needed with a reason.

**Boundary:** Do not claim government integration, current dataset access, commercial/showcase permission or survey accuracy from the old notes. Do not scrape a viewer, bypass access controls, or acquire large datasets merely because they exist.

**Handoff to:** Vinayak uses the decisions to choose supported profiles; B uses the input/metadata requirements.

### A02 — Assemble the minimal fixture pack and independent expected results

**Phase:** 1  
**Start condition:** START NOW for the folder, manifest and source examples. Freeze the exact synthetic XY geometry and final schemas with V00 before publishing numeric fixtures.

**Do:** Build a small explicitly synthetic C-001 pack: parcel context, E-PLAN-01 reference drawing, E-LEVEL-02 r1/r2, reference/control records, and request-linked example response RQ-LEVEL-01. Preserve the prescribed storeys, U01–U04, separate common circulation and BSM-01. Add valid and deliberately invalid input samples. Keep any real importer samples in a different collection from the coherent case. Record expected results independently of the production functions.

**Deliver:** `fixtures/c001/README.md`, `manifest.json`, original sample files, `expected-results.md`; `fixtures/adapter-tests/`; a manifest entry for each file with hash, provenance, reference, purpose and limitations.

**Done when:** A second contributor can identify which file supports footprint, lower limit, upper limit and alignment. Expected checks include the 2.8–3.0 m overlap, corrected contact at 3.0 m, missing references and the U04 evidence dependency. Missing XY dimensions are resolved as new synthetic choices, not attributed to the source documents.

**Boundary:** Do not attach an invented real-world location or official-looking ULPIN to the synthetic case. A local-frame fixture must be explicitly labelled; do not pass it off as a geographically located dataset. Do not overlay unrelated cities as one site.

**Handoff to:** All three contributors use this same pack. Vinayak approves its geometry/reference conventions; B uses it for seed and request fixtures.

### A03 — Implement small, independently testable input inspectors

**Phase:** 1  
**Start condition:** START NOW with pure parsing helpers and local tests. Align their public result shape with V00 before integration; no database, login or live backend is needed.

**Do:** Implement bounded CSV/JSON parsing and metadata inspection for the selected control/level CSV and parcel-vector profile. Check headers, parseable numbers, declared units/reference metadata, supported type and required identifiers; return specific issues with row/field locators. For PDF/image plans, initially report supplied metadata and manual-reference requirements; use a renderer supplied by Vinayak rather than building automatic plan understanding. Preserve original values.

**Deliver:** `services/geo/adapters/basic/` helpers; valid/invalid tests; sample inspection JSON; a local example command. Use the Python processing area rather than creating another application server.

**Done when:** A documented command processes a good sample and produces structured issues for bad headers, malformed numbers, missing required metadata and unsupported input. Unknown reference/quality stays unknown. Metadata inspection is not labelled geometry validation or acceptance.

**Boundary:** Do not implement CRS transformations, arbitrary 3D validity, floor inference, model training or cadastral decisions. Do not silently repair coordinates or guess units.

**Handoff to:** Vinayak supplies the shared result schema and later processing template; A04 turns these helpers into real operations.

### A04 — Expose basic inspectors and approved core-data acquisition operations

**Phase:** 2  
**Start condition:** After the relevant V01 processing template, controlled storage reader and job/result schema are available. Do not wait for the 3D editor.

**Do:** Expose A03 through the existing private job interface using allowlisted inspection profiles. Read a controlled source revision reference, invoke the helper, and return technical results/locators with the original input fingerprint. Add bounded size/type checks, explicit failure output and processor tests. Preserve source ancestry for any derivatives. If A01 establishes a documented permitted core-data download/API route, also implement a small provider-specific acquisition adapter once Vinayak supplies its allowlisted job/source-registration interface. Simple acquisition does not wait for AI or V06; file-only/synthetic fallback remains valid.

**Deliver:** Runnable inspect operations under `services/geo/`; an approved core acquisition adapter when available; operation/profile examples; schema-valid success/failure results; setup/test commands.

**Done when:** A source uploaded through B03 can be inspected through the real processing path. Its result refers to the same source revision and displays through the application API. Duplicate delivery and an outdated input do not overwrite newer application state.

**Boundary:** Vinayak owns dispatch durability, callback authorization, idempotent result ingestion and user-visible state transitions. A does not write accepted registry records or expose unrestricted URLs/paths.

**Handoff to:** B04 shows the results; Vinayak uses suitable inputs for construction.

### A05 — Prepare attributable lightweight previews and locators

**Phase:** 2  
**Start condition:** After source registration works and Vinayak provides the supported preview/rendering helper and source locator contract.

**Do:** Package small plan/parcel previews and source locators for the web and thin mobile task flow. Retain original source revision, page/region or row reference, transform information where applied, dimensions and file size. Identify which assets are permitted for later offline packs.

**Deliver:** Preview preparation adapter/configuration; a C-001 preview pack; source-locator examples; tests linking each preview back to its original.

**Done when:** The phone and web can open the same request’s permitted source reference without downloading heavy point clouds. Scaling/cropping does not silently change the meaning of a measurement or its source region.

**Boundary:** Do not implement a new viewer, precision alignment engine or unlicensed basemap cache. Sensitive offline use remains disabled until V04 policy/protection is implemented and tested.

**Handoff to:** B06 consumes the online assets; B08 later consumes the approved offline subset.

### A06 — Run independent input and basic spatial fixture checks

**Phase:** 2  
**Start condition:** After B03/A04 endpoints and V02 geometry outputs exist. Expected cases can be written earlier.

**Do:** Exercise valid contact, positive overlap, invalid outline, unsupported geometry, missing reference, incompatible units and incomplete level evidence. Compare the production result with independently stated expectations. For supported same-frame prisms, check overlap against independently calculated footprint intersection area multiplied by shared height. Verify the basement and common-space conventions.

**Deliver:** `tests/data-geometry/` fixture report with input IDs, expected method/result, actual output, command and tolerance; reproducible defect reports.

**Done when:** C-001 findings are genuinely computed. The erroneous U03/U01 shared height is 0.2 m; correcting the lower limit to 3.0 m removes positive interior overlap. Tests are not hardcoded product responses and do not call the same production function their own oracle.

**Boundary:** You test spatial behaviour, not invent its algorithms. Vinayak fixes core computation defects; A fixes the inspectors/fixtures A owns. A synthetic pass is not real-world survey or extraction accuracy.

**Handoff to:** Vinayak uses the results before completing V03; B uses input failures in the UI.

### A07 — Verify evidence preservation through offline collection and sync

**Phase:** 3  
**Start condition:** After V04 publishes the work-pack/sync primitives and B08 has a testable client.

**Do:** Create bounded permitted work packs and test file/reference preservation through restart, retry and reconnection. Include an outdated request, an older source revision and a response with contextual phone location. Compare bytes/locators/metadata before and after receipt; retain the original observation context on conflicts.

**Deliver:** Offline evidence fixtures; source-preservation assertions; a documented data-focused sync test report.

**Done when:** The received response still points to the intended request and original source context. Phone location has not become a survey control point, and duplicate transfers have not silently changed source bindings.

**Boundary:** Vinayak owns the sync protocol; B integrates it and runs device UX tests. Do not independently define last-write-wins or conflict-resolution policy.

**Handoff to:** B08 and Vinayak resolve any reproducible data-loss/reference defects.

### A08 — Supply source-change and dependency test cases

**Phase:** 4  
**Start condition:** After the V05 dependency/change-preview contract is frozen; prepare the r1/r2 examples earlier.

**Do:** Test E-LEVEL-02 r1 → r2 with U03 geometry movement and U04 evidence-only impact. Add an unrelated source that should not rebind units, a derived-source ancestry example, incompatible measurement bases, and a later update case that must preserve the current accepted record.

**Deliver:** Before/after source manifests; independent affected-record expectations; change-impact regression report.

**Done when:** U03/U04 impacts are individually explained. A new upload alone does not rebind records. Initial registration compares drafts; accepted/current versus proposed/new is only used in a separately labelled later lifecycle case.

**Boundary:** Do not implement the dependency graph, concurrency rules, weighted confidence acceptance or automatic violation classification.

**Handoff to:** Vinayak validates V05; B09 renders the returned distinctions.

### A09 — Add one approved richer input or external acquisition adapter at a time

**Phase:** 5  
**Start condition:** After A01 establishes usable access/permissions for that exact asset and V06 provides the required processing operation. Proceed only with an explicitly selected profile.

**Do:** For each chosen profile, obtain a small sample, inspect its metadata, implement a provider-specific acquisition wrapper where a documented permitted route exists, invoke the supplied processor and return attributable results. Use a typed provider/asset identifier rather than an arbitrary URL. For file-only sources, document the permitted download-and-upload route instead of inventing an API. Keep raw drone imagery, orthomosaics, outdoor clouds, terrain/surface rasters and IFC semantically separate.

**Deliver:** Adapter code/configuration in the processing subsystem; provider/asset/permission manifest; bounded sample; valid/invalid/timeout tests; supported-result and unsupported-case notes.

**Done when:** Each selected adapter produces a real useful result from an allowed input. Server-only credentials and access restrictions are preserved. Original bytes/source revisions remain linked. Failure of an optional adapter does not block the manual plan route.

**Boundary:** Vinayak owns heavy GDAL/PDAL/IFC/geometry integration, reference transforms and infrastructure compatibility. A wraps tested capabilities; universal IFC and unseen interior-floor inference are not assigned to A.

**Handoff to:** B10 exposes only implemented profiles. Vinayak selects the next adapter based on product value and evidence.

### A10 — Run reproducible model/evaluation experiments from a supplied recipe

**Phase:** 5  
**Start condition:** After V06 defines the task, baseline, preprocessing, metrics and runnable evaluation command, and the required input/model permissions are checked.

**Do:** Prepare dataset/split manifests, run the supplied baseline, capture raw predictions/failures/resource observations, and organize a separate proposal-plus-human-correction trial. Check that held-out sites/data are not reused for training or tuning. Preserve source/model lineage and upstream dependencies.

**Deliver:** Run configuration; dataset/split manifest; raw evaluation artifacts; correction-task observations; limitations and actual commands/results.

**Done when:** Another contributor can reproduce the declared run. Raw prediction results, corrected results and correction effort are separate. Synthetic fixtures are not presented as proof of real-world extraction quality.

**Boundary:** Vinayak chooses the scientific approach and resolves training/model defects. Do not invent percentages, treat model scores as acceptance probabilities or make advanced model research the first dependency.

**Handoff to:** Vinayak judges the baseline; B10 supports correction-state UI.

### A11 — Prepare an unfamiliar case and independent planning/exchange expectations

**Phase:** 6  
**Start condition:** After V07 publishes supported query and exchange profiles. Fixture design can start once the geometry conventions are stable.

**Do:** Supply a second declared case and cases for vertical ordering, point/footprint query boundaries and a corridor below the basement crossing P-A/P-B. Prepare expected parcel candidates/intersections and a field-retention checklist for supported export/re-import. Include unknown coverage and restricted evidence.

**Deliver:** Independent fixtures; query expectations; round-trip field/quantity checklist and test results.

**Done when:** The same operations work beyond U03. The chosen below-basement corridor does not acquire a fictional basement collision. No-match remains no match in authorized loaded data, not complete clearance.

**Boundary:** Vinayak implements query/geometry/export logic. Do not change the supported shape family or infer legal rights from parcel projection.

**Handoff to:** B11 displays query/lookup outputs; B12 and Vinayak use the fixtures for release checks.

### A12 — Deliver the final reproducible data and processing handoff

**Phase:** 6  
**Start condition:** After the selected data/adapters/tests are implemented; maintain this incrementally.

**Do:** Consolidate fixture startup commands, source/acquisition status, supported formats/purposes, parser tests, evaluation artifacts and unresolved limitations. Remove accidental private data from demonstration fixtures and document what must be obtained separately.

**Deliver:** `docs/data/RUNBOOK.md`; current source register; repeatable commands; final data-processing evidence report.

**Done when:** B or Vinayak can reproduce the declared inputs and adapter results without an interactive notebook or undocumented local files. Unavailable data and unexecuted tests remain explicitly marked.

**Boundary:** Do not mark an entire module done merely because a file downloads or a parser returns JSON.

**Handoff to:** V08 release integration and future contributors.

## Research/acquisition result format

For each selected source, provide the exact provider/asset, intended use, documented access route, permission evidence/conditions, actual acquisition/inspection status, small sample/hash, coordinate/height metadata where relevant, limitations and fallback. A list of links is insufficient. Research candidates from the documents are leads to check, not proof that the project has data access.

For a provider with a permitted documented API, implement only the selected adapter after interface review. For a file-only route, supply acquisition instructions and use the shared upload pipeline. No arbitrary URL-fetch service, credentials in source control, notebook-only “API”, or unrelated datasets overlaid as one site.

## How to work with Vinayak and the other teammate

Keep one primary implementation packet active. Name the exact missing helper/schema/sample when blocked. Continue an independent research/fixture/test task rather than redesigning the missing mechanism. Do not wait for the complete product to test your component; do not mark integration verified until a real consumer has used it.

Vinayak reviews changes to shared contracts/migrations and core rules. Ordinary defects in your assigned code remain yours to fix. New source profiles or state/enum changes require a reviewed shared-contract update, not an ad-hoc client/parser workaround.

## Submit each task using this definition of done

A task is ready to review only when its handoff includes:

- Task ID, changed paths, what works, required inputs and the exact next consumer.
- Contract/profile version and schema-valid request, response and error examples.
- Fixture files/IDs, expected result, actual test command/result and known unsupported cases.
- Any source permission/provenance/measurement limitations relevant to its output.
- Explicit status: **not started**, **in progress**, **blocked**, **contract-ready**, **mock-ready**, **implementation-ready**, or **integration-verified**. A blocked task names the missing artifact and its owner.

`Contract-ready` means the reviewed schema/states/limits exist. `Mock-ready` adds deterministic fixture responses. `Implementation-ready` means the real component runs with its checks. `Integration-verified` means its actual consumer has used the real result. These are different pieces of evidence, not interchangeable labels.

An API task is not complete because a route exists. A research task is not complete because it contains links. A parser is not complete because it prints JSON. A screen is not complete while its claimed capability is still mocked. Device behaviour is not verified by a web screenshot.


Use [task handoff](templates/TASK_HANDOFF_TEMPLATE.md), [source register](templates/SOURCE_REGISTER_TEMPLATE.md) and [acceptance scenarios](templates/ACCEPTANCE_SCENARIOS.md). Deliver setup commands, inputs and actual outputs so another teammate can reproduce your work. Future tasks in this document are assigned only when their start condition is met.
