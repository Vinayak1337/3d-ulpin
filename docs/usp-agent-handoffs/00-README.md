# 3D ULPIN — what we are building and in what order

**Current scope, 26 September 2026:** [Delivery policy](current-delivery-policy.md) takes precedence over older sections and H97 addenda. All active work is backend-only: services, processing, data, security and API contracts for the user-owned UI. The user authorizes assigned backend plan tasks in separate worker worktrees; frontend technology and implementation remain untouched. The [normalized backend decisions](backend-streaming-plan.md) govern streaming, scale and migration. All public-portal work remains full product. Use unchanged official sources; unavailable coverage stays unqualified.

<!-- plan-next-gate: GF0 -->

**Current execution focus, 26 September 2026:** The [NestJS migration and delivery ledger](../orchestration/NESTJS_MIGRATION.md) records the completed modular backend, executed SQL authority, 146-operation API/dataset handoff (132 baseline plus fourteen additions) and merged task cleanup. RUN-01 passed bounded official PDF job/retry/read and separate NYC GIS workflows; GF0 remains pending. The [official source index](../api/real-sources.md) now includes an acquired and inspected NWIC Indian district layer with conditional use evidence. Its 71.2 MB archive now passes bounded durable receipt, restart/resume, recovery and exact download through INGEST-06. The 168.4 MB member remains unparsed; projected-frame conversion, semantic admission, private tiles/streaming and measured GF-SCALE-1 still need qualification. The gateway, bounded manual mapping and large-original receipt are accepted. Private SSE delivery can now reuse the existing transactional outbox; model proposals and broader recovery remain open. Resume dependency-ready backend work from this evidence; frontend implementation and `design-mockup/` remain untouched.

**Compatibility and route cleanup:** Work the backend contracts and wiring needed for GF0 and subsequent gates through the [backend cleanup plan](backend-cleanup-plan.md). The user owns the UI redesign, so no UI implementation cards are scheduled in this backend work. Only their API/wiring requirements remain in active plans; user-owned visual implementation and validation are external dependencies. The backend plan includes an API route cleanup phase after a pinned route inventory; an inventory or route deletion alone does not pass a runtime gate.

**Aligned 24 September 2026 after the Grand Finale audit. Status: implementation plan; new gates are pending.** The consolidated application baseline is staging commit `45d033baae7ec4e5a572d82459b0062c70a12c95`. Main remains separate. Fetch and verify the live staging head before starting implementation.

## Backend product purpose and equal USPs

Build an evidence-linked 3D property workbench for SIH 26011. Give equal emphasis to **AI-assisted integration of fragmented records and survey inputs** and **an officer's ability to identify, inspect and explain vertical property decisions from exact evidence**. The product turns supplied data into reviewable spaces and proposed identifiers, with uncertainty and source history visible. APIs supply the user-owned map and workbench; the backend outcome is a traceable property record and scoped evidence artifact.

**Finale story: Identify → Prove → Govern.** Identify surface, stacked, elevated and underground spaces; prove their geometry, relationships and quantities from retained sources; screen discrepancies and infrastructure impacts with explicit limitations. Generated geometry cannot establish ownership. Project-generated identifiers are proposed technical IDs, not official ULPIN issuance.

## Two release scopes

**How to pick up work (any coding agent).** Read this file, then [H97 review findings](97-review-findings-and-alignment.md), then identify the dependency-ready backend card for a separate authorized assignment for the active gate from [H29 task cards](29-agent-task-cards.md) and the backend cleanup plan. Many handoffs end with a **"Z. Hardening addendum (H97)"** section: where an addendum conflicts with text above it in the same file, the addendum wins. The [design system](../design-system/README.md) remains a protected reference for the user-owned UI, not an agent work queue.

[release-plan.json](release-plan.json) is the machine-readable authority for release membership, dependencies, requirement owners/tests and next gate. This index explains it. Feature handoffs define behavior; H28 defines datasets and acceptance. H24 is presentation copy. Historical task numbers and receipts are evidence at their recorded revision, not a competing queue.

