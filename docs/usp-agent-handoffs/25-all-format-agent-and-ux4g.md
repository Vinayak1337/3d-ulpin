# 25 — All-format agent, generative enrichment and UX4G-guided design

**Current scope, 26 September 2026:** [Delivery policy](current-delivery-policy.md) takes precedence over older sections and H97 addenda. All active work is backend-only: services, processing, data, security and API contracts for the user-owned UI. The user authorizes assigned backend plan tasks in separate worker worktrees; frontend technology and implementation remain untouched. The [normalized backend decisions](backend-streaming-plan.md) govern streaming, scale and migration. All public-portal work remains full product. Use unchanged official sources; unavailable coverage stays unqualified.

**Release: `full_product` (FP-ENRICH / FP-FORMATS).** Broad all-format adaptation and generative enrich-first previews remain the product ambition; no universal support claim. The finale uses qualified direct conversion and evidence-supported reconstruction under H14/H27. Enrichment/learner/renderer experiments do not block it. **25 September 2026:** the finale now includes a bounded part of this file through [H30](30-reference-scene-and-incomplete-data.md): one real sample per core input family (H30 F), fill/ask/park/reject handling of incomplete input (H30 E) and a deterministic Enhanced view over real layers (H30 C). Route 2 with learned or generative enrichment stays full_product. Shared accessibility practices apply to every delivered surface.

**Product clarification: 24 September 2026. Owners: INGEST/FND for adaptation, DOMAIN/UI for enrichment, LEARN for learning, UI for government-design alignment, DEPLOY for residency.** This is planned scope, not evidence that every format or new capability already works. Read H14/H21/H22/H23 and H24's presentation copy.

## A. All-format ingestion is the product ambition

Build an AI agent designed to support all formats of spatial, survey, building-model and property-document data, rather than require every supplier to deliver our schema. The agent identifies the input, chooses and coordinates readers/converters/reconstruction tools, supplies interpretation where needed, and produces the common representation used by the same 3D map.

Examples include GIS tables/vectors, rasters and elevation, point clouds, imagery, floor plans, CAD/BIM, 3D meshes and registry documents. These are capability families to build and test, not an assertion that each listed encoding is already implemented. H14's supported/unsupported states describe the currently qualified route; they are not a permanent closed-format product scope.

When a reader is missing, the agent first checks the approved capability registry for a safe conversion chain. If none exists, create a bounded adapter-development task with retained source samples and independent acceptance cases. A new adapter is isolated, tested, dependency/licence reviewed and registered before processing operational records. Format expansion is a real part of delivery, not a request that every user manually reformat their input. Track discovery, adaptation, qualification and blockers visibly. Do not execute arbitrary model-generated code or install arbitrary dependencies in the live worker.

Encrypted, corrupt, inaccessible or semantically insufficient input can still be blocked. Record the exact missing key/permission/reader/evidence and retain accepted partial work. No all-format claim grants permission to bypass access controls or implies missing real-world information can be recovered with certainty.

## B. Two valid routes to the common representation

**Route 1: source chunks → interpret/read → convert → validate → progressive 3D.**

**Route 2: source chunks → interpret/read → generate or estimate needed visual detail → convert the enriched derivative → validate → progressive 3D.**

The second route is explicit full-product scope, after finale qualification. Enrichment can happen before final schema conversion; it is not limited to putting materials on an already completed map. The raw source and its chunk structure remain unchanged. An enriched derivative carries per-field/per-object lineage, input links, generation method/model/version, assumptions, uncertainty where justified and evidence/estimated/illustrative classification. Both routes use the same transformation and validation services.

Examples: supply illustrative building massing where a footprint exists but height is absent; generate roof/facade detail for a readable preview; create a styled road surface from a centreline; use a separately qualified reconstruction model where source imagery/points support it. A template is labelled illustrative, not a measured or validated prediction. Too little location or geometry support remains an explicit insufficient-data state; only a separately labelled hypothetical scene may fill such gaps. Generated geometry is usable presentation data, not a new official property, cadastral boundary, ownership assertion or measurement.

Normalize evidence facts and display derivatives into the common versioned representation with authority/capability tags that every consumer enforces. Do not weaken source validators or create a second property database to accommodate synthetic visuals. Measurement, readiness, rights, official identifiers and property-evidence packets cannot consume illustrative facts as source evidence. Scene exports preserve generation labels; later real evidence supersedes estimates through a new revision and stable physical identity. H22's three-layer and insufficiency rules remain mandatory.

## C. Progressive rendering and learning stay central

Every large input is source-preservingly chunked, including familiar schemas and the remaining queue after model promotion. The agent can choose chunk size and dependency grouping within existing qualified bounds. Geometry is saved before SSE announces availability; the existing shared map adds buildings/roads as assets become ready. This is useful gradual availability, not an instant whole-city promise or an artificial progress animation.

