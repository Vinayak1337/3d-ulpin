# Teammate B — Start Now and Later Assignment

**3D Property Registry · 12 September 2026 · Planning only; tasks are not marked executed**

## Your responsibility

**Input/storage APIs, ordinary web/mobile screens and workflow tests.** This assignment fits basic backend/frontend/app experience by giving you bounded engineering deliverables and a supplied integration pattern. It is not an assignment to build a whole specialist backend.

Vinayak is the technical lead and owns architecture, shared contracts, security, geometry, review transactions, sync design and difficult processing. The other teammate owns their separate packet. You remain accountable for completing, documenting, testing and fixing the code assigned here.

**Start now:** B01 → B02. You can write input-field decisions, payload fixtures, pure validators and request tests before the live backend exists. B03 becomes a real implementation task as soon as Vinayak’s guarded route/storage/database helpers are ready.

**Boundary:** Do not independently design authentication/authorization, idempotency/concurrency, geometry, review acceptance, migrations or conflict resolution. Vinayak provides tested shared mechanisms. You own the assigned endpoints/screens, their tests and their defects—not the entire platform.

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
| B01 — Define input fields, payload examples and intake test scenarios | 1 | START NOW — use the supplied source documents; no live app is required. |
| B02 — Build pure intake validators and a schema-driven API test collection | 1 | START NOW with fixtures/tests and pure functions; adopt V00 shared schema exports before integration. No database or frontend is needed. |
| B03 — Implement source upload, finalization and scoped read APIs | 2 | After V01 provides the tested access wrapper, database helpers/migrations, storage/finalization primitives and one example route. Do not wait for geometry or review screens. |
| B04 — Build the ordinary Sources list and intake forms | 2 | After the relevant B03 endpoints and Vinayak’s web shell/design components are available. |
| B05 — Implement bounded evidence-request and response persistence | 2 | After V02/V03 publish the request/response schemas and server permission/state-transition helpers. Implement each endpoint when its specific dependency is ready. |
| B06 — Implement the thin online mobile task flow | 2 | After Vinayak supplies the Expo shell, working login/client example and navigation primitives, and B03/B05 expose the required APIs. |
| B07 — Run the complete online case and cross-role API regressions | 2 | After V03 makes the manual online workflow testable. Each endpoint’s own tests remain mandatory before this point. |
| B08 — Integrate the supplied offline primitives and explicit Sync UI | 3 | After V04 supplies the tested SQLite/outbox core, stable-operation protocol, server receipt/conflict endpoints and sensitive-cache policy. |
| B09 — Build findings, evidence and change-impact support panels | 4 | After V05 provides stable findings/dependency/preview endpoints and Vinayak’s linked-view interactions. |
| B10 — Connect richer import forms, processing states and proposal review | 5 | After each A09/V06 profile has a real tested operation and frozen result/error contract. Do not expose a profile merely because an upload extension is supported. |
| B11 — Implement registry lookup and bounded planning/exchange UI | 6 | After V07 publishes scoped registry/query/export endpoints and their supported profiles. |
| B12 — Execute hardening, recovery and actual-device release tests | 6 | After V07/V08 provide a test environment, restore/reset runbook and the supported full workflow. Maintain earlier regression tests throughout. |

## Detailed assignments

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

## Application endpoints you will help implement

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
