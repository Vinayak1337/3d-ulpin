# Project status

Reconciled 6 October 2026, 18:30 IST, from the live `staging` head, the Codex worktrees and session logs, and `E:/BhuAayam-data` (read-only). Rechecked on 10 October: nothing moved after 6 October. It replaces the 4 October picture in [PROJECT_DEEP_DIVE_ACTION_PLAN.md](../PROJECT_DEEP_DIVE_ACTION_PLAN.md). Detail stays in [WORK_ITEMS.md](orchestration/WORK_ITEMS.md) on `staging`.

**10 October:** the owner made Claude the lead for the whole project. The Codex desktop chats are retired. The plan is [SPRINT-SELECTION.md](next-steps/SPRINT-SELECTION.md), aiming at a demo-ready Studio on 22 October; selection is about 24 October. The owner's decisions are in its §2.

## What changed since 4 October

- **The user resumed delivery on 4 October** under a reset queue (D00–D14 in `docs/orchestration/WORK_ITEMS.md`). It follows the deep dive's direction: one site (Haryana RERA 2831 Tower 3), domain-model baselines, and breadth work paused.
- **`staging` gained 140 local commits** (`1eb836b5` → `e95273e5`); none are pushed. About 13k lines of code and 42k lines of docs/JSON. The Studio, scene and UI packages are unchanged; only the generated API schema moved.
- **New backend capability (integrated and run live once each, then the runtime was stopped):**
  - D04: a source-claim review for Tower-3 T3-2 Floor-02 (manual save, replay, correction, read-back through PostgreSQL).
  - D04-ROI: large-sheet region previews.
  - D05: the constrained mapping flow, run in manual mode with the provider off.
  - D07-SOURCE: source-only spatial-ML batches (100 pixel candidates from two PNGs) with candidate review decisions.
  - D08: cited document-field proposals (10 saved for T3), immutable accept/reject decisions, and reopening of saved evidence.
  - D10: a P3 source-authority fix. There is no actual P3 input yet.
- **Domain models measured, on foreign data only:**
  - Floor plans: CubiCasa5K on 12 foreign plans gives per-class IoU 0.60 and pixel accuracy 0.85. New contour polygonisation (v2) raised agreement from 85% to 94%.
  - One real Haryana floor was run through the model. The candidates are fragmented and confused, with no accuracy figure.
  - Buildings: RF-DETR on 24 Indian RAMP rooftop tiles gives IoU 0.45 and recall 0.49.
- **Indian labelled data is still blocked.** D06-INDIA found 0 eligible Indian image/label pairs. The team-label decision (deep dive §6.1) was never made.
- **RF-DETR fine-tune chain.** About half of the commits are roughly 25 serial prepare / diagnose / repair tasks for one RF-DETR fit on Bangladesh (Barishal) rooftop data:
  - Torch parity failed 24/24.
  - The pilot fit stopped on a non-finite loss after 4 of 36 updates. The cause was diagnosed and repaired (empty-mask loss not a scalar).
  - The repaired fit failed today before reaching Torch, because of a launcher bug.
  - **No model has been trained.**
- **Release gates:** still 0 of 30 tests with any receipt or attempt, and no `targetDate`.

## Live state right now (10 October, 17:09 IST)