H21's learner trains alongside the import on eligible checked examples, is evaluated independently and can take over unclaimed compatible work. Keep exact mapping reuse for already familiar data. Learning schema interpretation, reconstructing physical geometry and generating visual detail are separate qualified capabilities. Generated appearances cannot label themselves as real-world training truth. Sarvam-derived training remains subject to H21/H23 permissions. Do not replace the learner with a cache or let training block a usable first preview.

## D. Sarvam and the India-residency PPT point

Use this future product commitment under a proposed-solution heading:

**“Designed for India-resident private processing using a qualified Sarvam service and India-hosted storage, ML, logs and backups.”**

Sarvam's Trust Center states India-only residency for Indian deployments. That supports the provider choice; it does not qualify our whole installation. DEPLOY must verify the selected service agreement and endpoints, all application/model destinations, support/telemetry, browser dependencies and backups before making a present-tense operational claim. No unapproved external-model fallback. Public information intentionally released to public clients is outside the private-data containment statement. Existing gateway accounting and training-permission gates remain unchanged.

Operational maps use Indian geography, with data.gov.in first. Tests may use any permitted geography in isolated test namespaces. No city is compulsory and existing datasets are preserved.

## E. Backend inclusion and public-service contracts

Retain the UX4G/GIGW reference material in the protected design system for the user-owned UI. No framework installation, token/component/layout work or public frontend is scheduled. Backend acceptance covers authorization, retention, safe uploads, structured error/status reasons, language/locale metadata, exact source labels and traceable receipts. Never claim government affiliation, certification, legal compliance or full accessibility from a schema or library choice.

Expose authorized list/search projections as well as geometry, meaningful status/error codes, bounded upload progress and replayable events without embedding layout decisions. Preserve unknown versus estimated classifications and source dates/units. User-owned interface translation and accessibility remain separately unqualified; do not invent translated property facts.

## F. Acceptance and claims

Record a capability matrix per input family/version: received, reader qualified, interpreted, enriched, converted, rendered, learner-qualified and blocked reason. Demonstrate both conversion routes with preserved source lineage and persisted progressive results and event receipts. A one-file success does not establish universal coverage.

Run source→enriched derivative→render tests and prove generated fields never upgrade evidence readiness or measurements. Test insufficient geometry, unknown datum, later evidence, restart and model/adapter-version change. Retain all H14/H21 recovery/handover tests.

Backend contract checks do not establish UX4G/GIGW or whole-product conformance. Keep security, privacy, audit and source-integrity evidence; consumer accessibility/browser outcomes remain an external user-owned dependency. No certification or performance result is asserted by this planning update.

## Official sources checked 24 September 2026

- UX4G initiative and reusable design components: https://www.ux4g.gov.in/get-started/about-ux4g and https://negd.gov.in/our_projects/ux4g/
- Current UX4G design system: https://www.ux4g.gov.in/
- GIGW scope and objective: https://guidelines.india.gov.in/scope-and-objective/
- GIGW 3.0 accessibility and other focus areas: https://guidelines.india.gov.in/new-features-of-gigw-3-0/
- Sarvam India-deployment residency statement: https://www.sarvam.ai/trust-center

The agent/enrichment design and acceptance cases above are project decisions based on the user's clarification. These external sources establish the provider/design-framework descriptions, not implementation results for our product.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Within the retained backend contracts this addendum resolves older detail; the current delivery policy and backend-only scope take precedence. Task cards: [H29](29-agent-task-cards.md) FP-FORMATS-01; former UI-01 is retired.

- **Design reference boundary.** Preserve the repository design system and supplied mockups for the user-owned interface. Active work covers only the profile/frame/mapping/attribute/evidence contracts; no UI tokens, CSS/JS bundles or screen implementation are assigned.
- **Keep display derivatives out of analysis.** Enrichment output goes to the separate display-derivative store ([H22](22-rendering-and-sparse-data.md) Z1), keyed by `recordId`. FIND, READY, PACK, LEARN examples and the H26 export have no query path to it. FP-ENRICH-TEST asserts at SQL level that canonical tables hold zero `illustrative` rows.
- **Adapter development samples.** Adapter-development tasks receive only DEPLOY-approved sanitized, traceable official-source extracts, never private originals. Every reader runs without network inside the job's extracted directory and follows the hostile-input contract in [H14](14-adaptive-ingestion-and-progressive-review.md) Z1. Source text never becomes a tool argument; tools come only from the capability-registry enum.
- **Tests.** A VRT pointing at `/etc/passwd`, a glTF `uri` pointing at `169.254.169.254`, a zip-slip entry, a nested zip over the expanded cap, and a plan PDF containing "assign code now" all fail safely.
