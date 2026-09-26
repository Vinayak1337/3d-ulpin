# 29 · Task cards for any coding agent

**26 September sequencing:** Planning-only cleanup. No card is dispatched by this document. Future explicitly assigned work is backend-only through [the backend cleanup plan](backend-cleanup-plan.md); the user owns all frontend work. Preserve shared contracts, runtime boundaries, unique inspection and saved URLs.

**Current scope, 26 September 2026:** [Delivery policy](current-delivery-policy.md) takes precedence over older sections and H97 addenda. All active work is backend-only: services, processing, data, security and API contracts for the user-owned UI. The user authorizes assigned backend plan tasks in separate worker worktrees; frontend technology and implementation remain untouched. The [normalized backend decisions](backend-streaming-plan.md) govern streaming, scale and migration. All public-portal work remains full product. Use unchanged official sources; unavailable coverage stays unqualified.

Written 24 September 2026 with the review in [H97](97-review-findings-and-alignment.md). Each card is one pull-request-sized piece of work that Codex, Claude Code, Gemini CLI or any other user-authorized coding agent can pick up without reading all 25 handoffs. A card names what to read, what to build, where it goes, and how to prove it is done. The handoffs stay the specification; a card never overrides them, and a handoff's "Z. Hardening addendum (H97)" section overrides older text in that handoff.

## How to use a card

1. Read [AGENTS.md](../../AGENTS.md), [H00](00-README.md) and the card's **Read** list. Nothing else is required to start.
2. Check **Needs**: every listed card is merged to staging, or its interface is already in `packages/contracts`. Gates order qualification, not the start of implementation: a GF3 card may start as soon as its inputs exist.
3. Claim the card with an explicit owner and pinned staging base. Use a separate pinned worker worktree/branch; one writer owns each shared seam and only the lead integrates to staging. Never merge to `main`.
4. Record the H02 assignment fields, including `agent.product`, `agent.model` and `agent.effort` as the client reports them.
5. Build only inside **Owns**. Needing a file owned by someone else means a patch request to that owner, not an edit.
6. Finish when **Done when** is true. Runtime tests write receipts under `docs/evidence/usp/finale/<test-id>/` per [H28](28-data-acquisition-and-finale-tests.md). Ask for review from a different model family or a human.
7. Stop and report instead of guessing when a card needs one of the few human inputs in [H90](90-required-human-tasks.md), a secret, a paid service or data you cannot obtain legally. Everything else (acquisition, labels, oracles, timing) is agent work: use documented open sources and record `failed(<reason>)` when one is unavailable.

Tiers (T-read, T-work, T-risk, T-lead) are defined in [H02](02-lead-agent-execution.md) section 2.

## Planning boundary and retired UI cards

The user authorizes lead-assigned backend cards after normalization. Execute only the bounded card/paths assigned in a separate worker worktree; the lead hardens plans directly. FND-01 and the backend cleanup plan identify actual route/service consumers before any implementation assignment. Source discovery remains official-only; an old card or cleanup manifest is not permission to generate data, delete mixed assets or rerun retired scripts.

UI-01 through UI-09 are retired implementation assignments, retained only as historical IDs. They do not form a future agent queue. Their backend obligations live in H99 and the existing FND/INGEST/DATA/PACK cards: identity and scope validation, record-backed projections, durable event/asset manifests, sufficiency, provenance, exact-revision packets and service receipts. Token/font/frame/layout/screen/rehearsal-capture tasks belong to the user-owned UI and are not scheduled. Historical card text is recoverable at `92e4d04cdeaaa2d8ccc65680c6fea1675dcee88a`.

## Backend migration and streaming execution cards

These cards implement [the normalized decisions](backend-streaming-plan.md). Public delivery remains full product. Every task uses its own pinned worktree; Luna is max only. Frontend apps, scene/UI packages and `design-mockup/` are excluded.

### API-DOC-01 · Implemented API and real dataset contract
**Owner** FND · **Tier** T-work · **Test** GF-CONTRACT · **Needs** current route/code inventory
- **Build:** a versioned OpenAPI 3.1 specification and concise frontend integration guide from actual route dispatch, request schemas and response producers. Include all current route families/methods, access/principal rules, status/error envelopes, limits, pagination, revision/idempotency headers and original/derivative download semantics. Mark endpoint code presence and actual runtime verification separately. Unsupported/unknown response details are explicitly unresolved, never guessed.
- **Data:** index available real source packs with issuer, original URL, hash/provenance, geography/frame, permission, qualification and the real API flow that ingests/reads them. Do not ship real personal information or invented examples; bytes unavailable in the worktree are unavailable, not a working response example.
- **Owns:** `docs/api/`, a bounded contract/route coverage check under `scripts/api/`, and directly necessary spec validation configuration. No app/UI code or broad new tests.
- **Done when:** the frontend team can find an operation, its schema/access contract, real source availability and verification status; route coverage and local spec/link checks pass. A documentation UI is optional, local and read-only; public hosting is not authorized.

