# External review: what to change in the 3D ULPIN ML approach

**Reviewed:** [PROJECT_AND_ML_REVIEW.md](PROJECT_AND_ML_REVIEW.md) on `review/project-ml-20261004` (head `6c37f973`), with [ML-DISTILL-01](docs/orchestration/ML_DISTILL_01.md), the scene input types in [packages/scene/src/types.ts](packages/scene/src/types.ts) and the scoring code in [fragment_rank.py](services/geo/geo/usp_learning/association/fragment_rank.py). Review date: 4 October 2026.

**Scope:** this review covers the code and the reported results only. I didn't rerun training, open private artifacts or read the held-out data.

---

## 1. Summary

The goal you described is: **accept heterogeneous building and map data, and output normalised records that the Three.js scene can render.** The current ML lane can't reach that goal, even if every planned experiment succeeds. That is not because the model is too small or the loss is wrong. There are three deeper reasons, plus a fourth covered in §1a (the lane addresses none of the AI/ML tasks the problem statement names):

1. **Most of the target schema doesn't need ML.** Footprints, storeys, heights, base features, point clouds and image overlays come from geometry and attributes that readers can convert directly. A model should fill only the gaps that readers can't fill.
2. **The one learned task now being trained doesn't output any field the scene renders.** A yes/no "does this fragment support the request" score over already-extracted text produces no polygon, height, storey or space.
3. **There is too little data to learn anything, or to measure whether anything was learned.** Training has 23 unique fragments from 2 families. The development check has 2 requests, 7 candidates and 1 positive. One flipped prediction changes the result from "pass" to "fail". No loss or objective change can be judged on that.

The report's own conclusion is correct: *"execution progress has outpaced evidence of learning progress."* My recommendation:

- **Pause fine-tuning, including STUDENT-45 and its phases.**
- **Redirect ML effort to the two learned routes that SIH26011 and the GF-AI gate require.** These are building extraction from imagery and floor-plan segmentation. Models for both are already in the repo (see §1a).
- **Build a hand-labelled evaluation set for the real output schema.**
- **Make the converters deterministic wherever they can be.**
- **Use strong pretrained models with no fine-tuning for the remaining semantic and vision gaps.**
- **Fine-tune only when a measured gap remains and you have hundreds of labelled examples for it.**

---

## 1a. Check against the problem statement (SIH26011)

The original `Problem statement Details.txt` isn't in the repository. This section uses its summary in [H23 §D](docs/usp-agent-handoffs/23-india-data-and-delivery-plan.md) and the release requirements in [H27](docs/usp-agent-handoffs/27-domain-ai-and-cadastral-checks.md).

According to H23, the statement asks for:

- **unique identities** for surface parcels, multi-storey apartments and underground infrastructure;
- **integration of** drone imagery, LiDAR/point clouds, parcel GIS, floor plans, GNSS/CORS and DEM/DSM;
- **AI/ML for four named tasks:** building extraction, floor segmentation, vertical delineation and topology validation.

Here's how the current ML lane lines up with those four tasks:

| Task the statement names | Correct method (your own H27) | What the current ML lane does |
| --- | --- | --- |
| Building extraction (drone/imagery) | A learned building-mask model on imagery | Nothing |
| Floor segmentation | A learned plan-segmentation model on floor plans | Nothing |
| Vertical delineation | Deterministic prisms from reviewed footprints plus level limits | Nothing |
| Topology validation | Deterministic overlap, contact and hole checks. Learned ranking is optional | Nothing |

**The fragment-support fine-tune addresses none of the four AI/ML tasks the problem statement names.** It's a text-relevance precursor to document association. That's useful product plumbing, but the statement doesn't ask for it.

Your own documents already say this:

- H23: *"Full-product schema learning … does not replace these four domain AI/ML tasks."*
- H27 sets the release gate **GF-AI**: *"two genuinely learned inference routes: a building-mask extractor and a plan-segmentation model,"* each with pinned weights and an untouched, independently labelled evaluation.
- H27 also records that **both models already exist in the repo** ([services/geo/ml-models.json](services/geo/ml-models.json), evaluations in [docs/evidence/t061](docs/evidence/t061)):
  - `cubicasa5k-rooms-onnx-v1`: floor-plan room segmentation. It scored pixel accuracy 0.872 and mean IoU 0.656 on 2 published test plans. Its licence is CC-BY-NC-4.0, so it's for non-commercial use only.
  - `rfdetr-satellite-buildings-onnx-v1`: building segmentation from satellite imagery, Apache-2.0. Its training set is undocumented, so H27 requires showing that the holdout doesn't overlap it.

