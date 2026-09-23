# 23 — Indian operational data, modular delivery and problem-statement coverage

**Plan date: 24 September 2026.** Read H14/H21/H22. This document distinguishes the supplied problem statement, current code evidence, new engineering decisions and external publisher information. No dataset downloads, permissions, training, runtime tests or production deployment are claimed by this plan.

## A. Operational data policy

**Operational/pilot map: India-only geographic data, with data.gov.in as the first discovery and acquisition preference. No specific city, state or locality is mandatory. Tests: any permitted geography. Existing datasets are retained.**

Store geography, publisher, source release, intended use (`operational_india`, `test_only`, `authored_demo`), redistribution/training permission, source hash, CRS/vertical datum, coverage and acquisition date. Operational admission/publication checks reject out-of-India geography and test-only datasets; derive/verify coverage rather than trust a caller's country label. Border/ambiguous coverage requires review. Clip a permitted source only with traceable source geometry and original preservation. A test fixture never becomes operational through a filename change.

The preference is Indian data, especially the government portal, not a false claim that the portal already supplies a complete high-resolution 3D city. If it lacks a needed layer, identify an appropriate Indian government custodian, permitted Indian institutional survey or user-supplied Indian source; record the availability and permission gap. Do not silently substitute a foreign city. The existing foreign corpus can still exercise code, scale and holdout testing in a clearly separate namespace. Foreign test access does not override private-data residency policy.

### Verified discovery leads, not acquired files

| Source | Potential role | What remains unproved |
| --- | --- | --- |
| data.gov.in Cartosat-1 DEM catalog | Indian terrain context; catalog describes about 30 m posting and links to Bhuvan | Actual tile bytes/version, datum, permitted use; unsuitable alone for individual roofs/floor dimensions |
| data.gov.in GIS group: municipal utility/landmark catalogs | Streetlights, transformers, landmarks and other spatial context | Actual schemas, dates, coverage and download health; points are not buried pipe networks or building solids |
| Survey of India Online Maps Portal | Indian topographic vector products, including roads/rail/hydrology | Required resolution, access, licence/cost and same-area alignment; catalog availability is not a free bulk data grant |
| Local/state survey or land-record custodian, permitted campus or building source | Footprints, parcel layers, plans, point clouds, controls and records for a selected Indian area | Case-specific access, evidence alignment and currentness |

Acquire one coherent Indian area only after inspecting its real geometry and required metadata. Preserve raw inputs; pair layers from the same bounds/time/reference and track conflicting sources. Do not infer roof/floor/rights data from a postal polygon, point of interest or DEM. Choose the area by available quality and diversity, not a fixed location name.

## B. Sarvam and India-resident processing

Presentation wording: **“Designed for India-resident processing using Sarvam AI, with application storage, training, logs and backups kept within approved Indian infrastructure.”** This describes the target architecture, not certified live deployment.

Sarvam's Trust Center states India-only residency for Indian deployments. DEPLOY still qualifies the selected API/product contract, endpoints, retention, subprocessors, support access and training settings. Host our own learner and object/SQL stores in the approved India boundary. Audit browser basemaps, fonts, telemetry, signed URLs, backups and all legacy model paths; disable unapproved egress. Development GPT workers use code and permitted sanitized fixtures, not private operational property data.

Publicly released information delivered to public browsers can leave India; do not describe public distribution as an absolute geographic containment guarantee. Private originals remain protected. Data residency, confidentiality, integrity and semantic correctness are separate requirements. Hashes preserve byte identity; validators and accountable source/review checks address correctness.

The Sarvam training restriction in H21 is an explicit gate. Preserve the existing H20 provider-neutral port, verified funding/account scopes, exact reservations and permanent credential retirement, but recheck permitted usage and pricing before live calls. Never farm free credits, evade account limits or assume a grant is verified remaining balance. A provider outage or missing permission leaves the relevant capability unavailable while exact mappings/manual work continue.

## C. DRY module ownership

| Module | Sole responsibility | Shared mechanisms it must reuse |
| --- | --- | --- |
| Intake/readers — INGEST | Durable source receipt, bounded native reading and source profiles | Existing source store/uploads/access |
| Partition/queue — INGEST + FND | Complete chunks, dependencies, priorities and backpressure | Existing dispatcher/Celery/Redis; SQL fences |
| Interpretation/executor — INGEST | One constrained mapping format and deterministic transform executor | Versioned contracts, units/reference operations and validators |
| Learner — LEARN | Eligible examples, candidate training, inference and evaluation | Existing jobs/storage, same mapping format; no new gateway |
| Model registry/routing — FND | Immutable artifacts, qualification receipts and dispatch epochs | Existing SQL transactions/audit/outbox |
| Geometry and visuals — GEO/UI | Supported canonical geometry plus separate display derivatives | One geometry-validation authority and MapViewport runtime |
| Evidence/registry — existing feature owners | Later links, rights/revisions, scoped packets and reviewed commits | Existing canonical registry, IDs and immutable snapshots |
| Public experience — CITIZEN/UI | Released discovery, private submissions and tracked corrections | Shared components with isolated access-aware state |
| Policy — DEPLOY/DATA | India data/egress rules, credentials and training eligibility | One policy evaluator and one governed provider client |

