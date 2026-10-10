# RASTER-03 — bounded staged raster publication

3 October 2026. Code `34747ef4f1380e5928f8d31ab48743e84b622e81`, base
`1d90fd65e0b1ed71382b1d69be8a5e529d1b57f8`, branch
`task/desktop-raster-bounded-publication`, exclusive checkout
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`.
[Assignment](../../orchestration/PARALLEL_20261003.md#next-independent-implementation--raster-03-bounded-staged-publication).
Preserved accepted-read branch remains `ebff97f5`; staging was read-only.
Requested GPT-6.1 Sol/xhigh/default-standard; actual model/effort/tier unexposed.
Supplied permissions: `never` / `danger-full-access`.

The raster worker now verifies staged receipt/artifact bytes outside SQL locks,
then binds their exact hashes and lengths to canonical fenced acceptance. Final
acceptance rechecks source/current case/private access, registered input
manifest/hash/scope, payload, active owner/fence/input and lease; the accepted
result and completion/outbox remain atomic. A successful preflight cannot waive
those checks. Possibly committed results survive `DbCommitOutcomeUnknown`
without terminal failure or retry. Terminal bookkeeping has its own two-second
bound and preserves accepted/cancelled/paused/newer-owner state; stale or revoked
source context cannot emit private failure events.

The narrow `raster-publication.ts` helper streams a maximum 6 MiB native success
reply before JSON/base64 materialization; 422 details use the existing 32 KiB
receipt cap and recognized error codes remain. It cancels owned response bodies
on refusal/abort, checks exact canonical base64 length/bytes/hash and retains the
4 MiB artifact cap. Native fetch/body share at most 100 seconds; one 150-second
deadline covers lookup, claim, transport, bounded staging/preflight and acceptance
within the canonical 180-second lease. SIGINT/SIGTERM stop owned transport;
listeners and operation timers are removed afterward.

Signal-bearing canonical `putOriginal` verifies bounded successful/replayed
writes. Uncertain PUT recovery uses the accepted raster reader with exact known
length/hash and content-addressed key, never generic `readObject`. The worker
preflight also reads its small receipt with the known staged length, avoiding
legacy HEAD discovery. Existing reader/contracts/config, generic jobs/storage/db,
source protection, dispatcher, frontend and native runtime remain unchanged.
No API/controller/root export/generated schema changes are needed; production
entry remains `runRasterWindowJob(jobId)`.

Verification: `pnpm exec tsx --test tests/raster-publication.test.ts
tests/raster-read-authority.test.ts` exits 0, nine passes/no skips;
`pnpm typecheck:backend` exits 0 for server/API; staged whitespace exits 0.
New focused controls guard the actual publication/transport regressions: one
canonical publish/replay, final stale/cancelled/newer-owner/enrollment refusals,
wire overrun/cancellation/timeout before staging and a lost canonical COMMIT
reply without destructive bookkeeping. Native/storage/SQL are explicitly
controlled; actual canonical claim/assert/accept/deadline/outbox code executes.
Retained first-window metadata preserves EPSG:2263, float32 finite nodata,
unknown vertical reference and `globalPlacement: not_qualified`.

Private proof: `E:/BhuAayam-data/task-data/desktop-raster-bounded-publication/final-01/`.
`verification.json`: 10,637 bytes, SHA256
`ec456faf1d12280db7c537c3296b9d78ac906c631f2fd95c231d844017c12f4b`;
three code, seventeen unchanged protected, five unchanged retained and seven
evidence pins. Concrete receipt/technical bytes, outcomes and logs are retained.
Initial checks failed before staging because the isolated fixture omitted
`GEO_URL`, then used the wrong test token variable; corrected test-only values
are restored afterward. `initial-failures.json` preserves those observations.
Temporary error diagnostics were removed before final checks.

Historical downloaded window TIFFs/full accepted envelopes/inputs/fences remain
absent, as recorded in [RASTER-02](raster-read-authority-handoff.md). Current
control inputs/receipts/fences and NON-TIFF technical bytes do not recreate that
proof. The original crop remains 989,186 bytes, SHA256
`955d7f051c26cc2a26b7a1e9c00bacb9f4e96b6b5611c716d56be6d91e11d317`;
both historical receipts and manifest remain unchanged. No native/parser/model/
provider execution, acquisition, services/Docker, runtime/dependency changes,
push/deploy or owned process. Current HTTP/PostgreSQL/S3 durability and real
transport timing, accuracy/global placement, learning and release gates remain
unqualified. Lead owns integration and any catalogue/publication update.
