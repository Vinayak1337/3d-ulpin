# 97 · Cross-family review of the finale handoffs

**Current scope, 26 September 2026:** [Delivery policy](current-delivery-policy.md) takes precedence over older sections and H97 addenda. All active plans are backend-only: services, processing, data, security and API contracts for the user-owned UI. No UI implementation, redesign, mobile/theme work or new feature is scheduled. This cleanup is planning only. Use unchanged official sources; unavailable coverage stays unqualified.

**Historical audit boundary:** Findings and dated “Applied” statements below preserve the decisions at that revision. Their UI cards, screen counts, visual-capture assignments and superseded section numbers are historical, not an active queue; current backend contracts are H01/H99 and the delivery policy. No historical pass is upgraded by this scope change.

Reviewed 24 September 2026 by Claude (a different model family from the handoffs' author), at staging commit `7472730`. Scope: all 25 handoffs, `release-plan.json`, the plan validator and its tests, `AGENTS.md`, the engineering-plan entry points and the v2 design pack, compared against the team's hardened plan review, dataset and test plan, design system and UI brief. The validator and its 29 tests were run before and after the edits in this change.

## Verdict

The Codex alignment is honest where it matters most: unknown is never zero, project codes are never called official, screening is never clearance, and runtime passes need receipts. Four things would still hurt the finale:

1. **The process cannot finish honestly.** A gate completes only when every test passes, and gates form one chain. If GF-AI stays open for lack of permitted labels (which H27 allows), GF3–GF5 can never complete. Receipts are typed by hand, so a fabricated one passes.
2. **Only one vendor's agents may work on it.** H02 and `AGENTS.md` allowed only GPT-6 Sol/Astra, so any other agent breaks policy by starting.
3. **Untrusted input reaches models and readers with few guards.** No hostile-file contract for readers, no PII minimisation before provider calls, and injection testing starts at GF4, two gates after the exposure begins.
4. **What judges will ask is under-specified.** There is no readable 3D identity story, no end-to-end Helsinki-style site pipeline, several Indian realities (co-operative societies, stilt parking, CRS zone mistakes, roofprints) would produce wrong results on stage, and the UI handoff was not tied to the agreed design system.

## What this change did

- Added a **"Z. Hardening addendum (H97)"** to H01, H13–H16, H18–H28, H90 and H99. Where an addendum conflicts with older text in the same file, the addendum wins ([H00](00-README.md)).
- Made the agent policy model-neutral by role tier, keeping the Codex profile as the user selected it ([H02](02-lead-agent-execution.md), `AGENTS.md`, root `CLAUDE.md` and `GEMINI.md`).
- Added [H29 task cards](29-agent-task-cards.md) so any agent can pick up one pull-request-sized piece of work.
- Added the repository [design system](../design-system/README.md) and [UI brief](../design-system/ui-brief.md), reconciled with these handoffs.
- Added test **GF-AGENT** and requirement **R-AGENT** (INGEST, GF2) to `release-plan.json`, and regenerated the plan-validation receipt.

No application code, data, service or deployment was changed. No runtime gate passed.

**Follow-up, 25 September 2026.** The human task list was cut to three always-needed items plus two conditional ones ([H90](90-required-human-tasks.md)); everything else became agent cards DATA-05 to DATA-08, READY-02, UI-07, LEAD-05 and DEPLOY-04 in [H29](29-agent-task-cards.md). Any permitted geography is fine, labelled by geography; nothing needs Delhi data. CLEANUP-01 removed the 105 hash-checked obsolete or duplicate files listed in `docs/cleanup-review/2026-09-25-removals.json` and all nine GitHub workflows; the heavier retirement of the old engineering plan and prototypes remains CLEANUP-02.

**UI follow-up, 25 September 2026.** The plan, design system and new UI reference were re-checked against the hardened plan review by Claude. Every hardening item is covered, deliberately changed (table below) or recorded as full_product. Changes:
- Added the [Officer Studio reference mockups](../design-system/mockups/officer-studio/README.md): reference UIs, not production UI, with a data-free [view model schema](../design-system/mockups/officer-studio/view-model.schema.json).
- Synced the [design system](../design-system/README.md) with the team copy.
- Removed sample data and "fictional" labelling from the UI brief.
- Put the no-sample-data, no-"fictional" rule in `AGENTS.md`, with card UI-08 for the existing code.
- Recorded findings C53–C57.

## Findings

Status **Applied** means the handoff text now contains the fix; the code work is still open under the named card. **Open** means only a card exists.

### Blocker

- **C01 · process** — `release-plan.json`, validator. One honestly open test (for example GF-AI without permitted labels) freezes every later gate. **Fix:** `waivers[]` approved by a named human, with the claim removed from the PPT. **Open:** LEAD-01.
- **C02 · agent usability** — H02, `AGENTS.md`, links in H01/H18–H20/H23/H99. Development allowed only GPT-6 Sol/Astra; other agents had no compliant way to work. **Applied:** role tiers with a Codex profile; review by a different family or a human; root `CLAUDE.md`/`GEMINI.md`.

### High

- **C03 · security** — H14 C, H25 A. No hostile-input rules for readers: GDAL VRT and `/vsicurl/`, XXE, zip-slip, decompression bombs, embedded external references. **Applied:** H14 Z1, H25 Z. **Open:** INGEST-01.
- **C04 · security** — H14 B, H18 E, H20 C. Source rows and quotes go to the provider unredacted; Indian records carry Aadhaar, PAN and mobiles. **Applied:** shared redaction module and minimised prompts (H01 Z1, H14 Z2, H20 Z1). **Open:** FND-06.
- **C05 · security** — H20 G-17/G-24, H28 GF-PRIVACY. Injection tests cover only control-plane effects; a schema-valid wrong mapping becomes a reusable recipe; injection is first tested at GF4. **Applied:** officer-approved recipes, GF-AGENT at GF2 (H28 Z2). **Open:** INGEST-02.
- **C06 · security** — H21 A, H01 modelGateway. Nothing stops a model emitting a numeric factor, EPSG code or ID. **Applied:** conversion registry and literal rejection in `MappingPlan` (H14 Z2).
- **C07 · security** — H19 E, H20 F. In the finale build the legacy officer-AI path can still send deed text to a non-Indian endpoint while the Shell says evidence stays local. **Applied:** H19 Z1. **Open:** FND-06.
- **C08 · gap** — H00 finale row, H28 section 6. "Constrained agent assistance" is promised but has no test. **Applied:** GF-AGENT (H28 Z2, `release-plan.json`).
- **C09 · gap** — H00 GF0 row, H28 GF-CONTRACT/GF-DATA. GF0 exit has no outputs, list of seams or thresholds; GF0 duties are scattered across H27, H28 and H90. **Applied:** GF0 checklist (H28 Z1). **Open:** FND-01, DATA-01.
- **C10 · gap** — H90. No human steps for the site decision, drone clearance, GNSS control, independent labels, sign-ups, compute, the human-value study, finale logistics or gate sign-off. **Superseded 25 Sep:** converted to agent cards (DATA-05 to DATA-08, READY-02, UI-07, LEAD-05, DEPLOY-04); H90 now holds only the short human list.
- **C11 · gap** — H24, H26 A. The opaque `P3` code gives judges nothing that reads as "3D", and no slide covers identity. **Applied:** display-only location line (H26 Z1) and a 3D identity slide (H24 Z1). **Open:** FND-02.
- **C12 · gap** — H22 D, H27 B. No end-to-end site pipeline: ground height on slopes, roof percentile, LoD labels, and `recordId` in 3D Tiles are undefined, so agents will extrude arbitrarily. **Applied:** H27 Z1. **Open:** DOMAIN-01.
- **C13 · contradiction** — H22 C, H25 B, H27. "LoD" and "three layers" mean different things in different files, and display derivatives are separated only by tags, which fails open. **Applied:** `representation`, `geometryClass`, `analyticEligible` and a separate display-derivative store (H22 Z1, H25 Z, H01 Z1). **Open:** FND-04.
- **C14 · security** — validator `runtime_receipt`. A fabricated receipt (zero commit, future date, `command: true`) passes. **Applied:** receipt `review`, `agent` and `limitations` fields (H28 Z5). **Open:** LEAD-01, FND-05.
- **C15 · gap** — `release-plan.json` GF5. GF5 can complete on receipts from older commits, and failed attempts cannot be kept. **Applied:** GF5 freshness rule (H28 Z5). **Open:** LEAD-01.
- **C16 · weak approach** — `release-plan.json` gates. A single chain plus one `nextGate` serialises work that could run in parallel (pure-code ID allocation waits on data acquisition). **Applied:** "gates order qualification, not the start of implementation" (H00, H29). **Open:** LEAD-01 for `activeGates[]` if the team wants it enforced.
- **C17 · contradiction** — engineering-plan `00_START_HERE.md`, `PLAN_STATUS.json` (`T059`), `backlog.json` (`T080`), handoff baselines (`f623cff`, `2838e79`, `97146d6`, `45d033b`). Several "next" and "base" pointers disagree. **Open:** LEAD-02.
- **C18 · edge case** — H16 declaration ledger. Co-operative societies, per-deed UDS, leasehold and association-held commons cannot be represented, and the plan recommended a housing society as the finale site (withdrawn 25 Sep; the former synthetic-fixture fallback is superseded by the official-source-only user direction). **Applied:** `tenureRegime` (H16 Z1). **Open:** RIGHTS-01.
- **C19 · edge case** — H16 "unsupported_scope". Metro tunnels, viaducts and pipeline rights of user cross many parcels and are named in SIH 26011. **Applied:** bounded `right_of_user` corridor and fixture (H16 Z2).
- **C20 · edge case** — H23 A. The "inside India" check misses UTM 43N/44N swaps, Kalianpur labelled WGS84, swapped axes and missing `.prj`. **Applied:** H23 Z, H28 Z3. **Open:** DATA-02.
- **C21 · edge case** — H22 D, GF-T19. Imagery outlines are roofprints (chajjas, balconies); parapets, stair cabins and tanks inflate heights; a compliant building can be flagged on stage. **Applied:** H27 Z1, H28 Z3.
- **C22 · weak approach** — H20. A 7-table, 27-test credit ledger manages about ₹300 while the finale needs a handful of calls, and it is unclear which parts the finale needs. **Applied:** `R-MODEL-CORE` subset (H20 Z1). **Open:** DEPLOY-01.
- **C23 · gap** — H19 C. No offline or replay path for unreliable venue Wi-Fi. **Applied:** `local_demo_offline` (H19 Z2). **Open:** DEPLOY-02.
- **C24 · contradiction** — H99 section 4, H25 E, `tokens.css`, `docs/v2-design/BUILD_PROMPT.md`. The finale UI owner never mentions the agreed design system; fonts are Inter/system; icons are mostly `lucide-react`; the old build prompt reads like a live instruction. **Applied:** H99 Z and the repository design system. **Open:** UI-01, LEAD-02.
- **C25 · legal** — H28 section 4. Licences missing for OpenStreetMap, Overture, Microsoft and Open Buildings (ODbL share-alike would attach to exports); WMS viewing mistaken for download permission; "OSM" is ambiguous. **Applied:** H28 Z4, H26 Z3.
- **C26 · gap** — H28 section 4. Third-party ML footprints were "not ground truth" only "by default". **Applied:** never GF-AI truth (H28 Z4).
- **C27 · security** — H13 (full product). No DPDP Act 2023 notice, retention, erasure or grievance; uploaded deeds expose Aadhaar and EXIF GPS; no abuse controls; no citizen identity method; public ingress not restricted. **Applied:** H13 Z.

### Medium

- **C28 · edge case** — H22 D. Stilt floors, mezzanines, lower/upper ground, hill buildings, feet-inch levels. **Applied:** `levelKind` (H22 Z3) and level tokens (H26 Z1).
- **C29 · edge case** — H14 D, H21. Devanagari headers, legacy fonts, lakh grouping, gaj/bigha/guntha units, khasra numbers misread as dates. **Applied:** H28 Z3, H21 Z.
- **C30 · edge case** — H16 J. Stilt and open parking and terraces are common by law; a promoter "sale" of a stilt slot passed as valid. **Applied:** `parkingCategory`, `grantMode` (H16 Z2).
- **C31 · edge case** — H16 E. A lift core serving 480 units breaks the 200-node bound in one hop. **Applied:** per-hop pagination (H16 Z2).
- **C32 · edge case** — H15 E. Execution, registration, mutation and effective dates differ; date-only values shift across IST/UTC. **Applied:** `sourceDates[]` (H15 Z3).
- **C33 · gap** — H15, H27 E. GF-T19 had no inputs or tests in H15, and its file sat in DOMAIN's directory. **Applied:** H15 Z2, H27 Z2.
- **C34 · gap** — H15 I. Step order blocked GF1 on GF2 work. **Applied:** H15 Z1.
- **C35 · contradiction** — H16 vs H01. Declaration commands and snapshot pins had no owner. **Applied:** H01 Z1, H16 Z1.
- **C36 · gap** — H26 C. Partial transfers between continuing spaces fit neither split nor merge. **Applied:** `boundary_adjustment` (H26 Z2).
- **C37 · gap** — H14 B. No no-model route in GF2. **Applied:** `manual_mapping` (H14 Z3).
- **C38 · gap** — H14 E. Duplicate uploads, revised files and oversize files undefined. **Applied:** H14 Z4.
- **C39 · security** — H18 E, H19 J. No Origin/Host validation for MCP or the loopback app (DNS rebinding). **Applied:** H18 Z, H19 Z4.
- **C40 · security** — H20 E7. A secret reference could point at `DATABASE_URL`. **Applied:** env namespace rule (H20 Z1).
- **C41 · gap** — H19, H23. No DPDP, CERT-In or fine-resolution geospatial mapping. **Applied:** H19 Z3, H23 Z.
- **C42 · weak approach** — H24. Caveats on every slide, no trust slide, unnamed metric cards, three different Sarvam lines. **Applied:** H24 Z.
- **C43 · gap** — H28 GF-REHEARSAL. No clear pass or fail. **Applied:** H28 Z5.
- **C44 · agent usability** — H01, H02. Overlapping legacy IDs and worker limits tied to V0. **Applied:** legend and gate-based limits (H01 Z2).
- **C45 · legal** — H20 A. Pooling several promotional grants may breach provider terms. **Applied:** H20 Z2.
- **C46 · weak approach** — H21. Same-import handover will rarely pass; "signed/hashed" receipts. **Applied:** H21 Z.
- **C47 · agent usability** — H14, H22, H25. No file maps, test names or commands. **Applied:** H14 Z5 and H29 cards.
- **C48 · contradiction** — H27, our UI brief. "Ordered by likelihood" claims learned ranking the finale may not have. **Applied:** H27 Z3, H99 Z4.

### Low

- **C49 · agent usability** — H12, H16, H26, `release-plan.json`. GF-T16 and GF-T18 case lists and receipt owners stated in several places. **Applied:** one list per test in H28 (Z3).
- **C50 · process** — validator. Gate markers accepted outside entry points; subfolders not scanned; non-UTF-8 files crash it. **Open:** LEAD-01.
- **C51 · process** — `planValidation`. "passed" never expires after edits. **Applied here:** receipt regenerated with this change's hashes. **Open:** LEAD-01 to enforce.
- **C52 · process** — H23, H28. No convention for GF test script names. **Open:** FND-05.

### UI follow-up (25 September 2026)

- **C53 · contradiction** — UI brief, app code. The brief told mockups to show one worked example and label it "Fictional demonstration"; 35 source files still carry "fictional" labels or hard-coded demo content. **Applied:** no-sample-data, no-"fictional" rule in `AGENTS.md`, H99 Z6 and the design system; the brief is data-free. **Open:** UI-08.
- **C54 · gap** — H99, H29 UI cards. The agreed interactive mockups were not in the repository, so agents had only prose. **Applied:** [reference mockups](../design-system/mockups/officer-studio/README.md) linked from H99 Z6, H00 and the UI and PACK cards, marked reference-only with acceptance left to GF tests and V-shots.
- **C55 · gap** — `docs/design-system`. The repository copy lacked nine components used by the mockups, the type-style table, the icon meanings and several rules. **Applied:** synced; the sync record is in the design-system README.
- **C56 · contradiction** — UI reference vs H22 and the design system. The view model used its own geometry and level-kind names, and the register tabs differed between documents. **Applied:** H22 `representation`, `geometryClass`, `analyticEligible` and `levelKind`; register tabs **Units · Shares · Documents · Checks · History** everywhere.
- **C57 · gap** — hardened plan items with no recorded decision: the air-rights envelope and LGD codes on each record. **Applied:** the two rows added to the table below.

### Data and scene follow-up (25 September 2026)

Added [H30](30-reference-scene-and-incomplete-data.md), requirements R-SCENE and R-SUFFICIENCY, tests GF-SCENE and GF-SUFFICIENCY (GF2), and cards DATA-09, UI-09, INGEST-04 and INGEST-05.

- **C58 · gap** — UI-08, H28. Removing the hard-coded demo left nothing real for the Studio to open on. **Applied:** a real Indian reference area from open, licensed layers (data.gov.in first), with attribution and ODbL kept out of record exports (H30 B). **Open:** DATA-09, UI-08.
- **C59 · weak approach** — H22 C, H25 B. Every visual enrichment was full_product, so the finale map could look good only by breaking the honesty rules. **Applied:** a deterministic Enhanced view over real layers, with one-way sync, staleness and a no-change check (H30 C–D, H22 Z5). Generative enrichment stays FP-ENRICH. **Open:** UI-09.
- **C60 · gap** — H14, H22 D. Incomplete input had principles but no single decision, no limit on questions and no list of facts that must never be filled. **Applied:** `SufficiencyDecision` with fill, ask, park and reject for 3D; at most five class-level questions per batch; per-task minimums (H30 E). **Open:** INGEST-04.
- **C61 · gap** — H14 C, H25 A. There was no finale list of input families with their minimum evidence, and no precedence when LiDAR, DEM, plans and GIS disagree. **Applied:** H30 F–G. **Open:** INGEST-05.

## Alignment with the hardened plan

| Topic | Hardened plan said | Handoffs said | Now |
| --- | --- | --- | --- |
| 3D ULPIN | Hierarchical code with ISO 7064 check, largest-overlap anchor | Opaque `P3` code, reviewed anchors, no largest overlap | `P3` is identity; the hierarchy survives only as the display-only location line |
| Heights | "m AMSL" on levels and card | Never relabel local or GNSS heights as mean sea level | Named vertical reference on every level |
| Dig screening | Export a dig notice; sleeve width by quality A–D | Screening report; quality levels are not metre buffers | Screening report; sleeves only with stated tolerance |
| QR | Buyer scans on a phone | Same-device local demonstration link; phone is conditional | Local link in the finale; phone and portal are FP-PUBLIC |
| AI | Four SIH AI tasks live | Two learned routes plus deterministic delineation and topology | H27 as written; slides say which are learned |
| Findings order | Learned ranking | Optional | Deterministic unless a preregistered test passes |
| Public portal and admin | Must-have P1, P3, P4, A1 | full_product | Finale builds 15 Studio screens plus the local verify page |
| Site | Own campus or housing society, own drone flight | Villa drawing lead; human request only as fallback | Public licensed bundles from any geography: open drone set with GCPs, RERA and open multi-unit plans, D0 for rights; no own site or flight |
| Standards | CityGML 3.0 and 3DCityDB in the finale | CityJSON plus sidecar; others later | CityJSON 2.0 plus sidecar; CityGML 3.0 as a stretch conversion |
| Offline | Cached tiles, offline mode, backup video | Air-gap optional | Offline rehearsal profile and a network-off run |
| Injection fixture | Kept for the finale | Tested at GF4 only | GF-AGENT at GF2 |
| Development agents | Model-agnostic | GPT-6 only | Role tiers, any vendor |
| Air-rights envelope | Thin slice in the finale: remaining FSI and height cap as a `T` volume | Not specified | The finale shows elevated (`A`) extents and the airspace in StrataSection; the envelope needs a sourced development-control rule and stays full_product (S17) |
| LGD codes | On every 3D ULPIN record | LGD list acquired as context (DATA-01) | Not part of the code; an LGD association is a sourced assertion added in full_product |
| Demonstration labelling | "Fictional demonstration" in the scope strip; one specimen dataset on every screen | Not specified | No sample data and no "fictional" labels; the recorded dataset classification and fixture or seeded badges from provenance (`AGENTS.md`, UI-08) |
| Mockups | Mock up 15 finale screens | Not in the repository | [Reference mockups](../design-system/mockups/officer-studio/README.md) guide design; acceptance stays with GF tests and V-shots |

The design system, UI brief and plan review documents outside the repository were updated to match these rows.
