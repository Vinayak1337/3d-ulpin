TASK   SFA1 — surface admission and placement            GATE GF5 / G14
WORKS  A fresh batch draws all 9 orthophoto windows and successive LAZ batches without recording anything.
SEE IT node -p "require('./docs/evidence/sfa1/result.json').verdict"
INPUTS NYC orthophoto + LAZ; difficult footprints with one rejected self-intersection; register retained unchanged.
GAPS   Full 211-batch LAZ completion unqualified; other REH10 Act 1 breaks remain.
DESIGN intake-surface.ts: localPartsTx explicitly binds the target EPSG integer overload.
       draftedBounds follows intake item/part package links and retains partially accepted geometry bounds.
       Two regression tests, read-only PostgreSQL comparisons and live schema/artifact readback prove the changes.
COMMITS 1f25407b fix(ingestion): bind surface target CRS to the EPSG transform overload
        b6c54356 fix(ingestion): place surfaces against their batch's accepted draft bounds
        1952c5fb fix(ingestion): require accepted geometry in quarantined draft bounds
CHECKS pnpm exec tsx --test packages/server/src/modules/usp/ingestion/intake-surface.test.ts — 0, 21 passed
       pnpm --filter @ulpin/server typecheck — 0
       pnpm exec tsx docs/evidence/sfa1/placement-sql.ts — 0; old SQL fails 3, corrected SQL succeeds 0
       pnpm exec tsx docs/evidence/sfa1/bounds-sql.ts — 0
       pnpm exec tsx docs/evidence/sfa1/diagnose.ts diagnosis-final — 0
       pnpm exec tsx docs/evidence/sfa1/readback.ts readback-final — 0
       node docs/evidence/sfa1/runtime.mjs doctor unused final-doctor — 0, 28 PASS
       node docs/evidence/sfa1/runtime.mjs demo-before / demo-after — both 0, same processes/containers/commit
       node docs/evidence/sfa1/runtime.mjs stop unused end-stop — 0; all rehearsal containers exited
       node --check docs/evidence/sfa1/{live,runtime,studio}.mjs — each 0; git diff --check — 0
NEXT   Integrate with the other Act 1 repairs; qualify full-cloud completion in the next rehearsal.

The original failure was not storage or lane capacity: a prior item's PostGIS error aborted surface admission.
The fixed runtime is stopped at the final code commit; no demo changes or work on ulpin-reh-01.
The base also needed SV2's additive nullable diagnostics column; the existing REH9 migration runner applied it.
Full transcripts, screenshot/video and timing observations are retained under the scratch path in result.json.
Auxiliary JSON receipts chunk long strings; concatenate those chunks without a separator.
