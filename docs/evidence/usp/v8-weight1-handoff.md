# AI-06F — single weight-1 fit completed; reload/resource failure

## Latest continuation: `-03`, 30 September 2026

**The single authorized weight-1 fit completed all 51 updates under the restricted launcher and saved the adapter and all 69 × 3 development margins/probabilities. The run then failed during the required independent reload, before threshold selection or decision matrices. It is not a completed or accepted model result.** No second fit, model reload, fallback, held-out/diagnostic inference or promotion followed. Earlier setup failures below remain preserved historical evidence.

Primary staging was read-only at `00941e0d9e0a9234953839d2da6dec74a1bb9c4a`. Owned worktree remains `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/desktop-qwen-lora-weight1`. Wrapper correction: **`1926e03d6a5d87b5272bee56cf69a956f68dc5c2`**, on the existing `7a5b0d1` / `9f68399` / `a8f84c9` preparation history. Supplied permissions are `never` / `danger-full-access`. Assignment requests Astra/high/default-standard; actual model/effort/tier are not independently exposed. No new worker or service was launched.

### Helper recovery before staging

The task-local wrapper now pins the verified absolute Core 7.6.5 executable and security manifest hashes, uses separate immutable command receipts plus the command ledger, checks metadata before profile creation, restores the host environment before cleanup inspection, and reports zero cleanup operations honestly. The accepted security harness is unchanged.

The actual path/owner/WO/Low/readback/Medium/removal helpers passed on two tiny new directories before copying a runtime. They verified resolved empty scopes, no reparse ancestors, current ownership, exactly one non-inheriting owner WO ACE, inherited Low label, then zero explicit owner grants and Medium label on cleanup. No helper fixes/retries were needed after the shell correction. Retained helper root: `E:/BhuAayam-model-evaluation/20260930/ai06f-helper-a6dac137ebf94486b10109717e9ad125`.

- `helper-result.json`: `89cb39fd755e6a1c57d714041d9d83db7cfd25393c5074c5595538ddd30bdb2b`.
- `receipts/acl-commands.jsonl`: `05c189a1ff71d95bea89d5c7505a146b4f8b26bf3a5bbb7eab34c4f515a2fe18`.
- Core executable: `362a356ce7f0940ec74f73a8fc2c990a2cc24a38a11c90bbd8eca947110ad139`; security manifest: `60e8b93ee7a9111d38912c7d45ce83a56dccf772bd974b96bd3cc4c678744560`.

### Actual restricted execution and failure

Fresh root: `E:/BhuAayam-model-evaluation/20260930/ai06f-weight1-03`. Stage exited **0** after checking the four accepted runtime/model trees, separate copies, unchanged source proof, 13 code files and the relocated runtime manifest. Weight 8 → 1 is the sole learning-setting delta; training plan, token lengths, selected inputs and selection policy match the old freeze.

1. Restricted preflight exited **0**: actual expected AppContainer SID, zero capabilities and Job membership; output/scratch writes succeeded; writes to code/model/inputs/runtime/execution and an ungranted private-canary read were denied. The launcher validated the token before resume and inherited only two handles.
2. All **six** numerical tests passed under the restricted token (test runner 0.034 s), including default-weight compatibility and unchanged negative loss.
3. Frozen-byte and gradient preflights passed. There were 1,146,880 trainable parameters across 112 tensors; no optimizer update occurred in the gradient probe. Three epochs completed 17/34/51 updates in **78.047 s**. The final adapter and full training/calibration score matrices were saved.
4. Required reload failed in the second `load_base()` at `safetensors.safe_open`, with **Windows OSError 1455: “The paging file is too small for this operation to complete.”** The child and overall run exited **1**. `reload.json`, `selection.json` and `result.json` are absent. Exact reload equality, decision matrices, recovered-key counts and final acceptance are unqualified.

The failure's message does not isolate host commit exhaustion from the configured Job boundary. Do not infer a need to enlarge the system pagefile or relax the cap. No such change was made.

| Observed quantity | Value |
| --- | --- |
| Supervised fit child, including byte checks/loading/scoring | 161.078 s, within 600 s |
| External sampled peak RSS/working set | 4,030,197,760 bytes, below 6 GiB; monitor failure null |
| Reported peak Job memory | **7,066,611,712 bytes**, above configured 6,442,450,944 bytes |
| Last saved CUDA allocated/reserved peaks (epoch 3) | 1,319,489,536 / 1,350,565,888 bytes |
| Last saved minimum sampled free GPU memory | 6,005,194,752 bytes |

