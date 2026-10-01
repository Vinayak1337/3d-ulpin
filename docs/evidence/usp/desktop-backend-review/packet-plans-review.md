# PACK-PLAN-01 independent review

2 October 2026. **Return for one P2 correction before integration.** Candidate `e12374a5313de30a1f9fbf7c3f591eacc4677ff9`, base `e218ff37d1536482fe195153b246dc12ebf8dd74`. Scope is the PACK-PLAN-01 review dispatch in [PARALLEL_20261002C](../../../orchestration/PARALLEL_20261002C.md); [owner handoff](../packet-plans-handoff.md). This is a report-only review, not staging integration or runtime qualification.

## P2 — protect historical authorization against concurrent case revocation

Location: `packages/server/src/modules/usp/packets/plan-service.ts:136–143`, with `plan-authority.ts:29–47` and the new plan-linked branch in `usp/packet0.ts:148–156`.

`readPacketPlan` performs two sequential calls to `authorizePlanTx` without acquiring the case/recording locks used by mutation and receipt-replay paths. The authorizer checks the target without a lock and passes `protect=false` for selected and shared evidence. Its ordinary transaction uses `BEGIN`, with no stronger isolation. In the final pass, a case can become archived after `assertDeclarationEvidenceTx` checks `site_id,archived`; the following legacy-source `documentAuthorityTx` does not check that case again. The reader then commits and returns the historical plan. `readPacket0` invokes this same reader after object I/O, so the gap also permits returning the saved private derivative.

This has a concrete writer: `scripts/archive-workspaces.ts:10–13` updates `cases.archived` for explicit IDs. That UPDATE conflicts with a case `FOR SHARE` lock, but the historical-read path takes none. The check concerns current access, not benign extraction/revision drift or expiry. Mutation/replay paths already acquire `locksTx`; this finding is specifically the new historical-read/download path.

The private probe reuses the owner's existing technical fixture and calls the actual candidate services. It simulates the archive writer's committed effect immediately after the final case eligibility read, before the subsequent source-authority query. Both schedules reproduce the defect:

- `readPacketPlan` returns the exact saved plan while its contributing case is archived.
- `readPacket0` returns the linked 368-byte CSV, SHA256 `127eae2b9b0ece53593e002abdc9929aea766489cbb375e4c6ee15c793e72da1`, when the archive occurs during the final post-object authorization. The excerpt remains in the returned bytes.

Both subsequent reads reject with `403 DECLARATION_SOURCE_DENIED`. The captured read traces contain no share/update/advisory locks, and neither read adds writes or object puts. The two probe assertions pass because they reproduce the undesirable behavior; they do not certify correctness or PostgreSQL concurrency.

Correction: give historical disclosure a coherent, protected current-authorization check covering the selected target and all contributing cases/sources, including retained/current lineage and accepted shared context. Use the actual writers' case-first/recording ordering and recheck after protection is acquired. Preserve historical revision/expiry tolerance. Keep object I/O outside these read transactions and protect the final post-object check; another unprotected sequential scan is insufficient. Closure should demonstrate that archive cannot commit unnoticed within the authorization section, or that a prior archive is denied before disclosure.

## Remaining reviewed scope

No additional actionable defect was established in the bounded review of the 15-file delta and relevant dependencies. The contracts require one exact selected building/floor/space, bounded explicit entries and immutable version/hash confirmation. Required blockers prevent execution; optional omissions remain explicit. New operations enforce latest-version/expiry and exact target/source/context checks, while cached requests reauthorize and reject changed payloads.

Shared inclusion uses the accepted declaration reader for exact target/part/date and `declared_share` purpose, then checks contributing evidence, consent/applicability, whole population and current declaration revision under the final mutation authority. The first transaction releases before acquiring the accepted reader's connection. PACK0, plan execution, receipt and outbox publication share the final client; execution reassesses after immutable object I/O. An object left unreferenced by failed SQL publication remains a disclosed cleanup limitation.

The existing exact-part selector and renderer remain unchanged. The plan recipe verifies original bytes, exact captured reference parts and confirmed inclusion; it does not infer native/OCR/PDF support. SQL adds immutable versions/confirmations/execution linkage with composite foreign keys. Controller guards and schema/envelope handling were reviewed; production module registration and generated publication belong to the lead.

**Migration prerequisite:** apply the reviewed additive `usp_packet_plans_001` tables in the authorized runtime lane before serving this candidate. Even direct PACK0 reads now query the plan-execution table. This disclosed rollout dependency is not an additional finding; no migration was applied here.

## Verification and pins

Reused the owner's reported 15 passing focused controls, backend typecheck (exit 0), SQL verifier (exit 0) and retained D0/PACK0 evidence. No broad test rerun or service campaign occurred. The sole new execution was:

```powershell
& 'C:/Users/kvina/AppData/Roaming/npm/pnpm.ps1' exec tsx --tsconfig apps/api/tsconfig.json --test E:/BhuAayam-data/task-data/desktop-packet-plans-review/historical-read-archive.probe.test.ts
```

Result: exit 0, two reproduced schedules, no skips. Working directory: `C:/Users/kvina/.codex/worktrees/desktop-integration-20261002/3d-ulpin`. The probe/log are retained privately; no production file was edited.

| Private artifact under `E:/BhuAayam-data/task-data/desktop-packet-plans-review/` | Bytes | SHA256 |
| --- | ---: | --- |
| `historical-read-archive.probe.test.ts` | 20,096 | `9c3e8cceafe1b448b81eae97d6f3397123defe8292adad1d6f48e72fd969cff4` |
| `historical-read-archive.probe.log` | 6,194 | `725bc33d44bd85034330b8bdcee10fa9151ec78c853055877e61d495d8cf49ab` |
| `review-receipt.json` | 16,067 | `959e15715ebc1fd94cc0550cef2e3dfed1c1027cd0398054ee884dea9e958318` |

The receipt pins candidate Git blobs and reviewer physical bytes for all changed files and the relevant writer/authority dependencies. All six owner physical hashes match the handoff; reviewer checkout line endings differ, and both copies normalize exactly to candidate Git bytes. An initial assumption that each handoff file used uniform LF was false; direct byte comparison resolved the difference without changing either checkout.

The unchanged LGD original is 89,622 bytes, SHA256 `b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`. Its owner literal check preserves `049`, the empty field and `000`; it is not a matched-property plan journey. Existing source index/catalogue and source lineage were consulted, with no invented operational target or new qualification.

Actual PostgreSQL persistence/MVCC, mounted HTTP, authentic property applicability, PACK1/card/QR and release remain unqualified. No source acquisition, provider/model/GPU, fitting, services/DB/Docker, migration application, frontend/generated files, PDF-branch changes, push or deployment occurred.

Review branch: `task/desktop-packet-plans-review`. Prior `task/desktop-declarations-p2-closure@79d6d699cbe4ab5462d1406ac9d2eaa0e96f5ba6` is preserved. Supplied permissions were `never` / `danger-full-access`; Astra/xhigh/default-standard was requested, actual model/effort/tier unexposed. No speed setting is claimed. Only this report is committed; staging and other owner files remained read-only, and no runtime resource was started or taken over. Return by the authorized lead callback, then stop.
