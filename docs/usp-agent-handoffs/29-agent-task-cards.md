# 29 · Task cards for any coding agent

Written 24 September 2026 with the review in [H97](97-review-findings-and-alignment.md). Each card is one pull-request-sized piece of work that Codex, Claude Code, Gemini CLI or any other user-authorized coding agent can pick up without reading all 25 handoffs. A card names what to read, what to build, where it goes, and how to prove it is done. The handoffs stay the specification; a card never overrides them, and a handoff's "Z. Hardening addendum (H97)" section overrides older text in that handoff.

## How to use a card

1. Read [AGENTS.md](../../AGENTS.md), [H00](00-README.md) and the card's **Read** list. Nothing else is required to start.
2. Check **Needs**: every listed card is merged to staging, or its interface is already in `packages/contracts`. Gates order qualification, not the start of implementation: a GF3 card may start as soon as its inputs exist.
3. Claim the card by opening a branch `agent/<CARD-ID>-<slug>` from the current staging head and a draft pull request titled `[<CARD-ID>] <title>` against `staging`. One card, one branch, one writer. Never merge to `main`.
4. Fill the H02 ticket header in the pull-request description, including `agent.product`, `agent.model` and `agent.effort` as the client reports them.
5. Build only inside **Owns**. Needing a file owned by someone else means a patch request to that owner, not an edit.
6. Finish when **Done when** is true. Runtime tests write receipts under `docs/evidence/usp/finale/<test-id>/` per [H28](28-data-acquisition-and-finale-tests.md). Ask for review from a different model family or a human.
7. Stop and report instead of guessing when a card needs one of the few human inputs in [H90](90-required-human-tasks.md), a secret, a paid service or data you cannot obtain legally. Everything else (acquisition, labels, oracles, timing) is agent work: use documented open sources and record `failed(<reason>)` when one is unavailable.

Tiers (T-read, T-work, T-risk, T-lead) are defined in [H02](02-lead-agent-execution.md) section 2.

## Start here: cards that can run in parallel on day one

| Card | Why it can start now |
| --- | --- |
| FND-01 contract inventory | Reads current code only |
| DATA-01 source bundle | Acquisition and manifests only |
| DATA-02 adversarial fixtures | Synthetic files with oracles |
| LEAD-01 plan machinery | Validator code and tests only |
| UI-01 tokens, fonts, icons | Styling layer; no producer needed |
| INGEST-01 hostile-input guards | Reader hardening with negative fixtures |
| DATA-05 to DATA-08 public data, labels, drone set, oracles | Open downloads and synthetic oracles; no person needed |
| READY-02, UI-07, LEAD-05, DEPLOY-04 | Replace former human tasks with agent work |
| CLEANUP-01 remove obsolete files | Manifest already verified; one change |

## GF0 — data and contracts

### FND-01 · Contract and seam inventory
**Owner** FND · **Tier** T-work · **Test** GF-CONTRACT · **Needs** none
- **Read:** [H01](01-shared-contracts-and-ownership.md) sections 1–10 and Z; [H28](28-data-acquisition-and-finale-tests.md) Z1.
- **Build:** a script that lists each shared seam (schema, registry, source, geometry, job, SSE, UI) with producer file, consumer file, contract type and the test that exercises it. Re-run the recorded D0/D1 regression commands at the current head.
- **Owns:** `scripts/usp/gf/GF-CONTRACT.*`, `docs/evidence/usp/finale/GF-CONTRACT/`.
- **Done when:** `inventory.json` has one row per seam with status `works|partial|missing`; H01 section 10 items 1–6 are each `done@<sha>` or `remaining`; D0/D1 regression receipts exist at the current head.

