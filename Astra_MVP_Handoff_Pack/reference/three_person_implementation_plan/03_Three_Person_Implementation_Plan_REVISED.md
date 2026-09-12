# 3D Property Registry — Revised Three-Person Implementation Plan

**Execution revision · 12 September 2026 · Planning only: no implementation, acquisition or test completion is claimed**

## 1. Decision and precedence

This revision implements Vinayak’s latest allocation: Vinayak can build across the stack; the other two contributors have basic backend, frontend and app skills. Delegate real, bounded engineering work that fits those skills, rather than assigning each teammate an entire specialist backend.

**Vinayak owns architecture and the difficult core. A owns data acquisition, samples, bounded inspectors/adapters and data-focused tests. B owns bounded input/storage APIs, ordinary UI/mobile integration and workflow tests using Vinayak’s supplied primitives.** Both teammates fix the code they own and remain accountable for concrete deliverables; they are not only note-takers or manual testers.

The original 03 assigns full specialist backend/platform ownership to A/B and limits Vinayak largely to clients. That allocation, its infrastructure/public-contract ownership and its “do not transfer backend implementation to Vinayak” execution instruction are explicitly superseded here. The corresponding old ownership prose in 02 §16 is also superseded. Product meaning, nine modules, two applications, stack and six-phase order remain unchanged.

**Source order:** latest explicit user instruction → this execution plan for staffing/tasks → [01 product baseline](reference/01_Product_Problem_and_Solution.md) for product meaning → [02 architecture](reference/02_Modules_and_Architecture.md) for technical boundaries → [reviewed addendum](reference/Reviewed_Additions_and_Guardrails.md) for relevant guardrails. This is a new allocation proposal, not a report about a repository that has been inspected or work already performed.

## 2. Ownership that matches the team

| Responsibility | Vinayak | Teammate A — Data & input processing | Teammate B — Intake APIs & client delivery |
|---|---|---|---|
| Product/architecture and shared contracts | Accountable owner and merge reviewer | Proposes source/inspection fields | Proposes intake/client fields |
| Database, identity, access, storage, jobs, infrastructure | Owns design, migrations, trusted helpers and critical implementation | Uses controlled source/job template | Implements thin routes using provided helpers |
| Geometry, references, construction, validation | Owns algorithms/authoritative specification and core tests | Supplies independent expected fixtures and calls tested processors | Displays returned values/states; does not reimplement calculation |
| Data acquisition/input format work | Selects supported scope and reviews fit | Owns research, small samples, provenance and bounded adapters | Owns agreed metadata intake and stored references |
| Review, identity, dependencies, concurrency | Owns protected rules and transactions | Supplies lifecycle/data test cases | Implements bounded consumers and independent regressions |
| Web and app | Owns shells/design, linked precision workbench and complex integration | Supplies attributable preview/data assets | Owns assigned ordinary forms/lists/task screens; fixes them |
| Offline | Owns server protocol plus tested client outbox/conflict primitives | Tests evidence/reference preservation | Wires UI and runs actual-device interruption tests |
| AI/heavy processing | Owns baseline, engine choice/integration and evaluation design | Wraps provided operations; runs reproducible experiments | Integrates job/proposal states and manual fallback |
| Release/testing | Tests own core code; integrates and owns deployment | Tests own data/processor code and independent data expectations | Tests own APIs/UI and independent user/service journeys |

The skill boundary is complexity, not “backend belongs to one person.” As a teammate proves a specific capability, Vinayak may delegate a larger bounded task. Do not promote “can write an upload route” into “owns security/review concurrency” without that evidence.

### Repository ownership

- **Vinayak:** `packages/contracts`, `packages/domain`, database migrations, root `infra`, auth/storage/job/sync/review primitives, `services/geo/geometry`, heavy engines/ML baseline, precision web editor and shared mobile core. Approves shared-schema and migration changes.
- **A:** assigned `services/geo/adapters` / acquisition wrappers, data fixtures, processor tests and `docs/data`. Uses Vinayak’s private-service template; does not create a second registry API.
- **B:** assigned thin `apps/web/app/api/v1` routes, Sources/evidence/support components, assigned `apps/mobile` task/sync/lookup screens and integration tests. Imports shared domain/helpers; does not own every server route merely because some are assigned.

Each work packet has a bounded branch such as `a/A03-basic-inspectors` or `b/B03-source-intake`. Shared contracts/migrations do not get simultaneously redesigned by three people. Source files outside the assigned scope require an explicit reviewed change.

## 3. What to assign immediately

### A — first message

