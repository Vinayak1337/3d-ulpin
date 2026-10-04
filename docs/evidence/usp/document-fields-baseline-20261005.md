# D08 — literal document-field baseline, 5 October 2026

**TASK:** Offline, source-linked field proposals on the two retained Haryana PDFs.
**WORKS:** Bounded crop/OCR/model observations feed literal regex proposals, rejected lines and provisional conflict context. Every proposal requires operator review.
**SEE IT:** [Result JSON](E:/BhuAayam-data/task-data/d08-document-field-baseline-20261005/proposals-01/result.json), [S-001 crop](E:/BhuAayam-data/task-data/d08-document-field-baseline-20261005/site-crop-01/upright.png), [complete commands/pins/receipts](E:/BhuAayam-data/task-data/d08-document-field-baseline-20261005/verification.json).
**INPUTS:** Unchanged T3-2 and S-001 originals; retained successful caption OCR; existing pinned Granite Docling and Tesseract runtimes. D04 manual entries are provisional review context.
**GAPS:** No independent quote accuracy, accepted canonical identity/count, ranking/retrieval accuracy, API save, held-out evaluation or model promotion.

## Code and use

Base `f196cd28a7f54471f2d2bdd5a194061dbcf5075c`; code commit `e7e117b04f7f4778d59d25e6efbf08243e4012f0`. Own only this report and `scripts/usp/learning/document_fields_baseline.py`. Primary staging and parked fragment learner remained read-only. Requested GPT-6.1 Sol/xhigh/default-standard 1×; actual model/effort/tier unexposed. Supplied permissions are `never` / `danger-full-access`.

The CLI has four small commands: `render` creates a bounded source crop and native-text observation; `ocr` extracts pinned English Tesseract TSV; `model` compares one crop using the existing Granite helper; `propose` assembles hash-pinned observations. Existing `source-ocr-candidate/1` observations can be reused. The production renderer, external-file admission and gated Windows Job supervisor are reused without edits. No dependencies, shared contracts or services were added.

To reproduce assembly without native imports, choose a **new** private output directory:

```powershell
& E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/venv/Scripts/python.exe -B -I -S `
  C:/Users/kvina/.codex/worktrees/desktop-ifc-api-review/3d-ulpin/scripts/usp/learning/document_fields_baseline.py propose `
  --inputs E:/BhuAayam-data/task-data/d08-document-field-baseline-20261005/inputs.json `
  --output E:/BhuAayam-data/task-data/d08-document-field-baseline-20261005/operator-review-02