### DATA-01 · Matched source bundle (any permitted geography)
**Owner** DATA · **Tier** T-work · **Test** GF-DATA · **Needs** none
- **Read:** [H28](28-data-acquisition-and-finale-tests.md) sections 1–5 and Z4; [H23](23-india-data-and-delivery-plan.md) Z.
- **Build:** acquire one Indian context resource and one structured-code resource to stage `tested`, data.gov.in first (publisher-hosted files such as the NWIC rivers shapefile and the LGD district list need no key). The existing Uttam Nagar OSM and Open Buildings pack can serve as the Indian context resource once re-receipted as a `usp-data-pack/1` manifest. Record D7 as `failed(permission_required)` citing `demo-data/real-block/SOURCE_ACCESS.md`. Record licence family per asset. Request-access datasets (ManipalUAVid) and sign-up-only tiles (Bhuvan CartoDEM) are dropped for the finale.
- **Owns:** `fixtures/usp/D*/`, `scripts/usp/data/`, `docs/evidence/usp/finale/GF-DATA/`.
- **Done when:** every asset has the H28 section 5 metadata including `licenceFamily`; no share-alike asset is marked for a non-share-alike export; failures are recorded, not hidden.
- **Don't:** harvest WMS tiles, bypass logins or treat third-party ML footprints as truth.

### DATA-02 · Adversarial and Indian-reality fixtures
**Owner** DATA · **Tier** T-work · **Tests** GF-DATA, GF-RECOVERY, GF-AGENT, GF-T16, GF-T18, GF-T19 · **Needs** none
- **Read:** [H28](28-data-acquisition-and-finale-tests.md) Z2–Z3; [H16](16-shared-spaces-and-vertical-rights.md) Z1–Z2; [H22](22-rendering-and-sparse-data.md) Z3.
- **Build:** CRS mistakes (43N as 44N, Kalianpur as WGS84, swapped axes, missing `.prj`); the Indian messy CSV; injection fixtures; the synthetic deed with dummy Aadhaar/PAN/mobile and a GPS-tagged JPEG; a metro segment crossing two sites; co-op and per-deed UDS cases; clean twins for every adverse topology case; rooftop mumty/tank/parapet and chajja negatives; a sloped-site fixture; a 480-beneficiary lift core; stilt and mezzanine levels.
- **Owns:** `fixtures/usp/D0/adversarial/` and each fixture's `oracle.json`.
- **Done when:** each fixture has an oracle written before any implementation runs on it, with author and date.

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
- **Build:** download the Bihar RERA sanctioned layout PDF and retry the Haryana RERA 2831/2079 attachments at most twice (no login or CAPTCHA). Pin page, revision and feet-inch dimensions. Add one openly licensed multi-unit vector dataset as `test_only` (for example Swiss Dwellings, CC BY 4.0, Zenodo record 7070952; check its class list and licence at download). Write `fixtures/usp/D5/<profile>/manifest.json` (`usp-data-pack/1`) and `sample-manifest.csv` with unknowns stated. RERA bytes stay outside Git with `permission: unconfirmed`.
- **Done when:** D5 is `acquired` or `failed(<reason>)`; every plan is labelled "planned drawing" or "foreign multi-unit test", never as-built.

### DATA-06 · Open drone capture bundle
**Owner** DATA · **Tier** T-work · **Tests** GF-AI, GF-T19, site pipeline · **Needs** none · replaces H90 H7
- **Read:** [H27](27-domain-ai-and-cadastral-checks.md) Z1.
- **Build:** pick an openly licensed OpenDroneMap sample dataset that publishes ground control points (candidates on github.com/OpenDroneMap: `copr`, `boruszyn`, `helenenschacht`; recount GCPs and confirm the licence at download). Generate `capture-manifest.csv` from `gcp_list.txt` and image EXIF. Hold out at least 3 GCPs as checkpoints (leave-one-out when there are fewer than 8). Label the bundle `test_only` with its geography.
- **Done when:** checkpoint residuals in cm come from the ODM report; no Digital Sky, pilot or consent step is involved.

### DATA-07 · Third-party labelled holdouts (D6)
**Owner** DATA · **Tier** T-work · **Test** GF-AI · **Needs** none · replaces H90 H6 (labels)
- **Read:** [H27](27-domain-ai-and-cadastral-checks.md) section A; `services/geo/ml-models.json`; `docs/evidence/t061/` (two learned routes already pinned and evaluated on small third-party samples).
- **Build:** buildings: the HOTOSM `vhr-building-segmentation` test split plus a second family that is open to download (SpaceNet on AWS open data, ISPRS Potsdam/Vaihingen, or WHU). Plans: the CubiCasa5K published test split, plus the D5 multi-unit set for unit and level association. Freeze tile and sheet IDs with hashes in the GF-AI preregistration before any evaluation.
- **Done when:** holdouts are human-labelled by third parties before this project, frozen and hashed. Third-party ML footprints are never truth. Record the caveat that the RF-DETR checkpoint's training set is undocumented: show no overlap, or evaluate the documented DeepLabV3 baseline fine-tuned on HOTOSM train instead. Reconcile the CubiCasa5K licence string (repo says CC BY-NC 4.0; the Zenodo record says CC BY-NC-SA 4.0).

