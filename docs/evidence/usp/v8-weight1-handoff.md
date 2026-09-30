# AI-06F — weight-1 ablation blocked before restricted launch

30 September 2026. **Isolation setup failed before any child launch or model execution. No weight-1 fit/result exists.** The one recorded launch attempt stopped on Windows output-directory integrity-label assignment; no unrestricted fallback, retry, new model/corpus, threshold selection, evaluation or promotion followed.

## Exact blocker and cleanup

The task-local launcher created its unique AppContainer profile, then attempted:

```text
icacls E:\BhuAayam-model-evaluation\20260930\ai06f-weight1-01\execution\run /setintegritylevel (OI)(CI)L
```

That command returned **exit code 5**. The retained exception and traceback identify the operation. The subprocess's captured stdout/stderr are not included in the receipt, so a more specific Windows diagnostic is not attested. A read-only follow-up showed medium integrity (`S-1-16-8192`) for the host token, directory owner `VINAYAK\kvina`, inherited Authenticated Users Modify and Users Read/Execute, and no low-integrity label. Full Codex `never` / `danger-full-access` permissions were supplied; they do not alter this Windows access-control result. This does not establish that administrator access is the only possible solution.

No AppContainer access grant had been attempted yet. The accepted cleanup helper reported `sidFreeFailed=false` and profile deletion HRESULT `0x00000000`. Profile: `CodexAI06F_e200fc880b9948f8806bae390a47e90f`; SID: `S-1-15-2-2042985819-2633639045-2820758284-1782034560-3728295843-2381238933-3560769012`. `completedPhases` is empty; there is no model `execution/attempt.json`, `fit-started.json`, adapter or score output. The run directory remains empty. No task Python process remained at the post-run check.

The AppContainer token/Job/output-write preflight therefore **did not execute**, and neither did the focused loss tests or training. The actual writable output scope must be established under a separately reviewed continuation before any model run. Do not count this as a failed learning-quality experiment or bypass the isolation requirement to obtain scores.

## Prepared code and frozen learning choice

- Primary read-only head was `28932a6693a0dde68d62c37d50ec4d0f1d288ba2`; accepted base `530774ce5bfb8c466bd55c60a93149db8625533c`.
- Branch/worktree: `task/desktop-qwen-lora-weight1`, `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`. Original `task/desktop-qwen-lora-v8` and its `59f81d9` / `edade4a` / `7659b88` history remain preserved.
- Implementation commit: **`7a5b0d132253c757911f65fee6a729ec09c4492c`**. Requested Astra/high/default; actual model/effort/tier not independently exposed. No priority request.
- New task-local adapter: `scripts/usp/learning/run_weight1_isolated.py`. It stages dedicated copies, calls the accepted unmodified `appcontainer_audit.py` primitives, and gates a single fit on actual non-model output-scope preflight plus focused checks. It has an exclusive launch-attempt marker and no unrestricted execution fallback.
- Small backward-compatible changes: `margin_loss` accepts a positive weight with default **8**; the original worker reads that value from its unchanged default settings. Optional internal context/isolation callbacks allow the restricted wrapper to supply development-only staged inputs and verify its actual AppContainer token/Job. The original CLI retains its supervisor check. One focused test checks default-8/explicit-1 positive loss and unchanged negative loss.
- Standard-library freeze comparison confirmed the **only learning-settings change is `positiveWeight: 8 → 1`**. Pair plan, all three deterministic epoch orders, prompts, token lengths, target definitions, type constraints, seed, optimizer, precision, q/v rank/alpha, clipping, 51 updates, final-only selection and global development criterion are unchanged. The intended initialization remains the original base model, not the failed adapter.

The original weight-8 executable snapshots and run are unchanged. The new wrapper/code path has syntax/static review and staging verification, **not** a successful restricted execution or numerical-test qualification yet.

## Staged artifact scope and integrity

Dedicated root: **`E:/BhuAayam-model-evaluation/20260930/ai06f-weight1-01/`**. Original runtime, model, source and audit directories received no ACL changes. No security harness file was edited.