| Release | Retained backend scope | Boundary |
| --- | --- | --- |
| `finale_v1` | Supported progressive ingestion/SSE; constrained agent assistance; proposed immutable IDs and official-anchor assertions; CityJSON plus sidecar exchange; domain-AI candidates; qualified vertical/shared/underground geometry; scoped UDS/carpet/deviation/topology/impact checks; evidence card and revision QR; a real Indian reference area with deterministic display-derivative assets, and fill/ask/park/reject handling of incomplete input from every data family ([H30](30-reference-scene-and-incomplete-data.md)); measured rehearsal | One local operator, API/asset compatibility with the existing shared Cesium path. Unsupported inputs/analyses remain explicit. No statutory issuance or production deployment claim. |
| `full_product` | Concurrent schema learner and mid-import handover; separate privacy-preserving public request/evidence dashboard; grounded conversational assistance/MCP; generative previews only after a new explicit user scope decision; broader format coverage beyond H30's finale families; deferred asset/codec compatibility; large-scale and protected multiuser deployment | Deferred backend commitments, no new work scheduled and not prerequisites for `finale_v1`. Each needs its own data, permission, accuracy and operational qualification. |

The finale still includes real domain AI/ML: building extraction, plan segmentation, evidence-supported vertical delineation and explainable topology validation under H27. Schema learning is a separate full-product capability; exact mapping reuse must not be described as trained ML. The constrained ingestion agent proposes mappings and orchestrates allowlisted tools; deterministic processors and accountable review govern recording.

## Roadmap and exit gates

| Gate | Backend scope when separately assigned | Backend evidence and outstanding qualifications |
| --- | --- | --- |
| GF0 — data and contracts | Inventory current implementation; select matched official sources (Indian operational geography; foreign official tests labelled separately); pin pack manifests, coordinate/height metadata, parser/processor capabilities and shared contracts | GF-CONTRACT/GF-DATA/GF-BACKEND: historical D0/D1 receipts distinguished from current real-source service qualification; independent expectations derived from official sources; authentic-data gaps named; no resets or invented survey facts |
| GF1 — identify and exchange | H26 project ID allocator/lifecycle, supplied official assertions, semantic CityJSON + rights/provenance sidecar, LADM mapping | GF-T15 and GF-EXCHANGE: race/idempotency/lifecycle cases and independent loss-aware round trip |
| GF2 — prove spaces | H14 progressive source path and constrained mapping agent; H27 domain-AI candidates and site model pipeline, floor/space review, qualified solids/prisms and reference operations; H16 shared rights | GF-AI, GF-AGENT, GF-T16–18, GF-RECOVERY, GF-VIEW, GF-SCENE, GF-SUFFICIENCY, GF-STREAM and GF-SCALE-1; predictions versus truth, quantities versus source components, unsupported versus zero |
| GF3 — govern | H11/H12 evidence/readiness, H15 exact-revision deviations/history and H17 dig/impact screening | GF-READY and GF-T19–20: independent control cases, coverage gaps and stale/unknown utility depth; no automatic illegality or safe-to-dig verdict |
| GF4 — share scoped proof | H10 property-card subtype of existing packet service and access-checked exact-revision QR | GF-T21 and GF-PRIVACY; excluded-unit pixels/metadata absent, revoked/retired/wrong-unit tests, explicit local-only delivery mode and separately gated phone access |
| GF5 — rehearse and report | Source-to-card service lifecycle, known limitations, timing/receipt and loss reports | GF-REHEARSAL backend receipts and honest measured/target/unavailable labels; user-owned browser/officer integration and owner sign-off remain externally required for complete release |

