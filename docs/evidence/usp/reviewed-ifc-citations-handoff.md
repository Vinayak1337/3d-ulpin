# FUSION-IFC-02 — canonical citation access incompatibility

2 October 2026. **Attachment implementation remains pending.** Exact assigned base `a7e82fa03c91a71457fcf1f82c94eda105d02f11`; branch `task/desktop-reviewed-ifc-citations`, worktree `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. The completed `task/desktop-fusion-ifc-context` remains at `c74a5937d4512a6597fbf63ff738da3065bc417c`. Staging was read-only and matched the dispatch base.

The [assignment](../../orchestration/PARALLEL_20261002C.md#fusion-ifc-02--officer-selected-ifc-source-citations) explicitly directs: “If the native IFC source is reference-ineligible under current canonical access, return the precise observed incompatibility and a narrow proposed change; do not weaken the gate.” This checkpoint follows that condition rather than bypassing the source policy.

## Observed gate

`registryDocumentSourceAccessTx` calls `registrySourceAuthorityTx`, which delegates to `documentAuthorityTx`. The latter rejects any protected IFC source, including an otherwise same-site, unarchived source with a schema-valid original marker and current local operator:

```text
409 / IFC_CANONICAL_SOURCE_REQUIRED
Use the current private IFC original/job authority; legacy snapshot and copy admission are unsupported.
```

Private controlled proof: `E:/BhuAayam-data/task-data/desktop-reviewed-ifc-citations/access-gate-proof.mts`. It calls the actual canonical access helper over two SQL row responses using unchanged buildingSMART IFC2X3 source metadata. **Exit 0**, expected rejection observed, **zero writes and zero private artifact reads through the access path**. It uses memory-only source/case/site IDs and never claims an installed accepted source, linked operational target or property crosswalk. The native artifact is read locally solely to verify its preserved input hash.

Receipt `access-gate-receipt.json`: **3,914 bytes**, SHA256 **`e2a060d0b31464b1cc432d37e991a572fa15a1c729ab6295a95b52782f97a9a6`**. It records exact SQL, error, code physical/Git hashes, script hash and limitations. Command: `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-reviewed-ifc-citations/access-gate-proof.mts`; log retained alongside it. Original IFC source remains 92,542 bytes / `c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885`; accepted parser artifact remains 55,011 bytes / `66dcfb321cac47b605ffed87beaf060b50b1203a151b738fe446b6251d003d3a`.

## Narrow proposed continuation

Explicitly authorize an IFC-specific citation access bridge in the assigned new leaf, retaining the generic document/snapshot/copy refusal:

1. `registryIFCCitationSourceTx(client, siteId, exactFusionPin, lock)` delegates to unchanged `acceptedFusionIFCTx` and `ifcSourceTx`, including current original/access/latest-family/reader/job/attempt/fence/result checks. It also requires the source case's current `site_id` to equal the selected canonical target site. It cannot fall back to document authority or accept copied/snapshot/package IFC bytes.
2. Invoke that bridge only for the new typed IFC citation variant. Keep `registryDocumentSourceAccessTx`, ordinary readiness/reference policies and document/copy authorities unchanged. New IFC pins must carry exact artifact hash/length, native STEP ID/type, native JSON pointer, record fingerprint and original byte locators, with operator attribution and immutable target revision/body pin. Native IDs remain separate from canonical IDs and document parts.
3. Persist only through the existing correction citation array and review/commit authority, with explicit recorded building/floor/space target support and whole-input checks after object I/O. Preserve existing locking order, public citation hiding, exact legacy IDs and removal without denied-byte access. Reconcile the source envelope consumed by unchanged case-lock helpers before choosing its additive contract shape.

This is a proposed variant-specific policy path, not an implemented relaxation or completed feature. Once its access/ownership scope is confirmed, resume the already assigned bounded attach/read/reviewed-commit journey and focused revocation/stale/legacy compatibility checks. No authentic IFC/property crosswalk, current accepted IFC envelope, HTTP/SQL/object persistence, geometry, rights, ML labels or release gate is qualified here.

No production contracts, authorities, writers, locking helpers, frontend, generated publication, dependencies or configuration changed. No service/listener/DB/Docker/native/model/provider/GPU, new chat/subagent or schedule started. Supplied permissions are never/danger-full-access; requested Sol6.1/xhigh/default-standard, actual per-turn settings unexposed. Originals and prior receipts are preserved; commands exited. Return this exact incompatibility through the authorized lead callback, then stop; worktree is clean after this checkpoint commit.