So the ML that the problem statement and your release gate actually require is **half-built and has gone unattended**. Meanwhile the dedicated ML lane spent its effort on a task that sits outside both. Of everything in this review, that is the most important correction:

> **Point the ML effort at GF-AI.** Evaluate and, if needed, fine-tune the existing building-mask and plan-segmentation models on independently labelled Indian imagery and floor plans. Make vertical delineation and topology deterministic. Treat document/association models as later product work.

The "normalised schema for the Three.js map" framing still holds: the outputs of those two models are exactly the `FootprintInput.polygons` and `LevelInput.spaces[]` the scene draws.

---

## 2. What the target actually is

The renderer already defines the normalised schema ([types.ts](packages/scene/src/types.ts)). Working backwards from each field shows where its value can come from:

| Scene field | Typical sources | How it should be produced | ML needed? |
| --- | --- | --- | --- |
| `FootprintInput.polygons` | Shapefile/GeoJSON/GeoParquet/KML/CityGML/DXF, IFC slabs, LiDAR | GDAL/OGR, IfcOpenShell, ezdxf: reproject to local metres | **No** for vector inputs. **Yes** only for footprints from imagery or scanned maps (pretrained segmentation) |
| `heightM`, `heightState` | Attribute columns, CityGML, IFC storeys, LiDAR/DEM (roof minus ground), documents ("G+12") | Read the column, or compute from points/DEM, or extract from text | **Small:** mapping columns to meanings, and extracting values from text |
| `storeys[]` (`levelId`, `lowerM`, `upperM`, `belowGround`, `open`) | IFC `IfcBuildingStorey`, sanctioned plans, RERA documents | IfcOpenShell for IFC. Document extraction for plans and PDFs | **Yes**, for documents only |
| `LevelInput.spaces[]` polygons | IFC `IfcSpace`, CAD plans, raster floor plans | IFC/DXF readers. Floor-plan segmentation for scans | **Yes**, for raster plans only (a vision model) |
| `BaseFeatureInput` (parcel/road/water/utility) | GIS layers | OGR with a mapping from attribute values to `kind` | **Small:** mapping attribute values to `kind` |
| `PointOverlayInput`, `ImageOverlayInput` | LAS/LAZ, GeoTIFF/orthophotos | PDAL, rasterio | **No** |
| Which records describe the *same* building or floor (association) | Every source | Spatial join, ID and name normalisation, then review | **Maybe:** first measure where the rules fail |

That leaves four distinct ML problems. Each has its own inputs, outputs, metrics and suitable pretrained models:

- **A. Schema mapping:** map an unfamiliar column or attribute to the field it means. Input is tabular or GIS. Output is a mapping.
- **B. Document field extraction:** pull storey count, storey names, levels, heights, tower and building names, and unit lists from PDFs, scans and HTML, with citations. Input is pages. Output is typed values with citations.
- **C. Vision extraction:** building footprints from imagery, and rooms and walls from raster floor plans. Input is pixels. Output is polygons.
- **D. Association:** decide that record X in source 1 and record Y in source 2 describe the same building or floor. Input is a pair of candidates. Output is match / no match / abstain.

Your requirements already list these (the three workstreams in report §2, and H27). The current lane is none of them. It is a precursor to B or D, measured on data drawn from neither.

---

## 3. What is going wrong, specifically

### 3.1 The experiment can't produce a measurable signal

| Fact from the report | Consequence |
| --- | --- |
| Training: 10 parents, 57 appearances, **23 unique fragments**, 2 families | A LoRA on this memorises those 23 strings. Six epochs only memorise them harder |
| Development: 2 requests, **7 candidates, 1 positive** | Every possible result is one of a handful of outcomes. "Recall 0/1" versus "1/1" is a single prediction |
| Train is OCR text from PDF/HTML. Development is native IFC attributes | The train and development distributions are different problems. A failure can't be attributed to the objective |
| Labels are provisional and written by the same agent system | No independent ground truth, and possibly circular |

STUDENT-44/45 (class balancing) will answer "did the margins on 7 IFC candidates move?" Either answer is uninformative, so I'd stop it now rather than finish phases 2 and 3.

