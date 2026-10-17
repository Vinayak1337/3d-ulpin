# FUSION-POINT-01 — accepted point metadata and bounded private reads

3 October 2026. Code `939dee54bc64e00e05c24feec269ba8a21911e4a`, base
`f1343eb9ca79a3220625f4bebae98b68b1f2caf2`, branch
`task/desktop-fusion-point-context`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`.
[Assignment](../../orchestration/PARALLEL_20261003.md#next-independent-delivery--fusion-point-01-accepted-batch-metadata).
Staging was observed at the assigned base and kept read-only; preserved raster
fusion branch remains `5319af14`. Requested Sol6.1/xhigh/default-standard;
actual model/effort/tier unexposed. Supplied permissions: never/danger-full-access.

The existing private `POST /api/v1/usp/evidence/source-fusion/context` accepts an
additive `kind: point` selection: common exact source/job/result/input/reader/
accepted-fence pin, artifact SHA256, metadata SHA256 and explicit batch start/count.
One batch metadata fragment counts toward the existing 25 selections. The adapter
uses canonical `pointBatchCaptureTx`, captures exact registered manifest/hash/scope
and accepted attempt/input/completion/result, and recaptures the entire selected
set after I/O. No object read occurs inside those SQL locks.

Private point status/artifact reads now use the same full capture before and after
I/O under one 30-second deadline. Legacy receipts are HEAD-capped at 32 KiB before
exact-length/ETag GET; artifacts are capped at 512 KiB before GET. Streams count
and hash every byte and are destroyed. `readPointResult(input, hash)` remains
compatible, with optional bounded dependencies. Nullable first-batch semantics
require start 0/count min(8192, sourcePointCount); pending/running/outage/stale
statuses remain useful without object reads. No point writer/native code changed.

Fusion reads only the accepted receipt using the same mutable aggregate budget.
It preserves source point count, LAS version/format/encoding, dimensions,
scale/offset/bounds, CRS/vertical/GPS state and field layout literally, omits private
object keys and states `pointRecords: not_read` and
`artifactVerification: accepted_receipt_reference_only`. Existing 2–8 sources,
25 fragments, 64 MiB aggregate, 30 seconds and 1 MiB response bounds remain.
Association/manual proposal projection and registry citations explicitly refuse
point metadata. No coordinate decoding, statistics, alignment, identity,
global-placement promotion, rights or learning qualification follows.

Final checks: `pnpm exec tsx --test tests/source-fusion-point.test.ts
tests/registry-geoparquet-citations.test.ts` passed 7/7, zero failures/skips; five
point controls and two affected old citation controls. `pnpm typecheck:backend`,
working/staged whitespace checks and exact pin verification exited 0. Tests prevent
the observed unbounded/stale private-read regressions and whole-context publication
after source/accepted-authority drift. No accepted raster/native campaign reran.

Private proof root: `E:/BhuAayam-data/task-data/desktop-fusion-point-context/final-01/`.
`verification.json` SHA256
`9d8ccefebb462c38e3df2c62ecf4c870334a35c016d65a11ef2c22a324f81c36` records
12 code, 41 unchanged protected Git-object, six retained input and ten proof pins.
`mixed-context.json` SHA256
`b2c0ec3359174fb3c049d7768d6e6a8cd47adaa996a699718f103528db586655` contains
the exact request and concrete 6,668-byte context SHA256
`9c8565f69b78213e3ea7d71b70c08ca96e0161ec478f33da27eeaf00b6d0545b`:
two full-set captures, two receipt reads/24,145 aggregate bytes, retained first
8192-point batch metadata and literal EPSG document text `RD + NAP height`.
Source-set membership establishes no applicability or frame alignment.

The unchanged 11,110,715-byte NYC derivative SHA256 `8c565f32…` and first/later
HTTP metadata receipts were rehashed. The inspected historical point directory
contains only two JSON receipts: native `.bin` artifacts and complete input/fence/
accepted envelopes are absent. Current input/envelope/fence/SQL/storage/document
authority are reconstructed controls; the epoch result timestamp is technical,
not recovered history. Artifact transport uses 245,760 explicitly NON-NATIVE bytes
with a distinct hash. No decoder or native process runs. Parent COPC remains outside
the upload profile; its bytes were not reread/decoded. Native accuracy, current
HTTP/PostgreSQL/S3 operation, geometry, Indian applicability, scale and release
remain unqualified.

Separate unchanged writer findings in `point-batch-worker.ts`: lines 16–18 buffer
`putExact` replay through generic `readObject`; lines 28/36 parse native HTTP JSON
before bounds; lines 84–90 perform receipt/artifact I/O under fenced acceptance
locks, with artifact `readObject` still unbounded; lines 96–99 route ambiguous
acceptance errors through ordinary failure handling without writer-specific outcome
reconciliation. The failure helper does preserve an already-succeeded job when its
fresh read observes success; no corruption was reproduced. Shared `readPointResult`
now bounds that writer's receipt indirectly. Writer replay/artifact/native handling
and generic job/storage authority remain unchanged and require a separate assignment.

Lead owns review/integration and final leaf exports, API/client/operation notes,
catalogue and ledger publication. No source acquisition, services/Docker,
provider/model/GPU, runtime/dependency changes, frontend, push or deployment occurred.
