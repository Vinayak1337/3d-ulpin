# REVIEW-01 — accepted document and raster backend

Review base: `f5b979a1785f052e9681d6d0d825b8f37669b235`; implementation commits `81aef71` and `5abc0be`, with the relevant `bb15408` DOCX flag correction and handoffs. This is a code and retained-receipt review, not a new runtime gate. The supplied turn permissions were `approval_policy=never` and `sandbox_mode=danger-full-access`; Sol/max was requested, while actual model/effort/tier metadata was not available to this reviewer.

## Finding

**P2 — PDF page limit is checked after full decompression.** `services/geo/geo/area.py:581-583` evaluates `len(contents.get_data())` before comparing with `MAX_PDF_PAGE_CONTENT_BYTES` (8 MiB). A retained PDF of at most 10 MiB with a highly compressible page content stream that expands well beyond 8 MiB reaches `get_data()`, which materializes the decoded stream first. The intended behavior is a bounded rejection before excess expansion; the actual check can consume far more than the stated page budget and potentially exhaust the Geo worker before a stable `tool_error` receipt. This pre-existing call pattern was retained when `5abc0be` raised the cap for the real fact sheet; the new bounded native profile still relies on it. Enforce the limit during decompression or isolate the decode with a hard resource ceiling and a durable failure result. This is a static call-order finding; the resource-exhaustion case was not executed, and no source bytes were changed.

## Review evidence and limits

- `git show --stat` for `81aef71`, `5abc0be`, and `bb15408` exited 0. I traced raster receipt/source hashes, exact object keys, private Origin guard plus the global loopback Origin check, job attempt fences, accepted artifact readback, and document unit span/reconstruction checks. No other actionable defect was found in those paths.
- The retained raster and document receipt files match the handoff SHA-256 values (`60d0e8de...d787ae` and `f0944fe2...30dcf26ea`). The document receipt records 53 parts/53 units over pages 1–4; the scan has zero parts and `needs_ocr`. The raster receipt records the `955d7f05...e11d317` source, a completed first window, out-of-bounds failure, and a 403 denied read. These are checks of immutable receipts, not independent runtime replay.
- No Docker, inference, source acquisition, input generation, typecheck, or runtime test ran. DOCX runtime, OCR, arbitrary raster formats, and vertical placement remain disclosed gaps. Hostile compressed PDF behavior remains untested under this review. This review does not assert complete release or security correctness.
