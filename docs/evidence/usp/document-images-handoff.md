# DOC-IMAGE-01 — private retained PNG/JPEG inspection

**Lead integration, 1 October:** code `8d67f3d`, handoff `52e36d6` and review `691ec98` accepted at code/local-render scope. Lead matched reviewer receipt SHA `04104541401fe0bc4b850fd5d3ff317141539e27960a2f78d7c4091d4cad69f9` and 109 physical pins including primary/delivery receipts. Integrated four service checks, one no-listener Nest check, three Python image controls and backend typechecks pass (all exit 0). Retained native renders are reused. Contract export/API publication is lead-owned; actual source-bound HTTP/current access stays pending Docker recovery. Resource, calibration, egress and all scientific qualification limits below remain unchanged.

1 October 2026. Code checkpoint `d8ab6ec763a2951e1cb9b4c5c5b49165cd84feab`, branch `task/desktop-private-document-images`, exact dispatch `8c50f88e1adcf123ee0f5d885f087ad62ca9534f`. Assigned worktree: `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`. The former PDF branch remains at `4f81f09f435d0bf5c8d6901ed98b1cf94c9791e6`; branch-transfer evidence confirms unchanged physical bytes for both pre-existing CityJSON EOL/status entries and retention of `.pnpm-store/`. No reset, stash or deletion occurred. Primary staging stayed read-only, observed at `142905fa76a6a32b0fab3ce49ff635d43de1b097` during closure.

Private receipt: `E:/BhuAayam-data/task-data/desktop-document-images/verification-pins.json`, 52,573 bytes, SHA-256 `04b4a5683092db70f6320ab3ca36f0a51de1fb0624b440d6de5aab8f36322256`. It records nine owned code files, 33 preserved code files, 33 evidence artifacts, 16 runtime/dependency files, unchanged originals, source context and physical versus Git-normalized bytes. Final local output is `final-render/local-render.json`; initial pre-density outputs are preserved separately. No new source acquisition occurred.

## Additive private API

```text
GET /api/v1/sources/{sourceId}/image?revision=1&sha256=<64-lowercase-hex>
GET /api/v1/sources/{sourceId}/image/raster?revision=1&sha256=<64-lowercase-hex>
```

Exact current source UUID/revision/original hash are required. The server resolves the original object key and configured interpreter; caller paths/URLs, unknown fields and duplicate query values are denied. The service reuses canonical `documentSourceTx`/`assertIngestionBinding`, original receipt/subject/family/access checks, bounded object streaming, private scratch ACL, bounded artifact reads and the existing gated supervisor. Read-only deadline-bound authority checks occur before I/O, after original read and after decode, with exact authority comparison before response. No source, job, registry or persisted derivative authority is written. `PrivateSpatialGuard` and the application's existing private loopback/origin boundary apply.

Metadata `document-image/1` returns exact source/case revisions, original hash/bytes/name, native format/mode/frame count and `image_source_top_left_pixels` dimensions. EXIF orientation preserves `exifValue:null` when absent, versus an explicitly supplied value 1–8. `applied:1` with `provenance:"specification_default"` is a declared default interpretation, not source evidence of an orientation tag.

`densityDeclarations` is empty when absent and otherwise retains bounded raw PNG pHYs, JPEG JFIF or EXIF resolution unit codes/rational values. Incomplete/unknown declarations are `unsupported`; no EXIF resolution unit or DPI is defaulted. Every declaration is `not_calibrated`, and top-level **`calibration:null`** remains fixed. JFIF unit 0 is an aspect ratio declaration, not a physical measurement. These declarations never change display geometry, measurement or recording.

For supported display, metadata includes `image_display_top_left_pixels`, output mode, exact `sourceToRaster:[a,b,c,d,e,f]`, `coordinateConvention:"pixel_edges/1"`, resampling and a pinned relative raster URL. The transform is `rasterX=a*sourceX+b*sourceY+c`, `rasterY=d*sourceX+e*sourceY+f` in top-left pixel-edge frames. Orientation 1–8 is applied explicitly; downscaling uses actual integer dimensions and separately observed X/Y ratios. Locator is `original_image`, frame 0. No PDF boxes, arbitrary EXIF/GPS blobs, URLs, geographic/metric quantities or OCR are exposed.