### DATA-08 · Cross-family oracles
**Owner** DATA (a model family different from the implementer) · **Tier** T-work · **Tests** GF-T16, GF-T17, GF-T18, site pipeline · **Needs** DATA-02 · replaces H90 H6 (hand calculations)
- **Build:** stdlib-only scripts with exact `fractions` for carpet components, UDS totals, prism volumes and `groundZ`, committed and hashed before the implementing commit (Git history proves the order).
- **Done when:** each oracle receipt records `review.kind: agent` and `independence: cross_family`.

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
- **Build:** point `docs/engineering-plan/00_START_HERE.md` at `release-plan.json` `nextGate` instead of the old F0/F1-min/V0 order; set legacy `next_task` fields to `"superseded: release-plan.json"` and adjust the legacy validator; add "Historical base X; current base = release-plan.json baseline" to handoff headers that still carry an older baseline; (the retired v2 design pack is removed by CLEANUP-01; [the design system](../design-system/README.md) replaces it).
- **Done when:** both validators pass and no entry point names a different next step.

### LEAD-05 · Demo dataset decision
**Owner** LEAD · **Tier** T-read · **Needs** DATA-01, DATA-05, DATA-06 · replaces H90 H5
- **Build:** `docs/evidence/usp/finale/GF-DATA/site-decision.md` naming the chosen public bundles with licence and geography: the drone set (DATA-06), the D1 3DBAG building, the D5 plans, D0 for rights, and synthetic co-op and per-deed tenure cases (DATA-02). Any permitted geography is fine; no consent step.
- **Done when:** GF0 checklist row 6 in H28 Z1 points at this file.

### CLEANUP-01 · Remove obsolete and duplicate files
**Owner** LEAD · **Tier** T-work · **Needs** none
- **Read:** `docs/cleanup-review/2026-09-25-removals.json` (every path, its reason and the evidence that nothing live uses it).
- **Build:** remove exactly the listed paths on a branch from current staging after checking their recorded Git blob hashes. Remove the remaining GitHub workflows as part of the CI retirement; retain the active handoff and engineering plan files.
- **Done when:** `python3 docs/usp-agent-handoffs/tools/validate_handoffs.py`, its unit tests, `python3 docs/engineering-plan/tools/validate_plan.py`, `pnpm typecheck`, `pnpm test:studio` and `pnpm test:ui` pass; `pnpm build` succeeds. If any fails, restore only the file it names and record why in the removals file.

### CLEANUP-02 · Retire the historical engineering plan and prototypes
**Owner** LEAD · **Tier** T-risk · **Needs** CLEANUP-01
- **Build:** retire `docs/engineering-plan/` (except anything the handoffs still link), `design/reference-map-v5/` and the R3F showcase scene only together with their remaining local consumers: `tests/engineering-acceptance.test.mjs`, the evidence writers in `scripts/spatial/save-demo-datasets.ts` and `tests/t084-dataset-ml-integration.ts`, `scripts/reference/build-shared.mjs`, and `CURRENT_WORK.md` as an entry point (move its gate line into H00 and drop it from `release-plan.json` `entryPoints`). Replace or remove the e2e specs that cannot pass (`tests/e2e/workbench.spec.ts`, `presentation.spec.ts`, `scripts/reference/browser.ts`). The GitHub workflows were retired in CLEANUP-01.
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
- **Build:** exact-revision reads, field diff, lineage display, `sourceDates[]` with roles and `mutationStatus`, and chain state wording.
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
- **Done when:** seeded PII never appears in provider logs, previews, indexes or app logs; a forged `Host` gets 403.

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