### DATA-10 · Official city or district scale layer
**Owner** DATA · **Tier** T-read (Luna max only) · **Tests** GF-DATA, GF-SCALE-1 · **Needs** none
- **Build:** discover through data.gov.in first, then issuing authorities; acquire a usable official Indian city/district layer with original bytes/hash, access/use/redistribution permission, extent, actual feature/position/byte counts, source keys and CRS/vertical limits. Reuse prior qualified bytes where suitable. Bound the first search to three credible candidates and two access attempts per candidate; do not scrape around authentication or invent replacement geometry.
- **Owns:** a new leaf `fixtures/usp/D3/official-scale-v1/`, its acquisition checker under `scripts/usp/data/`, and one compact DATA-10 receipt. Keep restricted/large originals outside Git; include reproducible source locators.
- **Done when:** the pack is actually acquired and inspected with a precise supported profile, or an evidenced access/permission gap is reported. A vector context layer is not a 3D city or legal parcel qualification. Missing data leaves the mandatory scale gate open.

### RUN-01 · Real-source local backend startup
**Owner** DEPLOY with FND · **Tier** T-work · **Test** GF-BACKEND · **Needs** API-DOC-01 operation inventory; an existing inspected official source
- **Build:** qualify a new guarded, nonce-owned local runtime using existing isolation guards, schema migrations, private object storage, Redis/Celery, dispatcher and the current app API. Keep providers disabled. No retired snapshot restore, implicit seed, borrowed linked environment, populated-volume reset or frontend change. Reuse actual existing code; implement only concrete startup/contract defects found.
- **Owns:** the explicitly assigned real-source runner under `scripts/usp/`, directly affected service/startup configuration and `docs/OFFICER_STARTUP.md`; coordinate any shared lock/config edit with the lead.
- **Done when:** cold startup and service health are observed; unchanged official bytes enter the supported API, a source/job/read lifecycle completes with pinned provenance and current record schemas, originals remain byte-identical, and one retry/restart or unavailable-processor state behaves honestly. Record exact loopback base URL, commands, service/process ownership, source hashes and stop/resume instructions. No fabricated successful response or UI screenshot is a substitute.
- **Handoff:** stop owned failed/temp runs; a successful documented local API environment can be handed to the lead for frontend integration. Never kill another listener or remove volumes. Update API-DOC-01 runtime status from the actual receipt, not from static typechecks.

### API-01 · Shared backend package with compatible adapters
**Owner** FND · **Tier** T-work · **Test** GF-CONTRACT · **Needs** API-DOC-01 inventory
- **Build:** establish server-only `packages/server`, move a bounded existing cohesive backend slice and retain old imports/route semantics via thin compatibility adapters. Begin with backend-only leaves and their error/privacy dependencies; select the slice from the actual dependency map. Keep canonical implementations in one place, with no duplicate store, service or credential initialization.
- **Owns:** `packages/server`, explicitly assigned legacy backend shims and package/workspace wiring; the lead coordinates lockfile writes. No frontend stack/configuration changes, bulk directory move or storage rewrite.
- **Done when:** real current consumers use the package through compatible adapters and the relevant existing checks/typecheck pass. A package shell alone does not complete this card; document which server modules remain at old paths.

### INGEST-06 · Durable large original receipt
**Owner** INGEST · **Tier** T-work · **Test** GF-RECOVERY · **Needs** DATA-10 profile, existing upload/job authority
- **Build:** when needed by the source, add bounded multipart/object-store admission, original-hash finalization, companion completeness, resumable receipts, quotas and safe abort/orphan cleanup. Byte parts do not become semantic records. Preserve current small-upload behavior and per-parser bounds.
- **Done when:** a real original can resume/finalize once without duplicate jobs or cross-upload cleanup, and unavailable/partial originals cannot enter conversion. No in-memory ceiling inflation.

### TILE-01 · Private standard tile generation
**Owner** INGEST with FND · **Tier** T-work · **Test** GF-STREAM · **Needs** DATA-10 inspected profile, qualified source transforms; INGEST-06 only where source size requires it
- **Build:** one suitable pg2b3dm/Martin/TiTiler output profile over canonical publication views; explicit private auth/source allowlists, immutable artifacts, record mapping, versioned grid/transform metadata, generation fence/manifest/outbox, and old/new extent invalidation. Use existing jobs; do not add a parallel dispatcher. Terrain/point clouds require separate qualified processors.
- **Done when:** official bytes yield authorized coherent generations progressively, with exact identity/source lookup, bounded resources and stale/retry/update behavior. Do not claim every candidate tool is integrated or a public projection exists.

### SCALE-01 · Bounded backend scale acceptance
**Owner** DATA with INGEST · **Tier** T-work · **Test** GF-SCALE-1 · **Needs** DATA-10, TILE-01
- **Build:** pin the actual corpus/profile, hardware, budgets and cold/warm procedure before execution; measure first committed useful generation while import continues, completion, memory/storage, bounded spatial lookup and record lookup. Use the acceptance in the normalized plan; no invented benchmark corpus.
- **Done when:** backend budgets and source/identity/recovery checks pass with a traceable receipt. Leave browser/frame-rate/picking acceptance to the frontend owner; absent data or failed budgets do not pass the required gate. No 100k/1M claim from one district layer.