> Own A01–A03 in this plan. Start by producing an actionable source register, a small attributable fixture pack, and pure input-inspection helpers with good/bad examples. Prioritize parcel context, plans, level/reference records and request-linked field evidence; keep optional imagery/cloud/IFC leads separate. Use the supplied documents; do not assume a government API or licensed dataset exists. You can start without a database or UI. Coordinate only the shared schema and exact synthetic geometry with Vinayak before publishing fixtures. Deliver the files, code, expected outputs and commands—not a list of links or a notebook alone. After the processing template is ready, A04 turns the helpers into callable operations.

### B — first message

> Own B01–B02 now: input-field decisions, concrete upload/evidence payloads, schema-based validators and a request/test collection. Do not wait for screens or invent a separate backend. Vinayak will approve the shared schema and provide one guarded route, database/storage helpers and version/idempotency rules. When those are ready, own B03 source upload/finalization/list/read endpoints; then B04/B05 forms and evidence-response persistence, followed by the thin mobile flow B06. Your endpoints and screens must handle real errors, denied access and retries. Do not implement geometry, approval/concurrency or sync policy independently.

### Vinayak — start in parallel

Do V00, then release V01 building blocks incrementally. Your first output is a usable starter/contract, not a completed dashboard. Keep one core critical-path implementation task active while reviewing the small A/B integration handoffs. The team can work before the entire backend exists.

### First delivery gate

A returns the minimal source decisions, actual/synthetic samples and inspector examples. B returns field ownership, schema fixtures, validators and request tests. Vinayak freezes the small common contract and releases the helper/template needed next. The team then uses the same fixture through real intake and inspection instead of producing three disconnected demos.

## 4. The enabling pack Vinayak must build first

Vinayak supplies a small reusable contract/starter pack, not every future endpoint at once:

1. **Shared shapes and examples:** source manifest/intake, source revision/locator, inspection result, evidence request/response, job envelope and standard errors needed for the next task. Include success, invalid, missing-metadata, denied, processing and stale examples where relevant.
2. **Trusted helpers:** an authenticated request context, project/record scope guard, approved database access methods, controlled upload/finalization/read primitives, and version/idempotency helpers. Actor/receipt/accepted pointers are server-owned.
3. **One reference implementation:** one working route and its tests, one processing handler/example, and one client call against a schema-valid mock and a real response. The helper dependency is ready before the teammate’s endpoint is assigned as unblocked.
4. **Shared fixture conventions:** C-001 labels/Z limits, an explicitly synthetic XY layout, supported boundary/measurement profile, local frame/benchmark and expected outputs. The original documents do not define exact XY dimensions; the team must choose and label them.
5. **Scoped repository/test instructions:** setup command, environment template without secrets, seed/reset command, where the teammate writes code and which files require Vinayak’s review.

Do not make A/B wait for a polished dashboard, all nine modules, the final database model or a full mobile app. Release a ready source helper while later review/sync helpers are still being built. A can research and test pure parsers without the platform; B can prepare payloads and validators without live endpoints. Neither publishes an independent competing contract.

### Minimum intake metadata to agree in V00

Use one source manifest, with type-specific optional sections rather than eleven unrelated upload systems. The field names below are an implementation checklist to freeze in the shared schema, not a claim that these APIs already exist.

| Group | Required meaning / authoritative source |
|---|---|
| Identity/scope | Case/project context, source family and immutable source revision, source kind, intended purpose, schema version. Server authorizes scope and assigns authoritative identities/revisions. |
| Original file | Stable storage reference, original filename, verified size/type/hash where supported. A client filename/hash or upload-success flag is not sufficient proof of receipt. |
| Provenance/use | Provider, asset/access route, attribution, permission/use restrictions, acquisition method, real/synthetic/development status, limitations. Distinguish unknown permission from permission checked for the intended use. |
| Reference/measurement | Horizontal/local frame, vertical benchmark/reference, units, quantity/boundary convention, method and reported uncertainty as relevant. A missing field may block a particular use without invalidating every possible use of the file. |
| Time | Capture/source/effective time when supplied; server recorded/receipt time separately. Unknown effective dates remain null/unknown. |
| Lineage/locators | Parent source revisions, processing/transform version, page/region/entity/measurement references and component purpose. A derived output is not independent evidence merely because it has a new filename. |
| Receipt/processing | Transfer status, inspection/job status and purpose-specific suitability separately. Registry review/acceptance is not an upload field. |

B enforces the agreed envelope and server-owned fields. A inspects file content and records technical issues. Vinayak owns semantic rules, transformation, reference compatibility and protected publication. Sensitive rights evidence and permitted public context do not automatically share the same read/cache policy.


## 5. Data/API division — what “get data” and “store data” mean

There are different jobs here:

**Acquisition:** obtain an authorized external asset or a custodian-provided file. A owns source-specific research and approved wrappers. A portal/link alone is not acquired data. A data provider without an API uses supported file exchange, not an invented connector.

