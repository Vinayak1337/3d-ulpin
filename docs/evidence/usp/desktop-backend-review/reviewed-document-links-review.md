# LINK-02-R — canonical citation mutation and privacy review

2026-09-30. **Changes requested; not ready for integration.** Two new privacy findings and the two already assigned lead findings remain at the reviewed checkpoint. No owner correction was fetched or evaluated.

Reviewed the 15-file implementation `47f7f4d135b6fd957d193005041a5751c5ea6ea1` against `e1eba7c403f20e65eb0a813f8eabe5d134db90fb`, checked out at handoff `b493fb141549397660d2bd45975d4f2d482c8f18`. Assignment: `LINK_02_REVIEW.md` at staging `d9b1557`. Worktree: `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-reviewed-document-links-review`. Completed branches are preserved; primary staging remained read-only. This report is the only owned change.

## New findings

### 1. P1 — general dossier and identifier reads disclose private citation pins

The new `RegistryBody.documentCitations` field is removed by selected registry projections, but existing consumers still spread canonical bodies:

- `packages/server/src/modules/officer/officer.ts:274–302` returns unprojected records from `relatedRegistryRecords`; `buildingDossier` returns them in `records` at line 555 and `detailedScene[].record` at line 515. The Nest `GET /api/v1/buildings/:buildingId/dossier` at `apps/api/src/modules/register/officer.controller.ts:65–68` applies only `redactDocumentViews`, which does not remove `documentCitations` or authorize their source.
- `packages/server/src/modules/areas/area-resolver.ts:124–129`, `141–146` and `160–164` spread the same field into identifier results and related buildings, through the compatible `/api/v1/resolve` route (`area-routes.ts:97`).

Once a citation is recorded, these paths expose source/job/part pins, native locators and selection attribution even when dedicated citation resolution would reject the source/operator. The canonical field contains no native text, so this finding concerns private pins/locators rather than a claim that text was copied into registry storage.

**Reproduction:** an inline `node --import tsx` command called the actual `relatedRegistryRecords`, dossier `redactDocumentViews` presentation and `resolveAreaIdentifier` with a schema-valid technical citation and a memory-only query provider. The citation's private locator survived in both dossier record positions and the resolver result. All 12 SQL calls were handled by the double, with zero source/accepted-result checks. Exit **0**, output `privacy-gap-reproduced`. No database connection, persistence or listener was involved; resolver legacy-sync writes were intercepted by the double.

**Correction:** apply the same citation-omitting projection to every exposed canonical record in these general responses, including related/nested records. Keep exact private resolution behind its existing authority. Add a focused regression through these actual read/presentation paths, preserving stored bodies and unrelated fields.

### 2. P1 — multi-document private read returns an earlier document after revocation during later I/O

`packages/server/src/modules/registry/registry-document-evidence.ts:115–132` validates and rechecks each document group independently. `readRegistryDocumentCitationsTx` calls it with `lock=false` at line 208, then rechecks only the target and draft at lines 209–211. The standard transaction is READ COMMITTED and does not retain source/attempt locks for this read. A draft can accumulate citations from multiple documents through separate amendments.

For citations from A and B, A's last authority check completes before B's object read. If A is revoked or its accepted input/attempt changes during B's I/O, the function still returns A's native text: no final validation revisits A. The single-document recheck test does not cover this aggregate response.

**Reproduction:** a second inline `node --import tsx` command called the actual `readRegistryDocumentCitationsTx` with two document groups and memory-only SQL/dependency doubles. B's result reader revoked A; the source helper was set to throw 403 on any subsequent A check. The function returned both citations and A's exact text, with **zero A rechecks after revocation**. Exit **0**, output `cross-document-revocation-gap-reproduced`. This demonstrates control flow under the explicit interleaving, not executed PostgreSQL concurrency.

**Correction:** finish all object reads before a final aggregate source/input/accepted-attempt validation under a coherent transaction boundary, or hold the appropriate authority locks throughout the private read. Preserve the target/draft checks and fail the whole response when an earlier document becomes unavailable. Cover the two-document interleaving without reopening models or operational data.

## Already assigned findings — still present in this checkpoint

### 3. P2 — a stale/revoked recorded citation prevents opening its removal correction

`packages/server/src/modules/registry/registry.ts:328` validates the copied recorded citations before looking up or creating a correction; replay/existing-draft paths at lines 313/339 also require validation. If a document becomes unavailable after recording, `createRegistryDraft` fails before the user can reach the removal operation. The removal path itself correctly excludes removed citations from validation (`registry-document-evidence.ts:191–194`), but its existing test starts with an already active draft.

