# 3D ULPIN — adaptive, evidence-linked 3D property platform

<!-- plan-next-gate: GF0 -->

**Current plan: [start here](docs/usp-agent-handoffs/00-README.md). Revised 24 September 2026.**

Build an evidence-linked 3D property workbench: **Identify → Prove → Govern**. Give equal weight to AI-assisted integration of fragmented inputs and the officer outcome: traceable vertical property records, discrepancies and scoped evidence cards.

The [current roadmap](docs/usp-agent-handoffs/00-README.md) separates `finale_v1` from `full_product`. The sequence is data/contracts, proposed IDs/exchange, domain AI/spaces, governance/impact, card/QR and rehearsal; the manifest selects the current gate. Concurrent learning, a privacy-preserving public request dashboard, MCP, enrichment, renderer experiments and scale remain full-product commitments rather than finale prerequisites.

| Topic | Authority |
| --- | --- |
| Releases, dependencies, owners, tests | [release-plan.json](docs/usp-agent-handoffs/release-plan.json) |
| How we build it: ingestion/SSE, geometry and shared UI | [H14](docs/usp-agent-handoffs/14-adaptive-ingestion-and-progressive-review.md), [H27](docs/usp-agent-handoffs/27-domain-ai-and-cadastral-checks.md), [H99](docs/usp-agent-handoffs/99-ui-ux-and-integration.md) |
| Identifiers, LADM and exchange | [H26](docs/usp-agent-handoffs/26-identifiers-and-standard-exchange.md) |
| Exact datasets including data.gov.in and independent tests | [H28](docs/usp-agent-handoffs/28-data-acquisition-and-finale-tests.md) |
| Cesium / R3F / Helsinki decision | [H22](docs/usp-agent-handoffs/22-rendering-and-sparse-data.md) |
| Sarvam, India residency and data policy | [H23](docs/usp-agent-handoffs/23-india-data-and-delivery-plan.md), [H20](docs/usp-agent-handoffs/20-model-gateway-and-budget-pools.md) |
| PPT story and measured statistics | [H24](docs/usp-agent-handoffs/24-product-method-and-ppt.md) |

Operational data is Indian, data.gov.in first, with no mandatory locality. Tests may use any permitted geography separately. Preserve existing sources/identities/revisions. Generated visuals cannot establish survey quantities or legal rights; project IDs are not official issuance.

The [recorded local milestone](docs/evidence/usp/continuation-2026-09-23/README.md) covers bounded D0/PACK0 and one real D1 exterior in the current shared Cesium workflow. It does not pass new finale gates. Use [AGENTS.md](AGENTS.md), current code and isolated services. This alignment changes plans only; main remains unchanged.

## Existing local operation

Follow the [startup guide](docs/OFFICER_STARTUP.md) and [repository-data instructions](repo-data/README.md). Use isolated services for tests. Do not overwrite `.env`, reset populated volumes, reseed implicitly or export a replacement snapshot.

```sh
pnpm install --frozen-lockfile
pnpm platform:start
pnpm db:migrate
pnpm dev
```

Run only applicable configured checks, such as `pnpm typecheck` and `pnpm test:studio`; service/browser tests need their documented isolation. The documentation revision itself is not a runtime test pass. Preserve [fixtures](fixtures/README.md), [source upload packages](data-source/README.md), snapshots and retained originals. No implicit deployment or merge to main.