**Intake/storage:** authorize receipt, preserve original bytes in private object storage, register immutable source metadata/revisions and expose permitted reads. B implements these ordinary routes on Vinayak’s secure helpers.

**Inspection:** report what the file contains, whether declared metadata is present, and what purposes it might support. A’s bounded processors return structured technical results; the application owns visible state.

**Normalization/geometry/acceptance:** decide compatible references, perform authoritative computation and control review/publication. Vinayak owns this core. Neither a download nor an upload receipt makes a boundary usable or accepted.

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

### Small initial API surface

Names below retain the source upload/job paths and propose explicit list/read/response paths where needed. They must be frozen before implementation; none is claimed to exist.

| Capability | Proposed application route / interface | Owner and boundary |
|---|---|---|
| Start an upload | `POST /api/v1/sources/upload-sessions` | B wires V01 access/storage helpers. Returns authorized upload details, not an accepted source/unit. |
| Register verified receipt | `POST /api/v1/sources/{id}/finalize` | B wires V01 verified-finalization and revision/idempotency helpers. Stores an immutable source revision once per logical operation. |
| Read case sources | `GET /api/v1/cases/{caseId}/sources` | B implements scoped, bounded listing against shared data access. |
| Read source metadata | `GET /api/v1/sources/{id}` | B implements permitted metadata/status access. A signed URL is not the permanent source identity. |
| Obtain a permitted file read | `GET /api/v1/sources/{id}/read-link` | B wraps V01 controlled-read policy; expiry/error behavior is explicit. |
| Submit field evidence | `POST /api/v1/evidence-requests/{requestId}/responses` | B persists a response through V02/V03 rules; receipt does not approve or silently bind it. |
| Inspect / process an input | `POST /api/v1/processing-jobs` → private `/internal/v1/jobs` | Vinayak owns public orchestration and durable state; A implements approved inspection/profile handlers; B connects consumers. |
| Fetch a permitted external asset | Provider adapter called through the existing controlled job/application boundary | A implements a selected provider/asset adapter only after access and interface review. Vinayak owns credentials, network/resource controls and source registration rules. No universal arbitrary-URL downloader. |

The phase-5 backlog retains the baseline imagery/orthomosaic, cloud, raster and structured-plan profiles. Implementing one selected profile at a time is sequencing, not silently removing those input families. Optional IFC remains conditional on suitable samples and tested support.

**Do not build eleven upload APIs or eleven applications.** Use a shared source pipeline with type-specific inspectors and purpose-specific rules. Large file bytes go to controlled object storage; relational records keep references/metadata. No public generic proxy fetches arbitrary user URLs, no client receives storage/database/provider secrets, and workers never publish accepted units.

## 6. Sequence and concrete unlocks

| Phase | Vinayak’s critical deliverable | A’s ordered work | B’s ordered work | Integrated exit test |
|---|---|---|---|---|
| 1 — Contracts, fixtures, feasibility | V00; release the needed V01 templates incrementally; demonstrate supported geometry feasibility before leaving this phase | A01 → A02/A03 | B01 → B02 | One common schema/fixture; independent expected checks; basic local services/templates runnable. No need to finish all future contracts. |
| 2 — Manual web + thin online mobile | V02 → V03; close any V01 infrastructure/template dependencies | A04 → A05 → A06 | B03 → B04/B05 → B06 → B07 | Real intake → computed candidate/finding → phone response → correction → separate-reviewer acceptance → same record lookup. Works without AI. |
| 3 — Reliable offline | V04 | A07; selected later-source feasibility only when it does not block the gate | B08 | Airplane-mode capture survives restart/retry; one server response; stale/revoked cases are explicit. |
| 4 — Signature review/change impact | V05 | A08 | B09 | U03 correction and U04 evidence-only impact are explained; new uploads do not rewrite accepted records. |
| 5 — Evaluated assistance/richer inputs | V06 | A09 one profile at a time; then A10 | B10 one implemented profile at a time | Selected adapters produce attributable results; at least one selected, evaluated extraction path works on suitable data; manual fallback remains. |
| 6 — Reuse/exchange/hardening | V07 → V08 | A11 → A12 | B11 → B12 | Second case, qualified corridor/column query, supported round-trip and recovery, real-device and access tests with retained evidence. |

Phase numbers are dependency gates, not calendar estimates. A later task is unblocked by its required contract/helper, not by every unrelated task in the phase being finished. A03/B02 pure work starts immediately; real A04/B03 integration starts only after the corresponding V01 primitives exist. Research for later inputs may proceed while an integration dependency is genuinely blocked, but it cannot quietly replace core delivery. A04 can deliver a simple approved core-data fetch adapter as soon as V01 supports its controlled interface; A09 is for richer profiles, not the first opportunity to implement acquisition. For B, deliver only the minimal functional B04 intake UI before B05/B06; do not postpone the early phone flow for Sources-page polish.

