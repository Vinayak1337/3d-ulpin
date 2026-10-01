# FUSION-04 aggregate-authority closure

2 October 2026. **The original revocation P2 is closed. Return one consequential P2 before integration:** the new exclusive case locks can deadlock with canonical snapshot capture's differently ordered shared case locks. No broader review or source/model campaign was reopened.

Correction `9a5117e5a0f26c268f0c7ade5ba931ae7843c2d4`, handoff `f7dec9ccfc36ff2e1b161e93cf85f34371965b09`, base `dd8f761586449f810cd2ff2adf93e877e2f0785b`. Reviewer branch `task/desktop-fusion-association-closure` in `C:/Users/kvina/.codex/worktrees/desktop-ifc-api-review/3d-ulpin`; original review branch remains at `81923531ebacbf4bec7603da7a104288fbe55f6a`.

## Original P2 closed

The producer uses `associationTargetAuthority` for initial capture and every existing authorization callback, including final no-config return and gateway replay/pre-dispatch. After legacy projection reads, it discovers ordinary evidence, citation sources, snapshot sources and copied-source lineage before destination locks. It protects the complete discovered set, rejects source/manifest/body drift, checks current targets and all source/site authority, then releases before returning to the gateway. Ordinary readiness and exact snapshot/current-record comparisons remain; snapshots are append-only in the current writers. No transaction spans provider I/O.

Fresh execution of **complete target authority** passed, exit 0: both original A-then-B archive schedules deny with 403 and **zero injected fetches**; the healthy actual-gateway/adapter control reaches one injected fetch with **zero active transactions**. This remains memory SQL/ledger proof. The preserved legacy substitutions reproduce the original failures. No further authority bypass was established in the correction.

## New P2 — case lock order conflicts with snapshot capture

Location: `packages/server/src/modules/usp/ingestion/document-association-targets.ts:128–129`, particularly the new `ORDER BY id FOR UPDATE` case query.

Sorting these exclusive locks does not coordinate with every existing participant. `snapshotRows` reads site sources in **source-ID order** (`snapshots.ts:73`) and calls `captureDocumentSourceTx` sequentially (`snapshots.ts:93`). That authority takes **case `FOR SHARE`** locks (`document-authority.ts:29,57`) through the snapshot transaction, without the new helper's advisory gates. Source-ID order need not match case-ID order. The production snapshot service invokes this path (`apps/api/src/modules/evidence/evidence.services.ts:43`).

With two canonical document cases A < B whose source IDs sort B before A, a concurrent proposal authority check and snapshot capture can form this wait cycle:

1. Snapshot capture holds B `SHARE` and has not yet reached source A.
2. The new authority holds A `UPDATE` and waits for B `UPDATE`.
3. Snapshot capture requests A `SHARE` and waits for the authority.

The case advisory gates do not serialize the snapshot path. These can be snapshot-only document cases, separate from the selected fusion sources, because the correction now locks the whole snapshot source population. Ordinary concurrent snapshot/proposal requests can therefore fail through deadlock detection or deadline cancellation. This is a reliability/lock-order finding, not a stale-data publication or provider-disclosure claim.

`closure/lock-order-probe.mts` invokes the actual corrected `associationTargetAuthority`, actual `captureRegistrySnapshot` and canonical document authority, using valid unpersisted technical document/target controls. Its memory row-lock transport records exactly those opposing SQL requests and terminates the modeled cycle. **Exit 0; zero writes; zero remaining transactions.** It does not run PostgreSQL or claim measured detector timing/victim selection. The existing correction regression tracks protections on one flow and therefore does not catch this schedule.

Make the new case protection compatible with canonical snapshot readers while retaining archive/source-family mutation protection, or coordinate a common complete lock order before any case row is acquired. A compatible read-lock mode may suffice here; verify it against the actual mutation paths. Preserve the original revocation regression and release before external I/O. No production fix was made by this reviewer.

## Evidence and checks

Matched correction receipt **14,478 bytes / SHA `ae30a7d13cd53c7492adcbdd5a49e54d066bd88486d71608118e8760b84ce25f`**, all **26 physical references**, **three changed code/test Git pins**, **eight unchanged authority Git pins**, and six additional unchanged writer/probe dependencies. Only code checkout CRLF was reconciled with Git; original and retained evidence bytes were checked unchanged.

Reused verified logs for **10 affected producer/preview controls** and server/API typechecks, all final exit 0. Fresh verification was the one original regression, the concrete lock-order probe and reconciliation, each exit 0. The original literal/context proof, quotation/identifier/manual-selection review and model/gateway review are reused. No current source or inference qualification follows.

Private evidence root: `E:/BhuAayam-data/task-data/desktop-fusion-association-proposals-review/closure/`. Commands ran from the reviewer worktree. Use `TSX_DISABLE_CACHE=1` with `node OWNER/node_modules/tsx/dist/cli.mjs --test --test-name-pattern="complete target authority" OWNER/tests/usp-source-fusion-associations.test.ts`, or `node OWNER/node_modules/tsx/dist/cli.mjs PRIVATE/lock-order-probe.mts`; reconciliation is `node PRIVATE/reconcile.mjs`. `OWNER` is the read-only `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, `PRIVATE` is the closure evidence root.

- `review-receipt.json`: **4,975 bytes**, SHA `e4e88d09dbfe40eb6df2d1c6a266a5c9e8e5c738e15faa3f43425f4792057a1f`.
- `lock-order-result.json`: **2,910 bytes**, SHA `59a2023348847ccd3de4eb7d1e5fe0a01d55b08faff11626fdebd5ae3c74f4c8`.
- `reconciliation.json`: **14,428 bytes**, SHA `2ea2c746735ec8278e7dcd5a0d4b5662fc2df266923a916a5dd69a5e2de8eabf`.

Only this report and fresh private closure evidence were written. Staging remained read-only at observed `0b4f382e5f8f766896b3db36006763082bd36a86`. No services/listeners, DB/Docker, provider/model/GPU, acquisition, frontend/generated/packet changes, push or deployment; no owned process remains. Current persistence/HTTP/concurrency, authentic matching, model quality, learning and release remain unqualified; unavailable historical OCR bytes and USGS/Haryana limits are unchanged. Supplied `never` / `danger-full-access` verified; requested Astra/xhigh/default-standard, actual model/effort/per-turn tier unexposed. Return this report commit through the authorized lead callback, then stop.
