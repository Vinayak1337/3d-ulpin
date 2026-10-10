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

## Live state right now (10 October, 10:30 IST)

| Item | State |
| --- | --- |
| `staging` | `94606761`, local; next push at M1 (14 Oct). Merged since 02:45 on 10 Oct: F1a/F1b (Studio on live canonical records, candidates ghosted), K2/K2b/K2c/K2d (demo buildings, claims, imagery area, roofprint and room candidates, pins), B3/B4/B5 (building fine-tune, transfer test, ONNX parity v2), B6/B6b/B6c (higher resolution, rejected on DEV), A2 (Sarvam teacher adapter), P1/P2 (vector and raster plan readers), T1-prep + A4 (teacher labels, memory, Stage A student, routing). |
| Workers | pi codex-pool `gpt-6.1-sol`; all four accounts hit the 5-hour limit around 08:00. Queued: A3 (agentic tabular intake + held-out truth) on the codex-1 reset 10:31; K2e (geometry-qualification producer, OCR tessdata prefix, LF receipt pin) on the codex-2 reset 11:13. Claude Sonnet workers cover gaps (A5, B6b, B6c). |
| Waiting on owner | A5 (storey/unit rules + Sarvam storey agent) is reviewed but not merged: its first commit, a refactor the lead requested, breaks P2's pinned inference-code continuity proof. Lead recommends integrating A5 without that commit. |
| Runtime | `ulpin-demo` up from `E:/Projects/ulpin-wt/k1` (API 127.0.0.1:3194). Holds Tower 3 (storey conflict kept, officer decision "unresolved"), Bihar Magnolia (18 unplaced room candidates, level unknown), a Karnataka RAMP imagery area (22 chips, 80 model roofprint candidates, `test_only`), GMDA sectors, NYC `test_only` proposals. The building model is active in the demo profile only, on CPU. |
| Building model | RF-DETR-Seg epoch 4 (`rfdetr-ramp-ka-seg-medium-b3-v1`): Karnataka holdout P 0.836 / R 0.649 (target R ≥ 0.70 missed); Cox's Bazar transfer P 0.830 / R 0.355. Small roofs are the gap (recall 0.40 at 128–256 px, 0.12 at 16–64 px). B6 at 672 px did not help (best DEV R 0.640 vs 0.662) and is rejected; Chittagong transfer-2 slots stay unspent. GPU is free. |
| Plans | Magnolia CAD: 18 exact vector rooms. Tower 3 scans: 218 raster room candidates, `no_scale`, level unknown. CubiCasa on 100 foreign test plans: mIoU 0.52, room-count MAE 30.1. |
| Mapping agent | Lead (development teacher) labelled 411 columns; 45/45 tables and 398/411 fields pass the verifier; agreement with publisher dictionaries 36 agree / 3 disagree / 5 not comparable. Memory cuts teacher calls to 0 on repeat layouts. Stage A student commits only `unknown` so far (too few positives). Held-out truth is being built in A3. |
| Storeys | A5 (unmerged): rule baseline weak on garbled OCR (dev floor expressions 0/7, holdout 0/3); the Sarvam agent did not run (no gateway config in the worker shell). Tower 3's G+41 / G+42 conflict already exists in the canonical record from K2. |
| Blockers | Reviewed roofprint admission needs a geometry-qualification producer (K2e). OCR fails with `KeyError: 'text'` (missing OSD/TSV tessdata assets; K2e). |
| Contract check | `datasets.json` pin fixed by K2d; one remaining LF-only runtime-receipt pin (K2e step 0). |
| Private data | `E:/BhuAayam-data/{datasets,ml,runtime,task-data}`; nothing deleted. |

## Gates

| Gate | State | Last real evidence | Next |
| --- | --- | --- | --- |
| GF0 Data/contracts | Partial | Demo runtime with K2 imports; canonical routes; pins | K2e receipt pin |
| GF1 Identity/exchange | Pending | D10 authority fix only | K4 |
| GF-AI (building/plans) | Partial | Fine-tuned model with holdout + transfer numbers; plan candidates | K2e reviewed roofprint |
| GF-AGENT | Partial | Teacher labels verified; memory + student + routing | A3 loop, held-out results |
| GF3 Govern | Pending | Officer conflict decisions (K2b) | P6 |
| GF4 Card/QR | Pending | none | K5 |
| GF5 Rehearsal | Pending | none | J1 |

## Areas

| Area | State |
| --- | --- |
| Backend | Works: canonical area/building records, geometry-free imports, imagery area, candidate retention, append-only officer decisions. |
| Readers | Works; plus vector (CAD) and raster plan readers. |
| Domain AI | Partial: building model trained and measured on held-out Indian data; plan readers produce candidates; storey extraction weak. |
| Agent | Partial: teacher labels, memory, Stage A student and routing; agentic loop in A3. |
| Geometry | Missing: level schedule and prisms (K3) not started; CityJSON still has empty vertices. |
| Identity | Partial: P3 code exists; no input wired. |
| Card | Missing: K5. |
| Studio | Partial: live canonical records with ghosted candidates (F1a/F1b); review screens (F2) next. |
| Data | Works for the sprint: RAMP Karnataka + Bangladesh labels, D8 messy-India pack, D2 storey truth. |

## Findings on 9–10 October that changed the plan

- **Labels exist.** Public RAMP data holds 6,288 Karnataka building chips and about 46k chips from 6 Bangladesh regions. Each chip was labelled by one person and reviewed by a second (CC BY-NC 4.0). The earlier work used 24 of them. GF-AI no longer needs team labels.
- **The two plan sources differ.** The Haryana Tower 3 plans are scanned images (no text, no vector paths). The Bihar Magnolia sanctioned plans are CAD vector PDFs with room labels and stated dimensions, so rooms can be extracted exactly.
- **The mapping agent is narrow.** It has 3 targets and accepts GeoJSON in EPSG:4326 only. The model gateway supports Sarvam (`sarvam-105b`), replay and control.
- **Only one Sarvam key was found:** `SARVAM_API_KEY` in `E:/BhuAayam-data/runtime/prefix-worker-20260929/compose.env`. The repo `.env` holds only `REPO_DATA`.
- **Preserved and pushed on 10 Oct:** `wip/rfdetr-bridge-fix-20261006`, `wip/fragment-rank-56f9-20261010`, `task/d07-native-cpu-empty-loss-20261006`, and `staging` itself.

## Assessment: what to do next

1. Owner: decide A5's integration (lead recommends dropping the refactor commit).
2. Codex-1 reset: A3. Codex-2 reset: K2e. Then K3 (level schedule + prisms) and F2 (Studio review screens for roofprint/room candidates and agent questions).
3. Storeys need better OCR before more extraction work: K2e's tessdata repair first, then a dev-only A5 follow-up (native-text threshold, cropped tables) and a live agent run through the demo runtime's gateway.
4. M1 on 14 Oct: push `staging`.
