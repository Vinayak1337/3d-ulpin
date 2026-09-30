# OCR-02 — bounded whole-page scan observations

Lead acceptance: implementation `81f6720` and handoff `92eb556` integrate as `2ea97e4` / `ab9930d`. Lead reviewed the seven-file change without blocking findings, matched four primary receipts, seven linked artifacts and 17 executed source-file pins to physical worker bytes and normalized candidate blobs, and independently confirmed unchanged original/source/seven prior jobs with exactly two new retries. The API items equal the direct candidate, and the map title is visible in the retained image. Integrated backend typecheck, four Python and three TypeScript checks pass. No runtime campaign was repeated. [Catalogue projection](whole-page-ocr-runtime.json) preserves the partial/unverified scope; full-page transcription and broad accuracy remain unqualified. Runtime returned to lead; worker stopped.

30 September 2026. **Canonical retained-source API journey passed; processing stopped, populated storage preserved.** Branch `task/desktop-whole-page-ocr`, worktree `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`, accepted base `e1eba7c403f20e65eb0a813f8eabe5d134db90fb`. Implementation/served commit `81f6720f6c58c93a4430654f65d36bcf6db2a4c8`. Read exact primary assignment at `aee471721133736a0ec0cbcf3e39d271b399f921`; staging stayed read-only. Supplied permissions: `never` / `danger-full-access`. Requested GPT-6.1 Sol/high/default-standard; actual model, effort and per-turn tier unobserved. No workers, downloads, installations, providers, GPU or training.

## Correction and limits

The saved 1115 × 1400 whole-page raster already visibly contains the map title and headings. The previous Docling pipeline emitted zero items. Inspection of the installed OCR/layout code and a supervised diagnostic on **that retained raster** found default Tesseract segmentation (PSM 3) emitted only `>` and `DIVISION.`; sparse segmentation (PSM 11) emitted 113 word detections, including the exact lower map title. Many detections were unreliable. A disjoint 4 × 4 crop diagnostic did not recover the upper headings reliably and was not adopted. No old source/result/receipt was rewritten or repeated solely to rediscover the known empty-output defect. A Docling layout stage can suppress recognized fragments; the observed default segmentation already explains the lack of useful underlying whole-page words. The exact internal layout classification is not claimed.

Whole-page requests now use the existing pinned Tesseract CLI directly, with English, PSM 11 and minimum word confidence 60, grouping retained words by emitted TSV line. Confidence is a filtering signal, not verified accuracy. Low-confidence/invalid/over-limit words are withheld with explicit issues; empty output remains partial. No source-specific region, inferred facts or property associations are used. Selected-region requests retain the accepted Docling/Heron path unchanged.

New method identity is explicit in candidate, supervisor receipt and additive wire enums: `ocr:tesseract-cli-5.5.1:sparse-tsv-v1`; item method `ocr:tesseract-cli-sparse-tsv`; box derivation `tesseract_tsv_pixels_via_mupdf_pixel_origin`. TSV coordinates are **pixels**, mapped directly through MuPDF's recorded pixel origin and render scale, without applying Docling's point/DPI conversion. The bridge requires the receipt/candidate method to match the selected strategy, and the result schema rejects mixed method/box identities. Existing `ocrConfigSha256` now pins strategy version/config alongside operator paths; the canonical reader digest already includes adapter, runner, bridge and contract bytes, so old jobs cannot become current under the new strategy. No new job, access or result authority was added; `document-context.ts` continues using the existing digest call.

Limits remain: unchanged source ≤16 MiB, ≤8 pages with one selected page, render ≤1.6 million pixels, side ≤1400, PNG ≤8 MiB, ≤64 items, ≤2 KiB/item, ≤32 KiB text and candidate ≤128 KiB. The new intermediate TSV is bounded to 2 MiB before decoding. One supervised worker uses CPU/two threads, a 6 GiB Windows Job envelope and ≤90 seconds inside the existing 120-second document deadline; canonical scheduling still admits one concurrent OCR attempt. Native extraction remains separate. Method/config additions require the lead's generated OpenAPI/client refresh.

## Unchanged source and real API result

Reused [USGS source lineage](../../../fixtures/usp/D5/official-runtime-pdf-v1/manifest.json) and [accepted private OCR evidence](private-ocr-jobs-handoff.md). Original: `E:/BhuAayam-data/task-data/ulpin-official-runtime-pdf-v1/usgs-central-city-co-1910-topographic-map.pdf`, 9,344,939 bytes, SHA-256 `fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf`. Source remains foreign `test_only`, without property/Indian-source/learning qualification. The pinned Heron/Tesseract/English asset hashes and installed versions were verified before execution and retained in the direct worker receipt; no asset changed.

Retained case `31329b2c-d40c-4063-a518-bb45aa44d00a`, source `b71e4732-8589-4b7c-96d5-39c0cc945506`, both revision 1. Both new jobs pin reader `ea28ac987cdf381ab976b9f0b0656bf6e344a396584d2bb56ae1829fb8d0e930` and OCR configuration `a3d4f6a75198745af23627104ae353eee45b048f8c97fda59612b52861c66030`. Canonical retries produced:

