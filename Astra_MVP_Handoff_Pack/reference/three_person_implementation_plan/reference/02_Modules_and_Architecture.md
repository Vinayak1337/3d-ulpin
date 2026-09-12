# 3D Property Registry — Modules and Architecture

**Document 2 of 4 · Consolidated nine-module baseline · 12 September 2026**

## 1. Purpose and authority

This document packages the established module-by-module build architecture. It preserves nine functional modules and the six dependency-based delivery phases from the earlier plan, incorporates the selected comparison-report refinements, and gives each module concrete inputs, outputs, connections and completion tests.

[01_Product_Problem_and_Solution.md](01_Product_Problem_and_Solution.md) defines product meaning and scope. [03_Three_Person_Implementation_Plan.md](03_Three_Person_Implementation_Plan.md) assigns these responsibilities to Vinayak and Contributors A/B. [04_Product_Video_Production_Plan.md](04_Product_Video_Production_Plan.md) explains their user-facing purpose without narrating the development phases.

This is a proposed architecture, not evidence of implemented APIs, tested integrations or achieved performance. Route names, schema fields and job-state contracts below are explicit implementation proposals that make the earlier responsibilities actionable. Freeze and test them before parallel code depends on them.

## 2. Architecture decision: one registry, two clients, two backend responsibilities

Retain the existing TypeScript application API and private Python processing split. There is no justification in the supplied material for replacing it with a second competing application backend.

- **Web client:** Next.js/React/TypeScript, Tailwind/shadcn-style UI, CesiumJS, and a focused plan editor.
- **Native client:** Android-first Expo/React Native/TypeScript; local SQLite drafts/outbox; secure token storage; document/photo capture; lightweight plan and record views.
- **Application API:** versioned REST under `/api/v1`, implemented in the Next.js server and shared TypeScript domain packages. It owns authorisation, cases, source registration, registry writes, workflow decisions, review and identity publication.
- **Identity:** proposed Keycloak/OpenID Connect integration. Web uses a suitable server-managed session; native uses the browser-based authorisation-code/PKCE flow. Role and record checks remain application responsibilities.
- **Registry:** PostgreSQL/PostGIS. Keep relational evidence, rights, revision and dependency data alongside supported spatial geometry. Test the required extension set in the actual deployment image.
- **Evidence storage:** private S3-compatible object storage for original and derived files, with authorised upload/finalisation and controlled reads.
- **Processing API:** private FastAPI/Python endpoints accepting typed work specifications and authorised source references. It exposes extraction, normalisation, construction and spatial-validation work—not a duplicate case/review system.
- **Workers:** Celery jobs through Redis. Geospatial/AI operations run outside normal browser/mobile request lifetimes. Workers write staging artifacts and technical results; application logic accepts and publishes records.

```text
Web UI -----------------------+
                              +--> Application API / access / workflow --> Registry
Mobile UI + local drafts -----+                  |
                                                 +--> upload/read authorisation
                                                 |           |
                                                 |           v
                                                 |     Private object storage
                                                 |
                                                 +--> durable job record / dispatch
                                                          |
                                                          v
                                               Private FastAPI processing
                                                          |
                                                    Celery / Redis
                                                          |
                                                  Python processing
                                                          |
                                             staging results / findings
                                                          |
                                                          v
                                              Application API / review
```

A direct signed file transfer bypasses the API for **file bytes**, not authorisation. The database holds metadata and references, not the full point cloud. A mobile cache is not a second accepted registry. Display meshes are derived from stored boundary specifications and cannot redefine accepted measurements.

### State ownership

The application backend owns the user-visible job record, source registration, case/readiness state, submissions and decisions. The processing subsystem owns execution details and technical outputs. A worker success event means that a declared computation completed—not that a source is legally authoritative or a unit has been accepted.

Job completion is ingested idempotently. Repeated callbacks or polling responses cannot publish duplicate results. A durable dispatch record/outbox connects application transactions to queued processing. Long work must be recoverable without accepting partial results.

