# FUSION-01-R — combined-source context review

**Lead correction closure and integration, 2 October:** the lead accepted `3f2cb3e` / `bbaad609` after inspecting the four-path correction, matching completion receipt SHA-256 `e0e0897ea3a9b51fedffa1c1159cced2ea5c2cd6b26de18eddc55a0191089524`, 23 referenced physical pins and four Git pins, and running the focused literal-key regression (one pass, exit 0). The delegated INTEGRATE-02 owner independently matched the completion/proof pins, inspected the correction and integrated original/correction commits as `91e9362`, `63f8a71`, `fffbec1`, `6c74ab3`, then registered the route at `15dd8a9`. Seven integrated service controls, the production EvidenceModule no-listener check, backend/client typechecks and API compatibility checks pass. The prior authority/lock/native review is reused. No further actionable correction issue was established; accept code/local-proof scope only. HTTP/SQL/object persistence, associations, learning and release qualification remain open. See [reconciliation](../finished-work-reconciliation-20261002.md) for exact checks and limitations; the original finding below is historical.

**Return for one narrow P2 correction before acceptance.** The candidate silently removes a supported literal JSON property after calculating the context fingerprint. No additional actionable finding was established in the scoped authority, bounded-reader or controller review. Production registration/export/manifest/generated wiring is intentionally lead-owned and is not a defect.

Reviewed candidate `9ea4e9e6152726c9752262d02c16201612f9ae06`, code `671b4141c81348f95d6d539c4bb53e2a39aa9158`, against base `4f6ca13858823c9453ca14854aa81ed81a2700f1`. Reviewer branch `task/desktop-source-fusion-audit`, worktree `C:/Users/kvina/.codex/worktrees/desktop-ifc-api-review/3d-ulpin`. The prior IFC review branch remains preserved. Read-only staging observation: `d7bba6e91bf49f9f91d255fd7f24a14c6f231b01`; candidate code was not rebased or changed.

## Finding

### P2 — preserve literal JSON before computing the returned context hash

Location: `packages/contracts/src/source-fusion.ts:30–32` and `packages/server/src/modules/usp/ingestion/source-fusion.ts:92`.

An explicitly selected CityJSON object's attributes can legally contain a literal property named `__proto__`. The existing native reader accepts and retains it. Fusion's exact-byte/hash readers and `fusionSourceProjection` also retain it, but `SourceFusionContextSchema.parse` recursively rebuilds the declared value through `z.json()`. Locked Zod 4.6.2 deliberately skips `__proto__` record keys. Because line 92 fingerprints `body` **before** that parse, the successful response silently loses source content and advertises a hash that cannot be reproduced from its returned body. This violates both literal retention and the reproducible context fingerprint contract; downstream consumers cannot verify or reliably bind that response. This is data loss and hash inconsistency, not observed prototype pollution.

One isolated synthetic technical control reproduced the complete local path: the actual native Python reader accepted a 191-byte geometry-free CityJSON object with `attributes: {"label":"technical control","__proto__":{"literal":"must be retained"}}`; its output passed the actual fusion result/artifact byte and SHA checks. Pure context assembly with one unchanged saved reference-document projection succeeded, returning only `{"label":"technical control"}` for those attributes. Returned `contextSha256` was `6b88dc85c380eb59aa3d8ae2b54a17b0d84d1c1774baec20b7cc5ff6c5d551ca`; recomputing the existing fingerprint over the returned body produced `cf3eaf1c65048aeaea9bd891b625d516c9d19955dfd0b5c97f2e09357bc4fd5b`.

Preserve own JSON keys without prototype mutation or silent sanitization, and calculate the fingerprint from the exact validated representation returned. Merely moving the hash after a lossy parse fixes only half the problem. Add one focused regression proving literal retention and returned-body hash equality. Private reproducer: `literal-control.py` then `literal-control.mts` under the review root below. No accepted database job or operational source was fabricated; this is a clearly separated technical control, with authority intentionally uninvoked.

## Reviewed behavior

