# D06 — runnable vision development pilot

5 October 2026. [vision-cohort.json](vision-cohort.json) contains **12 floor-plan image/SVG/mask pairs and 7 eligible building image/GeoJSON/mask pairs**, plus one retained excluded building pair. All paths are absolute and available under `E:/BhuAayam-data/task-data/d06-vision-cohort-20261005`. No inference, fitting, threshold selection or final evaluation ran. Base: D02 `9060642f13f1232417b032735cd922d1439c7158`.

These are 20 unique original image/label pairs, 19 eligible development inputs, **three conservative leakage groups** and only two known building AOIs. The anonymous plan IDs do not prove 12 independent sites or templates. All CubiCasa relatives are grouped as one collection; all neighboring/building relatives within each SpaceNet AOI stay together. Training and final-evaluation allocations are empty. These inspected items, historical T061 items and closed/retired evaluations must never become a fresh final holdout.

| Route | Actual source and selection | Label provenance / eligibility |
| --- | --- | --- |
| CubiCasa rooms | First four publisher `val.txt` paths per category: architectural, colorful, high quality; 12 PNG/SVG pairs, no historical 1191/2536 inputs | [CubiCasa/Aalto paper](https://arxiv.org/html/1904.01920v1), section 3: trained human annotators plus separate QA; mostly Finnish marketing plans. Independent of predictions, not an independently held-out population. |
| RF-DETR buildings | First four listed SpaceNet 2 PS-RGB training objects each from Las Vegas/Paris, exact matching GeoJSON; 8 pairs retained, 7 eligible | [SpaceNet paper](https://arxiv.org/html/1807.01232v3), section 2.4: expert GIS annotation and separate full QA. Foreign research building outlines, not cadastral or Indian survey truth. |

Terms are separate: [Zenodo record 2613548](https://zenodo.org/records/2613548) metadata specifies **CC BY-NC-SA 4.0 for the dataset**; the pinned repository LICENSE specifies **CC BY-NC 4.0 for code**. Preserve attribution, noncommercial scope and dataset share-alike conditions. [SpaceNet 2](https://spacenet.ai/spacenet-buildings-dataset-v2/) publishes CC BY-SA 4.0. Exact terms, source paper/version, URLs, acquisition timestamps/ETags, archive-member CRCs and SHA-256 pins are retained privately and linked by the manifest. No automatic operational admission or later commercial/distribution clearance is asserted.

CubiCasa's published validation split is absent from the supplied training list, but the upstream workflow uses validation for checkpoint selection; complete installed-weight population and site/template overlap remain unaudited. RF-DETR's pinned card names `merve/satellite-building-segmentation`; its retained dataset metadata identifies a Roboflow export without enough underlying scene lineage to prove disjointness from SpaceNet. Both comparisons therefore remain development diagnostics; do not advertise generalization from these samples.

From this document's directory, load the inputs without invoking a model:

```python
import json, numpy as np
from PIL import Image
m = json.load(open("vision-cohort.json", encoding="utf-8"))
for task in ("floor_plan", "building"):
    for item in m["tasks"][task]["items"]:
        image = Image.open(item["image"]["path"]).convert("RGB")
        truth = np.asarray(Image.open(item["targetMask"]["path"]))
        valid = (np.asarray(Image.open(item["scoringMask"]["path"])) == 1
                 if "scoringMask" in item else np.ones(truth.shape, bool))
        assert image.size == (item["width"], item["height"])
        assert truth.shape == (item["height"], item["width"])
```

**Annotation/transfer guide.** Preserve raw SVG/GeoJSON labels and exact source hashes; PNG masks are deterministic derivatives of publisher annotations, not agent-drawn evaluation labels. Do not fix classes or outlines from a model prediction. Any observed annotation error needs an independently reviewed, versioned correction; retain the original and disposition.

Floor mask IDs match the existing 12-channel runtime. Source coordinates are raw `F1_scaled.png` pixels, top-left/right/down; **do not resize SVG coordinates to its viewBox**. The pinned upstream `FloorplanSVG.get_txt` constructs labels on the scaled PNG's actual dimensions. Preserve original g order, room aliases, rounding and small-wall exclusions. No page crop or rotation was introduced. Publisher `Undefined`/`UserDefined` map to other_room; class 0 is background, not an ignore label. No new subjective ignore regions were added.

| ID | Class | Images with pixels |
| --- | --- | --- |
| 0 | background | 12 |
| 1 | outdoor | 11 |
| 2 | wall | 12 |
| 3 | kitchen | 11 |
| 4 | living_room | 8 |
| 5 | bedroom | 4 |
| 6 | bath | 10 |
| 7 | hallway | 9 |
| 8 | railing | 10 |
| 9 | storage | 8 |
| 10 | garage | 1, from publisher CarPort alias |
| 11 | other_room | 10 |

All classes occur, but this is weak per-class/site coverage. Furniture/icons, legal units, shafts, floor identities, metric areas and Indian plan conventions are not separate qualified targets. One plan depicts multiple levels; its whole source remains one item/group, never multiple independent floors.

Building masks use publisher polygons, clipped at the exact 650×650 raster, with holes and partial buildings preserved and no minimum-area filtering. CRS84 longitude/latitude maps through the source GeoTIFF's EPSG:4326 PixelIsArea affine to pixel centers. The unchanged uint16 TIFFs remain retained; runnable RGB PNGs use an explicit per-band 2nd/98th-percentile stretch, without spatial resampling. Stretch values and pixel/world affine are per-item pins, not measurements or placement qualification.

Two eligible label files have no building features; keep those negative scenes. Vegas `img1` contains a Point at feature index 10 among polygons: retain the original pair and exclude the entire image from binary scoring. Do not invent its missing boundary or treat that location as background. The minimum recovery input is a publisher polygon correction or an independent expert's source-image boundary review under an agreed annotation policy.

Use `scoringMask == 1` for building comparisons. All-zero source RGB pixels are conservatively ignored; these TIFFs declare no GDAL_NODATA value, so this is an explicit analysis mask rather than authoritative missing-data truth. Report ignored pixels and positive labels within them, both recorded per item. Preserve this policy across baseline comparisons. Model confidence is uncalibrated; label agreement does not prove legal or survey accuracy.

**D07 handoff:** load the manifest and existing pinned models/profiles; use production preprocessing/polygonization and retain the actual processing-raster/source-pixel transform. Compare in a declared common pixel frame rather than scaling label integers with bilinear interpolation. Score by task/class/AOI, keep false positives on the two empty scenes and omissions visible, and inspect correction effort on development data. D06 provides no numerical promotion threshold or final-set claim; freeze the intended comparison before inference.

**Verification:** both acquisition commands completed with exit 0. ZIP byte ranges retained only selected members, not the 5,469,495,706-byte archive. Total recorded downloads, including metadata and private reference wheels, were 43,894,674 bytes; initial E: free space was 659,662,065,664 bytes. Source/mask integrity and 19 pixel-for-pixel comparisons against scikit-image 0.25.2 polygon rasterization passed (`validate_cohort.py`, exit 0). This checks label transfer only, not model quality or full upstream House heatmap/icon parity. A multilevel-plan/occupied-building overlay was inspected as an agent sanity check, not new independent truth.

Detailed receipts/code hashes: manifest `verification` and private `validation.json`. The initial derivative attempt stopped on the genuine Point geometry (exit 1); exclusion resolved it. The public scikit-image wrapper needed absent SciPy (exit 1); its retained compiled polygon function imported directly with existing NumPy (exit 0), without a global installation. Private wheels/source helpers are retained solely for reproducible label transfer; no model trees were duplicated or changed. All owned processes finished; no GPU, provider, DB or service was used. Permissions were turn-supplied `never` / `danger-full-access`; Sol 6.1/high and standard 1× requested, actual per-turn metadata unexposed.

**Integration/gaps:** add the two test-only research slices and current terms distinction to the existing catalogues using the manifest's `catalogueUpdateRequests`; D06 did not edit shared catalogues or task-board files. Indian applicability needs independently reviewed Indian imagery/plan annotations and a settled DATA-07 gate policy; RERA training rights remain unresolved, and no RERA/provisional teacher labels enter this cohort. Protected evaluations, original files and teacher checkpoint `36102c8477bb11d34066f912ae1b0511bb53ab16` remain untouched.
