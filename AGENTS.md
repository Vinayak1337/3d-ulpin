# 3D ULPIN — current agent entry point

<!-- plan-next-gate: GF0 -->

## Adopted direction, 24 September 2026

Read `docs/usp-agent-handoffs/00-README.md`, `release-plan.json`, H01/H02, H26–H28, H30, the assigned feature and H99. Read `apps/web/AGENTS.md` before web changes. `docs/engineering-plan/CURRENT_WORK.md` names the current gate.

The adopted finale release is `finale_v1`: Identify → Prove → Govern, with equal emphasis on adaptive evidence ingestion and the officer outcome. Start at the next gate declared above and follow GF0–GF5 in the manifest. Reuse the recorded D0/PACK0 and single-real-D1 milestone; do not restart historical F0/F1-min/V0. New finale capabilities remain pending until actual evidence passes.

The separate `full_product` release retains concurrent schema learning, a privacy-preserving public request dashboard, MCP/conversational assistance, generative previews, renderer alternatives and scale. The finale's Enhanced view is deterministic scene dressing over real layers and records (H30), not generative preview. These are not finale prerequisites. H21 permits eligible training alongside imports when that workstream is implemented; a learner/cache is not a substitute for H27's domain AI.

H23/H28 define Indian operational data, data.gov.in-first discovery and separate tests from any permitted geography. H22 retains the current Cesium D0/D1 runtime for the finale; future Three/R3F is evidence-gated. No Delhi-only prerequisite. No planned capability, catalogue or package declaration is an implementation pass.

## Branch and implementation discipline

Current consolidated baseline is `staging@45d033baae7ec4e5a572d82459b0062c70a12c95`. Fetch and reconcile the actual current head before work. New implementation branches use the current verified integration base and target `staging`. Do not merge into `main`, activate public services or deploy without explicit authorization. No force push.

Keep Next.js/TypeScript, existing Three/Cesium runtime boundaries, PostgreSQL/PostGIS, private source/object storage, Redis/Celery, dispatcher and Python processing. Use one canonical registry, one job authority, one provider gateway, one conversion/validation contract and one active shared map runtime. Extend actual existing services rather than inventing competing databases, uploaders, brokers or per-page maps. Preserve compatible legacy URLs and unique document/GIS/raster/point-cloud inspection capabilities.

## Current UI delivery scope — user direction, 25 September 2026

Ship the current product desktop-first and light-mode only. Do not add a theme switch or reserve header space for one; let search, navigation and content use the released space. Ignore previously saved dark-mode preferences. Mobile UI optimization is not a current implementation or acceptance requirement.

Keep semantic components, shared design tokens, flexible layout boundaries and isolated responsive styles so mobile responsiveness and additional themes can be added later without rewriting the product. Preserve useful existing responsive behavior and theme tokens; do not spend current work expanding mobile or dark-mode variants. This direction overrides older plan, design-system and task-card requirements for a theme switch, dark-mode product delivery or mobile optimization. Retain desktop accessibility, keyboard operation, readable contrast and browser zoom support.

## Official-source data only — user direction, 25 September 2026

Do not create or invent synthetic data, sample records, dummy identifiers, simulated source documents, generated test images or agent-authored fixture datasets. Acquire real data from data.gov.in first, or directly from the responsible official government/public authority or official issuing institution. A third-party mirror, community dataset or vendor prediction is not an official source merely because it is publicly available.

Keep the issuing authority, original URL, acquisition date, licence/permission, original bytes and hashes, geography, reference system and source limitations. Deterministic extraction or conversion of official data is allowed when it is traceable to the unchanged original; never invent missing values, relationships, geometry, controls, rights or expected source facts. If an official source cannot support a required test case, record that coverage as unavailable and leave the claim unqualified instead of manufacturing data.

This direct user direction supersedes older plan/task-card instructions to author synthetic fixtures, including the active DATA-02 assignment. Stop that authoring work and acquire official-source replacements. Preserve existing historical datasets, branches and evidence without silently deleting or rewriting them; they do not satisfy the new official-source requirement. Relay this restriction to every worker and include it in future assignments.

## Data and evidence invariants

Preserve originals/hashes, source and geometry revisions, identifiers, locators, reference frames/units, attribution, permissions and review history. Unknown, absent, null, withheld and conflicting remain distinct. Official supplied parcel ULPINs differ from application building/floor/space IDs. A floor is not necessarily a unit; one building can span parcels and one unit can span floors. Source or display geometry does not grant ownership or official issuance.