### UI-01 · Tokens, fonts and icons
**Owner** UI · **Tier** T-work · **Test** GF-VIEW (visual) · **Needs** none
- **Read:** [H99](99-ui-ux-and-integration.md) Z1; [design system README](../design-system/README.md); [`tokens.css`](../design-system/tokens.css).
- **Build:** extend `--ui-*` tokens with map, rights, marks, ramps, utility and dark values; self-host Noto Sans, Noto Sans Devanagari and Noto Sans Mono; an `Icon` wrapper on Phosphor; a lint warning for new `lucide-react` imports.
- **Done when:** no external font request offline; contrast checks pass in both themes; a Hindi label renders.

### UI-02 · Studio frame
**Owner** UI · **Tier** T-work · **Test** GF-VIEW · **Needs** UI-01
- **Read:** [H99](99-ui-ux-and-integration.md) sections 3–4 and Z2; [UI brief](../design-system/ui-brief.md) "How the map should look".
- **Build:** 56 px top bar with Batches · Map · Register; scope strip; on-demand left panel; single tray; inspector widths; breakpoints.
- **Done when:** selection and camera survive every panel change; 390 × 844 shows the scope header and action.

### UI-03 · Map styling and honest geometry
**Owner** UI · **Tier** T-work · **Test** GF-VIEW · **Needs** UI-01, FND-04
- **Read:** [map and 3D rules](../design-system/map-and-3d.md); [H22](22-rendering-and-sparse-data.md) Z1–Z3.
- **Build:** Colour by (one at a time), evidence fill and record outline encodings, level rail with the named vertical reference, underground mode, "height unknown" and "illustrative" treatments, Indian level kinds.
- **Done when:** each GF-VIEW fixture in H22 Z3 renders as specified and V1–V4 captures match the specimen.

### UI-04 · Batches, intake and workspace
**Owner** UI · **Tier** T-work · **Tests** GF-VIEW, GF-AGENT (UI path) · **Needs** INGEST-02, DOMAIN-02
- **Build:** S1 Batches, S2 Add files with inline mapping questions and "Reused mapping", S3 live import, S9 review details, S10 check and record, S11 assign dialog.
- **Done when:** the officer completes the D0 flow without retyping data; provider-down shows manual mapping.

## GF3 — govern

### READY-01 · Scoped readiness
**Owner** READY · **Tier** T-work · **Test** GF-READY · **Needs** FIND-01, RIGHTS-01
- **Read:** [H11](11-evidence-readiness-and-review-queue.md).
- **Done when:** GF-READY passes and no generated or estimated field upgrades readiness.

### READY-02 · Sourced review policy
**Owner** READY · **Tier** T-work · **Test** GF-READY · **Needs** DATA-02 · replaces H90 H2
- **Build:** fill `review-cases.csv` for the six D0 review cases; `rule_reference` cites public text (RERA 2016 s.2(k) and s.17; the apartment and co-operative acts in H16 Z1); `reviewer_role: agent` with a cross-family review receipt.
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

### UI-05 · Register, evidence, deviation and underground screens
**Owner** UI · **Tier** T-work · **Tests** GF-VIEW, GF-REHEARSAL · **Needs** HISTORY-02, IMPACT-01
- **Build:** S5–S8, S12, S13 per the [UI brief](../design-system/ui-brief.md) with the fixed wording in [H99](99-ui-ux-and-integration.md) Z4.
- **Done when:** V4–V6 captures pass.

## GF4 — share scoped proof

### PACK-01 · Property Card and local QR
**Owner** PACK · **Tier** T-risk · **Test** GF-T21 · **Needs** FND-02, RIGHTS-01, DOMAIN-03
- **Read:** [H10](10-scoped-evidence-packets.md) GF4 sections.
- **Build:** card subtype with P3 code, location line, vertical reference, chain state; `local_operator` resolver labelled "local demonstration link".
- **Done when:** GF-T21 passes, including sibling-leak pixel and metadata checks.

### FND-07 · Release isolation
**Owner** FND with PACK · **Tier** T-risk · **Test** GF-PRIVACY · **Needs** PACK-01, FND-06
- **Done when:** GF-PRIVACY passes; the QR grants no access; private originals never leave through card, export or logs.

