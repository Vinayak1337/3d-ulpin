TASK   A4d completed through A4e — pinned foreign admission + one arm     GATE GF-AGENT, FP-LEARN-TEST
WORKS  All nine tables accepted; 214 new fields verified. One CPU cross_fit/no-class-balance arm and one count receipt.
SEE IT ULPIN_PROFILE_PYTHON=E:/BhuAayam-data/ml/venv-plans/Scripts/python.exe \
       PYTHONDONTWRITEBYTECODE=1 pnpm exec tsx scripts/agent/measure-a4d.ts --check
INPUTS Good: T1c's real documented tabular columns. Difficult: T1d's WKT footprints without registered source CRS.
GAPS   No correct positive commits; Stage B only 33/300 positive-target examples (shortfall 267). No accuracy claim.
DESIGN Exact manifest admission at three guards; no foreign family becomes pool. Existing verifier and trainer reused.
       Saved scores supply both geography groups at the same threshold. Held-out is a single frozen count-only run.
COMMITS cae053e7 admission; cb6b69a6 Part 1 evidence; 8dc02516 resumed measurement; final evidence commit follows.
CHECKS Agent suite 18/18; Stage A 12/12; agent tsc, backend typecheck and Python -B ruff pass.
       Canonical verifier exits 0 twice; --check and --blocked-check pass; T1/T1b reproduce byte-identically.
       Retained v43/v48 load; diff/line-width audits pass. No fit or held-out run repeated after usage-limit resume.
NEXT   Lead review/integrate. T-data fires; fallback Step 1 requires owner authorization. No fallback work started.
       T-method is not evaluated: its positives-are-there prerequisite is false. Do not deploy based on these counts.

## Verification, unchanged teacher bytes

T1c SHA-256: `7ecd2721a4183a1a689782258d6690449cb5640cda2280659e3f82723754fa45`.
T1d SHA-256: `d267de96326cab764d09e08dd53418f422e6d47bd05a8c25c42ca219efa6f0e0`.

- T1c: **6/6 tables accepted**, **196/198 fields verified**. Two `building.use` fields fail dry-run with
  `MAPPING_ENUM_UNRECOGNISED`. These are semantic field refusals, not table rejection or admission failures.
- T1d: **3/3 tables accepted**, **18/21 fields verified**. Exactly the three expected footprints fail with
  `MAPPING_CRS_UNVERIFIED`; every expected profile id matches. No missing/unexpected refusal, reason-code mismatch,
  table-rejection difference or verified-field count difference.
- No fourth guard occurred. Teacher lines were neither repaired nor relabelled.

| Target | T1c verified columns / families | T1d verified columns / families |
| --- | ---: | ---: |
| building.addressLiteral | 6 / 5 | — |
| building.name | 5 / 4 | — |
| building.sourceKey | 3 / 3 | 1 / 1 |
| building.use | 0 / 0 | — |
| building.storeyCount | 1 / 1 | 1 / 1 |
| building.footprint | — | 0 / 0 |
| building.heightM | — | 1 / 1 |

## Frozen rule and measurement

One arm: `--calibration-mode cross_fit --no-class-balance`. No changes to features, hashing, learning rate,
epochs or batching. **805** fitted examples = **772 unknown + 33 positive**, compared with A4c B's 591/15.
**32 folds** = 24 Indian + 8 foreign (`opf-d02`–`opf-d09`). All five pool families remain in every fitting set;
the 64 pool examples are not part of the 741 development cross-fit scores.

Model: `E:/BhuAayam-data/task-data/a4d/learner/one-arm-v1/v1`.
SHA-256: `87c9c7764d50fd7a96b4e6e3e32e6512857625d05e6282d4f0d7e309bbad4231`.

| Arm / geography | Threshold | Scored n | Wrong | Correct positive | Unknown committed | Abstained |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A4c B pooled / Indian | 0.9497545957565308 | 527 | 0 | 0 | 53 | 474 |
| A4c B foreign | same | 0 | 0 | 0 | 0 | 0 |
| A4d pooled | 0.9866563081741333 | 741 | 0 | 0 | 2 | 739 |
| A4d Indian | same | 527 | 0 | 0 | 2 | 525 |
| A4d foreign | same | 214 | 0 | 0 | 0 | 214 |

All nine positive targets have **0 commits**. **Zero pooled wrong commits is by threshold construction**, not accuracy.
The geography rows use the same saved scores and threshold, not separately calibrated subsets.

| Verified positive target | Columns | Distinct families | Cross-fit correct positive commits |
| --- | ---: | ---: | ---: |
| document.registrationNo | 4 | 2 | 0 |
| building.name | 8 | 5 | 0 |
| building.storeyLabel | 3 | 1 | 0 |
| unit.type | 2 | 1 | 0 |
| building.addressLiteral | 8 | 6 | 0 |
| building.footprint | 1 | 1 | 0 |
| building.sourceKey | 4 | 4 | 0 |
| building.storeyCount | 2 | 2 | 0 |
| building.heightM | 1 | 1 | 0 |

**Triggers:** 0/6 original targets reach 12; 6/6 remain below 12, so **T-data=true**.
T-method is **not evaluated**, because the positive-data prerequisite is false; zero commits alone does not fire it.
Stage B: **33/300 verified positive-target examples**, **267 short**. Variants, SFT and RL were not started.
The bounded hypothesis (more real verified positives produce cross-fit positive commits) had **no gain**;
do not repeat or tune this experiment. Lead/owner decide the next separately authorized task.

## Count-only held-out receipt

One frozen model, no threshold feedback: **scorable n=2**, committed **0/2**, correct **0/2**, abstained **2/2**.
**Non-scorable n=2**, committed **0/2**. Four profiles total. No accuracy claim.
Held-out headers, values, target names and predictions remain in the closed external evaluator directory;
none is printed or committed. Resume opened only the count receipt, not evaluator payloads.

## Receipts and historical checkpoint

- `result.json` keeps the original blocked evidence intact in **`attempts[0]`**; **`attempts[1]`** is the completed run.
  The old external boundary receipts and `measurements/result.json` remain untouched.
- Completed development/count receipts: `E:/BhuAayam-data/task-data/a4d/measurements/completed-v1/`.
  `result.json`, `fit-receipt.json`, `heldout-counts.json` and per-round `{profileId, reasonCode}` refusal files
  are pinned in this evidence. Full receipt hash:
  `2d7125a700d1892bcfc4ce6bb83869a8d9cb2a82aae3d5b1c83d2877fd94dc83`.
- `--check` joins existing verified records and checks existing receipts; it performs **no fit or held-out rerun**.
  `--blocked-check` confirms the old external checkpoint still exists with its historical status.
- The Part 1 evidence was committed before fitting. The fit completed before the usage limit;
  on resume, disk receipts established that fact and prevented a second run.
- No provider, acquisition, runtime, GPU, credentials or push; no old external file modified or deleted.
  Test-only split controls are software fixtures, not new teacher labels. T1/T1b and D1f/A5a bytes stay unchanged.
