TASK   R2 — reviewed demo rollout and Tower 3 identity journey            GATE GF1 / GF4
WORKS  Done Step 1: reviewed rollout, document runtimes PASS; pinned page and canonical GETs return 200.
       Stopped at Step 2 / snapshot: record and exact replay 201; snapshot 409 STALE_REVISION, no retry.
       Partly Step 3: recorded-panel read checks pending.
SEE IT http://127.0.0.1:5188/studio/review/6f95d04e-2067-4ac8-a3c2-6cc21ea46325
       Packet/card PDFs and PNGs are pending, not generated.
INPUTS Retained Tower 3 plan1; good caption and difficult small boxed UNIT-3B on the oversized sheet.
GAPS   Snapshot refused; no P3/card/PDF/QR. Labels establish no boundary, measurement, rights or level ordinal.
DESIGN scripts/agent/r2-live.ts retains each request before sending and each response after receipt in new files.
       Reuses R1's read-only count routes and contract schemas; no configuration access or application-code changes.
COMMITS 1834874f — Step 1: reviewed rollout and live document-runtime probes.
        Step 2 commit: source-space record/replay and stopped snapshot finding.
CHECKS doctor before/after 0; tsc 0; probes 0; counts before/after 0; record/replay 0; snapshot driver 1 (HTTP 409).
NEXT   Lead: review the source-only snapshot closure. Existing floor/space are retained; never record a second pair.
       snapshotRows captures every same-site source; the refusal comes from assertDocumentInputTx's freshness gate.
       The failing source is not exposed. The USP filter emits no log; no native-log reader is approved, so no raw
       runtime files were read. Snapshot/review/assign/plan/card remain unrun beyond the saved failed snapshot.
       Runtime is up at the reviewed target. No containers stopped/replaced; gateway disabled; no provider call.
