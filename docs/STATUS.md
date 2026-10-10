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

## Live state right now (10 October, 16:01 IST)

| Item | State |
| --- | --- |
| `staging` | `a4592e12` plus this board update, local; next push at M1 (14 Oct). Merged this afternoon: **K3b** (reviewed level schedules), **K3c** (room reject, reject-only roofprint decision), **A3b** (CSV and XLSX through the fenced chunk-mapping job, recipe approval, officer-approved learning) **F2c** (the Studio records rejections) **K4a** (migration registered, identity readiness report), **A3c** (tabular enrolment fix, live two-file run) and **D1c/D1d** (three unlabelled property development families, JSON-table derivative, publisher truth bridge). Earlier on 10 Oct: A5b, B8, A3 checkpoint, A5, K3a, K2f, B7, F2a, F1a/F1b, K2–K2d, B3–B6c, A2, P1/P2, T1 + A4. |
| Workers | Running, all codex: **A3d** (`a2`, `xhigh`: first moves the demo API and dispatcher onto a pinned staging checkout `E:/Projects/ulpin-wt/demo`, then stable layout identity, readable job history, honest table completion status, recorded derivatives admitted; runtime owner for the roll-out step only), **F2b** (`f1`, `xhigh`: Studio table import page, learner panel, answer and approve), **D1e** (`d1`, `high`: column profiles of the three new development families for the lead's T1b labels; disposition list for early discovery files, nothing deleted), **K4b** (`k1`, `xhigh`, no runtime: a source-stated floor and unit recorded without geometry, shown in canonical, P3 code wired to `proposedCode`). |
| Waiting on owner | Re-pin of four runtime-receipt hashes in `docs/api/runtime-qualification.json` (CRLF-computed; LF hashes proposed). It is the only `check.py` failure. Separately, `scripts/api/build-dataset-catalog.py --check` fails on `staging` with `KeyError: 'content'` (the D8 entries are not in the catalogue's strict shape); not yet assigned. |
| Runtime | `ulpin-demo` is up. Right now the API runs from `ulpin-wt/a2` (A3c code) and the dispatcher from `ulpin-wt/k1` (older code); A3d step 0 moves both to the pinned checkout `E:/Projects/ulpin-wt/demo` at a named staging commit, and later roll-outs follow `docs/backend/DEMO-RUNTIME.md`. It holds Tower 3 (revision 4, schedule reviewed as conflicting), Bihar Magnolia (revision 6, three reviewed levels, one room on GROUND, one room rejected), the Karnataka RAMP imagery area (22 chips, 80 roofprint candidates, two rejected, `test_only`), the A3c tabular check case (three public D8 development tables), GMDA sectors and NYC `test_only` proposals. Tabular learner paths are in `tabular-paths.json` beside the demo configuration. The PostgreSQL container mounts a file from `ulpin-wt/s03`, so that folder must stay. |
| Building model | RF-DETR-Seg epoch 4: Karnataka holdout P 0.836 / R 0.649 (target R ≥ 0.70 missed); Cox's Bazar transfer P 0.830 / R 0.355. B6 (672 px) rejected. B7: 87% of missed roofs have a raw instance under 0.5, but the pipeline recovers only about half; DEV rule picks 0.45 (R 0.708, P 0.816). **Lead decision:** keep serving at 0.5, the only point with held-out evidence. B8 now locates the post-model loss. |
| Plans | Magnolia CAD: 18 exact vector rooms. Tower 3 scans: 218 raster room candidates, `no_scale`, level unknown. CubiCasa on 100 foreign test plans: mIoU 0.52. |
| Mapping agent | 411 teacher labels; 45/45 tables, 398/411 fields verified; agreement 36/3/5. Memory, Stage A student, routing and the agent loop merged. **A3b:** a CSV or XLSX is retained, read as raw tabular chunks and mapped by the fenced chunk job with `mapping.chunk` events; a v2 recipe is authored and approved through the existing commands; only an approved recipe reaches memory and one learner `partial_fit`. **Live on the demo (A3c):** `mi-d10-02.csv` then `mi-d10-03.csv` through the API in case `4ad9cb6d-…`; the second file is mapped from memory with no teacher call and no question; one approved recipe moved the learner v43 → v44; an XLSX ran propose-only; registry, area and package counts unchanged. The approval is the lead's verified T1 label (all 16 columns `unknown`), not an officer decision. **Found in that run:** the jobs were driven by a script because the dispatcher still ran old code; chunk layouts flap (new/memory/new); a completed job cannot be read after the case advances. A3d fixes all three. **Limits:** admission is fenced to exact public D8 development originals (`TABULAR_DATA_DENIED` otherwise); a table makes mapped draft rows, never a registry record; **held-out shortfall:** after two bounded acquisition attempts the property held-out set has 2 families and 2 positive columns (target 3 and 25), so there is no positive-accuracy claim; blocked routes are in `docs/evidence/gf-agent/d1c/HANDOFF.md`. No third attempt without an owner decision. |
| Storeys | A5 merged: quote verifier, rules baseline (weak on garbled OCR: dev 0/7, holdout 0/3), Sarvam storey agent (not yet run live). Tower 3 G+41 / G+42 conflict in the canonical record; K3b records it as a reviewed conflicting schedule. |
| Geometry | K3a: exact prisms (`prism/2`, 9 hand cases). K3b merged: level schedules in the canonical record. Heights are unknown for both demo buildings, so there are no prisms on real data yet. |
| Roofprint admission | **Deferred until after the demo** (`docs/evidence/gf-backend/k2f/admission-decision.md`). The demo shows model candidate → officer-reviewed source selection; the registry step shows the real `USP_GEOMETRY_PAYLOAD_UNQUALIFIED`. |
| OCR | Fixed by the complete tessdata prefix (K2f): Tower 3 page 1 gives 64 lines. K3b activates it for the demo profile. |
| Studio | Candidate review queues for roofprints (area) and rooms (building): reasoned accept, reject-only roofprint decisions, room reject, decided candidates shown with their review and no controls (F2a + F2c). F2b adds the table import page. Known: header overflow at 200% zoom (inherited). |
| Private data | `E:/BhuAayam-data/{datasets,ml,runtime,task-data}`; nothing deleted. |

## Gates

| Gate | State | Last real evidence | Next |
| --- | --- | --- | --- |
| GF0 Data/contracts | Partial | Demo runtime with K2 imports; canonical routes; pins | Owner: receipt re-pin |
| GF1 Identity/exchange | Partial | D10 authority fix; K4a readiness (`docs/evidence/gf1/k4a/readiness.md`): no recorded floors or spaces on the demo buildings, Magnolia has no source-stated unit that links to a plan panel, Tower 3 prints `UNIT-3A`/`UNIT-3B` on its `2ND FLOOR PLAN` sheet. **Lead decision:** floors and units are recorded source-stated and geometry-absent, like the building record; first target Tower 3 `UNIT-3B` | K4b (mechanism, tests), K4c (live record and code after the lead checks the crop), K5 card + QR |
| GF-AI (building/plans) | Partial | Fine-tuned model with holdout + transfer numbers; B7 DEV diagnosis; plan candidates | B8 attribution |
| GF-AGENT | Partial | Teacher labels verified; memory + student + routing; tabular sources through the real job with software controls (A3b) and a live two-file run (A3c) | A3d stability fixes; T1b labels and A4b retrain; held-out accuracy needs an owner decision on data |
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
2. On return: A3d → merge and roll the demo checkout forward, then F2b's owed live check; D1e → the lead labels the new development columns (T1b), then A4b (student retrain); the A lane then admits recorded derivatives so a TNHB table can be the demo import; K4b → the lead checks the cited crop, then K4c (live record, snapshot, code), then K5 (card + QR); F2b → merge.
3. A dev-only A5 follow-up (repaired OCR, native-text threshold, cropped tables, a live agent run through the demo gateway).
4. M1 on 14 Oct: push `staging`.
