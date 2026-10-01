# CITYJSON-REFERENCE-01 — reference binding review

1 October 2026. **Changes requested: one P2 lock-order finding.** Review covers the 13 feature files in production `098435ed6fc2d487e7b2a63aa702c4ca28b7f318`, accepted-source control `0c0b974b54b489193d52a26606729e4583508d94` and handoff `82467264c7c4e700ea79db9bcdd8888ef27e8751`, against exact base `64dc4e7fc7f553625361f15ffd46e2cabd16b90c`. Assignment was read at lead `9969dd5224787585968d499bc14d6a9082ba0edb`; the observed clean staging head matched that dispatch and has no intervening production changes against the base.

Clean review branch `task/desktop-cityjson-reference-review` was created from the candidate in `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`. Completed validation review `67208762989bac515696e8295d706593ced82413` and its branch remain preserved. Primary staging and implementation checkout were read-only. Astra/xhigh/default-standard requested; actual model/effort/tier remain unexposed. Supplied permissions verified as `never` / `danger-full-access`. No new workers or runtime services.

## P2 — coordinate document row order with recorded-citation amendments

Location: `packages/server/src/modules/registry/cityjson-reference.ts:95–99`; interacting existing path: `packages/server/src/modules/registry/registry-document-evidence.ts:195–214`, through `document-context.ts:20–23`.

The new reference flow sorts its document groups and calls the canonical authority with `lock=true`, taking each document case row `FOR UPDATE`. Its complete sorted `registry-import` gate set serializes cooperating reference/native operations, but recorded-citation amendments do not acquire those gates. An amendment first locks the document in `request.add` at line 197, then validates retained citations at line 214. Its case-row order can therefore oppose the new flow.

Concrete supported configuration: accepted document cases D1 and D2 belong to recorded site B; a native draft at different site A references both, which this new cross-case API permits. A recorded correction at B already cites D1 and adds D2. For D1 < D2:

| Step | Native reference read/amendment at A | Recorded citation amendment at B |
| --- | --- | --- |
| 1 | Holds its sorted case gates and site A; locks document case D1 | |
| 2 | | Holds site B; locks newly added document case D2 |
| 3 | Requests D2 and waits | |
| 4 | | Requests retained D1 and waits |

The distinct site locks do not serialize these requests. The citation path's absence of `registry-import` gates leaves a row-lock cycle, so PostgreSQL must abort one otherwise valid request. The new endpoints use the ordinary transaction path without a deadlock retry. Previously, recorded amendments sharing these same-site sources serialized at site B; the new cross-site reference path adds the conflicting participant.

A compact no-service control calls the actual `readRegistryCityJSONReferencesTx`, `amendRegistryDocumentCitationsTx` and canonical `documentCaseTx`. It confirms document-case lock orders D1→D2 versus D2→D1 and zero citation-side case gates, stopping before any mutation. Other SQL/accepted authority and the recorded target/source-site association are in-memory technical fixtures. Retained literal parts are unchanged. This is a demonstrated call-order inversion plus a static PostgreSQL wait schedule, not an executed SQL deadlock or an operational association of the retained source-only cases.

Coordinate one compatible gate/row protocol across the intersecting reference and recorded-citation paths before either takes destination/source rows, including all retained and added document cases. Preserve the recorded path's same-site/access checks and revoked-removal semantics. Sorting only the new reference loop or adding a late gate after row locks does not close this cycle. The smallest shared-seam correction needs lead ownership coordination; this reviewer made no production change.

## Other scoped observations

