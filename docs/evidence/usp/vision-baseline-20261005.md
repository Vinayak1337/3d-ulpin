# D07 — existing vision models on the D06 development cohort

5 October 2026. **19/19 inputs completed once; no fitting or promotion.** Evaluator code is `4f8b85986277e58660a8f8e0c175cdd8bc771a0a` plus manifest-field correction `b971365e5f318154674b9bc873f7bc3c0e7edf8f`, from assigned base `6001097704e991a56d5004aee1fc2a9ea62b6f75`. [Evaluator](../../../scripts/usp/learning/evaluate_vision_cohort.py) calls unchanged production loading, preprocessing, inference and polygonization. Shared runtime/model/catalogue files remain read-only.

## Comparison and retained evidence

Accepted D06 cohort: `fdea73d746db7884791076727329edd470bf06b9`, [manifest and guide](../../orchestration/delivery-reset-20261004/VISION_COHORT.md). Twelve CubiCasa plans and seven SpaceNet2 building scenes are known development data. Vegas img1 stays excluded because of its Point label; two empty scenes remain scored. Anonymous plans form one conservative collection; Vegas and Paris are two additional groups. Training/final allocations remain empty.

All private files are under `E:/BhuAayam-data/task-data/d07-vision-baseline-20261005/`. `run-01/frozen-config.json` was written before inference; SHA-256 `2d5ff979436935a99bdbbf38b773358921591d7c3a9f3591647d6bfa0aa21311`. It pins physical execution code, model/profile hashes, cohort, metric rules and environment. `run-01/results.json` retains per-item confusion/count denominators, transforms, class/boundary/object metrics, runtime and output hashes; `compact-metrics.json` is its read-only summary. Each item retains native ONNX outputs, confidence, processing raster/mask, source mask, returned polygons and polygon mask. `run-command.json`, stdout/stderr and `environment-lock.txt` retain execution/setup details; `finalization.json` records final commits and resource state.

Profiles remain CubiCasa `cubicasa-rooms-768-bilinear-pad64-v1` and RF-DETR `rfdetr-rgb432-tile512-stride384-threshold050-mask000-v2`. Floor padding is cropped before comparison; the production argmax mask is transferred by nearest sampling to original source pixels. A separately reported diagnostic bilinearly transfers cropped logits with the production half-pixel helper before argmax. Original class labels are unchanged. Polygons use the recorded pixel-to-source affine and center rasterization; no crop, rotation or metre inference is introduced. Building RGB uses D06's recorded 2nd/98th-percentile stretch and four production tiles per 650×650 scene.

Building `scoringMask==1` applies to both masks and object geometry: **75,338 ignored pixels, zero positive truth pixels there**. All-zero source RGB is a conservative analysis ignore policy, not publisher NoData. Object scoring transforms existing publisher polygon features into source pixels, clips both sides to the valid domain, then uses maximum-cardinality one-to-one IoU ≥0.5 matching, with total IoU tie-break. Partial/small truth features remain. D06 truth masks were not regenerated. Empty-scene undefined foreground ratios remain null; every positive prediction counts as a false positive. No thresholds were swept or new pass target chosen.

## Actual metrics

| Output | Production mask | Returned polygons |
| --- | ---: | ---: |
| Floor pooled per-present-class mean IoU, 20,854,508 pixels | 0.59569 | 0.50863 |
| Floor pixel accuracy | 0.84719 | 0.74180 |
| Building foreground IoU, 2,882,162 scored pixels | 0.51881 | 0.51880 |
| Building foreground precision / recall | 0.56623 / 0.86103 | 0.56622 / 0.86102 |
| Building object precision / recall, 165 truth features | 0.70543 / 0.55152 | 0.71094 / 0.55152 |
| Building matched / false / missed objects | 91 / 38 / 74 | 91 / 37 / 74 |

Building mask counts: TP **291,055**, FP **222,971**, FN **46,976**. Polygons lose five additional true-positive pixels. There are **16 merge candidates** under the declared overlap diagnostic; these are candidates for inspection, not 16 independently confirmed merges.

| Floor class (images with truth) | Mask IoU | Polygon IoU |
| --- | ---: | ---: |
| background (12) | 0.92589 | 0.70817 |
| outdoor (11) | 0.67469 | 0.63363 |
| wall (12) | 0.74093 | 0.01587 |
| kitchen (11) | 0.84811 | 0.84896 |
| living_room (8) | 0.64958 | 0.61101 |
| bedroom (4) | 0.81193 | 0.85528 |
| bath (10) | 0.66095 | 0.66118 |
| hallway (9) | 0.37973 | 0.41651 |
| railing (10) | 0.39636 | 0.39320 |
| storage (8) | 0.57806 | 0.57757 |
| garage (1; weak CarPort alias) | 0.00000 | 0.00000 |
| other_room (10) | 0.48208 | 0.38224 |

Floor logit-transfer diagnostic pooled mean IoU is **0.59675**. The production-mask class boundaries have a pooled symmetric mean distance of **37.35 source pixels** over 992,506 boundary samples; this includes distant semantic false positives, not just contour displacement. Garage has no predicted boundary and one railing-present image has none; those missing cases are reported separately, not assigned a finite distance. Room detection is only a same-class four-connected **component proxy**, because no independent room-instance mask was supplied: raw 70 matched/1,995 false/24 missed versus polygons 67/336/27. Tiny fragments inflate raw counts. This cannot establish legal-unit or publisher room-instance accuracy.

