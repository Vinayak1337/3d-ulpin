# Selection sprint, 10–23 October 2026

**Goal:** by **Thursday 22 October**, the Officer Studio on the live backend, started with **nothing in it**, takes in real data while the judges watch: first the data we chose to show, then a file the judges hand over, in a format we have not seen, **with no code change**, streamed without the page freezing (owner direction, 10 October night; see §1).

The pipelines come first:
1. **The model that accepts heterogeneous data automatically.** The agent translates inputs it hasn't seen, and a learner absorbs every verified translation. This is priority one.
2. Building extraction from imagery.
3. Plan reading.
4. Document extraction.

These run in parallel lanes. The Studio slice follows them. Main selection is around **24 October**; the finale is in December.

This file is the executable plan. The prompts P0–P10 hold the detail for each task; this file says what runs, in what order, by whom, and when it counts as done. [STATUS.md](../STATUS.md) holds the live board.

---

## 1. What the judges will see

**Owner direction, 10 October night. It governs this section.** Nothing is prepared in advance on the presentation runtime. Before the presentation the Studio is cleaned of the data added during development. The show is the intake itself:

- **Our own data, live.** The data we selected (for example the NYC building footprints, and the Indian files below) is ingested in front of the judges, through the product's own routes.
- **Their data, live.** If the judges hand over a file, the same Studio ingests it without anyone changing code: the product either already understands the layout (memory, student) or learns it then, from the Sarvam teacher's guidance, and an officer reviews what it proposes. With the model or without it, the file gets in.
- **Large and streamed.** A large file arrives in parts, drawn and listed as they arrive, at a steady pace. The page never freezes while it streams. Today the streamed import applies its parts faster than the page can draw them and the page lags; that is a defect to remove, measured in frame times.
- The data rules do not bend for the show: nothing is invented, every model output is a candidate until an officer reviews it, and unknown stays unknown.

Consequences for the work: an **empty runtime that ingests a file it has never seen** ranks above polish of records already on the demo. Tower 3, Magnolia and the Karnataka area remain our test inputs and our own data to ingest live; they are not a prepared stage. Every rehearsal starts from an empty runtime (`ulpin-reh-NN`, [DEMO-RUNTIME.md](../backend/DEMO-RUNTIME.md)). The five items below are what the live intake leads to, in the order a presenter would take them.

1. **The map.** The Studio opens a real Indian area on the map: context layers, imagery, and **AI roofprint candidates** from our fine-tuned building model. The officer accepts one, and it becomes a reviewed footprint with lineage.
2. **Tower 3 (Haryana RERA 2831).** Storeys come from the RERA documents through the **document agent**. **G+41 and G+42 stay a visible conflict**, and each value opens its cited page region.
3. **A live import.** A messy Indian CSV/XLSX imports while you watch:
   - the **agent** proposes field mappings and asks one question;
   - chunks stream in;
   - the learner panel shows **Sarvam calls per chunk dropping** as the learner takes over.
4. **Rooms and units (Bihar Magnolia).** Rooms are read **exactly** from the CAD (vector) sanctioned plans: labels, dimensions and metric areas, with nothing guessed. Scanned plans go through the plan model as candidates.
5. **Identity and card.** Levels and units get **proposed 3D IDs** from the backend. A property card and QR are issued for one unit, and its verification passes.

Every number on screen comes from a result JSON. Unknowns are shown as unknown.

---

## 2. Owner decisions (9–10 October)

