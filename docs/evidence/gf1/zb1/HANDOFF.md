TASK   ZB1 — a zero-building layer after recorded buildings is reviewed or says why     GATE GF1
WORKS  Parks and roads dropped afterward are reviewed automatically and recorded with zero-building confirmations; a refused review is published on the package and tray row.
SEE IT node docs/evidence/gf1/zb1/run-runtime.mjs <new-receipt.json> final
INPUTS Unchanged NYC buildings original, parks and roadbed; the one rejected building stays rejected. Roadbed pushes the whole-area display beyond its bound. Separate labelled command-refusal control uses the real retained originals and job authority.
GAPS   LQ1b's missing review is not reproduced; whole-area context after roads refuses its existing 2,000-feature bound; no browser qualification.
DESIGN intake-targets.ts stores/clears the outcome in the existing hold/prepare transaction and publishes it in packageFactsTx's single bounded projection, without returning body/features. intake.ts adds the nullable read member; the server always emits it, optional on the wire for older fixtures. An additive pair on usp_intake_items uses the existing migration and its manifest pins. No worker, dispatcher, review-rule, large-path or Studio edit.
COMMITS fb000e02 — docs(usp): ZB1 step 0, why a layer dropped after recorded buildings is not reviewed
        cc9174bd — fix(ingestion): a package's review outcome is published, with or without buildings
        Final evidence commit follows these two; check git log for its id.
CHECKS Commands/counts/exit codes in checks.json; backend and unchanged Studio typechecks pass; 257 before / 261 after ingestion-related checks; final HTTP and refusal-control walks exit 0.
NEXT   Integrate the outcome migration with the normal migration command and give the Studio the new member. Reproduce the old browser observation separately if it persists. The zero-building success path has no target event: if the page read raced the review, its refresh/subscription behavior is a separate seam. Keep the existing whole-area display limit; its larger-area read is another task.

## Step 0 — stop rule (c), no Z1 fix

`step0.json` was committed first. After 1,661 buildings recorded and 100 cards completed, parks' prepare job was queued, claimed once, and succeeded. The observed automatic review started 108 ms after queueing, ran 411 ms and passed. At the first page read its entry was still READY_FOR_REVIEW; the following package route already returned REVIEWED. After 120,172 ms from the draft, the page returned the current fingerprint. Parks-first, then buildings without recording between, also passed on its own fresh box. No hand-issued review request was made.

The comparison uses the same Studio request members and originals, but no browser/proxy/subscriptions, a 250 ms dispatcher timer rather than LQ1b's 500 ms, and the required two-minute observation rather than its 5.5-second parks-page delay. This proves a passing order, not the cause of the old runtime. LP1's qualified bounded context is observed as-is: parks' review counts the already recorded unqualified neighbours without assessing them. No check was skipped or weakened.

## Z2/Z3 persistence and contract

`jobs.error` is cleared by successful completion, and `usp_job_metadata.result_ref` is replaced by a validated asset reference (`jobs.ts:234-236`). Neither is a surviving free-form refusal slot. The nullable column pair therefore belongs to the existing package-linked item; no new table, registry or authority is introduced. The migration file/statement hashes in database/manifest.json are its required registration.

`holdPackageTargetsTx` keeps the existing target hold and calls reviewOutcomeTx on the same client. It writes the product's exact code/words and the row's reason, without changing state/placement, and appends the existing item event. Repeating the same outcome does not rewrite the row. A current passed review clears the pair and its matching reason in prepareIntakeTargetsTx; a different retained reason is not erased. packageFactsTx adds a bounded join on the page's anchor items, selecting the two fields only. Every projected entry emits null before review or after success.

The member is optional for older read responses/fixtures but nullable when present. Making it required caused three unchanged Studio fixture casts to fail typecheck; the additive compatible form avoids any Studio edit. The runtime server always supplies it. The schema remains strict about the refusal's own code/message, and the generated catalogue/client agree.

## Final observations

`runtime.json`: buildings are recorded with 100 cards before parks arrives. Parks is automatically reviewed, then one confirmation names its published pins and `targets: []`. Area context observes 1,661 buildings and 41 parks. Roads (`roadbed.geojson`, road, `/features/*/id`) arrives afterward; its automatic review passes and its zero-target confirmation records 446 features. Area summary then observes 2,148 features. Whole-area context refuses `AREA_LIMIT`: “This block and its explicit group members exceed 2,000 features. Choose a smaller bounded group.” (`areas.ts:229-235`). It is a display read refusal, not a review refusal; final per-kind whole-area counts stay unavailable, with roads' actual count read from its committed package instead.

`refusal-runtime-03.json` is a separately labelled command-seam control, not a naturally refused source. It injects the existing qualification refusal without changing any source fact. The actual prepare job ends successfully, as the existing worker intends, with error null; HTTP still returns the exact refusal and row reason, with zero targets for parks or all 1,661 targets held for buildings. Reapplying the migration preserves the pair. An explicitly labelled recovery control queues another prepare job (no review route); the real passed review advances to revision 2 and clears both publications. Beside-code tests cover never reviewed, both target cases, incomplete/current revision clearing, and preservation of a different reason.

Full receipts and every repeated read/progress row are immutable outside Git at the compact receipts' rawReceipt paths. All seven nonce-owned containers are gone; originals unchanged, loopback only, no providers, no populated volumes or other containers touched, no merge/rebase/push.