The accepted NET-01 runtime clone was checked against `stage-verification.json` (`e1fc372a3c9599d88eea635d964a6b271b338bb6193c7107a16203bcd56f1e6b`) and `final-stage.json` (`fdafafa0f9f5613fb87742cd757b347897000c63d673f413707b5454f011ccdf`), including its documented CPython launcher/DLL substitutions. All tree pins passed: 4,216 base-Python files, 19,509 retained dependency files, 484 extension-environment files and eight model files. Separate copies, **not hardlinks**, preserve those bytes; only the task-owned `pyvenv.cfg` and `retained-qwen.pth` paths were relocated and recorded. The final 24,217-file manifest pins the actual copied model/runtime, including all package files. No package installation or download occurred.

The unchanged accepted corpus/proof and retained originals replayed on the host with the standard-library corpus loader. Only **69 train/calibration fields**, their labels/wire metadata, exact 207 prompts and the already saved baseline development results were staged. No held-out or diagnostic inference occurred, and those families are absent from the staged model context. The 13 code/support files match both the working tree and copied code hashes. The staged model remains Qwen revision `e61197ed45024b0ed8a2d74b80b4d909f1255473`, weight SHA `27cd75a405b9c1b46b59abfd88aaa209e6fed2a1972cde9b70e7659537c5e65b`.

Intended runtime limits remain two Torch CPU threads, 6 GiB CUDA allocated/reserved, 1.5 GiB sampled free GPU memory, 6 GiB sampled owned-tree RSS and 600 seconds for fitting/scoring. The accepted launcher additionally caps Job committed memory at 6 GiB with kill-on-close; the adapter records Job committed memory separately from RSS. **No child resource measurements are available**, because launch was not reached. Native descendants would depend on the accepted Windows AppContainer/Job inheritance limits; no new network-silence or application-enforcement claim follows from staging.

## Commands, observed exits and receipt pins

From the owned worktree:

```powershell
$learnerPython='E:/BhuAayam-model-evaluation/20260929/.venv-v8-lora/Scripts/python.exe'
& $learnerPython -B scripts/usp/learning/run_weight1_isolated.py stage
& $learnerPython -B scripts/usp/learning/run_weight1_isolated.py run
```

`stage` exited **0** after source/runtime/code checks and freezing. `run` exited **1** after the scoped integrity-label operation returned **5**; no model module was imported by the host staging/launcher path. Four changed Python files passed AST parsing, and staged/working diff checks passed. Post-failure standard-library checks matched all 13 code pins, the two completed-run artifact pins, unchanged pair/prompt/token records and the sole weight-setting delta. Six focused numerical tests are staged but **unrun** because the isolation prerequisite failed. No additional test campaign, model rerun or service was started.

| Task-owned artifact | SHA-256 |
| --- | --- |
| `completion.json` — exact failure/cleanup | `206685c08e54a790d6c84dfff2261a6f517a104159bb586e97f98dca75c54248` |
| `execution/freeze.json` | `a5b94791952de6052280b0763b0937c2fdc7b97e43b30f074c33d61182d5ff59` |
| `runtime-manifest.json` | `01dbb909ff103070234b80bb20ef2d73987f2e17bc3dd396294e2f340e75cd5b` |
| `stage.json` | `0e991bda87faad773b71f584fbdb0f37eb5052335ff5828c79038043cbae6cdd` |
| `launch-attempt.json` | `bda73dca97c34f44dffadb540359f85ab01b4d08e637434c240f2fbe25326a12` |
| `inputs/context.json` | `5561de313bc3922e74328e781ecaaa6dccd5bb94ebaa8d5d633039542310d5be` |

All staged copies and failure history remain retained for review. No process, grant or profile remains owned by the attempt. Shared services, credentials, source bytes and previous results are preserved. Return this concrete output-scope blocker to the lead; the original model remains `development_fail`, and no weight-1, NET, association, operational or release pass is claimed.
