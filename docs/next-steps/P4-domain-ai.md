# P4 — Domain AI: the learned parts SIH26011 asks for

Goal: pass GF-AI with the **two learned routes that already exist** (RF-DETR building masks, CubiCasa5K plan segmentation), evaluated on Indian team-labelled holdouts and fine-tuned only if needed. Then add document storey extraction and deterministic association. Vertical delineation and topology are deterministic (P5).

**Why this replaces the fragment-support lane:** the problem statement's AI tasks are pixel tasks (building extraction, floor segmentation). The text fine-tune had 23 training fragments and 1 development positive, and isn't in the finale. See [ML_REVIEW_RECOMMENDATIONS.md](../../ML_REVIEW_RECOMMENDATIONS.md).

---

## P4.0 ⭐ A plain, fast evaluation harness

**Gate:** GF-AI · **Depends:** P0.1 · **Owner:** the ML owner (single GPU owner)

```text
Replace per-run staging (19,700 files / 8.6 GB for 2.3 s of compute) with a plain offline harness for
experiments. Keep the AppContainer audit for the final pre-integration check only.

Build scripts/ml/eval/ (Python, one venv from services/geo/requirements-ml.txt + pinned extras):
- run.py --task {building,plan,storeys} --model <model-card.json> --set <labels manifest> --split {dev,holdout}
- Offline: HF_HUB_OFFLINE=1, local weights only, hash checked against the model card before loading.
- Output: one docs/evidence/gf-ai/<task>/<run-id>/result.json with git SHA, dataset manifest hash, model hash,
  preprocessing profile, per-class metrics with denominators, per-item predictions (paths to masks/polygons
  outside Git), runtime and peak memory. Also a small HTML or PNG contact sheet of worst/best items.
- A run on the dev set takes minutes. The holdout split refuses to run unless preregistration.json exists
  and its hash is committed (P4.1), and it logs each holdout run.
Reuse the model loaders/preprocessing from services/geo/geo/spatial_ml.py so evaluation matches production.
```

**Expect back:** one command that evaluates an installed model on the dev split in minutes, with a result JSON and contact sheet. The holdout guard is in place.

---

## P4.1 ⭐ GF-AI preregistration

**Gate:** GF-AI (DATA-04) · **Depends:** P2.3 · **Owner:** ML owner + data

```text
Write docs/evidence/gf-ai/preregistration.json and commit it BEFORE any holdout run:
- tasks: building_mask (roofprints), plan_rooms (room classes) [, storeys if P4.4 is in scope];
- metrics: building: per-building precision/recall at IoU>=0.5, mean IoU of matched, false buildings on empty
  tiles, boundary F1 (2 px); plans: per-class IoU, room-count accuracy per page, unit-boundary IoU where
  labelled; storeys: exact storey-count match, label-set F1, conflict/unknown flag accuracy;
- thresholds (proposal; owner may adjust before freezing): building precision>=0.75, recall>=0.70 on the
  holdout; plan mean room IoU>=0.55 with no class reported only pooled; storeys count exact>=0.80 where truth
  is known and conflict/unknown flagged>=0.80, zero values without a verifiable citation;
- holdout item IDs and label hashes, label authors (team), baseline definitions, and the rule that the
  holdout is evaluated at most twice: (1) installed model, (2) final candidate.
```

**Expect back:** a committed, hashed preregistration. The commit date in Git must be earlier than the first holdout result.

---

## P4.2 ⭐ Building extraction: evaluate RF-DETR, fine-tune if below threshold

**Gate:** GF-AI · **Depends:** P4.0, P4.1 · **Owner:** ML owner