## 3. Nine modules, not nine deployed microservices

| Module | Primary outcome | Backend responsibility | User-facing location |
|---|---|---|---|
| M1 Cases, users and access | A scoped case with responsibilities and next work. | Application. | Work queue, case setup, Settings, mobile Team/tasks. |
| M2 Field capture and synchronization | Attributable field responses with explicit receipts/conflicts. | Application sync protocol; native outbox. | Mobile Tasks/Lookup/Sync; web response inbox. |
| M3 Import, provenance and normalization | Original sources plus usable, attributable derived inputs. | Application intake + geospatial processing. | Sources and processing status. |
| M4 Assisted extraction | Editable proposals with run metadata. | Geospatial/AI processing. | Assisted tools in source/unit workspace. |
| M5 Spatial-unit construction and editing | Explicit candidate boundaries and evidence links. | Geometry construction + application revisions. | Linked plan/3D editor. |
| M6 Validation and evidence requests | Explained findings and precise next actions. | Spatial checks + application evidence/workflow rules. | Findings and field requests. |
| M7 Change-impact and dependencies | Affected records and proposed updates. | Application dependency graph + geometry recomputation. | Changes and Compare. |
| M8 Review, stable identity and history | A decision on an exact, current submission. | Application transactions and identity lifecycle. | Review and History. |
| M9 Search, exchange and planning | Retrievable records and qualified spatial reuse. | Application queries/export + spatial computation. | Registry, Planning and permitted mobile lookup. |

Each module has an implementation boundary. Some span clients and backend subsystems, but each task in Document 3 has one accountable contributor.

## 4. M1 — Cases, users and access

### Purpose

Identify who can work on a case, what work is assigned and which action is next. Login, project scope and revision history are part of the first complete lifecycle—not optional late polish.

### Inputs and outputs

**Inputs:** authenticated identity, granted memberships/roles, project, case type, parcel reference, assignments and configured evidence/review policy.

**Outputs:** permission-scoped case, assigned tasks, effective capability response and case summary/readiness information. Actor identity is derived from authentication, not trusted from a client-supplied `actor` field.

### Deliverable behaviour

The API lists only permitted cases; creates a draft idempotently; validates assignments; exposes allowed actions for the selected project; and checks access to every case, source, query and export. Several roles can be granted to one account. A workspace selection does not grant permissions. Administration and spatial acceptance remain distinct.

### Contract surface

`GET /api/v1/me/context`; `GET/POST /api/v1/cases`; `GET /api/v1/cases/{id}`; assignment and membership routes with expected-revision checks. Settings updates record policy/version changes that may affect review freshness.

### Connections and completion test

Every module uses M1 scope. M2 receives assigned work packs; M8 rechecks review authority. Complete when a permitted user sees their cases, a guessed cross-project URL does not expose records, an assignment is acknowledged only after server acceptance, and a preparer cannot self-approve under the demo policy.

## 5. M2 — Field capture and synchronization

### Purpose

Return evidence to the exact request/component instead of accumulating an unlinked photo folder. Keep useful fieldwork possible without continuous connectivity.

### Inputs and outputs

**Inputs:** assigned task/work-pack version, request/component ID, permitted photo/note/file, source/provider information, contextual capture metadata and client operation ID.

**Outputs:** persistent local draft, queued operation, upload receipt, registered evidence response or actionable conflict with the original context retained.

### Deliverable behaviour

Mobile downloads a bounded authorised pack while connected. SQLite stores local metadata and operations; the app stores permitted attachments under an explicit cache policy. Sync retries the same operation ID and checks expected server revision. Independent observations can append; source replacement and conflicting record changes require comparison. A source family can be referenced offline, but the authoritative revision/ID is confirmed by the server at receipt.

Use `Saved locally`, `Queued`, `Uploading`, `Received`, `Failed`, `Conflict`, and `Access expired` distinctly. The operating system's background opportunities are not treated as guaranteed delivery; foreground sync remains available. Token/key storage is separate from file-cache encryption. Restrict offline sensitive files until encryption and retention are tested.