## GF0 — data and contracts

### FND-01 · Contract and seam inventory
**Owner** FND · **Tier** T-work · **Test** GF-CONTRACT · **Needs** none
- **Read:** [H01](01-shared-contracts-and-ownership.md) sections 1–10 and Z; [H28](28-data-acquisition-and-finale-tests.md) Z1.
- **Build:** a script that lists each shared seam (schema, registry, source, geometry, job, SSE, UI) with producer file, consumer file, contract type and the test that exercises it. Reuse historical D0 receipts without recreating retired inputs; run only currently available real-source commands and report missing live coverage.
- **Owns:** `scripts/usp/gf/GF-CONTRACT.*`, `docs/evidence/usp/finale/GF-CONTRACT/`.
- **Done when:** `inventory.json` has one row per seam with status `works|partial|missing`; H01 section 10 items 1–6 are each `done@<sha>` or `remaining`; current real-source coverage and historical-only D0 evidence are explicitly distinguished.

### DATA-01 · Matched source bundle (any permitted geography)
**Owner** DATA · **Tier** T-work · **Test** GF-DATA · **Needs** none
- **Read:** [H28](28-data-acquisition-and-finale-tests.md) sections 1–5 and Z4; [H23](23-india-data-and-delivery-plan.md) Z.
- **Build:** acquire one Indian context resource and one structured-code resource to stage `tested`, data.gov.in first (publisher-hosted files such as the NWIC rivers shapefile and the LGD district list need no key). Existing community/ML packs are historical only; acquire a verified official context resource for current acceptance. Record D7 as `failed(permission_required)` citing `demo-data/real-block/SOURCE_ACCESS.md`. Record licence family per asset. Request-access datasets (ManipalUAVid) and sign-up-only tiles (Bhuvan CartoDEM) are dropped for the finale.
- **Owns:** `fixtures/usp/D*/`, `scripts/usp/data/`, `docs/evidence/usp/finale/GF-DATA/`.
- **Done when:** every asset has the H28 section 5 metadata including `licenceFamily`; no share-alike asset is marked for a non-share-alike export; failures are recorded, not hidden.
- **Don't:** harvest WMS tiles, bypass logins or treat third-party ML footprints as truth.

### DATA-02 · Official difficult-case coverage and source-derived expectations
**Owner** DATA · **Tier** T-work · **Tests** GF-DATA, GF-RECOVERY, GF-AGENT, GF-SUFFICIENCY, GF-T16, GF-T18, GF-T19 · **Needs** none
- **Read:** current delivery policy; H28 Z2–Z3; H16 Z1–Z2; H22 Z3; H30 I.
- **Build:** discover official records that actually contain difficult CRS/axis metadata, mixed Indian units and scripts, privacy-sensitive fields, cross-site infrastructure, co-operative/per-deed rights, topology/contact/hole cases, roof structures, slopes, shared cores and sparse levels. Index real naturally incomplete inputs for H30. Never generate a source, corrupt metadata, insert hostile text, fabricate a clean twin or dummy identity to fill this list.
- **Owns:** source-family pack manifests and permitted extracts under `fixtures/usp/`, acquisition checks under `scripts/usp/data/`, and `docs/evidence/usp/finale/GF-DATA/DATA-02/`. New leaf ownership is assigned explicitly; historical D0 is read-only.
- **Done when:** every required case names official original bytes, issuer, permission and an independently source-derived expectation, or a specific unavailable reason. Freeze available expectations before implementation/evaluation; an unavailable row is not a runtime pass. Prior synthetic attempt histories are integrated but their authored assets are retired; never restore them for new qualification.

### DATA-03 · Licences, India boundary and ID normalisation data
**Owner** DATA · **Tier** T-read · **Test** GF-DATA · **Needs** none
- **Read:** [H28](28-data-acquisition-and-finale-tests.md) Z4; [H23](23-india-data-and-delivery-plan.md) Z.
- **Build:** the licence table as data (`fixtures/usp/licences.json`); a pinned Survey of India boundary release with the island rule; `normalizedKey` test pairs including Devanagari digits.
- **Done when:** Andaman point admitted, Colombo point rejected; `१२३/४क` pairs with `123/4क` and `123/4` does not pair with `123/40`.

### DATA-04 · GF-AI preregistration
**Owner** DATA with DOMAIN · **Tier** T-work · **Test** GF-AI · **Needs** DATA-07, DATA-08
- **Read:** [H27](27-domain-ai-and-cadastral-checks.md) section A and Z1; [H28](28-data-acquisition-and-finale-tests.md) Z1 row 5.
- **Build:** `docs/evidence/usp/finale/GF-AI/preregistration.json` with task definitions, thresholds, holdout IDs, oracle authors and the frozen roof-height percentile, hashed before evaluation.
- **Done when:** the hash is committed before any model is evaluated on the holdout.