```text
1. Evaluate rfdetr-satellite-buildings-onnx-v1 (services/geo/ml-models.json) as installed on the dev split,
   then once on the holdout. Use the production tiling profile (512 tiles, stride 384).
2. Error analysis on dev: false positives on empty/vegetation tiles, merged adjacent roofs (tiled union),
   missed small/informal roofs, blur. Write 5 lines.
3. If the holdout is below threshold: fine-tune RF-DETR segmentation on the dev split with the official
   rfdetr training recipe (COCO export from P2.3), on the RTX 3070 within 6 GiB (batch/grad-accumulation/
   resolution chosen to fit). Augment with flips/rotations/colour jitter only. Optionally pretrain on an
   open, licence-checked building dataset (record it in the model card) before the Indian dev split.
   Pick the checkpoint on dev; then a single final holdout run.
   If fine-tuning can't beat the installed model on dev, keep the installed model and report it honestly.
4. If RF-DETR's undocumented training data overlap can't be ruled out for any holdout source, also run H27's
   documented fallback (torchvision DeepLabV3 with a building head, trained only on the dev split) and report
   both.
5. Export the chosen model to ONNX, check numerical parity on 5 real tiles, add a new entry to
   services/geo/ml-models.json (new id; never overwrite the old one) with its model card.
```

**Expect back:** dev and holdout `result.json` for the installed and the final model, a model card, ONNX parity, a 5-line error analysis, and the decision with its reason.

---

## P4.3 ⭐ Plan segmentation: evaluate CubiCasa5K, fine-tune if needed, vectorise and scale

**Gate:** GF-AI · **Depends:** P4.0, P4.1 · **Owner:** ML owner

```text
1. Evaluate cubicasa5k-rooms-onnx-v1 as installed on the Indian dev split, then once on the holdout.
2. Error analysis on dev: Indian plan conventions (thick hatched walls, Devanagari/English labels, dimension
   chains, stilt/parking sheets, multi-unit typical floors). 5 lines.
3. If below threshold: fine-tune the CubiCasa5K model (official repo, pinned commit) on the dev split, keeping
   its class map. Licence: CC-BY-NC-4.0 for the original weights and data; record it as a launch-clearance gap
   and keep the fine-tuned weights noncommercial unless retrained from permitted data.
4. Vectorisation (deterministic, services/geo): mask -> room polygons (simplify, orthogonalise to dominant
   wall directions within 3°, snap shared walls), with a confidence per room from the mean softmax.
5. Scale: from a dimension string or scale bar the OCR finds on the page (feet-inch parsing per
   00-STANDARDS §3) -> metres per pixel, with the method recorded; no scale -> polygons stay in pixel space
   with state candidate and gap "no_scale".
6. Output rooms as DomainCandidates through the existing spatial-ml batch/apply flow, linked to the source
   page/region.
```

**Expect back:** dev and holdout results per class, vectorised rooms with scale (or an honest no-scale), candidates visible through `/api/v1/spatial-ml/batches/{id}`, a model card for any new weights, and an error analysis.

---

## P4.4 Storey extraction from documents (regex baseline vs zero-shot model)

**Gate:** GF-AI support, GF-T16 prerequisite · **Depends:** P2.4, P4.0 · **Owner:** ML owner or backend/AI

```text
Fill storeys[] from RERA/sanction documents as candidates.

1. Baseline: deterministic extractor over OCR/native text: G+N, "N storeys/floors", ordinal floor lists,
   basement/stilt/podium/terrace/mezzanine labels, floor-to-floor heights with units. Every value carries its
   quote and locator.
2. Model: a local 3B–8B instruction model or VLM, 4-bit, on the 3070 (e.g. Qwen2.5-VL-3B/7B-Instruct or a
   current Qwen instruct model; record revision/licence/hash), reading the page text plus page image, with
   JSON-schema-constrained output: {storeyCount|null, labels[], heights[], conflicts[], citations[], abstain}.
   No fine-tuning.
3. Verification (deterministic): every cited quote must exist at its locator in the original's text layer or
   OCR; otherwise the value is dropped. Units converted by code.
4. Evaluate both on the P2.4 dev split, then once on the holdout. Keep the model only if it beats the regex
   baseline; else ship the baseline.
5. Output storey candidates into the canonical record (state candidate, method model:<id> or deterministic).
```

**Expect back:** both systems' results, the chosen one wired as candidates, and Tower 3 showing "conflicting: G+41 vs G+42" with both citations.

---

## P4.5 Learned candidates into the canonical record and review queue

**Gate:** GF-AI, GF-AGENT · **Depends:** P4.2, P4.3, P1.2 · **Owner:** backend