## GF5 — rehearse and report

### DEPLOY-02 · Offline rehearsal profile
**Owner** DEPLOY · **Tier** T-work · **Test** GF-REHEARSAL · **Needs** DEPLOY-01
- **Build:** `local_demo_offline` with replayed responses labelled on screen, local tiles and fonts, egress-log assertion of zero non-allowlisted hosts.

### DEPLOY-03 · Compliance note
**Owner** DEPLOY · **Tier** T-read · **Needs** none
- **Build:** the [H19](19-india-contained-deployment.md) Z3 table as a one-page note for the PPT appendix and judges.

### UI-06 · Captures and rehearsal UI
**Owner** UI · **Tier** T-work · **Test** GF-REHEARSAL · **Needs** all GF4 cards
- **Done when:** V1–V8 captures use the specimen data; the rehearsal pass rule in [H28](28-data-acquisition-and-finale-tests.md) Z5 holds.

### UI-07 · Automated task-completion and timing checks
**Owner** UI · **Tier** T-work · **Test** GF-REHEARSAL · **Needs** UI-04, UI-05 · replaces H90 H4 and the H9 study
- **Build:** Playwright journeys (select building and unit, open evidence, make the card), wrong-unit guard, keyboard, focus, axe accessibility checks, 1440 × 900 and 390 × 844. Timing receipts: first selectable scene, time to card, and officer input count on the assisted path versus `manual_mapping`.
- **Done when:** receipts exist and are labelled "scripted, not a human study"; the status reads "intended-user usability: untested" unless a person volunteers.

### DEPLOY-04 · Finale kit
**Owner** DEPLOY · **Tier** T-work · **Test** GF-REHEARSAL · **Needs** DEPLOY-02 · replaces H90 H9 logistics
- **Build:** a frozen-machine script (three cold starts and one offline run), local tile and font cache, a Playwright-recorded backup video with its hash, and the PPT export ready for upload.
- **Done when:** the only remaining steps are H90 short-list items 1 and 2.

### LEAD-03 · Rehearsal and gate sign-off
**Owner** LEAD · **Tier** T-lead · **Test** GF-REHEARSAL · **Needs** every finale card
- **Done when:** three cold-start runs at most 6:00 each plus one offline run; GF0–GF4 carry a cross-family review and the owner approves the GF5 freeze (H90 short-list item 3).

### LEAD-04 · PPT
**Owner** LEAD · **Tier** T-work · **Needs** receipts from each test
- **Read:** [H24](24-product-method-and-ppt.md) and Z.
- **Done when:** every number on a slide cites a receipt ID; empty metric cards say "not yet measured".

## Full product (after GF5)

| Card | Gate | Read first | Key hardening |
| --- | --- | --- | --- |
| FP-PUBLIC-01 | FP-PUBLIC | [H13](13-citizen-evidence-and-corrections.md) Z | DPDP notice and retention, Aadhaar masking, quotas, identity provider, public ingress allowlist, GIGW 3.0, Hindi |
| FP-ASSIST-01 | FP-ASSIST | [H18](18-grounded-assistance-and-mcp.md) Z | Origin and Host checks, inert quotes, question chips before free text |
| FP-LEARN-01 | FP-LEARN | [H21](21-concurrent-schema-learning.md) Z | Offline qualification first, hashed receipts, regional units as `needs_input` |
| FP-FORMATS-01 | FP-FORMATS | [H25](25-all-format-agent-and-ux4g.md) Z | Sanitized samples only, reference rejection, no network readers |
| FP-ENRICH-01 | FP-ENRICH | [H22](22-rendering-and-sparse-data.md), [H25](25-all-format-agent-and-ux4g.md) | Display-derivative store only |
| FP-DEPLOY-01 | FP-DEPLOY | [H19](19-india-contained-deployment.md), [H20](20-model-gateway-and-budget-pools.md) | Multi-pool ledger, CERT-In, processor contract |
| FP-RENDER-01, FP-SCALE-01 | FP-RENDER, FP-SCALE | [H22](22-rendering-and-sparse-data.md), [H28](28-data-acquisition-and-finale-tests.md) | Measured comparison only |