### Fixed source facts for the common case

C-001 is synthetic. U01/U02 occupy 0–3 m; the correct U03/U04 limits are 3–6 m in BM-DEMO-A. BSM-01 occupies −3–0 m in the same local benchmark. E-LEVEL-02 r1 is incomplete; r2 supports 3.0 m only after suitability checks. The deliberate U03 lower limit of 2.8 m produces a 2.8–3.0 m shared interior with U01. U04’s evidence can change without numeric movement. These fixture facts come from 01 §12; exact XY dimensions remain a V00 implementation decision.

### The first complete user journey

1. An authorized user creates/opens C-001 and uploads attributable parcel/plan/level/reference inputs through B’s source APIs.
2. A’s real inspector reports supported metadata/issues; Vinayak’s manual editor constructs candidate units and genuinely computes the deliberate U03/U01 overlap.
3. A targeted RQ-LEVEL-01 request is assigned. B’s real phone flow returns E-LEVEL-02 r2 and receives an attributable response.
4. The preparer confirms suitability and corrects U03’s lower limit from 2.8 m to 3.0 m. Required evidence/relationships and fresh checks accompany the fixed submission.
5. A separate authorized reviewer accepts that snapshot through Vinayak’s transaction. Lookup returns the same accepted prototype record after refresh/relogin.

C-001 has no accepted unit revision before that decision. Common circulation and the basement exist from the foundational geometry. Expanded change-impact tools, offline reliability and corridor planning follow in their prescribed phases; their future contracts must not prevent the core path. Do not postpone baseline permissions/history/exact-revision review to the hardening phase.

## 7. Vinayak’s implementation queue

| ID | Phase | Deliverable | Start | What it unlocks |
|---|---|---|---|---|
| V00 | 1 | **Freeze the minimum shared contracts and fixture conventions.** Approve the first source-manifest/intake, inspection-result, error, request/response and revision conventions; define the synthetic XY layout and local frame without inventing real geolocation. Preserve C-001’s supplied Z values and labels. Publish only the contracts needed next, with schema-valid mocks. Run a small supported-prism feasibility experiment against independent contact/overlap/invalid-reference expectations before phase 1 exits; V02 later turns this into the full production preparation core. | Start now | Unlocks A/B canonical fixtures and pure validators; does not wait for full database or UI. |
| V01 | 1 → 2 | **Provide reusable scaffolding and trusted platform primitives.** Own the monorepo/infrastructure, database migrations, configured identity and separate demo roles, scoped case/create/read/assignment APIs, deny-by-default scope checks, private object storage, upload verification/finalization and revision/idempotency helpers. Provide one tested route, one processor/job template, client mocks, and web/mobile shells. Release each ready template separately. | After the minimum V00 decisions | Unlocks B03 and A04 immediately when their required helpers exist; a mobile shell is not a prerequisite for a source API. |
| V02 | 2 | **Build the supported geometry and preparation core.** Own metric/reference handling, authoritative candidate specifications/revisions, supported-prism construction, validation and independent unit tests, basic evidence component links and manually entered rights/relationship associations, linked plan/3D editing, and request/response rule interfaces. Keep common circulation and basement represented. | After V00 and the relevant V01 building blocks | Unlocks B05/B06 as their contract/rule/shell dependencies are ready; A06 checks spatial results. |
| V03 | 2 | **Build protected review/identity and close the online lifecycle.** Own the exact-snapshot submission, permission/separation-of-duties checks, freshness/concurrency transaction, accepted pointers, stable prototype identity/history and the minimal accepted-record lookup API/page. Integrate the real source, processor and mobile response paths. Keep AI disabled for this gate. | After candidate/source/evidence paths can be integrated | One persisted case moves from intake to separate-reviewer acceptance and lookup. B07 executes it; A checks spatial outputs. |
| V04 | 3 | **Implement the reliable synchronization core.** Own the server protocol and tested client SQLite/outbox primitives, stable operation IDs, retries/receipts, expected revisions, conflict rules, restart recovery, fresh authorization and cache protection/retention policy. | Only after the online field-response path works | B08 wires forms/screens to the primitives; A07 checks source preservation. Whole offline sequence must pass on an actual phone. |
| V05 | 4 | **Implement richer validation, dependencies and comparison.** Own source ancestry/use graph, explicit rebind proposals, affected-record preview, stale-result invalidation, richer relationship/measurement checks, before/after geometry, and protected application of change sets. | After baseline candidate/source/review revisions exist | A08 supplies independent expected impacts; B09 implements support panels and a bounded observed-change report. |
| V06 | 5 | **Implement selected heavy input processing and AI baseline.** Own heavy library compatibility, reference transforms, point-cloud/raster/DXF/optional IFC engines, inference/evaluation design and resource bounds. Select only necessary profiles. Supply a reproducible operation/example before assigning wrappers. | After usable input samples/permissions and manual workflow are established | A09 wraps tested capabilities/acquisition routes; A10 runs evaluation; B10 integrates the declared results. |
| V07 | 6 | **Implement spatial reuse, exchange and lifecycle/recovery core.** Own corridor/column operations, supported export/import, rights/correction/split-merge identity behavior, concurrent updates, upload/security hardening, backup/restore and deployment. Test rules in core, not only through teammate QA. | After declared supported profiles and accepted records are available | A11 checks independent fixtures; B11/B12 implement bounded consumers and run release regressions. |
| V08 | 6 | **Integrate, review evidence and decide the supported release.** Review scoped PRs, integrate the real paths, test precision UI/auth/geometry/sync components you own, run unfamiliar-case/user tasks, and publish the supported/unsupported scope. Retain unresolved defects and actual test evidence. | After the applicable phase gates | Release is a reproducible supported product workflow, not a list of separate demos or a claim of national-scale readiness. |