```text
Make the learned outputs first-class candidates in the canonical record and the officer review flow.
- Roofprint candidates for the demo area: run the chosen building model on the area's imagery; polygons go
  to local metres via the image's georeference; attach as footprint candidates (kind roofprint) to existing
  buildings by overlap, or as new candidate buildings.
- Room candidates from P4.3 attach to a building level only after a reviewer chooses the level (no guessing).
- Accept/reject through the existing review commands; acceptance creates a revision with lineage.
- /buildings/{id}/canonical shows candidates separately from reviewed values.
```

**Expect back:** in the API, a demo building whose footprint went from `unknown` → `candidate` (model) → `reviewed`, with lineage, and a room candidate accepted onto a chosen level.

---

## P4.6 Deterministic association (document ↔ building/floor), with no model

**Gate:** GF-AGENT support (finale); prerequisite for P10.2 · **Depends:** P3.1 · **Owner:** backend

```text
Before any learned linker, build the rule-based one and measure it.
Rules, in order: exact issuer-scoped IDs (RERA reg no., sanction no., khasra/ULPIN where stated) -> project and
tower/block names after normalisation (case, Devanagari digits, "T-3"/"Tower 3"/"टावर 3") -> spatial overlap
of a stated location with candidate footprints -> storey-count compatibility. Output: candidate links with
the rule that fired, plus one_to_many, no_match and ambiguous results. Never accept on name similarity alone.
Use existing document-association(-targets/-authority).ts; this produces proposals for officer review only.
Evaluate on whatever reviewed pairs exist (report the denominator even if tiny) and list every ambiguous case.
```

**Expect back:** rule-based link proposals in the review flow, the measured precision/recall with the denominator, and the ambiguous cases listed. This becomes the baseline any future ML linker has to beat.

---

## P4.7 Conditional: distil a strong teacher into the local storey extractor

**Gate:** GF-AI support · **Depends:** P4.4 done, and **all three triggers below met** · **Owner:** ML owner

**Run this only if all three hold:**
1. The local zero-shot model in P4.4 misses its threshold on the dev split.
2. A strong teacher (e.g. GPT-6.1 Sol at xhigh, or another frontier model) passes the same dev evaluation clearly.
3. The deployment needs a local, offline or India-resident model.

Otherwise ship the regex baseline or the teacher-assisted review flow and skip this.

```text
Goal: transfer the teacher's demonstrated storey-extraction ability to a small local model, using real
documents, not hand-written examples.

0. Permission check (write it down first): (a) the teacher provider's current terms on using outputs to train
   models; (b) only public documents (RERA/sanction PDFs from P2.2 sources) go to an external teacher; no
   private or restricted source; (c) never Sarvam outputs (H21). If (a) is unclear, stop and ask the owner.
1. Ceiling: run the teacher once on the P2.4 DEV split with the same schema and verifier as P4.4. It must
   beat the local model clearly. Never show the teacher the holdout.
2. Unlabelled pool: 300–2,000 real public plan/approval pages from >=5 projects/issuers that are NOT in the
   P2.4 holdout projects (exclude by project ID, not by page).
3. Teacher pass: structured JSON (same schema as P4.4) with quotes and locators. The deterministic verifier
   drops any value whose quote isn't found at its locator; abstentions are kept as abstain examples, not dropped.
4. Human spot-check: a team member reviews a random 10% (minimum 50 items); record the agreement rate. If it
   is under 90%, fix the prompt/verifier and repeat on a fresh sample. Don't train on unchecked bad batches.
5. Train the student with standard tooling: QLoRA (TRL SFTTrainer + PEFT), all linear layers, on a 3B–7B
   instruct model that fits the 3070 in 4-bit; outputs constrained to the JSON schema at inference.
   Hold out a calibration project for any confidence threshold.
6. Evaluate the student once on the P2.4 holdout against the regex baseline, the zero-shot local model and the
   teacher's dev numbers. Keep the student only if it beats the zero-shot local model and the baseline.
7. Record everything as pseudo_label lineage in the model card (teacher id/version, prompt hash, pool
   manifest, verifier version, spot-check rate).
```

**Expect back:** the permission note, the teacher's dev ceiling, the pool manifest, the spot-check agreement rate, the student's holdout result against the three comparisons, and a model card. Or an early stop with the trigger that failed, which is a perfectly good outcome.
