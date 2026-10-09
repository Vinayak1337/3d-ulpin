# 3D ULPIN / BhuAayam — project deep dive and what we must do

**Date:** 4 October 2026. **Branch reviewed:** `review/project-ml-20261004` (head `6c37f973`), plus the follow-up [ML_REVIEW_RECOMMENDATIONS.md](ML_REVIEW_RECOMMENDATIONS.md).

**Method:**
- Read the product, release, requirement, ML, frontend and audit documents in full:
  - [README](README.md), [H00](docs/usp-agent-handoffs/00-README.md), [release-plan.json](docs/usp-agent-handoffs/release-plan.json);
  - [H14](docs/usp-agent-handoffs/14-adaptive-ingestion-and-progressive-review.md), [H21](docs/usp-agent-handoffs/21-concurrent-schema-learning.md), [H23](docs/usp-agent-handoffs/23-india-data-and-delivery-plan.md), [H27](docs/usp-agent-handoffs/27-domain-ai-and-cadastral-checks.md), H28 §Z2–Z3, [H29](docs/usp-agent-handoffs/29-agent-task-cards.md) DATA/DOMAIN cards, [H90](docs/usp-agent-handoffs/90-required-human-tasks.md), [H97](docs/usp-agent-handoffs/97-review-findings-and-alignment.md), [H98](docs/usp-agent-handoffs/98-engineering-readiness-audit.md);
  - [PROJECT_AND_ML_REVIEW](PROJECT_AND_ML_REVIEW.md), [ML_DISTILL_01](docs/orchestration/ML_DISTILL_01.md), [ADAPTIVE_INGESTION_EXECUTION](docs/orchestration/ADAPTIVE_INGESTION_EXECUTION.md) AI-08, the [learning guide](docs/api/learning.md) and [t061 model evaluation](docs/evidence/t061/models/evaluation.md);
  - the [backend gap audit](docs/evidence/usp/backend-gap-audit-20261002.md), the operating guide's MVP section, the frontend [GOAL](docs/frontend/GOAL.md) and [PLAN](docs/frontend/PLAN.md), and [serving-observation.json](docs/api/serving-observation.json).
- Skimmed the long ledgers: [NESTJS_MIGRATION](docs/orchestration/NESTJS_MIGRATION.md) (1,051 dense lines), all `PARALLEL_*` rounds and the [source index](docs/api/real-sources.md).
- Checked the code directly: the API catalogue, the Studio route table, the scene types and the spatial-ML modules. I measured repository size and commit volume.

**Limits:** I didn't run the application, Docker, tests or models, and I didn't read private artifacts outside Git. Statements about runtime come from the recorded receipts.

---

## 1. Summary

**The project has a strong foundation and a lot of working code. But it isn't converging on what the problem statement and your own release plan require, and the reason is how the work is chosen, not lack of effort.**

- **No release gate has started.** All 30 release tests in `release-plan.json` have **zero receipts and zero attempts**. GF0 (data and contracts) has been the "next gate" since 24 September.
- **Recent work went into breadth, not into gates.** On 2–4 October alone this branch shows **623 commits**. They are mostly per-format readers, "sufficiency" adapters, citation exports and the ML distillation lane. Each is carefully built, but none closes a gate.
- **The ML that SIH26011 asks for has gone unattended.** The statement names four AI/ML tasks: building extraction, floor segmentation, vertical delineation and topology validation. Your release gate GF-AI needs two learned models. **Both models already exist and are wired into the backend** (`spatial-ml`, CubiCasa5K and RF-DETR). But the tasks to qualify them (DATA-04/06/07, DOMAIN-01/02) **were never assigned**. Meanwhile a dedicated ML lane spent a week fine-tuning a 0.5B text model on 23 fragments, for a task that isn't in the finale.
- **The app the judges will see isn't connected to the backend.** Officer Studio calls **3 live routes and mocks 33**. Several of the mocked ones (areas, context, register, work queue, import packages) **already exist in the backend**. The linked database holds **one physical feature** and no installed area. Studio code hasn't changed since 2 October.
- **The process has become the product.** Documentation is about **837k lines** against about **150k lines of code**. The ML evidence folder holds 145 receipt files for one experiment. AGENTS.md is a stack of contradictory model and speed overrides. The 27 September MVP directive ("do not turn implementation into a testing, hardening or reporting project") is being ignored in practice.
- **One policy combination blocks the ML gate outright.** DATA-07 requires *officially issued* labels, the delivery policy forbids labels drawn by agents, and H90 removed people from labelling. Together they make GF-AI **impossible to pass**. That needs a decision from the owner, not more engineering.