| Development slice | Mask IoU | Polygon IoU |
| --- | ---: | ---: |
| Colorful plans, 4; pooled present-class mean | 0.55819 | 0.50434 |
| High-quality plans, 4; pooled present-class mean | 0.85229 | 0.74969 |
| Architectural plans, 4; pooled present-class mean | 0.57837 | 0.47283 |
| Vegas buildings, 3; foreground | 0.78541 | 0.78538 |
| Paris buildings, 4; foreground | 0.41101 | 0.41101 |

## Inspected errors and next decision

Five retained `*--error.png` sheets were inspected against unchanged source images and publisher truth. Correction effort below means observable review actions; no human editing time was measured.

- **Architectural plan 333:** room class/boundary discrepancies remain; large wall and outdoor regions disappear in the final polygons. Mask mean IoU 0.69427 → polygons 0.52051; two complex components omitted and 148,021 foreground pixels removed. A reviewer must recover missing context, not merely adjust a contour.
- **Colorful plan 9395:** the sole CarPort→garage target is predicted as background; outdoor/other-room and room boundaries are confused. The weak alias is retained as a limitation, not relabelled from predictions. Garage coverage needs more independently annotated examples and a settled class policy.
- **Paris img10, empty truth:** the road/embankment becomes one building polygon with **103,326 false-positive pixels**; it requires rejection. Vegas img1002, the other empty scene, has zero predicted objects/pixels. Empty-scene FP rate is **1/2** on this tiny diagnostic set.
- **Paris img100:** expanded/connected candidates agree with only 9 of 27 truth objects: 12 false candidates, 18 unmatched truth objects and four merge candidates; foreground IoU 0.49510. Review requires rejection, additions and separation, with operations potentially overlapping.
- **Vegas img10:** foreground IoU 0.75115; returned polygons match 23/28 truth objects, with two false candidates and five unmatched truth objects. Even this stronger scene still needs source review.

**Decision: reuse both models as reviewed proposals without fitting; address the observed floor polygonization loss first.** Across plans, production limits omit 1,992 small, 25 complex and 16 capacity components; 3,025,811 source pixels change between mask and polygons. Wall IoU collapses from 0.74093 to 0.01587. A separate production assignment should retain useful complex wall/room context through a bounded, geometry-preserving representation and measure its fidelity against these retained masks; this task makes no shared fix or limit relaxation. Building polygonization is nearly lossless here; its road false positives, missed small structures and touching-roof unions are model/instance-postprocessing gaps. Preserve review/rejection and measure a justified correction on development data before contemplating adaptation.

Any later adaptation needs independently reviewed negatives (roads, vegetation, empty scenes), touching/small-roof instances and intended Indian imagery/plan conventions, with site/template groups and a new eligible final cohort. Do not finish the parked fragment-support training as a response to these vision errors. Current D07 mask and polygon outputs provide the comparable frozen baseline for a separately authorized correction. Historical [T061](../t061/models/evaluation.md) two-plan IoU 0.65622 and twelve-OAM-tile building IoU 0.28738 used different cohorts; these numbers do not establish an improvement or regression in generalization.

## Execution, checks and limits

No existing inspected environment contained ONNX Runtime with the required GIS stack. A single reusable isolated CPython **3.12.14** environment was created at private `env`; only dependency wheels were installed, no model bytes downloaded/copied or runtime tree staged. Native versions: ONNX Runtime 1.19.2, NumPy 2.0.2, Pillow 11.2.1, rasterio 1.4.4, Shapely 2.0.7, SciPy 1.14.1, psutil 7.0.0. Full resolved dependency versions are retained in `environment-lock.txt`.

- `uv pip install --python <private env/Scripts/python.exe> numpy==2.0.2 Pillow==11.2.1 onnxruntime==1.19.2 rasterio==1.4.4 Shapely==2.0.7 scipy==1.14.1 psutil==7.0.0`: exit 0.
- `<private env/Scripts/python.exe> -B scripts/usp/learning/evaluate_vision_cohort.py check`: exit 0; focused scoring-ignore, one-to-one merge/empty matching, undefined ratios and source-affine controls passed.
- Initial `freeze` exited 1 on the incorrect `exclusions` key, before any inference/config publication; corrected to D06 `excludedItems`. Corrected `freeze`: exit 0; exact arguments match `run-command.json` with action `freeze`.
- `<private env/Scripts/python.exe> -B <private root/run_once.py>`: exit 0. Child command/identity retained in `run-command.json`; **19 inputs / 40 ONNX calls**, CPUExecutionProvider only, intra-op 2/inter-op 1. Run body **64.18 seconds**, launcher **65.28 seconds**, sampled peak RSS **1,184,280,576 bytes (1.10 GiB)**. Ceiling 6 GiB / 900 seconds; outer timeout 915 seconds. Timings include native output compression/retention and diagnostics, not an isolated inference latency guarantee.
- Read-only `inspect_results.py`: exit 0; no second model inference. Cached/final owned diffs pass `git diff --check`; finalization retains exact final command outcomes and output hashes.

All owned inference processes finished; sessions were released. No GPU, training, teacher/provider, DB/service, final holdout, API/UI modification or automatic recording occurred. The original dirty learner worktree is untouched and retains its two parked edits. Requested Sol 6.1/xhigh/default standard 1×; actual turn model/effort/tier is unexposed. Provided permissions were `never` / `danger-full-access`.

These foreign research annotations are independent of predictions but complete training/site/template overlap is uncertain; CubiCasa validation informed checkpoint selection and RF-DETR training-scene lineage is incomplete. No Indian, survey, cadastral, legal-unit, placement, measured-area or release claim follows. CubiCasa dataset CC BY-NC-SA 4.0 and code CC BY-NC 4.0 remain distinct; SpaceNet2 CC BY-SA 4.0 and the retained RF-DETR model attribution/terms remain linked by D06 and the pinned manifest. No model promotion threshold was manufactured.
