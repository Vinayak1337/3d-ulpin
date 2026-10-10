# RASTER-02 — exact accepted-window private reads

3 October 2026. Code `ab270e40da81e1bdce68dad768cf3acaa5c10058`, base
`39025e69f8aa3636baa44c65e5351911f1d8b977`, branch
`task/desktop-raster-accepted-read`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`.
[Assignment](../../orchestration/PARALLEL_20261003.md#next-independent-implementation--raster-02-accepted-window-read-authority).
Preserved GeoParquet branch remains `ec3a56de`; staging was read-only.
Requested GPT-6.1 Sol/xhigh/default-standard; actual model/effort/tier unexposed.
Supplied permissions: `never` / `danger-full-access`.

Private status/artifact reads now require the exact registered input and
accepted attempt rather than `jobs.status` alone: job/case/source/operation,
payload fingerprint, input manifest/hash/scope, metadata logical state, positive
accepted fence, accepted attempt/input/completion hash and exact result ref.
Each read captures canonical source/current reader/access and job pins under
short case/source/job/metadata SHARE locks. It releases locks for object I/O,
then fully recaptures before returning. Result/fence drift and post-I/O source
revocation deny disclosure. Stable queued/running/failed reader-outage and stale
statuses remain useful without object reads.

The narrow `raster-window-object.ts` helper is necessary because existing
`raster:<jobId>` refs omit byte length. A temporary HEAD-only S3 client using
existing storage settings obtains length/ETag, refuses receipts above 32 KiB
before GET, then uses canonical `openObjectStream` with exact length/IfMatch.
Artifact reads use the accepted byte count directly, capped at 4 MiB. Both paths
count/hash bytes before publication, destroy streams, and share one 30-second
absolute SQL/storage deadline. The metadata client is destroyed after HEAD.
No generic storage/config/credentials/dependency or writer schema changes.

`readRasterResult(input,hash)` stays backward compatible; optional deadline/read
dependencies support the scoped controls. It verifies exact input, artifact
key and selected pixel window. A nullable first-window input still means
`(0,0,min(256,width),min(256,height))`. Explicit request/retry and wire schemas,
four routes, native reader and private `no-store` response remain unchanged.
Lead integration needs these two server files and the focused check; no new
registration, root export or generated schema is required.

## Verification and evidence gap

- `pnpm exec tsx --test tests/raster-read-authority.test.ts`: exit 0, five
  passes/no skips. Preserved first-window metadata; unenrolled/unaccepted refusal
  before I/O; status fence and artifact result changes after I/O; source
  revocation; queued/running/failed-outage/stale compatibility; oversized HEAD,
  excess bytes/hash mismatch and expired deadline refusal.
- `pnpm typecheck:backend`: exit 0, server/API. Staged whitespace: exit 0.
- Unchanged original crop: 989,186 bytes, SHA256
  `955d7f051c26cc2a26b7a1e9c00bacb9f4e96b6b5611c716d56be6d91e11d317`.
  Both prior receipt hashes still match the [raster handoff](raster-window-handoff.md).
  EPSG:2263, finite nodata, unknown vertical reference and unqualified global
  placement remain literal metadata; no new elevation/accuracy claim.

**Historical downloaded window TIFFs and full accepted envelopes are absent
from the recorded private evidence directory.** The retained smoke script
hashes the downloaded buffer without saving its bytes, and saved status omits
input/result-object hash/fence. The original DEM crop and old receipts remain
unchanged; stopped service volumes were not accessed or reset. Tests explicitly
reconstruct current input/envelope/job authority in memory using retained
metadata. Artifact final recapture uses labelled non-TIFF technical transport
bytes, never historical/native source proof. No fabricated or regenerated
historical artifact, successful current HTTP/SQL/S3 execution or new runtime
gate is claimed.

Private proof: `E:/BhuAayam-data/task-data/desktop-raster-accepted-read/final-01/`.
`verification.json`: 9,377 bytes, SHA256
`b8be9dde0e7bdda3cae4b6142ec3edf1e5a0ee5ada5483b90691429a60186d57`;
three code, fourteen unchanged shared/native/publication paths, five retained
inputs and six check artifacts. Concrete status and denial controls are saved
separately. An initial metadata-pinning command exceeded Node's stdout buffer
for OpenAPI; protected Git object IDs replaced that read without raising
transport limits. Product checks were unaffected.

Separately observed, unchanged writer scope: `raster-window-worker.ts:18` replay
and `:87` staged artifact verification still use unbounded `readObject`; the
`:86–87` validator also keeps object I/O in its accepted-writer SQL scope.
This read-only assignment does not correct that writer path. Generic source
protection/jobs/dispatcher/fusion/registry/native/runtime/frontend/ML remain
unchanged. No native/provider/source run, services/Docker, dependency/runtime
change, push/deploy or owned process. Current HTTP/persistence/storage and
accuracy/learning/release qualifications remain open.
