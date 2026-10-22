TASK   REH10 — fixed-staging rehearsal on ulpin-reh-02            GATE GF5 / GF4 / GF1
WORKS  Final-newline CSV reads as a table; a feature-only exterior card verifies consistent.
SEE IT node -p "require('./docs/evidence/runtime/reh10/result.json').verdict"
INPUTS NYC footprints + LPC register; orthophoto TIFF + LAZ; two real register rows with a final LF.
GAPS   Required matched-register card and surface drawing failed; this is not a successful rehearsal.

Verdict: NO roll to 58559aa3: table selection, evidence reading and surface admission block the show.

## What happened
- Preserved the stopped run's six changed/new files in its own checkpoint before runtime work.
- Serving checkout stayed at 58559aa3. Start: 27.022 s; doctor: 28 PASS, 0 FAIL, gateway disabled.
- Product reads found four retained originals, drafted footprints, a failed evidence job and untouched surface parts.
- Old case `077acb5d-bf9f-4cec-93f3-44ed5a3cd3f0` was preserved. Earlier drop/layout observations are retrospective.
- One bounded fresh-case comparison used `76f1cdb3-1407-40b4-b9a2-20cea1c53380`, never deleting the old case.
- Retain to batch: 2.592 s. Layout approval to draft finished: 28.971 s. Same reading failures on the fresh case.
- Register stayed in the batch, but has no selectable Next step: the table section cannot be opened.
- Both surfaces stayed at their first planned part without a job for 532.099 s. No surface was placed or drawn.
- Declared integer BIN, map field bin, register column bin. Evidence job failed `STREAMING_ORIGINAL_REQUIRED`.
- Screen remained partial, 0 read; every outcome count was 0. Accept-all found no exact match.
- One honest acknowledgement/confirm attempt was refused locally because the reading had not closed.
- No evidence confirmation or note was stored; the 100-match cap could not be exercised.
- A separately labelled fallback confirmed only footprint records and one feature-only card, not a register citation.
- 1,661 recorded; card `2614548e-a54b-40d5-bff2-84614f55ec7b`, revision 1, for feature 1001601.
- Verification: consistent, 6/6 checks; signature not assessed. PDF quotes only the footprint feature, no register row.
- Act 2: 302-byte CSV, final LF, 2 records / 9 columns; raw rows and mapping completed, no teacher calls.
- Act 2's 60.081 s is an observation bound from a wrong URL wait, not measured processing time.
- Batch drafting: worst 67 ms, 0 frames over 100 ms. Resumed map: worst 467 ms, 6 over 100 ms.
- Earlier wrong-area HDB map: worst 667 ms; not evidence of NYC surface drawing.
- Before shutdown: 3 console resource errors across both runs, 0 duplicate-key warnings, 0 page errors.
- Browser video flushing overlapped intentional stop: 24 further resource errors, excluded from journey counts.
- Rehearsal and Studio stopped; all records/volumes kept. Four resumed videos and screenshots stay outside Git.

## Demo and next work
- Demo was already down on resume: 23 PASS / 5 FAIL; native PIDs absent, health unavailable.
- Before/after doctors both exited 1, same commit and container IDs, same empty native-process inventory.
- Its stopped-run PIDs 33352/33728 had disappeared before this session. No demo restart or repair was attempted.
- Docker answered throughout. Guard state/ledger were read only; no guard, credential or runtime-config changes.
- Lead: expose table-item selection; use the bounded retained-original reader for evidence; diagnose surface admission.
- Failed evidence must show its failure rather than unexplained partial coverage. Exact paths are in result.json.
- Owner/runtime owner: separately diagnose the already-down demo; this task did not recover it.

## Checks
- Start, rehearsal doctor, schema/hash readback, PDF extraction, rehearsal stop and identity-checked Studio stop: exit 0.
- `check.mjs`: nine product GETs, seven response-schema checks, four retained hashes, no stored refused confirmation.
- Demo doctor: exit 1 before and after, unchanged unavailable baseline; not a passing demo qualification.
- Syntax checks, JSON parsing, evidence/secret/line-length scan and `git diff --check`: exit 0.
