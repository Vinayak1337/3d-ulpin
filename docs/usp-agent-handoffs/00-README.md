# Adaptive 3D Property Platform — current plan

**Decision date: 24 September 2026. Status: implementation plan, not implemented capability.**
Repository inspected: `Vinayak1337/3d-ulpin`, branch `codex/usp-staging-continuation-20260923`, base `36385b1605e16d50863448b411045ee42cf45913`.

## Product decision

Build an India-focused, evidence-linked 3D property platform. A controlled AI agent orchestrates source-preserving chunking, interpretation and conversion. Useful buildings and roads appear progressively. A smaller schema-learning model trains alongside an import on eligible checked examples; after independent qualification it can take over pending compatible chunks and future familiar deliveries. A separate public dashboard accepts evidence and discrepancy reports. Registry, floor-plan and other evidence can be attached later without rebuilding the map or changing established identities.

The schema learner is mandatory planned scope, not merely a cache renamed as ML. Exact reusable mappings are also retained because executing a known mapping can be faster and more reliable than either model. Every large import remains chunked, including known schemas and the post-handover queue.

## Authority and conflict resolution

The user's current request overrides earlier decisions that excluded learning during imports or presented recipe reuse as its replacement. This revision also distinguishes operational India-only data from unrestricted-geography tests and explicitly permits labelled visual-only completion of incomplete scenes.

Read this index, H14, H21, H22 and H23 before implementation. H24 is presentation copy, not an API specification. Existing H01 and feature H10–H20 remain detailed contracts for their unchanged responsibilities; H02 remains the worker-family and ownership policy. If those documents say training cannot run during imports, all map data may be foreign, visual estimates are categorically forbidden, or public participation is only an officer panel, the corresponding new sections here take precedence. Their integrity, permission, source-preservation, concurrency and review safeguards remain mandatory. This is an explicit revision, not authority to discard old tests.

| Handoff | Required use |
| --- | --- |
| [14 — Progressive ingestion](14-adaptive-ingestion-and-progressive-review.md) | Source chunks, conversion, saved scene updates, SSE and learner handover |
| [21 — Concurrent schema learning](21-concurrent-schema-learning.md) | Actual learning method, labels, permission, evaluation, promotion and rollback |
| [22 — Rendering and sparse data](22-rendering-and-sparse-data.md) | Three/R3F direction, measured renderer decision, evidence versus visual completion |
| [23 — India data and delivery](23-india-data-and-delivery-plan.md) | Dataset policy, modular ownership, problem-statement coverage and build gates |
| [24 — Product and PPT](24-product-method-and-ppt.md) | Investor-readable explanation and copy-ready presentation page |
| Existing 01 / 10–20 / 90 | Reuse exact identity, registry, evidence-packet, rights, public review, provider accounting and security mechanisms |
| Existing 99 | Existing V1–V8 interaction checks remain; H22 adds the revised renderer/visual-completion requirements |

## What is retained

One shared map boundary, one registry authority, existing sources and revisions, saved synthetic packs, external test fixtures, old datasets, source archives, public-table contents and working APIs remain. No locality is a required starting point. Existing Indian locality names can remain as factual provenance or regression labels, never as a production or acceptance prerequisite. Foreign models are test assets only; do not relocate them onto Indian coordinates or ship them as the operational Indian map.

The recorded 23 September milestone covers a bounded synthetic vertical workflow, saved text/CSV packet and one real exterior's local shape/identity. It does not qualify the new learner, smart sparse-data reconstruction, high-load streaming, global placement, public deployment or live Sarvam. Read `docs/evidence/usp/continuation-2026-09-23/README.md` and inspect current code before changing a working seam.

## Execution order

1. Inspect base, existing receipts and protected data; agree the small shared contracts.
2. Complete source-preserving chunks → converted draft → saved assets → progressively updated shared map.
3. In the same milestone, implement the learner's permitted training lane, shadow evaluation and mid-import handover. Do not defer it behind every other USP. A missing training permission blocks only that training-data route, not independent-label learning or ordinary permitted ingestion.
4. Qualify richer rendering, explicit sparse-data display and later evidence attachment.
5. Expand public dashboard, cadastral extraction modalities and load tests through their separate gates.

Do not claim a million-object resident scene. Do not raise parser/scene limits to simulate scaling. No application implementation, migration, deployment, model training, live account call or performance test is performed by this plan revision.
