# 3D ULPIN — current agent entry point

Read [the orchestration operating guide](docs/orchestration/OPERATING_GUIDE.md) before assignments, reviews and integration. It is the single authority for roles, model selection, ownership handoffs, preview lifecycle and lean verification. Read [handoff 00](docs/usp-agent-handoffs/00-README.md), [release-plan.json](docs/usp-agent-handoffs/release-plan.json), H01/H02, H26–H28, H30, the assigned feature and H99 as relevant. [CURRENT_WORK](docs/engineering-plan/CURRENT_WORK.md) identifies the current gate. Read `apps/web/AGENTS.md` before web code changes.

<!-- plan-next-gate: GF0 -->

## Release and product scope

The adopted `finale_v1` is Identify → Prove → Govern, with equal emphasis on adaptive evidence ingestion and officer outcomes. Work from GF0 through GF5 in the release manifest. Reuse the recorded D0/PACK0 and single real D1 milestone; a plan, package declaration, mockup or screenshot does not pass a runtime gate. `full_product` has separate learner, public dashboard, conversational assistance, generative preview, renderer and scale gates. Finale Enhanced view is deterministic, labelled scene dressing over actual layers and records, not a generative preview. H22 retains the current Cesium D0/D1 runtime; a future renderer change is evidence-gated. Indian operational data is governed by H23/H28; foreign tests remain in their own geography.

Ship current UI desktop-first and light-only. Do not add a theme switch, dark-mode delivery or mobile optimisation. Keep semantic components, shared tokens, usable existing responsiveness, keyboard operation, contrast and browser zoom. Progressively replace affected legacy screens within their feature cards using [the design system](docs/design-system/README.md) and Officer Studio mockups as visual references. Preserve active functionality, compatible saved URLs, the shared renderer and unique document/GIS/raster/point-cloud inspection; the user owns the ongoing UI redesign. Never copy sample values or code from mockups into the product.

## Sources, records and selective cleanup

Acquire new operational and test data from data.gov.in first, or directly from the responsible official public authority or issuing institution. Do not invent synthetic records, identifiers, geometry, controls, source documents, images, ownership, rights or expected facts. A mirror, community dataset or vendor prediction is not official merely because it is public. Keep issuer, original URL and bytes, acquisition date, hashes, licence/permission, geography, reference system and limitations. Deterministic extraction is allowed only when traceable to the unchanged original. If a source cannot support a test, record the gap and leave the claim unqualified.

Preserve real gathered originals and their lineage. Retire obsolete or synthetic project assets only through reviewed exact-path or exact-record classification; historical synthetic material is not a qualification for new official-source tests. Do not delete mixed bundles, unknown persisted records, canonical originals, user uploads or source/review history by bulk reset. `REPO_DATA=true` selects isolated repository services; false uses the linked environment. Never reset populated volumes, implicitly reseed, export a replacement snapshot or overwrite `.env`/credentials. Keep restricted large inputs outside Git.

Keep unknown, absent, null, withheld and conflicting distinct. Official parcel ULPINs differ from application building/floor/space IDs; floors are not necessarily units, buildings can span parcels and units can span floors. Geometry and scene display do not establish ownership or official issuance. Estimates and illustrative massing/materials need separate provenance and cannot affect measurement, readiness, rights, packets or learning ground truth. Insufficient source geometry or frames stay flagged. Screens show values and classifications read from records, never hard-coded sample content or labels that call data “fictional” or “demo”. Use the fixed provenance/status words from H99 and H28 where the record supports them.

## Implementation and permission boundaries

Keep Next.js/TypeScript, PostgreSQL/PostGIS, private source/object storage, Redis/Celery, dispatcher, Python processing and the existing Three/Cesium boundaries. Extend one canonical registry, job authority, provider gateway, conversion/validation contract and shared map runtime rather than creating competing services. Coordinate one writer per shared seam. Use the sole original `staging` checkout; record a pinned base and coordinate branch/file changes without creating another worktree unless the user changes this policy. Reconcile the actual integration head before work. Do not push, merge to `main`, deploy, activate public services or make live provider calls without authorization.

H20 governs account scopes, budgets, reservations, throttles, drain and recovery; do not reuse retired credentials, farm grants, evade throttles, purchase credits or expose keys. Sarvam residency, application residency, confidentiality and correctness are separate checks. H21/H23 require applicable written permission before Sarvam-derived outputs are used to train, test or improve ML. Missing permission blocks that training route; permitted independent labels remain separate, and manual/exact conversion must remain useful during outages.

## Repository skills and verification

Skills live in `.agents/skills/<name>/` (`SKILL.md`, optional `scripts/` and `references/`). Each skill does one job, has a clear trigger and produces a concrete output. Put repository rules here or in linked docs, not in skills.

- Before handing off a change that adds or edits UI under `apps/web`, run `$ui-design-check` and include its report.

Use the operating guide's risk-based checks with locked dependencies and existing isolation guards. Record actual commands/exits, code/source/model hashes and receipts; distinguish code tests, local integration, real-source accuracy, learning qualification, performance and deployment. Preserve privacy, stale-event, partial-publication, semantic-error and source-integrity checks where affected. No documentation-only claim passes a runtime gate.
