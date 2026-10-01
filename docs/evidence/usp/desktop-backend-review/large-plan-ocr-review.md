# OCR-LARGE-PLAN-01-R — bounded crop and citation review

2 October 2026. **No actionable finding established in the narrow renderer/contract delta.** Recommend accepting the code with the saved local selected-caption observation. This does not qualify current API/SQL persistence, complete transcription, canonical relationships, learning labels or release.

## Scope and revision

- Candidate `9806a3c8aa3a87422bdf7507460dc5b8e7358ac3`; code `17b414bb936fedaff2bf21ad072c76f6e6e8f2a5`; base `80514149f995f549301c03563a08219bf235fb16`. Read-only staging/dispatch observed at `4945ffdcfaabf3b2fb8725f85deb76e45e4b075a`.
- Reviewer checkout `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-large-plan-ocr-review`; completed IFC report `e7ed6c0d6da099ec57444644c71e37d4488695ec` and branch preserved. Own only this report and `E:/BhuAayam-data/task-data/desktop-large-plan-ocr-review/`.
- Read the review/implementation assignments, handoff, current entry-document changes/ledger, source index and retained source manifest/acquisition lineage/accepted visual observation. Reviewed the four changed production/test files and necessary existing adapter/status/currentness callers. FUSION-02, frontend and completed security/IFC reviews were not reopened.
- Supplied permissions: `never` / `danger-full-access`. Requested Astra/high/default-standard; actual model/effort/request tier unexposed. No settings change or delegation occurred.

## Code and contract review

`docling_tesseract.py::_selection` requires a finite, positive, zero-origin/unrotated source frame no larger than 14,400 points per side. An explicit crop must be inside that frame with each side 1–2,000 points. Missing selection still requires the original whole-page limit of 2,000 points. These checks precede rasterization; no source-specific exception is introduced.

AST comparison confirms `_selection` is the only changed adapter function, and the new source-frame ceiling is the only added constant; all previous constants remain exact. Source-byte/page/object, raster scale/pixel/side/PNG, item/text/result and existing process/time/thread bounds remain unchanged. The renderer still parses exactly the bytes it hashes, clips before rasterization and records the actual MuPDF pixel origin, scale and PNG DPI. The existing affine function is unchanged.

The contract admits a larger source frame only with its bounded crop. `refineOcrFrame` applies to both full OCR results and status metadata. Existing finite/nonnegative/ordered box checks, selected-page/region citations, method/derivation identity, source frame, text caps and execution-result validation remain in place. A null frame still permits an unavailable/failed attempt with no cited items. Whole-page metadata support remains unchanged; the retained T3-2 page metadata correctly continues to say `renderSupport: unsupported`.

The unchanged OCR bridge checks receipt/source/page/selection/method/result pins before parsing the final `DocumentOcrSchema`. Status reads first parse the complete result, then project its paginated items/metadata with source/access/currentness checks before and after object I/O. `documentReaderSha()` includes both changed production files. Its changed digest feeds `documentInput` and `assertDocumentInputTx`; old inputs remain stale under the existing fence. No historical reader/config/receipt hash was rewritten, no compatibility exception was added and no local candidate was enrolled as a canonical job.

## Saved caption and affine

The unchanged Haryana RERA/project-submitter original is 1,630,108 bytes, SHA256 `2aadce88509b437bfa8ff104e7f7d51f62e05bc8fc904e26e41a43e8263b1bd1`. Its exact acquisition receipt and retained source manifest match. The existing page metadata is 2586 × 1694 points, page 1, rotation 0. Selected region: `[1820,750,2130,825]`.

Independently inspected the saved 98,669-byte crop and checked its PNG header/DPI without rendering again. It is 930 × 225 pixels at scale 3, pixel origin `[5460,2250]`, PNG DPI `[96.012,96.012]`. The one emitted caption agrees with the visible crop, including its printed spelling:

> TYPICAL FLOOR - 02 (13rd , 21st , 30th & 38th FLOOR)

Citation `[1856.8935000000001,770.0025,2062.697,799.784]` stays inside the selected original-page region. Independent arithmetic inverts it to Docling crop-page points `[83,45,546,112]` within floating-point precision; mapping back has **zero error at recorded precision**. The source affine comes from the trial renderer, not the retained overview image used to locate the crop.

The saved trial exited 0 in 23.656 seconds under the 90-second/two-thread/6-GiB profile, with peak observed RSS 837,914,624 bytes and Job private memory 980,615,168 bytes. Tool/output status is complete for this emitted result, while `textCompleteness` remains `unverified`. Missing OSD data is accurately retained as `orientation_script_detection_unavailable`; this is not full sheet/crop transcription. Earlier empty native extraction, visual observations, floor-list gaps, G+41/G+42 conflict and unresolved approved revision remain separate. Source-specific reuse/redistribution/training terms remain unconfirmed; no relationship or label is established.

## Evidence and verification limits

Standard-library reconciliation passed **82 checks**, matching all **25 source/verification pins**, six principal artifact/command receipts, acquisition/page metadata and selection references, executed adapter/runner identity, 13 repository file pins and their candidate Git equivalents. Six reviewer files differ from tested owner bytes only through line endings; physical and Git hashes are preserved separately. Reader digests reconstruct as base Git `83066d9fd6217a515633ba7503380ecb0defcfb398764a951d45ce5231efe489`, candidate Git `71649369061f7d2312cd7fe93741f36a858a1777fe3a0ad9431aa8804f44acc6` and tested owner physical `5c64e1f33aa54b4d89b3d028f6e44440dba4a76780af9baca44b049cd5e3a4da`; these are distinct representations, not interchangeable runtime pins.

Matched owner verification SHA256 `f4405b4fd7c40168bf34e4e52eb5a225a038ece62ec1d6101ce50efd75c60fd2`, trial receipt `6d9c05421d2c9310e7e0dcbd5021b725f06c2d66566a44251ae1d64d61ff210b`, candidate `3fef032598e08a90c61eb7c6bd1afd64bf32650d78fb673d83bfe9864f3faab3` and crop `81bb39d3f38c3f9873fdae4809c1dd8d9f825f7643411ac2cb7f11cae24d3403`. Reused the recorded two Python controls, two TypeScript controls, backend typecheck and actual candidate result/status validation. The owner's private ESM-path validation-helper failure and corrected pass remain disclosed; OCR was not repeated. Source revision 1 in that validation was only an in-memory schema control.

Reviewer command: `C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe -B -I -S E:/BhuAayam-data/task-data/desktop-large-plan-ocr-review/reconcile.py`, exit **0**. Candidate and staged report `git diff --check` exit **0**. New private `reconciliation.json`: **7,147 bytes**, SHA256 `21f5dcde6ef1d42f33c1d8d7e57549eb98add299aceb8c0063048d6ae9c088db`.

No fresh OCR/render/model/native campaign, provider, download, GPU, services/DB/Docker, production/source/label/frontend change, extra worker or schedule occurred. Existing trial cleanup/survivor evidence is reused; the reviewer launched only the completed standard-library reconciliation. Integration/generated publication remains lead-owned. Return the report-only commit through the authorized callback, then stop.
