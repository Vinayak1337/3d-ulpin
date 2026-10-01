# OCR-PIXEL-BOUNDS-01 — integer crop sizing

2 October 2026. **The exact retained T3-1 title region now renders within the unchanged caps and emits 16 cited OCR items.** Code commit `93f410ad6e88bcd7921f3e260fcee545ee794346` adds MuPDF integer-bound preflight before raster allocation, with one deterministic scale reduction only when the original scale exceeds a cap. The post-render guard remains. Source/frame/region profiles, original hashing, OCR methods, process limits and contracts are unchanged; already-fitting scale/output geometry is preserved.

[Assignment](../../orchestration/OCR_PIXEL_BOUNDS_01.md), dispatch base `24a7e65e9cec451166fad72d8702904bbd445dd7`. Branch `task/desktop-ocr-pixel-bounds`, exclusive worktree `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Completed `task/desktop-plan-context-inputs` remains at `61313191304134688c1db2163037ed2252ada763`; staging and other checkouts stayed read-only. Only the adapter's sizing code, directly affected tests and this handoff changed.

## Focused checks and one real-source retry

The new regression prevents the observed one-pixel overflow before allocation and covers the related area overflow, actual raster versus preflight dimensions, and original-page citation mapping. Blank technical-control PDFs supply geometry only, never operational facts or labels.

| Control | Original continuous scale / rounded pixels | Corrected scale / actual pixels |
| --- | --- | --- |
| Exact T3-1 region `[2250,1025,2555,1685]` | `2.121212121212121` / 648 x 1401 | `2.118181818181818` / 647 x 1399 |
| Fractional-origin area case `[100.25,200.5,1100.25,1200.5]` | `1.2649110640673518` / 1266 x 1266 (1,602,756 pixels) | `1.2629110640673518` / 1264 x 1264 (1,597,696 pixels) |
| Accepted T3-2 title geometry `[2250,990,2565,1690]` | `2` / 630 x 1400 | Exactly unchanged, including origin `[4500,1980]` |

`python -m unittest discover -s tests -p test_source_ocr_candidate.py -v`, from `services/geo` using the existing OCR venv: **6 passed, exit 0**. Existing source-frame, output/log limits and citation controls were reused. Code review and staged whitespace check passed. No unrelated backend/client/API suite was repeated.

The sole supervised OCR retry used unchanged `E:/BhuAayam-data/task-data/association-sources-20260929/haryana-2831-tower3-plan1.pdf`, **1,655,334 bytes**, SHA-256 `2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865`, page 1, exact failed region above. Its measured frame remains 2586 x 1695 source points, rotation 0. Issuer/acquisition/terms and unresolved revision limitations remain in the [retained source review](association-sources/independent-review.md) and [plan-context handoff](plan-context-inputs-handoff.md).

Existing pinned local Docling/Heron/Tesseract assets and runner: CPU/two threads, **90 seconds / 6 GiB**, existing 1400-side/1.6M-pixel and all source/output/log bounds. **Exit 0**, 9.015 seconds, gated start, no stop reason, peak Job private memory **1,003,757,568 bytes**, cleanup complete. Actual raster: **647 x 1399**, pixel origin **`[4765,2171]`**, scale **`2.118181818181818`**, DPI `[96.012,96.012]`. All 16 item citation boxes lie inside the selected region/source page; affine roundtrip maximum error is **0** at recorded precision. Only the emitted crop was visually inspected.

## Literal observations and remaining gaps

The candidate reports tool/output `complete`, while **text completeness remains `unverified`**. `orientation_script_detection_unavailable` persists because the existing OSD asset is absent. Private `observations.json` retains every unchanged item, ordinal, canonical item hash and source-page box.

- Ordinal 1: genuine project paragraph, with noisy developer tail preserved.
- Ordinal 3: `VIKAS AHLAWAT ARCHITECTS`.
- Ordinals 9/10: `TOWER03`, `PLAN & AREA CALCULATION`.
- Ordinal 12: literal `—_JAN-2024`; no normalization from visual prose.
- Ordinal 14: `1:200 (A1)` is a printed scale observation, not measurement qualification.
- Ordinal 15 is literal `=`: **the sheet identifier is unrecovered**. Signature/stamp transcription is also unverified. The crop visually shows a sheet token, but that review observation was not substituted into OCR.

Matching project/title/date scope does not resolve current issuer-approved revision, canonical tower/floor/unit identity, rights or the retained G+41/G+42 contradiction. These are local candidates, not accepted API job envelopes, qualified learning labels or current fusion authority. The three successful PLAN-CONTEXT-01 crops and accepted Floor-02 were reused unchanged without another OCR attempt.

## Immutable proof and return

Fresh private root: `E:/BhuAayam-data/task-data/desktop-ocr-pixel-bounds-20261002/`. `commands.json` retains exact argument arrays and exits; `verification.json` pins executed code, raw artifacts and Git-normalized code separately. Source/history/code/receipt/raster/item/citation/affine/process assertions passed, exit 0. All three retained plan originals and **36 historical files**, including the failure and previous successful receipts/results, match their before hashes. No owned trial process survives. Dirty b3eb CityJSON/`.pnpm-store/`, originals and other checkouts were preserved.

| Artifact | Bytes / SHA-256 |
| --- | --- |
| `trial-001/receipt.json` | 2,991 / `5a86a953fa4b3cd13c4509276506913703227ab5eae44893c8127d4d3bd8a769` |
| `trial-001/result.json` | 6,739 / `e545da08ccbaa467319a3a169d0c3ea68af9e9119105c2478714f22887295ba7` |
| `trial-001/render.png` | 930,371 / `e3d2c6586a49289c338f0fa102793afb270a8a8b81c162c14f969c1a4ce2c327` |
| `verification.json` | 6,043 / `c6403bb181d3a50a6d847d50b1648d1bebc80d86906b4eb62abbd52957526ec4` |
| `observations.json` | 13,207 / `87cc2cc0d05be1ba480bcdf0e9604acc93e8427b255aa13dbfaa3f4ac3964e5b` |
| `commands.json` | 2,191 / `ad185528582afa28ab532c4c2204fd93235337cba127b2b5765d177a07304289` |
| `sizing-check.json` | 1,156 / `88de55ffe014b722046d5b967198b692980ca4bbb91d4a2e1b40b9695634a9d8` |

Executed adapter SHA-256 `37f80a4f4e6832bd3c8a154fad4dbc724911b80a76def9ff4466c1359aaa8380`; unchanged runner `9dfcf8d736eb7d812ca69fe8a8aa23999125c2bd9ba854cc448e1e7a4ecc52eb`. Historical execution pins were not rewritten. Supplied permissions are `never/danger-full-access`; Sol6.1/xhigh/default-standard was requested, actual model/effort/tier remains unexposed. No source acquisition, downloads, model fit/GPU/Qwen/E5/held-out input, provider/API/DB/Docker/frontend/generated changes, push or deployment. Lead owns review/integration; return by authorized callback, then stop.