### 3.2 The model setup works against itself

- **Qwen2.5-0.5B-Instruct used as a binary classifier**, via `logit("1") − logit("0")` at the last prompt position. Its zero-shot judgement on qualifier-heavy questions ("is there a *non-null numerical* elevation?") is weak. A rank-8 LoRA on only `q_proj`/`v_proj` for 60 steps can't add that ability.
- **A fixed threshold of 0 on an uncalibrated margin.** Refusing to tune the threshold on development data is principled. But without a calibration split, a zero cut-off is arbitrary. The "selects nothing" behaviour (margins all negative) is exactly what an uncalibrated cut-off produces. Calibrate on a held-out *training-family* split, or evaluate ranking (is the positive ranked first?) separately from the selection decision.
- **No ceiling was measured.** Nobody checked what a strong model does with no fine-tuning on the same items. Without that, you can't tell whether the task is hard, the labels are wrong, or the student is too small.

### 3.3 Process overhead is crowding out the learning

- A fresh run stages about **19,700 files / 8.6 GB**. In one run, staging took 192 s and the guarded host step 289 s, for **2.3 s of model work**.
- `docs/evidence/usp/ml-distillation/` holds **145 files** of receipts, acceptances, protocols and continuations for one experiment on 57 pairs.
- The lane document's status lines ("exact11 owned/all36 runtime Git equality;99 correction references/40 protections…") are not readable as engineering decisions. Most defects reported in §6 were contract defects between writers and readers of the process itself (hash format, `settings` vs `binding.fit`, path checks), not ML defects.
- Model, effort and service-tier directives changed many times across 26 Sept – 2 Oct and were recorded in AGENTS.md and the lane plan. This is coordination cost with no effect on output quality.

Safety boundaries (offline weights, no egress, preserved originals) are reasonable. But they should be a **one-time environment** that you reuse, not something re-proved with a new receipt for every experiment. Iteration speed decides whether ML work converges. Right now each experiment costs hours of agent coordination, for evidence that two requests changed.

### 3.4 The order of work was inverted

What was done: model choice → teacher examples → fine-tune → hardening → narrower task → fine-tune again.

What should have come first: **output schema → labelled evaluation set → deterministic baseline → strong zero-shot baseline → error analysis → only then training, on the error class that remains.**

---

## 4. What should have been done (and what to do now)

### Step 0: Stop and simplify (1 day)

- Pause STUDENT-45 and all association fine-tuning. Keep the code and receipts as history; they're useful as a record of what didn't work.
- Agree one **plain local evaluation harness**: a Python script plus a JSONL dataset, run from a normal venv with `HF_HUB_OFFLINE=1` and local weights. Record the git commit, dataset file hash and model hash in one results JSON per run. Target: **an experiment takes minutes, not hours.** Keep the AppContainer harness for the final pre-integration check only.
- One owner (one person or agent) for the ML lane. No teacher/learner/orchestrator triad until there is a training loop worth coordinating.

### Step 1: Define the normalised building record (1–2 days)

Write one versioned JSON Schema (`normalized-building/1`) that maps 1:1 onto `FootprintInput` / `StoreyInput` / `LevelInput` / `SpaceInput` / `BaseFeatureInput`. Every value carries:

- a `state` (`unknown | absent | null | conflicting | estimated | source_supported | reviewed`), using the existing H28/H99 vocabulary;
- a `citation` (source hash plus page/region/row/entity).

This is the contract the backend projects into the scene. ML components only ever **propose** values for it, which then go through review as today.

### Step 2: Build the evaluation set before any model (3–5 days, mostly human labelling)

- Pick **30–60 real buildings across at least 6 source families** that you already hold:
  - NYC 62-footprint area and its LiDAR/DEM;
  - Haryana RERA Tower 3;
  - Bihar Magnolia;
  - buildingSMART and KIT IFC samples;
  - CityGML samples;
  - D1.
- For each building, **a person** (not the teacher agent) fills in the expected `normalized-building/1` record from the sources: footprint, height and state, storey list, and spaces where they exist. Mark unknown or conflicting values honestly. G+41/G+42 is a *conflict* label, which is a valid and useful test.
- Split by family **once**, and keep a held-out group of at least 2 families.
- Per-field metrics:
  - footprint IoU;
  - height absolute error and state accuracy;
  - storey-count exact match;
  - level-name F1;
  - abstention precision (did it say "unknown" when the truth is unknown?);
  - citation validity.

