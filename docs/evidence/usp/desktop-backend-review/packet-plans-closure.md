# PACK-PLAN-01 historical-access closure

2 October 2026. **Original P2 closed at code and controlled-schedule scope; no new actionable consequential finding.** Reviewed correction/handoff `f055248f67f515859ac12508ba475842254eb29d`, parent `e12374a5313de30a1f9fbf7c3f591eacc4677ff9`, against original review `1606f1036ee6d9b9deb22522b4120a908ace1f79`. Scope: historical-access closure dispatch in [PARALLEL_20261002C](../../../orchestration/PARALLEL_20261002C.md) and the [correction handoff](../packet-plans-handoff.md#p2-correction--protected-historical-disclosure). Lead staging was observed at `3e94db5953bfe30b09abac15afe2e5f00570dbf0`; it remained read-only.

## Closure assessment

`readPacketPlan` now invokes `protectPlanDisclosureTx` before both protected replay-authorization passes. Discovery includes selected evidence and the accepted shared declaration's instrument, population, denominator, entry, consent and applicability sources. For each retained root it follows both current lineage and the retained parent into its current lineage, matching the existing replay authorizer's dependencies.

Protection takes the sorted existing destination gates, all discovered case rows `FOR SHARE`, the recording mutex, site share lock and source share locks. Rediscovery compares the complete case/source/parent set before authorization; changed dependencies reject instead of acquiring a newly discovered case after destination locks. The selected target is then checked under `FOR SHARE OF r`, and source authority uses protected replay mode. A missing, moved, archived or denied contributing source remains unavailable.

The concrete archive writer in `scripts/archive-workspaces.ts` updates `cases.archived`, which conflicts with the held case share locks. Case-mutating processing locks the case before sources; source/destination operations use the same gate before destination or case locks. Target retirement/cancellation uses the recording mutex. The checked registry import/review paths share the gate ordering. Canonical snapshot capture's source-ordered case **share** locks are compatible with this reader's case share locks; the correction introduces no case update lock or share-to-update upgrade. No consequential wait cycle was established in these paths.

The two historical PACK0 authorizations still finish their transactions before and after object I/O. An archive during the object gap is visible to the final protected check and denies the result. An archive attempted inside protected authorization waits until that read transaction ends; a read serialized before revocation may finish normally, and subsequent reads deny. The original unprotected probe is preserved unchanged: its direct archive mutation ignores locks and therefore is not a corrected-runtime test.

Historical source/target revision drift and expiry remain tolerated because access still uses the existing **replay/original** authority rather than current extraction eligibility. Discovery adds no expiry, current extraction or old revision equality requirement. Reads add no plan, packet, receipt, event, fence or object write. Direct PACK0, contracts and SQL are unchanged by this correction.

## Focused verification

From `C:/Users/kvina/.codex/worktrees/desktop-integration-20261002/3d-ulpin`:

```powershell
& 'C:/Users/kvina/AppData/Roaming/npm/pnpm.ps1' exec tsx --tsconfig apps/api/tsconfig.json --test --test-name-pattern 'P2 reviewer|protected historical closure|accepted shared consent' tests/usp-packet-plans.test.ts
```

Exit 0: **4 passed, 0 failed, 0 skipped**. These use actual candidate readers with controlled SQL/lock schedules. They cover the original final-plan and final-post-object archive schedules, subsequent denial, object-gap revocation, benign historical drift/expiry, zero writes, retained/current lineage, changed dependency discovery and shared-consent revocation. The object reader asserts no active transaction or case lock during object I/O. No additional production test or broad campaign was added.

Reused the owner's reported 13 passing controls and server/API typechecks, along with the original review and unchanged LGD/source proof. SQL/contracts were unchanged, so their verification was not repeated. No real property match or new source qualification is claimed.

Private evidence under `E:/BhuAayam-data/task-data/desktop-packet-plans-review/closure/`:

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `affected-controls.log` | 666 | `07607d2dd57c4af2a4a782b3ed88b352413fe3d6c4c28bc8aff106e5cce74e12` |
| `closure-receipt.json` | 9,793 | `d6b08f97ceae544b5f9dc2f6148cb06e815b721573bb9bc2259db6ec09dfa2c0` |

The receipt records exact Git/physical code pins, the command/result and limits. All three correction handoff physical hashes match the owner's files; owner and reviewer copies normalize exactly to candidate Git bytes. The original private probe remains SHA256 `9c3e8cceafe1b448b81eae97d6f3397123defe8292adad1d6f48e72fd969cff4`. Existing review evidence was not overwritten.

## Return boundary

Actual PostgreSQL/MVCC, persistence and mounted HTTP remain unqualified. The additive plan tables still must be applied in an authorized runtime before serving the original candidate, including direct PACK0 reads. Registration, generated publication and integration remain lead-owned. Authentic applicability, PACK1/card/QR and release gates do not advance through this closure.

Only this report is committed on `task/desktop-packet-plans-closure`; the original review branch at `1606f103` is preserved. Supplied permissions are `never` / `danger-full-access`; Astra/xhigh/default-standard was requested, actual model/effort/tier unexposed. No production/staging/frontend/generated/source edits, services/DB/Docker/migrations, providers/models/GPU, workers, polling, push or deployment occurred. No runtime resource was started or owned. Return the report commit through the authorized lead callback, then stop.