### Contract surface

`GET /api/v1/work-packs/{caseId}`; `POST /api/v1/sync/operations`; `GET /api/v1/sync/operations/{operationId}`; evidence-response endpoints linked to M6 requests; M3 upload session/finalisation. No offline/native final acceptance route is exposed.

### Connections and completion test

M1 supplies scope/assignment, M3 registers files, M6 consumes evidence responses and M8 later reviews the new snapshot. Complete when airplane-mode capture survives restart, interrupted uploads retry without duplicate domain responses, stale edits preserve evidence and report a conflict, and revoked access is rechecked at reconnection.

## 6. M3 — Import, provenance and normalization

### Purpose

Establish what an input is, where it belongs, what it can support and what transformations were applied. Separate acquiring external data from extracting data already supplied.

### Inputs and outputs

**Inputs:** supported file plus source manifest, access/license information, case link, declared reference/units, source date/version and intended processing purpose.

**Outputs:** immutable original/source revision, inspection report, normalised assets, source-ancestry/transform links, purpose-specific usability status and errors requiring correction.

### Deliverable behaviour

The application creates an upload slot only after authorisation, checks finalisation, and registers the source revision once. The processor inspects allowlisted formats and bounds resource use. It reports missing reference data instead of guessing; preserves original coordinates/files; and records the transformation/version for each derivative.

Initial plan-based adapters cover parcel vector data, reference/control CSV and plan references with manual tracing. Richer raster/point-cloud/DXF paths follow declared profiles. PDF/image support means reference rendering/inspection and assisted/manual interpretation, not universal automatic plan understanding.

Optional IFC is a separate profile: inspect units, placements, storeys/spaces and geometry availability, preserve IFC entity links, return candidates/unsupported entities, and require human mapping to units. It does not replace the plan-based path.

### Contract surface

`POST /api/v1/sources/upload-sessions`; `POST /api/v1/sources/{id}/finalize`; `POST /api/v1/processing-jobs` with `operation=inspect|normalize|parse_plan|parse_ifc`; `GET /api/v1/processing-jobs/{id}`. The private `/internal/v1/jobs` accepts controlled source references, operation version and options—not arbitrary URLs, shell commands or filesystem paths.

### Connections and completion test

M3 feeds M4/M5, creates M6 metadata issues, and records M7 ancestry/dependencies. Complete when the same input/parameters can reproduce a declared derivative, missing units/reference fail visibly, permission restrictions survive derivative creation, and a file received successfully can still be marked unusable for the intended task.

## 7. M4 — Assisted extraction

### Purpose

Reduce appropriate tracing work without assigning legal meaning to visual regions.

### Inputs and outputs

**Inputs:** suitable normalised imagery or plan region, an explicit task/model configuration, source revision and optional prompts/control inputs.

**Outputs:** candidate polygons/regions, raw scores where meaningful, run metadata, warnings and editable proposal IDs. They are not accepted units or calibrated legal-confidence scores.

### Deliverable behaviour

Begin with a task-specific building-footprint baseline in PyTorch/TorchGeo, polygonisation and held-out evaluation. A promptable plan selection aid such as SAM 2 is optional. Store model/weights version, preprocessing, input source revision and parameters. Preserve a manual path to M5 when inference is unavailable or unsuitable.

Point-cloud floor-level proposals require observations of the relevant surfaces. Airborne or exterior scans do not automatically support interior segmentation. Automatic observed-change detection is later scope; it may create a review-case proposal, never mutate accepted records.

### Contract surface

The standard processing-job envelope uses `operation=extract_footprint|segment_plan`; input-purpose validation rejects unsupported combinations. Result proposals include geometry/reference metadata and source/model ancestry. A model notebook without a runnable processor/API result is not a completed module.

### Connections and completion test

M3 provides inspected inputs; M5 consumes proposals; evaluation outputs remain separate from registry acceptance. Complete when inference runs on held-out data, proposals can be corrected, failure permits manual work, and raw prediction performance is reported separately from human-corrected outputs and correction time.

