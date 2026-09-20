# T061 — local spatial extraction and reviewed bulk handoff

Implementation is complete on `feat/visual-ml-completion`, following the T060 visual corrections. User acceptance, physical-device qualification and statutory accuracy are separate; none is inferred from these results.

## Delivered

- Two hash-pinned local ONNX models: CubiCasa5K room/wall regions and RF-DETR building regions. Actual original-checkpoint evaluation, rectangular-plan export parity, unsuccessful alternatives, licenses and preprocessing profiles are retained. No paid inference or request-time weight download is used.
- PNG/JPEG and selected PDF-page processing through private Celery jobs, with up to twelve sources/pages per persisted batch. Each source retains independent attempts, cancellation/retry, errors, empty results and original receipt status.
- Immutable upright inference rasters, masks, component rings, model/profile hashes and receipts. Building imagery uses bounded overlapping tiles; polygon holes and multipart geometry remain intact. Omissions and model limitations are retained rather than replaced with generated rectangles.
- Desktop and compact Workspace review displays the exact raster and pixel overlays. Documented controls in a named metre frame are validated and applied on the server. Suggested interior geometry enters unresolved preparation facts; heights, levels and review remain separate.
- Building proposals enter the ordinary area import/review/record flow with original source linkage, model/calibration lineage, synthetic status where applicable and explicitly unknown height. They do not establish parcel ownership or authoritative boundaries.
- Immutable request keys, current-source/revision guards and application fingerprints prevent conflicting replays or duplicate facts/drafts. Draft persistence and its ML receipt share one database transaction; ordinary ingest still owns its transaction when called separately.

## Actual workflow evidence

[The workflow result](../../evidence/t061/WORKFLOW_RESULT.md) and its [machine-readable receipt](../../evidence/t061/workflow-result.json) record ten actual API groups, six retained-result browser groups and two saved-register groups.

The real worker returned 75 floor-plan regions, eight positive overhead regions and a genuine empty overhead result. An unsupported image page remained an independent failure. A missing native dependency in the first deployment was fixed; the same items were retried, retaining their failed attempts. All eight attached originals retain identical bytes, hashes and independent receipt statuses.

One model contour with 220 distinct vertices (221 closed-ring points) was calibrated using explicitly authored test controls, reviewed, built by the real geometry worker and recorded as a synthetic unit. Every vertex survived; area was 69.992404514 m² and a separately authored 3 m test height produced 209.977213542 m³. The selected roof component also passed ordinary review/recording with exact vertices and no invented height. The canonical unit renders in the saved 3D register and survives reload.

These rasters are attributed public evaluation inputs, not surveys of the fictional verification property. The selected floor component merges adjacent spaces in the source plan; the test proves contour preservation and review mechanics, not correct room semantics. Existing datasets, source revisions and identities remain protected by the separate [preservation report](../../evidence/t060/data-preservation.json).

## Qualification limits

The small floor feasibility sample has mean class IoU 0.65622. The twelve-tile building sample has IoU 0.28738 and significant false positives, particularly on blurred or unfamiliar imagery. These are proposal models requiring inspection, not qualified cadastral extraction. CubiCasa5K's noncommercial license and all model/data attribution remain visible. Two control pairs define a similarity transform and cannot rectify arbitrary perspective or scan distortion.

Physical-phone checks, formal screen-reader qualification, a complete true-200%-browser-zoom matrix, Indian survey acceptance and the historical free Nous credential gate remain separate. This task does not claim the city-scale, every-format or clean-machine release roadmap is finished.

See [the local guide](../../local-spatial-extraction.md), [model evidence](../../evidence/t061/models/evaluation.md) and `../../evidence/t061/verification-summary.json` for setup, commands, final checks and current limits.
