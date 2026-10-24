# OCR diagnosis and bounded recovery

Whole-page `OCR_UNSUPPORTED_PDF_PAGE_FRAME` is unchanged: source page 2585 × 3390 points exceeds the
2000-point whole-page side limit. No limit, frame, original, model or extraction authority was changed.

The same runner, pinned environment and region `[280,860,960,2580]` ran directly outside the bridge with its
existing 90-second / 6-GiB Windows Job. It failed after 5.141 seconds, with an empty supervised log and no
candidate result. A no-OCR import preflight confirmed the runner's Docling symbols existed. One materially
different **exception-capture diagnostic** reused that same Job supervisor and runner, directing the worker's
Python exception to an explicit private trace. Its initial harness invocation lacked the repo geo import path
and started no OCR worker; that harness path was fixed. The bounded capture then failed after 5.891 seconds,
without resource termination, and retained the traceback under:
`E:/BhuAayam-data/task-data/k2/ocr-debug/capture-k2b/traceback.txt`.

Actual cause: Docling's `TesseractOcrCliModel._set_languages()` called `tesseract.exe --list-langs` and received
**3221225781 / 0xC0000135 (STATUS_DLL_NOT_FOUND)**. PE import inspection (`objdump -p`) confirmed that the pinned
Tesseract executable and DLL import `libcurl.dll`, absent from the retained conda environment (and not declared
by its Tesseract package dependency list). This is a native dependency failure, not an OCR accuracy/region error.

Recovery hypothesis: provide the missing native closure in a **new** isolated dependency prefix, retaining the
unchanged pinned Tesseract executable, then point only the authorised non-secret path configuration at it.
Conda-forge libcurl and its resolved dependencies were acquired with `--no-rc --no-env`, a new root/prefix under
the owned K2 directory, never into the retained environment. [Package URLs, SHA-256 and licences](native-dependencies.json)
are recorded; retained bin files were copied only where the new prefix did not already supply a dependency.
The executable still matches the runner's original hash. Native `--list-langs` now exits 0 and lists eng/hin.
No duplicate OCR implementation, dependency installation into an old environment or global PATH change was made.

[Hindi acquisition](tessdata-acquisition.json) pins the official `tesseract-ocr/tessdata_fast` commit, SHA-256 and
Apache-2.0 licence. `hin.traineddata`, an unchanged copy of pinned `eng.traineddata`, and licence bytes live in
new demo `tessdata/`. The previous path JSON was copied to a new private backup before the explicitly authorised
path update. Doctor reports **eng+hin assets**, not Hindi execution: the accepted runner still requests English.

Success criterion: one new API region retry produces source-bound observations under unchanged bounds, or
records its precise failure with no further retries. No source claim or officer decision adopts OCR output.
**API comparison result:** job `828d327b-f9f7-4a12-b4fb-39c756c02ab3` completed with a failed OCR observation:
`OCR_SUPERVISOR_FAILED`, no first lines. The bounded worker exited 1 after 10.25 seconds, peak private bytes
999,006,208, no resource termination. The native missing-DLL failure was fixed and independently probed, but
this subsequent pipeline failure is **not diagnosed**: the accepted bridge exposes only candidate/log hashes
and cleans the underlying failed output. No second API retry or additional OCR execution was performed.
[Status and hashes](ocr-result.json) are retained. Next prerequisite: runner/bridge-owner retention of sanitized
failed candidate detail and traceback under the same bounds, not another crop sweep or blind retry.

Full trace, render, direct receipts and acquisition log stay outside Git; only compact summaries are published.
The lead must add these software/language assets to the unowned acquisition catalogue if a catalogue entry is required.
