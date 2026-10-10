# POINT-02 — bounded staged point publication

3 October 2026. Code `8e4e2976a459e28385ca88f7c8fbe585c1abda65`, base
`188bdfd651c3078a6c2d72aa0fa64ae1acbe5cd3`; exclusive
`C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch
`task/desktop-point-bounded-publication`.
[Assignment](../../orchestration/PARALLEL_20261003.md#next-independent-implementation--point-02-bounded-staged-publication).
Preserved fusion branch remains `99a82a86`; staging was observed at the assigned
base and kept read-only. Requested Sol6.1/xhigh/default-standard; actual
model/effort/tier unexposed. Supplied permissions: never/danger-full-access.

The existing worker reuses accepted raster publication and point bounded reads.
Success/error HTTP bodies are byte-capped before JSON/base64 materialization;
streams are cancelled on overrun, cancellation or deadline. Exact canonical
base64 length/bytes/hash and nullable first/explicit batch semantics are checked.
Conditional PUT replay and staged receipt/artifact verification use exact keys,
known sizes, hashes and counted bounded streams; no generic `readObject` remains.
All native/object I/O finishes before canonical fenced acceptance takes locks.

Acceptance binds the frozen preflight to exact enrolled manifest/hash/scope,
current source/case/access/reader, input and owned attempt/fence. Canonical success,
completion digest and outbox commit atomically through the unchanged job authority.
Preflight never waives current authorization. Accepted replay returns without
reprocessing. Ambiguous claim/accept COMMIT preserves possibly durable state and
outputs for a fresh authoritative read, with no terminal rewrite, deletion or
destructive retry.

One 150-second operation starts before lookup/claim, inside the existing
180-second lease. Native fetch/body uses the smaller operation/100-second deadline.
Terminal bookkeeping has a separate two-second bound and preserves accepted,
cancelled, paused, newer and unowned active attempts, including expired unowned
attempts. It obtains source/case locks before job locks and reauthorizes private
failure events; revoked/stale sources receive no such event. Process/parent stop
signals cancel owned transport; listeners and streams are cleaned up.

Original/artifact/receipt caps stay 16 MiB/512 KiB/32 KiB, with 8192 points per batch.
The native success wire ceiling is 731,820 bytes: maximum artifact base64 plus
the existing receipt ceiling; the existing base64 schema ceiling remains 720 KiB.
Native error bodies are capped at 32 KiB. Known out-of-range, source-integrity,
unsupported and unavailable behavior remains; no native reader/contract changes.

Final verification: `pnpm exec tsx --test tests/point-publication.test.ts
tests/source-fusion-point.test.ts` passed 10/10, zero failures/skips; five changed
publication controls and five affected point private-read/fusion controls.
`pnpm typecheck:backend`, whitespace and exact pin checks exited 0. An earlier
revocation assertion was corrected to the established `POINT_DENIED` code.
No accepted raster/packet/native campaign reran.

Private proof root: `E:/BhuAayam-data/task-data/desktop-point-bounded-publication/final-01/`.
`verification.json` SHA256
`fed12938e66d93af4bfd66f326db2ae01d64c5a44ef3ad7481e041533ab917f3` records
three code, 45 unchanged protected Git-object, six retained input and ten proof pins.
The controlled publish/replay accepts fence 1 with a 3,798-byte receipt SHA256
`707596f5fe70c0b5d4e76d9c286debc5f1dbab686ecc314c2f22b482a951f0ba` and
245,760-byte explicitly NON-NATIVE transport SHA256
`90f0135e231e6d9283031ad5aaae29fd4d66a3b5613aec56d564e5b1ab05ff83`.
Four bounded reads verify conditional replay/preflight; all I/O occurs outside SQL.
The verification's `metadataSha256` hashes UTF-8 `JSON.stringify(metadata)`;
it is a technical byte pin, separate from fusion's canonical metadata fingerprint.
Other saved controls cover stale/revoked/cancelled/paused/newer/enrollment denial,
wire overrun/cancel/timeout, exact batch/error handling and a lost COMMIT reply.

Retained NYC original/first/later metadata and manifests remain unchanged. The
historical directory still contains only two JSON receipts; native `.bin` artifacts
and full input/envelope/fence are absent. Inputs/authority/SQL/storage/HTTP and
NON-NATIVE transport bytes are controls; no historical native proof was recreated.
Parent COPC bytes were not reread/decoded. Current HTTP/PostgreSQL/S3, native
accuracy, real durability, geometry/alignment/applicability/learning/scale/release
remain unqualified. No acquisition, native/parser, services/Docker, provider/model/
GPU, runtime/profile/dependency, frontend, push/deploy or public activation occurred.

Only point worker/publication helper and focused check changed. Generic primitives,
source protection, contracts/native, fusion, registry, packets and ML stay unchanged.
Lead owns review/integration/catalogue/ledger; no route or wire schema changed.
