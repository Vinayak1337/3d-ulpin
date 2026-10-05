# D07 Karnataka — unchanged RF-DETR baseline

5 October 2026. **24/24 chips completed once; no fitting or promotion.** All chips belong to one open-development group, Maxar scene `104001002CA32300`. The 19 positive and five empty-labelled chips contain 178 publisher rooftop features and 181,259 positive pixels over 1,572,864 scored pixels. These are one source project, not 24 independent projects or 178 established physical buildings.

[Result and exact receipts](building-ramp-baseline-20261005.json) pin the accepted source `addbf239`, reservation published at `2f33940f`, pre-prediction freeze, unchanged production model/profile, execution code and retained outputs. The narrow [adapter](../../../scripts/usp/learning/compare_building_ramp.py) reuses the existing D07 evaluator and `spatial_ml.py`; neither was changed. Private evidence is under `E:/BhuAayam-data/task-data/d07-karnataka-baseline-20261005/`.

| Metric | Raw mask | Final polygons |
| --- | ---: | ---: |
| Rooftop IoU | 0.44838 | 0.44837 |
| Pixel precision / recall | 0.84666 / 0.48801 | 0.84665 / 0.48800 |
| Pixel TP / FP / FN | 88,456 / 16,021 / 92,803 | 88,455 / 16,021 / 92,804 |
| Matched / false / missed publisher features | 62 / 37 / 116 | 67 / 43 / 111 |
| Object precision / recall | 0.62626 / 0.34831 | 0.60909 / 0.37640 |
| Merge candidates | 11 | 8 |

Objects use unchanged maximum-cardinality one-to-one IoU ≥0.5 matching, with total IoU breaking ties. Raw connected mask regions and final instance polygons differ as object representations even where their binary masks agree. Polygonization changes one pixel, with one small component omitted and zero complex/invalid/capacity omissions. It does not explain the low rooftop recall.

One of five empty-labelled chips has one predicted object/1,106 pixels; four have none. Inspection of three cached source/truth/prediction sheets shows a missed tiny rooftop, substantial omissions among 11 published rooftops, and an empty-labelled chip where the prediction overlaps a visible roof-like structure. That last case is scored FP against the retained label, with annotation completeness unresolved. Labels were preserved; no new truth or relabeling was produced.

The scoped suitability preflight reuses the accepted publisher-human annotation, source integrity, decoded-RGB and affine/raster-registration receipts. Scoring uses the full 256×256 frame and exact EPSG:4326 angular affine. Missing publisher ignore/ambiguity metadata, 23 boundary-crossing rings, the 30/40 cm metadata conflict, unknown model pretraining overlap and CC-BY-NC-4.0 conditions remain explicit. Attribution: DevGlobal RAMP Karnataka v1.0 (2022), DOI `10.34911/rdnt.5y2w17`; imagery Maxar ODP; TaQadam/B.O.T annotations and DevGlobal review. No cadastral, physical-identity, independent generalization or release qualification follows.

Execution: unchanged RF-DETR `rfdetr-rgb432-tile512-stride384-threshold050-mask000-v2`, 24 CPU native calls, worker 35.438 s, maximum item 1.729 s, sampled RSS 519,913,472 B and peak Job private memory 617,201,664 B. Existing gated Windows Job enforced 6 GiB/1,200 s; two-CPU affinity and per-item 120 s watchdog applied. Tested Python DNS/TCP/UDP/subprocess denials supplement offline flags; OS/native egress audit is unrun. Both freeze/run commands and cached artifact verification exited 0; 168 output pins passed. Two pre-prediction failures remain retained: optional NumPy subprocess denial exception, then planned reservation metadata advance. Neither produced predictions. The final adapter also corrects the child interpreter bytecode flag; exact executed code and incidental import caches remain preserved, without inference replay.

**Decision:** retain reviewed source-pixel proposals and this baseline. A contour change cannot recover absent predictions. Any separately authorized adaptation needs label-completeness/ambiguity work and independent grouped comparisons first. The worker/Job exited, all owned children are gone, and GPU/runtime/database/provider resources were not acquired. Staging/shared allocations remain with the integrator; historical experiments and checkpoints were preserved.
