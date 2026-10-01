# DOC-IMAGE-01-R — private document image review

**No actionable finding established.** Recommend accepting the scoped PNG/JPEG inspection code and retained local-process evidence. Actual source-bound HTTP/current-access execution and API publication remain lead-owned and unrun in this review.

## Scope

- Review dispatch / observed read-only staging: `4f6ca13858823c9453ca14854aa81ed81a2700f1`, `PARALLEL_20261001D.md`.
- Implementation dispatch: `8c50f88e1adcf123ee0f5d885f087ad62ca9534f`.
- Code: `d8ab6ec763a2951e1cb9b4c5c5b49165cd84feab`; handoff: `1ec741413babb343466a213d1d4f0aa081ff7f84`.
- Reviewed all nine changed code/test files plus the handoff, relevant source index/catalogue, canonical document authority and accepted PDF supervisor evidence. The delta is ten files including the handoff.
- Exclusive reviewer checkout: `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-document-images-audit`. Completed model-egress branch `8a7b383` remains preserved. Production/candidate checkouts, originals, historical receipts and dirty byte markers were not edited.

## Conclusions

**Source authority and privacy.** Exact UUID/revision/SHA pins enter the existing `documentSourceTx` authority. It checks current case/archive/access binding, source case/family, original receipt subject, length/hash and latest family revision. The image adapter restricts formats and original size, fingerprints complete authority, streams and verifies original bytes, then reauthorizes after I/O and after decode before returning. Object keys and configured paths remain server-side. Both routes retain the private guard, strict queries, duplicate-value rejection and no-store responses. No source/job/registry/derivative record is written.

**Frames and declarations.** Source dimensions/mode remain distinct from display dimensions. EXIF absence yields `exifValue:null`; specification orientation 1 is labelled separately. The eight explicit pixel-edge affine matrices agree with the Pillow transpose operations. Resize uses the actual integer output dimensions and separate X/Y ratios, preserving the stated edge-coordinate convention. The saved technical test verifies all eight mappings against actual pixels; it was reused. Density values come from literal PNG pHYs/JPEG JFIF/EXIF declarations, without substituting Pillow's derived/default DPI. Unsupported or incomplete density declarations stay unqualified, and calibration is always null.

**Decode and output.** Header bounds precede decoded pixel allocation; PNG/JPEG are the only allowed decoders. Single-frame, 25-million-pixel/25,000-side, decompression-bomb, truncated-input, text-expansion, output-side/pixel/byte and metadata limits are explicit. Unsupported ICC/non-sRGB declarations and pixel modes preserve metadata with null display/URL, while raster requests refuse them. The helper decodes verified in-memory original bytes. Fresh RGB/RGBA pixels prevent inherited EXIF/GPS/text/comments/ICC from entering the display PNG. Parent validation checks source format/hash/length, dimensions, affine, PNG signature/IHDR, complete PNG length/hash and result/receipt agreement before publication. Failure cannot publish a partial raster through the API.

**Process and cleanup.** Native decoding runs after the unchanged `_run_worker` import gate attaches its Windows Job. Accepted source/scratch/artifact helpers and supervisor are byte-identical to the PDF candidate already reviewed. The outer timeout stops the owned tree; unresolved process cleanup retains the attempt and blocks subsequent image operations. The busy slot releases in `finally`; completed success/failure cleans the owned private directory. This is one image operation per API process, independent of the PDF semaphore, not a host-wide or combined PDF/image budget.

The nominal operation deadline is 30 seconds, native worker at most 25 seconds with reserved cleanup time; exceptional termination has finite grace. The 2 GiB bound applies to the native worker tree, not total API/supervisor memory. The supervisor imports existing fitz/Pillow-related code before the worker Job but performs no caller-image decode there. Compute environment settings are not an OS thread ceiling. Python socket replacement/offline flags are defense in depth, **not OS outbound denial**. No new client-disconnect cancellation or general image-format/colorimetric qualification is inferred.

## Evidence reconciliation

Matched primary `E:/BhuAayam-data/task-data/desktop-document-images/verification-pins.json`: **52,573 bytes**, SHA-256 `04b4a5683092db70f6320ab3ca36f0a51de1fb0624b440d6de5aab8f36322256`, and its separate `delivery-pins.json`/handoff relationship.

Read-only standard-library reconciliation passed **119 physical references / 107 distinct files**, **42 Git pins** (nine owned, 33 preserved), delivery handoff bytes, runtime/dependency/source/artifact pins and saved output relationships. Physical/Git line-ending distinctions remain recorded without normalization. The preserved PDF supervisor, canonical document authority and private OCR scratch/artifact helper match their accepted PDF-candidate bytes.

| Unchanged input | Independently confirmed saved raster |
| --- | --- |
| NYC PNG, 58,129 bytes; SHA `b96b407333edc78a855eeba79dc4d166ee21be88f83a91166a884255ec4e0a5e` | Literal IHDR 256 × 256; absent EXIF and density; identity affine. PNG 120,139 bytes, SHA `80cc1fb68e175e1f1023065032b46a662d3108bfbc3962d6bc47128e2ee0bd6e`. |
| libjpeg-turbo fixture JPEG, 5,770 bytes; SHA `acc6ec555d41d15b368320edaa3b20958ee6fa97cb6e4a18d1213d5ae8bec73b` | Literal SOF 227 × 149; absent EXIF; JFIF unit 0, X/Y 1:1 (not calibrated); identity affine. PNG 51,061 bytes, SHA `39014e47402093dfbb2f5af7729a5ee0e7492ac59062d2a2e8afe87c69b6e80c`. |

Both saved metadata/raster observations match the original pins and each other. Independent PNG chunk/CRC inspection finds only IHDR/IDAT/IEND in the outputs. Saved raster workers report gated starts, exit 0, no stop reason, 0.265 seconds and peak Job private bytes 30,965,760 / 30,887,936, within their stated bounds. This review did not decode the images again.

Reused and rehashed logs: four service controls, one no-listener Nest control, three Python pixel/metadata/bounds controls, backend typechecks, two unchanged-original local renders and the literal-header checker all record exit 0. These service controls use doubles; they do not qualify real SQL/HTTP access behavior. Initial pre-density results and the final correction remain separate. Saved cleanup records state empty scratch and zero owned image workers; no live process survey or repeated campaign was needed.

Reviewer command `C:/Python313/python.exe -I -S E:/BhuAayam-data/task-data/desktop-document-images-review/reconcile.py` exited **0**, using hashes, Git bytes and literal headers only. New private `reconciliation.json`: **48,400 bytes**, SHA-256 `04104541401fe0bc4b850fd5d3ff317141539e27960a2f78d7c4091d4cad69f9`. No concrete unresolved concern warranted a fresh native reproduction.

## Qualification and handoff

The NYC source remains foreign `test_only`; standalone pixel inspection does not establish geographic placement. The unchanged conda-forge libjpeg-turbo 3.2.0 test fixture remains an upstream development example with unestablished photographic rights/acquisition date/geography. Its package version is source lineage, distinct from the actual Pillow 12.3.0 decoder's libjpeg-turbo 3.1.4.1. No operational, measurement, OCR, association, colorimetric, learning, Indian-data, scale or release qualification follows. Later source/catalogue/API publication and launch clearance remain separate work.

Requested Astra/xhigh/default-standard; actual model/effort/per-turn tier are unexposed. Supplied permissions are `never` / `danger-full-access`. No services, SQL, HTTP listener, Docker, model/GPU/provider, external request, new source acquisition, frontend, dependency/config or production change occurred. Only this report is committed; private review evidence stays outside Git. Return the exact report commit to the lead and stop.