### DATA-05 · Public plan bundle (D5)
**Owner** DATA · **Tier** T-work · **Tests** GF-DATA, GF-T17, GF-AI (plans) · **Needs** none · replaces H90 H1/H1a
- **Read:** [H28](28-data-acquisition-and-finale-tests.md) sections 2, 4, 5 and Z4.
- **Build:** download the Bihar RERA sanctioned layout PDF and retry the Haryana RERA 2831/2079 attachments at most twice (no login or CAPTCHA). Pin page, revision and feet-inch dimensions. Add an official-issuer multi-unit vector dataset as `test_only` only after authority and permission verification; previous third-party candidates remain historical leads, not approved substitutes. Write `fixtures/usp/D5/<profile>/manifest.json` (`usp-data-pack/1`) and `sample-manifest.csv` with unknowns stated. RERA bytes stay outside Git with `permission: unconfirmed`.
- **Done when:** D5 is `acquired` or `failed(<reason>)`; every plan is labelled "planned drawing" or "foreign multi-unit test", never as-built.

### DATA-06 · Official drone capture bundle
**Owner** DATA · **Tier** T-work · **Tests** GF-AI, GF-T19, site pipeline · **Needs** none
- **Read:** current delivery policy; H27 Z1; H28 source permissions.
- **Build:** acquire a permitted capture directly issued by an official authority/institution, including original images, calibration and surveyed controls when provided. Derive the capture manifest from unchanged official files. Community sample repositories are not automatic substitutes. Hold out source-supplied checkpoints before evaluation; do not invent control points.
- **Done when:** actual source/permission and checkpoint geometry/residual evidence exist, or missing capture/control coverage is explicitly unavailable and the associated reconstruction claim remains unqualified.

### DATA-07 · Officially issued labelled holdouts (D6)
**Owner** DATA · **Tier** T-work · **Test** GF-AI · **Needs** none
- **Read:** current delivery policy; H27 A; existing model receipts as history only.
- **Build:** discover officially issued, permitted human-labelled imagery, plans or point-cloud benchmarks. Verify the original issuing institution and licence; do not treat a community mirror, vendor prediction or public bucket as proof of official status. Freeze actual tile/sheet IDs and hashes before evaluation, and check training overlap.
- **Done when:** eligible labels, permission and independent holdouts are pinned; unsupported families remain coverage gaps. Agent-drawn labels and ML predictions cannot replace official reference labels.

### DATA-08 · Cross-family oracles
**Owner** DATA (a model family different from the implementer) · **Tier** T-work · **Tests** GF-T16, GF-T17, GF-T18, site pipeline · **Needs** DATA-02 · replaces H90 H6 (hand calculations)
- **Build:** independent calculations over unchanged official source facts, using exact `fractions` where justified for carpet components, UDS totals, prism volumes and `groundZ`; no invented numerical inputs. Commit source pins and derivations before the implementing commit (Git history proves the order).
- **Done when:** each oracle receipt records `review.kind: agent` and `independence: cross_family`.

