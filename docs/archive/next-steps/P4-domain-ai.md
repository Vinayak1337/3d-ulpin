# P4 — Domain AI: the learned parts SIH26011 asks for

Goal: pass GF-AI with the **two learned routes that already exist**:
- RF-DETR for building masks, fine-tuned on public human-reviewed RAMP data;
- CubiCasa5K for plan segmentation, plus a deterministic vector plan reader for CAD sanctioned plans.

Document storey extraction is added through the agent (P3.4 teacher). Vertical delineation and topology are deterministic (P5).

**Updated 10 October:**
- RAMP gives 6,288 human-reviewed Karnataka chips and about 46k Bangladesh chips (P2.3), so the label deadlock is gone.
- The earlier RF-DETR attempts (5–6 October) stalled in a sealed-container harness: about 25 preparation and diagnosis tasks, with no model trained.
  - What to keep: the upstream bug they found, where the empty-mask loss isn't a scalar. The repair is on `staging` as `5bd61253` (`ulpin-rfdetr-empty-mask-scalar/1`).
  - What to drop: the container ceremony for experiments.
- The Tower 3 plans are scanned images. The Bihar Magnolia sanctioned plans are CAD vector PDFs with room labels and dimensions.

---

## P4.0 ⭐ A plain, fast GPU environment and evaluation harness

**Gate:** GF-AI · **Depends:** none · **Owner:** the single GPU owner (sprint B1)

```text
Build a plain experiment environment; no per-run staging or sealed containers for experiments (keep one
containment check for the final pre-integration run only).

- Python venv at E:/BhuAayam-data/ml/venv-vision (outside Git) with CUDA PyTorch for the RTX 3070 (8 GB), the
  pinned rfdetr package, and services/geo's model dependencies; record exact versions in
  scripts/ml/requirements-vision.lock. GPU smoke test: one forward/backward pass in under a minute. If native
  Windows CUDA fails after one diagnosed attempt, use WSL2 Ubuntu with GPU, not the old harness.
- scripts/ml/eval_buildings.py --model <onnx|checkpoint> --split {dev,holdout}: tiled inference matching the
  production profile in services/geo/geo/spatial_ml.py; per-building precision/recall at IoU>=0.5, mean IoU of
  matches, false buildings on empty chips, boundary F1 (2 px); denominators; a PNG contact sheet of best/worst.
  Output docs/evidence/gf-ai/building/<run-id>/result.json (git SHA, split hash, model hash, metrics, runtime).
- The holdout split refuses to run unless docs/evidence/gf-ai/preregistration.json is committed, and it logs
  every holdout run.
```

**Expect back:** the venv recipe and lock file, a GPU smoke result, and one dev evaluation of the installed model in minutes, with the holdout guard in place.

---

## P4.1 ⭐ GF-AI preregistration

**Gate:** GF-AI (DATA-04) · **Depends:** P2.3 · **Owner:** GPU owner (sprint B1)

```text
Commit docs/evidence/gf-ai/preregistration.json BEFORE any holdout run:
- building_mask: RAMP Karnataka holdout clusters (ids + hash), metrics as in P4.0, thresholds precision>=0.75 and
  recall>=0.70 at IoU>=0.5 (owner may adjust before freezing), baseline = installed
  rfdetr-satellite-buildings-onnx-v1;
- plan_rooms: CubiCasa5K test subset (ids + hash), per-class IoU and room-count accuracy; Indian raster plans are
  reported as uncalibrated candidates (no human labels);
- storeys: registry truth from P2.4 (holdout projects), exact storey-count match, label-set F1, conflict/unknown
  flag accuracy, zero values without a verifiable citation;
- label provenance (publisher, licence, review process); the rule that each holdout is evaluated at most twice:
  (1) installed/baseline, (2) final candidate.
```

**Expect back:** a committed preregistration whose Git date is earlier than the first holdout result.

---

## P4.2 ⭐ Building extraction: baseline, fine-tune and serve

**Gate:** GF-AI · **Depends:** P4.0, P4.1 · **Owner:** GPU owner (sprint B2, B3)

```text
1. Baseline: evaluate rfdetr-satellite-buildings-onnx-v1 (services/geo/ml-models.json) as installed on the
   Karnataka DEV split, then once on the HOLDOUT (prereg run 1). Five-line error analysis on dev (dense informal
   roofs, merged neighbours, small roofs, empty/vegetation chips, chip-edge cuts).
2. Fine-tune RF-DETR segmentation with rfdetr's own training API on TRAIN (Bangladesh + Karnataka train
   clusters): the largest variant that fits 8 GB with gradient accumulation; flips/rotations/colour jitter only;
   apply the empty-mask scalar-loss repair (staging 5bd61253) only if upstream still needs it. Train in resumable
   segments of at most ~100 minutes (checkpoint every segment; resume from the last one). Choose the checkpoint on
   DEV; then one HOLDOUT run (prereg run 2).
3. If the fine-tune can't beat the installed model on DEV, keep the installed model and report it honestly.
4. Export ONNX; check numerical parity on 5 real chips; add a NEW entry to services/geo/ml-models.json (never
   overwrite the old one) with a model card: weights SHA-256, training data (RAMP regions, CC BY-NC 4.0,
   attribution), preprocessing profile, metrics, failure modes, licence gaps.
5. Serve it through the existing spatial-ml batch path and show candidates on one demo-area chip via the API.
```

**Expect back:** dev and holdout `result.json` for the installed and fine-tuned models, a model card, ONNX parity, the error analysis, and the decision with its reason.

---

## P4.3 ⭐ Plans: vector reader first, plan model for scans, scale

