# OCR-LARGE-PLAN-01 selected-region result

2 October 2026. **One source-page-cited T3-2 floor caption was recovered through the existing supervised Docling/Heron/Tesseract path.** Code commit `17b414bb936fedaff2bf21ad072c76f6e6e8f2a5`; branch `task/desktop-large-plan-ocr`, base `80514149f995f549301c03563a08219bf235fb16`. [Exact assignment](../../orchestration/OCR_LARGE_PLAN_01.md). Worktree: `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Staging and other worktrees remained read-only; Astra/lead own integration and generated API/client/catalogue updates.

## Correction and compatibility

`docling_tesseract._selection` now distinguishes the unchanged **2000-point whole-page profile** from explicit crops on finite, positive, unrotated, zero-origin source frames up to **14400 points per side**. A selected clip must stay inside the source frame, with each clip side **1-2000 points**. Oversized clips, unsupported source frames, rotation and origin still reject before rasterization. All existing source-byte/page/object, raster pixel/side/PNG, text/item/result, timeout/process/thread bounds remain unchanged. No source-specific exception or alternative renderer was added.

The OCR wire frame permits the larger selected source frame; result and paginated status-summary refinements require its bounded crop and retain the whole-page limit. Citation page/region/method checks remain intact. `run_source_ocr.py`, its supervisor, the backend OCR bridge and context were unchanged. The existing `documentReaderSha()` includes the changed adapter and contract bytes, and `document-context.ts` compares that digest in the existing input fence. No configuration-strategy change or historical reader/config/receipt rewrite was needed. Metadata `renderSupport` still means whole-page support and remains unsupported for T3-2.

## Unchanged original and one actual trial

Reused the [retained crosswalk source manifest](association-crosswalk/manifest.json), [accepted visual review](association-crosswalk/review.md) and [earlier empty extraction checkpoint](plan-extraction-handoff.md). Original: `E:/BhuAayam-data/task-data/association-crosswalk-20260930/haryana-2831-tower3-plan2.pdf`, **1,630,108 bytes**, SHA-256 `2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1`, unchanged before/after. Haryana RERA/project-submitter planned drawing; retained source-specific reuse/redistribution/training permissions and reference/approval limits remain unconfirmed. No acquisition, source admission or catalogue change.

The retained raster overview located the right/main floor-caption region only; its affine was not presumed as evidence. The trial rendered the unchanged original page 1, source frame **2586 x 1694** points, rotation 0, selected box **`[1820,750,2130,825]`**. The existing renderer produced:

| Raster/affine field | Actual value |
| --- | --- |
| Pixels / PNG bytes | `930 x 225` / `98,669` |
| Scale / MuPDF pixel origin | `3.0` / `[5460,2250]` |
| PNG DPI | `[96.012,96.012]` |
| Source citation box | `[1856.8935000000001,770.0025,2062.697,799.784]` |
| Inverse crop-page Docling point box | `[83,45,546,112]` within floating-point precision |

Docling boxes map through PNG DPI and MuPDF pixel origin into `pdf_display_page_top_left_points`. The actual citation stays inside the selected crop/source frame; source -> crop pixels -> Docling points -> source roundtrip error was **0** at recorded precision. The rendered crop was visually checked. One genuine emitted item, unchanged:

```text
TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)
```

Candidate method: `ocr:docling-slim-2.131.0:tesseract-cli-5.5.1:heron-pinned`; item method: `ocr:docling-tesseract-cli-full-page`; derivation: `docling_crop_page_box_via_png_dpi_and_mupdf_pixel_origin`. Its one caption agrees with the selected raster and the earlier accepted Floor-02 observation, including printed **`13rd`**. No reviewed text was entered into the extraction.

The worker reported tool/output **complete**, with **`textCompleteness: unverified`** and issue **`orientation_script_detection_unavailable`**: the retained assets lack `osd.traineddata`. English OCR still emitted the item. This is one local caption observation, not complete transcription of the crop or sheet. T3-2 Floor-01's longer list/gaps, titles, stamp/memo and T3-1/T3-4 remain outside this trial; their prior visual/empty-native evidence is unchanged. The separate S-001 G+41/G+42 conflict, drawing-relative levels, exact approved revision and canonical building/floor matching remain unresolved; no omitted floors or property facts were inferred.

The single 90-second CPU/two-thread trial exited **0** in **23.656 seconds**, with no stop reason, gated start, peak observed RSS **837,914,624** bytes and peak Job private **980,615,168** bytes under the existing **6 GiB** ceiling. Existing pinned Heron revision `8f39ad3c0b4c58e9c2d2c84a38465abf757272d8`, Tesseract/English hashes and package versions are in the trial receipt. No GPU, download, fitting, Qwen/E5, held-out input or provider ran. The supervisor closed its Job/cleaned descendants; a final check found no surviving Python/Tesseract process with this trial output path.

## Checks and physical receipts

Completed checks, exit **0**:

- Two Python controls: new generic large-frame crop/invalid selection/unchanged whole-page limit and real MuPDF fractional-origin citation roundtrip; existing retained-USGS crop/DPI mapping check. No USGS OCR/source campaign was repeated.
- `pnpm exec tsx --test --test-name-pattern 'large OCR source frames|sparse OCR cites' tests/document-ocr-boundary.test.ts`: 2/2, including result/status crop bounds and existing sparse method/citation identity.
- `pnpm typecheck:backend`: server and API pass once stabilized.
- Current result/status contract validation of the actual local candidate passed. A source revision of 1 was used only as an in-memory schema control; no canonical revision, job or result envelope was saved. The private helper initially failed Windows ESM URL loading (exit 1); changing its import to `file:///` fixed it without repeating OCR.
- Source, receipt/raster/candidate/executed-code pins, actual affine bounds/roundtrip, prior receipt preservation and owned-process checks passed; staged whitespace check passed.

