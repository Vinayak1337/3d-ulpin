TASK   A4e — worker D: exact foreign admission, then A4d one-arm completion     GATE GF-AGENT, FP-LEARN-TEST
WORKS  Part 1 committed before Part 2. All nine tables admitted; 214 fields newly verified; one fit/count run complete.
SEE IT ULPIN_PROFILE_PYTHON=E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe \
       PYTHONDONTWRITEBYTECODE=1 pnpm exec tsx scripts/agent/measure-a4d.ts --check
       See ../a4d/HANDOFF.md and ../a4d/result.json for the full comparison and historical attempts.
INPUTS Good: exact opf-d02 pinned prefix. Difficult: T1d WKT footprints and T1c enum fields; guards refuse correctly.
GAPS   Zero correct positive commits. Stage B has 33/300 verified positive-target examples, shortfall 267.
       Held-out: scorable n=2, committed/correct 0/2, abstained 2/2; non-scorable n=2, committed 0/2. Counts only.
DESIGN Both manifest boundaries keep blind exclusions. Source authorization is exact stableHash equality;
       the D1f pin/prefix reader is reused. Trainer admits the union as dev and refuses foreign pool examples.
       The same cross-fit scores/threshold supply pooled and geography rows; no features or fitting rule changed.
COMMITS cae053e7 three admission guards + named tests; cb6b69a6 Part 1 evidence before any fit;
        8dc02516 measurement; final evidence commit follows. Branch task/a4d-retrain-documented, nothing pushed.
CHECKS 18 TS tests, 12 Stage A tests, agent tsc, backend typecheck, Python -B ruff all pass.
       T1 411 and T1b 193 profiles reproduce byte-identically; D1f/A5a checks pass; retained v43/v48 load.
       Both canonical verifier runs exit 0; measurement --check/--blocked-check and diff/width audits pass.
NEXT   Lead review/integrate. T-data=true (0/6 targets reach 12); T-method not evaluated (insufficient positives).
       Owner must authorize fallback Step 1; no variants, Stage B, RL, acquisition or further fit was dispatched.

## Completion snapshot

- T1c: 6 accepted tables, 196/198 verified fields, two `MAPPING_ENUM_UNRECOGNISED` field refusals.
- T1d: 3 accepted tables, 18/21 verified fields, three `MAPPING_CRS_UNVERIFIED` footprint refusals.
  All expected ids, codes and counts agree. Teacher bytes remain unchanged. No fourth guard occurred.
- Exactly one CPU arm: `cross_fit`, no class balance. **805 examples / 33 positive**, **32 development folds**.
  Pool remains in fitting. Threshold **0.9866563081741333**.
- Pooled n=741: wrong=0, correct positive=0, unknown commits=2, abstained=739.
  Indian n=527: 0, 0, 2, 525. Foreign n=214: 0, 0, 0, 214. Zero wrong is **by construction**, not accuracy.
- Prior blocked A4d is preserved unchanged as `attempts[0]`; the completed run is `attempts[1]`.
- Resume inspected disk receipts and performed no extra fit or held-out run.
  Closed held-out payloads were not opened.
- Published producer pins are unaffected by A4e's script/trainer-only changes.
  No runtime activation or model deployment.