This also gives the frontend real expected outputs to render against.

### Step 3: Deterministic pipeline first (1–2 weeks, mostly existing code)

Most readers already exist (report §3). Wire each format into the Step 1 schema and score it on Step 2. Expected outcome:

- IFC, CityGML, vector GIS and LiDAR will fill footprints, heights and IFC storeys and spaces at high accuracy, **with no ML at all**.
- The remaining fields show you exactly which gaps need ML. They will almost certainly be:
  - storeys and heights stated only in documents or plans;
  - spaces only in raster plans;
  - unfamiliar attribute columns;
  - cross-source association.

### Step 4: Strong pretrained models with no fine-tuning, on the measured gaps (1–2 weeks)

Use the largest model that fits, with **constrained structured output** (JSON Schema or a grammar) and **deterministic verification**: every cited quote must exist at the cited locator, units are converted by code, and no citation means abstain.

| Gap | Recommended approach | Notes |
| --- | --- | --- |
| A. Column/attribute mapping | Few-shot prompt to an instruction model, with the column name, sample values and the list of target fields. Keep the Qwen3-Reranker result from V7 as the cheap first-pass ranker | V7 reranker already got 5/7 calibration with no wrong accepts. That's better than any fine-tune so far |
| B. Document fields (storeys, heights, names) | A 3B–8B instruction model or VLM, 4-bit, on the RTX 3070 (for example Qwen2.5-VL-3B/7B or Qwen3 instruct models), reading OCR text **plus the page image** | Score against Step 2. Report per-field accuracy and abstention |
| C. Raster floor plans → spaces (**SIH floor segmentation, GF-AI**) | Use the **existing** `cubicasa5k-rooms-onnx-v1`. Evaluate it on about 30–50 human-labelled Indian sanctioned/RERA plans. Then vectorise and scale using a dimension or scale bar. Fine-tune only if the evaluation shows a gap and labels are permitted | CC-BY-NC-4.0 (non-commercial). Record it as a launch-clearance gap, as AGENTS.md already allows |
| C. Footprints from imagery (**SIH building extraction, GF-AI**) | Use the **existing** `rfdetr-satellite-buildings-onnx-v1`. Evaluate it on independently labelled Indian tiles (OSM, Google Open Buildings or Microsoft footprints can help build labels and check overlap). Use H27's DeepLabV3 fallback if overlap with its training set can't be ruled out | Imagery outlines are roofprints, not ground footprints (H27). Keep their provenance separate from official records |
| D. Association | Rules first: spatial overlap, normalised IDs, tower/block names, storey counts. Then a cross-encoder or reranker on the residual hard cases | Measure rule precision and recall on labelled pairs before adding a model |

If policy allows a hosted model for development experiments on public sources, run the same evaluation once with a frontier model. That gives a **ceiling**: if a frontier model can't do a field from the evidence, the evidence is insufficient and no small fine-tune will fix it.

### Step 5: Fine-tune only when it pays (later)

Fine-tune when **all** of these hold:

1. A specific field or subtask has a measured gap between the zero-shot student and the ceiling.
2. You have **at least 300–1,000 labelled examples from at least 5 families** for that subtask. Pseudo-labels from the ceiling model are acceptable if a human spot-checks a sample.
3. The deployment needs it (offline, cost or latency).

Then the recipe is ordinary: QLoRA on a 3B–8B model with all linear layers, a proper calibration split, and a ranking/selection evaluation on the frozen held-out families. Use standard tools (TRL/PEFT SFT, or a sentence-transformers cross-encoder for association) instead of the custom fit/phase/checkpoint/reload stack.

---

## 5. Direct answers to the report's seven questions (§8)