```

Open the cited original/crop, inspect the quote and target scope, then make an explicit operator decision through the existing review workflow. The result is **not** a D04 `human_entry` save payload. No canonical building/floor IDs, approved floor count, height, units or rights are inferred.

## Actual observations

Both retained native-text observations are empty; the new S-001 selected region also contains no native text. All proposals remain `not_machine_verified`, `needs_review`, `humanAuthenticated=false`, `independentGroundTruth=false`, with `canonicalMatchState=not_assessed`.

| Observation | Result and limitation |
| --- | --- |
| T3 caption | Reused trial-001 OCR: `TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)`. No repeat caption render/OCR. |
| Granite caption | `TYPICAL FLOOR-02 (13rd , 21st , 30th & 38th FLOOR)`. All four literal ordinal strings agree with retained OCR; punctuation/spacing differs. This is agreement between methods, not independent accuracy. Raw DocTags text is retained; Markdown's `&amp;` serialization is not substituted into the quote. |
| S-001 UNIT DETAIL | Fresh sparse OCR recovers `TOWER 3`, `TOWER 4`, `TOWER 5` and separately cited `G+42` values. Raster-row context is proposed, not adopted identity. Printed spacing `G + 42` is not verified by OCR. |
| S-001 central graphic | OCR emits `T3` and `Grd`, missing the printed `T-3 / G+41`. These are retained outside the literal-field scope; no corrected machine quote is fabricated. |
| Conflict | Original D04 `G+41` / `G + 42` entries and disagreement remain separately attributed provisional context. Two new visual locator proposals cite the central graphic and UNIT DETAIL count through the verified crop affine; they perform no text extraction. The bottom TOWER AREA DETAIL and sheet/title are not covered. |

Output: **16 proposals**, **137 lines outside field scope**, one cross-method literal caption disagreement. These counts are not accuracy metrics. Original URLs, acquisition receipts, source IDs/revisions, original/render/observation hashes, page/ROI/frame/transform and line quotes/spans are retained in the JSON. No link to a canonical target is accepted.

## Sources, model and bounds

- T3-2: 1,630,108 bytes, SHA-256 `2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1`; page 1, 2586×1694 pt, ROI `[1820,750,2130,825]`; retained render 930×225 px.
- S-001: 3,782,332 bytes, SHA-256 `26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9`; page 1, 2585×3390 pt, new ROI `[340,1000,1330,1560]`. Render 1399×791 px; OCR image 791×1399 px after counterclockwise 90° rotation. Source page rotation stays 0. Exact pixel-edge inverse affine is stored, not inferred from rounded dimensions.
- [IBM Granite Docling](https://huggingface.co/ibm-granite/granite-docling-258M/tree/982fe3b40f2fa73c365bdb1bcacf6c81b7184bfe), Apache-2.0, revision `982fe3b40f2fa73c365bdb1bcacf6c81b7184bfe`; all 13 retained model/card files verified. Safetensors: 515,093,104 bytes, SHA-256 `1cdad234deb1cde18ee6a586f849057f19851daf1fedce2e40aff791dbe46f61`. Existing helper/runtime reused; no download or copied upstream implementation. The retained card describes English document conversion, not domain qualification.
- OCR: pinned Tesseract 5.5.1/English, sparse PSM11. Interpreter environment: torch 2.14.0, Transformers 5.17.0, PyMuPDF 1.25.5, Pillow 12.3.0. Model environment: torch 2.5.1+cpu, Transformers 4.52.4; exact package/interpreter pins are in receipts.

Before model execution: CPU2, 6 GiB process/Job limit, 120 seconds, 96 tokens; no GPU. Render/OCR workers: 60 seconds; images ≤1400 px per side/1,600,000 pixels. Whole-page support remains unsupported. The comparison changes the earlier failed USGS-map experiment to a small legible Haryana caption; the old failed crops were not rerun.

## Verification and recovery

| Actual invocation | Exit / measured result |
| --- | --- |
| CLI `render`, S-001 crop | 0; 0.516 s, peak sampled RSS 80,556,032 bytes |
| CLI `ocr`, first attempt | 1 after OCR completed: 143 lines exceeded the initial 128-line parser cap; TSV only 22,074 bytes/190 words |
| CLI `ocr --reuse-tsv`, corrected parser | 0; 0.266 s; same pinned TSV reused, no second Tesseract invocation; line cap now 256, text/byte/image/resource bounds unchanged |
| CLI `model`, first attempt | 1 before model inference: replacing `socket.socket` broke SSL subclass import |
| CLI `model`, corrected network guard | 0; 29.593 s worker / 24.188 s model helper; 48 tokens, no cap hit/parse error; sampled RSS 1,706,803,200 bytes, model-reported peak RSS 1,894,977,536 bytes, Job private peak 2,235,912,192 bytes |
| Private `prepare_and_check.py -B -I -S` | 0; in-memory compile, four-corner inverse-affine proof, changed observation/source hash denial |
| CLI `propose -B -I -S` | 0; real pinned observations and original/manual-context authorities; no doubles |
| Private `network_check.py -B -I -S` | 0; SSL import with guard and socket-connect denial before OS connection. An earlier inline shell control had a quoting SyntaxError and executed no network call. |
| `git diff --cached --check`, code commit | 0 |

Native runs used development source snapshots recorded by physical SHA in each receipt, before the code commit. Subsequent code changes added proposal assembly/context handling; they did not repeat native inference. Final-source checks and pin/result assertions are in `verification.json`. Result JSON: 210,982 bytes, SHA-256 `9fa7f99e52f90d446c3a26c075ebed64d1d539dd930556af91ae77aa632f63d5`; verification JSON SHA-256 `3b2b282182575527598efc6731488c697b3d64a93528fe918238856f8a71c898`.

Existing runtimes/models were used read-only; no installs, dependency/config changes, training, teacher/RL, provider call, API/PG startup, GPU use or source/catalogue mutation. Model loading uses local files, safetensors and `trust_remote_code=False`; offline/telemetry flags and Python socket audit denial are active. No OS-level egress or complete filesystem-write audit is claimed. Each native Job closed and checked its observed children; unrelated processes/services were untouched. Detailed evidence stays in the single private D08 root. The useful next step is operator quote/target review, particularly the missed central count and spacing; this result alone does not justify a fit.