| Decision | Value | Consequence |
| --- | --- | --- |
| Who carries the project | **Claude**, as lead and delegator for all lanes | The Codex desktop chats are retired. AGENTS.md is rewritten (S0.2). |
| Workers | **pi codex-pool**, `gpt-6.1-sol`, effort high or xhigh ("max" isn't offered) | Protocol in §3. |
| Labels | **No team labelling.** Public, human-reviewed data plus source literals | Buildings: RAMP. Storeys: official RERA registry fields. Plans: vector literals plus public sets. Mapping: publisher data dictionaries. |
| Agent provider (runtime teacher) | **Sarvam** (`sarvam-105b`, JSON-schema output), for testing | Uses the existing gateway. Every response is recorded so the demo can replay. |
| Development teacher and learner work | **The provider that has limit; the model follows the provider** (changed 10 October evening). Claude Code CLI or a Claude desktop background task → Opus 5.5; pi codex-pool → `gpt-6.1-sol`. Either may teach, do the learner work (verify, build, train, evaluate the student), or both. The lead designs the method and reviews | Rules in [WORKERS.md §8](WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider). T1 and T1b were labelled by the lead (Opus 5.5) before this change. Anthropic's usage policy permits non-competing specialised classifiers; OpenAI's terms bar using output to develop models that compete with OpenAI. Ours are narrow classifiers and mappers for land records. |
| Learning from teacher output | **Allowed** for the development teacher's outputs (Opus 5.5 or `gpt-6.1-sol`) and Sarvam's. The owner removed the restriction: our mapping learner doesn't compete (Sarvam's terms ban only competing models) | Record the date and the reason in AGENTS.md. Teacher outputs stay `pseudo_label`, never evaluation truth. No teacher sees the held-out families. |
| Learner method | Distillation (teacher → verified outputs → student), as in the reference video | Design in §5. RL comes only later, as a routing policy. If this approach fails, the parked fallback is [FALLBACK-LEARNER.md](FALLBACK-LEARNER.md). |
| Several Sarvam keys | **Owner decision, 10 October night (replaces the one-key rule of H20):** the gateway works through the owner's list of keys, one in use at a time, and moves on only when the provider says a key is used up or rejected (AGENTS.md "Sarvam keys"; GK1) | Money caps count across all keys together. When every key is used up, calls fail closed to replay/manual mode. Adding, removing or reordering keys is the owner's step. |
| Downloads | Approved | RAMP Karnataka plus 6 Bangladesh regions (~9.7 GiB), CUDA PyTorch and rfdetr (~4 GiB), weights, and small public files. Everything goes under `E:/BhuAayam-data/`. |
| Git | Push `staging` now, then at milestones only | Never `main`, never force. |
| What is shown (10 October night) | **Live intake on a cleaned Studio**: our selected data, then a file the judges hand over, with no code change, streamed smoothly. Nothing pre-cached | §1. Rehearsals start from an empty runtime. The streamed import's lag is a defect with its own task. |
| Gateway confirmations (10 October night) | **Yes** to both: the keys' credit is spent only through this gateway; Sarvam is approved as this project's route for the minimised text the gateway sends | The confirmed policy file is `E:/BhuAayam-data/task-data/gk2/demo-gateway-policy.owner-confirmed-20261010.json` (outside Git; policy hash `efb90b3a…6721`, accepted by the check). The pending file is kept. |
| The eleven keys (10 October night) | **Eleven separate Sarvam accounts**, each with its own ₹100 of free credit | The approved caps stay as they are, counted across all keys: ₹100 in total, ₹25 a day, 150 calls per person per day. Raising a cap is an owner decision. |
| Header variants for training (10 October night) | **Allowed**: a teacher model may write other spellings of real column headers, for training material only | [FALLBACK-LEARNER.md](FALLBACK-LEARNER.md) Step 1 may start when its trigger is met. Variants are `synthetic_variant`, never evaluation, calibration or held-out. |

---

## 3. How the work runs

- **Lead (Claude, Opus 5.5).**
  - Plans, designs the models and writes task files.
  - Designs the teacher and learner method. Labelling and learner work are dispatched like any task ([WORKERS.md §8](WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider)).
  - Reviews returns and integrates into `staging`.
  - Updates STATUS.md and the claims, and pushes at milestones.
  - Doesn't do the build work itself.
