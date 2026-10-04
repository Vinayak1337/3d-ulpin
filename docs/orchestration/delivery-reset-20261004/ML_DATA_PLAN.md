# ML and data: revised sequence

**Proposed; all workers and training remain stopped.** This plan preserves the user's full goal: combine fragmented inputs, link evidence to the right buildings/floors, and produce reviewable 3D records. It separates that goal into tasks whose outputs can be measured and used. See [assessment](README.md) and [delivery queue](EXECUTION.md).

## Task-to-output map

| Task | First implementation / baseline | Useful output |
| --- | --- | --- |
| Structured IFC/GIS/CityGML/CAD attributes and geometry | Existing deterministic readers, unit/frame conversion and canonical validation | Source-supported records or local geometry, with explicit missing fields; no LLM conversion of coordinates. |
| Building extraction from imagery | Existing RF-DETR runtime, with declared training-overlap uncertainty; documented-training alternative only if needed | Source-pixel roofprint candidates, then calibrated/reviewed geometry. Roofprint is not a cadastral footprint. |
| Floor-plan segmentation | Existing CubiCasa5K room-head runtime | Room-region candidates and class errors. Room masks do not automatically define legal units, wall components, floor IDs or metric carpet area. |
| Vertical delineation and topology | Reviewed polygons plus evidenced level bounds; deterministic geometry and relationship checks | Supported prisms and explainable findings; no guessed heights or ownership. |
| Document fields and level schedules | Literal/native extraction and regex baseline; one suitable pretrained local text/vision model if it adds value | Typed values with exact page/region/text citations, unresolved units and conflicts. A storey count is not a height. |
| Building/floor association | Source-scoped IDs, explicit cross-references, supported spatial/parent relations, then manual review | Candidate record IDs/revisions, correct scope, citations and abstention. Evaluate retrieval separately from ranking. |
| Unfamiliar column mapping | Retained typed/lexical baseline and Qwen3 reranker results; small CPU classifier if a measured gap justifies it | Proposed schema mappings executed by deterministic code. Historical V7 calibration is not a current universal success rate. |

## What we retain from the failed ML lane

The Qwen2.5-0.5B fragment experiments established that fitting and reloading local adapters can work. They did not establish a useful evidence linker. The corpus contains 10 parent requests, 57 candidate appearances, only 23 unique fragments from two training families, and provisional teacher labels. The development comparison has two requests, seven candidates and one positive, with a PDF/HTML-to-IFC distribution shift.

Generative selection produced unsupported selections. The later binary ranker selected nothing on the development items despite improved training observations. Those outcomes cannot isolate model size, objective, calibration, labels or distribution shift as the sole cause. The latest class-balanced attempt failed before training during Windows staging. Preserve all results; do not finish that experiment simply because its harness is almost repaired.

The next experiment must produce a field, region or relationship that the product consumes, beat a comparable baseline on a meaningful cohort, and show correction effort or useful coverage. Training loss and a successful checkpoint are not success criteria.

## Data sequence before any fit

1. **Inventory the retained cohort once.** Separate independent originals, derived pages/crops, repeated candidate appearances, provisional supervision and independently reviewed truth. The dataset catalogue is an inventory, not a training set. NYC, KIT/buildingSMART examples and D1 are not automatically one matched building corpus; foreign and teaching samples retain their scope.
2. **Make a small annotation pilot.** Select a few representative imagery scenes and plan pages to establish classes, ambiguity, readable scale and actual annotation effort. These become development data. Do not promise that 30–50 densely labelled pages take one or two days before measuring the effort.
3. **Choose an eligible independent truth route.** Under current DATA-07, reuse permitted institution-issued human-labelled benchmarks where available. For Indian applicability, use independently reviewed team labels only after their intended gate status is explicitly settled. Such labels are team research annotations, not official property facts. Agent-assisted outlines require independent review; model predictions and teacher answers are not final evaluation truth.
4. **Group before splitting.** Keep the same site/building, neighboring overlapping imagery tiles, plan revisions, repeated floors and template relatives together. Separate train, development/calibration and final evaluation. Do not turn the repeatedly inspected IFC development requests into a fresh holdout. Previously closed or retired evaluations remain closed.
5. **Freeze one comparison.** Record task/classes, source groups, annotation provenance, preprocessing, baseline, numerical thresholds, coverage minimum, failure budget and stop condition before final predictions. Set thresholds from intended utility and development evidence, not by looking at final labels/predictions. If meaningful per-class/site coverage is unavailable, label the run feasibility only.