## 8. A’s task cards

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

## 9. B’s task cards

### B01 — Define input fields, payload examples and intake test scenarios

**Phase:** 1  
**Start condition:** START NOW — use the supplied source documents; no live app is required.

**Do:** List what the user enters, what the file/inspector supplies and what only the server sets for each input type. Draft upload/finalize/list/read/evidence-response examples and an acceptance matrix. Separate structural input validation from purpose-specific suitability. Mark schema proposals for Vinayak approval rather than creating a competing canonical contract.

**Deliver:** `docs/intake/input-fields.md`; request/response fixture drafts; valid/invalid/missing-metadata/stale/denied scenarios; questions that V00 must resolve.

**Done when:** The examples cover parcel, plan, level/control records and request-linked photos/notes first, with all richer inputs inventoried. Actor, accepted status, accepted pointers, authoritative revision and server timestamps are not trusted client fields.

**Boundary:** Do not design a separate backend, automatic legal approval, storage access policy or independent geometry schema.

**Handoff to:** Vinayak freezes the shared contract; A supplies actual file/metadata examples.

### B02 — Build pure intake validators and a schema-driven API test collection

**Phase:** 1  
**Start condition:** START NOW with fixtures/tests and pure functions; adopt V00 shared schema exports before integration. No database or frontend is needed.

**Do:** Validate the agreed metadata envelope and request shapes in TypeScript. Test source type, purpose, optional/required fields, explicit unknown values, operation IDs and expected revision fields. Create request examples/test helpers using mocked transport and clearly labelled fake responses. Do not turn the mock into a second production API.

**Deliver:** Tests under the agreed platform-test area; reusable intake validators using `packages/contracts`; API request collection or equivalent scripts; schema-valid mock examples.

**Done when:** Good examples pass; malformed requests fail with field-level messages. A source can be received yet require metadata for a particular purpose. Fake responses are labelled and cannot count as real endpoint evidence.

**Boundary:** No hardcoded permissive auth, duplicate contract definitions, guessed measurement units or client-controlled acceptance. Integration of parsers into the canonical packages is reviewed by Vinayak.

**Handoff to:** B03/B05 reuse the validators and tests; Vinayak’s clients consume the same schemas.

### B03 — Implement source upload, finalization and scoped read APIs

**Phase:** 2  
**Start condition:** After V01 provides the tested access wrapper, database helpers/migrations, storage/finalization primitives and one example route. Do not wait for geometry or review screens.

**Do:** Implement the approved thin routes for upload sessions, source finalization, case source listing, source detail and authorized read links. Wire metadata validation, immutable original/version registration, stable source references and standard errors through Vinayak’s helpers. Test retries and revision conflicts. Reuse the trusted byte/type/integrity/finalization checks rather than trusting filename or a client success flag.

**Deliver:** Handlers under `apps/web/app/api/v1`; service tests; request examples; documented real endpoints and supported limits.

**Done when:** An authorized client uploads a supported fixture and reopens the same registered original. Repeating the same logical operation creates no duplicate revision. Changed payload under a reused operation key is rejected according to V01 rules. Cross-project reads are denied; partial/mismatched uploads are not finalized; a genuinely new source version does not overwrite the old one.

**Boundary:** Vinayak owns auth policy, database migration approval, private storage policy and transaction/idempotency primitives. Do not expose raw object keys as public access, introduce arbitrary remote-URL fetching, or deduplicate distinct evidence records solely by matching geometry/file hash.