## 8. M5 — Spatial-unit construction and editing

### Purpose

Convert an interpreted outline and supported height limits into an explicit volume, with evidence attached to its defining components.

### Inputs and outputs

**Inputs:** footprint, lower/upper limits, common reference/units, boundary profile, unit type, physical-asset/parent links, source bindings and expected working revision.

**Outputs:** candidate geometry revision/specification, measurement basis and derived quantities, source-component relationships, construction result and display asset reference.

### Deliverable behaviour

Web editing links tree, plan and 3D selection. Four evidence components—footprint, lower limit, upper limit and alignment—are sufficient initially. Common spaces remain explicit. Observed/Recorded/Compare views switch display layers, not source-of-truth geometry.

Construction validates its declared input family and returns a supported solid/boundary representation. Working drafts can retain explicitly unverified values under policy but cannot pass evidence requirements merely because a shape renders. The viewer may preview locally while editing; stored measurements and submission geometry come from the tested authoritative specification.

### Contract surface

`POST /api/v1/units/{id}/revisions`; revision reads; a construction job with the candidate snapshot and reference profile. Use expected revision/fingerprint for edits. Derived quantities return method, units and supported geometry type, not unexplained decimals.

### Connections and completion test

M3/M4 provide sources/proposals, M6 checks geometry, M7 compares revisions, M8 submits/accepts, and M9 displays/exports accepted versions. Complete when one unit can be reconstructed from stored inputs, common space is separate, unsupported shapes do not flatten silently, and changing browser display settings does not change stored boundaries.

## 9. M6 — Validation and evidence requests

### Purpose

Turn spatial and source issues into understandable, version-bound findings and assignable next actions.

### Inputs and outputs

**Inputs:** candidate and relevant neighbouring revisions, declared relationships/coverage model, effective periods, source bindings, measurement basis, reference metadata, configured numerical tolerances and evidence policy version.

**Outputs:** findings with stable rule IDs, input snapshot, severity/category, affected geometry, relevant evidence, explanation, next action and review-readiness effects; linked evidence requests/responses.

### Deliverable behaviour

Separate spatial checks from administrative/evidence checks. Test supported solid validity, positive-volume intersection, relevant relationships, unknown datums, incompatible measurement conventions, stale checks and required evidence. A valid mesh can still lack evidence. A building containing a unit is not treated as a competing exclusive unit. Completeness/no-gap checks require a declared complete partition.

An evidence request identifies the missing component, acceptable type of response, project reference, assignee and status. Request completion and source receipt do not force acceptance. Unknown measurement quality remains unknown; an optional narrow vertical-uncertainty check can request better evidence without inventing probability.

### Contract surface

Validation processing jobs; `GET /api/v1/cases/{id}/findings`; `POST /api/v1/evidence-requests`; response routes with expected state/revision. A finding has a rule version and stays associated with the inputs originally checked.

### Connections and completion test

M2 collects responses; M3 validates source suitability; M5 performs corrections; M7 invalidates stale snapshots; M8 applies readiness rules. Complete when contact, actual overlap, permitted containment, missing datum, incomparable measurement basis and stale evidence yield distinct expected outcomes and useful next actions.

## 10. M7 — Change-impact and dependencies

### Purpose

Show the consequences of a proposed update before accepting it. Distinguish a changed source dependency from a newly observed physical change.

### Inputs and outputs

**Inputs:** proposed source binding/revision, unit boundary or relationship update, existing dependency graph and expected current snapshot.

**Outputs:** affected-record list, reason per dependency, candidate before/after differences, stale result list, recomputation/re-review requirements and a change-set reference.

### Deliverable behaviour

Relational edges connect source revisions, component bindings, geometry revisions and validation runs. Source ancestry records derivation; dependency edges record use in records. A new upload does not automatically rebind every consumer. An explicit proposed change computes scope and creates candidates. Avoid cycles in derived-source ancestry.

