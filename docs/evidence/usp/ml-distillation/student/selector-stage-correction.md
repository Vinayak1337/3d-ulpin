# STUDENT-09-STAGE-CORRECTION — CPU source-pin correction

3 October 2026. Corrected the selector stager's observed conflict between the current accepted source versions and the older baseline profile. Base `ca5b75932b54cd37e33183e584ba1f5d21c44d2b`; exclusive checkout `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/ml-association-student-20261002`. Coordinator checkpoint `e9bd58ef81ef0e8098f5398aac4ff3f68809f58e`; correction assignment physical SHA-256 `95032ed426569ebd070df01e22c6ce29247842257dd2b79ee5fb498c8733a218`. Primary staging observed read-only at `8668a2f24efe85a6722c827d6e78caafb6d7512e`.

The pure `checked_source_pins` preflight explicitly requires current accepted `model_isolation.py` SHA `69e51fd895697f224960226cdc1f99499d2b43d0b17ac76638e20cdfa8787676` and `student.py` SHA `a380d21dbfceea8012a979182cb9c2f7956b222e984d5c923025ab9e3d34cc87`. The other six protected sources still require exact original-profile physical hashes. Every one of the twelve source paths also requires its exact canonical-LF assignment digest, with missing/extra pin keys refused. A matching assignment alone cannot authorize a different protected version.

Exact clean commit/Git-byte checks remain before this preflight; it runs before disk/root creation or copying. The entire stager suffix from disk-headroom check through copying, freeze/profile creation and command construction matches the base bytes after LF normalization. No shared guard/student/resource/security code, loader, model, prompt, input, historical profile/run or assignment changed.

## Focused verification

- `C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe -B -I -S scripts/usp/learning/association/test_selectors.py SourcePinTests` — exit 0; one regression, 0.012 s. Real current files and pinned retained baseline profile pass; both old protected versions and altered versions reject even with matching assignment digests. Altered original-profile resource bytes, missing/extra pins and changed leaf bytes also reject. `mkdir` was never called; no torch/transformers/peft/accelerate/safetensors imports.
- In-memory `python -B -I -S -` compile/hash check — exit 0; both owned Python files compile, all eleven other assignment code pins/base Git bytes match, correction assignment hash and historical failure receipt hash match. Separate suffix comparison above — exit 0.
- Reviewed the complete two-file diff; `git diff --check` and `git diff --cached --check` pass. Previous codec/teacher/security results were reused; no campaign repeated.

The regression updates only an in-memory test pin for this edited staging leaf; it does not rewrite or authorize an execution assignment. New baseline execution requires a separately inspected assignment with the new final clean HEAD and updated staging-leaf canonical hash.

## Owned code hashes

SHA-256 of canonical-LF bytes (also physical bytes in this checkout):

| File | SHA-256 |
| --- | --- |
| `scripts/usp/learning/association/stage_selector_baseline.py` | `70df68a9b8d89a8316f75c3602ac21b8597cfc555ca1b26eed101aae42be0629` |
| `scripts/usp/learning/association/test_selectors.py` | `4a2364ddb658cee0332eea3b25250fc69912ce280763a493868f2c40da1af3fe` |

Requested Astra/xhigh/default-standard; supplied permissions `never` / `danger-full-access`. Actual model/effort/tier are unexposed; no settings change claimed. Only these two code paths and this handoff changed. No staging invocation, runtime/profile copy, model/GPU action, inference, fit, retry, evaluation or promotion occurred. The blocked baseline and null quality metrics remain preserved; no owned-resource cleanup is outstanding. Return the exact commit/clean HEAD to the coordinator, then stop.
