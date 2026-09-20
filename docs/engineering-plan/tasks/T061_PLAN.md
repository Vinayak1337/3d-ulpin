# T061 — local spatial extraction and reviewed bulk handoff

The visual correction implementation is captured and checked in T060. This bounded follow-up implements the two actual ML tasks requested in the recovered project chats: building footprints from overhead imagery and room/wall regions from floor-plan rasters. Existing document assistance remains distinct.

## Contract and implementation

- Use pinned locally executed model weights. Retain licensing, source URLs, hashes, preprocessing and evaluation receipts. Do not represent a small feasibility evaluation as cadastral qualification or call deterministic geometry ML.
- Select up to twelve retained originals/pages per persisted batch. Reuse private Celery jobs with independent attempts, failures, cancellation and retry. Preserve receipt/suitability status when inference fails. Queue waiting must not consume a worker execution deadline.
- Retain the exact upright inference raster, mask, component geometry, scores and model receipt. The review overlay uses that raster's pixel grid. Original bytes remain immutable. No inference from file names, ownership, height or floor count.
- Display source-linked proposals and allow explicit selection/subject assignment. Persist two documented control pairs in a named metre frame, tied to the retained raster hash. Recompute metric geometry on the server. Distinguish inference cache identity from application identity.
- Apply candidates atomically and idempotently to existing preparation facts. Require current target revision and reviewed placement; keep ordinary fact review, separately evidenced elevations, deterministic geometry validation and technical recording gates.
- Provide a derived footprint adapter through the ordinary area import/review flow, preserving the source and model/calibration lineage and unknown height. Do not write authoritative buildings directly from a mask.

## Verification

Run actual inference on retained published evaluation samples and preserve errors. Verify ONNX parity on real rectangular floor plans. Exercise partial batches, empty output, exact replay, conflicting replay, stale calibration, source mismatch, cancellation/retry and no duplicate apply. Test a browser path from retained originals to mask inspection and reviewed draft handoff. Verify originals/revisions remain preserved, then run relevant tests, typecheck and the production build.

## Explicit limits

This is a local, single-operator reviewed-assistance feature. Model quality on these samples does not establish Indian survey acceptance. Noncommercial model licensing remains visible. Two-point similarity cannot correct arbitrary perspective or nonuniform scan distortion. Holes and multipart shapes remain preserved; unsupported volume conversion must fail visibly. Physical-device and user visual approval remain separate acceptance evidence. Missing free Nous credentials cannot be replaced with paid calls.