U04 can be affected without numeric movement because its evidence snapshot changes. After initial acceptance, the current accepted version remains intact while an update is proposed. A manual mobile observed-change report opens a case; automatic observation comparison is a later case producer using the same review mechanism.

### Contract surface

`POST /api/v1/change-previews`; `GET /api/v1/change-previews/{id}`; application of a fresh preview creates candidate revisions, never accepts them. Processing recomputes geometry/checks where necessary; the application determines dependency scope and workflow.

### Connections and completion test

M3/M5 trigger proposals; M6 reruns checks; M8 reviews; M9 can expose permitted history. Complete when a level-source update identifies U03/U04, explains geometry versus evidence-only impact, and does not mutate current accepted records or reuse stale checks.

## 11. M8 — Review, stable identity and history

### Purpose

Record an authorised decision on a precise submission and publish a stable prototype identity with traceable revisions.

### Inputs and outputs

**Inputs:** fixed unit/source revision set, required relationship/evidence records, validation snapshot, relevant-neighbour snapshot, policy version and reviewer decision/reason.

**Outputs:** accepted/returned submission, decision and audit event, accepted revision pointers, published/resolved prototype IDs and lineage updates.

### Deliverable behaviour

The application checks authorisation, separation of duties, snapshot freshness and configured requirements inside the decision transaction. Account for concurrent changes to relevant neighbours, not only the selected unit. Implementation must choose/test appropriate locking or serializable retry/invalidation semantics; a check performed before an unprotected write is insufficient.

Internal IDs exist for drafts. Published prototype identity is associated with accepted records; a retry resolves the same result. Rights changes retain identity as appropriate, corrections version geometry, splits/merges create successors. Original official ULPINs stay unchanged. Identity publication does not create title.

Version history is application-controlled and attributable, not claimed tamper-proof against every administrator. Distinguish source date, effective time, recorded time, submission time and decision time.

### Contract surface

`POST /api/v1/submissions`; `GET /api/v1/submissions/{id}`; `POST /api/v1/submissions/{id}/decision` with expected snapshot and idempotency key. Return specific stale/permission/requirements errors; never a generic success when conditions fail.

### Connections and completion test

Reads M1/M3/M5/M6/M7 and publishes to M9. Complete when stale, cross-project, wrong-role and self-approval cases fail as designed; concurrent relevant changes cannot silently inherit approval; and repeated issuance creates no duplicate identity.

## 12. M9 — Search, exchange and planning

### Purpose

Make reviewed information retrievable and useful without discarding references, permissions or uncertainty.

### Inputs and outputs

**Inputs:** identifier/alias query, permitted filters, selected revision/time context, export profile, or a defined vertical-column/corridor geometry.

**Outputs:** authorised record view/history, supported exchange package, or known-space query results with coverage, source dates and applicable caveats.

### Deliverable behaviour

Registry search returns accepted records by default. Draft inspection is an explicit preparation/review mode. A vertical column is a defined point/footprint and elevation scope; results are ordered by elevation. Corridor queries compare supported volumes and report known intersections/parcel candidates without declaring excavation safety or legal relationships automatically.

Export combines the supported geometry, reference metadata, identities, record relationships and lineage. Private evidence bytes are included only under authorised export policy; otherwise preserve resolvable/restricted source references. A physical CityJSON model alone is not the complete administrative registry package. Re-import validates permissions and the declared supported profile.

### Contract surface

`GET /api/v1/registry/units`; `GET /api/v1/registry/units/{id}`; `POST /api/v1/spatial-queries`; `POST /api/v1/exports`; `POST /api/v1/imports/registry-packages`. Large results use jobs/bounded pages, not unbounded browser payloads.

### Connections and completion test

Reads M8 accepted revisions and M1 permissions; invokes spatial processing where appropriate. Complete when lookup returns U03's accepted revision, a corridor relates to both parcels without an invented collision, inspection respects query semantics, and round-trip tests retain required supported fields.

## 13. Shared records and contracts

These are proposed contract names, not an official national standard. Definitions are centralised rather than separately invented by mobile, web and Python teams.