- **Workers.** Spawner order, limits, timers and hand-over are in [WORKERS.md](WORKERS.md). The codex launch, as a background job:

  ```
  codex-subagent --model gpt-6.1-sol --effort xhigh --access edit \
                 --cwd <worktree> --timeout 110 --task-file <file>
  ```

  - One worker per task, in its own worktree `E:/Projects/ulpin-wt/<task>` on branch `task/<id>-<slug>`, cut from the current `staging`.
  - Long work continues through `--session <id>` in chunks of 110 minutes or less.
  - A background job can run 2 hours at most, so every task must leave a resumable checkpoint.
- **The rule.** Dispatch the wave, then **stop**. When a worker returns, **review it first**: read the report and the diff, re-run its one key check, and accept, fix or reject. Then integrate and dispatch what that unblocks. There is no polling and no waiting loop.
- **Exclusive owners:**
  - one **GPU owner** at a time;
  - one **runtime/DB owner** at a time (Docker stack, migrations, live writes);
  - one writer per shared seam, named in the task file.
- **Every task file contains:**
  - the worktree and branch;
  - what to read first;
  - the task;
  - owned paths and do-not-touch paths;
  - the data rules: never change or delete originals, `.env` or volumes; no push;
  - the time box;
  - the stop rule (the same failure twice → stop and diagnose);
  - the 5-line report from 00-STANDARDS §9, plus commits, commands with exit codes and the next step.
- **Task files say exactly what and how:** the files to create or change, the existing code and pattern to follow, the interfaces that matter, the acceptance checks, and the code-quality rules in 00-STANDARDS §11.
- **Review** follows 00-STANDARDS §11: the full diff file by file, re-running the key check, and requested changes going back to the same worker with an exact list.
- **Verification** stays lean (00-STANDARDS §8): contract check, the invariants touched, one good real input and one difficult real input. Add a regression test only for a bug actually found.

---

## 4. When the pipelines count as done

**ML pipeline (milestone M1, Wednesday 14 October)**
- [ ] **Buildings:**
  - preregistration committed before any holdout run;
  - installed RF-DETR and fine-tuned RF-DETR-Seg evaluated on the frozen RAMP Karnataka holdout (per-building precision/recall at IoU ≥ 0.5, false positives on empty tiles);
  - model card and ONNX parity;
  - a new model id served by `/spatial-ml`.
- [ ] **Plans:**
  - the vector plan reader turns Bihar Magnolia pages into rooms with literal labels, dimensions and metric areas, plus a consistency report;
  - scanned pages give CubiCasa candidates with a scale, or `no_scale`.
- [ ] **Documents:**
  - storeys, unit counts and floor labels from RERA PDFs, by rules plus the Sarvam agent;
  - every value carries a verified quote;
  - scored against the official RERA registry fields;
  - Tower 3 stays `conflicting`.
- [ ] **Learner:**
  - Stage A runs online;
  - on a multi-chunk file and on a second, similar file, Sarvam calls per chunk drop while precision on committed fields stays 1.0, or the field abstains.

**Agentic pipeline (milestone M1)**
- [ ] **Sarvam teacher:**
  - goes through the gateway with a budget ledger and structured output;
  - every response is recorded, and replay mode works;
  - it fails closed when credits or the network fail.
- [ ] **Canonical vocabulary and MappingPlan v2:**
  - covers building, parcel, unit, level, space and document facts;
  - operations: copy, enum lookup, unit conversion with a sourced factor, literal parse, parent-key link;
  - literals are rejected;
  - works on tabular files (CSV/XLSX) and GIS attributes.
- [ ] **The chunked loop:**
  - order: memory → student → teacher → verifier → officer questions → deterministic executor;
  - progress over SSE;
  - nothing commits without review.
- [ ] **Document agent:** wired into the existing document-proposal and decision routes.
- [ ] **Evaluation JSON:**
  - precision, recall and abstention per held-out family;
  - the teacher-call curve;
  - real injection cases where they exist.