Display pixels are `encoded_samples_unmanaged`: no colorimetric qualification or ICC conversion is claimed. Embedded ICC, declared non-sRGB profile and unsupported pixel modes retain metadata with `display:null`, an explicit `unsupportedReason`, and `url:null`; raster is refused. Supported modes are RGB/RGBA/L/LA/P/1, with palette/alpha conversion explicitly reflected in the display mode. Other image formats and multiframe files are refused rather than returning a silently selected first frame.

Raster is a bounded metadata-free PNG with `private, no-store`, `nosniff`, inline `image.png` and exact Content-Length. Headers provide `X-Source-Revision`, `X-Source-Sha256`, `X-Render-Sha256`, `X-Image-Source-Pixels`, `X-Image-Display-Pixels`, `X-Image-Orientation`, `X-Image-Pixel-Affine` and `X-Image-Pixel-Convention`. Fresh pixels prevent inherited EXIF/GPS/comments/ICC/text from entering the output.

Contract: `packages/contracts/src/document-images.ts`; explicit relative contract imports avoid shared barrel edits. Evidence module and operation manifest registration are additive; existing manifest operations/schema-source prefix are unchanged. **Lead owns contract export, OpenAPI/client/catalogue updates and later exclusive source-bound HTTP/runtime assignment.** IFC-owned cases/privacy/jobs/dispatcher/ingestion and contracts/usp seams, accepted PDF code and old native reader/worker/fingerprint functions were not edited.

Lead publication now includes the contract export, generated OpenAPI/client and four retained test-only source additions across images/KML. The OpenAPI catalogue has 211 operations/244 schemas: only the two image paths and one schema were added, with all previous paths/schemas unchanged. API validation and generated client typecheck pass. No source-bound HTTP execution is inferred from publication.

## Runtime and recovery limits

API profile requires Windows. Configure `ULPIN_DOCUMENT_IMAGES_PYTHON` (fallback `ULPIN_DOCUMENT_OCR_PYTHON`) and `ULPIN_DOCUMENT_IMAGES_SCRATCH` as an absolute private directory outside the repository. No shared config was edited. Native decode runs only in the gated Pillow worker; Node does not decode or fall back to another parser. Child environment is restricted, Python socket APIs are denied, and input is a verified in-memory byte array opened only with PNG/JPEG decoders. Environment/socket restrictions are defense in depth; **OS outbound denial is not implemented or claimed**.

Limits: original ≤16 MiB, source ≤25 million pixels/25,000-pixel sides, single frame, metadata ≤128 KiB; display ≤1,400-pixel side/1.6 million pixels/8 MiB PNG. Pillow bomb warnings become errors, source header bounds precede decoded-pixel allocation, PNG text expansion is bounded, truncated loading is disabled, and no partial raster is published. One image operation at a time per API process, independently of the PDF semaphore; no host-global concurrency claim. Operation deadline is 30 seconds, worker at most 25 seconds, with existing gated Windows Job/process-tree memory bound 2 GiB and two-thread compute environment. Child termination/cleanup is bounded; unresolved process cleanup retains its private attempt and blocks new local image work pending recovery. Owned temporary original/output files are removed after successful or controlled failed attempts.

Missing runtime/private scratch returns controlled 503; unsupported/truncated/oversized decode/profile returns controlled 422 (canonical original byte admission limit is 413); stale source/access context returns 409, private denial 403, occupied local slot 429, and deadline expiry 504. Original bytes remain available through existing private original authority.

## Checked unchanged inputs

| Source | Source metadata and display result |
| --- | --- |
| Retained NYC 2018 tile `ortho-2018-18-77177-98555.png`, 58,129 bytes, SHA `b96b407333edc78a855eeba79dc4d166ee21be88f83a91166a884255ec4e0a5e` | Native palette PNG, 256 × 256; absent EXIF orientation and density; identity display transform, RGB/no resampling; output 120,139 bytes, SHA `80cc1fb68e175e1f1023065032b46a662d3108bfbc3962d6bc47128e2ee0bd6e`; raster worker 0.265 seconds, peak Job private bytes 30,965,760 |
| Retained conda-forge libjpeg-turbo 3.2.0 `info/test/testorig.jpg`, 5,770 bytes, SHA `acc6ec555d41d15b368320edaa3b20958ee6fa97cb6e4a18d1213d5ae8bec73b` | Native RGB JPEG, 227 × 149; absent EXIF orientation; supplied JFIF unit 0 and `[1,1]` X/Y rational densities, not calibrated; identity display transform/RGB/no resampling; output 51,061 bytes, SHA `39014e47402093dfbb2f5af7729a5ee0e7492ac59062d2a2e8afe87c69b6e80c`; raster worker 0.265 seconds, peak Job private bytes 30,887,936 |