**Handoff to:** A04 consumes registered source references; B04/B06 and Vinayak’s editor consume real source APIs.

### B04 — Build the ordinary Sources list and intake forms

**Phase:** 2  
**Start condition:** After the relevant B03 endpoints and Vinayak’s web shell/design components are available.

**Do:** Build source list/detail/metadata forms, upload progress, inspection status and field-level error displays. Use the shared client. Show received, processing, needs metadata, blocked and usable-for-stated-purpose distinctly. Open authorized source references and recover from expired read links without replacing the stable source ID.

**Deliver:** Bounded Sources components/pages; integration tests against the real APIs; screenshots only for states actually exercised.

**Done when:** The C-001 files can be added, inspected and reopened after refresh. Upload failure and metadata correction are usable. A received file is not visually represented as an accepted unit or universally suitable evidence.

**Boundary:** Vinayak owns the precision plan/3D editor, alignment and measurement logic. Stay within the assigned Sources component boundary.

**Handoff to:** Vinayak integrates these screens into the case workspace.

### B05 — Implement bounded evidence-request and response persistence

**Phase:** 2  
**Start condition:** After V02/V03 publish the request/response schemas and server permission/state-transition helpers. Implement each endpoint when its specific dependency is ready.

**Do:** Wire scoped request reads and approved create/assignment/response handlers. A response includes case/request/component, finalized attachment/source references, note/measurement metadata, client operation ID and expected revision where required. Actor identity and receipt/revision fields come from the server. Reuse the core rule functions; retain attribution and original response context.

**Deliver:** Evidence request/response handlers; valid/denied/stale/retry tests; concrete C-001 examples for RQ-LEVEL-01 and E-LEVEL-02 r2.

**Done when:** An authorized response produces one attributable receipt across retries and is visible under the same request on web/mobile. Uploading or receiving evidence does not approve geometry, automatically change source bindings or clear suitability requirements.

**Boundary:** Vinayak owns review/readiness rules, exact-snapshot decisions and concurrency mechanisms. Do not implement a generic PATCH allowing arbitrary request or unit states.

**Handoff to:** B06 uses the online task loop; Vinayak uses received evidence for correction and review.

### B06 — Implement the thin online mobile task flow

**Phase:** 2  
**Start condition:** After Vinayak supplies the Expo shell, working login/client example and navigation primitives, and B03/B05 expose the required APIs.

**Do:** Build assigned task list, task/request detail, permitted photo/note/file attachment, online submit and explicit server receipt. Add the simple My tasks/Team assignment-and-progress views for an authorized administrator using existing guarded endpoints. Wire a permitted basic lookup summary when its endpoint exists. Keep detailed preparation and acceptance on web.

**Deliver:** Assigned mobile screens/components; real API integration; Android-device test steps/results for the request and administrator flow.

**Done when:** An actual phone opens RQ-LEVEL-01, sends evidence and shows the same response/source IDs on web. Restart after acknowledged receipt reopens persisted server data. Unauthorized team actions are denied server-side. Network failure is visible; offline durability is not advertised yet.

**Boundary:** Vinayak owns native setup/auth plumbing, shared design, precision interactions and later offline architecture. Do not add phone spatial acceptance or build a separate app per role.

**Handoff to:** V03 uses this as part of the first complete online case.

### B07 — Run the complete online case and cross-role API regressions

**Phase:** 2  
**Start condition:** After V03 makes the manual online workflow testable. Each endpoint’s own tests remain mandatory before this point.

**Do:** Run the prepared case: intake → inspection → candidate → finding → request → phone response → correction → fixed submission → separate-reviewer decision → identifier lookup. Check wrong role, self-review, guessed cross-project IDs, stale snapshot, duplicate submission/decision and processing failure. Confirm persistence after refresh/relogin.

**Deliver:** Repeatable API/integration scripts plus actual web/phone test record; request/snapshot IDs and concise defects assigned to their code owner.

**Done when:** A supported manual case works with AI disabled. Before acceptance there is no accepted unit revision; afterwards lookup resolves the same accepted revision. Planned checks are marked not run until executed.

**Boundary:** B runs independent user/service tests; Vinayak still owns automated core auth/review/concurrency tests and fixes those components. A checks spatial expectations separately.

**Handoff to:** The team uses this gate before offline, advanced AI or planning expansion.

### B08 — Integrate the supplied offline primitives and explicit Sync UI

**Phase:** 3  
**Start condition:** After V04 supplies the tested SQLite/outbox core, stable-operation protocol, server receipt/conflict endpoints and sensitive-cache policy.

**Do:** Connect assigned forms to the shared durable draft/outbox helpers. Build work-pack download, Sync queue, retry and conflict/access-expired displays. Use the specified resolution actions; keep foreground sync available. Test capture in airplane mode, force-stop/reopen, interrupted transfer, duplicate retry, stale server data and revoked access on a real Android device.

