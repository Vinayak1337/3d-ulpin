# DOC-PAGES-01 — private original-backed PDF pages

**Lead integration, 1 October:** code `d8ba409`, handoff `64a2fba` and review `56d339b` are accepted at code/local-render scope. Reviewer receipt and 25 additional physical pins match the prior lead reconciliation. Six integrated service checks, one no-listener route check, two Python external-resource controls and backend/client typechecks pass. Contract export and generated handoff publish 209 operations/243 schemas; only the two page paths and one schema are added, with all previous paths/schemas unchanged. Actual HTTP/current-access remains pending Docker recovery. Resource evidence caps the native worker tree, not total API/wrapper RSS; concurrency is per API process, and Python socket denial is not OS egress enforcement.

1 October 2026. Code checkpoint `8bd7419db6cd8effec1efb8ba772d72f06df8214` on `task/desktop-private-document-pages`, based exactly on dispatch `78a9d0c293dccf6e18a9f7c3f5e2a9442efd1b0b`. Former checkpoint `4525459c32b4177043576829bee2996dad8cec8a` remains preserved. Worktree: `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`; primary staging was read-only and observed at `410fdf28b2d5471878205f49d716a99ef684640a` during closure.

Private verification receipt: `E:/BhuAayam-data/task-data/desktop-document-pages/verification-pins.json`, 46,919 bytes, SHA-256 `61658a9c8ba6ddb43db55ea960c8325f5a7bafe8b1349401814dabc589591811`. It pins nine owned code files, 27 preserved code files, 38 evidence artifacts, 18 runtime/dependency files, originals and source context. Physical and Git-normalized hashes are recorded separately. The exact committed-code local result is `closure-render/local-render.json` under that directory; earlier outputs/failures remain preserved.

## Consumer contract

Two additive private GETs, registered in the existing `EvidenceModule`:

```text
GET /api/v1/sources/{sourceId}/pages?revision=1&sha256=<64-lowercase-hex>&offset=0&limit=25
GET /api/v1/sources/{sourceId}/pages/{page}/raster?revision=1&sha256=<64-lowercase-hex>
```

`sourceId` is the canonical UUID. Exact current source `revision` and original `sha256` are required on both requests. The server resolves object keys and the configured interpreter. Unknown query fields, duplicate query values, caller paths and caller URLs are denied. The metadata defaults are offset 0/limit 25; offset is 0–399, limit 1–50 and total page count at most 400. A selection outside the actual page count is refused; there is no fabricated page.

Metadata `document-pages/1` supplies case/source IDs and revisions, original hash/bytes, name, page count, pagination/`hasMore`, exact page numbers and source labels where present. Page frames use `pdf_display_page_top_left_points` with source width/height/rotation. `mediaBox`/`cropBox` use the explicit `pymupdf_page_rectangles/1` convention; their raw tuples must not be silently recast as geographic or metric coordinates. Each page has a `pdf_page` locator, a pinned relative raster URL when supported, and **`calibration:null`**. Anchors are only `page:<n>` with `region:null`; no clause, paragraph or OCR region is inferred. Unsupported raster pages retain metadata with `renderSupport:"unsupported"` and `url:null`.

Raster returns bounded `image/png`, `private, no-store`, `nosniff`, and inline `page-<n>.png`. Headers:

| Header | Meaning |
| --- | --- |
| `X-Source-Revision`, `X-Source-Sha256` | Exact retained original pin |
| `X-Document-Page`, `X-Render-Sha256` | Explicit page and PNG hash |
| `X-Page-Pixels` | `width,height` in pixels |
| `X-Page-Frame` | Frame kind, source point dimensions and rotation |
| `X-Page-Pixel-Affine` | `scale;pixelOriginX,pixelOriginY`; source display point = (local image pixel + pixel origin) / scale |

The contract is in `packages/contracts/src/document-pages.ts`. Controller and server use explicit relative contract imports; the contract barrel/package exports were not edited. Evidence operation registration includes the contract/controller schema paths. **Lead still owns contract exports, generated OpenAPI/client/catalogue updates and later runtime transfer.** Frontend draft `DocumentPages`, GOAL and PLAN were read as consumer context only; no frontend or generated files changed.

## Authority, bounds and recovery

`DocumentPagesService` reuses `documentSourceTx`/`assertIngestionBinding`, the bounded original object stream, private scratch ACL and bounded artifact reader. It verifies current source/family, original receipt and private subject/access before I/O, after original read and after parse/render, and compares the exact authority fingerprint before returning. These are read-only deadline-bound transactions; no source, job, registry or derivative-authority writes occur. `PrivateSpatialGuard` and the application's existing loopback/origin boundary apply.

One metadata parser or raster worker runs at a time **per API process**, with a 30-second operation deadline, at most 25 worker seconds, two threads and a gated Windows Job capped at 2 GiB. Original PDF ≤16 MiB, metadata ≤128 KiB, page count ≤400, PDF objects ≤50,000, and raster ≤1,400-pixel side/1.6 million pixels/8 MiB PNG. The existing renderer is stricter: PDF ≤8 pages and a zero-rotation, zero-origin displayed page with sides ≤2,000 points. Those raster limits remain explicit even when larger metadata-only documents are supported.

Future configuration, without editing any shared config in this increment:

```text
ULPIN_DOCUMENT_PAGES_PYTHON=<absolute configured interpreter>
  fallback: ULPIN_DOCUMENT_OCR_PYTHON
ULPIN_DOCUMENT_PAGES_SCRATCH=<absolute private directory outside the repository>
```