**The Job-memory discrepancy is unresolved and must not be reported as a passed 6 GiB committed-memory envelope.** The accepted harness sets Job memory and kill-on-close flags and reports `PeakJobMemoryUsed`, but the observed peak exceeds the configured bound. The harness was not changed or rerun. Final post-reload GPU resource summary is unavailable; epoch receipts and saved scores do not replace it. The concrete resource/reload failure ends this assigned model attempt.

### Saved-score comparison only

Standard-library inspection of the retained matrices performed no model execution or threshold selection. Values below are the relevant target probabilities, not accepted mappings.

| Development field/target | Weight 8 | Weight 1 |
| --- | ---: | ---: |
| USGS negative polygon → geometry | 0.997409046 | 0.977370739 |
| Census negative polygon → geometry | 0.999322772 | 0.996570349 |
| Cambridge SITE_NAME → name | 0.156104907 | 0.104477316 |
| Oregon NAME → name | 0.433981478 | 0.388617992 |
| IGN cleabs → source key | 0.051845472 | 0.027795624 |

The Census negative remains above all calibration keys/names (highest key 0.996321559; highest name 0.968856215). Thus lowering the positive weight did not repair that score ordering. This arithmetic observation does not supply the missing reload verification or a completed threshold/result receipt. Original weight-8 status remains `development_fail`.

### Cleanup, verification and receipt pins

All 16 AppContainer grant revocations exited **0**, SID freeing succeeded and profile deletion returned `0x00000000`. Both owner-WO cleanup/readback checks passed, with Medium labels restored and zero explicit owner grants. Profile was `CodexAI06F_4188563a20fc4c948e0fa268b280a24f`; SID was `S-1-15-2-3819759794-207903007-975184578-2297559337-2299269112-1515958363-3187844933`. A post-run process query found no Python command containing this stage or runner. Source/runtime originals and prior attempt artifacts are preserved.

Postcheck exited **0**: all 65 completion-listed artifact hashes and all 13 frozen/working code pins matched; Python AST parsing passed; the sole settings delta and exact plan/token/input/policy equality passed; old weight-8 freeze/result/scores and both prior attempts' completion-listed artifacts matched. No broad runtime campaign or new inference occurred. `completion.json` lists `child-fit` among observed/completed phases, but its child receipt has exit **1**: that list is not a success claim.

| Artifact relative to `-03` | SHA-256 |
| --- | --- |
| `completion.json` | `e2eb5b39d27d815b76f848bcc0bda9ebc56bae6a9603f0ce46176e9d50872759` |
| `execution/freeze.json` | `aebb1aee161e3842cfa40d4dc745632ebad81a273a27d9baa21d046299f1dae0` |
| `runtime-manifest.json` | `1069110044d7aabd26b5f69668a400bf8f9e7d299a0a5fac486d254bbce24628` |
| `stage.json` | `20fd170f0f6fa027fcacdba259afd85724c5314166b3e68871adf512de36b97d` |
| `receipts/child-preflight.json` | `951cfdb8a6a55459b77a467898b852fb5b39325ce334d38d0aec50e008b6da7d` |
| `receipts/child-tests.json` | `14358571a5561fb4c76186b881919fd6a95f022723ac0d7301c13f49d5334a98` |
| `receipts/child-fit.json` | `bada6b914b277a6fae8f8ac8be71d8dcf6f371b9b800dc9ab4086dbe3c215d05` |
| `execution/run/scores.json` | `83029bbd22ebba3f1930555c79f1ecce033f9049f763d4089c33b4f61cfe7bed` |
| `execution/run/adapter/adapter_model.safetensors` | `743dda48ed1acbd20df55338f6f4ae6ad0083f40bbc8da5585603161cfca36c8` |
| `receipts/owner-scope-cleanup.json` | `d446d5b68bcded4dce04a38c8532a7df1d41c72557da9bfbd1814853003fffcd` |
| `postcheck.json` | `f21b2093c364d45cf0de500527ae90d4040d59afb9af857722cfa8815bb0716f` |

Actual commands in the owned worktree:

```powershell
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -I -S scripts/usp/learning/run_weight1_isolated.py helper-check
& 'E:/BhuAayam-model-evaluation/20260929/.venv-v8-lora/Scripts/python.exe' -B scripts/usp/learning/run_weight1_isolated.py stage
& 'E:/BhuAayam-model-evaluation/20260929/.venv-v8-lora/Scripts/python.exe' -B scripts/usp/learning/run_weight1_isolated.py run
```

