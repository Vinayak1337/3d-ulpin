# Evidence-linked 3D property workflows: agent implementation handoffs

## Readiness audit — read before implementation

The [engineering readiness audit](98-engineering-readiness-audit.md) reviews all 14 original documents against `12b3dcb34fb105991aff87ac864d7b92a0117807` and application baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`. It adds concrete data packs, a feature-to-test matrix, eight visual-result cases, 25 open findings, edge-case tests and a prioritized closure plan.

**The original handoffs are not a blanket go-ahead for a parallel implementation swarm.** First resolve the minimal shared scope/snapshot/transaction contracts and prove a useful active-Studio map → unit → evidence → scoped-packet slice. Real external 3D display and authentic Indian property evidence have separate data/adapter qualifications. A catalogue link, a mock response or a screenshot alone is not feature completion.

The audit contains **proposed remediation**, not silently adopted changes to feature scopes or an application implementation. Original handoffs below remain the reviewed baseline; use the audit's issue IDs and exact edit table to coordinate deliberate corrections and experiments before the affected work starts. No issue is closed simply by proposing a fix. The folder now contains 15 Markdown documents, including the audit; the original delivery history below is preserved.

## Purpose and planning baseline

**Product promise:** reconcile fragmented source evidence with exact 3D property spaces, explain uncertainty, and help people obtain the evidence needed for review. Adaptive ingestion is an enabling differentiator; a map, dashboard, chatbot, or SSE connection alone is not the USP.

This folder specifies future implementation. It does **not** claim that its proposed features are built, tested, officially accepted, or unique in the market. The documentation task does not change application code, data, source files, or the default branch.

| Item | Value |
| --- | --- |
| Repository | `Vinayak1337/3d-ulpin` |
| Baseline branch | `main` |
| Baseline commit | `f623cff897f91bb3ebd4c225f700ac263f7beb72` |
| Baseline commit subject | `Record hosted floor registry verification` |
| Planning date | 22 September 2026 |
| Documentation branch | `docs/usp-agent-handoffs` |
| Inspection method | Static source inspection of the pinned checkout and GitHub repository; selected implementation paths, not every file |
| Verification boundary | Documentation/link/ownership review only; no application runtime or live AI qualification in this task |

Read [root agent instructions](../../AGENTS.md), [web agent instructions](../../apps/web/AGENTS.md), and [current entry points](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx) before implementation. Their latest steering makes **Studio the sole officer interface**. Many active reusable modules still live under `features/officer`; that directory name does not mean they are unused. Preserve historical URL resolution and unique processing capabilities.

The request represented here expands the earlier local-demo roadmap by **planning** public access, controlled AI interoperability, and deployment hardening. Until their explicit gates below pass, retain the existing local/single-operator restriction. Do not interpret these documents as permission to expose the current API or upload private records to an external model.

## What exists, and what this set must not assume

| Confirmed implementation at the baseline | Consequence for implementation |
| --- | --- |
| [Registry records](../../packages/contracts/src/registry.ts), [revision/review storage](../../apps/web/lib/server/registry-db.ts), [review/commit logic](../../apps/web/lib/server/registry.ts) | Extend established IDs, drafts and transactions. Do not create a replacement property database. |
| [Namespaced core identity](../../packages/contracts/src/spatial/core/identity.ts), [evidence catalog](../../packages/contracts/src/spatial/core/source-schema.ts), [snapshot composition](../../packages/contracts/src/spatial/core/snapshot.ts) | Reuse core concepts through explicit adapters. Pure core helpers do not prove every UI or persistence path implements them. |
| [Source bundle](../../apps/web/lib/server/source-bundle.ts) includes byte-identical originals that may concern other floors | A strictly property-scoped extract packet is additional work, not a rename of the ZIP download. |
| [Saved package storage](../../apps/web/lib/server/spatial-dataset-db.ts) constrains its current records to synthetic classification and revision one | Do not turn this showcase store into the production bulk pipeline by removing checks. Use the established case/import workflow and explicit future adapters. |
| [Durable jobs](../../apps/web/lib/server/processing.ts), [dispatcher](../../scripts/dispatcher.ts), [Python workers](../../services/geo/geo/tasks.py) | Extend these services for progressive work; do not add a competing queue or put durable jobs in React state. |
| [Shared data provider](../../apps/web/features/spatial/data/Provider.tsx), [map sessions](../../apps/web/features/spatial/data/session.ts), [Studio viewport leases](../../apps/web/features/studio/scene/SharedViewport.tsx) | Integrate through one coordinated selection/viewport contract, not one map per feature. |
| [Quick register](../../apps/web/features/studio/product/QuickRecords.tsx) and [full register](../../apps/web/features/officer/register/RegisterPage.tsx) | Add contextual panels to these existing surfaces rather than multiplying navigation. |
| [Local API guard](../../apps/web/app/api/v1/%5B...path%5D/route.ts) and [spatial guard](../../apps/web/lib/server/spatial-core-http.ts) | Host/origin restrictions are not citizen authentication or resource authorization. |

Source-derived facts are linked locally. New paths, contracts, thresholds, policies, tables, and endpoints in the handoffs are **proposals**, even when their exact implementation shape is specified. Examples are synthetic. Missing official records, survey accuracy, or approved deployment contracts remain missing rather than being replaced with invented evidence.

## Execution matrix

Priorities express implementation order, not legal significance. P0 establishes compatibility; P1 completes the principal officer journey; P2 extends citizen/temporal/rights workflows; P3 adds cross-property screening and interoperability. Deployment controls are P1 because they gate later exposure, not because they replace local feature work.

| Feature / owner | User value | Handoff | Priority | Dependencies | Owned code areas | Parallel eligibility | Completion evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Shared foundation / FND | Consistent identity, access, revisions and integration | [01 Shared contracts](01-shared-contracts-and-ownership.md) | P0 | Baseline | Shared contracts, target adapters, access layer, migration registry, API mounts | Starts first; publishes F0/F1/F2 gates | Contract fixtures, migration/revision/access tests |
| Property evidence packets / PACK | Obtain only evidence relevant and permitted for a selected space | [10 Evidence packets](10-scoped-evidence-packets.md) | P1 | F0; F1 for live data | `usp/packets` server/UI/test modules | Pure selector after F0; integration after F1 | Cross-property leakage tests and real generated packet |
| Evidence readiness and work queue / READY | Understand what is missing and what to do next | [11 Readiness](11-evidence-readiness-and-review-queue.md) | P1 | F0/F1; FIND and CITIZEN ports optional initially | `usp/readiness` modules | Starts with missing-port fixtures; never invents completed checks | Deterministic dimensions, denominator and queue-to-property demo |
| Rights-aware findings / FIND | Review spatial discrepancies with context and uncertainty | [12 Findings](12-rights-aware-spatial-findings.md) | P1 | F0/F1; RIGHTS enriches relationships later | `usp/findings`, dedicated Python checks | Base rules after F1; richer rights rules wait for RIGHTS | Supported-geometry fixtures, stale-run and review evidence |
| Citizen evidence and corrections / CITIZEN | Find a property, supply requested evidence and track a proposal | [13 Citizen loop](13-citizen-evidence-and-corrections.md) | P2 | F0/F1; F2 + DEPLOY for public activation | `usp/citizen`, public feature components | State machine/fixtures parallel; public activation gated | Two-principal isolation and full submission/review journey |
| Adaptive bulk intake / INGEST | Reuse qualified mappings and review progressive results | [14 Adaptive ingestion](14-adaptive-ingestion-and-progressive-review.md) | P1 | F0/F1; DEPLOY for external inference policy | `usp/ingestion`, dedicated worker tasks | Parsing/recipe engine after F0; dispatcher wiring by FND | Interrupted/resumed import with drift and cross-chunk checks |
| History and comparison / HISTORY | Compare exact recorded, observed and proposed revisions | [15 History](15-property-history-and-comparison.md) | P2 | F0/F1 | `usp/history` modules | Read-only history/available lineage first; new split/merge writes are optional and gated on FND | Live revision-pinned comparison, available lineage reads and clearly labelled optional-write fixtures |
| Shared spaces and vertical rights / RIGHTS | Explain which spaces serve or cross other spaces | [16 Vertical relationships](16-shared-spaces-and-vertical-rights.md) | P2 | F0/F1; HISTORY read port optional with unavailable state | `usp/rights` modules | Current relationships need not wait for new lineage writes; accepted graph wiring after F1 | Duplex, shared stair and evidenced easement examples |
| Infrastructure impact screening / IMPACT | Find potentially affected property volumes for proposed work | [17 Impact](17-infrastructure-impact-screening.md) | P3 | F1; FIND result contract; RIGHTS optional with explicit unknowns | `usp/impact`, dedicated Python screening | Geometry module with fixtures; live workflow after FIND | Excavation/overhead scenarios with coverage limitations |
| Grounded assistance and MCP / ASSIST | Ask permitted questions and navigate to cited evidence | [18 Assistance](18-grounded-assistance-and-mcp.md) | P3 | F1; feature read ports; F2 + DEPLOY + released public projection for remote MCP | `usp/assistance`, MCP adapter | Tool schemas/offline evaluation parallel; native private tools and remote public-only tools stay separate | Grounding, authorization and injection tests; actual client evidence or an explicit unqualified gate |
| India-contained deployment / DEPLOY | Operate a declared data boundary without silent external fallback | [19 Deployment](19-india-contained-deployment.md) | P1 gate | F0; FND access/config ports; provider evidence for claims | `usp/deployment`, deployment overlays and smoke tests | Policy fixtures/config audit after F0; release gate after F2 | Denied-egress, local fallback and restore evidence |
| Unified Studio integration / UI | Make features discoverable without a cluttered product | [99 UI/integration](99-ui-ux-and-integration.md) | Continuous/final | F0 early; every enabled feature before final acceptance | Shared shell, routes, map adapters, common widgets, final E2E | Establish extension slots early; integrate feature branches serially | One shared map, scope-preserving navigation and visual evidence |

`usp/<feature>` is a bounded module family, not an existing path assertion. Each handoff contains full proposed paths and actual existing touchpoints.

## Start order and dependency gates

**F0 — interfaces and fixtures:** FND publishes the versioned contracts, target-resolution mapping, injected port signatures, ownership register and neutral fixtures. Feature agents may then build isolated components and pure services against those fixtures. Mocked consumers are not completed features.

**F1 — local end-to-end foundation:** FND connects adapters to existing database/storage/registry services, registers migrations and feature mounting conventions, and tests stale revisions, source access and local compatibility. PACK, READY, FIND, INGEST, HISTORY and RIGHTS may then connect production paths in parallel within their owned modules. UI owns their shared mounts.

**F2 — authenticated deployment boundary:** FND supplies server-derived principals, verified sessions/token boundaries, explicit resource grants and sensitive route/page coverage. DEPLOY qualifies the selected environment. CITIZEN public activation and ASSIST remote MCP must wait. Local fixture implementations may proceed before this gate.

**Integration wave:** merge dependency changes before consumers; have UI/FND apply shared-file patches one at a time. Run real service and browser scenarios, not only standalone module tests. IMPACT consumes qualified FIND geometry results. READY treats unavailable providers as `not_assessed`, never zero risk.

Do not launch ten agents against `main`. Create `feat/usp-foundation`, then bounded branches/worktrees such as `feat/usp-packets` from the agreed integration base. Record the base SHA in each agent report. Do not force-push, refresh datasets, change `.env`, or merge another agent's work implicitly.

## Verification commands and evidence discipline

Commands below exist in [package.json](../../package.json); run them from the repository root with the locked dependencies installed. Service/browser commands require an explicitly isolated local stack and test data. This documentation task has not run them.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:studio
pnpm test:register-scope
pnpm test:register-exports
pnpm test:registry
pnpm test:api
pnpm test:e2e
```

