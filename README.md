# 3D ULPIN — adaptive, evidence-linked 3D property platform

**Current plan: [start here](docs/usp-agent-handoffs/00-README.md). Revised 24 September 2026.**

Build a useful map while a large dataset is still processing. Source-preserving chunks feed one conversion and validation pipeline. Sarvam assists with unfamiliar structures; a smaller schema model trains alongside the import on eligible checked examples and can take over pending compatible work after independent qualification. Familiar mappings remain the fastest path when already known. Every large input remains chunked, including familiar schemas.

Operational/pilot geography is **India-only**, with **data.gov.in first**. Tests may use any permitted geography. No particular locality is mandatory. Existing datasets and source history remain; foreign test assets are not relocated or published as Indian operational data.

## Read the plan

| Topic | Handoff |
| --- | --- |
| Product scope, authority and next milestone | [00](docs/usp-agent-handoffs/00-README.md) |
| Source chunks, saved progressive map and queue handover | [14](docs/usp-agent-handoffs/14-adaptive-ingestion-and-progressive-review.md) |
| Real concurrent ML, evaluation and promotion; why no initial RL | [21](docs/usp-agent-handoffs/21-concurrent-schema-learning.md) |
| Three/R3F direction, sparse-data visuals and late evidence | [22](docs/usp-agent-handoffs/22-rendering-and-sparse-data.md) |
| Indian sources, Sarvam policy, modular ownership and build gates | [23](docs/usp-agent-handoffs/23-india-data-and-delivery-plan.md) |
| Plain-language value and copy-ready PPT page | [24](docs/usp-agent-handoffs/24-product-method-and-ppt.md) |

The product retains one shared map and register, source-linked property packets, readiness/discrepancy review, history, shared/underground spaces and a distinct public evidence/correction dashboard. Registry documents and other evidence can be attached later without replacing physical identities or rebuilding the whole map.

Enhanced preview may add labelled estimated or illustrative detail. It never changes evidence, measurements, readiness, rights or official identifiers. Too little geometry/reference evidence is flagged rather than disguised as a complete cadastre.

Sarvam is the selected runtime AI path for a designed India-resident deployment, not a guarantee of factual correctness or an already certified hosting boundary. Applicable permission is required before Sarvam-derived outputs are used to train/test/improve ML. Independent eligible labels provide a separate learning route. Live calls, balances, model quality and deployment are separately qualified.

## Existing software and evidence

The [recorded local milestone](docs/evidence/usp/continuation-2026-09-23/README.md) covers the bounded D0/PACK0 workflow and one real D1 exterior's local geometry/identity. It does not establish the revised learner, high-load operation, intelligent visual completion, public deployment or live Sarvam. This revision changes plans, not application implementation.

Use current code and [AGENTS.md](AGENTS.md). Reuse existing Next.js/TypeScript, shared Three/Cesium runtime, PostGIS, private originals and Python/Celery/Redis services. H00 explicitly resolves conflicting older training/data/visual instructions while preserving detailed feature safeguards and regressions.

## Existing local operation

Follow the [startup guide](docs/OFFICER_STARTUP.md) and [repository-data instructions](repo-data/README.md). Use isolated services for tests. Do not overwrite `.env`, reset populated volumes, reseed implicitly or export a replacement snapshot.

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm dev
```

Run only applicable configured checks, such as `pnpm typecheck` and `pnpm test:studio`; service/browser tests need their documented isolation. The documentation revision itself is not a runtime test pass. Preserve [fixtures](fixtures/README.md), [source upload packages](data-source/README.md), snapshots and retained originals. No implicit deployment or merge to main.