Exits: **0 / 0 / 1** respectively. Host logs are retained alongside the stage as `ai06f-weight1-03-stage.log` and `ai06f-weight1-03-run.log`. Return this exact incomplete outcome and resource discrepancy to lead; further model execution requires a new assignment. No release/operational/association/learning acceptance follows.

## Authorized setup recovery: `-02` stopped at wrapper metadata probe

The lead authorized one setup recovery after independently demonstrating the minimal non-inheriting same-owner WriteOwner remedy (probe receipt SHA `c72ceef98cca2245361f4d973feaf030294a1693082aab8cd4d0036ae51c97e8`). Commits **`9f68399703e0c1bbc9158bfba0afebfc9aaa427e`** and **`a8f84c9e2d489fe2c12cb380dd95bea0e3ba0abb`** change only the task-local wrapper: exact empty/resolved/non-reparse/current-owner checks, WO on the two output directories, complete command/readback evidence and owner-grant cleanup. Scope inspection precedes redirecting the child environment so host metadata probes cannot populate scratch before its empty check. Accepted security primitives and learning choices remain unchanged.

**The new setup attempt also stopped before a child or model launch. This time the failure is in the wrapper's metadata-probe dependency, not evidence that the WO remedy failed.** `powershell.exe -NoProfile -NonInteractive -Command ... Get-Acl ...` exited **1**, with `CouldNotAutoloadMatchingModule`: PowerShell found `Get-Acl` in `Microsoft.PowerShell.Security` but could not load that module. The complete command, empty stdout and stderr are retained in `receipts/acl-commands.jsonl`. The parent shell reports PowerShell Core 7.6.5 and its inherited `PSModulePath` lists the bundled Core modules before Windows PowerShell modules. This is consistent with an edition/module-path mismatch in the hardcoded `powershell.exe` subprocess; the underlying module-import failure was not reproduced again after the prescribed stop. A later correction must verify the metadata helper independently before another setup attempt, using a compatible pinned shell/module environment or native ownership inspection.

No owner WO, low label or AppContainer access grant was attempted. The metadata command is the sole recorded ACL/probe command. `owner-scope-cleanup.json` is `[]`: the generic completion text saying owner grants were removed/Medium restored must be read as **zero operations**, not a performed restoration. Profile `CodexAI06F_dc42fa676e5e42b594bf01b48bff7ded` was deleted with HRESULT `0x00000000`, and SID free reported no failure. Completed phases remain empty, output is empty and there is no model-attempt or fit marker. No numerical test, gradient, score, threshold selection or new quality result exists. The required restricted token/Job/output-scope check is still unqualified. No retry/fallback or shared ACL/service change followed.

New retained root: `E:/BhuAayam-model-evaluation/20260930/ai06f-weight1-02/`. Staging exited **0**, validating the accepted runtime/model copies, source proof and 13 code pins. Code was frozen at `a8f84c9`; standard-library checks confirm that positive weight 8 → 1 is still the sole learning-setting delta, with identical pair orders/prompts. The setup invocation exited **1**. All four failure-receipt artifact hashes replayed; wrapper AST and diff checks passed. The six numerical tests remain unrun. All `-01` artifacts and historical commits remain unchanged.

| `-02` artifact | SHA-256 |
| --- | --- |
| `completion.json` | `8d5de71023b7c55b7c9930698342f3640ae60ee09680f73be90fd704fddbce04` |
| `execution/freeze.json` | `a42a1c7534680a6662cd2ccf676879c86f2b9bb8becd4da32cfd235b1b52b6cc` |
| `runtime-manifest.json` | `c30507c2f2d735858a16f8fe26295d0e7641ade51a6dc3f70957bb9379b8e319` |
| `stage.json` | `457e9ca81d0adc6f89145f6489261086ef0f70f9c618b30e8d91695926ede97f` |
| `launch-attempt.json` | `c7727ff84af19eff895c90e9f89c5ebef4bbea2f0571c64116b37f0e2c7f61be` |
| `receipts/acl-commands.jsonl` | `37c990fdb109a9be1bba7cda5f80530e8f61268d3470b940c2057f7a669e71f9` |
| `receipts/owner-scope-cleanup.json` | `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570` |

## Preserved first setup attempt: `-01`

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