- Both authority captures acquire sorted case advisory gates, ordered case UPDATE locks and selected-source SHARE locks before existing document/CityJSON job, metadata and accepted-attempt authorities. Prelocking closes the document helper's source-read-before-lock window. The final all-source capture occurs after all artifact I/O and compares input/reader/fence state. Relevant retain/revision/publication and multi-case registry lock paths were traced; no concrete new lock inversion or incoherent capture was found. This is static review, not PostgreSQL concurrency qualification.
- Strict 2–8 distinct sources / 25 selected parts or objects, normalized request UUIDs, stable selection ordering, source namespaces, exact part text/locators/continuations, native incomplete states and redaction detection were inspected. Source membership remains operator selection with relationships, rights, frame alignment and geometry qualification `not_assessed`.
- Bounded stream cancellation, exact result/artifact hashes and lengths, JSON depth/value limits, aggregate reservation, absolute deadline and response cap were compared with existing readers. The private controller's guard/filter, no-store header, 64 KiB / five-second intake and envelope metadata were reviewed. Failures return no partial context. The controller remains unregistered as assigned.

## Evidence and checks

Independent reconciliation matched **28 physical pins**, including the three unchanged originals, and all **seven candidate Git blob / Git-byte SHA pins**. Reviewer checkout code differs only by CRLF checkout representation; original source bytes were not normalized. Owner completion receipt SHA is `84133d607ba7436a149c933a494b32464000d1d1e3bbda20c22fca2715a5fd50`; projection receipt SHA is `99f40fe4ae7315092df3d18ec2d1355bfabbc8357d698842d79ce567b7198d6d`.

The five selected document parts match both their accepted native results and exact original lines/locators; all retained native text hashes and continuation chains reconcile. Both D1 objects, pointers, attributes, hierarchy, geometry summaries and reference/transform declarations match the unchanged artifact, whose source document equals the original. The saved context recomputes to `5e84138f7202679ee38fb15bdd3069f4e3a06c50b4a0c21eb62c6d551925724d`, with 467,537 reserved artifact bytes and 11,902 compact response bytes. The reported defect is absent from these retained real inputs.

The CityJSON metadata reconstruction independently reproduces **1,941 bytes / SHA `c43beea3877c207a49c99f1348f390e7ae92627013f0bfc3cf95a0dc7f4db855`** from saved status and accepted job payload using the existing result schema. Historical accepted-attempt input/completion hashes and the saved bucket key/length agree. It remains a disclosed **reserialization**, not reacquisition of the missing raw result, new extraction or current authority evidence.

Reused hash-verified owner logs: six service controls, one no-listener controller control, backend typecheck and saved-output projection, all recorded exit 0. These were not rerun. Fresh reviewer commands, all exit 0, were limited to:

- `node OWNER/node_modules/tsx/dist/cli.mjs PRIVATE/reconcile.mts` with `TSX_DISABLE_CACHE=1`; final pass includes original-source and exact citation checks.
- `E:/BhuAayam-data/task-data/desktop-ifc-native/env/Scripts/python.exe -I -B PRIVATE/literal-control.py`.
- `node OWNER/node_modules/tsx/dist/cli.mjs PRIVATE/literal-control.mts` with `TSX_DISABLE_CACHE=1`.
- `git diff --check` and `git diff --cached --check` for this owned report.

Here `OWNER` is `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`; `PRIVATE` is `E:/BhuAayam-data/task-data/desktop-source-fusion-review`. All commands used the reviewer worktree as their working directory. Private `review-receipt.json` SHA `271b7fd0c0d6e0fd162ab23131ba0cb2c4e588e73008d5d9955b30b87a53806b` pins scripts/logs/results; `reconciliation.json` SHA is `c14365a9bb6247561d52a3f7dcf93cb0208087d7b9a4255c289b683c63b04aba`; defect result SHA is `7087f0fc2b1bf10fad2c3677898ca8a0fb11e1c7be6d37cf66fec1997e24eb87`.

## Limits and handoff

Current accepted database authority, concurrency and HTTP remain unrun. Reference documents plus foreign D1 exterior qualify heterogeneous projection only: no matched building/floor, Indian operational facts, relationship labels, ML accuracy, geometry/rights qualification or runtime/release pass. Historical producer pins were preserved. Haryana T3-1/T3-2/T3-4 is a separate next planned-set target; G+41/G+42 and the current approved revision remain unresolved. Source discovery was not reopened and review prose was not converted to labels.

Only this report and the assigned private review directory were written. No production/frontend edits, services/listeners/Docker/DB, provider/model/GPU/held-out work, acquisition, push or deployment occurred; no owned process remains. Supplied permissions were `never` / `danger-full-access`. Requested Astra/xhigh/default-standard; actual model, effort and per-turn tier are unexposed. Return this finding and the exact report commit through the authorized lead callback, then stop.
