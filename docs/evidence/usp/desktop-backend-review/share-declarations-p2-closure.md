# RIGHTS-DECL-01-R — two-finding P2 closure

2 October 2026. **Both P2 findings closed; no remaining actionable finding established in this correction scope.** Reviewed correction `68e58370821baf1d8388fbeaf6c82f464440efc4` and [handoff](../share-declarations-handoff.md) `42fe86bdf0eec12585c2bdcc3d18131e5a735cda`, over `3846673ca1f2d77e6b917b14ecff0087e6c38295`. Original review `a5b24632fbfa65aba43005d9cff4257ceaee1020` remains unchanged. This is report-only closure, not integration or runtime acceptance.

## Closure

1. **Whole-population eligibility — closed.** Selected reads now build dependencies from every accepted population member and entry target, plus the selected applicability path. Exact captured membership and all entry pins/bodies are checked before current registry revision/lifecycle validation. A changed, retired or cancelled sibling withholds `packetState` while retaining the selected historical entry and original arithmetic assessment. The response does not acquire sibling labels, clauses or reasons. Historical viewing remains available; current packet eligibility is separately withheld when the complete allocation is stale. Existing amendment-date withholding remains in place.

2. **Authorized cached replay — closed.** Prepare, review and acceptance replay now load the retained proposal and any immutable review, including a review added after preparation. They check operator ownership, exact scope/view/policy and all instrument/population/entry/consent/applicability sources before returning the original receipt. The evidence check verifies retained receipt integrity, active same-site cases, source existence and both retained/current copied-source roots; parent access is checked through the existing document authority. Replay uses original-access mode so benign revision or extraction-reader drift does not rerun acceptance or require an obsolete extraction to remain current. The ordinary exact source checks remain on uncached operations and selected evidence reads.

The write fence now follows the cache lookup and is acquired for every uncached prepare/review/accept before freshness checks or writes. Case-first locks and the recording mutex still precede source/registry protection. Replay performs authorization reads/locks without creating a fence, snapshot, receipt, revision or outbox event. Payload-conflict behavior remains in the unchanged request-receipt authority. Static inspection found no displaced uncached-operation fence or new independently committing writer.

## Verification and limits

Reviewer ran once in the assigned corrected checkout:

`pnpm exec tsx --test --test-name-pattern 'whole accepted population|cached declaration receipts' tests/usp-declarations.test.ts`

Exit **0**, **2/2** focused regressions passed. They invoke actual command/capture/read functions with the existing controlled PoolClient. The first verifies fresh and historical selection after sibling retirement/revision, unchanged entry/assessment, sibling privacy and cancellation with an unchanged revision. The second verifies denial after original-source, consent-source and applicability-source archival and changed access view; authorized replay across source/registry/declaration drift returns identical receipts with unchanged durable state and no INSERT/UPDATE/DELETE statements. These are desired-behavior assertions replacing the two original reproductions, not mocks of the authorization functions.

Only declaration authority/service/tests and the handoff changed. Correction whitespace checks pass. Unchanged SQL/contract/controller and the original broader review are reused. The physical SQL schema still matches `c5693dcc9d2ce2d16b253d6a4a4dc426543e418c90bb5f36b27d3fe3370543fd`. The owner's reported **13/13 affected controls and server/API typechecks** are retained evidence, not additional reviewer executions.

The controlled client does not establish actual PostgreSQL REPEATABLE READ/MVCC, lock timing, triggers, constraints or persistence. Original-access and lineage behavior was inspected in the actual authority implementation; the focused runtime controls use generated technical unmarked sources. No authentic matched declaration, original instrument bytes, current HTTP/object-service journey, real-source applicability, legal approval, packet production or release gate is qualified. SQL was not applied; no source/model/runtime campaign or expanded audit was run.

## Evidence and ownership

Private proof: `E:/BhuAayam-data/task-data/desktop-share-declarations-review-20261002/p2-closure/closure-receipt.json`, **6,268 bytes**, SHA-256 `471999b05de6b37a6dfd866f0b4ab32b198a40940f46e0f74a984185bdf13ae2`. It pins nine changed/relevant code/schema files in physical and Git representations. `focused-controls.txt` SHA-256: `8b951f4e1716c830332f6ef19a6b5238303ced40a70a4711e9a7812cb53e1bb6`. Earlier review/proof remains untouched.

Branch `task/desktop-declarations-p2-closure` starts at the corrected handoff. Preserved branches: `task/desktop-declarations-review@a5b24632fbfa65aba43005d9cff4257ceaee1020` and `task/desktop-ocr-integration-20261002@fadd41bc9f1cc2103a95005f06bd08f587f48493`. Supplied permissions are `never` / `danger-full-access`; requested Astra/xhigh/default-standard, actual model/effort/tier unexposed. Only this report and the assigned private closure directory were written. Prior staging integration authority was not used; staging, other worktrees, sources, generated files and services were untouched. No owned process remains. Return the report commit through the authorized lead callback and stop; integration/publication stays with the lead.
