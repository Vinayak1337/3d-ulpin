# T067 — Work queue and visual hierarchy

Implemented against the corrected T069 references. Parent reviewed actual desktop/tablet captures against the revised queue, map, workspace and register images; this is implementation verification, not user visual acceptance.

- Root and plain Studio now open the paginated Work queue. Historical block URLs still open the saved-block directory; case/source/floor/unit context stays intact.
- One header: Work queue / Map / Property Register. Record search names its real scope; saved blocks and synthetic reference remain accessible. Tablet navigation stays visible.
- Queue uses persisted cases and GIS drafts, literal search, server pagination/counts and direct continuation actions. Source-only areas resolve through their retained packages. Current recorded preparation is identified with the same preparation fingerprint as continuation; recorded-history filtering explicitly includes older receipts. Eligibility is rechecked on opening/reviewing. Running jobs take precedence over newer completed jobs; visible queues refresh every 15 seconds and on returning to the tab.
- Saved GIS drafts now have `/studio/imports/:id` for resumable review. Map/directory/workspace Add files entry points use the file-first intake.
- Map uses one requested layers dialog and one inspector/checks panel. Register defaults to model + floor/unit table. Workspace defaults to source canvas + review, with documents/tools on demand. See T067_WORKER_RESULT for scoped changes.

Verification: typecheck, production build, 73 worker regressions and 47 parent route/continuation tests passed. `verify-work-queue.ts` passed 8 actual database checks including pagination beyond 20 items, source-only area, saved GIS resume and exact recorded continuation. `verify-hierarchy.mjs` passed 8 browser groups with no page errors or API writes, including source/history/investigation access, unit identity, layer/document Escape focus return, responsive layout and recorded reload. Scene captures wait for renderer readiness. Evidence: `docs/evidence/t067/`.

Review found and corrected concurrent-job precedence and mounted queue refresh. Final qualification rebuild includes those fixes. No source bytes, geometry, canonical records or history were changed by this task. Next: T068 removal audit and integrated record/export/preservation qualification. Raw GNSS/LAS/DEM processing, free-route Nous extraction qualification, broad ML accuracy and statutory issuance remain outside these UX completion claims.