This is the lead-assigned lifecycle correction. Preserve historical pins while permitting an explicit removal correction, and keep retained/new citation validation and private text reads closed to stale evidence. Verify the complete reopen → select removal → review/commit path; a fresh client must be able to identify what it can remove without needing the inaccessible native text. No implementation was duplicated here.

### 4. P2 — export silently omits citations from its loss declaration

`packages/server/src/modules/usp/exchange.ts:69` projects away citations before constructing `losses`; lines 152–155 distinguish served and captured hashes but do not declare the omitted field. The sidecar/round-trip consumer therefore has no explicit `omitted_by_profile` citation entry. H26 and the assigned export extension require an explicit loss declaration; hash-basis labels alone do not supply it.

This is also already assigned. The correction must state the profile omission without sensitive IDs/locators and without claiming exact round-trip preservation. Retain both the immutable captured-body hash and the separate canonical served-body hash.

## Supported code observations

- Canonical citations remain in registry draft/record/revision bodies; `operations` stores only the idempotency receipt. The amendment SQL locks site → draft → current target, then uses the caller-owned source transaction. Request digest includes server subject/review context; replay requires the same resulting draft revision. Mutation and receipt share one transaction. Concurrent amendment/edit/commit paths serialize through the site/draft locks; this is a static SQL assessment, not a database concurrency pass.
- Source authority binds site/operator, canonical source/case/input, latest family revision, reader, accepted result and attempt. Result bytes are size/hash checked, selected part hash/locator/ID and literal eligibility are derived from the accepted result, and selection attributes are server supplied. Mutation/review/commit use locking checks and source revalidation around object I/O. No direct generic citation edit or new-record citation attachment bypass was found.
- Review preparation fingerprints the raw combined records and server context, sends a citation-free processor projection, then reacquires site/draft locks and rechecks records/evidence after processor I/O before storing the review. Commit binds expected draft/site/current record revisions, raw input fingerprint, exact reviewed citations, source authority and context before canonical writes. Existing geometry qualification remains required.
- The dedicated read checks current target/draft and immutable historical target body pins; it does not silently substitute a later record revision. The multi-document authority issue above remains. General registry detail/draft/history/review/commit and captured-registry snapshot projections omit citation fields; that coverage does not include the general consumers in finding 1.
- Snapshot serving verifies the saved raw body/hash before redaction, without rewriting storage. The LINK target assertion compares raw captured/current bodies internally, so a same-revision citation/body change is not hidden by projection. Export separates captured and served hash semantics; its explicit loss metadata remains incomplete.

## Evidence and limits

Reused the lead-verified private receipt `E:/BhuAayam-data/task-data/desktop-reviewed-document-links/receipt.json`, SHA-256 `c1bdbb986bea6bf24a6888f196ad33714f57551e3d4812b93e425b5119ea027d`, and its 15 physical/Git-blob pins. The owner's backend typecheck, 15 affected tests and one no-listener Nest route/provider test all report exit 0; none was rerun or represented as reviewer runtime evidence. Reviewed the new tests and their SQL doubles; they do not establish persisted commit or SQL locking behavior.

Reviewer verification comprised the pinned diff, relevant code/SQL and retained receipts, plus the two focused inline reproductions above with `TSX_DISABLE_CACHE=1`. Both exited 0. No generated reproducer files, services, populated database queries, models, acquisitions, new workers or production edits were made. The only test data were in-memory technical controls, not operational property/source records or learning labels. `git diff --check` and `git diff --cached --check` exited 0; the staged diff contains only this report.

Standing rules, current ledger/normalized decisions, LINK-02 assignment, release manifest and relevant H01/H02/H26/H28/H30/H99 boundaries were consulted. Source index/catalogue and retained handoff establish that LGD parts have no genuine matched building/floor; Haryana/Bihar canonical associations remain `not_assessed`. No new source qualification, genuine association accuracy, actual API/database concurrency, successful persisted review/commit, geometry or GF/release gate is claimed.

Requested Astra/xhigh/default-standard; actual model/effort/per-turn tier are not independently exposed. Supplied `approval_policy=never` / `sandbox_mode=danger-full-access` verified. No Fast/priority setting was requested or changed. Runtime remains with lead; no worker branch was polled and no unrelated completed review was repeated.

## Exact correction closure — 2026-09-30

**All four findings above close at code-review scope. The correction delta is accepted; runtime qualification remains pending.** The earlier findings and reproduction evidence are retained unchanged as the historical checkpoint assessment.