For new TypeScript tests use the repository's installed runner, for example `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-packets.test.ts` once that **proposed test** exists. Do not invent `pnpm test:usp-*` scripts and imply they already exist. Python additions follow [geo test configuration](../../services/geo/pytest.ini); run `python -m pytest services/geo/tests` in an environment with the repo's geo development dependencies.

Respect the build-server guard in [check-build-server.mjs](../../scripts/check-build-server.mjs). Do not run a production build against another agent's live worktree. Use [isolation helpers](../../scripts/engineering/isolation.mjs) and [Playwright configuration](../../playwright.config.ts); preserve configured ports and `DEMO_BASE_URL`. Never run `repo:init`, reseeding, or snapshot export against somebody else's populated data.

Each agent returns: changed files and ownership exceptions; migrations/config additions; test commands and outcomes; actual HTTP/job/DB evidence; desktop/mobile screenshots for UI work; synthetic-fixture labels; unresolved limits; and a reproducible demonstration. A component that renders against a fixture is not a live integration pass.

## Human work and scope boundaries

[90 Required human tasks](90-required-human-tasks.md) contains only unavailable real-world inputs: permitted sample records, review terminology, intended-user feedback and deployment/identity-provider approvals. Agents own architecture, research from accessible sources, code, fixtures and automated tests. Synthetic fixtures unblock development; they do not qualify real-world accuracy or legal acceptance.