1. **Task decomposition:** split into the four problems A–D above, driven by the render schema. Start with B (document storeys and heights) and D (association rules), because those block the most scene fields once deterministic readers are wired. Standalone support classification isn't a product slice.
2. **Data and labels:** the smallest credible set is 30–60 human-labelled buildings across at least 6 families, with explicit conflict, no-match, adjacent-floor and same-name/different-building cases. For association, use about 200 labelled candidate pairs. A person labels it; teacher labels are training-only and spot-checked.
3. **Architecture/base model:** the 0.5B causal model with two-token scoring is the wrong tool. Use a capable instruction model or VLM with constrained decoding for extraction, a reranker or cross-encoder for association, and pretrained vision models for plans and imagery. Replace the custom phase/checkpoint/reload machinery with TRL/PEFT and plain scripts when training eventually happens.
4. **Objective and diagnosis:** the class-balanced comparison doesn't answer a useful question at n=2 development requests. Stop it. The next controlled change should be **"strong zero-shot model on the same items"**, to separate label and evidence problems from capacity problems.
5. **Generalisation/evaluation:** report each stage separately on the Step 2 set:
   - reader extraction coverage;
   - candidate recall;
   - field accuracy and abstention;
   - association precision/recall;
   - footprint IoU.

   Promotion needs held-out families, not two related IFC requests.
6. **Iteration cost:** build the offline environment once (pinned venv, local weights, no-network flag, one results JSON per run). Use the full AppContainer audit only before integration. One writer for the results format.
7. **Delivery order:**
   1. Normalised schema.
   2. Labelled evaluation buildings, plans and imagery tiles.
   3. **GF-AI: evaluate the existing building-mask and plan-segmentation models on independent Indian labels, and fine-tune if needed.** This is what the problem statement and release gate require.
   4. Deterministic converters, vertical delineation and topology checks, wired to the scene.
   5. Zero-shot document extraction for storeys and heights.
   6. Association rules.
   7. Fine-tuning of text models, if still needed.

   Defer: fragment-support fine-tunes, teacher expansion, harness re-hardening and per-run receipt campaigns.

---

## 6. Falsifiable experiments to run next

### 6.1 First priority: GF-AI on the existing models

**Question:** are the existing CubiCasa5K and RF-DETR models good enough on Indian inputs to supply `LevelInput.spaces[]` and footprints?

- **Data:**
  - about 30–50 Indian floor-plan pages (RERA/sanction sets you hold or can acquire), with room polygons labelled by a person;
  - about 30–50 Indian imagery tiles, with building outlines labelled by a person and checked for overlap with RF-DETR's training data.

  Split by project or area once, before any fine-tuning.
- **Metrics:** per-class IoU and room-count accuracy for plans. Building-level precision/recall at IoU ≥ 0.5, and boundary F1, for imagery.
- **Acceptance:** set the thresholds before running, as H27 requires in GF0. Report per class; no pooled score.
- **If below threshold:** fine-tune on a permitted, labelled Indian training split from different projects (standard torchvision/RF-DETR training scripts, a few hundred labelled images), then re-evaluate on the untouched split. This is the one place where fine-tuning on your 3070 is clearly justified.

### 6.2 Then: document storey extraction

**Question:** can a pretrained model with no fine-tuning extract storey structure from the documents you hold, well enough to fill `storeys[]`?

- **Data:** the Step 2 buildings whose storey truth comes from documents (Haryana, Bihar, and any other RERA/sanction sets). For each, a human records the expected storey list, or `conflicting` (G+41/G+42) or `unknown`.
- **System:** OCR text plus page images go to a 4-bit 3B–8B instruction model or VLM. Output is JSON Schema-constrained: storey count, storey names, any stated heights, a quote and locator per value, or abstain. Code checks that each quote exists at its locator.
- **Baseline:** regex/rule extraction (`G+\d+`, `\d+(st|nd|rd|th) floor`, `basement`, `stilt`) over the same OCR text.
- **Acceptance (set before running):**
  - storey count exact match ≥ 80% where the truth is known;
  - conflicting/unknown correctly flagged ≥ 80%;
  - **zero** values without a verifiable quote;
  - the model beats the regex baseline.
- **If it fails:** compare with a frontier model on the same items. If the frontier model also fails, the evidence is insufficient (a data problem). If it passes, distillation into the local model has a real target, and a real reason, for the first time.

This takes days, uses data you already hold, and directly fills a scene field.

---

## 7. What to keep

- Preserving originals, hashes, citations, and distinguishing unknown/absent/null/conflicting values: this is the right foundation and is rare in projects like this.
- Deterministic readers for every format, the source-fusion projection that refuses to claim association, and review-before-commit.
- The honesty of the report: failures recorded as failures, no threshold games.
- The V7 Qwen3-Reranker result, as a first-pass ranker for schema mapping.
- The resumable checkpoint work. It's not needed now, but it's reusable once a real training set exists.
