# D07 Karnataka recall — one cached confidence comparison

5 October 2026. **Recall improved with a precision/review cost; production stays unchanged.** All 24 open-development chips were compared once from the retained complete pre-filter query arrays. No new native model call, fitting, baseline rerun or final evaluation occurred. One scene/group contains 19 positive and five empty-labelled chips, 178 publisher rooftop features and 181,259 positive pixels.

The proposed tile256/stride192 change was rejected before execution: production already uses one unpadded256×256 tile, resized432×432 (scale1.6875), for every source. It would produce the same tensor. Two cached missed-roof cases instead exposed useful masks below the object-confidence cutoff: one unmatched rooftop had query confidence0.3322/pixelIoU0.80794; many others, including the tiny missed roof, had much lower scores. This supports a bounded filtering hypothesis, not a complete explanation of model errors.

One isolated experiment, `rfdetr-cached-confidence030-mask000/1`, changed cutoff **0.50→0.30**. The float confidence filter is [documented upstream](https://rfdetr.roboflow.com/latest/reference/rfdetr/);0.30 is our single development choice, not an upstream satellite recommendation. All200 cached queries,432 input/108 masks, mask-logit cutoff0, stable descending confidence painting, source transforms/labels/full-frame scoring, component limits and existing matching stayed fixed. [Result/receipts](building-ramp-recall-20261005.json) pin the hypothesis and numerical decision before replay. Original397474d6 baseline/freeze/results/raw arrays remain unchanged.

| Metric | Baseline0.50 | Cached0.30 |
| --- | ---: | ---: |
| Mask IoU | 0.44838 | 0.49711 |
| Mask precision / recall | 0.84666 / 0.48801 | 0.77982 / 0.57827 |
| Final polygon matches / false / missed | 67 / 43 / 111 | 87 / 75 / 91 |
| Final object precision / recall | 0.60909 / 0.37640 | 0.53704 / 0.48876 |
| Empty-labelled FP scenes / pixels | 1/5 / 1,106 | 2/5 / 4,817 |
| Polygonization changed pixels / small omissions | 1 / 1 | 266 / 127 |

The frozen decision required increased mask recall and more than67 final matches, with baseline precision, empty-scene and capacity costs exposed. Those recall conditions passed, but precision decreased and a second empty-labelled scene gained a terrain-like candidate: **recall_gain_with_cost**. Cached inspection also shows a new road-strip candidate; the earlier empty-labelled roof-like ambiguity persists. Labels remain unchanged. Raw binary connected objects score67/54/111 versus final instance polygons87/75/91; these representations differ. Capacity/complex/invalid omissions remain zero.

The existing audited AppContainer route is restricted to Qwen roles/staged scopes; no compatible verified RF-DETR native boundary was established. No fresh inference or global/runtime/ACL change was attempted. Cache-only model/session/weight hooks fail closed. Existing Job/CPU guards and Python denials are resource/supplementary controls, not OS/native egress qualification.

Replay exited0:3.078s worker, maximum item0.146s, sampledRSS108,486,656B/Job179,073,024B under CPU2/6GiB/1200s/120s bounds. Freeze, diagnosis and verification exited0;120 output pins,24 native input pins, source-frame identity, unchanged confidence/painting AST except the declared cutoff and fail-closed hooks passed. A verification-only qualified-helper AST normalization was corrected without replay. Private `E:/BhuAayam-data/task-data/d07-karnataka-recall-20261005/` retains per-item metrics/deltas, masks/confidence/polygons, comparison sheet, config and receipts.

Do not promote the lower cutoff: it adds20 matches alongside32 false polygons and more small fragments. Any further task must address intended review costs and label completeness/ambiguity. One scene, unknown training overlap, publisher-human rather than local audited truth, missing ignore metadata, boundary truncation,30/40cm conflict, exact angular frames and CC-BY-NC4.0 restrictions remain. No physical identity, cadastral rights, independent generalization or release claim. All workers/Jobs exited; no GPU/runtime/database/provider resources remain owned.
