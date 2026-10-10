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

## Live state right now (10 October, 15:03 IST)

| Item | State |
| --- | --- |
| `staging` | `db8c014d` plus this board update, local; next push at M1 (14 Oct). Merged this afternoon: **K3b** (reviewed level schedules) and **K3c** (room reject, reject-only roofprint decision, runtime resume). Earlier on 10 Oct: A5b, B8, A3 checkpoint, A5, K3a, K2f, B7, F2a, F1a/F1b, K2–K2d, B3–B6c, A2, P1/P2, T1 + A4. |
| Workers | Running, all codex: **A3b resume** (`a2`, `xhigh`: tabular sources through the chunk-mapping job), **D1d** (`d1`, `xhigh`: second source route for property tables, after D1c returned one development family and no held-out family), **F2c** (`f1`, `xhigh`: the Studio records rejections and shows decided candidates), **K4a** (`k1`, `high`, runtime/DB owner: registers the reject-only migration and reports what P3 identity needs on the real demo records). |
| Waiting on owner | Re-pin of four runtime-receipt hashes in `docs/api/runtime-qualification.json` (CRLF-computed; LF hashes proposed). It is the only `check.py` failure. Separately, `scripts/api/build-dataset-catalog.py --check` fails on `staging` with `KeyError: 'content'` (the D8 entries are not in the catalogue's strict shape); not yet assigned. |
| Runtime | `ulpin-demo` is **up again** (resumed by K3c from `E:/Projects/ulpin-wt/k1`; containers healthy at 15:00). It holds Tower 3 (revision 4, schedule reviewed as conflicting), Bihar Magnolia (revision 5, three reviewed levels, one room on GROUND), the Karnataka RAMP imagery area (22 chips, 80 roofprint candidates, `test_only`), GMDA sectors and NYC `test_only` proposals. The PostgreSQL container mounts a file from `ulpin-wt/s03`, so that folder must stay. |
| Building model | RF-DETR-Seg epoch 4: Karnataka holdout P 0.836 / R 0.649 (target R ≥ 0.70 missed); Cox's Bazar transfer P 0.830 / R 0.355. B6 (672 px) rejected. B7: 87% of missed roofs have a raw instance under 0.5, but the pipeline recovers only about half; DEV rule picks 0.45 (R 0.708, P 0.816). **Lead decision:** keep serving at 0.5, the only point with held-out evidence. B8 now locates the post-model loss. |
| Plans | Magnolia CAD: 18 exact vector rooms. Tower 3 scans: 218 raster room candidates, `no_scale`, level unknown. CubiCasa on 100 foreign test plans: mIoU 0.52. |
| Mapping agent | 411 teacher labels; 45/45 tables, 398/411 fields verified; agreement 36/3/5. Memory, Stage A student, routing merged. Agent loop + held-out truth in A3. |
| Storeys | A5 merged: quote verifier, rules baseline (weak on garbled OCR: dev 0/7, holdout 0/3), Sarvam storey agent (not yet run live). Tower 3 G+41 / G+42 conflict in the canonical record; K3b records it as a reviewed conflicting schedule. |
| Geometry | K3a: exact prisms (`prism/2`, 9 hand cases). K3b merged: level schedules in the canonical record. Heights are unknown for both demo buildings, so there are no prisms on real data yet. |
| Roofprint admission | **Deferred until after the demo** (`docs/evidence/gf-backend/k2f/admission-decision.md`). The demo shows model candidate → officer-reviewed source selection; the registry step shows the real `USP_GEOMETRY_PAYLOAD_UNQUALIFIED`. |
| OCR | Fixed by the complete tessdata prefix (K2f): Tower 3 page 1 gives 64 lines. K3b activates it for the demo profile. |
| Studio | F2a: candidate review queues for roofprints (area) and rooms (building), reasoned accept/reject, level picker (Magnolia now has reviewed levels), real refusals shown. F2c switches it to the two reject commands from K3c. |
| Private data | `E:/BhuAayam-data/{datasets,ml,runtime,task-data}`; nothing deleted. |

## Gates

| Gate | State | Last real evidence | Next |
| --- | --- | --- | --- |
| GF0 Data/contracts | Partial | Demo runtime with K2 imports; canonical routes; pins | Owner: receipt re-pin |
| GF1 Identity/exchange | Pending | D10 authority fix only. **Finding:** the P3 module assigns codes only to recorded registry spaces, and the demo has none (Magnolia rooms are unplaced candidates; Tower 3 has no levels) | K4a readiness report, then the lead designs K4 |
| GF-AI (building/plans) | Partial | Fine-tuned model with holdout + transfer numbers; B7 DEV diagnosis; plan candidates | B8 attribution |
| GF-AGENT | Partial | Teacher labels verified; memory + student + routing | A3 loop, held-out results |
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
2. On return: A3b → the two-file live run, then F2b (live import UI); D1d → the lead labels its development columns (T1b), then A4b (student retrain, one held-out run); K4a → the lead designs K4 (identity on one honest space), then K5 (card + QR); F2c → merge.
3. A dev-only A5 follow-up (repaired OCR, native-text threshold, cropped tables, a live agent run through the demo gateway).
4. M1 on 14 Oct: push `staging`.