| Contract | Required content |
|---|---|
| Request context | Authenticated actor, organisation/project, granted actions, trace/request ID and policy context. |
| Source manifest | Source ID/revision, case, provider, permission/license, access class, capture/effective/recorded times, hash/size/type, acquisition method, reference/units, quality, ancestry, transformations and limitations. |
| Source locator | Page/region/entity/measurement reference where available; source revision and component purpose. |
| Geometry specification | Unit/revision IDs, physical asset, parent links, type/profile, footprint, lower/upper limits, reference frame, evidence bindings, measurement convention and coverage assumptions. |
| Proposal | Input revisions, geometry/region result, model/method configuration, raw score semantics, supported use and correction history. |
| Finding | Rule/version, exact input snapshot, category/severity, geometry highlight, source links, next action, status and effective/temporal comparison scope. |
| Mobile operation | Operation ID, expected server revision, case/request/component reference, payload/attachment references, capture time and schema version. |
| Submission | Exact unit/source/rights revisions, relevant-neighbour snapshot, validation result IDs, policy version, submitting actor and recorded time. |
| Decision | Submission snapshot, authenticated reviewer, outcome/reason, idempotency key, decision time and accepted pointers. |
| Spatial query | Query family, project/revision/time scope, input geometry/reference, coverage basis and permission context. |

A hash can help integrity/retry checks; it does not prove that a source is true or independent. A signed storage URL is temporary transport, not a persistent source ID.

### Illustrative API behaviour

```http
POST /api/v1/processing-jobs
Idempotency-Key: case-C001-check-draft2
Content-Type: application/json

{
  "caseId": "C-001",
  "operation": "validate_units",
  "contractVersion": "1",
  "inputSnapshotId": "snapshot-draft-2",
  "expectedCaseRevision": 7
}
```

The application authorises C-001, resolves the allowed inputs, creates a job and returns `202` with its ID/status URL. These identifiers are illustrative fixtures; they do not imply an implemented endpoint.

```json
{
  "jobId": "job-example",
  "state": "queued",
  "inputSnapshotId": "snapshot-draft-2",
  "resultRef": null,
  "error": null
}
```

A later result attaches to that snapshot. If the case advances, the old result remains inspectable but cannot mark a newer submission ready. Standard errors include `ACCESS_DENIED`, `REVISION_CONFLICT`, `REFERENCE_REQUIRED`, `UNSUPPORTED_INPUT`, `PROCESSING_FAILED`, `EVIDENCE_REQUIRED`, `VALIDATION_STALE` and `REVIEW_NOT_ALLOWED`, with an actionable description and request ID. Error codes are contract choices to freeze, not external standard names.

### Job and review state families

Use explicit job states such as `queued`, `running`, `succeeded`, `failed`, `cancelled`; recoverable attempts retain the same logical job and attempt history. Source usability and case review are separate state machines. A successful processing job never automatically equals an accepted unit.

## 14. Geometry feasibility and independent tests

Document the calculation frame before implementing measurements. Local metric coordinates and vertical units must agree; longitude/latitude storage is not a substitute for a metric computation frame. A local synthetic fixture does not acquire a real geolocation by assigning a convenient EPSG code.

For the declared single-prism family, use the independent analytic check:

```text
shared_height = max(0, min(top_a, top_b) - max(bottom_a, bottom_b))
intersection_volume = area(intersection(footprint_a, footprint_b)) * shared_height
```

This applies only to supported, valid footprints and constant-height extrusions in the same frame. Boundary-only intersection contributes no interior volume. Compound components require an explicit union/overlap convention before extension.

Test constructed shells and the chosen solid computational representation separately. `ST_IsValid` is a 2D check; a closed surface is not automatically a solid for every volume routine. Validate required PostGIS/SFCGAL/val3dity behaviour in the actual environment before freezing a generic-solid claim. Retain the analytic test as an independent oracle for the supported simple family.

No result in this document claims that these tests have been executed. Document 3 assigns them.

## 15. Preserved six-phase dependency order