NYC original/source lineage is in `E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json`: acquired 27 September, [official tile URL](https://maps.nyc.gov/xyz/1.0.0/photo/2018/18/77177/98555.png8), retained source/service bytes and local development permission scope. It stays foreign `test_only`; standalone image inspection does not qualify tile placement or measurement.

JPEG fixture is an unchanged retained public development input, not official operational data or a PDF derivative. Its test/recipe copies have identical bytes. Package metadata pins `libjpeg-turbo 3.2.0 hfd05255_1`, [feedstock revision](https://github.com/conda-forge/libjpeg-turbo-feedstock/blob/cc922f6dba346613d6c2820d58011f1c6c175e7d/recipe/testorig.jpg), declared upstream archive hash and IJG/BSD-3-Clause/Zlib software terms. Original acquisition timestamp, photographic rights and geography are not independently established; later launch/redistribution clearance stays separate. No new download, operational identifier or learning label was created.

## Verification and return

Final commands all exit 0:

- `pnpm exec tsx --test tests/document-images.test.ts`: four controls covering canonical original subject/case/family/pins, missing/unsupported metadata, post-I/O/decode drift/revocation, caller input denial, source/format/PNG/affine integrity and busy-slot recovery.
- From `apps/api`, `pnpm exec tsx --test src/modules/evidence/document-images.controller.test.ts`: one actual Nest provider/guard/Swagger/query check, without a listener.
- `E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/venv/Scripts/python.exe tests/test_document_images.py`: three technical in-memory controls for all eight orientation-to-pixel mappings and metadata stripping, absent/supplied density/profile semantics, decompression/frame/PNG bounds and truncated/multiframe refusal. These controls are not authored operational fixtures.
- `pnpm typecheck:backend`: server/API pass.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-document-images/verify-local.mts E:/BhuAayam-data/task-data/desktop-document-images/final-render`: actual bounded metadata/raster on each unchanged original, no canonical IDs or authority invented.
- The external `check-native-headers.py final-render` under the bundled Python independently matches literal PNG IHDR/JPEG SOF dimensions, source/render hashes, and verifies output PNG chunks contain only IHDR/IDAT/IEND. No native parent decode.
- Scoped `git diff --cached --check` passes. Both final rasters were visually inspected. Originals rehash unchanged; scratch is empty; process observation found zero `run_image_inspection.py` Python workers. No known blocker was established in the owned-code review.

Reused, unmodified environment: Python 3.12.14/Pillow 12.3.0; Pillow reports JPEG codec 8.0/libjpeg-turbo 3.1.4.1 and zlib 1.3.1.zlib-ng. The fixture's libjpeg-turbo 3.2.0 package is its source lineage, **not** the decoder version. Existing supervisor imports PyMuPDF 1.25.5/psutil 7.0.0; no model loading or execution occurs. Exact executable/native/dependency pins and origins are in the receipt. No installation or global environment/config changes occurred.

This qualifies local original-backed image inspection and no-service controls only. Real source-bound HTTP/current access, canonical image enrollment, metric/geographic/colorimetric/OCR/association accuracy, learning, Indian operational, scale, deployment and release gates remain unrun. No API/DB/Docker startup or actual DB queries, provider/GPU/model calls, new source acquisition, shared service mutation, frontend/generated edits or repeated PDF campaign occurred.

User index remains empty after code commit. Pre-existing dirty paths remain unstaged: both physical CityJSON EOL/status entries and `.pnpm-store/`; exact byte preservation is in branch transfer and final pins. Requested Sol6.1/xhigh/default-standard; actual model/effort/per-turn tier unexposed. Supplied permissions: `never` / `danger-full-access`. Send authorized exact-commit callback to lead `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`, then stop without polling or runtime startup.
