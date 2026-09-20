# Local spatial extraction

The Plan Workspace can run two local models against retained PNG/JPEG originals or a selected PDF page. CubiCasa5K suggests room and wall regions; RF-DETR suggests building regions in overhead imagery. This is reviewed assistance. Neither model supplies ownership, parcel identity, floor elevations, storey counts or legally accepted geometry.

## Run it

1. Install the hash-pinned model artifacts with `python3 scripts/ml/setup-models.py --source-dir /path/to/qualified-models`. The script verifies byte length and SHA-256 before copying to `.runtime/ml-models`. To reproduce artifacts from original code and checkpoints, use the separate pinned export environments described by `python3 scripts/ml/setup-models.py --help`. Exporter changes require new parity evidence and manifest qualification; a changed file is never silently accepted.
2. Start the existing local platform with `pnpm platform:start`. The private API and Celery worker mount the model directory read-only. Model weights are not committed. A missing or changed model is reported explicitly; requests do not download weights or use a paid fallback.
3. Open a saved property's Plan Workspace, add originals, and open **Build → Spatial extraction → Extract plans or imagery**. Select a task and up to twelve source parts/pages. Each source has independent persisted status, attempts and immutable output. Close and reopen the panel to retrieve the batch.
4. Inspect the exact retained raster and toggle the suggested regions. The overlay uses the inference raster's own pixel grid, including its recorded page rendering and orientation. A model score is not a survey accuracy estimate. Empty output is not evidence of absence. Failed/cancelled items can be retried without replacing originals or successful siblings.
5. Select supported regions and identify two documented pixel-to-metre control pairs in the named frame. Keep the control evidence in the review note. Two points establish a similarity transform only; they do not rectify perspective or nonuniform scan distortion.
6. Floor regions enter the existing preparation as unresolved geometry facts after the property's drawing placement has been reviewed. Wall, railing and outdoor classes remain inspection context. Review the facts and separately evidence lower/upper levels and floor names before preparing and technically recording 3D details.
7. Building regions create an ordinary footprint import draft in the area's retained projected metre frame. Review the source notices, original image, derived geometry and unknown height before recording. Height remains unavailable unless separately supported. The ordinary area checks and recording acknowledgement still apply.

## What is retained

Original source revision/hash and bytes; source-part association; page/crop/orientation; exact raster and mask hashes; model weight hash and processing-profile version; pixel polygons and scores; runtime and inference receipt; each failed or successful job attempt; calibration controls and reason; selected component names; application fingerprint; created fact IDs or footprint draft IDs. Replaying the same request does not create another result or fact set. Relevant stale sources, targets, model profiles and calibration grids are rejected.

The footprint adapter preserves holes and multipart geometry and uses the existing explicit projected GIS adapter. Unsupported detailed-volume conversion fails visibly rather than filling holes, replacing boundaries with rectangles, or inventing legal units. Source inspection/suitability is separate from inference success: a model failure does not mark an intact original as failed.

## Model scope and evidence

See [the pinned manifest](../services/geo/ml-models.json) for original sources, licenses, byte hashes, processing profiles and quality limits. CubiCasa5K's checkpoint uses CC-BY-NC-4.0 and is limited to noncommercial use under those terms. RF-DETR's retained model card specifies Apache-2.0. Keep dataset attribution separately from model licensing.

The small retained evaluation uses published plans and aerial test tiles, with both misses and false positives preserved. It does not qualify cadastral accuracy, Indian survey acceptance, legal unit boundaries, or arbitrary imagery. Blurred and unfamiliar imagery can perform poorly. Any demonstration control coordinates and elevations used by workflow verification are explicitly synthetic and are not survey evidence.

The existing Nous document-assistance feature remains separate. Local segmentation does not establish a working Nous free entitlement, and deterministic topology checks are not described as a trained topology model.

## Verification commands

- `pnpm typecheck` and `pnpm build`
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/spatial-ml*.test.ts`
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json tests/spatial-ml-backend-integration.ts` for isolated database/storage contracts
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json tests/spatial-ml-footprint-integration.ts` for atomic draft rollback, retry and source-byte preservation
- `python -m pytest services/geo/tests/test_spatial_ml.py` in the private processor test environment
- `pnpm exec tsx --tsconfig apps/web/tsconfig.json scripts/ml/verify-workflow.ts` for the actual local-worker extraction phase
- `node scripts/ml/browser-workflow.mjs` for the retained browser workflow
- The verifier's `--record` phase exercises ordinary fact review/build/record and footprint draft review using only its newly created, explicitly synthetic verification area.

Do not refresh repository snapshots or reset populated volumes to run this feature. `REPO_DATA` continues to select the existing isolated or linked environment.