**Deliver:** Offline form and queue integration; actual-device regression script/results; server/client IDs showing one response after retries.

**Done when:** Local drafts survive restart; the queue distinguishes Saved locally, Queued, Uploading, Received, Failed, Conflict and Access expired. Conflicting observations are retained rather than silently overwritten. Sensitive caching stays off unless the approved protection/retention tests pass.

**Boundary:** Do not design sync/conflict/security policy yourself or equate SQLite persistence with reliable synchronization. Vinayak owns those algorithms and the shared core implementation.

**Handoff to:** Vinayak integrates V04; A07 verifies source/reference preservation.

### B09 — Build findings, evidence and change-impact support panels

**Phase:** 4  
**Start condition:** After V05 provides stable findings/dependency/preview endpoints and Vinayak’s linked-view interactions.

**Do:** Build bounded evidence tables, actionable request forms, affected-unit lists, before/after metadata and stale-check states. Use source revision/date labels and distinguish geometry movement from evidence-only change. Add the mobile Report observed change form when its guarded case-creation route exists.

**Deliver:** Support panels and mobile report form; contract/integration tests against C-001 and a labelled later update case.

**Done when:** U04’s changed evidence is visible even when its coordinates do not move. Observed/recorded differences are not automatically labelled violations. Reporting an observation opens a case instead of changing accepted geometry.

**Boundary:** Vinayak owns geometry highlighting, linked 3D comparison, the dependency engine and protected change application.

**Handoff to:** Vinayak runs the signature review task; A08 checks its data semantics.

### B10 — Connect richer import forms, processing states and proposal review

**Phase:** 5  
**Start condition:** After each A09/V06 profile has a real tested operation and frozen result/error contract. Do not expose a profile merely because an upload extension is supported.

**Do:** Add source-type/purpose choices, implemented profile options, bounded job progress/cancel/retry displays and editable proposal lists. Use the same upload/processing APIs. Preserve model/source lineage and manual fallback. Distinguish selecting a proposal for editing from accepting a reviewed unit.

**Deliver:** Per-profile intake/job/proposal UI; real-service integration tests for success, unsuitable input and processing failure.

**Done when:** Every enabled choice has a declared useful result and honest limitations. AI failure leaves manual preparation available; stale results remain associated with their original inputs.

**Boundary:** Vinayak/A own processor/model results. Do not fabricate success, confidence-based acceptance or support for every file carrying a familiar extension.

**Handoff to:** Vinayak integrates the assistance workflow; A10 measures correction effort separately.

### B11 — Implement registry lookup and bounded planning/exchange UI

**Phase:** 6  
**Start condition:** After V07 publishes scoped registry/query/export endpoints and their supported profiles.

**Do:** Build identifier search, accepted-record summary/history, permitted export controls and ordered vertical-column results. Connect corridor result lists to Vinayak’s viewer. Keep reference/time/coverage labels, permission errors and restricted evidence behavior visible.

**Deliver:** Registry/lookup/query-result components; request examples; positive/negative and export-access tests.

**Done when:** Lookup returns the accepted record by default, with draft inspection an explicit separate mode. No match is not described as clear/safe land. Export never exposes evidence beyond the authorized policy.

**Boundary:** Vinayak owns spatial queries, conversion semantics, lifecycle identity rules and permission policy.

**Handoff to:** V08 integrates the product release; A11 checks query/exchange expectations.

### B12 — Execute hardening, recovery and actual-device release tests

**Phase:** 6  
**Start condition:** After V07/V08 provide a test environment, restore/reset runbook and the supported full workflow. Maintain earlier regression tests throughout.

**Do:** Run the second case; supported export/re-import; retry/failure/regression tests; clean-environment startup/restore; and web/mobile narrow-screen, keyboard, touch, loading, permission and validation checks. Exercise concurrency/security scenarios using Vinayak’s test harness. Record only actual results and retain unresolved defects.

**Deliver:** Final integration/device report; repeatable commands and test steps; defect list with owner; proof that lookup still works after the declared restore/import.

**Done when:** Another contributor can follow the runbook and reproduce the supported case. Recovery retains the stated IDs/revisions/relationships and access restrictions. Remaining mocks, unsupported features and unexecuted tests are explicit.

**Boundary:** Vinayak owns infrastructure, secure configuration, database migrations and restore mechanism; B executes and improves the runbook/tests. Do not run destructive recovery tests on live/personal data.

**Handoff to:** V08 release decision and future maintainers.

## 10. Working rules that prevent bottlenecks

