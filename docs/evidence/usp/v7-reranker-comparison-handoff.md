# AI-06B — retained Qwen comparison on V7 development splits

30 September 2026. **One GPU inference pass completed; useful zero-error calibration passed** at the saved global threshold `0.9736446738243103`: 5/7 calibration positives, zero incorrect accepts and at least one correct positive for each target. This is development/calibration evidence only. Halifax/Kitchener evaluation and DC/SF diagnostic inference remain closed. The model stays offline and unpromoted.

## Owned change and frozen execution

Accepted base: `5808947993d487db8f4ead63b2db6418ec3b8f90`. Code commit: `cc9f108de031fc37bda3e65164a3bcc0dc05223e`, adding only `scripts/usp/learning/compare_reranker.py`. Worktree: `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/desktop-ai06b-qwen-comparison`. This handoff is the only additional shared file. Primary staging remained read-only; source index, catalogue and learning narrative remain lead-owned.

The retained `Qwen/Qwen3-Reranker-0.6B` checkpoint is revision `e61197ed45024b0ed8a2d74b80b4d909f1255473`, Apache 2.0, with weight SHA256 `27cd75a405b9c1b46b59abfd88aaa209e6fed2a1972cde9b70e7659537c5e65b`. No model/dependency download, fit, prompt change or configuration sweep occurred. Local loading disables remote code and uses the separate locked environment at `E:/BhuAayam-model-evaluation/20260929/.venv/Scripts/python.exe`: Python 3.11.15, Torch 2.8.0+cu128, Transformers 4.57.6; all 25 dependency versions are frozen.

Only V7 **40 training fields + 25 calibration fields** were scored: 195 field/target pairs, 65 batches of three. The retained smoke's instruction, prefix, suffix and target descriptions are unchanged. Documents contain publisher-derived profiles, with reviewer targets/reasons and raw row values excluded. All prompts matched the retained construction; changing reviewer targets did not change them. Profiles, prompts, token lengths, model/dependency/code hashes, resource limits and selection policy were frozen before inference. Maximum input length was 238/1024 tokens; no truncation occurred.

Scoring used RTX 3070, FP16/SDPA, seed 17, two Torch CPU threads and no generation cache. Final-token `[no, yes]` logits were cast to float32 and softmaxed to a yes score. The complete matrix was saved before invoking the existing calibration policy once. Existing native type constraints still govern allowed targets. The 0.5 cutoff is a fixed, uncalibrated diagnostic on these same development splits; it is not the unopened DC/SF diagnostic split.

## Observed comparison

| Route | Split | Correct positives | Abstained positives | Wrong-target positives | False-mapped negatives | Exact fields |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Qwen fixed 0.5 | Training | 11/11 | 0 | 0 | 5/29 | 35/40 |
| Qwen calibrated | Training | 5/11 | 6 | 0 | 0/29 | 34/40 |
| Qwen fixed 0.5 | Calibration | 7/7 | 0 | 0 | 4/18 | 21/25 |
| Qwen calibrated | Calibration | 5/7 | 2 | 0 | 0/18 | 23/25 |
| Saved lexical | Training | 11/11 | 0 | 0 | 4/29 | 36/40 |
| Saved lexical | Calibration | 7/7 | 0 | 0 | 3/18 | 22/25 |
| Saved E5 base/tuned, each | Training | 0/11 | 11 | 0 | 0/29 | 29/40 |
| Saved E5 base/tuned, each | Calibration | 0/7 | 7 | 0 | 0/18 | 18/25 |

E5/lexical metrics were copied from the accepted [V7 fit](v7-fit-handoff.md), with identical selected labels/order; neither route ran again. The E5 rows are its explicit all-abstention fallback after failed calibration, not a useful operating point. At 0.5, Qwen finds all positives but makes more negative false mappings than lexical on both splits.

| Calibrated split | Footprint key | Building name | Building polygon |
| --- | ---: | ---: | ---: |
| Training | **0/2** | 2/4 | 3/5 |
| Calibration | 1/2 | 2/2 | 2/3 |

Counts above are correctly accepted positives. **Both training footprint keys abstain**, so the passing calibration cannot establish reliable key handling. Calibration abstains on Calgary geometry (0.9458011984825134) and GNWT GlobalID (0.8872045874595642).

Calibrated positives by family: training NOLA 1/2, NYC 2/3, MassGIS 0/1, Vancouver 1/1, Cambridge 0/1, Oregon 0/1 and Tweed 1/2; calibration Calgary 0/1, Chesterfield 3/3 and GNWT 2/3. USGS training and Census calibration are negative-only and have zero false mappings at the calibrated threshold. Full target/family counts and decisions are in the private result.

