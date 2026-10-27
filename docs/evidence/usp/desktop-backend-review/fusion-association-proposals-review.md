# FUSION-04 — grounded association proposal review

2 October 2026. **Return for one P2 correction before integration:** the new producer's authorization can accept a stale first target while checking a later target. This affects final responses and the last authorization before provider dispatch. No other actionable finding was established in the six-file delta. Completed fusion/citation/source/model reviews remain closed; missing registration/publication is lead-owned.

Code `06f80babd844c4e0c21d2c6df5de495da6e7421e`, handoff `dd8f761586449f810cd2ff2adf93e877e2f0785b`, base `e218ff37d1536482fe195153b246dc12ebf8dd74`. Review branch `task/desktop-fusion-association-review`, worktree `C:/Users/kvina/.codex/worktrees/desktop-ifc-api-review/3d-ulpin`; citation closure branch remains preserved at `9268792bfb7a4025ae2681ac13c407a752036228`.

## P2 — authorize the complete target/evidence set before dispatch and return

Location: `packages/server/src/modules/usp/ingestion/source-fusion-associations.ts:83–86`, used at gateway admission and the final check at line 145. The default `associationTargets` checks each target in its own transaction (`document-association-targets.ts:49–73`) and releases the first target's authority before checking the next. Equality with the previously captured array only compares those sequentially captured projections. The subsequent citation-site check covers selected extraction documents, not the targets' separate ordinary recording-evidence sources.

Concrete schedule: select current targets A and B, each with a separate ordinary evidence source. After A's check commits, archive A's evidence-source case while B's source check runs. B remains valid. The helper returns the previously collected A projection with `sourceEvidence:'available'`; the array fingerprint still matches. No check of A remains before this `authorize` invocation returns. A fresh invocation immediately denies A with **403 `REGISTRY_SOURCE_DENIED`**. These unlocked, separate transactions permit this schedule; the disclosed absence of joint atomicity has an observable consequence.

The private `target-authority-probe.mts` reproduces both consequences with the actual target/snapshot/source helpers and memory SQL transport:

- **Final no-config check:** returns `state:'unavailable'` with both target identifiers and A still marked `sourceEvidence:'available'`, although A's source case is already archived. No provider operation occurs.
- **Last pre-dispatch check:** actual `ModelGateway` and `SarvamAdapter`, using a memory ledger and injected fetch, invoke that fetch **once with A's identifier after A is archived**. The later authorization rejects the request with 403 and suppresses the response, but cannot undo the earlier dispatch. This is a technical transport spy, not an actual provider call or observed real-data disclosure.

The selected fusion context and its site check are isolated dependencies in this probe; A's ordinary evidence source is deliberately distinct from the selected extraction sources. Production citation-site checking does not cover that source either. No production code or database row is mutated by the probe. The archive is a scheduled memory representation of a separate committed update, not an implementation callback.

Give this producer a bounded aggregate authority check for the complete selected target/source/site set, preserving case-first ordering and exact snapshot/current-record checks. Hold the relevant authority protections through the complete check, and use it before dispatch and final publication, including no-config/replay paths. Do not hold a transaction across provider I/O. Add one regression for revoking an earlier target's evidence during a later target check. A second sequential scan or the eventual post-provider denial alone does not close the gap. Coordinate any necessary shared-reader factoring with the lead.

## Remaining review and evidence

Exact eligible native/OCR quotations, selected keys/ordinals, target identifier scheme/value, full-literal ambiguity beyond the model excerpt, redaction exclusion and model-abstention suppression were traced. CityJSON remains contextual. Reduced `manualSelection` preserves source pins, narrows document fragments and rebuilds the same context shape expected by `addFusion`; the existing adapter still reauthorizes before amendment. Suggestions remain proposed/not-assessed and create no registry relationship or learning label.

The server-owned gateway profile uses one attempt and durable invocation identity, source/input/config pins, existing minimization and reservation/dispatch/settlement semantics. Strict schema and request/prompt/output/response bounds remain. Deadline checks suppress late publication; the production adapter reauthorizes before fetch and its transport uses the gateway timeout signal. Existing target queries are not actively canceled, as disclosed. The reproduced aggregate-target gap is the identified authority exception; no separate deadline, routing or credential defect was established.

Matched completion receipt **16,627 bytes / SHA `917e218e2b17271752930f0ee13a9f8e0fc807aa20fcae68be1939e4822c164d`**, all **21 unique referenced physical paths** (22 reference occurrences), **six code Git pins** and **14 unchanged dependency pins**. Also matched seven dependencies used by the probe and four nested saved-projection evidence references. Code checkout CRLF was reconciled with Git; original/evidence bytes were not normalized.

Saved real projection remains **11,645 bytes / `2a5ba26f9bc70843a4d3d2f121cf875a669aea348473e656343446022bc99309`**. Its native literals and USGS ordinal 11/item/frame/partial metadata match the unchanged context. Context fingerprint `12058b2711142152e577c0ac2b3dd4e87d17ef64c1e58333421ff12003344a48` and item hash `6147bc28861e0734891c54aa8533ea314c25f00c3752abfcec91900d0b01d33d` recompute exactly. No target exists in this saved context: zero proposals and zero model calls are the honest result.

Reused verified logs: five technical controls, two affected final reruns, one candidate-module no-listener control, backend typechecks and final server typecheck, all final exit 0. Initial fixture/schema/import failures and their fixes remain disclosed in the owner receipt. Fresh reviewer verification was limited to the concrete authority probe and independent reconciliation, both exit 0; no whole-suite or source/model campaign reran.

Private evidence: `E:/BhuAayam-data/task-data/desktop-fusion-association-proposals-review/`. From the reviewer workdir, `node PRIVATE/prepare-fixture.mjs` extracts only the candidate's technical fixture; run `node OWNER/node_modules/tsx/dist/cli.mjs PRIVATE/target-authority-probe.mts` with `TSX_DISABLE_CACHE=1`, or `node PRIVATE/reconcile.mjs`. `OWNER` is `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`; `PRIVATE` is that evidence root. The owner files and installed dependencies were used read-only.

- `review-receipt.json`: **5,200 bytes**, SHA `588ab16dec4d4fbe52d733be1161e5d6218f0180a6732b25bd48d858762122ec`.
- `target-authority-result.json`: **2,257 bytes**, SHA `da6922a0f61249e4cb9d8f4530d7317ba9abe5d286ffa87a60b1c93aec648f3a`.
- `reconciliation.json`: **15,372 bytes**, SHA `df48ec127ce20996a5e204720c701cee6f28270a06b05dad19fa0e9b97ab08d2`.

## Limits and return

The memory schedule establishes a reachable control-flow gap, not measured PostgreSQL concurrency, runtime acceptance or a live disclosure. Historical raw OCR result bytes remain unavailable; saved projection does not establish current source authority, authentic matching or actual model quality. USGS stays foreign `test_only` with partial/unverified OCR; Haryana sheet/height/revision/crosswalk conflicts, learning and release gaps remain unchanged.

Only this report and assigned private review evidence were written. No services/listeners, DB/Docker, source acquisition, OCR/models/GPU/providers, frontend/packet/generated changes, push or deployment; no owned process remains. Staging was read-only, observed at `7c79d135a0a87c4e31f3ea79620be2fc15c8192d` and later `bc587b49781df31f0c59d36ae90f4efeac1d7ee6`. Supplied `never` / `danger-full-access` verified. Requested Astra/xhigh/default-standard; actual model/effort/per-turn tier unexposed. Return this report commit and finding by the authorized lead callback, then stop.