One schema vocabulary and one transformation/validation contract feed both teacher and learner paths. Avoid duplicated per-provider models, feature-specific keys, page-specific maps, standalone import databases and a second broker. Generate or validate cross-language contracts from one versioned schema and shared fixtures. Leave unsupported legacy geometry mirrors unavailable rather than flattening rich shapes to make them fit.

Implementation extends existing `packages/contracts/src/usp`, `apps/web/lib/server/usp`, `apps/web/features/usp`, the shared spatial renderer and `services/geo/geo`. Directory names in this plan are destinations to assess against current code, not evidence those modules already exist.

## D. Mapping to problem statement 26011

The supplied statement requires unique identities for surface parcels, multi-storey apartments and underground infrastructure; integration of drone imagery, LiDAR/point clouds, parcel GIS, floor plans, GNSS/CORS and DEM/DSM; and AI/ML for extraction, floor segmentation, vertical delineation and topology validation.

| Required outcome | Planned method and acceptance |
| --- | --- |
| 3D ULPIN / spatial identity | Stable application parcel/building/floor/space IDs with source links; preserve supplied official parcel ULPIN. Version an extensible 3D identifier/export profile and test uniqueness/round-trip. Official standard/issuance status needs the relevant authority, not an invented suffix rule. |
| GIS, plans, controls and elevation integration | Typed source adapters, shared reference operations, unit metadata and exact associations. Demonstrate two matched inputs supporting the same building and local/global placement qualification. |
| Drone / imagery building extraction | A separately trained/evaluated segmentation processor plus documented reconstruction/height source. Candidate outlines retain original imagery, model/version and uncertainty. |
| LiDAR / 3D point clouds | Bounded reading, ground/building separation and qualified surface reconstruction. A retained cloud is not a reconstructed solid; ground truth and geometry checks are separate. |
| Floor segmentation | Prefer explicit plan/vector semantics and level schedules; use a plan-segmentation model when needed. Evaluate floor/room boundaries separately; rooms are not automatically legal units. |
| Vertical parcel delineation | Combine supported footprint/component boundaries, level limits and reviewed associations into 3D spaces. Preserve duplex components, basements, shared spaces and unknowns. |
| Intelligent topology validation | Deterministic polygon/prism checks plus optional learned anomaly prioritization. Test overlap, contact, holes, reference mismatch and missing-neighbour coverage. Models do not declare ownership conflicts as legal verdicts. |
| Volumetric rights / underground infrastructure | Reviewed rights assertions linked to exact space/evidence; utility depth, cross-section and datum required for qualified volume analysis. Missing depth remains a gap. |
| Scalable/interoperable cadastre | Bounded jobs, 3D Tiles/display assets, source-preserving exports and stable identities. Round-trip source metadata; 3D Tiles alone is a visualization standard, not cadastral/legal conformance. |

Schema learning makes integration easier; it does not replace these four domain AI/ML tasks. They remain committed roadmap workstreams with explicit data/accuracy gates, not silently dropped as optional marketing language.

## E. Phased build plan and exit criteria

**B0 — Contract and baseline lock.** Inspect live branch, assigned writers and current receipts. Preserve originals/DBs. Add compatible SourceProfile/Chunk/ConverterBinding/MappingExample/ModelVersion/QualificationReceipt/DisplayProvenance contracts through FND. Run actual producer-consumer tests, no mock-only acceptance.

**B1 — First progressive pipeline.** Implement one supported structured source and retained rich-3D path: receipt → raw chunks → teacher/exact conversion → shared validation → persisted draft assets → SSE/polling → selectable map. A known-schema large file must also appear progressively. Reuse the existing tested workflow, not a new demo app.

**B2 — Concurrent learning and handover.** Build the CPU learner and eligible dataset lane in parallel with B1 interfaces. Demonstrate actual candidate training, untouched evaluation, shadow run, recorded promotion, pending-only handover and rollback on the same import. No-key/permission-failed cases continue through the safe supported route. This is part of the core adaptive milestone, not postponed behind every other feature.

**B3 — Better rendering and sparse-data behavior.** Run the R3F/3D Tiles candidate against current Cesium on identical data. Qualify one active runtime, roof shape/picking/clipping and interaction. Add evidence/estimated/illustrative layers, insufficiency policy and exported labels. No artificial building count from procedural decoration.