| Selection | Accepted job / result SHA-256 | Observed output |
| --- | --- | --- |
| Whole page 1 | `4f56a26c-44b0-4c85-8c52-cff39380968c` / `b1b88373bcf8310f7524d5cde8ff91edab4d2d62f6b1aeadead3e8327884ad6f` | 12 items, tool complete/output partial, `low_confidence_words_withheld`. Exact visually checked `CENTRAL CITY, COLO.` cites source-page box `[969.6142857142856,1418.1142857142856,1092.4178571428572,1448.0142857142857]` in displayed top-left PDF points. Candidate `0ce1636ab430fd00e673dc8cd8d9d67c1a76a547b10861e80c9431fb399f7678` matches the direct local worker result exactly. |
| Retained region `[107.133,52.325,464.244,112.125]` | `28dedb96-0941-468d-ad57-e18743e91f78` / `ce9f7c23dacffecb10d5166a2d37e4ed25f85580be579c540f200860df5f5471` | Five Docling items, including exact UNITED STATES, DEPARTMENT OF THE INTERIOR and GEOLOGICAL SURVEY. Candidate `92fb81b057c5f0f6107b488e883e71a7e6ec00ae6fdab990aa6c20fbd8125ae9` equals the previously accepted selected-region candidate byte-for-byte. |

Whole/region workers exited 0 with no stop reason in 1.281 / 26.969 seconds, peak Job private bytes 110,583,808 / 975,704,064. All boxes stay in the selected source page. Original download matched exact bytes/hash. Seven prior job payloads/statuses/result references and source metadata were unchanged; only the two authorized retries were added. Old OCR status is stale under current pins. Pagination, cross-case 404, source-subject denial, configuration-drift fencing, missing-local-asset unavailable and superseded-attempt denial passed using the existing controls. Native remained `needs_ocr` with zero native parts; model remained `not_requested`.

**Whole-page output is still incomplete and includes unreliable detections; the three upper headings remain omitted in that selection.** Only the exact map title and retained selected-region headings were visually checked. Every result retains `textCompleteness=unverified`; no broad OCR accuracy, complete transcription, relationship, learning or release gate follows.

## Commands, receipts and cleanup

- Retained OCR venv, `PYTHONPATH=services/geo`: `python -m unittest discover -s services/geo/tests -p test_source_ocr_candidate.py -v`: 0, 4/4. Added a focused TSV pixel-transform/literal/invalid-word regression for the actual new path.
- `pnpm exec tsx --test tests/document-ocr-boundary.test.ts`: 0, 3/3, including method/box identity, existing byte bounds and private directory ACL.
- `pnpm typecheck:backend`: 0 after stabilized code; `node --check scripts/usp/desktop-private-ocr-smoke.mjs` and `git diff --check`: 0.
- Pinned `run_source_ocr.py --page 1 --max-seconds 90 ... --output <new whole-page-001>`: 0; direct whole-page candidate returned 12/partial.
- Guarded runtime `status`, `preflight`, `start`: 0. Actual geo image was stale after build; refreshed only owned geo/worker with assigned Compose files, `up -d --wait --force-recreate --no-deps --no-build geo worker`: 0.
- `node scripts/usp/desktop-private-ocr-smoke.mjs whole-page <assigned-runtime> <new private api directory> <accepted prior private-ocr-final.json>`: 0, first run. It reuses the retained source and performs no upload.
- Guarded `stop` and final status/port/scratch checks: 0. API/dispatcher absent, geo/worker stopped, ports 3192/28000 free, scratch empty, only populated PostgreSQL/MinIO/Redis running.

Served API: `http://127.0.0.1:3192`, project `ulpin-usptest-b050544f3d2cb99e`, config `E:/BhuAayam-data/runtime/prefix-worker-20260929`. Geo/worker image `sha256:9652378589c7ffc7ec8a69e6a3ee196130e3a6a6e1a90a5fe694ef355252be7c`. Actual geo API/archive/CityJSON bytes matched the worktree, their routes remain registered, and accepted private-original controls remain unchanged. No Docker Desktop/socket/credential/storage repair or reset occurred.

Private directory `E:/BhuAayam-data/task-data/desktop-whole-page-ocr/` retains source/asset/code/render/candidate/result/process/image pins and original history:

| Receipt | SHA-256 |
| --- | --- |
| `api/whole-page-ocr-api.json` | `cf977f1f6801675a3ef8bf46fad9500d27e1c331355c490c567629293e0bd8d5` |
| `runtime-pins.json` | `2fc303be7a2efdf57b5d0dcc29c0d084a6928bba0c23455545b7735edc2de168` |
| `whole-page-001/receipt.json` | `aecb3677d19248004241040108a3118040b0d940e189f68452c08fa9dedfeaad` |
| `cleanup-receipt.json` | `3572bc52cd2c90de0e7aeec7c80ed87d99efe9135ab384da366b67782268f007` |

Runtime is returned to lead. Old branches, `.pnpm-store/`, sources, historical jobs/results and private receipts remain preserved. Lead owns integration/generated API/client/catalogue updates; this worker is stopped.