- Lookup discovers native, workspace, retained and added cases; sorted gates precede destination rows. Site/workspace identities and the complete case set are rechecked under row locks before invoking native authority, so a changed lookup cannot introduce a late gate. The finding above concerns an existing nonparticipating writer.
- Exact document job/source scope is resolved before private object reads. Current input/result/reader/access, accepted fence, part hash/locator and exact native candidate/selection are pinned. The held draft, all document authorities and native/operator context are rechecked after object I/O. Missing/inaccessible evidence is projected through the controlled unavailable response. No request-supplied text, verdict or storage path becomes authority.
- Actual mutations increment draft revision once; duplicate selection and same-key replay retain coherent receipts without duplicate pins. Removed document sources need no private read; retained ones still require authority. Removal/read has no validation prerequisite. A changed draft correctly makes prior validation inputs stale; no saved validation pin or automatic rerun is introduced.
- Strict requests, 25-part selection, 16 KiB body, 64 KiB stored pins and 128 KiB private read bounds are enforced. Generic create/edit/review/commit guards reject the private field by presence; ordinary projections strip it, and native-candidate removal clears orphan references. Reference text remains in the accepted result store.
- The two additive admission actions and binding capability do not satisfy any of the four missing reference/admission requirements. Inspected the affected admission checks and retained new control; no contrary capability assertion was found. Native EPSG:7415/NAP remains distinct from a selected document's EPSG:4978 tiles statement. Applicability, independent accuracy, recording and qualification remain unassessed/unavailable.

## Evidence, checks and limits

Reused lead verification of `E:/BhuAayam-data/task-data/desktop-cityjson-reference-binding/verification-final.json`, 52,170 bytes, SHA-256 `e5ce684216a085a40f2e9d95e27cb0a29d12da51a35aeb9f317d99fa6bdd30be`; reviewer rehashed that receipt. Its scope includes 13 feature/17 preserved code pins, 12 reused artifacts, 26 check/helper artifacts, accepted dependency originals/results and 19 document-reader constituents. Inspected retained backend typecheck exit 0, six feature controls plus one accepted-source control (zero skips), and three-route private/no-query metadata check exit 0. These use SQL/object/authority doubles and no listener; completed campaigns were not rerun.

Reviewer checks:

