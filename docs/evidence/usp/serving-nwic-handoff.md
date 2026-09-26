# SERVE-NWIC-01 — native installation and exact-intent replay

The new `scripts/db/serving-nwic-import.ts` installs the retained NWIC district ZIP through the native source-case, bounded original upload and projected-vector authorities. It returns native case/upload/source/job IDs and private read URLs in a durable receipt. This worker has not installed NWIC into the serving database; lead review and execution remain required.

Base: accepted `9de6d41c2fd6c6606b40a70e07d4a977e2a20744`; branch `task/serve-nwic-01`; retained owner checkout `/Users/vinayak/.codex/worktrees/db-ready-01/3D Ulpin`. Owned paths are this handoff and the new installer only. No serving-common, SQL, contracts/services, TILE-01, generated API docs, ledger, frontend, environment or serving process changes. Requested lane: Sol/max/Fast; configured priority was previously observed, per-turn model/effort/tier metadata is unavailable here.

## Source and boundaries

- Reuses the unchanged private original named by the [accepted acquisition receipt](nest-migration/nwic-boundaries/source-check.json), [manifest](../../../fixtures/usp/D3/nwic-boundaries-v1/manifest.json) and [admission profile](../../../fixtures/usp/D3/nwic-boundaries-v1/vector-admission-profile.json). No discovery, download, ZIP extraction or member rewrite.
- Original: 71,238,839 bytes; SHA-256 `44c734cc72139f2447dcebfe2791cac862dc5ba265e158912d797cf3410d5c37`. Member pin: `2b27a478e24d8c51b0655e74ce3f4f880e75c752e4597550d6fc925ed06ac201`, 168,356,689 bytes. Installer SHA-256: `da549bbaa056dace13ce7cc093518f9de9184b80691486d529b8111bb7aa883a`.
- Hashes the ZIP with a 1 MiB buffer; sends nine sequential parts, each at most 8 MiB. Original download verification streams/hash-checks without collecting the whole object. Metadata/geometry responses and files, SQL, API calls and polling have explicit bounds; the API invocation budget is ten minutes.
- Uses only native API writes. The selected database pool is read-only and attests target, request records, ownership, source pins and accepted observation counts. No migration, DML, object-store write, alternate registry or job-state/lease/test control.
- Accepts 733 dispositions, 720 admitted and 13 quarantined, with the accepted EPSG:7755→4326 transform, parser/PROJ database hashes, unchanged sampled properties and private geometry/original reads. Quarantined geographic output must return 422; remote-origin metadata and original reads must return 403. It records the actual IDs and links; it does not qualify UI, tiles, scale, survey accuracy/currentness, buildings, heights, rights or ML training.

## Guard and recovery contract

The lead must verify the exact API loaded code and configured operator subject from the same inspected launch. `--verified-api-code` must equal the clean installer checkout HEAD. Health independently verifies the database target and executed SQL manifest; it does **not** attest process code, actor or human authentication. The receipt labels that external launch basis. Explicit environment resources must match effective server configuration; the supplied operator must match the upload and retained source owner before byte transfer/conversion.

Use one saved UUID `--operation-key` for this installation. It derives separate stable native request UUIDs for case, upload, each part, finalization and projection; it does not derive source/unit IDs. Before every API mutation, the exclusive mode-0600 summary and journal are fsynced with the exact request intent. Replays recover native records by these keys, compare canonical native request fingerprints, reuse original create/admission revision pins, skip confirmed parts and retained finalization, and replay the existing projected operation. The same operation cannot silently adopt another actor, original, parser, source revision or job. Existing different/ambiguous NWIC records are refused.

Each attempt needs a **new** `--out` path; preserve all previous summaries/journals and the operation key. An interrupted request is reconciled from native status on the next attempt. Active receipt/part finalization or queued/running processing returns exit 2 (`pending`); no replacement operation/job is created. Only ordinary native expiry/retry behavior may resume an incomplete upload. Failed/stale processing or aborted/changed context returns exit 1 and needs lead review; never reset records, change leases, abort history or switch operation keys to bypass it. Success returns exit 0. A succeeded replay checks the same native IDs and original integrity again.

## Lead invocation

After review/integration, run from the clean serving checkout against its separately verified launch. Keep providers disabled and preserve its existing resources. Save the operation key once outside Git, before the first attempt. Replace the launch placeholders with the already verified values; do not infer code/actor from health.

```sh
serving_root='/Users/vinayak/.codex/worktrees/0922/3D Ulpin'
cd "$serving_root"
pnpm exec tsx scripts/db/serving-nwic-import.ts \
  --operation-key '<saved UUID>' \
  --environment-file '<absolute selected serving environment file>' \
  --api 'http://127.0.0.1:3188/api/v1' \
  --expect-code '<clean reviewed serving HEAD>' \
  --verified-api-code '<same inspected API launch HEAD>' \
  --verified-api-operator '<same launch configured operator subject>' \
  --expect-target '<verified database target token>' \
  --expect-manifest '<verified executed SQL manifest SHA-256>' \
  --poll-seconds 120 \
  --out '<new absolute private receipt path>'
```

Replay that invocation with the **same operation key and source/actor intent**, a fresh receipt path and freshly verified launch pins. The original path defaults to the accepted retained acquisition path; optional `--original` must resolve to that exact outside-Git original. `--environment-file` deliberately avoids the `tsx`/Node `--env-file` preload collision. For foreign-CWD execution, use the absolute checkout `node_modules/.bin/tsx` launcher and absolute script/environment/output paths.

## Worker verification

- `pnpm exec tsc --noEmit --strict --allowJs --checkJs false --module ESNext --moduleResolution Bundler --target ES2022 --lib ES2022,DOM,DOM.Iterable --esModuleInterop --skipLibCheck scripts/db/serving-nwic-import.ts`: exit 0 on the final installer. Initial unresolved root-level zod/contracts imports were corrected to the existing relative contracts entry point; no dependency change.
- `pnpm exec tsx .runtime/serve-nwic-01/inert-controls.ts`: exit 0. Private controls verify native-compatible UUID replay keys; stream/hash the actual retained ZIP into nine bounded parts; exercise no-buffer reads, declared/actual length bounds and stalled-read cancellation using retained official metadata; and verify foreign-CWD CLI refusal before environment/DB/network with exclusive 0600 summary/journal. A preliminary control launcher used `pnpm exec` from `/tmp` and failed before CLI start; the absolute owner `tsx` launcher corrected it.
- Private control evidence remains in the owner checkout under `.runtime/serve-nwic-01/`; it contains request identities and official integrity metadata, no invented operational records. `git diff --check` passes. No runtime starts, API calls, database connections, linked mutations, downloads, provider calls, environment writes or serving stale-case/lease manipulation occurred during worker verification. Runtime replay, serving IDs and API usability remain unverified until the lead executes the guarded tool.
