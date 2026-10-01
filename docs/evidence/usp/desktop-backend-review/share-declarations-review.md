# RIGHTS-DECL-01-R — declaration acceptance and privacy review

2 October 2026. **Two P2 findings; return the candidate for bounded correction.** Report-only review of code `bf0e1a1a2a718bc4d416562bb854b5f3f2d217e5` and [handoff](../share-declarations-handoff.md) `3846673ca1f2d77e6b917b14ecff0087e6c38295`, from base `142a7c3f65c36d92359d8c65a923a88737f67fa6`. No implementation was changed or integrated.

## Findings

### P2 — Recheck the complete declared population before reporting current packet eligibility

Location: [declarations/service.ts](../../../../packages/server/src/modules/usp/declarations/service.ts), lines 291–300, especially line 292.

`readSelectedDeclaration` checks current registry authority only for `command.target` and that target's applicability path. It then combines this result with the saved whole-population `reconciled` assessment. The other declared members never participate in that currentness check. After an accepted two-member declaration, retiring/revising the other member and capturing a **fresh** snapshot for the unchanged selected member still returns its share with `assessment.state='reconciled'` and `packetState='available'`. The fresh snapshot contains the retired member at revision 2, while the declaration's allocation population remains pinned to revision 1.

Reproduced with the owner's generated technical `ControlDb`, through the real prepare/review/commit/capture/read functions. Set the sibling registry result to revision 2 / `retired`, capture a new selected-target snapshot, then call selected-target read with `validAt='2026-10-02'`: actual `available`; expected current eligibility withheld or a stale-dependency conflict pending review of the changed population. The existing identity retirement path updates the status and record revision (`project-identity.ts`, lifecycle command); this control simulates its resulting query rows, not a real lifecycle transaction. No sibling private labels leaked in this control.

Validate all population/entry dependencies needed by the accepted allocation before advertising current packet eligibility, including retirement/cancellation and the exact pins in the newly captured scope. Preserve the immutable entry, original assessment and legitimate historical read; do not rewrite history or silently assign the old share to successor identities. A historical view must remain distinguishable from current eligibility. This follows H16's complete-population/retired-member rules and H01's full dependency invalidation.

### P2 — Reauthorize cached declaration receipts after source access changes

Location: [declarations/service.ts](../../../../packages/server/src/modules/usp/declarations/service.ts), lines 105–106, 139–140 and 179–180.

All three command paths return a matching receipt before `fresh`/`validateTx` or `assertDeclarationEvidenceTx`. `assertLocalUsp` authenticates the operator and `lockDeclarationSiteTx` locks rows, but neither checks that the contributing case is still active. Consequently, after a successful prepare/review/accept and subsequent source-case archival, identical requests still return the original draft assessment, review assessment and accepted receipt. The same source is correctly refused by selected-target read with `DECLARATION_SOURCE_DENIED`.

The controlled reproduction confirms all three successful replays, the contrasting read denial and no extra durable writes. H01 explicitly requires the original idempotent receipt **after current authorization**. Reauthorize the retained proposal/review's contributing sources and access context before returning a cached receipt, without rerunning acceptance, changing its historical pins or treating benign revision drift as a new command. Include prepare/review/accept replay in the narrow regression for archived or revoked source access.

## Checks and inspected boundaries

- `pnpm exec tsx --test tests/usp-declarations.test.ts tests/usp-contract-producers.test.ts` — exit 0, **11/11**. Covers exact rational arithmetic, complete versus partial 99.5%, duplicate/missing population, zero-declaration compatibility, actual command dispatch, review/replay, controlled rollback, stale acceptance, selected-body redaction and retained amendments/consent withholding.
- `python scripts/db/verify_extraction.py` — exit 0: 25 exact historical SQL files / 136 statement hashes, 16 authored files and 40 named migration queries. Physical schema SHA-256 matches the lead/owner: `c5693dcc9d2ce2d16b253d6a4a4dc426543e418c90bb5f36b27d3fe3370543fd`.
- Two focused private observed-behavior controls — each exit 0, confirming the incorrect outcomes above. These assertions document the defects; they are not passing desired-behavior regressions. Final commands use `pnpm exec tsx --test --test-name-pattern 'review_selected_current_population_dependency'` and `'review_replay_reauthorizes_archived_source'` against the private `review-controls.ts` below.
- Static review traced exact source/receipt and copied-lineage checks (including unmarked sources), case-first locks, the per-site fence, immutable unique reviews, additive foreign keys/triggers, same-client revisions/children/post-write snapshot/receipt/outbox, amendment periods, bounded rational arithmetic, general-body redaction and selected-target source reauthorization. Registry dispatch remains unchanged outside the new declaration branch. No further actionable finding was established in this bounded review.

The acceptance fence is a row modified on acceptance after the advisory lock. Under PostgreSQL REPEATABLE READ, waiting on a row changed since the transaction snapshot is intended to force a serialization failure; the wrapper maps that to a refresh conflict after rollback. The controlled client only injects `40001` and models rollback. It does **not** verify actual MVCC, lock timing, constraints, triggers or deferred foreign-key commit behavior. SQL was not applied. Reuse the owner's final backend typecheck; no code changed to justify repeating it. Controller registration and generated API publication remain lead-owned and pending.

## Evidence, limitations and ownership

Private proof directory: `E:/BhuAayam-data/task-data/desktop-share-declarations-review-20261002/`. Receipt `review-receipt.json` is 12,191 bytes, SHA-256 `913bccd2828767760afba93d951f87d58029d271d2bcf7c081b27414e16107b3`; it pins 22 code/test/schema files in physical and Git representations and the three final proof artifacts. `review-controls.ts` SHA-256 is `fbc022f14b83347c83baba327517fc8c80d0f19582c7630ba0ba15e3c603190f`. Final observations are in `current-population-output.txt` and `replay-output.txt`; the earlier combined output is retained as exploratory history. The harness reuses the owner's generated controls with absolute imports and adds only the two review cases. It creates no operational source or property record.

Source index/catalogue and H01/H16/H26–H30/H99 were consulted. No authentic permitted matched declaration instrument, original-byte check, current HTTP/SQL/object persistence, real-source arithmetic/applicability, legal approval, packet production or release gate is qualified by this review. A statute is not a matched building instrument. No new source, model, renderer or runtime campaign occurred.

Review branch: `task/desktop-declarations-review`, in the existing exclusive integration worktree. Completed `task/desktop-ocr-integration-20261002@fadd41bc9f1cc2103a95005f06bd08f587f48493` remains preserved. Supplied permissions are `never` / `danger-full-access`. Requested Astra/xhigh/default-standard; actual model/effort/service tier are unexposed and no setting change is claimed. Only this report and the assigned private proof were written; staging, source branches, other worktrees, generated artifacts and services were untouched. No owned process remains. Return the report commit through the authorized lead callback, then stop.
