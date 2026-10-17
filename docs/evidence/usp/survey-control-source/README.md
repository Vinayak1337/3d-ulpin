# DATA-CONTROL-02 — retained survey tables and precise frame prerequisite

Prepared 4 October 2026 from publication `91ad25d2e6b734d3a08c0815d6ba016e7e411454`, exclusive `task/desktop-survey-control-source` in `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Mixed-packet checkpoint `task/desktop-mixed-evidence-pdf@ac06f87a` is preserved; staging is read-only. Requested GPT-6.1 Sol/high/default-standard; actual per-turn model/effort/tier are unexposed. Current supplied permissions are never/danger-full-access.

## Actual source acquired

The [fixed Zenodo deposit](https://doi.org/10.5281/zenodo.17236055), published 30 September 2025, credits David White, Joseph (Heath) Harwood, Justin Shawler and Brian Harris with USACE/ERDC affiliations. Its declared licence is **CC BY 4.0**. This is retained institutional/research development evidence, not an independently authenticated federal operational publication or Indian property source.

Unchanged originals are in `E:/BhuAayam-data/task-data/desktop-survey-control-source-20261003/originals/`; [manifest.json](manifest.json) pins their issuing URLs, actual acquisition times, bytes, hashes, attribution and exact archive-entry lineage. No imagery, cloud or elevation model was downloaded.

| Retained artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `accuracy-reports.zip` | 36,256 | `54ec53234550ca102ca37be5a2e4e0fc130ebe23c04b20c826913f12bb6f0480` |
| `20250722_capemay_nva_report.txt` | 44,314 | `dfcd0e1fa9030dcdd0b8d9990cf257fe1e8154e73dbd1ff23d1f39c6747e8a0e` |
| `20250722_capemay_pid_report.txt` | 6,458 | `6a185639d8775640a5103136f536b345bc886560a5baef0ef19a5d529740aff2` |

The genuine whitespace tables contain **166 NVA points** (164 enabled, two `Turned Off`) and **17 PID points**. Each has 19 fields; `Description` contains the original `gs_###` survey ID, while `Name` is a report ordinal. NVA header/data lines are **337 / 338–503**; PID **82 / 83–99**. All NVA horizontal measurements are literal `-----`; numeric zeros and excluded rows remain distinct. These are not application records.

## Acquisition, roles and remaining prerequisite

The source describes Leica GS18 RTK rover/static-base surveys, OPUS base refinement and Leica Infinity adjustment in **NAD83(2011)** with **GRS80 ellipsoidal heights**. For 2025 imagery it explicitly says GCPs were used only for post-mosaic QA/QC. NVA points are surveyed hard flat surfaces; PID points are surveyed checkerboard centers with image-selected horizontal counterparts. Source report withholding summaries differ: **166 of 166 NVA**, **0 of 17 PID**. Preserve those statements without inventing a fit/evaluation split or interpreting PID withholding as proof of fitting. Shared GNSS error correlations and per-point lidar fitting history are unestablished.

**The exact metre report projection remains missing.** Reports declare horizontal/vertical `meter`, but give no WKT/EPSG, projection or table-specific vertical reference. Metadata describes final products in NAD83 State Plane New Jersey FIPS 2900/NAVD88 **US survey feet**, with Vdatum conversion after comparisons. That final-product declaration cannot be assigned to the metre report coordinates. Do not infer UTM/zone from numeric ranges. Filename date `20250722` also differs from the narrative's July 20th collection date; exact survey epoch remains unresolved.

A usable application comparison still needs the source-backed working CRS/height linkage and an actual corresponding same-site model with reviewed point correspondence. No source-traceable adapter or current supported `native-point-control/1` original exists here. Future mapping must retain original file/hash/line/span, original IDs, units and exclusions; `Surface Z`/`Measured X/Y` are product comparisons, not survey truth. Source residuals and RMSE are published results, not application accuracy.

## Bounded checks and handoff

The retained catalogue/ledger supplies no usable survey table; DATA-06 remains pending. D1 EPSG/3DBAG research was reused without repeating it. Three leads were checked: the previously named ODM source, USGS public discovery (ScienceBase 403; no bypass or absence claim), and Zenodo institutional/research metadata. An actual five-row Helenenschacht community GCP table has unresolved vertical/projected frame and checkpoint role; it remains discovery evidence. The selected Cape May tables change the gap by supplying real surveyed coordinates and methods in a separate foreign `test_only` family; they are never attached to D1 or Indian records.

PowerShell/.NET text inspection exits **0**: publisher ZIP bytes/MD5 match; selected extracted entries match archive bytes; all source IDs/schema/counts and the exact QA-only statement pass. Private `inspection.json` and `discovery-receipt.json` retain locators, representative literal rows and checked URLs. No build/typecheck is needed for source-only evidence. The private `completion-receipt.json`, created after this documentation commit, pins the final commit and artifacts.

No production/catalogue/config/code, original history, native/model/GPU/held-out/provider, services or operational records changed. Writers are closed and no owned process remains. Report-frame mapping, comparison, independent absolute accuracy, geometry admission, learning, GF/release and deployment remain **unqualified**. Return this specific source prerequisite once through the standing authorized lead callback; end without polls, schedules or extra agents.