**Gate:** GF-AI, GF-T16 prerequisite · **Depends:** P4.0 for evaluation · **Owner:** plans worker (sprint P1, P2)

```text
a. Vector reader (deterministic, sprint P1). For CAD/vector PDFs (Bihar Magnolia sanctioned layout:
   ~80–120k drawing paths and room labels such as "BEDROOM (12'11" X 10'2")"): extract wall/line work, build
   closed room regions (polygonize; snap within tolerance), attach the room label text inside each region, parse
   stated dimensions (feet-inch per 00-STANDARDS §3) to metres, derive the page scale from dimension strings vs
   drawn lengths (record the method; no scale -> pixel space with gap "no_scale"), and report per room: polygon,
   label literal, stated dims, computed area, stated-vs-drawn consistency. Every room cites page + bbox. Output
   room candidates (method deterministic:vector-plan@1) into the canonical record's candidates.
   Check by hand-free consistency on 3 real pages; flag rooms whose drawn size disagrees with the label.
b. Scanned plans (sprint P2): OCR text and dimension strings (existing document-ocr) + CubiCasa5K room candidates
   through the existing spatial-ml path with the v2 contour profile; scale from OCR'd dimensions where they
   resolve, else "no_scale". Tower 3 is the real case.
c. Evaluate CubiCasa5K as installed on the P4.1 CubiCasa test subset (foreign; per-class IoU, room count). No
   plan fine-tune in this sprint unless an Indian human-labelled set appears; licence CC BY-NC 4.0 recorded.
```

**Expect back:** Bihar rooms with literal dimensions and metric areas, plus the consistency report; Tower 3 candidates with a scale or an honest `no_scale`; the CubiCasa result; candidates visible through the API.

---

## P4.4 ⭐ Storeys and document facts: rules first, then the agent

**Gate:** GF-AI support, GF-T16 prerequisite · **Depends:** P2.4, P3.4 teacher · **Owner:** document-agent worker (sprint A5)

```text
Fill storeys/levels and unit facts from RERA and sanction documents as CANDIDATES.

1. Baseline: deterministic extractor over native text/OCR (extend scripts/usp/learning/document_fields_baseline.py
   and the existing document-proposal packets): G+N, "N storeys/floors", ordinal floor lists, basement/stilt/
   podium/terrace/mezzanine labels, unit counts, floor-to-floor heights with units. Every value carries its quote
   and locator.
2. Agent: the Sarvam teacher (P3.4) reads page text/OCR with layout positions and returns JSON-schema output
   {storeyCount|null, labels[], heights[], unitCounts[], conflicts[], citations[], abstain}. Reuse the officer
   AI extraction contract (modules/ai/officer-ai*.ts) and the document-proposal and decision routes.
3. Verifier (deterministic): every cited quote must exist at its locator in the original's text layer or OCR;
   otherwise the value is dropped. Units are converted by code.
4. Score both against the P2.4 registry truth on development projects, then once on the holdout projects. Ship
   whichever is better per field; the agent's verified outputs also feed the learner (P3.5) as pseudo_labels.
5. Output storey candidates into the canonical record. Tower 3 must show "conflicting: G+41 vs G+42" with both
   citations.
```

**Expect back:** results for both systems against registry truth, the chosen route wired as candidates, and Tower 3's conflict visible through the API.

---

## P4.5 Learned candidates into the canonical record and review queue

**Gate:** GF-AI, GF-AGENT · **Depends:** P4.2, P4.3, P1.2 · **Owner:** GPU owner + backend (sprint B4)

```text
- Roofprint candidates for the Karnataka demo area (holdout clusters): run the chosen building model on the
  area's imagery; polygons go to local metres via the image's georeference; attach as footprint candidates (kind
  roofprint) by overlap, or as new candidate buildings.
- Room candidates (P4.3) attach to a building level only after a reviewer chooses the level.
- Accept/reject through the existing review commands; acceptance creates a revision with lineage.
- /buildings/{id}/canonical shows candidates separately from reviewed values.
```

**Expect back:** a footprint that went `unknown` → `candidate` (model) → `reviewed` with lineage, and a room candidate accepted onto a chosen level.

---

## P4.6 Deterministic association (document ↔ building/floor)

**Gate:** GF-AGENT support · **Depends:** P3.1 · **Sprint:** after M2 unless the demo needs it

```text
Rules in order: exact issuer-scoped IDs (RERA reg no., sanction no., khasra where stated) -> normalised project
and tower/block names ("T-3"/"Tower 3"/"टावर 3") -> stated-location overlap -> storey-count compatibility.
Output candidate links with the rule that fired, plus one_to_many / no_match / ambiguous. Never accept on name
similarity alone. Use document-association(-targets/-authority).ts. Report precision/recall with the denominator.
```

**Expect back:** rule-based link proposals in the review flow and their measured precision and recall, with the denominator.

---

## P4.7 Superseded: distillation is now part of P3.5

As of 10 October, distillation into a local student is the core of the translate-and-learn learner (P3.5):
- the development teacher is the provider that has limit: Opus 5.5 on Claude, `gpt-6.1-sol` on the codex pool ([WORKERS.md §8](WORKERS.md#8-teacher-and-learner-work-the-model-follows-the-provider));
- the runtime teacher is Sarvam;
- the owner allows learning from Sarvam outputs.

The rules that still apply to any student trained on teacher outputs:
- teacher outputs are `pseudo_label` and never evaluation truth;
- the deterministic verifier runs before learning;
- held-out families and projects are never shown to a teacher;
- only public documents go to external teachers, never private or restricted sources;
- keep a student only if it beats the simpler baseline on the holdout.

Pixel tasks (roofprints, room masks) keep human-reviewed labels and pretrained vision models, not LLM teachers.