The fixed 0.5 errors are NOLA `shape_starea`/`shape_stlength` proposed as keys, MassGIS `SOURCE`, Cambridge `TYPE` and Oregon `CITY` proposed as names; calibration Census geometry is proposed as building geometry, and Calgary `bldg_code`, `bldg_code_desc` and `obscured` as names. Calibrated abstention removes these errors on the checked splits at the measured recall cost.

## Runtime and verification

| Resource | Measured | Frozen limit |
| --- | ---: | ---: |
| GPU peak allocated | 1,220,791,808 bytes | 3 GiB |
| GPU peak reserved | 1,245,708,288 bytes | 3 GiB |
| Minimum sampled free GPU | 6,168,772,608 bytes | At least 1.5 GiB |
| Peak owned worker-tree working set/RSS | 3,068,051,456 bytes | 6 GiB |
| Supervised wall time | 8.687 seconds | 600 seconds |

Inference took 2.734 seconds; worker elapsed time was 8.000 seconds; the full command took 12.547 seconds. GPU allocator peaks include model load; device free memory was sampled after loading and each batch. RSS uses Windows peak working sets plus 50 ms sampling, includes the Python launcher, excludes the supervisor and can briefly overshoot between samples. No limit fired. Preflight recorded 14,264,242,176 bytes free RAM, 260,881,211,392 bytes free disk and 7,458,521,088 bytes free GPU.

- Syntax compilation and preparation exited 0; preparation checked retained model bytes, exact publisher input proof, prompt construction, locked dependencies and token lengths. The committed script uses the unchanged process-tree guard and exclusive attempt/output writes.
- The actual `compare_reranker.py run` invocation, all absolute arguments, cwd, code commit, timestamps, stdout/stderr and **exit 0** are retained in `command-started.json` and `command-result.json`. Worker and guard also exited 0; stderr was empty.
- Post-run command: `E:/BhuAayam-model-evaluation/20260929/.venv/Scripts/python.exe E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v7-reranker-01/post-run-verify.py`, from the owned worktree, **exit 0**. It verified the finite 65 x 3 matrix, all 130 decisions at the two saved cutoffs, aggregate/target/family metrics, exact saved baseline copies, selected profile/prompt proofs, five code snapshots, eight model files, 25 dependency versions, resource limits and closed-split outputs. It made no model call or threshold search. No prior E5 campaign was repeated.
- All three recorded owned PIDs (40504, 3296, 620) were absent at completion verification. No process needed termination and no other owner's resources were changed. Originals, earlier branches and checkpoints are preserved.
- Assigned agent settings were Astra/max/default. Supplied permissions are `never` / `danger-full-access`; current turn model/effort/tier were not independently returned.

## Exact artifacts and limits

Private root: `E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v7-reranker-01/`. The exclusively written completion receipt pins 19 artifacts, including code snapshots, commands, freeze, matrix, selection, result, resource guard and post-run verifier/evidence.

| Artifact | SHA256 |
| --- | --- |
| `completion-receipt.json` | `8e63e3cffcc8628b371ee3f50ca1907a5191d534e16131fc33c1601da8b7ce05` |
| `post-run-verification.json` | `94b71fa7f1408e4c535f56cc087b2b8965522718e51103388b8958373854f24e` |
| `freeze.json` | `d76f3c651269dfccd5c607038d603b698f9bbe7e62a75c0cf873c4378a467eb9` |
| `run/scores.json` | `4ba474ab5574b3956a414b8e0e961c975496bed8f6b2d5627ae65e6a5490039d` |
| `run/selection.json` | `5a3e784a578cf1b5ee511ec620b64e9dd1dc41f4b85cfe2999f0020782e76f42` |
| `run/run.json` | `e0b40f2ad75206c64ce5c09653e79c4ef79f14d7340a8ca8e9bfc5d34226f541` |

Unchanged adjacent `completion-v7/` corpus SHA256: `81773eaf350d96778bc59c8f0f61a0d66e66cf335edb1ec167dd2ce1efd718c7`; input proof: `b801b049abdea3f8c88bab8f5c72ef2916acf026ad5168fe45518e5c73259559`. Saved E5 result: `8be41670ad63cb99102e1472fdf529302530d8697b1214c61ae8f4023ef3eab2`. Retained requirements: `c27e534e121858d96dfa531e14374642a43bed9544aeef0426b39353280ab4e3`.

V7 still has no additional positive footprint-key training family. These are small foreign schema examples with independent permitted labels, not Indian operational data or provider-derived training labels. No held-out quality, building/floor association, whole-record mapping, source accuracy, training-memory, production or release qualification follows. The assignment ends with this development comparison; any further inference or model decision belongs to the lead.
