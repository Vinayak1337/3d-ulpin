# KN1 — blocked kind extension; height and zero-target support delivered

Branch: `task/kn1-layout-states-kind-and-height`, base `217f46f2`.
Product commits: `ad4502f3`, `755ce429`, `a9fbd0d6`; harness/contract: `7d755cfe`.

**Missing:** K1/K3/K4 kind support and the five-package automatic intake walk require compatibility guards in two unowned files.

- `packages/contracts/src/usp/streamed-profile.ts:57`: keep streamed-prefix operations/semantic targets on the
  legacy building target schema; widening the shared bounded-manual operation otherwise breaks its meanings map.
- `packages/server/src/modules/usp/ingestion/mapping-plan-v2.ts:383-387`: explicitly refuse generic/stated-kind plans
  in the legacy building adapter, rather than copying `feature.*` into canonical building fields.
- Then restore/build optional kind, generic feature key/geometry/name targets and geometry-by-kind validation
  as specified in `step0.json`; the precise compile refusals are in `kind-blocker.json`.
- Keep adaptive/streamed behavior unchanged. No unowned file was edited, merged or pushed.

`runtime.json` passes the **partial** walk: five retained, one building package drafted/prepared,
1,661 targets ready/recorded, three carded. Feet fixture parity passes over both actual HTTP imports.
Hydrography preparation/confirmation/recording passes only as an explicitly scaffolded seam control.
The other case refuses its confirmation. This is **not** a five-package gate pass.

The pack's `README.txt` and `source-info/manifest.json` do not document building height unit/meaning.
NYC height stays unknown. Historical CA0 stored plan bytes are absent from its saved receipt;
the new persisted CA0-shaped plan retains its bytes/hash/approval under parsing, but is not those historical bytes.

Recheck: `node docs/evidence/gf1/kn1/run-runtime.mjs <new-receipt.json>`.
All nonce-owned containers were removed. Never use the demo or a populated volume to resume.
