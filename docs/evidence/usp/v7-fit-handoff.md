# AI-06A — one fixed V7 E5 fit

30 September 2026. **The single fit completed, but useful zero-error calibration failed.** Both base and saved/reloaded tuned thresholds are `null`. Halifax/Kitchener evaluation and DC/SF diagnostic inference remain unopened; `evaluation-opened.json` is absent. The candidate stays offline and unpromoted. No second fit, post-run inference, threshold change or configuration sweep ran.

## Frozen execution

Trainer code is unchanged at `dfd54ab08e48f584c11e8a71788252b769769845`, on the separate `task/desktop-ai06a-v7-fit` branch in `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`. The accepted source-coverage branch is preserved. Primary staging was read-only, observed at `6727f50b632fc147983ddec11d84915cfe3025d1` before launch. This handoff is the only repository change for the fit assignment.

The existing V6 settings and acceptance objects matched exactly: retained `intfloat/multilingual-e5-small` revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`; last encoder layer only (1,774,464 trainable parameters); seed 17; AdamW; 64 steps; learning rate 2e-5; weight decay 0.01; 128 tokens; CPU float32/two Torch threads; reload tolerance 1e-5; `calibration-zero-errors-positive-macro-recall-v1`. The owned worker-tree cap was 6 GiB, with 600-second fit/run limits. No model or dependency download occurred.

V7 has 40 training fields / 11 positives across eight families. Its three additional building-name positives, one building-polygon positive and non-building controls did **not** add a footprint-key positive family. Every V6 source object, split and label remains intact. All 88 publisher-only input proofs replayed before and after the run; all 67 V6 input hashes remain preserved. The immutable V7 curation corpus/receipt were not rewritten for this separate fit assignment.

## Observed result

The unchanged base calibration score matrix exactly matches V6. Raw saved calibration rankings changed from V6 tuned to V7 tuned as follows; these are diagnostics before a decision threshold, not accepted mappings:

| Positive calibration target | V6 tuned correct top allowed class | V7 tuned correct top allowed class |
| --- | ---: | ---: |
| Footprint key | 2/2 | 1/2 |
| Building name | 0/2 | 2/2 |
| Building polygon | 3/3 | 3/3 |

Polygon fields have only one type-allowed target, so that ranking count does not demonstrate semantic discrimination. Chesterfield `GlobalID` now prefers `building.name` (0.820323) over `building.sourceKey` (0.817375). GNWT `GlobalID` still prefers the correct key (0.825513), but the negative Census county polygon scores 0.859003 for building geometry. A global threshold low enough to accept that remaining correct key therefore also accepts the wrong polygon. Both positive names now correctly prefer `building.name` (0.861652 and 0.861953). The name-ranking gain does not produce a passing operating point.

| Recorded route / split | Correct positives | Abstained positives | Wrong-target positives | False-mapped negatives |
| --- | ---: | ---: | ---: | ---: |
| Lexical / training | 11/11 | 0 | 0 | 4/29 |
| Lexical / calibration | 7/7 | 0 | 0 | 3/18 |
| Base / training | 0/11 | 11 | 0 | 0/29 |
| Tuned / training | 0/11 | 11 | 0 | 0/29 |
| Base / calibration | 0/7 | 7 | 0 | 0/18 |
| Tuned / calibration | 0/7 | 7 | 0 | 0/18 |

The base/tuned rows report the trainer's explicit all-abstention fallback after calibration fails. Their zero false mappings are **not** a useful zero-error operating point. On calibration, each model abstains on both key positives, both name positives and all three polygon positives. By calibration family: Calgary has 1 positive/6 negatives, Chesterfield 3/4, GNWT 3/2 and Census 0/6; both models abstain on all fields. Lexical finds all seven positives and wrongly maps three Census fields, one to each target. On training, lexical finds every positive in all seven building families and wrongly maps four USGS watershed fields. Full per-target and per-family counts and decisions are retained in `candidate-run/run.json`; no final-evaluation improvement is claimed.

## Runtime and verification

- Actual invocation: the existing learner Python ran private `v7-fit-01/execute-once.py`, which invoked the unchanged `scripts/usp/learning/train.py` with the immutable V7 corpus/proof, retained base model, new fit freeze and new `candidate-run` directory. Full argv, cwd, timestamps, stdout/stderr and exit 0 are in `candidate-command*.json` and the log files. The measurement wrapper did not alter training or calibration.
- Fit wall time: **260.187 seconds**; supervised worker-tree run: **278.531 seconds**; complete command: **280.641 seconds**. Sampled cumulative worker CPU time: **456.156250 seconds**, a lower bound from the last 50 ms process samples, excluding supervisors.
- Peak owned-worker-tree memory: **1,353,781,248 bytes** (about 1.26 GiB), using Windows peak working sets plus 50 ms RSS sampling. No limit fired. Immediately before launch, free RAM was 13,076,377,600 bytes and free disk 260,890,472,448 bytes. No GPU was used or another owner's resources changed.
- The saved adapter changed weights and reloaded with maximum calibration cosine delta **0**. Post-run source/input/code/requirements/base-model/adapter hashes passed; no additional model call was used for verification. The single-attempt marker is retained. All seven observed processes exited.
- No implementation correction was needed; existing runtime guards and the actual fixed run were used instead of a new test campaign. Requested agent settings were Astra/max/default; supplied permissions were `never` / `danger-full-access`. Current per-turn model/effort/tier metadata were not independently returned.

## Exact artifacts

Private root: `E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v7-fit-01/`. `completion-receipt.json` pins 29 artifacts, including the eight trainer/loader code files, optional requirements, dependency inventory, base-model hashes, command wrapper, frozen settings, raw calibration scores, candidate weights and verification. Existing originals, source freezes and V6 artifacts remain unchanged.

| Artifact | SHA256 |
| --- | --- |
| `completion-receipt.json` | `ffe3d4f705d91541aa87a0dc52cc8c92bf728a649dcb2703ed8469ba212dbb4e` |
| `fit-freeze-v7.json` | `00e8c38934ee9cd3187bfe8a7cb710fd5d7513daa439808b203328956a54fcdf` |
| `candidate-run/run.json` | `8be41670ad63cb99102e1472fdf529302530d8697b1214c61ae8f4023ef3eab2` |
| `candidate-run/candidate.safetensors` | `cccf82af3f8023919f8b499d314c093257d02d323a384a66924720e7ed4cbd9b` |
| `candidate-run/selection.json` | `d27a7817b3b87d3deeaeb5f8c7ba06b281f027e8dd800134dca272de32e5be94` |
| `calibration-comparison-v6-v7.json` | `05cc7585209a829df926e2e201fa89071876521f73731e91724c098cb9f1428c` |

The unchanged corpus and proof remain in adjacent `completion-v7/`: corpus SHA256 `81773eaf350d96778bc59c8f0f61a0d66e66cf335edb1ec167dd2ce1efd718c7`; input proof `b801b049abdea3f8c88bab8f5c72ef2916acf026ad5168fe45518e5c73259559`. Requirements SHA256 is `993d8aaf0480a51880e75b5b4e1d618ef89ce7fdaf3cdb6d0329ffaafe176085`; base-weight SHA256 is `1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477`. This remains a small foreign schema experiment with no Indian operational, building/floor association, whole-record, source-accuracy or production qualification.
