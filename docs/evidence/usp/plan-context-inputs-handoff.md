# PLAN-CONTEXT-01 machine-cited drawing inputs

2 October 2026. **Four new bounded region attempts delivered two title/project crops and T3-2 Floor-01; T3-1 title rendering failed before OCR.** The completed Floor-02 candidate was reused unchanged. [Source-to-observation index](plan-context-inputs/index.json) holds 15 useful literal observations with source/candidate/item pins and original-page boxes; all **38 new emitted items**, including noise, remain in private `observations.json`. Completeness is unverified and canonical matching remains `not_assessed`.

[Assignment](../../orchestration/PLAN_CONTEXT_01.md), dispatch base `7a13389b2600d172b347c0edf36ce7424276ef69`. Branch `task/desktop-plan-context-inputs`, worktree `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Prior large-plan branch stays at `9806a3c8aa3a87422bdf7507460dc5b8e7358ac3`. Staging/other worktrees, all code/contracts/fusion/generated files and historical receipts were read-only. Only this handoff and the compact index are proposed for integration.

## Source identity and actual attempts

Reused the [association-sources manifest/review](association-sources/independent-review.md), [crosswalk manifest/review](association-crosswalk/review.md), [native-zero checkpoint](plan-extraction-handoff.md) and [accepted Floor-02 evidence](large-plan-ocr-handoff.md). Original hashes/byte counts matched before and after:

| Original beneath `E:/BhuAayam-data/task-data/` | Bytes / SHA-256 | Measured page-1 frame, rotation 0 |
| --- | --- | --- |
| `association-sources-20260929/haryana-2831-tower3-plan1.pdf` | 1,655,334 / `2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865` | 2586 x 1695 points |
| `association-crosswalk-20260930/haryana-2831-tower3-plan2.pdf` | 1,630,108 / `2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1` | 2586 x 1694 points, saved metadata reused |
| `association-sources-20260929/haryana-2831-tower3-section.pdf` | 2,448,909 / `f0dc0d56b786b8dccf55ca7055e6b79af8545b53212a9056c755ec1c82fad62b` | 2545 x 2590 points |

These are Haryana RERA/project-submitter planned drawings; issuer URLs, acquisition/version and source-specific permission/reference limitations remain in the retained manifests/catalogue. No source was acquired or admitted. No surveyed datum, built condition, ownership, rights or approved revision was inferred.

Each existing `run_source_ocr.py` invocation used the pinned local Docling/Heron/Tesseract assets, CPU/two threads, **90 seconds / 6 GiB**, one attempt at a time, with all existing source/page/object, raster/PNG/text/item/result/log bounds. New metadata-only commands for T3-1/T3-4 used the existing gated helper; whole-page `renderSupport` remains unsupported. Retained overviews located crops only; successful original-page affines came from the new renderer outputs.

| Attempt / selected source-point box | Exit / elapsed / emitted items | Actual raster / scale / pixel origin |
| --- | --- | --- |
| T3-1 title `[2250,1025,2555,1685]` | **1** / 0.532 s / 0 | `render_pixel_limit_exceeded`; no saved raster/affine |
| T3-2 title `[2250,990,2565,1690]` | **0** / 12.016 s / 17 | 630 x 1400 / 2 / `[4500,1980]` |
| T3-4 title `[2180,1870,2525,2570]` | **0** / 11.468 s / 16 | 690 x 1400 / 2 / `[4360,3740]` |
| T3-2 Floor-01 `[530,755,920,870]` | **0** / 11.000 s / 5 | 1170 x 345 / 3 / `[1590,2265]` |

Successful candidates report tool/output `complete`, `textCompleteness: unverified`, and `orientation_script_detection_unavailable`; the existing OSD asset is absent. Peak Job private memory was **996,020,224 bytes** or less; every worker had gated start, no stop reason, bounded logs and completed cleanup. No surviving Python/Tesseract process with this task's output path remained. No GPU/download/fit/Qwen/E5/held-out input/provider/API/DB/Docker ran.

## Literal observations versus earlier review

Ordinals below are **zero-based indices in the unchanged local candidate's `items` array**, not accepted API selections or job envelopes. The index preserves literal text and item hashes; no visual prose was inserted or recognition error corrected.

| Candidate / ordinals | New machine observations | Earlier-review comparison and gap |
| --- | --- | --- |
| T3-1 title | None | Earlier visual T3-1/Jan-2024/project observations remain visual only. No title coverage was added. |
| T3-2 title / 1,3,8,9,11,16 | Project paragraph; `VIKAS AHLAWAT ARCHITECTS`; `TOWER03`; `PLAN & AREA CALCULATION`; noisy `�_-JAN-2024`; unreliable sheet token `TH` | Useful project/title text agrees in scope with the earlier review. The project/developer tail and contact/scale text contain visible OCR errors. **`TH` does not recover the reviewed T3-2 sheet identifier.** Date noise and missing hyphen are retained. |
| T3-4 title / 2,4,10,11,13,15 | Project paragraph; same literal architect name; `TOWER-3`; `SECTION & ELEVATION`; merged `SCALE:- JAN-2024`; `T34` | The crop visibly supports the drawing title/date context; the OCR merges labels and loses sheet separators. **`T34` is not silently replaced with the reviewed T3-4 spelling.** Project/developer tail is noisy. |
| T3-2 Floor-01 / 3,4 | `TYPICAL FLOOR - 01` and the literal list below | The emitted heading/list agree with the crop and earlier visual floor scopes. Gaps and punctuation remain; three other emitted tokens (`LP.`, `{Gr`, `a`) are noise, retained privately. |
| Reused T3-2 Floor-02 / 0 | `TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)` | Prior candidate/raster/receipt hashes match exactly. Printed `13rd` remains; no rerun. |

Actual Floor-01 item 4:

```text
(3rd to 12th , 14th to 16th , 18th to 20th , 22nd to 25th , 27th & 29th,31st to 34th , 36th to 37th & 39th to 41st FLOOR)
```

Its source-page box is `[607.343,798.1165,850.4845,843.9]`; the heading box is `[661.572,781.6700000000001,796.6999999999999,792.3380000000001]`. Every successful item box was checked inside the selected source/page frame, with DPI/pixel-origin affine roundtrip error **0** at recorded precision. Only emitted crops were visually checked, using small JPEG views for the title PNGs. Printed scale and drawing levels do not qualify measurement. Matching project/title/date strings do not establish a current approved set or canonical building/floor/unit match. The separate S-001 G+41/G+42 conflict, drawing-relative levels, unreadable approval memo and revision register/crosswalk gaps remain unresolved.

## Concrete renderer gap

T3-1's exact source/page/region above failed in unchanged `render_pdf_selection` at its post-raster pixel check. At scale `1400/660 = 2.121212121212121`, the scaled clip's outward-rounded MuPDF rectangle predicts **648 x 1401** pixels (`[4772,2174,5420,3575]`), exceeding the 1400-side cap by one. This is a geometry-based diagnosis; the failing helper did not retain actual pixmap dimensions. No raster, affine or title text is claimed from that attempt.

The failure was preserved without retry or code/cap changes. Before its first attempt, the T3-2 title selection was adjusted from the initially proposed 655-point height to a 700-point height with exact scale 2; the original selection plan and adjustment are both retained. A separately owned renderer fix should account for integer pixel-origin/outward rounding while preserving the existing pixel/side caps. It must not enlarge whole-page support or substitute reviewed text.

## Pins, checks and return

Private root: `E:/BhuAayam-data/task-data/desktop-plan-context-inputs-20261002/`. Exact argument arrays/exits are in `commands.json`: four new OCR commands (1,0,0,0); two metadata-only commands (0); source/code/receipt/raster/item/affine/prior-preservation/process checks (0). Index copying/JSON checks and staged whitespace check passed. No code changed or unrelated tests/runtime campaign ran.

| Artifact | SHA-256 |
| --- | --- |
| `observations.json` (45,745 bytes, all new raw items plus reused Floor-02) | `18d4b18859e55dc6583ae7acdf60382818b54d4aa8b55edf1e91d2a476905403` |
| `verification.json` (7,758 bytes, 30 physical pins) | `d619f539d5a8c3a22f629a156f9c1466dbdea254acc276a4a278d7efbf65c39a` |
| `delivery-check.json` (2,274 bytes, index/item/metadata checks) | `40913a11de43e01d75e7dd5d93281fb96b7f0ea1885dd8b30313680639065669` |
| `commands.json` (8,659 bytes) | `9cdec3923e41fa6e33cf1f9b3b5f24f977e3e5a9d3d052122108a026ecd2946b` |
| Repository `plan-context-inputs/index.json` (15,297 LF bytes) | `2bd0cc62c7f2d3bc040341b11b2935133673f2ba28281320d2c59e109949cf96` |
| T3-1 title receipt / candidate | `22df5cc4898dfe07140d75d2761d750787b66833aafd94fe7fadf7b4bbfca17e` / `5c3df71fd2de68da99762241537b2fb90a5616f1e33460d4a057584b2cdf9235` |
| T3-2 title receipt / candidate | `5bb13a84241d478d0806144d7f7ab00df1993903335235fbcedee2496664476b` / `e051c2e3c27129effb778596e49e85ea23ee1e3578f2d3e6476b433b91e19e9d` |
| T3-4 title receipt / candidate | `b5fee27729b58a622429803bb4d19c01639ce89e19efd55026b9f76af467a123` / `3334c23db3c8277da59ff04b7042ee0b2e0dba8a7e4a54f6c8d05dda8da62f93` |
| Floor-01 receipt / candidate | `f24713003789b3710143a5fed7a46572dae38bbe8c97690f7d17cb5dfa00f762` / `7941adcaa4eecfe20c4f890183c8fc560941b04abd0f241b846de021bf513f30` |

Individual source/code/asset/raster/item pins and affines are in the index/raw observations/receipts. Item hashes use sorted-key compact UTF-8 JSON with `ensure_ascii=false`, explicitly distinct from raw candidate-byte hashes. Successful crop PNG hashes are `993c9ba18897f6e6e8979c95e85dc8a489772406fe4d6234ce3c60bcbd4666d9`, `29ab16584d6240d3ebca2f6398d483093aa4496b9bf672d7f424dee33be4dca3`, and `356325a4e6d8656e3f2e52cd91908f91ac7156a3d9e36f49f55ace5a5043a3f6`, respectively. The native-zero receipt and Floor-02 candidate/receipt/raster remain byte-identical.

These source-bound local candidates can supply later selected combined-context inputs, with their gaps retained. They are **not accepted API job envelopes, current-authority proof, automatic property links, qualified learning labels or release acceptance**. Next useful work is the separately owned raster-rounding correction for T3-1; actual matching still needs the issuer-approved sheet index/revision register and versioned tower/floor crosswalk plus canonical registry comparison. Originals, historical receipts, dirty b3eb CityJSON/`.pnpm-store/` and other worktrees are preserved. Supplied `never/danger-full-access`; Sol6.1/xhigh/default-standard requested, actual model/effort/tier unexposed. Completion callback returns to lead, then this assignment stops.