Missing worktree dependencies were linked from the existing pnpm cache with `pnpm install --offline --frozen-lockfile --ignore-scripts --reporter append-only`, exit 0, **0 downloads**; the lockfile is unchanged. Complete commands/argument arrays and individual exits are in private `commands.json`.

Private root: `E:/BhuAayam-data/task-data/desktop-large-plan-ocr-20261002/`.

| Physical artifact | Bytes / SHA-256 |
| --- | --- |
| `trial-001/receipt.json` | 2,988 / `6d9c05421d2c9310e7e0dcbd5021b725f06c2d66566a44251ae1d64d61ff210b` |
| `trial-001/result.json` | 1,305 / `3fef032598e08a90c61eb7c6bd1afd64bf32650d78fb673d83bfe9864f3faab3` |
| `trial-001/render.png` | 98,669 / `81bb39d3f38c3f9873fdae4809c1dd8d9f825f7643411ac2cb7f11cae24d3403` |
| `verification.json` | 7,757 / `f4405b4fd7c40168bf34e4e52eb5a225a038ece62ec1d6101ce50efd75c60fd2` |
| `contract-check.json` | 358 / `fba9b271f16016e2d61ac1c6ff043343c0ce9ff9425582f9f197a91047216740` |
| `commands.json` | 3,407 / `8a3b807308e9c46119478576e27d6afd22a1e67c916fa80b27ceb334ce45adaa` |

Verification contains source, 24 physical code/artifact/prior-receipt pins and the affine. Executed adapter SHA-256: `83c5287d6358d5df07e175ebcef6e332efed2d9997eb993a0bb19b102778a9bc`; unchanged runner SHA-256: `9dfcf8d736eb7d812ca69fe8a8aa23999125c2bd9ba854cc448e1e7a4ecc52eb`. Physical versus Git-normalized bytes remain distinct; integrate the exact reviewed commits without rewriting historical execution pins.

Useful next input for a combined context is this exact cited Floor-02 candidate alongside the retained empty-native results and separate accepted visual observations, with machine coverage explicitly limited. Official matching still needs a readable issuer-approved T3-1/T3-2/T3-4 revision register and versioned tower/floor crosswalk followed by registry comparison. API persistence and current-service integration remain unrun; no association, training label, accuracy or release gate is qualified. Prior extraction handoff/private receipts, b3eb dirty CityJSON and `.pnpm-store/`, originals, generated files and other checkouts are preserved. Supplied `never/danger-full-access`; Sol6.1/xhigh/default-standard requested, actual model/effort/tier unexposed. Callback returns the result to lead; this assignment then stops.
