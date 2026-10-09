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

## Live state right now

| Item | State |
| --- | --- |
| `staging` (`E:/Projects/3d-ulpin`) | Pushed to `origin/staging` on 10 Oct; the instruction reset (S0.2) follows `e95273e5`. Integration is owned by the lead. |
| Codex chats (retired 10 Oct) | Orchestrator `01a0ed8a`, D00 integration `01a0fbd1`, AI-04B backend `01a0ee2d`, D01/data `01a0f810` (GLTF-01) and ML Teacher `01a0fbd5`. Project activity stopped at about 16:25 IST. **AI-04B's last three turns failed with `503 account busy` from the local account router (127.0.0.1:18891).** The router chat `01a0edb3` also ended with a `502`. The Codex app restarted at 17:41. |
| In-flight work | **AI-04B launcher bridge fix: uncommitted.** It touches 2 files in `desktop-plan-extraction`, branch `task/d07-rfdetr-repaired-bridge-fix-20261006`. The teacher's failure record `cf85c491` (branch `task/d07-native-cpu-empty-loss-20261006`) is **not yet integrated**. D08 decision runtime check: prepared, not run. |
| Other worktrees | 16 Codex worktrees. Three old detached ones hold uncommitted edits that predate the reset: `56f9` (fragment rank), `b3eb` (CityJSON) and `backend-review` (native PDF/archive). Keep them parked; don't discard them. |
| Runtime | Docker engine is **not running** (`docker ps` fails; D07-DOCKER-AVAILABILITY returned blocked on `sailor-ingest.sock` errors). The last D01 report had 24 containers and 14 volumes preserved. No API is serving. The GPU is idle. |
| Private data | `E:/BhuAayam-data/{datasets,runtime,task-data}`. There are 97 task folders since 4 October, all receipts and inputs. The 5 October cleanup review was a metadata-only inventory with no deletions. |
| This branch | `claude/magical-bardeen-31bi7c` (worktree `E:/Projects/3d-ulpin-claude`). It contains the review bundle, including unaccepted learner checkpoints. **Never merge it wholesale into `staging`**; take only the docs. |

## Gates

| Gate | State | Last real evidence | Next |
| --- | --- | --- | --- |
| GF0 Data/contracts | Pending; parts exist | D04 live journey; D02 source scope; D03 contract | P0.3 runtime, P8.1 Studio live slice |
| GF1 Identity/exchange | Pending | D10 authority fix only | P5 (D10) |
| GF2 Domain AI/spaces | Pending; blocked on labels | D07 foreign baselines; one Haryana candidate run | P2.3 team labels, then P4 |
| GF3 Govern | Pending | none | P6 (D11) |
| GF4 Card/QR | Pending | none | P7 (D12) |
| GF5 Rehearsal | Pending | none | P9 (D14) |

## Areas

| Area | State |
| --- | --- |
| Backend | Works: the Tower-3 review, proposal, decision and evidence-history routes are new since 4 October. |
| Readers | Works, frozen. |
| Domain AI | Partial: wired and measured on foreign data; no Indian evaluation; no fine-tune finished. |
| Geometry | Missing: D09 is parked; CityJSON still has empty vertices. |
| Identity | Partial: P3 code exists; no input wired. |
| Card | Missing: D12 is parked. |
| Studio | Partial: unchanged since 2 October; 3 live routes and 33 mocked; D13 parked. |
| Data | Partial: Tower-3 documents and foreign/RAMP labels; 0 Indian labelled pairs. |

## Findings on 9–10 October that changed the plan

- **Labels exist.** Public RAMP data holds 6,288 Karnataka building chips and about 46k chips from 6 Bangladesh regions. Each chip was labelled by one person and reviewed by a second (CC BY-NC 4.0). The earlier work used 24 of them. GF-AI no longer needs team labels.
- **The two plan sources differ.** The Haryana Tower 3 plans are scanned images (no text, no vector paths). The Bihar Magnolia sanctioned plans are CAD vector PDFs with room labels and stated dimensions, so rooms can be extracted exactly.
- **The mapping agent is narrow.** It has 3 targets and accepts GeoJSON in EPSG:4326 only. The model gateway supports Sarvam (`sarvam-105b`), replay and control.
- **Only one Sarvam key was found:** `SARVAM_API_KEY` in `E:/BhuAayam-data/runtime/prefix-worker-20260929/compose.env`. The repo `.env` holds only `REPO_DATA`.
- **Preserved and pushed on 10 Oct:** `wip/rfdetr-bridge-fix-20261006`, `wip/fragment-rank-56f9-20261010`, `task/d07-native-cpu-empty-loss-20261006`, and `staging` itself.

## Assessment: what to do next

Follow [SPRINT-SELECTION.md](next-steps/SPRINT-SELECTION.md):
1. S0.1–S0.2 done on 10 Oct (preservation, AGENTS.md reset). S0.3 runtime is in wave 1.
2. Wave 1:
   - the RAMP data and plain GPU environment (B1);
   - the canonical vocabulary for the agent (A1);
   - the messy Indian files and storyline sources (D1, D2);
   - the vector plan reader (P1).
3. Then the teacher bootstrap (T1, by the lead), the learner, the Sarvam teacher and the building fine-tune, ahead of the Studio slice.