The initial set excludes official national identity issuance, legal adjudication, automatic enforcement, universal format support, online reinforcement-learning guarantees, a new mobile app, and safety certification for excavation. These are not hidden acceptance obligations.

## Original documentation delivery status — before the readiness audit

The completed folder contains **14 Markdown files: this index, shared foundation/ownership, ten feature handoffs (10–19), required human inputs (90), and unified UI/integration (99)**. Each feature includes A–K implementation sections, exact existing/proposed file maps, UI states, dependencies, tests and a copy-paste agent assignment. The UI handoff was written after rereading the feature set; shared ports/ownership, the deployment status entry and optional lineage dependencies were then reconciled individually.

The documentation changes are confined to `docs/usp-agent-handoffs/`. Files were reviewed and committed sequentially; reconciliation edits are separate commits. Relative source/document links were checked against the pinned baseline/new folder, all feature A–K headings and fenced blocks were checked, and `git diff --check` passed. The repository-supported test command names and referenced existing test paths were also checked. **No application test suite, live provider, production deployment, public upload or browser feature journey was executed as part of creating these documents.**

At final documentation validation, remote `main` still matched the pinned baseline. Implementing agents must check for later drift before changing code. Proposed thresholds, parser profiles, policy rules and deployment settings require the qualification described in their handoffs; they are not benchmark results or legal requirements.

Start with FND's F0 interface/fixture gate and UI0 extension slots. Then assign PACK, READY, FIND, INGEST, HISTORY, RIGHTS and DEPLOY to separate bounded branches; CITIZEN/ASSIST/IMPACT can develop fixture-only pieces while their live dependencies are pending. Connect production paths only after the stated gates, and let UI/FND apply shared-file integrations serially. Human inputs do not block synthetic development; they block the specific field/pilot/deployment claims described in 90.

The final delivery is a documentation PR against `main`. No merge into `main` or implementation of the proposed features is authorized by this documentation request.