**Correction to the external P2.3/P4.1–P4.3 prompts:** keep a training split separate from development/calibration whenever fitting occurs. Do not fine-tune on the same `dev` rows used to choose checkpoints, and do not first inspect the final holdout to decide whether to train or which fallback to try. Make those decisions from development results. Freeze the installed baseline and any final candidate, then score both in one final comparison under the same protocol. If final evaluation exposes a new failure, keep that result; later adaptation needs a new eligible evaluation cohort or an explicitly different claim. A two-run limit by itself does not prevent evaluation leakage.

Use an annotation guide with explicit classes, ambiguous/ignore regions and excluded claims; review disagreements independently before freezing labels. Reuse a practical annotation/export tool only where it saves work, rather than requiring a new hosted service. Retain source-image/page transforms so labels survive resize, crop and rotation. Example thresholds in the prompt pack (building precision 0.75/recall 0.70, plan IoU 0.55, storey accuracy 0.80) remain **unadopted proposals**, not measured performance or approved release criteria. The task owner can propose defensible numerical targets from utility/development evidence; user input is needed for a changed public claim or label-acceptance policy, not every engineering setting.

The reviewer counts (roughly 30–50 imagery tiles, 20–30 or 30–50 plan pages, and 30–60 buildings for broader extraction) are starting estimates. Sample counts must refer to independent sites/projects as well as instances. A hundred crops from one sheet are not a hundred independent examples. New Indian data discovery should address a named coverage gap; do not repeat failed portal searches already recorded in the source index.

## First model comparison: existing vision routes

Reuse [the pinned models](../../../services/geo/ml-models.json) and [T061 results](../../evidence/t061/models/evaluation.md). The existing room head has two-plan mean class IoU **0.65622**. The existing building runtime has 12-tile IoU **0.28738**, precision **0.34181**, recall **0.64344**, with empty-scene false positives. Those are feasibility observations on foreign/public data, not Indian accuracy targets or future pass thresholds.

Measure the following on the newly qualified cohort, one frozen configuration per task:

- **Buildings:** foreground IoU, object precision/recall under a declared matching rule, missed buildings, empty-scene false positives, touching-roof merges and per-site results. Evaluate original masks and final polygons separately so vectorization errors remain visible.
- **Plans:** per-present-class IoU, room/component detection, boundary error in pixels, missing/merged rooms, rotated/low-quality sheets and correction effort. Metric error is assessed only where independent scale/reference evidence exists. Unsupported legal-unit/wall/carpet classes remain explicit gaps.
- **Integration:** source pixel → candidate → calibrated draft → review, with model/profile/source identity preserved. Candidate display and source inspection must remain useful without automatic recording.

Reuse production model loading, preprocessing and polygonization for evaluation; store per-item predictions outside Git and inspect a small development error sheet. Preserve raw masks/polygons. The proposed 3-degree orthogonalization and wall snapping are not automatically correct for real plans: only add a separate versioned derivative if development evidence shows improvement, and measure geometry distortion. OCR-found dimensions may propose calibration, but require a reviewed association to the correct dimension endpoints, page/crop/rotation, units and applicable scale. A dimension string alone cannot place the plan or prove source accuracy. Keep pixel-space candidates when calibration is missing; preserve uncalibrated softmax/sigmoid labels instead of treating scores as correctness probabilities.

RF-DETR's undocumented training population prevents a confident non-overlap claim. Newly collected dated scenes or a documented-training alternative may resolve a defined scope; a different city alone does not prove non-overlap. Google/Microsoft predicted footprints and OSM may assist discovery or reviewed candidate creation, but are not automatically independent mask truth or official parcels.