---

## 5. Translate-and-learn design (agent + background learner)

```
chunk ─► memory (accepted plan for this layout fingerprint) ──hit──► executor
           │ miss
           ▼
         student (local, fast; calibrated confidence) ──confident──► proposal
           │ unsure                                                   │
           ▼                                                          ▼
         teacher: Sarvam (JSON schema, masked samples) ─► verifier (schema, no literals,
                                                           executor dry-run, quote-at-locator)
                                                           │ pass        │ fail → needs_input
                                                           ▼
                                             officer review (questions only where needed)
                                                           │ accepted / corrected
                                                           ▼
                                      training example → background learner update → next chunk
```

- **Two teachers, one student:**
  - **Before the demo:** the development teacher labels public development files (T1) to bootstrap the student. The teacher is the provider that has limit: Opus 5.5 on Claude, `gpt-6.1-sol` on the codex pool ([WORKERS.md §8](WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider)). The student exists before Sarvam runs once.
  - **At runtime:** Sarvam translates layouts the student can't handle.
  - Both teachers' outputs pass the same verifier, and officer corrections outrank both.
  - The held-out families never reach any teacher. Evaluation truth is the publisher's documented column meaning.
- **Memory (instant).** An accepted plan is reused for every later chunk with the same layout fingerprint, and for future files with that layout. This alone makes later chunks need no teacher call.
- **Student, Stage A (CPU, online).** A per-field classifier (scikit-learn `HashingVectorizer` + `SGDClassifier(log_loss)`, `partial_fit`). It is updated in the background after every verified teacher batch.
  - Features: header text (including Devanagari), value shapes (dates, lakh grouping, area units, khasra patterns), types and neighbouring columns.
  - The confidence threshold is set on a calibration family, so committed fields keep precision 1.0.
- **Student, Stage B (GPU, optional, after the building fine-tune frees the GPU).** Distil the verified Sarvam outputs into a small local model (LoRA on a 0.5–1.5B instruct model, or a cross-encoder) for layouts it hasn't seen.
  - Start only with ≥ 300 verified **positive-target** examples from ≥ 5 layout families. `unknown` labels don't count: A4c had 591 examples and only 15 positives.
  - Keep it only if it beats Stage A on held-out families.
- **Where RL fits.** Not as a label source. Later, the routing choice (trust the student / ask Sarvam / ask the officer) can be a contextual bandit, with reward = verified-correct minus call cost. That needs a few hundred reviewed decisions first.
- **What we measure:**
  - Sarvam calls and latency per chunk over time;
  - precision of committed fields, recall and abstention on held-out families;
  - agreement between student and teacher.

---

## 6. Tasks

Workers keep their session across tasks. G1 is the only GPU owner. R1 owns the runtime until it hands over to K1.

