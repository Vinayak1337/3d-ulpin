# Evidence-linked 3D property workflows — start here

**Execution/provider update, 23 September 2026:** use [02 - Astra Max lead and explicit worker delegation](02-lead-agent-execution.md) and [20 - Sarvam gateway, credit pools and permanent credential retirement](20-model-gateway-and-budget-pools.md). These are supporting instructions for existing roles, not additional independent USPs. The gateway is planned, not live-qualified. Reconcile older starter status below against current code and FND evidence; the inspected implementation base for this update is `codex/fnd-f0-f1@97146d6`.

## 1. Current assignment and authority

**Product outcome:** a visually strong, persisted Studio in which a user selects a building, supplied floor and unit, inspects the matching evidence, resolves a specific uncertainty and obtains a genuinely scoped property packet. Adaptive ingestion expands this working journey; it must not postpone it.

**Plan revision: 22 September 2026; implementation status updated 23 September 2026.** Read this index, [01 shared contracts](01-shared-contracts-and-ownership.md), your assigned feature's A–K sections, and the relevant sections of [99 UI integration](99-ui-ux-and-integration.md). You do not need the historical audit or previous chat to implement a task. [98](98-engineering-readiness-audit.md) is issue history and a closure ledger, not a second implementation specification.

| Item | Baseline / rule |
| --- | --- |
| Repository / original handoffs | `Vinayak1337/3d-ulpin`; original adopted handoffs `e167b1f` on `docs/usp-agent-handoffs`, PR #7 |
| Starter implementation branch | `feat/usp-foundation-f0`, based on cleaned `d6fa4602c0fb85eae71d7e3f63fb42a2684aa1b8`; cleanup PR #8 remains separate |
| Application baseline inspected for the plans | `f623cff897f91bb3ebd4c225f700ac263f7beb72`, `Record hosted floor registry verification` |
| Tested starter code | `1894f2e94e3f4f113fb4431afaf69018dcb730c3`; [actual verification run](https://github.com/Vinayak1337/3d-ulpin/actions/runs/35796807605) |
| Historical starter scope | F0a common validation/data-pack starter implemented; remaining F0 domain contracts/ports and F1/V0 work are not implemented by this starter |
| Meaning of a new path/type below | Required implementation destination unless explicitly identified as implemented in the current 01 status note |
| Meaning of a gate | Required executed evidence, not existence of a plan, type, placeholder or filename |

**What to reuse now:** [USP module](../../packages/contracts/src/usp/index.ts), [common schemas](../../packages/contracts/src/usp/common.ts), [reference codec](../../packages/contracts/src/usp/reference-codec.ts), [data-pack schema](../../packages/contracts/src/usp/data-pack.ts), [offline byte verifier](../../scripts/usp/data/verify-pack.ts) and their 64 passing tests. Root package exports and existing runtime authorities were not changed. F0a is a bounded contract-ready slice, not the full F0 acceptance gate. H01 enumerates the remaining result/manifest/command/job/release contracts and actual producers.

**What to do next:** one FND owner first inspects current implementations and receipts, then completes only remaining foundation/integration gaps; DATA verifies existing D0/D1/D4 work before preparing or acquiring anything missing. Add the UI owner for the shared live V0 integration once the necessary interfaces exist. Do not rebuild the master index, reinterpret the historical audit or launch ten feature agents. `fixtures/usp/D0/contract-smoke` is only a tiny authored integrity/contract test; it is not the 3–5-building demonstration and has no rendered or recorded result.

Before coding, read [root AGENTS](../../AGENTS.md), [web AGENTS](../../apps/web/AGENTS.md), relevant current files and the actual base SHA. Preserve unrelated changes. In particular, main has separate later OCI deployment changes; this starter does not overwrite or merge them. Reconcile branch ancestry before integration rather than assuming this branch is latest main. This revised feature scope replaces contradictory historical handoff sequencing, not source-preservation, local-access or safety requirements. If code has drifted, adapt the narrow integration seam and record the difference; do not rebuild a functioning feature because an old filename or helper changed.

## 2. Existing mechanisms to reuse

| Existing mechanism | Required use |
| --- | --- |
| [Registry contracts](../../packages/contracts/src/registry.ts), [database](../../apps/web/lib/server/registry-db.ts), [review/commit](../../apps/web/lib/server/registry.ts) | Registry remains the recorded-property authority; preserve IDs and revision checks. |
| [Core identity](../../packages/contracts/src/spatial/core/identity.ts), [sources](../../packages/contracts/src/spatial/core/source-schema.ts), [snapshot composition](../../packages/contracts/src/spatial/core/snapshot.ts) | Reuse namespaced refs, exact source parts, missing states and representations through explicit persistence adapters. |
| [Saved synthetic packages](../../apps/web/lib/server/spatial-dataset-db.ts) | Keep `classification='synthetic'` and revision-one constraints; do not turn this store into the new production importer. |
| [Jobs](../../apps/web/lib/server/processing.ts), [dispatcher](../../scripts/dispatcher.ts), [worker](../../services/geo/geo/tasks.py), [JobStore](../../services/geo/geo/store.py) | Reuse the broker and logical jobs; add the fenced-attempt and receipt contracts in 01. |
| [Active Studio route](../../apps/web/app/studio/%5B%5B...view%5D%5D/page.tsx) → [BlockPage](../../apps/web/features/officer/block/BlockPage.tsx) → [SavedSceneViewport](../../apps/web/features/studio/product/SavedSceneViewport.tsx) → [MapViewport](../../apps/web/features/spatial/MapViewport.tsx) | Improve this actual product path, not only the separate showcase. |
| [Compiler](../../apps/web/features/spatial/compiler/compile.ts), [scene service](../../apps/web/lib/server/spatial-core-scene.ts) | Already produce 3D Tiles/GLBs; current scene cache is not durable draft/history storage. Preserve rich external geometry through the separate display adapter in 99. |
| [Quick register](../../apps/web/features/studio/product/QuickRecords.tsx), [full register](../../apps/web/features/officer/register/RegisterPage.tsx), [data provider](../../apps/web/features/spatial/data/Provider.tsx) | One selection/data/viewport boundary; contextual feature panels, not new maps. |
| [Source archive](../../apps/web/lib/server/source-bundle.ts), [scope selector](../../apps/web/lib/register-scope.ts) | Keep full-original archival export distinct from the new scoped derivative. |

Observed geometry, planned drawings, inferred quantities, authored fixtures, technical review and official authority are separate dimensions. Appearance never becomes evidence. Official ULPIN assertions belong to parcels; buildings and spaces keep clearly labelled application identities.

## 3. Execution gates and work allocation

| Gate | Owner and bounded deliverable | Acceptance / unlock |
| --- | --- | --- |
| F0 | FND: shared schemas and executable request/result fixtures in 01, exact refs, intake/snapshot scopes, job/result/release contracts. DATA can acquire originals before F0. F0a common/data-pack slice now exists; full gate remains open. | Producer and consumer parse the same success, pending, unavailable and error fixtures. This permits isolated work, not completion claims. |
| F1-min | FND: D0 live target/evidence reads, exact manifests, additive metadata stores, local access, shared-client commands and job hooks. | Real DB/storage tests, stale rejection, rollback and replay-safe receipt. No public IdP needed. |
| V0 | UI + FND with the PACK role: D0 active map → building → supplied floor/unit → evidence → a scoped text/CSV packet → reload. UI separately qualifies one real D1 roof model. | V1–V5/V8 in 99 as applicable, persisted IDs, independent oracles, real network/storage calls. PDF-specific acceptance is a later PACK gate, not falsely passed by text export. |
| F1-feature | FND registers only ports/migrations actually required by the next feature; feature owners connect them. | Narrow producer/consumer and live integration checks per handoff. |
| I1 | INGEST produces durable draft manifests; UI consumes them; FIND supplies supported reconciliation checks. | Three chunks including reversed completion/failure, restart/replay and correct final target set. Parsing/preview can work without FIND; completed spatial assessment cannot. |
| F2 | FND authenticates principals and covers API, assets and server-rendered pages; DEPLOY qualifies the environment. | Real multi-principal tests and approved public release/quarantine boundary. Required for public activation, not V0 or native local assistance. |

**Initial concurrency:** at most two implementation owners plus one DATA/verification task. FND may execute the bounded PACK0 text/CSV slice as the PACK owner; ownership is explicitly transferred before another PACK agent writes those files. UI owns all shared frontend mounts. After V0, at most three integration-dependent feature branches remain unfinished at once. Do not launch all features from main merely because F0 types exist.

| Owner / handoff | User outcome | Dependencies for live completion | Owns / test data |
| --- | --- | --- | --- |
| DATA, section 4 here | Reproducible inputs with independent truth and known absences | Source access; F0 for manifest validation | `fixtures/usp/**`, `scripts/usp/data/**`; D0–D7 acquisition. No application schema ownership. |
| [FND / 01](01-shared-contracts-and-ownership.md) | Compatible identity, evidence, jobs and commands | Baseline; extend only for present consumers | Shared backend/contracts/config/mounts; D0 plus D1 frame examples |
| [PACK / 10](10-scoped-evidence-packets.md) | Relevant property-only compilation | F1-min; page renderer qualification for PDF | `usp/packets` leaves; D0 mixed source, D4 real rows |
| [READY / 11](11-evidence-readiness-and-review-queue.md) | Explain missing evidence and next step | F1-min; unavailable FIND/CITIZEN states allowed | `usp/readiness`; D0 ten-target oracle, D4 missing geometry |
| [FIND / 12](12-rights-aware-spatial-findings.md) | Measured discrepancy → evidence → saved review | F1-feature geometry/case bridge | `usp/findings`; D0 numeric truth, D7 real-data gate |
| [CITIZEN / 13](13-citizen-evidence-and-corrections.md) | Own submission → clarification → reviewed proposal | F1 for local test; F2 + DEPLOY for public | `usp/citizen`; D0 two contributors, D5 permitted documents later |
| [INGEST / 14](14-adaptive-ingestion-and-progressive-review.md) | Receive unfamiliar supported sources and review progressive results | F1; UI draft consumer; FIND for reconciled assessment; gateway only for AI | `usp/ingestion`; D0 then D3/D4, D1 separate adapter |
| [HISTORY / 15](15-property-history-and-comparison.md) | Exact prior state and source comparison | F1 exact historical manifests | `usp/history`; two D0 revisions, D5 dated pair later |
| [RIGHTS / 16](16-shared-spaces-and-vertical-rights.md) | Shared-space assertion → review → applicable context | F1-feature accepted assertion store; HISTORY optional | `usp/rights`; D0 stair/duplex, D5 clauses |
| [IMPACT / 17](17-infrastructure-impact-screening.md) | Saved proposed volume and affected mapped spaces | F1 + qualified FIND geometry; RIGHTS optional | `usp/impact`; D0 trench/overhead, D7 profile later |
| [ASSIST / 18](18-grounded-assistance-and-mcp.md) | Service-grounded answer → exact evidence/action | F1 native; F2/DEPLOY/released projection for remote MCP | `usp/assistance`; real D0 service facts, D4 extraction tests |
| [DEPLOY / 19](19-india-contained-deployment.md) | Declared boundary, safe failure and recovery | F0 policy; F2/real environment for deployment qualification | `usp/deployment`, reference stack; non-personal D0 |
| [UI / 99](99-ui-ux-and-integration.md) | One visually strong connected Studio | F0 early; F1-min for V0; actual feature producers thereafter | Shared routes/cache/viewport/slots; D0/D1 required, D2 optional |

Implement/read-only local assistance may start after its actual service producers exist; F2 is not required for it. New split/merge editing, general mesh measurement, arbitrary IFC/CAD, large-area production, high availability and broad model retraining remain optional. Do not silently omit them while claiming those capabilities are supported.

## 4. Data packs: acquire before implementing against imaginary inputs

DATA is an AI-agent responsibility. Existing source catalogues are leads, not local datasets. Verification stages are recorded independently: `catalogue_checked`, `bytes_preserved`, `parsed`, `rendered`, `workflow_verified`; attach evidence for each passed stage. Record unavailable/restricted outcomes without fabricating hashes or fields.

| Pack | Source and bounded acquisition | Required use / explicit absence |
| --- | --- | --- |
| **D0 golden vertical workflow** | Reuse authored material/generator knowledge from [reference seed](../../scripts/reference/seed.ts), [complete-data generator](../../scripts/reference/complete-data.py), [comparison manifest](../../apps/web/public/studio-review/comparison-manifest.json). DATA creates an isolated new fixture namespace, never reseeds populated data. | 3–5 buildings, ≤30 spaces; basement, mezzanine, unequal levels, courtyard, shared stair, two-parcel relation, one duplex with separate components, missing source, two revisions, mixed-property document sentinels. Plans/records/3D share one source of truth. All synthetic, no actual residents/official IDs. |
| **D1 real roof geometry** | [3DBAG services](https://docs.3dbag.nl/en/delivery/webservices/) and [one-building response](https://api.3dbag.nl/collections/pand/items/NL.IMBAG.Pand.1655100000500568). Save complete response including metadata; preserve hash; then acquire 25–100 buildings following provider pagination. | CityJSONFeature geometry and identifiers; decode declared transform once. Keep sloped roofs and null floor fields. API uses its declared CRS; do not treat NAP height as ellipsoid height. No apartment rights. Earlier payload inspection is not this agent's render pass. |
| **D2 textured context, optional** | [Helsinki 3D](https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d), [mesh directory](https://3d.hel.ninja/data/mesh/). Choose one small built-up crop; preserve OBJ/MTL/textures or supplied equivalent and dependency paths. | Texture/roof context and missing-texture recovery. No fake selectable legal units in an unsegmented mesh. Catalogue checked previously; archive/render still require acquisition. Keep Helsinki coordinates and attribution. |
| **D3 Delhi context / scale** | First use [existing acquisition notes](../GOOGLE_UTTAM_NAGAR.md), [transfer instructions](../UTTAM_NAGAR_SETUP.md), and bounded `fixtures/google-uttam`. Larger local extract path is documented, not presumed present. Alternatives: [Google polygons](https://sites.research.google/gr/open-buildings/), [height rasters](https://sites.research.google/gr/open-buildings/temporal/), [OSM extracts](https://download.geofabrik.de/asia/india.html). | Existing block → ~500 exteriors → spatially paged publications. Google outlines are not satellite imagery, cadastral parcels or unit plans. Temporal heights are estimates; OSM centrelines are not legal road width. Preserve low-confidence detections separately. Avoid repeating the multi-GB regional download when local bytes exist. |
| **D4 Indian document rows** | [DDA inventory PDF](https://dda.gov.in/sites/default/files/Housing_Department/list_of_flats_and_garages_dda_premium_housing_scheme_2026.pdf). Retrieve original once; use first-page table before whole-document extraction; verify its hash and visually recheck the pinned page. | Extract literal identifiers/floor/pocket/block/quantity definitions. Prior inspected row: `C-01-3`, `1st floor`, Block `NA`, Pocket `E`, Loknayakpuram, `Plint Area` 134.259. This is a recheck target, not a fabricated original or proof of units. No polygon, complete-building inventory or current ownership implied. |
| **D5 matched Indian planned building** | [Haryana RERA project 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831), [project 2079](https://haryanarera.gov.in/view_project/project_preview_open/2079), or a permitted campus/known-property plan. Obtain site/building reference + floor plan + section/level schedule + relevant shared clause. | Previous indices were readable but selected attachments failed; no drawing sufficiency claimed. Confirm tower, phase, revision, units, applicable floors and permission. Model supported local geometry first; global placement awaits controls. Promoter plan is not automatically as-built or current rights. Fall back to D0 without pretending the real-data gate passed. |
| **D6 modality ML** | [CubiCasa5k](https://github.com/CubiCasa/CubiCasa5k) for plans; [UAVPal](https://research.utwente.nl/en/datasets/uavpal/) for imagery/DSM; [IIT Roorkee request page](https://www.iitr.ac.in/uasg2023/sdata.html); [TALD](https://sites.google.com/view/taldiist/home) for LiDAR. | Start one modality, one preserved sample, independent labels and held-out source-family/site split. Verify research/non-commercial/demo terms. No archives or permissions assumed. Room segmentation does not establish legal property boundaries. Does not gate V0. |
| **D7 authoritative local linkage** | [NAKSHA](https://dolr.gov.in/en/about-naksha/), [Delhi Land Records](https://dlrc.delhi.gov.in/), appropriate survey/revenue/road/utility custodian and consenting record holder. | Request one aligned block's available parcel/recorded-road GIS, controls, dates, identifiers and permitted records; utility profiles/as-builts separately. No complete open Uttam Nagar crosswalk established. Blocks real-world boundary/rights claims, not code or D0 tests. |

### Acquisition and fixture contract

FND now provides the initial `usp-data-pack/1` schema in [data-pack.ts](../../packages/contracts/src/usp/data-pack.ts). DATA creates `fixtures/usp/D0` through `D7` as needed, each with `manifest.json`, `expected.json` and only permitted small originals. Acquisition scripts live in `scripts/usp/data/`. The only starter pack delivered here is `D0/contract-smoke`; other paths remain implementation/acquisition tasks. Large/restricted data lives outside Git. The first verifier handles bounded contained local files only; add an explicit qualified private-storage adapter for larger/restricted packs instead of putting credentials in a manifest.

Each manifest records pack/version, asset URLs and actual hashes/bytes, media/parser version, licence/permission, source/date/reference metadata, dependencies, source identifiers, verified stages, expected capabilities and explicit missing capabilities. A source family and object ID form the source key; identical flat labels in different buildings do not. Cross-source joins record method, evidence and unresolved alternatives. An estimate remains an estimate even if another dataset derived from the same provider agrees with it. The F0a manifest deliberately does not yet implement all parser/join metadata; extend it with the actual producer and shared tests before claiming a full normalized dataset. Supplied stage assertions are not trusted evidence by themselves.

D0 stable aliases: `B-A`, `B-B`, `P-A`, `P-B`, `U-A101`, `U-A102`, `STAIR-S1`, `DUPLEX-D1`; map aliases to server-issued IDs via import receipts. Do not hardcode copied database UUIDs. Embed `ONLY_A101`, `NEVER_A102`, and `SHARED_STAIR_CONTEXT` in deliberately separate regions of the same synthetic page. Expected values are authored independently of the implementation:

* O-01: footprints [0,0]–[10,10] and [9,0]–[19,10], Z [0,3] and [1,4]: intersection 10 m², volume 20 m³.
* O-02: same footprints, Z [0,3] and [3,6]: positive volume 0 m³; boundary contact is separate.
* O-03: 10×10 outer square minus 2×2 courtyard: 96 m².

Use exact fixture arithmetic with 1e-6 absolute tolerance for these simple measurements; this is not survey accuracy. Keep conflict fixtures as drafts when existing recording rules correctly reject them. Separate the clean V0 record from deliberately invalid cases so one does not block the entire demonstration.

### Bounded acquisition fallback

Attempt an accessible small source plus its documented alternative, respecting rate limits and at most two retries with backoff per transient failure. Record a terminal access/format/permission failure; do not bypass CAPTCHA, purchase services, send mail or submit applications without separate authorization. Continue with D0 or another explicitly labelled pack. Missing external data cannot silently pass real-source acceptance. DATA supplies the exact pending request to 90 only where a person/account owner is genuinely required.

## 5. Minimal-interruption execution protocol

An agent receives `00 + 01 + its handoff`; UI additionally reads the enabled feature contracts, not every previous chat. Follow the fixed defaults and capability fallbacks. Do not ask the user to select routine parsers, invent fixture records, implement APIs or resolve shared-file conflicts.

**Current model routing (23 September 2026):** Astra Max is the hands-on integration lead. Spawn only GPT-6 Sol or GPT-6 Astra workers when independent work benefits: Sol Medium for bounded read-only exploration, Sol High for DATA/ordinary leaves, Sol XHigh for integration-heavy leaves, Astra High for specific high-risk diagnosis and Astra Max for a persistent hard blocker. Use H02 for exact assignment, settings verification and ownership. Default to at most two spawned threads, no nested spawning, and preserve existing total ownership limits. Do not infer quality or cost from an effort label. Runtime Sarvam profiles/billing are separate and follow H20; no per-key free-credit assumption.

Work on `feat/usp-<owner>` from a recorded integration SHA. A shared change request includes exact path, base SHA, contract version, patch, reason, migration impact and reproducer/test. FND or UI, as sole owner, applies it. If an owner is absent, complete isolated allowed work and return that concrete integration patch with blocked status; never fork a second service or call a mocked route complete. No force pushes, implicit snapshot refresh, deployment or main merge.

Completion statuses: `contract_ready`, `local_integrated`, `real_source_qualified`, `deployment_qualified`, or `blocked(reason)`. Report each applicable status separately. A supported text packet can be locally integrated while PDF remains blocked; a reference mesh can render while analytical volume remains unsupported. An auth fixture can pass without qualifying a real public identity provider. F0a is contract_ready for its explicitly implemented subset only; do not mark all of 01 complete.

## 6. Verification and delivered evidence

Use locked dependencies and [isolation helpers](../../scripts/engineering/isolation.mjs); preserve configured ports/volumes and [build-server guard](../../scripts/check-build-server.mjs). Existing [package scripts](../../package.json):

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

Service tests require isolated configured services. New tests are proposed, not pre-existing commands, except the F0a tests now linked in 01. Run tests after creation with `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test <unit-test-files>`, `pnpm exec tsx <integration-file>`, `pnpm exec playwright test <spec>` and `python -m pytest <geo-tests>`. Do not invent a `pnpm test:usp-*` script and say it ran. Store sanitized evidence under `docs/evidence/usp/<owner>/` with code SHA, pack/hash, environment, command/exit status, numeric expected/actual values, HTTP/job/DB receipts, artifact hashes and applicable V-shot screenshots. Private originals/results stay out of Git.

Every feature tests its named pack before and after integration, then an independent real-source sample when accessible. Keep numerical truth, interaction/visual quality, external-source interpretation and ML generalization as separate checks. No generated result may serve as its own ground-truth oracle. No screenshot, schema validation, catalogue link or mock-only test is sufficient by itself.

## 7. Human inputs and history

[90](90-required-human-tasks.md) limits human work to unavailable permitted records, accountable review terminology, actual deployment approvals and optional intended-user observations. Automated acquisition, fixture preparation, coding, testing and routine research belong to agents. Unknown input is a supported state; no waiting for people before D0/V0.

All 14 original execution documents are the destinations for current corrections; no new remediation document is required. Audit issue history remains in 98 and its immutable pre-remediation commit. The F0a starter has executed schema/byte checks; the broader implementation and real-data gates remain open. Do not call the software foolproof or a deployment qualified merely because a documentation revision or partial contract implementation exists.
