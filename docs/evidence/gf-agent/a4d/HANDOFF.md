TASK   A4d — Verify/retrain documented rounds, blocked at foreign admission     GATE GF-AGENT, FP-LEARN-TEST
WORKS  Both label hashes match; the unchanged verifier exposes a shared admission blocker before any field dry run.
SEE IT ULPIN_PROFILE_PYTHON=E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe \
       pnpm exec tsx scripts/agent/measure-a4d.ts --check
INPUTS Good: T1c's Seattle/dictionary profiles. Difficult: T1d's WKT footprint tables without stated source CRS.
GAPS   Partial: zero newly verified fields; no experimental fit, new threshold or held-out receipt. Not a gate pass.
DESIGN measure-a4d.ts pins label bytes, checks saved boundary receipts, and reproduces the blocked checkpoint.
       It reuses measure-a4b's verifiedRecords/readers/Python bridge and the unchanged Stage A commit_counts.
       measure-a4c.ts exports only ArmMetrics (type-only import; its main never runs).
COMMITS c618b034 — feat(learning): A4d measurement over the verified T1 to T1d labels
        This commit — docs(learning): A4d verification, retrain and held-out counts
CHECKS Both unchanged verifier CLI runs — 1 (ERR_ASSERTION); measurement/check — 0; overwrite control — 1 expected.
       pnpm exec tsc -p scripts/agent/tsconfig.json — 0.
       Python -B pytest --noconftest, no cacheprovider, test_stage_a.py unchanged — 0 (7 passed).
       tsx agent tsconfig: a3-chunk.test.ts — 0 (4 passed); verify-teacher-labels.test.ts — 0 (3 passed).
       git diff --check; added-line/new-file width audit — 0.
NEXT   Lead: assign exact foreign development admission in checkBoundary, native source materialization and trainer.
       Then resume unchanged labels, one cross_fit/no-class-balance arm and one fixed-threshold held-out count run.
       No guard was relaxed, no family was called pool, no labels repaired, no runtime/provider/GPU use or push.

**Verification:** T1c 0/6 tables accepted, 0/198 fields verified; T1d 0/3 tables accepted, 0/21 verified.
All 219 are **boundary blocked**, not semantically refused: `ERR_ASSERTION`, `t1-profiles.ts:107`:
`assert(profile.split === 'dev' ? development.has(profile.family) : !allFamilies.has(profile.family))`.
The 24 Indian dev families are admitted; `opf-d02` through `opf-d09` are not. No table validation occurred.
T1d predicted three unverified footprints and eighteen verified fields; none of those field outcomes was reached.
Per-refused-label artifacts contain only profile id/reason code. Paths and pins are in `result.json`.

| Labelled target | T1c labelled / verified (families) | T1d labelled / verified (families) |
| --- | ---: | ---: |
| building.addressLiteral | 6 / 0 (0) | — |
| building.name | 5 / 0 (0) | — |
| building.sourceKey | 3 / 0 (0) | 1 / 0 (0) |
| building.use | 2 / 0 (0) | — |
| building.storeyCount | 1 / 0 (0) | 1 / 0 (0) |
| building.footprint | — | 3 / 0 (0) |
| building.heightM | — | 1 / 0 (0) |

| Arm | Fit / positives | Threshold | Pooled n | Wrong / correct positive | Unknown / abstained |
| --- | ---: | ---: | ---: | ---: | ---: |
| A4c B (recorded) | 591 / 15 | 0.9497545957565308 | 527 | 0 / 0 | 53 / 474 |
| A4d | not fitted | unavailable | unavailable | unavailable | unavailable |

Baseline Indian: n=527, wrong=0, correct positive=0, unknown=53, abstained=474. Foreign: n=0, all counts=0.
Pooled wrong=0 is **by threshold construction**, not accuracy. A4d group scores and held-out n are unavailable;
no new frozen model exists. The old held-out result was neither repeated nor presented as an A4d receipt.
Current folds: 24 Indian development families; proposed after admission: 32 (24 + 8 foreign), pool stays in fitting.

**Triggers on admitted verified data:** registration 4 columns/2 families; name 3/1; storey label 3/1;
unit type 2/1; address 2/1; footprint 1/1. None of six reaches 12: **T-data=true**, T-method not evaluated.
No additional target currently has a verified positive. Stage B: **15/300**, shortfall **285**.
The admission failure is not evidence that real sources cannot supply positives; fallback work was not started.

**Smallest prerequisite:** retain the existing blind/privacy/hash guards and admit only the pinned foreign manifest
entries and their exact prefixes into profile boundary + materialization. The trainer's development_families also
reads only Indian D8: its next guard would be STAGE_A_TRAINING_SPLIT_DENIED (static diagnosis, trainer not invoked).
The A4d output root already works via ULPIN_T1_ROOT; no output-root guard change is needed.
Everything else is read-only.
All test writes are under A4d; T1 fixture copies are byte-identical read-only inputs, not new teacher labels.
