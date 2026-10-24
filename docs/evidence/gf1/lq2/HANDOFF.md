TASK   LQ2 — large upload, whole-number identifiers and refused review     GATE GF1/GF5 partial
WORKS  An officer can choose a published unique integer identifier, upload an unchanged large map in sequential parts, retry/cancel, and see/exclude published review refusals.
SEE IT `node docs/evidence/gf1/lq2/run-runtime.mjs docs/evidence/gf1/lq2/runtime-new.json large`
INPUTS Niagara 157,817-byte parcels; DA6 NYC 43,263,076-byte original (41.3 MiB); NYC 10013 buildings for recording/reconnect/drawing. All foreign test_only and unchanged; hashes in runtime.json.
GAPS   Step 4 waits for ZB1; LP3b automatic drafting absent; Niagara review not published; reconnect notice late; drawing blank/unqualified.
DESIGN question-model/QuestionFields use published eligibility and preserve revision-safe Change.
       upload-model/upload-command/upload-api plus a sliced hashing worker feed the existing sequential retain/enrol path and tray; @noble/hashes 1.8.0, installed directory 1,094,393 bytes.
       run/model and Packages preserve refusal words and confirmation exclusion; stream-reader/case-subscription fence true byte silence and keep cached facts during recovery.
COMMITS 38071078 docs(studio): LQ2 step 0, the upload routes and what the screen may read
        3c92e345 feat(studio): a unique whole number can be chosen as the identifier
        ca86f41b feat(studio): a large file is checked, uploaded in parts and enrolled, with real progress
        018586b0 feat(studio): a refused review is shown where the package is listed
        a71b9092 fix(studio): the page notices a stopped server and reconnects
        3971a204 fix(studio): an internal departure asks the browser before leaving an active upload
        de74b96d fix(studio): a positively detected silent reader is shown without hiding its first failure
        520f6c91 authorized staging merge for PV1
        d4b77951 fix(studio): use the published unstated-origin upload body without a compatibility assertion
        846146fd fix(studio): keep stored reasons on an unrefused package without adding them to a refused review
        The evidence commit includes this handoff.
CHECKS pnpm studio:typecheck 0; pnpm studio:test 0 (415→429 Studio / 67 files; client 2, scene 44, UI 7); git diff --check 0.
       Design scans 0; final controlled browser 0; observed core browser 0 with partial qualifications; real large-upload browser 0. Exact commands in checks.json.
NEXT   Review/merge the delivered branch without marking GF1/GF5 complete. Resume only the gated/unqualified segments in CHECKPOINT.md after their prerequisites. No push; all five owned runtime nonces removed; no providers. Runtime helper extraction/CLI tidy-up not live-rerun; controlled helpers were rerun.