**Limit concurrent work.** Each teammate keeps one primary implementation packet active. Finish its tests and handoff before opening another substantial feature. A small independent research/test fallback is allowed when the required dependency is explicitly blocked; do not turn that into an unlimited backlog of unfinished experiments.

**Vinayak reviews the mechanism once, not every routine line.** Supply tested policy/storage/version helpers and a reference route, then let B own the remaining bounded implementation and defects. Supply a tested processing template, then let A own its inspectors/adapters. Domain changes come back for review; ordinary code completion stays with the assignee.

**Promote responsibility by observed delivery.** After a teammate has independently delivered and tested one bounded endpoint/adapter/screen, delegate another in the same pattern. Bigger mechanisms such as reference transforms or concurrent acceptance are not assigned just to make workloads numerically equal.

**No silent mock replacement.** Record exactly when a screen/consumer changes from mock transport to a real service. Every task’s `done` statement requires the appropriate real producer/consumer, not merely attractive sample output.

**Use explicit blocked-work reports.** Name the task, missing artifact, producer and a reproducible issue. “Waiting for backend” is not specific enough. Example: “B03 blocked: V01 `finalizeVerifiedUpload` helper lacks a defined duplicate-payload result.” A can continue A01/A02 research; B can continue field/error tests without inventing behavior.

**Keep one coherent case and separate test collections.** C-001 is the repeatable case; adapter fixtures test formats independently; model-development data is separate with held-out evaluation. Source age, permission and quality must survive acquisition, upload, processing, mobile sync and export.

**Do not make QA a dumping ground.** All three authors test their own code. A/B independent test work is additional verification, not a substitute for Vinayak testing auth/geometry/review/sync internals. Defects go back to the accountable code owner.

## 11. Definition of done and handoff

A task is ready to review only when its handoff includes:

- Task ID, changed paths, what works, required inputs and the exact next consumer.
- Contract/profile version and schema-valid request, response and error examples.
- Fixture files/IDs, expected result, actual test command/result and known unsupported cases.
- Any source permission/provenance/measurement limitations relevant to its output.
- Explicit status: **not started**, **in progress**, **blocked**, **contract-ready**, **mock-ready**, **implementation-ready**, or **integration-verified**. A blocked task names the missing artifact and its owner.

`Contract-ready` means the reviewed schema/states/limits exist. `Mock-ready` adds deterministic fixture responses. `Implementation-ready` means the real component runs with its checks. `Integration-verified` means its actual consumer has used the real result. These are different pieces of evidence, not interchangeable labels.

An API task is not complete because a route exists. A research task is not complete because it contains links. A parser is not complete because it prints JSON. A screen is not complete while its claimed capability is still mocked. Device behaviour is not verified by a web screenshot.


Use [the task handoff template](templates/TASK_HANDOFF_TEMPLATE.md), [source register template](templates/SOURCE_REGISTER_TEMPLATE.md) and [acceptance scenarios](templates/ACCEPTANCE_SCENARIOS.md). None of the scenarios in this pack has been executed by creating this plan.

## 12. Scope protections and review of this allocation

Preserved: two clients/one registry; Next.js TypeScript application API; private Python/FastAPI/Celery processing; PostgreSQL/PostGIS; private object storage; Expo/SQLite mobile; nine modules; six phases; manual-before-AI; online mobile early; evidence/measurement/reference/ancestry/time semantics; distinct preparation/review; stable prototype identity and preserved supplied ULPINs.

Changed deliberately: staffing and merge ownership; Vinayak owns complex backend and infrastructure instead of being confined to frontend. A/B own narrower engineering packets with provided primitives and independent testing. Ordinary mobile/forms work is delegated after the relevant core exists. The later phases remain baseline scope, not silently deleted to fit the smaller skill set.

Not established: current data availability, authority to issue official 3D ULPINs, real government integration, completed code, implemented security, data permissions, model performance, deployed infrastructure or actual test outcomes. Where the supplied documents leave a detail open, this plan either makes an explicitly proposed implementation choice or gives the decision to V00/V06 rather than inventing an external fact.

### Internal source basis

- 01 §§4–6, 8–13: applications/roles, input meaning, evidence lifecycle, geometry limits and C-001 facts.
- 02 §§2–3, 5–15: stack/modules, intake and processing split, shared contracts, review/sync boundaries and six-phase sequence.
- Original 03 §§2–4, 11–14: prior staffing baseline, contract readiness, source handoff and testing discipline. Its incompatible staffing instructions are superseded above.
- Reviewed addendum §§2–7: evidence, lineage/time, dataset cautions, conditional IFC, comparison and phased extensions.
- Latest user instruction: team skills, Vinayak’s across-stack role and a separately assignable now/later task plan. Task IDs and the revised ownership are this plan’s implementation proposal.