### DATA-09 · Real reference area
**Owner** DATA · **Tier** T-work · **Tests** GF-DATA, GF-SCENE · **Needs** DATA-01, DATA-05
- **Read:** [H30](30-reference-scene-and-incomplete-data.md) B and G; [H28](28-data-acquisition-and-finale-tests.md) sections 3–5 and Z4.
- **Build:** choose one Indian area of about 0.5–2 km² by H30 B's criteria (open context layers; a D5 planned building whose location its source record states; small enough to stream). Acquire the layers in H30 B's table as `usp-data-pack/1` assets under `fixtures/usp/D4/reference-area-<name>/` (D4 already holds DATA-01's real context layers; no new pack ID): LGD and boundary context (data.gov.in first), a permitted official DEM and official roads, water, land use, trees and buildings where published; no community/vendor substitute. Record licence, attribution, CRS, vertical reference and stage per layer. Large bytes stay outside Git.
- **Done when:** every layer is `tested` or `failed(<reason>)`; the attribution list is complete; ODbL layers are marked so they never enter record exports; the area and its geography are named in LEAD-05's decision.

### LEAD-01 · Plan machinery that can tell the truth
**Owner** LEAD · **Tier** T-risk · **Test** planValidation · **Needs** none
- **Read:** [H97](97-review-findings-and-alignment.md) C01, C14–C16, C50, C51; `tools/validate_handoffs.py` and its tests.
- **Build, in the validator and `release-plan.json`:**
  - `waivers[] {test, gate, reason, approvedBy, claimRemovedFrom}` so an honestly open test can be waived by the owner (H90 short-list item 3) instead of freezing every later gate.
  - `humanDependencies[] {id, neededFor, status, owner, fallback}` seeded only with the H90 short list; a `blocked` gate must cite an open one.
  - `targetDate` and `fallbackDecisionDate` per gate (ISO, increasing).
  - `releaseCandidate.commit`; GF5 needs receipts at that commit, run after GF4 completed; `attempts[]` keeps failed runs.
  - Receipts: read `receiptContract.requiredFields`; require `review` with reviewer different from producer; check `codeCommit` is an ancestor of HEAD, `runAt` is not in the future, and artifacts sit under the test's folder.
  - Recompute `filesSha256` of the plan-validation receipt; stale hashes fail.
  - Gate markers and "Next gate:" only in entry points; scan `**/*.md`; a clear error for non-UTF-8 files.
  - Gate completion needs `approvedBy`: a cross-family agent review for GF0–GF4, the owner for GF5 and for waivers.
- **Owns:** `docs/usp-agent-handoffs/tools/`, `release-plan.json` schema fields.
- **Done when:** every new rule has a failing and a passing unit test; the validator passes on the current plan.

### LEAD-02 · Retire stale pointers
**Owner** LEAD · **Tier** T-read · **Needs** none
- **Build:** keep `docs/engineering-plan/00_START_HERE.md` as a historical pointer to H00 and `release-plan.json` `nextGate`; legacy `next_task` fields and their validator are retired only when their remaining consumers are migrated. Mark older handoff baselines as historical where they can be mistaken for the current integration head. The [design system](../design-system/README.md) replaces the retired v2 design pack as current UI direction.
- **Done when:** both validators pass and no entry point names a different next step.

### LEAD-05 · Finale dataset decision
**Owner** LEAD · **Tier** T-read · **Needs** DATA-01, DATA-05, DATA-06, DATA-09 · replaces H90 H5
- **Build:** `docs/evidence/usp/finale/GF-DATA/site-decision.md` naming the chosen public bundles with licence and geography: the DATA-09 reference-area identifier and manifest the UI can request, the drone set (DATA-06), the D1 3DBAG building, the D5 plans, official rights and tenure cases where available, with DATA-02 gaps recorded; historical D0 is not replacement qualification. Any permitted geography is fine; no consent step.
- **Done when:** GF0 checklist row 6 in H28 Z1 points at this file.

### CLEANUP-01 · Remove obsolete and duplicate files
**Owner** LEAD · **Tier** T-work · **Needs** none
- **Read:** current exact-path cleanup inventories and consumer reviews; older removal manifests are historical and require reconciliation.
- **Build, only when separately assigned:** reconcile exact path hashes and current consumers, migrate references, then retire only reviewed obsolete assets. Preserve real originals, mixed bundles, supplied design references and the user index; no blanket delete.
- **Done when:** exact removals and retained evidence are recorded; document checks and only directly affected existing backend checks pass. A plan-only cleanup does not run application/build/browser suites.

### CLEANUP-02 · Retire the historical engineering plan and prototypes
**Owner** LEAD · **Tier** T-risk · **Needs** CLEANUP-01
- **Build:** retire superseded historical plan and capture paths after moving active pointers to H00 and pinning Git-history recovery. Keep the four acceptance-test inputs, legacy validator inputs, source/design hashes and live evidence readers until their consumers are migrated. Retire `design/reference-map-v5/` and the R3F showcase scene only together with their remaining local consumers: `tests/engineering-acceptance.test.mjs`, the evidence writers in `scripts/spatial/save-demo-datasets.ts` and `tests/t084-dataset-ml-integration.ts`, and `scripts/reference/build-shared.mjs`. Replace or remove the e2e specs that cannot pass (`tests/e2e/workbench.spec.ts`, `presentation.spec.ts`, `scripts/reference/browser.ts`). The GitHub workflows were retired in CLEANUP-01.
- **Done when:** the applicable local validators, tests, typecheck and build pass, and the handoff validator still passes.

## GF1 — identify and exchange

### FND-02 · Proposed IDs, lifecycle and location line
**Owner** FND · **Tier** T-risk · **Test** GF-T15 · **Needs** FND-01
- **Read:** [H26](26-identifiers-and-standard-exchange.md) sections A–C and Z1–Z2; [H01](01-shared-contracts-and-ownership.md) section 4.
- **Build:** the `P3/1` encoder and validator (use the fixed vectors; never generate expected values with the production encoder), `assignProjectCode`, cancel, retire, split, merge, `boundary_adjustment`, anchor states, and the derived `verticalLocator`.
- **Done when:** GF-T15 passes, including exhaustive single-substitution and adjacent-transposition tests, two-writer concurrency, stale-manifest 409, locator changes without code changes, `MULTI(2)`, and the resolver's 422 on a locator string.

### HISTORY-01 · Exact reads, diff and lineage
**Owner** HISTORY · **Tier** T-work · **Test** GF-T15 history rows · **Needs** FND-02
- **Read:** [H15](15-property-history-and-comparison.md) sections E, I and Z1, Z3, Z4.
- **Build:** exact-revision reads, field diff, lineage projection, `sourceDates[]` with roles and `mutationStatus`, and chain state wording.
- **Done when:** `2024-03-31` round-trips unchanged; a pending mutation is never shown as a recorded transfer; history rows of GF-T15 pass.

### FND-03 · CityJSON 2.0 plus sidecar, LADM mapping
**Owner** FND · **Tier** T-work · **Test** GF-EXCHANGE · **Needs** FND-02
- **Read:** [H26](26-identifiers-and-standard-exchange.md) sections D–F and Z3.
- **Build:** `P3-CJ/1` export and comparison-report import; sidecar with licence family and vertical reference; LADM field-mapping report.
- **Done when:** `cjval` and `val3dity` pass with versions in the receipt; round trip reports every loss; a share-alike object is refused in a non-share-alike export.

## GF2 — prove spaces

### FND-04 · Geometry classes and display-derivative separation
**Owner** FND · **Tier** T-risk · **Tests** GF-VIEW, GF-T18 · **Needs** FND-01
- **Read:** [H22](22-rendering-and-sparse-data.md) Z1–Z2; [H01](01-shared-contracts-and-ownership.md) Z1.
- **Build:** `representation`, `geometryClass`, `analyticEligible`, `semanticLod`, `DataSufficiencyVerdict`, the `declaration` command kind and pins, and a separate display-derivative store only the display compiler can read.
- **Done when:** a SQL-level test shows FIND, READY, PACK and export cannot read display derivatives, and canonical tables hold zero `illustrative` rows.

### FND-05 · Receipts and GF test commands
**Owner** FND · **Tier** T-work · **Needs** LEAD-01 for the schema
- **Build:** `scripts/usp/receipt.py run --test <id> -- <cmd>` that writes receipts from an actual run (commit, hashes, environment, exit code, artifacts) and `pnpm test:gf:<id>` scripts under `scripts/usp/gf/`.
- **Done when:** a receipt cannot be produced without running the command; hand-written receipts fail the validator.

### FND-06 · Redaction module, egress guard and Host allowlist
**Owner** FND · **Tier** T-risk · **Tests** GF-AGENT, GF-PRIVACY · **Needs** none
- **Read:** [H14](14-adaptive-ingestion-and-progressive-review.md) Z2; [H19](19-india-contained-deployment.md) Z1, Z4.
- **Build:** one shared redaction module (Aadhaar with Verhoeff, VID, PAN, Indian mobile, EXIF strip); ignore `NOUS_API_KEY` unless `ULPIN_ALLOW_NON_INDIA_PROVIDER=1`; capability-driven residency copy in the Shell; `Host` allowlist on the loopback app.
- **Done when:** PII from permitted official source cases never appears in provider logs, previews, indexes or app logs; a forged `Host` gets 403.

### INGEST-01 · Hostile-input guards
**Owner** INGEST · **Tier** T-work · **Test** GF-RECOVERY · **Needs** DATA-02 for fixtures
- **Read:** [H14](14-adaptive-ingestion-and-progressive-review.md) Z1; [H25](25-all-format-agent-and-ux4g.md) Z.
- **Build:** apply the archive validator to every archive, GDAL driver restrictions, entity-free XML parsing, external-reference rejection, header-size checks, CityJSON index and transform checks.
- **Done when:** each hostile fixture fails safely with a named reason and no network request or file read outside the job directory.

### INGEST-02 · Constrained mapping agent
**Owner** INGEST · **Tier** T-risk · **Test** GF-AGENT · **Needs** FND-06, DEPLOY-01
- **Read:** [H14](14-adaptive-ingestion-and-progressive-review.md) sections B and Z2–Z3; [H20](20-model-gateway-and-budget-pools.md) Z1; [H28](28-data-acquisition-and-finale-tests.md) Z2.
- **Build:** deterministic orchestrator; `MappingPlan` with the conversion registry and literal rejection; recipe approval by an officer; per-batch caps.
- **Done when:** all six GF-AGENT cases pass with the fake provider, and the held-out cohort shows zero wrong committed mappings.

### INGEST-03 · Manual mapping, duplicates and recovery
**Owner** INGEST · **Tier** T-work · **Test** GF-RECOVERY · **Needs** INGEST-02 schema
- **Build:** `manual_mapping` in Batch review, same-hash dedupe, source revision reconciliation, 413 with split guidance, and the existing SSE recovery cases.
- **Done when:** the provider-down-mid-batch case completes by manual mapping and GF-RECOVERY passes.

### INGEST-04 · Sufficiency decisions and question budget
**Owner** INGEST with FND · **Tier** T-work · **Test** GF-SUFFICIENCY · **Needs** INGEST-02, DATA-02
- **Read:** [H30](30-reference-scene-and-incomplete-data.md) E and G; [H22](22-rendering-and-sparse-data.md) D; [H14](14-adaptive-ingestion-and-progressive-review.md) Z2–Z4.
- **Build:** `SufficiencyDecision` per object and task (FND adds the type); the fixed order read → reuse → propose → ask → park; at most five class-level questions per batch with evidence and a "Not sure" choice; the "Needs input" checklist on the batch; `reject_for_3d` keeps the original as evidence. Nothing in H30 E's "never filled" list is ever filled.
- **Done when:** GF-SUFFICIENCY passes on DATA-02's mixed-gap batch.

### INGEST-05 · One real sample per finale input family
**Owner** INGEST with DATA · **Tier** T-work · **Tests** GF-SUFFICIENCY, GF-VIEW · **Needs** INGEST-01
- **Read:** [H30](30-reference-scene-and-incomplete-data.md) F; [H25](25-all-format-agent-and-ux4g.md) F.
- **Build:** the capability matrix (received, reader qualified, interpreted, converted, rendered, blocked reason) for every family in H30 F. Qualify one permitted real sample per family marked finale, including KML/KMZ, one DXF, one IFC, one glTF context model, LAS/LAZ, an elevation raster, an orthophoto and a control-point file. Register the rest as *Planned*, never dropped.
- **Done when:** the matrix is saved as a receipt and each finale family has a tested sample or `failed(<reason>)`.

### DOMAIN-01 · Building extraction and the site model pipeline
**Owner** DOMAIN · **Tier** T-risk · **Test** GF-AI · **Needs** DATA-04, DATA-06
- **Read:** [H27](27-domain-ai-and-cadastral-checks.md) sections A–B and Z1.
- **Build:** the learned building-mask route with pinned weights and hash; pipeline steps 1–6 and 8 with artefact contracts; `groundZ` and roof percentile rules; 3D Tiles feature metadata with `recordId`.
- **Done when:** held-out IoU, precision and recall are recorded against independent labels; the sloped-site fixture matches its hand calculation; a pick in Studio resolves to the right `recordId`.

### DOMAIN-02 · Plan segmentation and vertical delineation
**Owner** DOMAIN with FIND · **Tier** T-risk · **Test** GF-AI · **Needs** DATA-04, FND-04
- **Build:** the plan-segmentation route after licence checks; review of room and unit candidates; reviewed level schedule to prisms, including stilt, mezzanine, duplex and basement.
- **Done when:** boundary error and level-association error are recorded on held-out sheets; unsupported inputs abstain.

### DOMAIN-03 · Carpet components
**Owner** DOMAIN · **Tier** T-work · **Test** GF-T17 · **Needs** DOMAIN-02
- **Build:** `CarpetComponent` ledger and `CarpetCheck` per [H27](27-domain-ai-and-cadastral-checks.md) section D.
- **Done when:** GF-T17 matches the hand calculation within the frozen tolerance; wrong definitions return `not_comparable`.

### FIND-01 · Qualified operations and topology
**Owner** FIND · **Tier** T-risk · **Test** GF-T18 · **Needs** FND-04
- **Read:** [H12](12-rights-aware-spatial-findings.md); [H27](27-domain-ai-and-cadastral-checks.md) section C and Z3.
- **Build:** prism and slab operations, SFCGAL probing, topology checks, deterministic finding order, corridor case.
- **Done when:** every adverse case gives its oracle result, every clean twin gives zero findings, and unsupported inputs give `not_assessed` with `volumeM3: null`.

### RIGHTS-01 · Shares, commons and tenure
**Owner** RIGHTS · **Tier** T-risk · **Test** GF-T16 · **Needs** FND-04
- **Read:** [H16](16-shared-spaces-and-vertical-rights.md) sections E and Z1–Z3.
- **Build:** the GF2 must-ship list only: read relationships, one declaration with rational arithmetic, `tenureRegime`, one limited common area, parking categories, the PACK projection.
- **Done when:** GF-T16 passes including co-op, per-deed, stilt-sale and 99.5 % cases; no floating point in share arithmetic.

### DEPLOY-01 · Finale model gateway subset
**Owner** DEPLOY · **Tier** T-risk · **Tests** GF-AGENT and the H20 finale G-tests · **Needs** FND-06
- **Read:** [H20](20-model-gateway-and-budget-pools.md) sections C, E5, E6 and Z1.
- **Build:** `R-MODEL-CORE`: one key from the env namespace, one call table with reserve and settle, project cap, consumer allocation, `ProviderAdapter` with Sarvam, fake and replay adapters.
- **Done when:** G-04, G-05 (single pool), G-08, G-09, G-12, G-17, G-18, G-19 and G-22 pass with the fake provider.

## GF3 — govern

### READY-01 · Scoped readiness
**Owner** READY · **Tier** T-work · **Test** GF-READY · **Needs** FIND-01, RIGHTS-01
- **Read:** [H11](11-evidence-readiness-and-review-queue.md).
- **Done when:** GF-READY passes and no generated or estimated field upgrades readiness.

### READY-02 · Sourced review policy
**Owner** READY · **Tier** T-work · **Test** GF-READY · **Needs** DATA-02 · replaces H90 H2
- **Build:** fill `review-cases.csv` for available official review cases, with absent rule/case coverage left unqualified; `rule_reference` cites public text (RERA 2016 s.2(k) and s.17; the apartment and co-operative acts in H16 Z1); `reviewer_role: agent` with a cross-family review receipt.
- **Done when:** every rule is labelled "sourced policy, not a departmental rule".

### HISTORY-02 · Sanctioned versus observed
**Owner** HISTORY · **Tier** T-risk · **Test** GF-T19 · **Needs** DOMAIN-01, FIND-01
- **Read:** [H15](15-property-history-and-comparison.md) Z2; [H27](27-domain-ai-and-cadastral-checks.md) section D and Z1–Z2.
- **Owns:** `apps/web/lib/server/usp/history/deviation.ts`, `tests/usp-deviation.test.ts`.
- **Done when:** GF-T19 passes including the rooftop-structure and chajja negatives.

### IMPACT-01 · Screening with honest coverage
**Owner** IMPACT · **Tier** T-work · **Test** GF-T20 · **Needs** FIND-01, DATA-02 corridor
- **Read:** [H17](17-infrastructure-impact-screening.md).
- **Build:** IMPACT0 promotion, corridor fixture, "Export screening report" with "Not a clearance or dig permission".
- **Done when:** GF-T20 passes; unmapped areas never read as clear.

## GF4 — share scoped proof

### PACK-01 · Property Card and local QR
**Owner** PACK · **Tier** T-risk · **Test** GF-T21 · **Needs** FND-02, RIGHTS-01, DOMAIN-03
- **Read:** [H10](10-scoped-evidence-packets.md) GF4 sections.
- **Build:** card subtype with P3 code, location line, vertical reference, chain state; `local_operator` resolver labelled "local demonstration link". Expose authorized `PropertyCard` and `VerifyResult` contracts for the user-owned UI; no card screen is assigned.
- **Done when:** GF-T21 passes, including sibling-leak pixel and metadata checks.

### FND-07 · Release isolation
**Owner** FND with PACK · **Tier** T-risk · **Test** GF-PRIVACY · **Needs** PACK-01, FND-06
- **Done when:** GF-PRIVACY passes; the QR grants no access; private originals never leave through card, export or logs.

## GF5 — rehearse and report

### DEPLOY-02 · Offline rehearsal profile
**Owner** DEPLOY · **Tier** T-work · **Test** GF-REHEARSAL · **Needs** DEPLOY-01
- **Build:** `local_demo_offline` with replayed responses carrying explicit provenance, authorized local assets, egress-log assertion of zero non-allowlisted hosts.

### DEPLOY-03 · Compliance note
**Owner** DEPLOY · **Tier** T-read · **Needs** none
- **Build:** the [H19](19-india-contained-deployment.md) Z3 table as a one-page note for the PPT appendix and judges.

### DEPLOY-04 · Finale kit
**Owner** DEPLOY · **Tier** T-work · **Test** GF-REHEARSAL · **Needs** DEPLOY-02 · replaces H90 H9 logistics
- **Build:** a pinned backend service profile and evidence bundle for cold starts/offline recovery, asset hashes and egress policy. Browser/video/PPT production is outside this backend assignment.
- **Done when:** backend evidence is reproducible; outstanding human and user-owned UI integration dependencies remain explicit.

### LEAD-03 · Rehearsal and gate sign-off
**Owner** LEAD · **Tier** T-lead · **Test** GF-REHEARSAL · **Needs** every finale card
- **Done when:** backend operation/recovery/timing receipts are present; GF0–GF4 retain cross-family review. User-owned end-to-end integration and owner-approved GF5 freeze remain required for a product release, not inferred from backend checks.

### LEAD-04 · Evidence and claims ledger
**Owner** LEAD · **Tier** T-work · **Needs** receipts from each test
- **Read:** [H24](24-product-method-and-ppt.md) and Z.
- **Done when:** each backend claim cites a receipt ID; unmeasured results say "not yet measured". Presentation production is outside the backend plan.

## Deferred full-product backend contracts (no work scheduled)

| Card | Gate | Read first | Key hardening |
| --- | --- | --- | --- |
| FP-PUBLIC-01 | FP-PUBLIC | [H13](13-citizen-evidence-and-corrections.md) Z | DPDP notice and retention, Aadhaar masking, quotas, identity provider, public ingress allowlist, GIGW 3.0, Hindi |
| FP-ASSIST-01 | FP-ASSIST | [H18](18-grounded-assistance-and-mcp.md) Z | Origin and Host checks, inert quotes, typed intents, authorized facts and explicit ambiguity |
| FP-LEARN-01 | FP-LEARN | [H21](21-concurrent-schema-learning.md) Z | Offline qualification first, hashed receipts, regional units as `needs_input` |
| FP-FORMATS-01 | FP-FORMATS | [H25](25-all-format-agent-and-ux4g.md) Z | Sanitized samples only, reference rejection, no network readers |
| FP-ENRICH-01 | FP-ENRICH | [H22](22-rendering-and-sparse-data.md), [H25](25-all-format-agent-and-ux4g.md) | Display-derivative store only |
| FP-DEPLOY-01 | FP-DEPLOY | [H19](19-india-contained-deployment.md), [H20](20-model-gateway-and-budget-pools.md) | Multi-pool ledger, CERT-In, processor contract |
| FP-RENDER-01, FP-SCALE-01 | FP-RENDER, FP-SCALE | [H22](22-rendering-and-sparse-data.md), [H28](28-data-acquisition-and-finale-tests.md) | Measured comparison only |