| ID | Task (prompt) | Worker / effort | Depends | Done when |
| --- | --- | --- | --- | --- |
| S0.1 | Retire Codex chats; preserve uncommitted work on `wip/*` branches | lead | — | Bridge fix, teacher record and old dirty worktrees committed to branches; nothing integrated |
| S0.2 | Instruction reset: AGENTS.md ~1 page, settings history, decisions, release-plan fields; docs into `staging` (P0.2) | lead | S0.1 | New AGENTS.md on `staging`; next-steps docs present |
| S0.3 | Runtime that stays up: start the stack without resets, `doctor`, RUNTIME.md (P0.3) | R1 / xhigh | — | `doctor` green cold and warm; API `/health` up |
| B1 | RAMP data + plain CUDA env + spatial split + preregistration (P2.3, P4.0, P4.1) | G1 / xhigh | — | Manifest with hashes/licence; COCO; KA holdout frozen; prereg committed; GPU smoke OK |
| B2 | Installed-model baseline on KA dev + one holdout run (P4.2) | G1 / xhigh | B1 | result.json with denominators |
| B3 | Fine-tune RF-DETR-Seg; choose on dev; one holdout run; ONNX; register (P4.2) | G1 / xhigh | B2 | New model id, card, parity, holdout result |
| B4 | Roofprint candidates on the demo imagery area through `/spatial-ml` (P4.5) | G1 + K1 / xhigh | B3, K2 | Candidates via API, `candidate` state |
| P1 | Vector plan reader for CAD PDFs (Bihar) → rooms with literal dimensions (P4.3) | P1 / xhigh | — | Rooms + consistency report on real pages |
| P2 | Raster plan path: OCR + CubiCasa candidates + scale (P4.3) | P1 / xhigh | P1 | Tower 3 candidates, scale or `no_scale` |
| A1 | Canonical mapping vocabulary + MappingPlan v2 + executor (P1.1, P3.4) | A1 / xhigh | — | Contracts, executor, validator with literal rejection |
| A2 | Sarvam teacher adapter, budget ledger, record/replay, fail-closed (P3.4) | A1 / xhigh | A1 | One live call recorded and replayed |
| A3 | Chunked agent loop with questions and SSE progress (P3.4) | A1 / xhigh | A2, D1 | Real messy file through the loop, via API |
| T1 | Teacher bootstrap: the development teacher (provider by limit, WORKERS.md §8) labels column profiles of development families + public pool; a separate worker session verifies (P3.5a) | teacher + A2 / xhigh | A1, D1 | `teacher-labels.jsonl` verified; agreement with publisher dictionaries on dev reported |
| A4 | Learner Stage A: memory + online student + routing + metrics (P3.5) | A2 / xhigh | A1, D1, T1 | Teacher-call curve falls; held-out precision 1.0 or abstain |
| A5 | Document agent: storeys/units with verified quotes → proposals (P4.4) | A3 / xhigh | A2, D2 | Scored against registry truth; Tower 3 `conflicting` |
| A6 | Learner Stage B: distilled local student (optional) (P3.5) | A2 / xhigh | A4, B3 | Beats Stage A on held-out families, or "no gain" |
| D1 | Messy Indian files with publisher data dictionaries (P2.2) | D1 / high | — | 8–15 real files, manifest, families split |
| D2 | Demo storyline sources + storey truth from RERA registries (P2.1, P2.4) | D1 / high | — | site-decision.md; truth JSON per building |
| K1 | Canonical projection API (P1.1, P1.2) | K1 / xhigh | A1 | `/areas/{id}/canonical`, `/buildings/{id}/canonical` |
| K2 | Install the demo areas through the real import route (P3.1) | K1 / xhigh | S0.3, D2, K1 | Areas and buildings in the linked DB |
| F1 | Studio live slice: existing routes to live, map/register/evidence on real data (P8.1) | F1 / xhigh | S0.3, K1 | Screenshots on real data; `ui-design-check` report |
| F2 | Studio review: roofprint/room candidates, document proposals, agent questions + learner panel (P8.2, P8.4) | F1 / xhigh | F1, B4, A3, A5 | Officer accepts real candidates in the UI |
| K3 | Level schedule + prisms (P5.1, P5.2) | K2 / xhigh | A5, P1 | Tower 3 schedule (conflict kept); Bihar prisms |
| K4 | P3 identity + CityJSON with real vertices (P5.5, P5.3) | K2 / xhigh | K3 | Codes on units; export validates |
| K5 | Card + QR verify (P7.1, P7.2) | K2 / xhigh | K4 | Card for one unit; tamper fails |
| F3 | Studio identity, levels and card from the backend (P8.3) | F1 / xhigh | K3–K5 | Survives reload; card from Studio |
| J1 | Golden journey script (P9.1) | lead + worker / xhigh | F2, K5 | One full timed run, skips listed |
| J2 | Claims ledger + demo runbook (P9.2) | lead | J1 | Owner approves claims |
| J3 | Deck + video script (P9.3) | lead + owner | J2 | Matches claims |