Next gate: **GF0**. Existing D0/PACK0 and D1 are the baseline to reuse, not a request to restart F0/F1-min/V0. The [23 September receipt](../evidence/usp/continuation-2026-09-23/README.md) covers a bounded authored vertical workflow, saved text/CSV packet and one real exterior's local geometry/identity. It does not qualify new IDs, domain AI, solids, the card, global placement, scale or production.

## Read the right handoff

| Need | Document |
| --- | --- |
| Shared services, contracts and ownership | [H01](01-shared-contracts-and-ownership.md), [H02 lead assignment](02-lead-agent-execution.md) |
| Evidence, readiness and findings | [H10](10-scoped-evidence-packets.md), [H11](11-evidence-readiness-and-review-queue.md), [H12](12-rights-aware-spatial-findings.md) |
| Ingestion and SSE | [H14](14-adaptive-ingestion-and-progressive-review.md) |
| History, shared rights, impact | [H15](15-property-history-and-comparison.md), [H16](16-shared-spaces-and-vertical-rights.md), [H17](17-infrastructure-impact-screening.md) |
| Deployment and governed Sarvam | [H19](19-india-contained-deployment.md), [H20](20-model-gateway-and-budget-pools.md) |
| Renderer and data policy | [H22](22-rendering-and-sparse-data.md), [H23](23-india-data-and-delivery-plan.md) |
| Real reference scene, incomplete data, every input family | [H30](30-reference-scene-and-incomplete-data.md) |
| IDs, exchange and cadastral algorithms | [H26](26-identifiers-and-standard-exchange.md), [H27](27-domain-ai-and-cadastral-checks.md) |
| Exact datasets, tests, acquisition | [H28](28-data-acquisition-and-finale-tests.md) |
| Full product: public, assistance, learner, enrichment | [H13](13-citizen-evidence-and-corrections.md), [H18](18-grounded-assistance-and-mcp.md), [H21](21-concurrent-schema-learning.md), [H25](25-all-format-agent-and-ux4g.md) |
| PPT, human prerequisites, audit history, UI | [H24](24-product-method-and-ppt.md), [H90](90-required-human-tasks.md), [H98](98-engineering-readiness-audit.md), [H99](99-ui-ux-and-integration.md) |
| Task cards for any agent, review findings | [H29](29-agent-task-cards.md), [H97](97-review-findings-and-alignment.md) |
| Design system, UI brief and reference mockups | [Design system](../design-system/README.md), [UI brief](../design-system/ui-brief.md), [Officer Studio reference notes](../design-system/mockups/officer-studio/README.md) and [supplied interactive mockup](../../design-mockup/OfficerStudio.dc.html) (reference only, not production UI) |

## Fixed decisions

- Migrate the application backend to NestJS with `packages/server` and visible SQL/`pg`; follow the migration ledger for temporary Next compatibility. Preserve frontend-owned MapViewport/Cesium boundaries, PostgreSQL/PostGIS, S3-compatible private originals, Redis/Celery and Python. Qualify SFCGAL/tools before use; do not infer capabilities from an installed package. Three/R3F is a later measured renderer option; Helsinki is a data/semantic-city inspiration, not a rendering engine.
- Preserve all originals, IDs, revisions, input fingerprints, linked evidence and current datasets. One registry, job authority, provider gateway and geometry-validation authority. No competing card service or map.
- Operational geography is Indian; data.gov.in is first preference, not proof of suitable surveys. No required locality. Any permitted geography may be tested separately; foreign geometry is never relocated to appear Indian.
- Sarvam is a governed runtime option for the India-resident architecture. Open-source availability is model-specific and does not establish hosted API licensing, data residency or training permission. Verify each selected product and the whole storage/log/backup/egress path. No paid or unapproved provider fallback.
- Public release/privacy is separate from private source access. A QR grants no rights by itself. The deferred public portal does not defer the card's access controls.
- New runtime work is not performed by this alignment. Run the [active-plan validator](tools/validate_handoffs.py) and its tests after plan changes; passing them proves document consistency only.
