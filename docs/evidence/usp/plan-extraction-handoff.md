# DATA-FUSION-01 retained plan extraction

2 October 2026. **Result:** genuine bounded native outputs are retained for T3-1/T3-2/T3-4, but none contains machine-readable title or floor text. All three report `needs_ocr`. T3-2's measured page exceeds the accepted OCR renderer profile, so the authorized single-region Tesseract trial could not proceed. No OCR transcription or combined-context qualification is claimed.

Assignment: [PARALLEL_20261002.md](../../orchestration/PARALLEL_20261002.md), DATA-FUSION-01. Exclusive branch `task/desktop-plan-extraction`, base `b4fe12eb051460bdbf4bc7b9ca53035e2d1d7166`, checkout `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Staging was read-only; its observed head during completion was `15dd8a9efcd62a4632a8e1f8035cab301116882f`. Only the local runner and this handoff are proposed for integration.

## Originals and actual extraction

Retained Haryana RERA/project-submitter planned drawings were matched against the [association-sources manifest](association-sources/manifest.json) and [association-crosswalk manifest](association-crosswalk/manifest.json), then rehashed after extraction. Originals and historical receipts are unchanged. Issuing URLs, acquisition dates and permission/reference limitations remain in those manifests; no acquisition or qualification was added.

| Sheet / original | Unchanged bytes / SHA-256 | Observed native result |
| --- | --- | --- |
| T3-1 / `association-sources-20260929/haryana-2831-tower3-plan1.pdf` | 1,655,334 / `2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865` | 1 page; 0 characters; 0 parts; `needs_ocr`; no parser error |
| T3-2 / `association-crosswalk-20260930/haryana-2831-tower3-plan2.pdf` | 1,630,108 / `2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1` | 1 page; 0 characters; 0 parts; `needs_ocr`; no parser error |
| T3-4 / `association-sources-20260929/haryana-2831-tower3-section.pdf` | 2,448,909 / `f0dc0d56b786b8dccf55ca7055e6b79af8545b53212a9056c755ec1c82fad62b` | 1 page; 0 characters; 0 parts; `needs_ocr`; no parser error |

Original paths above are beneath `E:/BhuAayam-data/task-data/`. Private outputs are beneath `E:/BhuAayam-data/task-data/desktop-plan-extraction-20261002/`. The saved earlier T3-2 empty native checkpoint lacked a reader/runtime pin and was preserved rather than promoted as this execution.

`scripts/usp/desktop-plan-extraction.py` invokes the unchanged `geo.native_pdf --worker` behind its existing 384 MiB OS process ceiling. It accepts at most three explicitly hash-pinned PDFs, uses a fresh private output directory, a 45-second child timeout, 10 MiB input, 4 MiB reply, 100 pages, 8 MiB page-content and 250,000-character bounds. It writes the genuine worker reply and a separate local page projection with source/page/text hashes. These are raw local projections, not accepted/redacted API parts or fabricated jobs.

**Runtime limit:** bundled Python 3.12.14 supplied pypdf **6.10.0**; production `services/geo/requirements.txt` pins **5.5.0**. The existing OCR environment lacked pypdf. No dependency was installed. The receipt discloses this difference; these observed local outputs do not qualify the production dependency lock.

## OCR preflight blocker

The existing supervised `scripts/usp/document-models/run_pdf_pages.py` inspected only T3-2 page 1, without rasterizing. It returned:

- Display frame: `pdf_display_page_top_left_points`, rotation 0, width **2586**, height **1694** points.
- Media/crop boxes: `[0, 0, 2586, 1694]`; `renderSupport: unsupported`; `render: null`.
- `docling_tesseract.py::_selection` rejects either full-page side above **2000 points**, before considering a region. Thus its renderer cannot reach a title/floor-caption crop on this exact page (`unsupported_pdf_page_frame`).

This is an observed supported-profile gap, not a claim that the PDF is corrupt or that Tesseract failed. No region, pixel affine, OCR items or OCR result exists. No Tesseract/Heron/model asset was loaded; no fallback renderer or shared limit was changed. The metadata worker used the existing gated Windows Job supervisor: 25-second deadline, 2 GiB ceiling, 64 KiB log cap; exit 0, no stop reason, 0.265 seconds, peak Job private bytes 62,193,664. The worker and descendants were cleaned up. Metadata runtime versions were PyMuPDF 1.25.5, Pillow 12.3.0 and psutil 7.0.0 in the retained OCR environment.

## Extraction versus accepted visual evidence

The following column summarizes **earlier accepted visual observations only**, from the [independent drawing review](association-sources/independent-review.md) and [crosswalk review](association-crosswalk/review.md). No review prose was inserted into an extraction, property or label.

| Source/page and reviewed region | Accepted visual comparison evidence | Machine coverage in this execution |
| --- | --- | --- |
| T3-1 p. 1 main captions / lower-right title | `2ND FLOOR PLAN`; `TYPICAL REFUGE FLOOR-02 (17th, 26th & 35th FLOOR)`; Tower-03, T3-1, JAN-2024 | Absent from native text; OCR not run on this sheet. Multiple refuge occurrences remain a visual observation. |
| T3-2 p. 1 main floor captions / bottom-right title | Typical Floor-01: 3rd-12th, 14th-16th, 18th-20th, 22nd-25th, 27th & 29th, 31st-34th, 36th-37th, 39th-41st. Floor-02 prints `13rd, 21st, 30th & 38th FLOOR`. TOWER-03 / PLAN & AREA CALCULATION, T3-2, JAN-2024. | Absent from native text; OCR blocked by the measured frame. Printed gaps and `13rd` are preserved; omitted floors are not filled. |
| T3-2 p. 1 upper-right sanction region | Stamp/signatures visible; memo/date unreadable. | No extracted memo/date. Current approved revision remains unresolved. |
| T3-4 p. 1 section stack / lower-right title | Basements, ground, 2nd, refuge 17th/26th/35th, 42nd; TOWER-3 SECTION & ELEVATION, T3-4, JAN-2024. `ROAD LVL. ±0.00` and other levels are drawing-relative. | Absent from native text; OCR not run on this sheet. No surveyed datum/height inferred. |
| Separate S-001 p. 1 graphic / lower tables | T-3 graphic `G+41` conflicts with `G+42` in UNIT DETAIL and TOWER AREA DETAIL. | Outside these three extractions. Conflict remains prior visual-source evidence, not newly extracted or resolved. |

The planned drawing-set relationship remains supported at the earlier visual-review level. Matching names alone do not establish canonical building/floor identities, a current approved set, issued rights or as-built conditions. Canonical matching remains `not_assessed`; no registry comparison, record or learning label was created.

## Commands, pins and handoff

Executed commands/checks, all exit **0**:

1. Bundled Python `scripts/usp/desktop-plan-extraction.py --source <T3-1 path/hash> --source <T3-2 path/hash> --source <T3-4 path/hash> --output E:/BhuAayam-data/task-data/desktop-plan-extraction-20261002/native`. Exact source pairs are the unchanged pins above. Its child command was `python -m geo.native_pdf --worker 100 8388608 250000` for each source.
2. Retained OCR Python `scripts/usp/document-models/run_pdf_pages.py --source E:/BhuAayam-data/task-data/association-crosswalk-20260930/haryana-2831-tower3-plan2.pdf --sha256 2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1 --output E:/BhuAayam-data/task-data/desktop-plan-extraction-20261002/t3-2-page-metadata --offset 0 --limit 1 --seconds 25`.
3. Standard-library integrity assertions checked three original manifest pins, all native projection/reply hashes and empty-page locators, unchanged execution code pins, runner syntax using `compile(..., 'exec')`, and T3-2 metadata/receipt/frame pins. No repeated extraction or accuracy campaign.

| Physical artifact beneath private output root | Bytes / SHA-256 |
| --- | --- |
| `native/native-receipt.json` | 6,250 / `770e08c3e4ea775330b62a8b71d542196398a3652369a6a0a26f889d2746ff25` |
| `t3-2-page-metadata/result.json` | 485 / `19404444b07052365ac028d43408d85d98ceba85fb7dd529807ad57374c9c810` |
| `t3-2-page-metadata/receipt.json` | 534 / `3a68214bfdffc4b034feaee25db6ea5b42f9cd9994f5b7b789a928a5df0c68da` |
| `verification.json` | 7,633 / `5863a3dc128d07ef5c3390f8b47f3adac92edc8ed0d7c386d751623acfdfbe67` |
| `commands.json` | 2,632 / `acabf17dabcec5b20ab3b8495e318d0045664e25bc4c79242cd36248fece68df` |

`verification.json` and the native receipt contain every source/output/reader physical pin. `commands.json` retains the complete argument arrays, with the native parent arguments explicitly marked as reconstructed from its pinned receipt. Executed runner: 7,209 bytes, SHA-256 `01a62eb29a2f0a8d0067c89d91a92cf2be48d1fbe89bf2c84bd2549b98223fd8` (LF physical bytes; this checkout's Git configuration may produce CRLF on a later checkout).

Next useful work: separately scope an existing OCR-renderer review for this exact oversized page, with bounded rendering and correct source-page affine citations, before attempting a title/floor trial. Do not treat prior visual text or crops without an established page affine as newly extracted facts. For actual property matching, the useful next source input remains a readable issuer-approved sheet index/revision register for T3-1/T3-2/T3-4 and a versioned tower/floor crosswalk followed by canonical registry comparison.

Supplied permissions: `never` / `danger-full-access`. Requested GPT-6.1 Sol/xhigh/default-standard; actual model, effort and per-turn tier were unexposed. No source download/admission, API/DB/Docker, live provider, GPU/model fit, Qwen/E5, held-out input, worker or schedule ran. No owned process remains. Staging, dirty b3eb CityJSON bytes, `.pnpm-store/`, other checkouts, sources, contracts, catalogue and historical receipts were preserved. Source reuse/redistribution/training permission is unconfirmed; production-runtime, association, learning, accuracy and release gates remain unqualified.