| Item | State |
| --- | --- |
| `staging` | `bba01973` plus this board update, local; next push at M1 (14 Oct). Merged this afternoon: **K3b** (reviewed level schedules), **K3c** (room reject, reject-only roofprint decision), **A3b** (CSV and XLSX through the fenced chunk-mapping job, recipe approval, officer-approved learning) **F2c** (the Studio records rejections) **K4a** (migration registered, identity readiness report), **A3c** (tabular enrolment fix, live two-file run), **D1e** (193 column profiles of the three new development families, count-only disposition receipt), **K4b** (a source-stated floor and unit recorded without geometry, shown in the canonical building, P3 review and assignment wired to `proposedCode`; offline), **F2b** (Studio table import page with live progress, learner panel, answer and approve), **A4b** (label dry run takes the recorded CRS, student retrained on T1 + T1b; a recorded miss), **A3d** (one layout identity per table, questions asked once, `current`/`reasons` on retained reads, recorded derivatives admitted, the pinned demo checkout and its roll-out procedure; the completion rule was sent back once so that GIS jobs keep their rejections), **A4c** (cross-fitted commit threshold: wrong commits 4 → 0, no positive commits), **K4c** (per-record location guard, label-only citation for `UNIT-3B`, a card planned from a recorded source-only citation; offline) and **D1c/D1d** (three unlabelled property development families, JSON-table derivative, publisher truth bridge). Earlier on 10 Oct: A5b, B8, A3 checkpoint, A5, K3a, K2f, B7, F2a, F1a/F1b, K2–K2d, B3–B6c, A2, P1/P2, T1 + A4. |
| Workers | **Codex pool at its limit since about 16:50** (soonest reset codex-2 at 19:22; watcher running; codex-3 paused on its weekly limit until 14 Oct). **Owner instruction, 10 Oct:** when workers stop on a limit, the lead's own desktop background workers carry the work, and more independent ones run alongside. Running now, all desktop workers: **R1** (`a2`, the only runtime owner: rolls the demo checkout to reviewed staging, qualifies A3d live, imports one TNHB table propose-only into a new case, runs the nine-step identity sequence for Tower 3 `UNIT-3B` through to the card), **F3a** (`f1`: recorded floors and units on the building page, table-review follow-ups, questions joined across chunks, and the freshness fields the Studio fixture and table page now need), **G1** (`g2`: the demo profile may run the model gateway, off by default, fail-closed, with a reviewed enable/disable script; no provider call), **C1** (`d1`: the dataset catalogue check lists externally stored assets by their recorded pin), **H1** (`p1`: the Studio header fits at 200% zoom). |
| Waiting on owner | Re-pin of four runtime-receipt hashes in `docs/api/runtime-qualification.json` (CRLF-computed; LF hashes proposed). It is the only `check.py` failure. The model gateway needs owner-approved numbers before any Sarvam call (funding and price versions, prices, project and daily caps); G1 reports exactly which are missing. More independent positive data for the mapping student is an owner decision (see Mapping agent). |
| Runtime | `ulpin-demo` is up. API and dispatcher run from the pinned checkout `E:/Projects/ulpin-wt/demo` (served `a4592e12` until R1 rolls it to reviewed staging by `docs/backend/DEMO-RUNTIME.md`). It holds Tower 3 (revision 4, schedule reviewed as conflicting), Bihar Magnolia (revision 6, three reviewed levels, one room on GROUND, one room rejected), the Karnataka RAMP imagery area (22 chips, 80 roofprint candidates, two rejected, `test_only`), the A3c tabular check case (three public D8 development tables), GMDA sectors and NYC `test_only` proposals. Tabular learner paths are in `tabular-paths.json` beside the demo configuration. The PostgreSQL container mounts a file from `ulpin-wt/s03`, so that folder must stay. **Sarvam key (owner, 10 Oct):** eleven keys staged by the owner in `sarvam-staged.env` beside `demo.env` (outside Git, read by no code); exactly one is active as `ULPIN_PROVIDER_KEY_SARVAM`. The demo config still requires the gateway flag to be `0`, so no provider call can happen until a reviewed change turns it on. No rotation; switching the active key is the owner's call. |
| Building model | RF-DETR-Seg epoch 4: Karnataka holdout P 0.836 / R 0.649 (target R ≥ 0.70 missed); Cox's Bazar transfer P 0.830 / R 0.355. B6 (672 px) rejected. B7: 87% of missed roofs have a raw instance under 0.5, but the pipeline recovers only about half; DEV rule picks 0.45 (R 0.708, P 0.816). **Lead decision:** keep serving at 0.5, the only point with held-out evidence. B8 now locates the post-model loss. |
| Plans | Magnolia CAD: 18 exact vector rooms. Tower 3 scans: 218 raster room candidates, `no_scale`, level unknown. CubiCasa on 100 foreign test plans: mIoU 0.52. |
| Mapping agent | 411 teacher labels; 45/45 tables, 398/411 fields verified; agreement 36/3/5. **T1b (lead, 10 Oct):** 193 more labels for the TNHB scheme tables, the Pune facility lists and the footprint partition: 186 `unknown`, 7 positive (`document.registrationNo` 2, `unit.type` 2 by lookup, `building.addressLiteral` 2, `building.footprint` 1); 5/5 tables accepted, 192/193 verified. The footprint label is refused only because the dry run is given no source CRS, and the student trains on verified labels only, so it has never seen a footprint; **A4b (merged):** T1b now 193/193 verified; student v48 fitted on 585 examples (13 positives over six targets). It is a miss and is recorded as one: leave-one-family-out gives no correct positive commit and four wrong ones (registration number 2, address 2); calibration unchanged; held-out n=2, both abstained (counts only). Cause located: the threshold is set on one family, and positives are too few. **A4c (merged):** a threshold chosen on pooled leave-one-family-out predictions removes the four wrong commits and commits no positive (0 of 15; 53 `unknown` commits; class balance commits nothing); it is the train default. Zero wrong commits is by construction of the threshold and held-out is n=2, both abstained, so there is no accuracy claim. No further student attempt: the limit is data (15 positives over six targets), and more independent positive families are an owner decision. The demo learner stays on its current lineage. Three earlier T1 `unit.type` labels (nBHK text) do not fit the unit-type lookup table and were never trained on. Memory, Stage A student, routing and the agent loop merged. **A3b:** a CSV or XLSX is retained, read as raw tabular chunks and mapped by the fenced chunk job with `mapping.chunk` events; a v2 recipe is authored and approved through the existing commands; only an approved recipe reaches memory and one learner `partial_fit`. **Live on the demo (A3c):** `mi-d10-02.csv` then `mi-d10-03.csv` through the API in case `4ad9cb6d-…`; the second file is mapped from memory with no teacher call and no question; one approved recipe moved the learner v43 → v44; an XLSX ran propose-only; registry, area and package counts unchanged. The approval is the lead's verified T1 label (all 16 columns `unknown`), not an officer decision. **Found in that run:** the jobs were driven by a script because the dispatcher still ran old code; chunk layouts flap (new/memory/new); a completed job cannot be read after the case advances. A3d (merged) fixes all three in software; R1 qualifies them on the demo. **Limits:** admission is fenced to exact public D8 development originals (`TABULAR_DATA_DENIED` otherwise); a table makes mapped draft rows, never a registry record; **held-out shortfall:** after two bounded acquisition attempts the property held-out set has 2 families and 2 positive columns (target 3 and 25), so there is no positive-accuracy claim; blocked routes are in `docs/evidence/gf-agent/d1c/HANDOFF.md`. No third attempt without an owner decision. |
| Storeys | A5 merged: quote verifier, rules baseline (weak on garbled OCR: dev 0/7, holdout 0/3), Sarvam storey agent (not yet run live). Tower 3 G+41 / G+42 conflict in the canonical record; K3b records it as a reviewed conflicting schedule. |
| Geometry | K3a: exact prisms (`prism/2`, 9 hand cases). K3b merged: level schedules in the canonical record. Heights are unknown for both demo buildings, so there are no prisms on real data yet. |
| Roofprint admission | **Deferred until after the demo** (`docs/evidence/gf-backend/k2f/admission-decision.md`). The demo shows model candidate → officer-reviewed source selection; the registry step shows the real `USP_GEOMETRY_PAYLOAD_UNQUALIFIED`. |
| OCR | Fixed by the complete tessdata prefix (K2f): Tower 3 page 1 gives 64 lines. K3b activates it for the demo profile. |
| Studio | Candidate review queues for roofprints (area) and rooms (building): reasoned accept, reject-only roofprint decisions, room reject, decided candidates shown with their review and no controls (F2a + F2c). F2b adds the table import page. Known: header overflow at 200% zoom (H1 running); one Studio contract test is red on staging until F3a returns (the table fixture predates the required `current`/`reasons` fields). |
| Private data | `E:/BhuAayam-data/{datasets,ml,runtime,task-data}`; nothing deleted. |

