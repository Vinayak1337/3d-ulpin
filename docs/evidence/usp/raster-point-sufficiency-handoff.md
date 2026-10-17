# RASTERPOINT-SUFFICIENCY-01 — bounded metadata adapters

4 October 2026. Base `bd0ef1296bc30e9d9893431bc5d786ba105e4ad3`, branch
`task/desktop-raster-point-sufficiency`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. Ordered code commits:
`ee4713dbd5d2e0c7071e12118fda5f4b7bec5e03`, then
`faadaa4a8dbc42966f3d36b67576037a876ef6bf`.
[Assignment](../../orchestration/PARALLEL_20261003.md#rasterpoint-sufficiency-01--independent-rasterpoint-metadata-adapters-4-october).
Requested Sol6.1/xhigh/default-standard1×; actual model/effort/tier unexposed.
Supplied permissions: never/danger-full-access. Staging stayed read-only.

The new independent contract and server leaf reuse canonical `rasterSourceTx` /
`pointSourceTx`, full `rasterWindowCaptureTx` / `pointBatchCaptureTx` enrollment and
accepted-attempt authority, and `readRasterResult` / `readPointResult`. Original
retention survives pending, running, failed and stale processing. Available results
use `inspected_metadata`, null native/model statuses, and a discriminated
`processing.rasterPoint` detail. Complete producer metadata, requested/default
selection and receipt-only artifact reference are preserved; object keys are omitted
from processing. Tools stay `not_checked`, installed inventory `not_read`.

Each distinct exact input/result reserves its existing 32 KiB ceiling within one
64 MiB/30-second operation budget. Canonical HEAD/ETag/count/hash reads receive that
same deadline/signal; asset IDs have no length, so only actual measured receipt
bytes are reported. Operation-local verified-result caching prevents repeated
reads/reservations, while every invocation and final closure recapture database
authority. Access, captured/current null or malformed markers, copied/competing
markers, source-family revision, latest job, enrollment, reader, accepted fence,
attempt/completion and result drift fail closed. The leaf refuses oversized complete
processing receipts without truncation; lead must retain the aggregate 64 KiB
check before any composed write/response. Storage/integrity/deadline errors propagate
instead of admitting unchecked metadata.

## Lead composition remains pending

Import the new detail contract into the shared processing envelope; add canonical
raster/point original classification and owner checks before generic document
authority, then compose the adapter using the shared budget, record pins, evidence
digest and final closure. Shared schema/context/policy/service, exports, controllers,
generated API and catalogues were not edited. Full sufficiency evaluate/read/answer/
replay is therefore **not yet wired or qualified**.

`finalLockPlan` exposes case-destination/case/source/job/metadata/all-attempt IDs and
full-capture observations. Reuse the existing source-case destination gate, sorted
cases **FOR UPDATE**, then sorted sources/jobs/metadata/all job attempts **FOR SHARE**
before `revalidate(true)`. Canonical capture already takes case/source/job/metadata
SHARE locks even at initial capture; these semantics were preserved. The caller owns
transaction lifetime and bounded SQL. Exclusive case locking also prevents new
latest-job enqueue; SHARE alone cannot. Do not add a family admission lock after
case locking: enqueue takes that lock before its case SHARE. The initial proof and
code checkpoint are preserved; the final review explicitly reuses the existing
exclusive case gate. SQL lock timing/concurrency remains a disclosed control, not
a new PostgreSQL runtime claim.

## Checked scope and retained evidence

`pnpm exec tsx --test tests/sufficiency-raster-point.test.ts`: exit 0, three passes,
zero failures/skips. `pnpm typecheck:backend` and staged whitespace: exit 0.
One real original per family supplies pending/no-job guidance under memory SQL and
source/enrollment controls; targeted stale/access/fence/marker/cancellation refusals
read no objects. Retained first-window/batch metadata passes the independent schema
fallback, preserving EPSG:2263, finite nodata, null/unknown raster vertical reference,
EPSG:6347, point scale/offset, declared vertical/GPS states and all 18 dimensions.
Global placement remains `not_qualified`; interpretation is `not_assessed`.

The unchanged NYC DEM crop (989,186 bytes, SHA256 `955d7f05…`) and LAZ derivative
(11,110,715 bytes, SHA256 `8c565f32…`), manifest and historical receipts were rehashed.
See [raster read authority](raster-read-authority-handoff.md) and
[point fusion](source-fusion-point-handoff.md): historical complete accepted input/
envelope/fence and TIFF/native record artifacts are absent. Metadata-schema checks
do not fabricate current accepted envelopes. Current accepted-result admission,
HTTP/PostgreSQL/S3 and full workflow remain unqualified; no native/profile rerun.
No TIFF pixels, point records, additional selections, source acquisition, services,
live writes, provider/model/GPU, geometry, frontend, dependencies, push or deployment.
No property/floor, measurement, rights, learning, scale or release claim follows.

Private final proof:
`E:/BhuAayam-data/task-data/raster-point-sufficiency-20261004-run01/final-02/verification.json`,
13,223 bytes, SHA256
`bb254ec3959d901f9210ded874b980c2eb6acf3453d0b221620822819fb10684`.
It pins three code/check files, 15 unchanged protected paths, seven retained inputs
and six check artifacts, linking the preserved first proof. Earlier XML/IFC branches
remain intact. No task-owned processes/services were started; cleanup is unnecessary.