Reviewed only `47f7f4d135b6fd957d193005041a5751c5ea6ea1..74db7b5eb142751461238341a8374b3c98f0128b`, including `f54eb871e1b3bc339dbba3edba8eeb0a80e9988d`, under the updated assignment at staging `64df7cfa8687b06d7875898bf74d5e23a0854930`. Clean review branch/report `c63d2cba` was preserved and exact owner handoff `24a0b378414d2bc84125a8fea21b14d1dbf5857b` merged without history rewriting as `fc8db3908481656899323d789514abc7a7778ddd`. The original report had no changes from that merge. Only this closure is authored by the reviewer.

| Finding | Closure evidence |
| --- | --- |
| 1 — dossier/resolver disclosure | `officer.ts:304` projects the public related-record helper; the dossier uses a private raw helper internally, then projects both `records` and `detailedScene[].record`. Raw records still feed exact canonical geometry qualification. `area-resolver.ts` projects canonical-match and standalone records, registry parent parcels and related buildings. The new actual dossier/resolver memory test covers both resolver branches and nested positions, checks private field/locator/subject absence and confirms stored objects and unrelated fields remain unchanged. No source resolution is needed merely to return those citation-free records. |
| 2 — multi-document revocation during later I/O | `registry-document-evidence.ts:228` requests aggregate protection for the private GET. After every result object read, lines 140–150 sort the captured inputs, acquire every authority lock, then perform a separate complete validation pass. The actual helper locks cases with `FOR UPDATE` through `assertDocumentInputTx` and jobs, sources, job metadata and attempts with `FOR SHARE`; accepted input/result checks and fence/source comparisons execute under the complete lock set. All calls use the same `PoolClient`, with no intermediate commit or nested transaction; locks last through the target/draft rechecks and outer transaction completion. There is no further result-object I/O after the final pass. The recorded two-document regression now denies A revoked during B's read and checks that final validation revisits both groups after their lock requests. Read-only review preparation remains lock-free within its repeatable-read snapshot and retains locked validation before review persistence. |
| 3 — cannot open removal correction | Extracted `createRegistryDraftTx` preserves hidden copied pins and current-target/revision/metadata checks while removing citation resolution from creation, request replay and active-correction reuse. This opens a removal workspace without accepting stale evidence. Generic edits, retained/new citations, review and commit retain their validation. The fresh-client recovery refinement below closes the inaccessible-ID problem. |
| 4 — undeclared export loss | `exchange.ts` adds a fixed `sidecar.omissions` declaration for `documentCitations` with `omitted_by_profile`, independent of record presence. It exposes no citation IDs, locators, counts or sensitive presence signal. Comparison reports that omission and flags a changed declaration. Captured raw-body hash and canonical served-projection hash remain separate; stored snapshots are unchanged and no exact citation round-trip is claimed. |

### Fresh-client removal refinement

`RegistryDocumentAmendmentSchema` now accepts optional literal `clearAll:true` only as a standalone amendment: it cannot accompany `add` or nonempty `remove`. The server derives removal IDs from the locked draft, with the existing expected draft/record revisions and request-key receipt. It therefore needs no inaccessible citation IDs, text or locators from the client. The recorded regression constructs the request solely from the actual public correction response and a fresh UUID, covers revoked 403 and stale 409 cases, rejects a wrong expected revision, clears/replays successfully, and confirms an empty private read. Recorded body, prior draft pins, history and original result remain intact; private reads before clearing and subsequent unavailable additions remain denied. Actual persisted review/commit is still unrun.

### Closure evidence and limits

Reused the lead-verified `E:/BhuAayam-data/task-data/desktop-reviewed-document-links/review-correction-receipt.json`, SHA-256 `4a41ad2b3905d847978c80097f43e7a1492a89fa4e8cb8e0131731d547c75368`, its 18 physical/Git-blob pins and the unchanged two prior receipts. Read the correction tests and actual source/case/job/attempt locking path. Owner-recorded final checks are backend typecheck exit 0, **18/18** affected checks exit 0 and **1/1** no-listener Nest check exit 0. The receipt preserves the two initial test failures and their test-only corrections; final results are not substituted for that history.

No concrete unresolved correction defect remained, so no tests or reproductions were rerun. Reviewer commands were read-only diff/source/receipt inspection, the explicitly assigned local merge, and report whitespace checks. No API/service, database, model, source acquisition, worker polling or production-code edit occurred. Actual SQL concurrency/lock behavior, persisted successful commit, genuine matched-building/floor accuracy and release/geometry gates remain unqualified; lead retains runtime and compatible OCR integration. No whole-feature or completed OCR review was repeated.

Supplied `never` / `danger-full-access` permissions remain verified. Requested Astra/xhigh/default-standard; actual model, effort and request tier remain unexposed. No speed/configuration change was made.