## Gates

| Gate | State | Last real evidence | Next |
| --- | --- | --- | --- |
| GF0 Data/contracts | Partial | Demo runtime with K2 imports; canonical routes; pins | Owner: receipt re-pin |
| GF1 Identity/exchange | Partial | D10 authority fix; K4a readiness (`docs/evidence/gf1/k4a/readiness.md`): no recorded floors or spaces on the demo buildings, Magnolia has no source-stated unit that links to a plan panel, Tower 3 prints `UNIT-3A`/`UNIT-3B` on its `2ND FLOOR PLAN` sheet. **Lead decision:** floors and units are recorded source-stated and geometry-absent, like the building record; first target Tower 3 `UNIT-3B`. **K4b merged:** the record command, canonical children and P3 wiring, offline; the lead checked both crops | **K4c merged** (offline; the lead checked the label crop). R1 runs the live record, snapshot, review, assignment and card on Tower 3; F3a shows it in the Studio |
| GF-AI (building/plans) | Partial | Fine-tuned model with holdout + transfer numbers; B7 DEV diagnosis; plan candidates | B8 attribution |
| GF-AGENT | Partial | Teacher labels verified; memory + student + routing; tabular sources through the real job with software controls (A3b) and a live two-file run (A3c) | R1 live qualification of A3d and a TNHB table proposed on the demo; G1 gateway switch; held-out accuracy and positive commits need an owner decision on data |
| GF-T16 Geometry | Partial | K3a prisms with hand cases; K3b schedules on Tower 3 and Magnolia | K4 (real prisms need stated heights and a placed footprint) |
| GF3 Govern | Pending | Officer conflict decisions (K2b) | P6 |
| GF4 Card/QR | Pending | none | K5 |
| GF5 Rehearsal | Pending | none | J1 |