| Phase | Integrated outcome | Gate |
|---|---|---|
| 1. Data contract and feasibility | Coherent source/geometry conventions, shared API fixtures and verified calculation strategy. | Reconstruct a known valid unit, reject known-invalid inputs and explain references. |
| 2. Manual web plus thin mobile | Online field response to manual unit preparation, review, identity and lookup. | One complete case works without AI; access/history/review are present. |
| 3. Reliable offline fieldwork | Persistent drafts, interruption recovery, idempotent sync and explicit conflicts. | Restart and reconnection preserve evidence without silent overwrites. |
| 4. Signature review and change impact | Component evidence, actionable findings, compare modes and dependency preview. | A user resolves the seeded case using evidence and sees U04's dependency. |
| 5. Evaluated assistance and richer inputs | Declared imagery, cloud, raster and plan adapters; optional tested AI/IFC paths. | Inputs produce attributable outputs and evaluated proposals; manual fallback remains. |
| 6. Underground reuse, exchange and pilot hardening | Cross-parcel corridor, bounded inspection, supported round-trip, second-case/device/security checks. | Reproducible end-to-end result on declared data/hardware with limitations. |

These are development gates, not time estimates or a narration outline. Mobile begins in Phase 2; baseline record history and role enforcement do not wait for Phase 6. Simple underground geometry is included in the foundational data/geometry contract even though expanded planning arrives later.

## 16. Repository and integration boundaries

```text
apps/web/                    UI plus thin application API routes
apps/mobile/                 native UI, local storage/outbox and client integration
packages/domain/             TypeScript application rules
packages/contracts/          authoritative shared API schemas/fixtures
packages/database/           registry migrations and data access
packages/client/             generated/shared API client
services/geo/                private FastAPI and Celery task code
services/geo/adapters/        import/normalisation and optional IFC profiles
services/geo/geometry/        construction, validation and spatial queries
services/geo/ml/              evaluated extraction adapters
fixtures/                    coherent synthetic case and independent adapter/test inputs
infra/                       reproducible containers/configuration
```

Client UI code does not take ownership of server logic merely because routes live in the same Next.js repository. Document 3 assigns server routes/domain code to Contributor B and processing to Contributor A. Vinayak integrates the generated client and owns client interaction code. Shared-contract changes receive review before changing consumers.

## 17. Module acceptance checklist and source basis

A module is not finished by having a screen, a notebook experiment, a document list or a successful happy-path request. It requires its stated output, error handling, permission/revision semantics, fixture tests and an integrated consumer.

Check the whole system for contact versus overlap; permitted containment; missing/incorrect datum; unsupported shape; evidence conventions; source ancestry and stale dependencies; self/cross-project approval; duplicate source/identity issuance; interrupted uploads; stale neighbour snapshots; unavailable AI; incomplete underground coverage; and supported export/import retention.

**Source lineage:** this document retains the nine modules and six phases from the v2 product/build handoff and the baseline technical stack. The comparison report and later branch prompts supply the selected measurement/ancestry/IFC/inspection refinements. More explicit contracts, state ownership and concurrency handoff are implementation clarifications in this consolidation, not claims that earlier code already exists.

**Documentation to verify during implementation:** PostGIS `ST_IsValid` https://postgis.net/docs/ST_IsValid.html (2D limitation rechecked for this consolidation); PostGIS 3D intersection https://postgis.net/docs/CG_3DIntersection.html; volume representation https://postgis.net/docs/CG_Volume.html; val3dity https://github.com/tudelft3d/val3dity; GDAL https://gdal.org/en/stable/; PDAL https://pdal.io/; PROJ https://proj.org/en/stable/; IfcOpenShell https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html; TorchGeo https://www.torchgeo.org/; SAM 2 https://github.com/facebookresearch/sam2; Expo SQLite https://docs.expo.dev/versions/latest/sdk/sqlite/; Keycloak https://www.keycloak.org/securing-apps/oidc-layers. Except the stated recheck, these are carried-forward technical references, not a fresh compatibility or deployment certification.
