# Hand-off — 10 October 2026, 14:10 IST

For a new chat that takes over as lead. It says what is done, what is half-done, and what to pick up to finish the ML work. Everything here was checked against the repo and the worktrees at the time above.

## 1. Start the new chat like this

1. Open the session in `E:\Projects\3d-ulpin` (branch `staging`).
2. Read, in this order: `AGENTS.md`, this file, [docs/next-steps/WORKERS.md](docs/next-steps/WORKERS.md), [docs/STATUS.md](docs/STATUS.md), [docs/next-steps/SPRINT-SELECTION.md](docs/next-steps/SPRINT-SELECTION.md) §3–§6.
3. A first message that works:

   > Read hand-off.md and docs/next-steps/WORKERS.md. You are the lead. Do §5 "First actions" in order, spawning codex workers first and Claude CLI workers when codex is limited.

**Worker rule in one line:** spawn **codex workers first**; when every codex account is limited, use the **Claude CLI worker** (it runs on the terminal's own login); the lead's own subagents are the last resort. Dispatch as background tasks, then stop; review each return before integrating. Full rules: WORKERS.md.

## 2. State in one screen

| Item | State |
| --- | --- |
| `staging` | Local, not pushed. Next push at M1 (14 Oct). Head is the commit that adds this file. |
| Demo deadline | 22 Oct (demo freeze); selection about 24 Oct. |
| Runtime | `ulpin-demo`, started from `E:/Projects/ulpin-wt/k1`, API `127.0.0.1:3194`. Storage preserved. Not checked since K3b finished. |
| GPU | RTX 3070 8 GB, free. One GPU owner at a time. |
| Codex pool (14:03) | codex-2, -3, -4 fresh (0%, reset 19:03); codex-1 at 95% (resets 15:32). codex-3's weekly limit is 90% used: short tasks only. |
| Claude CLI | Installed (2.1.296). Terminal account was limited until 14:00. The launcher's limit path is tested; **a successful worker run is still untested.** |
| Owner decision pending | Re-pin of four runtime-receipt hashes in `docs/api/runtime-qualification.json` (CRLF-computed). It is the only `check.py` failure. The lead must not do it unasked. Proposed LF hashes are in §7. |

### Work that is not integrated yet

| Task | Where | State | What to do |
| --- | --- | --- | --- |
| **K3b** reviewed level schedules | `E:/Projects/ulpin-wt/k1`, `task/k3b-level-schedule`, 4 commits (`61ec7ed3`, `34e2cb3e`, `40f077d0`, `1dd232cd`), clean | **Finished, not reviewed.** Report: `_tasks/logs/k3b.log` and `docs/evidence/gf-t16/k3b/REPORT.md` on the branch | Review line by line, then merge. It regenerates `openapi.json` and pins; expect a small conflict with A3's pins. |
| **A3b** tabular sources through chunk mapping | `E:/Projects/ulpin-wt/a2`, `task/a3b-tabular-wiring`, 2 commits (`6ed8d704`, `03867558`) + **8 uncommitted files** | **Died mid-edit** (empty log, no report). Steps 1–3 look committed; step 4 (worker wiring) is in the uncommitted diff | Re-dispatch with a RESUME file: review the uncommitted diff first, then continue from step 4 of `_tasks/a3b.md`. Codex session `1608759b-ea95-4ac8-9c72-42572c9b13e8`. |
| **D1c** property-relevant tables + new held-out set | `E:/Projects/ulpin-wt/d1`, `task/d1c-property-tables`, no commits | **Stopped on the Claude limit** while searching sources. Nothing saved | Re-dispatch `_tasks/d1c.full.md` from the start (swap the co-author line back to the codex one). |

## 3. ML work: what is done

### 3.1 Building roofprints (RF-DETR-Seg) — trained, measured, serving in the demo

- **Model:** `rfdetr-ramp-ka-seg-medium-b3-v1`, epoch 4 of a fine-tune on RAMP Karnataka. Weights SHA-256 `b6ef6264…`, input 432 px, ONNX parity proven (B5). Active only in the `demo` profile (`services/geo/ml-models.json`), on CPU.
- **Numbers** (instance match at mask IoU ≥ 0.5, production polygon path):

| Run | Precision | Recall | Note |
| --- | --- | --- | --- |
| Installed model, Karnataka holdout (B2) | 0.688 | 0.416 | the baseline before fine-tuning |
| **Fine-tuned epoch 4, Karnataka holdout (B3)** | **0.836** | **0.649** | target recall ≥ 0.70 **missed** |
| Epoch 4, DEV | 0.854 | 0.662 | |
| Epochs 5 / 6 / 7, DEV (B4 continuation) | 0.847 / 0.885 / 0.885 | 0.662 / 0.615 / 0.624 | training longer did not raise recall |
| Epoch 4, Cox's Bazar transfer (B4) | 0.830 | 0.355 | weak transfer to Bangladesh |
| 672 px training, best DEV epoch (B6b) | — | 0.640 | **rejected**: below 0.662 |

- **What the diagnoses found:**
  - **B7:** 87% of roofs missed at 0.5 have a raw detection scoring under 0.5. The DEV-chosen threshold is 0.45 (DEV R 0.708, P 0.816). **Lead decision: keep serving at 0.5,** the only point with held-out evidence.
  - **B8:** the loss after the model is overlap painting (a lower-scored mask keeps only pixels no higher-scored mask claimed), not the size filter or caps. Score-ordered mask NMS did **not** help (+0.0007 / +0.0037 recall).
  - **Small roofs:** under 64 px there is no matching raw detection at all. Recall by size at 0.5: 0.40 at 128–256 px, 0.30 at 64–128 px, 0.12 at 16–64 px. Only a training change can help these.
- **Evaluation budget left:**
  - Karnataka holdout: **spent** (`holdout-runs.jsonl`). Never run it again.
  - Cox's Bazar transfer: **spent.**
  - Chittagong transfer-2: **two slots, unspent** (`transfer-2-runs.jsonl` is empty; protocol in `docs/evidence/gf-ai/preregistration.json`, `building_mask_transfer_2`).

### 3.2 Floor plans — readers work; no model trained

- **Vector reader (P1):** Bihar Magnolia CAD PDFs → 18 exact rooms with literal dimensions. No model involved.
- **Raster reader (P2):** installed CubiCasa5K ONNX + OCR → 218 room candidates on Haryana Tower 3 scans, `no_scale`, level unknown. On 100 foreign CubiCasa test plans: mean class IoU 0.52, room-count MAE 30.1.
- **Not done:** no Indian plan labels exist, so there is no Indian accuracy figure and no fine-tune.

### 3.3 Storeys and units from documents — rules baseline; agent not run live

- **A5:** quote verifier, rules baseline, Sarvam storey agent, scoring. Dev: floor expressions 0/7, unit count P 1.0 / R 0.25. Holdout ran once with the baseline: **spent.**
- **A5b:** tiled native-resolution OCR is merged as an opt-in flag but **not adopted** (one more literal found, but it loses Tower 3 `G+42` and lowers two other measures).
- **The Sarvam storey agent has never run live** (no gateway config in a worker shell). The Tower 3 G+41 / G+42 conflict is in the canonical record from K2.

### 3.4 Mapping agent and its learner — pipeline built; nothing meaningful learned yet

- **Done:** teacher adapter with record/replay (A2); 411 development-teacher labels, 398 verified (T1 + A4); layout memory (0 teacher calls on a repeat layout); Stage A online student (`services/geo/geo/usp_learning/stage_a.py`); routing (`proposeMapping`); bounded tabular chunk kernel with officer questions (A3).
- **The two blockers:**
  - **No positive targets in the held-out set.** All 97 held-out columns are statistical; the right answer is always `unknown`. Dev is mostly statistical too. So the student commits only `unknown`, and held-out shows safe abstention, not accuracy. **D1c fixes the data.**
  - **A CSV cannot enter the runtime job yet** (upload returns 422). **A3b fixes the wiring.**

## 4. ML work: what to pick up, in order

The sprint's M1 (14 Oct) is "ML + agentic pipelines done through the API". Ranked by value for the demo:

### 4.1 Mapping learner (highest value; this is the "learning" the demo shows)

1. **D1c** → property-relevant dev families and a frozen held-out set with ≥ 25 positive-target columns. The lead stays blind to held-out headers and values.
2. **A3b** → CSV/XLSX through the real chunk-mapping job, recipe approval, `mapping.chunk` events, learning only after approval. Then the **two-file live run**: `mi-d10-01.csv`, then a same-layout file that must show `layout: memory` and 0 teacher calls.
3. **T1b (lead's own job):** label D1c's *development* columns as the development teacher (same method as T1; never look at held-out). Verify with `scripts/agent/verify-teacher-labels` so the Stage A student gets positive examples.
4. **A4b:** retrain the Stage A student on T1 + T1b labels; report the teacher-call curve on dev and **one** held-out evaluation on D1c's new set. Target from the plan: held-out precision 1.0 or abstain.
5. **A6 (optional, first to cut):** a distilled local student (Stage B) only if A4b shows Stage A is the limit. The GPU is free for it.

### 4.2 Building model (optional before the demo)

My recommendation is to **ship epoch 4 at 0.5** and not tune further before 22 Oct: it is the never-cut item and it already has held-out numbers. If there is spare GPU time, run **one** bounded experiment, following the failure-recovery rule in `AGENTS.md`:

- **Best candidate: multi-region training.** Add the Bangladesh RAMP chips to Karnataka TRAIN and fine-tune from the publisher weights at 432 px.
  - **Why:** the transfer recall of 0.355 is the model's weakest number, and about 46k labelled Bangladesh chips exist. Dhaka is already prepared as COCO at `E:/BhuAayam-data/datasets/ramp/coco/bangladesh-train/dhaka_bangladesh`.
  - **Guard:** the TRAIN export must keep rejecting both frozen transfer regions (Cox's Bazar, Chittagong); B6's code already enforces this.
  - **Success criterion (preregister it first):** DEV recall ≥ 0.662 with DEV precision ≥ 0.80. Only then spend **one** Chittagong transfer-2 slot, comparing against epoch 4 on the same slot rules.
- **Second candidate: small roofs.** Zoomed training crops (random crop, then upscale 2×) so roofs under 128 px get more pixels. B6 showed that upscaling the whole chip does not help, so this is a different factor, not a repeat.
- **Do not repeat:** more epochs (B4), 672 px whole-chip training (B6b), mask NMS (B8). All three are recorded as no gain.
- **How to run training:** `scripts/ml/launch_building_train.py` (detached launch, chunked mask loss that fits 8 GB), `train_buildings.py`, `eval_buildings.py`, `select_buildings.py`, `export_buildings.py`. Environment: `E:/BhuAayam-data/ml/venv-vision`. Past task files to copy from: `_tasks/b6b.md`, `b7.md`, `b8.md`.

### 4.3 Storeys (small, after A3b)

- Run the Sarvam storey agent **live on development documents only**, through the demo runtime's gateway, the same path A3b wires for mapping. Holdout documents never go to a provider.
- Possible follow-up: rotated (90°) tiles in the tiled OCR pass, united with the default pass, compared on dev.

### 4.4 Plans (no training planned)

Nothing to train without Indian plan labels. The demo uses the vector rooms (Magnolia) and the raster candidates (Tower 3) as they are.

## 5. First actions for the new lead

1. **Refresh the codex pool** (command in WORKERS.md §6).
2. **Review and merge K3b** (§2 table). Then run the LF-export `check.py`; only "runtime receipt changed" may fail.
3. **Dispatch on codex,** at most two `xhigh` workers per fresh account:
   - A3b resume (worktree `a2`);
   - D1c (worktree `d1`);
   - after K3b is merged: **K4** (identity + CityJSON with real vertices) and the two reject commands F2a asked for (a reject-only roofprint decision, a room reject), in worktree `k1`, which is the runtime/DB owner.
4. **After A3b returns:** hand it the runtime for the two-file run, then dispatch **F2b** (live import UI in the Studio, worktree `f1`).
5. **Then §4.1 steps 3–4,** and decide on §4.2.
6. **Update `docs/STATUS.md`** after each merge. Push `staging` at M1 (14 Oct).

## 6. Rules that bind the ML work

- **Preregister before running:** hypothesis, the one alternative, metric, decision rule, claim scope — committed before any run (see `b7/plan.json`, `b8/plan.json`, `a5b/plan.json`).
- **Held-out data is closed to tuning.** A spent holdout is never run again. The lead never opens `fixtures/usp/D8-messy-india/heldout.json`, `docs/evidence/usp/finale/GF-DATA/storey-truth/holdout/*`, or `publisher-meaning.jsonl` before labels are scored.
- **Teacher outputs are `pseudo_label`,** never evaluation truth. Officer corrections outrank teachers. Private or held-out documents never go to an external provider.
- **Every model output is a candidate** until an officer reviews it. Unknown never becomes 0.
- **Never** read `.env` / `demo.env` or credentials; never reset, reseed or delete data; never push to `main`, force-push or deploy.
- **An action the permission system refused a worker is not done by the lead;** it goes to the owner.
- **Pin checks need a true LF export:** `git -c core.autocrlf=false archive HEAD | tar -x -C <fresh unique dir>`.

## 7. Where things are

| Thing | Path |
| --- | --- |
| Task files, launchers, logs | `E:/Projects/ulpin-wt/_tasks/` (`<task>.md`, `_common.md`, `codex-subagent-win.mjs`, `claude-worker.sh`, `pool-watch.sh`, `claude-watch.sh`, `logs/`) |
| Worktrees | `E:/Projects/ulpin-wt/{a2,b3,d1,f1,g2,k1,p1}` (agent, GPU/building, data, Studio, geometry, runtime/registry, plans/storeys) |
| Building evidence | `docs/evidence/gf-ai/building/` (`b3-final-holdout-20261010`, `b4-final-transfer-20261010`, `b6/`, `b7/`, `b8/`, model card in `rfdetr-ramp-ka-seg-medium-b3-v1/`) |
| Building data and runs | `E:/BhuAayam-data/datasets/ramp/coco/{train,dev,holdout,bangladesh-train}`; runs and weights in `E:/BhuAayam-data/ml/runs/` (`b3-ka-run1-20261010` holds epochs 1–4) |
| ML scripts | `scripts/ml/` (building), `scripts/usp/learning/` (storeys), `scripts/agent/` (mapping agent), `services/geo/geo/usp_learning/` (student) |
| Python environments | `E:/BhuAayam-data/ml/venv-vision` (building), `venv-plans` (plans, storeys, agent Python) |
| Agent evidence | `docs/evidence/gf-agent/{a1,a2,a3,a4,t1}` |
| Storey evidence | `docs/evidence/gf-ai/storeys/{a5,a5b}` |
| Admission decision | `docs/evidence/gf-backend/k2f/admission-decision.md` (model-roofprint registry admission deferred until after the demo) |

**Proposed LF hashes for the receipt re-pin (owner approval needed):**

| Receipt | LF SHA-256 |
| --- | --- |
| `cityjson-admission-runtime.json` | `e233ad8ae07b21b054e339b91208599a7623355ed97c962ae387b65718bec6fa` |
| `reference-document-enrollment/runtime.json` | `a0e21dd26cdc517ab2f340fcf4a9900a08a48ef642a8716b19b06440d42f8b8b` |
| `cityjson-reference-runtime.json` | `9267ca2225907918eaeb32abca0c036ecb727964705fc4c02dd76cf6c283ba91` |
| `cityjson-admission-readiness-runtime.json` | `dd637bcb5729524358cb54da7b99b80104a94b4f44272b104baacd436d30f886` |
