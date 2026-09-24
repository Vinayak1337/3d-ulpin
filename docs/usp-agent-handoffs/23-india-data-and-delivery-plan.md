# 23 — Indian operational data, modular delivery and problem-statement coverage

**Plan date: 24 September 2026.** Read H14/H21/H22. This document distinguishes the supplied problem statement, current code evidence, new engineering decisions and external publisher information. No dataset downloads, permissions, training, runtime tests or production deployment are claimed by this plan.

## A. Operational data policy

**Operational/pilot map: India-only geographic data, with data.gov.in as the first discovery and acquisition preference. No specific city, state or locality is mandatory. Tests: any permitted geography. Existing datasets are retained.**

Store geography, publisher, source release, intended use (`operational_india`, `test_only`, `authored_demo`), redistribution/training permission, source hash, CRS/vertical datum, coverage and acquisition date. Operational admission/publication checks reject out-of-India geography and test-only datasets; derive/verify coverage rather than trust a caller's country label. Border/ambiguous coverage requires review. Clip a permitted source only with traceable source geometry and original preservation. A test fixture never becomes operational through a filename change.

The preference is Indian data, especially the government portal, not a false claim that the portal already supplies a complete high-resolution 3D city. If it lacks a needed layer, identify an appropriate Indian government custodian, permitted Indian institutional survey or user-supplied Indian source; record the availability and permission gap. Do not silently substitute a foreign city. The existing foreign corpus can still exercise code, scale and holdout testing in a clearly separate namespace. Foreign test access does not override private-data residency policy.

### Acquisition authority

[H28](28-data-acquisition-and-finale-tests.md) contains exact data.gov.in resources, format/access caveats, Indian plan/terrain/point-cloud/imagery candidates, preserved D0–D7 meanings, acquisition stages and dataset-to-test mapping. Start with its bounded matched Indian building bundle and independent modality samples. Postal/admin layers are useful context, never substitutes for parcels or floor geometry.

No candidate is claimed acquired or qualified by this update. Pair layers only when their actual bounds, time, frame and source evidence support the relationship. A foreign test corpus may exercise formats and scale but cannot fill an Indian rights/survey evidence gap.

## B. Sarvam and India-resident processing

Presentation wording: **“Designed for India-resident processing using Sarvam AI, with application storage, training, logs and backups kept within approved Indian infrastructure.”** This describes the target architecture, not certified live deployment.

Sarvam's Trust Center states India-only residency for Indian deployments. DEPLOY still qualifies the selected API/product contract, endpoints, retention, subprocessors, support access and training settings. Host our own learner and object/SQL stores in the approved India boundary. Audit browser basemaps, fonts, telemetry, signed URLs, backups and all legacy model paths; disable unapproved egress. Development coding agents of any vendor use code and permitted sanitized fixtures, not private operational property data.

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
| Geometry and visuals — DOMAIN/UI | Supported canonical geometry plus separate display derivatives | One geometry-validation authority and MapViewport runtime |
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

Full-product schema learning is intended to make integration easier; it does not replace these four domain AI/ML tasks. They remain committed roadmap workstreams with explicit data/accuracy gates, not silently dropped as optional marketing language.

## E. Delivery order and exit criteria

Use [release-plan.json](release-plan.json), not the retired B0–B6 ordering. **GF0 data/contracts → GF1 identity/exchange → GF2 domain AI/spaces → GF3 governance/impact → GF4 card/QR → GF5 rehearsal.** Detailed exits are in H00 and H28. Preserve current D0/PACK0/D1; qualify new work against its actual code base.

The finale's direct progressive pipeline and domain AI do not wait for schema-model training, public uploads, visual enrichment or a renderer migration. Existing IMPACT0 is promoted into GF3 with explicit unmapped/unknown-data limitations. Current Cesium is the finale runtime. H26 adds proposed-ID lifecycle, LADM mapping and minimum exchange; H27 adds named algorithms and independent quantity/geometry checks.

After the finale, dependency-ready `full_product` gates deliver the real concurrent learner (FP-LEARN), separate public request dashboard (FP-PUBLIC), assistance/MCP (FP-ASSIST), broader adapters (FP-FORMATS), enrichment (FP-ENRICH), optional renderer evaluation (FP-RENDER), load testing (FP-SCALE) and protected deployment (FP-DEPLOY). They remain planned, not deleted or rebranded as completed. Run 10k → 100k → 1M real unique-object rungs only after bounded acquisition, parsing and spatial paging qualify.

Use H02's bounded role-tier workers and sole shared-service ownership. No force push, main merge, deployment, credit purchase, snapshot refresh or secret commit follows implicitly from this plan.

## F. Acceptance matrix across both releases

| Test group | Required proof |
| --- | --- |
| Source/geometry correctness | Raw schema/IDs/numbers preserved; valid coordinates/holes/reference; source-role and per-field authority retained |
| Full-product learned interpretation | Unfamiliar-layout holdouts, no application-code edits, real parameter learning, false-confident/abstention metrics |
| Full-product same-import handover | Exact dispatch epochs with pending/running/completed jobs; restart, race, cancellation and rollback |
| Progressive experience | First persisted selectable geometry before completion; actual requests/events; no camera reset; known schemas also chunked |
| Poor data | Useful valid subset; explicit insufficiency; generated layers cannot alter measurement, readiness or ownership |
| Evidence added later | Stable IDs, exact source revisions, targeted updates; ambiguous matches never silently merged |
| Full-product public isolation (card access is also tested in finale GF4) | Contributor A cannot access B's files; released-only lookup; scanner outage quarantines; reviewed proposal before record |
| Geography/residency | Test assets excluded from operational publication; India data bounds verified; unapproved network destinations denied |
| Full-product scale / finale bounded recovery | Unique count reconciliation, stage times, CPU/RSS/client resident bytes, frame/selection p50/p95, controlled training contention |

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

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. Task cards: [H29](29-agent-task-cards.md) DATA-02 and DATA-03.

- **CRS checks cannot rely on "inside India".** UTM 43N data read as 44N moves about 600 km and still lands in India; Kalianpur/Everest data labelled WGS84 lands on the wrong parcel. Never infer zone or datum from coordinate ranges; send these cases to the unknown-CRS path and use a known control point residual. Fixtures are in [H28](28-data-acquisition-and-finale-tests.md) Z3.
- **One India boundary.** The admission polygon is Survey of India's official boundary at a pinned release, with a coastal and island rule (an Andaman point is admitted, a Colombo point is rejected). No national overview map from a non-Survey of India boundary appears in the UI or PPT.
- **Identifier matching.** Keep the literal ID and add a `normalizedKey` (NFKC, Indic digits converted to ASCII, subdivision separators kept) used only to propose review candidates. `१२३/४क` and `123/4क` become a candidate pair; `123/4` and `123/40` do not. Names and addresses never auto-link.
- **Fine-resolution geospatial data.** Applies only if Indian fine-resolution capture is ever ingested: such orthophotos, DSMs and LiDAR are classed `india_restricted_geospatial`: processed only on India-located machines and CI runners; coding agents get downsampled or synthetic samples. Verify the current national geospatial guideline thresholds before quoting them.
- **Coverage rows.** The SIH mapping table adds: a D0 elevated corridor and a stilt parking level (GF-T18 case and rehearsal beat); checkpoint RMSE in centimetres from held-out published GCPs (DATA-06), or `not_assessed`; DEM/DSM as nDSM height against checkpoints. FSI/TDR envelopes stay roadmap.
- The Sarvam slide line is the one in [H24](24-product-method-and-ppt.md) Z3.
