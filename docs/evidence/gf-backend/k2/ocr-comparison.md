# Tower 3 OCR: one bounded recovery comparison

**Baseline:** configured retained Windows OCR paths; existing page-1 whole-page API retry completed with
`OCR_UNSUPPORTED_PDF_PAGE_FRAME`, no result lines. The worker was gated, exited 0 after 0.515 s, and used
64,000,000 peak private bytes. This is an input-support refusal, not missing OCR paths, an accuracy score,
or a network/provider fault.

**Diagnosis:** the unchanged PDF has rotation 0, MediaBox/CropBox `[0,0,2585,3390]` points. The accepted
`docling_tesseract.py::_selection` limits whole-page sides to 2,000 points; selected source pages may be up
to 14,400 points, but each selected region remains <=2,000 points per side. Existing tests document this
large-page selected-region recipe. No bridge, limits, supervision, source bytes or page frame were changed.

**Hypothesis:** an explicit <=2,000-point crop of the visible table band can use the accepted selected-region
path and produce cited candidate text. The page was viewed as a 0.25-scale MuPDF derivative under the owned
private K2 directory. Source-point selection `[280,860,960,2580]` (680 x 1,720 points) selects the visible
left-hand table band; it is an OCR viewport selection, not a property coordinate or geometric control.

**Success criterion:** existing API returns a bounded cited OCR observation with worker/receipt pins; record
status and first lines without adopting them as registry facts. **Stop:** one selected-region job, existing
90-second worker / 120-second document deadline. If empty, unsupported or incorrect, preserve the result
and report the prerequisite; no new OCR implementation, crop sweep, dependency install or download.

**Comparison result:** `6266b1a6-71c3-4298-8749-eb510132d26e` completed at the API with a failed OCR
observation, `OCR_UNEXPECTED_WORKER_ERROR`, no result lines. The gated worker exited 1 after 18.407 s,
peak Job private bytes 461,058,048; it was neither deadline- nor memory-terminated. Supervisor log SHA-256
is `8d66b14c6aee2e9470e9bb4a6b3c31e67c5f3edfc90aaf84e988fda12be57b41`. The accepted bridge removes
attempt files after child closure and exposes only bounded receipts/log hashes; the underlying exception
trace is not retained by this API. Its cause is therefore **unknown**, not asserted to be model/dependency
absence. Stop condition reached: no further OCR jobs or crop sweep. Next prerequisite is an OCR-runner-owner
sanitized exception/dependency diagnostic with retained local logs, without weakening bounds or downloading
assets. Runtime path configuration itself validated and doctor reported it available.

Only `eng.traineddata` is installed. Hindi remains unavailable. The retained G+41/G+42 human transcriptions
remain conflicting irrespective of this OCR output.
