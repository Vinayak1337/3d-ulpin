# PACK1-IMAGE-03 — queued single-image PDF recovery

Code `59106887a497c61cc686684d1510b9886b0570ba`, base `ff7160639b1e7c7cefbac5b8e226ba7021fe8949`. Exclusive `task/desktop-image-pdf-recovery` in `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`; staging is read-only. Prior card branch/checkpoint `task/desktop-image-pdf-card@e8e1a875` is preserved. Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier is unexposed. Supplied permissions are never/danger-full-access; no settings changed.

## Delivered

The existing enqueue/status/control/independent-worker/private-result flow now accepts confirmed single-original-image PDF plans. It reuses canonical jobs, attempts, fences, outbox and the existing immutable checkpoint table. There is no new public schema, store, migration or source worker. The remaining image queue refusal assertion is replaced by dedicated recovery coverage.

Private image identity/checkpoint versions are `packet-image-pdf-entry/1` and `packet-image-pdf-entry-checkpoint/1`, with the actual image validation variant. Existing `packet-pdf-entry/1` and `packet-pdf-entry-checkpoint/1` parsing, body hashes, identities and output bytes remain unchanged. Identity binds the complete canonical input, plan/confirmation, entry/binding, source, target/snapshot and actor/access pins. A missing checkpoint table refuses before crop or runtime I/O; synchronous execution remains useful.

Accepted entry status stays receipt-only and reports `currentReuseEligibility: not_assessed`. It performs no object, extraction, runtime or profile reads. Crop acceptance alone never exposes a final result. Full source/plan/target authority and owned attempt are recaptured around I/O; exact final packet/execution/command/outbox/job publication remains atomic. Failed or uncertain commits retain immutable bytes under the existing cleanup policy.

Single-image jobs retain one RGB crop, 1.6M pixels, an 8 MiB PDF and 60 seconds including discovery. PDF-page jobs retain their existing execution allowance after authorized recipe capture. Alpha/transparency restrictions and the existing guarded source extractor remain unchanged.

## Current runtime check

`PdfPacketIo.imageRuntime(deadlineAt)` is a separate internal seam from the PDF renderer recipe. The production adapter hashes current image worker/decoder/supervisor code, configured launcher, resolved base Python, effective Pillow `Image.py` and actual `_imaging` binary, outside SQL and without executing Python. The existing Windows Job gate loads base site-packages before appended venv site-packages; hashing the venv native copy would be incorrect here.

Unknown startup hooks, customization, import redirection and ambiguous imaging binaries refuse. Three inspected bootstrap hooks are admitted only at exact `.pth`, source and existing cache hashes: setuptools **84.0.0** (`_distutils_hack`, [origin](https://github.com/pypa/setuptools)); uv **0.12.18** generated virtualenv bootstrap (`_virtualenv`, [origin](https://github.com/astral-sh/uv)); pywin32 **312** portable bootstrap ([origin](https://github.com/mhammond/pywin32)). Their inspected code handles distutils or pywin32 DLL search rather than Pillow resolution. No dependency code was copied or installed; the receipt retains file hashes and attribution. Other layouts need separate inspection and currently refuse.

For both cache misses and hits, current image recipe/interpreter/decoder pins must match the committed binding. Misses check before extraction and again after extraction/staging; hits check before and after the bounded crop read. This file inspection is not a new native/import/readiness pass or a complete executable-closure qualification. Historical runtime profiles remain untouched.

## Actual controlled journey

Evidence root: `E:/BhuAayam-data/task-data/desktop-packet-image-pdf-recovery-20261003`.

- Enqueue accepts without extraction, duplicate enrollment reuses the canonical job, and an incomplete private result refuses.
- Attempt/fence **1/1** accepts the unchanged saved PNG crop; injected later PDF staging failure leaves one accepted checkpoint and no packet.
- Retry under **2/2** preserves that exact checkpoint, reuses the crop and publishes one complete result. Extraction count **1**, crop writes **1**, current-runtime seam reads **5**. Status counts are **0 → 1 → 1 → 1**, with no status I/O.
- Exact private output is **60,397 bytes**, SHA-256 `1893b7bb2bf26b3ebe54b99fbdfd432dd5d1878901bb8a9744043a1ad4f2eb39`, identical to the prior actual image PDF. Its prior journey hash is retained; the new controlled current plan/confirmation is recorded separately without rewriting earlier pins.
- Decoder drift denies reuse before crop reads/extraction. Source revocation denies execution/status. Missing schema refuses before crop I/O while synchronous execution works. A lost checkpoint COMMIT acknowledgement preserves acceptance and recovers after controlled lease expiry with no second extraction.
- A file-only control distinguishes actual base imaging from an unselected venv copy and catches changed native bytes/unknown startup hooks. Read-only inspection of the retained installed runtime also matches all four accepted file hashes and all three recipe-code hashes. No interpreter, decoder or model was launched.

## Checks, evidence and integration

The saved focused command passes **11 checks, zero skips**: five new image recovery/runtime controls, two existing synchronous image controls, three existing PDF recovery controls and projection over unchanged retained historical PDF checkpoints. `pnpm typecheck:backend` was run once after stable implementation and exits **0**. Final staged whitespace check exits **0**; an initial trailing blank line in the new test was removed before the code commit. No broader test campaign or native/renderer run occurred.

Immutable `completion-59106887.json`: **21,204 bytes**, SHA-256 `6149afbb7e46cbd61204943cddc702b2e5013c5470aa734473027f5c1174a66c`. It pins eight owned code files, 26 unchanged protected Git blobs, ten preserved original/prior-evidence files, 17 current runtime/bootstrap files and eight new evidence files. `focused-checks.log`, `journey.json`, denial/missing-schema/uncertain-commit controls and file-runtime observations are retained separately. The receipt excludes itself and has no open writer. Original PNG/JPEG hashes match the unchanged earlier source receipt.

Lead owns review/integration, endpoint wording, API/client/catalogue observations and release ledgers. No public contract changed in this leaf. The existing checkpoint migration is registered but **unapplied**; no live application was attempted. The generated temporary NON-EXECUTABLE filesystem fixture was removed; no owned processes, services or resource reservations remain.

Current HTTP/PostgreSQL/private persistence/contention, migration application, fresh native runtime/full executable closure, authentic property applicability/approved revision/rights/measurement, learning/performance, GF4/release and deployment remain **unqualified**. No frontend, source acquisition, generic infrastructure, native worker/supervisor, runtime configuration/profile, dependency, ML/GPU/provider, push or deployment changes.