Never fabricate recorded heights, floors, control points, ownership or analytical conflicts. Enhanced preview may use explicitly labelled estimates and illustrative massing/materials, with separate provenance and capability restrictions. These cannot affect measurement, evidence coverage, readiness, rights, property packets or training ground truth. Insufficient geometry/reference data is flagged, not filled into an apparently complete cadastre. Distinct source geographies remain separate; foreign tests are not moved onto Indian coordinates.

Product screens show only values read from records: no hard-coded sample content, nothing copied from the mockups or the design system's worked example (names, codes, numbers, files, dates, people) into code, fixtures, tests or captures, and no labels calling data "fictional", "demo" or "demonstration data" (H10's "Local demonstration link" names a QR mode, not data). Test data comes from DATA fixtures under H28. Provenance is shown from the record: the dataset's recorded classification in the scope strip and the fixed status words (*Test fixture*, a labelled seeded case, *Replayed*, *Estimated*, *Illustrative*) where the record says so. The Officer Studio mockups in `docs/design-system/mockups/officer-studio/` are reference UIs, not production UI; build in the design language of `docs/design-system/README.md`. Existing hard-coded demo content and "fictional" labels are removed under H29 UI-08, without deleting protected datasets.

`REPO_DATA=true` selects isolated repository services; false preserves the linked environment. Never reset populated volumes, implicitly reseed, export a replacement snapshot or overwrite `.env`/credentials. Existing datasets, canonical originals, upload ZIPs and manifest-bound scene assets remain protected. Historic cleanup records are not permission for a new data purge. Old locality packs remain provenance/regression material, not mandatory acquisition targets. Large/restricted new inputs stay outside Git.

## Ownership and bounded agents

FND owns shared schemas, backend hooks, migrations, configuration/dependencies, transactions and model-dispatch epochs. INGEST owns profiling/partition/conversion/draft leaves. LEARN owns eligible examples, candidate training/inference/evaluation, not queue or registry writes. UI owns shared routes/selection/cache/renderer and public mounts. DATA owns acquisition/fixtures/independent truth. DEPLOY owns provider calls, data/training/egress policy, billing and credentials. Existing feature owners retain their bounded leaves. Transfer shared ownership explicitly; one writer per shared seam.

Use an isolated worktree and record base SHA. Keep at most two implementation owners plus bounded DATA/review initially and at most three unfinished integration-dependent streams later. Only the lead spawns; no recursive workers. Any user-authorized coding agent may lead or work. Choose models by H02's role tiers (the Codex profile keeps the user's GPT-6 Astra lead with Sol/Astra-only workers) and verify actual model/effort settings. Record `agent.product/model/effort` in tickets and receipts. Milestone review comes from a different model family or a human. Unsupported selection uses an explicit serial fallback. Pick work from `docs/usp-agent-handoffs/29-agent-task-cards.md`; `97-review-findings-and-alignment.md` lists open review findings; `docs/design-system/README.md` is the UI source of truth under H99. Coding agents are not runtime processors for private operational records.

## Sarvam and learning gates

Use H20's single governed model gateway and existing budgets, account scopes, reservations, shared throttles, drain/retirement state and recovery. Supplied independent accounts do not establish verified remaining balances or unrestricted permissions. Never reuse retired credentials, farm grants, evade throttles, buy credits or expose keys.

Sarvam residency, application residency, confidentiality and correctness are separate qualifications. H21/H23 require applicable written permission before using Sarvam-derived outputs for training/testing/improving ML. Independent permitted labels have a separate provenance route. A missing permission blocks that training-data route; the full-product learner remains planned and the finale proceeds on qualified non-learning routes. Fake-provider/no-key tests precede permitted live calls. Keep manual/exact conversion useful during outages.

## Verification

Read the assigned test data, use locked dependencies and existing isolation/build-server guards, and preserve current test histories. Test the current release requirements in H28 and release-plan.json. Preserve source integrity, semantic errors/abstention, partial publication, stale events, later evidence, privacy, India policy and bounded resources. Learner parameter updates/handover, enriched display and public dashboard tests belong to their full-product gates. Record executed commands, exit statuses, code/source/model hashes, actual receipts and fresh active-product screenshots. Separate plan readiness, code tests, local integration, learning qualification, real-source accuracy, GPU performance and deployment. A document, mock or screenshot alone cannot pass a runtime gate.