---

## 7. Schedule

| Day | Dispatch / integrate | Milestone |
| --- | --- | --- |
| Sat 10 | S0.1, S0.2 (lead). **Wave 1:** S0.3 (R1), B1 (G1), A1 (A1), D1+D2 (D1), P1 (P1). | Plan approved |
| Sun 11 | Review wave 1. **Wave 2:** B2→B3 (GPU segments), A2, K1, P2. Profiles from D1 → **T1 teacher labelling (lead).** | |
| Mon 12 | A4 (learner on T1 labels), A3, A5, K2 (after `doctor` is green), F1. | |
| Tue 13 | B3 continues; agent + learner on dev files; F1. | |
| Wed 14 | B3 holdout + ONNX; held-out family eval; document agent eval. | **M1: ML + agentic pipelines done (API).** Push |
| Thu 15 | B4, F2, A6 (GPU is free after B3). | |
| Fri 16–Sat 17 | K3, F2; replay recordings for the demo. | |
| Sun 18–Mon 19 | K4, K5, F3. | **M2: full slice in the Studio.** Push |
| Tue 20 | J1; fix what fails. | |
| Wed 21 | J2; rehearsal 1; fixes. | |
| Thu 22 | Rehearsal 2, recorded; **demo freeze.** | **M3: demo-ready.** Push |
| Fri 23 | J3 with the owner; buffer. | |

---

## 8. Cut order if late

Cut from the top of this list first:
1. A6 Stage B student.
2. CityJSON round trip (keep the export).
3. Topology and govern checks (P5.4, P6).
4. Card PDF polish (keep QR verify).
5. CubiCasa foreign evaluation.

**Never cut:**
- the live Studio slice;
- the fine-tuned building model with its holdout result;
- the agent with the Stage A learner;
- the Tower 3 conflict;
- one recorded rehearsal.

## 9. Risks

| Risk | Fallback |
| --- | --- |
| Docker keeps failing | The R1 doctor diagnoses it. If the Windows Defender interference reappears, adding exclusions is the owner's action. Last resort: the stack in WSL2-native Docker. |
| CUDA training on native Windows fails | WSL2 Ubuntu with GPU, or the already-built Linux GPU base image. Not the old sealed-container harness. |
| Sarvam credits run out | Replay recordings and memory/student reuse cut calls. Calls fail closed. The owner decides on the key. |
| Sarvam structured output is unreliable | The verifier rejects bad output. One bounded retry per chunk, then `needs_input`. Manual mapping always works. |
| Fine-tune misses the threshold | Report honestly and keep whichever model is better on dev. The claim is scoped to its holdout. |
| The student still commits no real field after the D1f labels and one retrain | Layout memory still gives the falling teacher-call curve. The parked fallback is [FALLBACK-LEARNER.md](FALLBACK-LEARNER.md): multiply the real positives first (an owner decision); a fine-tuned student with reinforcement learning only after selection. |

## 10. Owner actions

**Current (10 October night):**
1. **Put the keys in**, when the lead says the demo is stopped for its second roll-out: `node scripts/platform/demo-gateway.mjs keys --from <a text file outside Git, one key per line>`, then delete the text file. The lead never handles a key value.
2. **Before the presentation:** approve the cleaning of the development data from the presentation runtime (or the use of a fresh runtime), at the time it is done.

**Earlier (9–10 October), kept for the record:**
1. Put the Sarvam key in the repo `.env` under the name A2 reports. I found only one key, `SARVAM_API_KEY`, in `E:/BhuAayam-data/runtime/prefix-worker-20260929/compose.env`. I don't read or edit `.env`.
2. Stop or archive the five old Codex desktop chats. They're idle; just don't resume them.
3. Run `git push origin staging`. My push was blocked by the session's permission check. Alternatively, allow it in the Claude Code settings.
4. Approve the claims ledger before the deck (J2).
