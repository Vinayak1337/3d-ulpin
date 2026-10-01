# FUSION-04 — grounded building/floor association proposals

2 October 2026. Code candidate **`06f80babd844c4e0c21d2c6df5de495da6e7421e`** supplies a private proposal producer between accepted combined source context and the existing manual citation/review flow. It proposes associations only from unique exact authorized identifiers in selected literal quotations. No association store, automatic registry write, confidence claim, floor expansion or learning label is added. Qualification stays `not_assessed`.

Assignment: [PARALLEL_20261002C](../../orchestration/PARALLEL_20261002C.md#fusion-04--grounded-buildingfloor-association-proposals), base `e218ff37d1536482fe195153b246dc12ebf8dd74`. Branch `task/desktop-fusion-association-proposals`, worktree `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`; citation branch remains at `92d144b98f0a59a771f815c455d01888d71fe56a`. Staging stayed read-only. Supplied permissions remain `never` / `danger-full-access`. Requested GPT-6.1 Sol/xhigh/default-standard; actual model/effort/per-turn tier is unexposed.

## Private request and officer flow

Candidate **POST `/api/v1/usp/evidence/source-fusion/association-proposals`** accepts:

```ts
{
  requestKey: string; // UUID; durable gateway invocation identity
  context: {contextSha256: string; selection: SourceFusionRequest};
  scope: SnapshotScope | null; // recorded snapshot when targets are selected
  targets: TargetPin[]; // at most 8 explicitly selected recorded buildings/floors
}
```

For source-only work, send `scope:null, targets:[]`. The server reassembles accepted native/OCR/CityJSON evidence, checks the requested context hash and uses the existing snapshot/target reader. Selected document sources must pass the existing citation site/operator/archive/lineage/access authority for the target site. Invalid supplied targets or incompatible source sites are denied, rather than silently becoming a source-only request.

Missing targets, eligible literal text or an identifier produce `needs_input`. Missing/invalid gateway configuration or an unavailable admitted call produces an honest `unavailable` response while retaining the original manual selection. One server-owned `INGEST` gateway profile/attempt uses existing durable reservation, dispatch, settlement, deduplication and recovery. No alternative provider, automatic repair/fallback or no-config inference route is added.

The response includes authoritative literal context, exact targets, proposals/abstentions and prompt/input/output/config hashes, configured provider model ID and any gateway receipt/replay provenance. Native citations retain part ID/hash; OCR citations retain item ordinal/hash and point to the returned exact page/frame/method/partial metadata. CityJSON retains native object pointers as context and cannot become a document quotation. Redacted/nonliteral/archive evidence is excluded from proposals. Identifiers must match exactly in their authorized scheme; duplicate identifiers, multiple possible targets and conflicting suggestions abstain. Ambiguity considers the full selected literal even beyond the model excerpt. A valid model abstention suppresses suggestions using the same fragment.

Each proposal's `manualSelection` narrows document parts/OCR ordinals to its cited fragments while retaining the explicitly selected source pins and contextual CityJSON. Its reduced context hash is rebuilt server-side. An officer can place that object in the existing citation amendment's `addFusion`, supplying the chosen correction's exact draft/record revisions, then use existing review/commit. Main response `manualSelection` retains the original explicit context for independent manual use. A proposal is never an accepted relationship; the existing amendment rechecks all authority again.

Source/target/access/model-policy are rechecked during gateway admission and after response before return. The P2 correction below protects the complete target/ordinary evidence/citation-site set in one bounded transaction, while retaining the existing selected-fusion aggregate revalidation. These scopes release before provider I/O; joint selected-result/target SQL atomicity remains unclaimed. Legacy projection reads retain their existing deadline behavior; the new protected transaction uses the existing actively cancelled deadline helper.

Bounds: 2–8 sources, 25 fragments, 8 targets/proposals, 25 model citations total, one model attempt, first 1,000 minimized characters per selected literal, 24 KiB minimized messages, 64 KiB received request, 1 MiB response and 30-second deadline. Full private literal context remains available for manual review. No filenames, object paths, target labels, owner metadata or full geometry arrays are sent to the gateway.

## Focused proof and limits

Final commands all exited **0**:

- `pnpm exec tsx --test tests/usp-source-fusion-associations.test.ts` — **5 controls**, explicit memory transport/stub gateway replies: exact native/OCR/manual adapter, missing-target/no-config behavior, fabricated quote/target/ordinal rejection, ambiguity/conflicting-evidence abstention and source/target/model-policy drift. After the final ambiguity changes, only affected `--test-name-pattern='grounded native|duplicate identifiers'` controls were rerun: **2/2**.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/source-fusion-associations.controller.test.ts` — **1/1**, candidate module/guard/filter/schema/received-byte/no-store check, without a listener. This is not production registration proof.
- `pnpm typecheck:backend` — server/API pass; affected final server typecheck and staged whitespace check pass.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-fusion-association-proposals/projection-proof.mts` — unchanged real saved-context projection; no provider or current source authority invoked.

Private root: `E:/BhuAayam-data/task-data/desktop-fusion-association-proposals/`. Saved projection: **11,645 bytes / `2a5ba26f9bc70843a4d3d2f121cf875a669aea348473e656343446022bc99309`**. Completion receipt: **16,627 bytes / `917e218e2b17271752930f0ee13a9f8e0fc807aa20fcae68be1939e4822c164d`**, pinning code/Git bytes, unchanged shared authorities, scripts, logs and saved source evidence. Initial readonly-schema access, missing technical fixture offsets and Windows proof-import failures are preserved with their final fixes; no source bytes were changed to pass a check.

The proof reuses unchanged FUSION-02 mixed context **17,096 bytes / `5fbcac319122d09b32db6e6c03de6461fc581d58adbb45e4101498c3115702e9`**, body fingerprint `12058b2711142152e577c0ac2b3dd4e87d17ef64c1e58333421ff12003344a48`. Actual native reference lines and USGS `CENTRAL CITY, COLO.` remain literal; OCR ordinal 11/item hash `6147bc28861e0734891c54aa8533ea314c25f00c3752abfcec91900d0b01d33d`, page box and partial/unverified metadata remain exact. No canonical target exists in that saved source context, so it naturally yields no proposal. Retained Haryana G+41/G+42/sheet/approved-revision/crosswalk conflicts stay separate reviewed evidence, not fabricated accepted results or labels.

Original accepted OCR raw bytes remain unavailable; historical pins may be stale. Current HTTP/SQL/object authority, authentic matching, live inference/model quality, learning and release remain unqualified. Tests are protocol controls, not empirical model accuracy. Provider model ID/config provenance is not a model-weight, residency or Qwen-containment qualification. Sarvam-derived learning requires its separate applicable written permission. No services/listeners, Docker/DB execution, models/GPU/providers, acquisition, fitting/evaluation, gateway/config changes, frontend, packet/migration/shared registry writes, push or deployment occurred; no owned process remains.

## Lead-owned registration and publication

The candidate controller/service is **unregistered**. Add the contract export `export * from './source-fusion-associations'` to `packages/contracts/src/index.ts`. Import `SourceFusionAssociationService` from `@ulpin/server/modules/usp/ingestion/source-fusion-associations` and `SourceFusionAssociationsController` from `./source-fusion-associations.controller` in EvidenceModule; add them to its providers/controllers. Existing server subpath exports suffice. If a root service export is desired, export that service from its module. Then publish the new operation/schemas/client through the existing lead pipeline. Shared exports, module registration and generated files remain unchanged by this owner. Return the exact code/handoff commits through the authorized callback, then stop for review/integration.

## P2 correction — aggregate target authority

Code **`9a5117e5a0f26c268f0c7ade5ba931ae7843c2d4`** closes review `81923531`'s A-then-B ordinary-evidence revocation gap. The existing target reader remains compatible. New `associationTargetAuthority` discovers the complete bounded case/source/lineage set before any destination lock, acquires sorted case gates first, protects current records/identity/snapshot/source/accepted-job rows, rejects discovery drift and validates all targets, ordinary evidence and citation sites together. Initial capture and every existing authorization callback use it, including no-config final return and gateway replay. No transaction spans provider I/O, and ordinary readiness is unchanged.

The review's two archive schedules now deny with **403 `REGISTRY_SOURCE_DENIED`**, with **zero injected fetches and zero writes**. A healthy real-gateway/real-Sarvam-adapter control reaches the injected fetch once with zero active transactions. Both private legacy-reader substitutions fail as expected: no-config misses the required denial; pre-egress fetch count is 1 instead of 0. Final focused regression passes; **10/10 affected producer/preview controls**, server/API typecheck and staged whitespace check pass. Only the affected regression was rerun after adding its healthy control.

Private correction receipt: `E:/BhuAayam-data/task-data/desktop-fusion-association-proposals/correction/correction-receipt.json`, **14,478 bytes / SHA `ae30a7d13cd53c7492adcbdd5a49e54d066bd88486d71608118e8760b84ce25f`**. It pins code, unchanged authorities, preserved failing comparison logs and reused reviewer/literal evidence. Original reviewer artifacts are unchanged. This is memory SQL/ledger control-flow proof with isolated extraction capture and injected fetch, **not measured PostgreSQL concurrency or a provider call**. Current service/source/model/matching/learning/release limits remain unchanged. No resources remain; staging stayed read-only at observed `70f28ebb`. Return for the original reviewer's finding-only closure; candidate registration/integration stays lead-owned.

## Consequential lock compatibility correction

Astra closure `e12ebd41` closes the original revocation finding and identifies the new case-lock cycle against canonical snapshot capture. Code **`82cff2b912b518b43f549f6f13d38a203ce270fd`** changes only the aggregate case lock from `FOR UPDATE` to `FOR SHARE`, with a targeted compatibility assertion in the existing regression. Sorted case gates, complete protection/discovery drift checks and release before provider I/O remain. `SHARE` coexists with snapshot capture's differently ordered `SHARE`; it still conflicts with archive's non-key update and generic/canonical source-family writers' `FOR UPDATE` locks. Canonical snapshot and shared gateway code are unchanged.

The adapted retained lock-order probe shows both actual readers finishing with **no reader wait cycle**; archive and source-family mutation requests acquire only after both read scopes commit. Its former-mode substitution reproduces the opposing wait cycle. Snapshot inserts and rollback mutation attempts exist only in the memory transport: **zero persisted writes, zero remaining transactions**. The original revocation/healthy-gateway regression and server/API typecheck pass; no wider campaign reran. An initial mock-routing failure on a nested geometry-qualification query is preserved and corrected in the private probe.

Receipt: `E:/BhuAayam-data/task-data/desktop-fusion-association-proposals/lock-compatibility/correction-receipt.json`, **10,138 bytes / SHA `906ac6a1078b355397b80ac4830a53974b41f1debec0b490d01b327a37d109d9`**, pinning code, unchanged writer/reader authority, original closure artifacts and fresh probe/logs. Requested Sol6.1/high/default-standard; actual model/effort/tier remains unexposed. Supplied never/danger-full-access verified; staging read-only at observed `661821e5`. This is modeled lock compatibility, not measured PostgreSQL concurrency/detector/persistence. Existing source/model/runtime/release limits remain; no owned resources remain. Return for finding-only closure before lead-owned integration/registration.