The API profile requires Windows and the existing local runtime. Missing runtime/private scratch returns controlled 503; unsupported/encrypted/parser-invalid or nonexistent-page requests return controlled 422; stale source returns 409; occupied local slot returns 429; deadline expiry returns 504. Temporary originals and derivatives are restricted before writing and cleaned after the attempt. Unresolved child cleanup retains that private attempt and blocks further local rendering until recovery. No arbitrary filesystem serving or persisted derivative authority is introduced.

The helper reuses `render_pdf_selection` and `run_trial._run_worker`; no old producer/reader implementation, digest function or saved pin changed. Child environment is restricted, network socket APIs are denied, parsing uses the verified in-memory original, file-backed streams/reference XObjects and JavaScript are rejected. URI links and standalone attachment declarations are inert and never opened. No OCR, model, provider or GPU execution occurs.

## Actual local checks

All commands below exited 0 in the assigned worktree; route check ran from `apps/api`:

| Command | Observed result |
| --- | --- |
| `pnpm exec tsx --test tests/document-pages.test.ts` | 6 controls: canonical private authority/current pins, exact projection, post-I/O/render drift/revocation, invalid selections/caller inputs, original/PNG integrity and busy-slot recovery |
| `pnpm exec tsx --test src/modules/evidence/document-pages.controller.test.ts` | 1 Nest provider/guard/Swagger/query control, no listener |
| `pnpm typecheck:backend` | Server and API typechecks pass |
| `E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/venv/Scripts/python.exe tests/test_document_pages.py` | 2 external-file/encryption/inert-dictionary technical controls |
| `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-document-pages/verify-local.mts E:/BhuAayam-data/task-data/desktop-document-pages/closure-render` | Exact committed-code metadata for all actual pages, page-1 PNG from each original, actual nonexistent page 5 refusal, hashes preserved and scratch empty |
| `git diff --cached --check` on the nine owned code files | Pass before code commit |

These focused controls protect source integrity and private currentness that visual inspection alone cannot establish. They use transport/authority doubles and are not persisted SQL or HTTP qualification.

| Unchanged original | Metadata and page-1 output |
| --- | --- |
| USGS Fact Sheet 2025-3036; 6,219,868 bytes; SHA `5c1576e603b4bb66ff4725329432be66941853838d6ab02544e7b40a0071b5a7` | 4 pages; page 1 612 × 792 points, rotation 0; PNG 1082 × 1400, 1,229,736 bytes; SHA `800c311f0a13ccab8d953715ae389ca586c3857931f6f694b743d91cc44c52fc`; raster worker 1.047 seconds, peak Job private bytes 113,033,216 |
| USGS Central City, Colorado, 1910 scan; 9,344,939 bytes; SHA `fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf` | 1 page; 1190.3699951171875 × 1495 points, rotation 0; PNG 1115 × 1400, 2,355,569 bytes; SHA `24388ada76db60c9a1a104865196c525d17b218ec3389da1e261889669668da1`; raster worker 0.532 seconds, peak Job private bytes 100,057,088 |

Both PNGs were visually inspected in the earlier preserved run; final hashes are identical. Fact-sheet page 5 returns 422 `DOCUMENT_PAGE_NOT_FOUND`. Printed map scale does not supply qualified measurement calibration. Issuing URLs, source dates/permissions and foreign `test_only` geography remain in the [source index](../../api/real-sources.md), [catalogue](../../api/datasets.json), retained manifests and this private receipt. No new source was acquired or original altered.

The initial external-resource guard rejected ordinary dictionary/resource `F` entries; it was narrowed to actual stream `F`/reference-file semantics and verified against both retained originals. Failed guard and verifier setup attempts remain preserved. Final review also contained malformed worker JSON in the controlled runtime error path; closure checks above ran on the committed code.

Reused environment, unchanged: `E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract/venv`, Python 3.12.14, PyMuPDF 1.25.5, Pillow 12.3.0 and psutil 7.0.0. Exact executable/native package/metadata pins and vendor/PyPI origins are in the receipt. PyMuPDF's AGPL-3.0-or-Artifex-commercial terms remain a later launch-clearance consideration; no dependency or global environment was installed or modified.

## Return boundary

Local original-backed page inspection passes at the stated scope. **Real source-bound HTTP/current access remains unrun and awaits exclusive runtime assignment from the lead.** No API/DB/Docker startup or DB queries, shared service/config changes, OCR/extraction accuracy, property measurement/association, Indian operational, learner, scale, deployment or release gate is qualified. Historical case/source IDs in the local helper identify prior receipts only.

All owned page workers returned; final process observation found zero `python.exe` processes invoking `run_pdf_pages.py`. Owned scratch directories are empty. Existing private configs, originals, outputs and old producer bytes remain preserved. Pre-existing dirty paths remain unstaged: `services/geo/geo/native_cityjson.py`, `services/geo/geo/cityjson_processing.py` (stat/EOL markers with exact normalized dispatch text) and `.pnpm-store/`. The user index was empty before scoped staging and is empty after the code commit.

Requested GPT-6.1 Sol/xhigh/default-standard speed; actual model, effort and per-turn tier were not exposed. Supplied turn permissions were `approval_policy=never`, `sandbox_mode=danger-full-access`. No prompt or global setting is claimed to configure the running request's tier. Send the authorized exact-commit callback to lead `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`, then stop; no polling or runtime startup.