**B4 — Later records and citizen dashboard.** Attach registry documents/plans to existing identities; revalidate only affected facts. Build distinct public lookup/submission/status pages and officer review. Enforce authorization, quarantine, scoped evidence and separate reviewed recording before public activation.

**B5 — Cadastral modalities and operational Indian area.** Acquire permitted same-area Indian inputs, then qualify imagery/point-cloud/plan processors, reference placement, vertical delineation and topology. External data access blocks only the corresponding real-data assertion, not coding/tests.

**B6 — Scale and protected deployment.** Test 10k → 100k → 1M real unique buildings using any permitted test geography; production data remains India-only. Measure ingestion, training interference, rendering and concurrent-user load separately. Qualify India hosting/egress/restore and source permissions before activation.

Initial ownership: lead/FND plus one INGEST or UI implementation owner and bounded DATA/review work; LEARN starts when its interfaces are stable, with explicit non-overlapping ownership. Retain only GPT-6 Sol/Astra development workers and existing effort verification; no new model configuration or worker is installed by this document. No force push, implicit main merge, secret commit, credit purchase or service activation.

## F. Acceptance matrix

| Test group | Required proof |
| --- | --- |
| Source/geometry correctness | Raw schema/IDs/numbers preserved; valid coordinates/holes/reference; source-role and per-field authority retained |
| Adaptive interpretation | Unfamiliar-layout holdouts, no application-code edits, real parameter learning, false-confident/abstention metrics |
| Same-import handover | Exact dispatch epochs with pending/running/completed jobs; restart, race, cancellation and rollback |
| Progressive experience | First persisted selectable geometry before completion; actual requests/events; no camera reset; known schemas also chunked |
| Poor data | Useful valid subset; explicit insufficiency; generated layers cannot alter measurement, readiness or ownership |
| Evidence added later | Stable IDs, exact source revisions, targeted updates; ambiguous matches never silently merged |
| Public isolation | Contributor A cannot access B's files; released-only lookup; scanner outage quarantines; reviewed proposal before record |
| Geography/residency | Test assets excluded from operational publication; India data bounds verified; unapproved network destinations denied |
| Scale/recovery | Unique count reconciliation, stage times, CPU/RSS/client resident bytes, frame/selection p50/p95, controlled training contention |

Do not invent test commands that do not exist. Use actual locked scripts and tsx/Python/Playwright runners; add new tests before naming them executed. Save code/source/model/dataset hashes and sanitized receipts. Distinguish contract-ready, locally integrated, learning-qualified, real-source-qualified and deployment-qualified.

## G. Source register — checked 24 September 2026

S1. Supplied `Problem statement Details.txt`, ID 26011 — required inputs, domain AI/ML and expected outcomes.

S2. Repository at `36385b1605e16d50863448b411045ee42cf45913`: `apps/web/package.json`; `apps/web/features/spatial/reference-import/source-normalizer.ts`; existing H00/H01/H13/H14/H19/H20/H99 and `docs/evidence/usp/continuation-2026-09-23/README.md`. Package declarations establish dependencies, not renderer performance. The inspected normalizer requires a known synthetic manifest/profile and returns explicit missing geometry. No new learner/poor-data reconstruction qualification was established.

S3. React Three Fiber introduction: https://r3f.docs.pmnd.rs/getting-started/introduction . Three/R3F are renderer tools, not a guarantee of superior source geometry.

S4. 3DTilesRendererJS: https://github.com/NASA-AMMOS/3DTilesRendererJS . Check supported formats/extensions and cache behavior before installing.

S5. OGC 3D Tiles: https://www.ogc.org/standards/3dtiles/ . Hierarchical spatial delivery supports large-scene streaming; it does not confer cadastral authority.

S6. Incremental classification: https://scikit-learn.org/stable/auto_examples/applications/plot_out_of_core_classification.html and https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.SGDClassifier.html . Supports the proposed CPU baseline, not project-specific quality claims.

S7. Semantic/table learning research: https://arxiv.org/abs/1905.10688 (Sherlock); https://arxiv.org/abs/2006.14806 (TURL). Their experiments are not our benchmarks.

S8. Sarvam Trust Center: https://www.sarvam.ai/trust-center . States India-only residency for Indian deployments; selected product and complete application flow still require qualification.

S9. Sarvam Terms of Service: https://www.sarvam.ai/terms-of-service . Version 2.0, effective 29 July 2026; section 10.5(a), training/derived-output restriction and written-permission requirement. Confirm applicable product-specific terms.

S10. Government discovery: https://data.gov.in/catalog/digital-elevation-model-dem-generated-cartosat-1-satellite-data-india ; https://data.gov.in/dataset-group-name/GIS ; https://onlinemaps.surveyofindia.gov.in/AboutPortal.aspx . Catalog/publisher descriptions only; no new dataset files downloaded in this task.