CubiCasa's upstream [repository](https://github.com/CubiCasa/CubiCasa5k) supplies the reference architecture/evaluation workflow; its pinned [licence](https://raw.githubusercontent.com/CubiCasa/CubiCasa5k/c34440266665a11f4484eb06cd2e4b7d72ad76c1/LICENSE) is CC-BY-NC-4.0. Keep code, weights, evaluation data and later distribution conditions separately recorded. The RF-DETR pinned model-card URL could not be fetched by the web tool in this assessment; existing manifest/retained evidence is the basis for its recorded licence and lineage, not a fresh upstream verification.

## Second comparison: document output and association

Use Haryana/Bihar source-supported level schedules and conflicts for a **new development comparison**, not a broad accuracy claim. Compare literal/regex extraction with one capable pretrained local model using identical readable source content. Return a constrained typed proposal plus exact cited locator/quote; deterministic checks verify quote existence, units, source/revision and schema. Quote existence is necessary but does not prove the interpretation is correct.

Score supported field extraction, exact citations, conflict retention, unsupported claims and useful coverage. Separately score retrieval coverage, wrong-building/wrong-floor accepts, building-only and multi-floor outcomes. Existing [AI-08](../ADAPTIVE_INGESTION_EXECUTION.md) defines the association baseline and prerequisites; reuse it. On a checked cohort, no observed critical wrong accepted link and useful match coverage are required, without claiming zero population error.

Rejected or unsupported proposed values remain in the attempt with a reason; do not silently drop them before computing precision/coverage. Verify OCR-derived quotes against the page for the labelled cohort, since matching an erroneous OCR string is not independent evidence. Mapping-token restrictions are specific to the constrained mapping task: numerical source fields and pixel polygons are legitimate outputs in their own checked contracts. Names, overlap and storey-count compatibility retrieve or rank association candidates; they do not alone prove identity or approve a link.

A 3B–8B model is a candidate range, not a promise that every model/context fits an RTX 3070. Inspect exact weight/KV/vision-memory requirements and run one bounded capacity check after selecting the task. Use a CPU reranker/classifier when sufficient. Hosted frontier inference is optional and requires the applicable authorization; it is not a prerequisite or a mathematical upper bound on possible quality.

## Fine-tuning restart conditions

Resume training only when all are true: the task output is consumed by the product; deterministic and pretrained baselines are measured on the same eligible cohort; errors identify a learnable residual; labels and grouped splits support the intended claim; and offline cost/latency/quality gives a concrete reason to adapt the model.

Use learning curves and per-family error analysis to determine data needs. The proposed 300–1,000 labels across five families is a collection target, not a universal threshold. Distillation may produce provisional training examples followed by independent review; it cannot generate its own test truth. Calibrate thresholds on development/calibration data; freeze final evaluation. [Scikit-learn's evaluation guidance](https://scikit-learn.org/stable/modules/cross_validation.html) supports separated model selection and grouped evaluation.

Choose the simplest fitting method for the residual: small supervised classifier/ranker for matching, supervised segmentation adaptation for vision, or standard PEFT/QLoRA for supported structured extraction. Regression applies to a continuous target with valid units/truth. Preference learning or RL requires a reliable preference/reward and a task it improves; it does not repair missing data, citations or geometry. Do not launch several methods in parallel before one measured failure justifies the next.

## Experiment execution

One owner, one pinned reusable environment, one command and one compact result JSON linking source/model/config versions, grouped split, metrics, errors and timings. Reuse cached read-only weights/runtime dependencies; stage only changed code and bounded input. Preserve effective network isolation, resource bounds, originals and canonical access checks. Offline library flags alone cannot establish no egress. Check network behavior when changing the runtime/model loading path, and before integration; do not rebuild the full environment for every loss change.

Reuse the current model manifest/card and established evidence locations rather than introducing parallel `gf-ai`, `gf5` and model registries. Raw candidates and job results may be persisted before review; review controls promotion to canonical records. Run the applicable isolation controls during experiments as well as integration. A file-hash/offline-flag check does not replace the effective boundary, and no experiment should fetch code or model assets implicitly.

If a baseline works, integrate it. If it fails, inspect representative errors and change one principal factor. If truth/coverage is missing, park that accuracy claim and continue the deterministic/API journey. No teacher/orchestrator hierarchy or new reporting framework is needed for this comparison.