- `git diff --check 64dc4e7fc7f553625361f15ffd46e2cabd16b90c 82467264c7c4e700ea79db9bcdd8888ef27e8751`: exit 0.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-cityjson-reference-review/lock-order-control.ts`: exit 0; confirmed the inversion above with zero mutations. Script SHA-256 `eaba714906cb70c70193d7937000553097a6a9dea2084a795d8d2849c93ea0ab`; adjacent result JSON SHA-256 `767a0ec1f3e4c1f3d32deab5930b5ab86e1a27d4af6ea1248c211a1e4539c549`. Both remain outside Git.

Known runtime precondition remains: candidate-reported physical document-reader digest `5281a9440a826bd82b40ceca6596fdb102adf72e88260b71f01bd7a3d2540b50` differs from accepted enrollment `e745ab9bf180da35d3fd59be8021da0f0944b203b34debb83549a590921d6166`. Lead traced this to physical EOL differences in `area.py`, `native_pdf.py` and `native_archive.py`, with all 19 constituent source contents matching. Runtime owner must preserve/reconcile exact accepted physical bytes and verify the aggregate before serving. No reader, fingerprint algorithm, source/job/result pin or extraction was changed here.

Only this report is committed. Actual PostgreSQL contention, persisted attachment HTTP/SQL/object behavior, independent reference accuracy, native admission/post-write qualification and release gates remain unrun/unqualified. No DB/API/Docker queries/start, validators/OCR, source mutation, model/GPU/provider, frontend/generated edits or goal update occurred. Lead retains correction/integration coordination, generated API handoff and stopped runtime ownership; callback then reviewer stops without polling.

## P2 correction closure — 1 October 2026

**The one P2 is closed at code-review scope. No remaining finding or direct regression established in the six-file correction.** Original review and failure evidence above remain unchanged; this closure does not qualify actual SQL contention or persisted runtime.

Reviewed correction `0926739643480b5f4ab2a9921868373c69b31fc5` against candidate `82467264c7c4e700ea79db9bcdd8888ef27e8751`, under closure assignment at `da0d914139369c97e46edfaf293c80e59aa02e60`. Clean review branch merged exact correction handoff `cdc241a6de3dae15ee2270d1d33bf1fb9da79937` without conflicts as `ab104e1821345e978e857c6ce248564ce877c257`, preserving report `9955f8336fb759769c1b6e78782bbc63e7124650`. Observed clean staging remained at the dispatch. Astra/xhigh/default-standard requested; actual model/effort/tier remain unexposed. Supplied permissions remain `never` / `danger-full-access`.

- The small `registry-document-locks.ts` helper derives unique, normalized, sorted workspace/citation case IDs and uses the existing source-case destination gate. Recorded citation amendment includes both retained and added cases before site/draft/document rows. Private citation read also acquires the complete gates before protected document authority. The original D1/D2 row inversion is now serialized at the common gate before either conflicting row sequence starts. Removed/revoked sources contribute lookup IDs without requiring private reads.
- Citation and generic-edit lookup identities/case sets are rechecked after waiting. Review persistence gates the complete proposed/current record aggregate and checks it again under destination locks before evidence/preparation authority. Commit preflight includes the workspace, current unaffected records, proposed records and reviewed records; locked revalidation rejects changed identities or case sets without acquiring newly discovered gates. Final citation-read revalidation likewise acquires no late gates. Inspected the directly intersecting citation and recording callers; no additional opposing gate order was established in this correction.
- Direct commit obtains its case plan before `physical-area-recording`. The explicitly coordinated USP bridge obtains the same plan before recording/receipt locks and passes it into `commitRegistryReviewTx`, which revalidates it rather than acquiring gates late. If a direct commit becomes replay while waiting, revalidation retains the original complete lookup mode and harmless extra gates, then enters the existing committed-review authority branch. An initially committed review remains valid preflight input.
- USP's preliminary receipt lookup selects only the lock plan. The existing locked receipt lookup remains authoritative for successful replay and command-hash conflict. A cached receipt requires no draft/review/snapshot lookup; disappearance cannot fall through to a late case preflight. Existing scoped snapshot/access checks, proposal/review binding, revision writes, postwrite checks, outbox and atomic receipt code are otherwise unchanged. Same-site positive recorded targets, exact source/result/reader/fence authority, removed-source recovery and native recording restrictions remain intact.

Reused and inspected `E:/BhuAayam-data/task-data/desktop-cityjson-reference-correction/verification-correction.json`, 32,535 bytes, SHA-256 `7e386ca6e2c55bec4b87c16918db3dede15fbb1359e6501e30238536e5c379ac`; reviewer rehash matched. Lead verification covers 68 physical artifacts and six corrected/28 preserved Git files. Retained checks:

- `pnpm exec tsx --test tests/registry-document-evidence.test.ts tests/registry-cityjson-reference.test.ts tests/registry-document-lock-order.test.ts`: exit 0, 17 passed, zero skips.
- `pnpm typecheck:backend`: exit 0, server/API typechecks.
- Reviewer `git diff --check 82467264c7c4e700ea79db9bcdd8888ef27e8751 0926739643480b5f4ab2a9921868373c69b31fc5`: exit 0.

The adapted control exercises actual reference/citation entry helpers with a simulated gate scheduler and SQL/authority doubles. It shows the recorded operation waiting before destination/source rows, changed retained/neighboring case sets rejected without late gates, direct replay-after-wait reaching its existing authority branch, and actual cached USP receipt replay/conflict without draft lookup. That is code/control evidence, not a successful real recording or PostgreSQL deadlock observation. No additional reproduction or completed campaign rerun was needed.

Only this closure appendix is committed. Known three-file physical reader EOL reconciliation stays with the runtime owner; no reader or saved pins were rewritten. SQL contention/timing, persisted HTTP and qualification limits above remain. No services/SQL, production/frontend/generated/source edits, new workers or goal updates occurred. Lead retains integration/API refresh and stopped runtime ownership; reviewer returns the report and stops without polling.