## Areas

| Area | State |
| --- | --- |
| Backend | Works: canonical area/building records, geometry-free imports, imagery area, candidate retention, append-only officer decisions. |
| Readers | Works; plus vector (CAD) and raster plan readers; OCR repaired. |
| Domain AI | Partial: building model trained and measured on held-out Indian data; plan readers produce candidates; storey extraction weak. |
| Agent | Partial: teacher labels, memory, Stage A student and routing; agentic loop in A3. |
| Geometry | Partial: exact prisms (K3a); level schedules running (K3b); CityJSON still has empty vertices. |
| Identity | Partial: P3 code exists; no input wired. |
| Card | Missing: K5. |
| Studio | Partial: live canonical records (F1) and candidate review (F2a); live import UI (F2b) after A3. |
| Data | Works for the sprint: RAMP Karnataka + Bangladesh labels, D8 messy-India pack, D2 storey truth. |

## Findings on 9–10 October that changed the plan

- **Labels exist.** Public RAMP data holds 6,288 Karnataka building chips and about 46k chips from 6 Bangladesh regions. Each chip was labelled by one person and reviewed by a second (CC BY-NC 4.0). The earlier work used 24 of them. GF-AI no longer needs team labels.
- **The two plan sources differ.** The Haryana Tower 3 plans are scanned images (no text, no vector paths). The Bihar Magnolia sanctioned plans are CAD vector PDFs with room labels and stated dimensions, so rooms can be extracted exactly.
- **The mapping agent is narrow.** It has 3 targets and accepts GeoJSON in EPSG:4326 only. The model gateway supports Sarvam (`sarvam-105b`), replay and control.
- **Only one Sarvam key was found:** `SARVAM_API_KEY` in `E:/BhuAayam-data/runtime/prefix-worker-20260929/compose.env`. The repo `.env` holds only `REPO_DATA`.
- **Preserved and pushed on 10 Oct:** `wip/rfdetr-bridge-fix-20261006`, `wip/fragment-rank-56f9-20261010`, `task/d07-native-cpu-empty-loss-20261006`, and `staging` itself.

## Assessment: what to do next

1. Owner: approve or refuse the runtime-receipt re-pin (four LF hashes).
2. On return: R1 → review the receipts and both PDFs, then the Studio's live check of the table page and the recorded unit, then K5 (QR verify) and J1 (golden journey); F3a → merge (Studio tests green again); G1 → merge, then the owner states the gateway numbers and one live Sarvam run follows (mapping teacher, storey agent); C1, H1 → merge. At the 19:22 codex reset, new build work goes back to the codex pool.
3. A dev-only A5 follow-up (repaired OCR, native-text threshold, cropped tables, a live agent run through the demo gateway).
4. M1 on 14 Oct: push `staging`.