**What we must do:** stop broad work. Pick **one real Indian building and area**. Run it end to end through the **live** API into the Studio. Qualify the **two existing learned models** on a small **team-labelled** Indian holdout. Then add deterministic storeys/prisms, the P3 identity, CityJSON export and the card, in that order. Everything else is deferred. Details are in §5.

---

## 2. What the project is supposed to deliver

**SIH26011 "3D ULPIN Generation"**, summarised in H23 §D (the original text file isn't in the repo):

- unique identities for surface parcels, multi-storey apartments and underground infrastructure;
- integration of drone imagery, LiDAR/point clouds, parcel GIS, floor plans, GNSS/CORS and DEM/DSM;
- **AI/ML for extraction, floor segmentation, vertical delineation and topology validation**.

**Your adopted product (`finale_v1`) is Identify → Prove → Govern:**

| Gate | Must show | Key tests |
| --- | --- | --- |
| GF0 Data and contracts | Matched real sources, pinned manifests, contract inventory, running backend | GF-DATA, GF-CONTRACT, GF-BACKEND |
| GF1 Identity and exchange | P3 proposed IDs and lifecycle, CityJSON plus sidecar, LADM mapping | GF-T15, GF-EXCHANGE |
| GF2 Domain AI and spaces | **Two learned routes (building mask, plan segmentation)**, deterministic delineation and topology, mapping agent, scene, sufficiency, streaming | GF-AI, GF-AGENT, GF-T16–18, GF-SCENE, … |
| GF3 Govern | Readiness, deviation, impact screening | GF-T19–20, GF-READY |
| GF4 Card | Scoped property card plus exact-revision QR | GF-T21, GF-PRIVACY |
| GF5 Rehearsal | Measured end-to-end run | GF-REHEARSAL |

The gates form a strict chain (GF0 → … → GF5). **The "heterogeneous data → normalised schema" learner you described is H21 FP-LEARN, which is `full_product`, after the finale.** In the finale, normalisation is done by deterministic readers plus a *constrained mapping agent* (H14, GF-AGENT) that proposes field mappings, with replayed provider responses allowed (H90-4).

---

## 3. What actually exists (honest inventory)

| Area | Present | Missing or unproven |
| --- | --- | --- |
| **Backend** | NestJS API, 262 paths / 275 operations / 308 schemas; ~48k lines of domain modules; visible SQL; jobs, retry, checkpoints; private storage; SSE; MVT tiles; P3 identity lifecycle code; registry and review | Exchange still emits `vertices: []` (gap 2); no geometry-qualification producer; no declaration acceptance (gap 3); no card/QR subtype (gap 4); no current end-to-end persistence proof (gap 5, Docker) |
| **Readers** | PDF/text/table/XLSX/ODS, OCR, IFC, DXF, KML/KMZ, glTF/GLB, OBJ, CityGML, GeoParquet, GeoTIFF, LAZ: bytes kept, windows, citations, sufficiency guidance | Most stop at *metadata/citations*. Few produce geometry the scene can draw, and none produces qualified analytical geometry |
| **Domain AI** | `services/geo/geo/spatial_ml.py` and `modules/spatial/spatial-ml.ts`: queue building/floor-plan inference and apply selected contours as draft facts. CubiCasa5K ONNX (2 plans, pixel accuracy 0.87, mIoU 0.66). RF-DETR ONNX (12 OAM tiles, IoU 0.29, precision 0.34, recall 0.64) | No Indian evaluation, no preregistration, no holdout, no fine-tune; RF-DETR's training overlap is unknown; metric calibration is placeholder test data (t061) |
| **ML lane** | Disciplined harness; LoRA, checkpoint and reload work | No useful model; task isn't in the finale; violated its own sequencing (§4.2) |
| **Frontend** | Studio with 14+ screens, scene engine (footprints, storeys, levels, spaces, overlays, clip, findings), public portal, P3 generator, QR, hash chain | **3 live / 33 local routes**; runs on a local NYC 62-footprint area and a Swiss Dwellings floor; card, identity and review live in the browser store; spatial-ML results are never shown (S9 uses a mocked draft route) |
| **Data** | 63 verified originals installed; NWIC districts and MVT; NYC footprints, LiDAR, DEM, ortho; Haryana RERA Tower 3 and Bihar Magnolia documents; GMDA sector polygons (Gurugram reference area); D1 single roof | **No Indian building installed end to end.** Linked DB has 1 physical feature. GMDA permission unconfirmed. Haryana G+41/G+42 conflict. **0 qualified cross-source building/floor pairs.** No labelled Indian imagery or plans |
| **Runtime** | Docker stack on a Windows desktop; recovered several times | Recurring socket/engine failures; heavy staging per run; no standing install that the Studio can rely on |

---

## 4. Conclusions: what's going wrong and why

### 4.1 Work isn't driven by the gates

- Every gate test has `receipts: []` and `attempts: []`. Ledger entries end with phrases like *"does not qualify … release gates"*, and that is honest. But the next task is then chosen by "what is dependency-ready and parallelisable", not by "what closes GF0".
- The 2–4 October rounds ([PARALLEL_20261003](docs/orchestration/PARALLEL_20261003.md) is 243 KB) went to KML/XML/IFC/mesh/planar/raster-point sufficiency, glTF HTTP intake, ODS references, OBJ polygon links and committed citation downloads.
- Format coverage *is* finale scope (GF-SUFFICIENCY asks for **one tested sample per family**). It was built far deeper than one sample per family, before GF0 existed, while the cross-cutting deliverables (an installed area, a qualified geometry producer, GF-AI, the card) were never attempted.
- **Root cause:** parallel workers need independent, exclusive files. The cross-cutting gate work touches shared seams, which are "lead-reserved". So the system keeps choosing peripheral leaves. *Maximising worker count optimised for parallelism, not for the gates.*

### 4.2 ML effort went to the wrong task, against your own plans

- **SIH26011's AI tasks and GF-AI are vision tasks** (building masks, plan segmentation). The fragment-support model is text relevance for document-to-floor linking, which isn't a finale requirement.
- **H21** says to start with a CPU scikit-learn pairwise classifier, and to upgrade to an encoder *only when evaluation shows a gap*. The team went straight to E5 and Qwen LoRA.
- **AI-08** says *"defer the association fine-tune until [the format pipelines] are accepted"* and *"compare with the deterministic exact-reference baseline before choosing a trainable ranker."* ML-DISTILL-01 (2 Oct) skipped both steps.
- **Data volume:** 23 unique training fragments, 2 families; the development set has 7 candidates and 1 positive. Nothing can be learned or measured at that size. Full analysis: [ML_REVIEW_RECOMMENDATIONS.md](ML_REVIEW_RECOMMENDATIONS.md).
- **Teacher labels conflict with the delivery policy.** The teacher examples are labelled `provisional_synthetic_supervision`. Release policy says `allowAgentAuthoredSyntheticData: false`. Even a successful model would have been trained on data your own policy disallows.

### 4.3 The labelling policy makes GF-AI impossible

- GF-AI needs an *"untouched independently labelled evaluation"* (H27).
- DATA-07 then narrows this to *"officially issued, permitted human-labelled"* benchmarks, and adds *"agent-drawn labels and ML predictions cannot replace official reference labels."*
- H90 removed people from labelling (*"Agents do the data, labelling, oracle … work"*).
- Officially issued, human-labelled Indian building-mask and floor-plan benchmarks with clear licences hardly exist. **Together these rules leave no path to a pass.** H97 predicted this: *"If GF-AI stays open for lack of permitted labels, GF3–GF5 can never complete."*
- **Fix:** team members label a small Indian holdout themselves (about 1–2 person-days). Record them as `review.kind: human`, `independence: team`, and label the claim as that, not "official". This is honest, standard practice, and the single highest-value hour-for-hour task in the project.

### 4.4 Frontend and backend aren't integrated

- The Studio's route table ([routes.ts](apps/studio/src/local/routes.ts)) is 3 live / 33 local.
- The backend already serves `/areas`, `/areas/{id}/context`, `/buildings/{id}/register`, `/work-queue`, `/import-packages/*` and `/spatial-ml/*`. Many "draft" routes the frontend requested (ledger, level review, pages, card) are now partly covered by backend work (document pages, packet plans, identity reviews).
- **Nobody owns reconciling them.** The backend lanes are told "no frontend", and the frontend lane hasn't moved since 2 October. So 275 backend operations sit behind a demo that runs on mocked NYC and Swiss data. GF-REHEARSAL, and what judges actually see, depends on this connection.

### 4.5 No real Indian building has gone end to end

- The data rules are excellent (originals kept, unknown is not zero, no invented facts). But they are applied so that every candidate source ends up "unqualified".
- Haryana has a G+41/G+42 conflict; Bihar has a portal but no matched geometry; GMDA polygons have unconfirmed redistribution; there are no drone captures with official controls.
- A *conflict* is a valid demo state (that's the "Prove" story). An unconfirmed *redistribution* licence doesn't block local use. The 30 September AGENTS.md update already moved launch clearance to a later workstream. **The project should pick one building now and proceed with honest labels, instead of waiting for a perfect source.**

### 4.6 Process cost has overtaken delivery

- **Size:** docs ≈ 837k lines vs code ≈ 150k. Status paragraphs like *"exact11 owned/all36 runtime Git equality;99 correction references/40 protections"* aren't usable by people, and are barely usable by agents.
- **Authorities:** at least five overlapping documents claim precedence: delivery policy, H97 addenda ("addendum wins"), normalized decisions, migration ledger and AGENTS.md overrides. They disagree:
  - `release-plan.json` still says `speedPreference: "Fast"`, `configuredServiceTier: "priority"`, while AGENTS.md says never use Fast;
  - H00 and H23 say "Cesium is the finale runtime", while AGENTS.md says the Studio is Three.js and "no Cesium";
  - AGENTS.md has six successive model/effort/speed overrides.
- **Iteration cost:** a model run stages 19,700 files / 8.6 GB for 2.3 s of compute. A one-file change gets "lead matches N physical references / M Git representations".
- The **MVP directive of 27 September** says to verify with one good and one difficult real input and move on. Practice since then has been the opposite.

### 4.7 The runtime is fragile

The Docker engine on the Windows desktop failed repeatedly (stale sockets, ingest startup, engine restarts). Each recovery became its own task (RUN-RECOVER-01 and others). Gap 5 of the audit says current end-to-end persistence is unverified because of this. **A stable, always-on local install (or a small Linux VM/cloud box) is a prerequisite for GF0 and for the Studio to run live.**

### 4.8 What's strong and must be kept

- The data integrity model: originals, hashes, citations, and unknown/absent/null/conflicting states.
- Review-before-commit; AI only proposes and code executes; immutable revisions.
- The well-designed requirements (H26 identity, H27 candidate contract and roof/storey rules, H28 Indian messy-data cases).
- The scene engine's honest rendering: unknown heights drawn flat, estimated storeys hatched.
- Spatial-ML wiring with model hashes, preprocessing profiles and replay protection.
- Honest reporting of failures. This is rare and valuable, so keep it, but in far fewer words.

---

## 5. What we must do

The weeks are relative because no finale date is recorded in the repo. **If the finale is closer than the plan below, cut from the bottom, never from step 1.**

### Step 0: Reset (2–3 days)

1. **Freeze new breadth work:**
   - no new formats, sufficiency adapters, citation/export variants, harness hardening or review-of-review tasks;
   - **pause ML-DISTILL-01** (STUDENT-45 and later). Keep its history.
2. **One owner per gate, and allow shared-seam work.** Let one strong worker (or the lead) own the cross-cutting seams for each step below. Fewer workers on the critical path beats many workers on leaves.
3. **Clean up the instructions:**
   - cut AGENTS.md to about one page of stable rules, with the dated override history moved to an appendix;
   - fix the stale `release-plan.json` `execution` fields and the Cesium/Three.js statements in H00/H23/H22;
   - name **one** precedence order: release-plan → H00 → feature handoff.
4. **Status format:** the ledger's top entry for each increment is at most 5 plain-English lines (what works, how to see it, what's missing). Hashes and receipts go in the linked JSON, not in prose.
5. **Stabilise the runtime:** one standing local install with a documented start/stop that survives restarts. Consider a small Linux host if the Windows Docker socket keeps failing.

### Step 1: The golden journey, one real Indian building in the live Studio (1–2 weeks). Closes GF0 and starts GF-SCENE

1. **Choose the site (LEAD-05):** the Gurugram reference area (GMDA sectors 59/63A, already in `fixtures/usp/D4/reference-area-gurugram-59-63a/`) together with the Haryana RERA 2831 Tower 3 documents. The G+41/G+42 conflict stays as a *conflict*, shown on screen.
   - Record permissions as `unconfirmed / local development use`.
   - Fall back to Bihar Magnolia if the location can't be supported.
2. **Install the area through the real import route:**
   - context layers: NWIC/LGD boundary, GMDA sectors, roads/water if officially published;
   - the building footprint, from an official layer if one exists, otherwise from the learned building-mask candidate in Step 2 marked `candidate`;
   - the RERA documents as sources.
3. **Switch the Studio routes that the backend already serves from `local` to `live`:**
   - `/areas`, `/areas/{id}/context`, `/buildings/{id}/register`, `/work-queue`, `/import-packages/*`;
   - reconcile any contract differences in `packages/api-client`.
   - Keep `local` only for routes that truly don't exist yet, and list them.
4. **GF0 evidence, lean:**
   - `site-decision.md`;
   - the pack manifests (they exist);
   - the contract inventory (the Studio's route table plus the OpenAPI document);
   - one recorded run: upload → progress → building on the map → register → evidence viewer opens the RERA page.

   Mark GF-DATA / GF-CONTRACT / GF-BACKEND with real receipts.

**Done when:** a person opens the Studio against the live API, sees the real Gurugram area and the Tower 3 building, clicks it, and opens the cited RERA page.

### Step 2: GF-AI with the two existing models (1–2 weeks, can run in parallel with Step 1)

1. **Owner decision (§6, item 1):** accept **team-labelled** holdouts.
2. **Labels:**
   - **Imagery:** 30–50 Indian tiles from at least 2 cities, including the Gurugram area. Use permitted imagery (for example Bhuvan/NRSC where its terms allow, OpenAerialMap Indian scenes, or a drone set). Team members draw building outlines; OSM can be a starting point but every outline is checked by a person.
   - **Plans:** 20–30 Indian floor-plan pages (Haryana/Bihar RERA sheets, other public sanction plans) with room polygons and classes.
   - Split by city/project. Hold out at least 1/3.
3. **Preregister (DATA-04):** commit `preregistration.json` (classes, metrics, thresholds, holdout IDs, label authors) **before** running the models.
4. **Evaluate** CubiCasa5K and RF-DETR as installed:
   - plans: per-class IoU and room-count accuracy;
   - imagery: building-level precision/recall at IoU ≥ 0.5, plus false positives on empty tiles.
5. **If below threshold, fine-tune** on the training split (a few hundred labelled images with standard RF-DETR / torchvision / CubiCasa training scripts on the RTX 3070), then evaluate once on the holdout. **This is the right home for your GPU time and fine-tuning effort.**
6. **Wire the results into the Studio:** S9 Review reads `/spatial-ml/batches` instead of the mocked EXTRACT-02 route; the building candidate appears on the map as `candidate`.
7. **Licence gaps:** CubiCasa5K is CC-BY-NC-4.0, and RF-DETR's training data is undocumented. Record both as launch-clearance gaps; they don't block development.

**Done when:** GF-AI has a preregistration, a holdout result per class, and a visible candidate → review → draft flow in the Studio on Indian inputs.

### Step 3: Storeys, spaces and identity (1–2 weeks). Covers GF1 and the rest of GF2

1. **Storeys and levels:**
   - a reviewed level schedule from the RERA documents (a person picks the values; a regex or zero-shot extractor may *propose* them, per ML_REVIEW §6.2);
   - stilt/podium/basement labels are kept as literals;
   - the conflict stays a conflict.
2. **Vertical delineation (deterministic):** reviewed footprint plus level limits gives prisms per level (the existing `geometry.py` single-ring prism, then FIND's planar/prism profile). Unknown heights stay `null` and are drawn flat.
3. **Close the geometry producer gap (audit gap 2):** a minimal `qualify_geometry` producer for the reviewed prism, so CityJSON export carries real vertices plus the sidecar and loss report (GF-EXCHANGE).
4. **P3 identity:** wire the Studio's assign flow to `POST /usp/identity/reviews` and `/assign`, and stop using the browser store (GF-T15).
5. **Topology:** deterministic overlap/contact/containment checks on the prisms; findings shown with reasons (GF-T18 slice).

**Done when:** the building shows storeys from reviewed evidence, units have proposed P3 codes from the backend, and a CityJSON export contains the geometry.

### Step 4: Govern and share (1–2 weeks). Covers GF3–GF5

1. **Card/QR (gap 4):** a property-card subtype of the existing packet service, with the exact-revision QR resolver on `local_operator`. The Studio card reads it instead of the browser store (GF-T21/PRIVACY).
2. **GF-AGENT** with replayed provider responses: held-out CSV/GIS layouts from your Indian messy-data list (H28 Z3), plus injection, literal-rejection and outage cases. **This is the finale's "heterogeneous → normalised" story.**
3. **Readiness / deviation / impact:** show `not_assessed` or `not_comparable` honestly where sources are missing. Qualify only what the data supports.
4. **GF5 rehearsal:** one recorded source-to-card run with timings. Mark what is live and what was preprocessed.

### Defer until after the finale

- ML-DISTILL association fine-tuning, and teacher expansion.
- The FP-LEARN concurrent learner. When it resumes, follow H21's CPU baseline first and the ML_REVIEW plan.
- More formats beyond one sample per family, and more sufficiency variants.
- Scale rungs beyond the bounded district, the public portal backend, MCP/assistance and enrichment.
- Further harness/egress hardening beyond a final pre-integration check.

---

## 6. Decisions only the owner can make

1. **Labels:** may team members create the GF-AI holdout labels (recorded honestly as team-labelled)? *Recommendation: yes.* Without this, GF-AI can't pass.
2. **Qualification levels instead of all-or-nothing gates:** allow a gate to pass "at the scope demonstrated" with named waivers (H97 finding 1). Otherwise one missing official source blocks GF3–GF5 permanently.
3. **Demo site:** confirm Gurugram 59/63A plus Haryana Tower 3 (or name another).
4. **Scope freeze:** confirm the defer list in §5.
5. **Ownership of frontend integration:** who switches the Studio routes to live? The frontend lane (Claude) needs to be active again, or one lane owns both sides for the golden journey.
6. **Finale date:** put it in `release-plan.json` (`targetDate` is null for every gate), so work can be cut against it.
7. **Worker strategy:** fewer workers on critical-path seams instead of many on independent leaves.

---

## 7. Process rules to adopt now

- **A task is chosen only if it moves a named gate test.** The task card says which test and what receipt it will produce.
- **Verification follows the MVP directive:** one good real input, one difficult real input, check through the UI or API, then move on. No receipts that compare hashes of hashes.
- **Plain-English status, at most 5 lines per increment.** Machine detail goes in JSON.
- **One standing runtime.** Fix it once; don't re-prove it per task.
- **ML work starts from an evaluation set made before any training,** and from the strongest model available without fine-tuning (see ML_REVIEW).
- **Humans label holdouts.** Agents may propose labels, but a person approves every holdout label.

---

## 8. Evidence index

| Claim | Where |
| --- | --- |
| All gates pending; 0 receipts/attempts; `targetDate` null; stale Fast/priority | `docs/usp-agent-handoffs/release-plan.json` (`gates`, `tests`, `deliveryPolicy.execution`) |
| GF-AI needs two learned routes; existing models to start from | H27 §A and Z4 |
| GF-AI cards never dispatched | No mention of DATA-04/06/07 or DOMAIN-01/02 in `docs/orchestration/*` |
| Models' small foreign evaluations | `docs/evidence/t061/models/evaluation.md`, `services/geo/ml-models.json` |
| Spatial-ML backend wiring exists | `packages/server/src/modules/spatial/spatial-ml.ts`, `services/geo/geo/spatial_ml.py`, `/api/v1/spatial-ml/*` in OpenAPI |
| H21 CPU baseline; AI-08 defer-and-baseline rule | H21 §C; ADAPTIVE_INGESTION_EXECUTION "AI-08" |
| ML lane data and results | PROJECT_AND_ML_REVIEW §4–6; ML_REVIEW_RECOMMENDATIONS |
| Synthetic data disallowed | release-plan `deliveryPolicy.data.allowAgentAuthoredSyntheticData: false` |
| Labelling deadlock | H29 DATA-07; H90 "Moved to agents" H6; H97 verdict 1 |
| Studio 3 live / 33 local; local area; backend requests | `apps/studio/src/local/routes.ts`; `docs/frontend/PLAN.md` "Backend requests raised" |
| Linked DB has 1 physical feature, no area | `docs/api/serving-observation.json`; PLAN.md backend requests table |
| Five backend gaps (relationships, geometry producer, declarations, card, runtime) | `docs/evidence/usp/backend-gap-audit-20261002.md` |
| Docker/socket recoveries | NESTJS_MIGRATION entries of 3–4 October (RUN-RECOVER-01, DOC-HTTP) |
| MVP directive | `docs/orchestration/OPERATING_GUIDE.md` "MVP delivery and verification" |
| Repository size and commit volume | `git ls-files` line counts; `git log` dates (this branch) |
