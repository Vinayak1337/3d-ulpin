# MODEL-EGRESS-02 — mandatory Qwen containment adapter

1 October 2026. Assignment/base `142905fa76a6a32b0fab3ce49ff635d43de1b097`. Owned worktree: `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/desktop-model-egress-enforcement`. The prior failed experiment branch remains at `f41ae65b6895abe0d4445fd11b3ac7d331d39df6`; none of its code/settings was cherry-picked. Primary staging stayed read-only, later observed at `4f6ca13858823c9453ca14854aa81ed81a2700f1`. Supplied permissions: `never` / `danger-full-access`; requested Sol6.1/xhigh/default-standard. Actual model/effort/request tier are unexposed.

## Delivered behavior

Both ordinary Qwen scripts require `--containment-profile` and `--containment-sha256`. Host `prepare` and `run` dispatch through `resources.guarded_run` to the new `model_isolation.py` adapter. Direct worker, prepare and context calls inspect the actual Windows token before model/dependency imports or private-input reads; parent/session environment markers cannot establish containment. Missing profile, drift and unsupported platforms fail closed.

The adapter reuses the reviewed AppContainer primitives: suspended zero-capability launch, exact SID validation, two inherited handles, NUL stdin, explicit environment and checked grant/profile cleanup. It adds effective Job membership/limit readback **before resume**, terminal cap readback, checked Job close and 50 ms sampling of actual Job members' RSS/peak working sets. RSS remains distinct from Job committed memory. A zero exit with missing/invalid/over-limit Job peak, invalid RSS, truncation or failed cleanup cannot accept outputs. The earlier weight-1 peak anomaly's cause remains unresolved.

The OS token and Job boundary is established before interpreter startup. The pinned bootstrap uses `-B -I -S`, checks the actual token/Job again, verifies the runtime/code/input/model manifest, then adds only declared pinned package paths and executes the selected role. `.pth`/site startup is disabled. Script-level refusal alone does not contain an independently started host interpreter.

Only the explicit Windows/runtime/temporary-directory and offline/telemetry settings enter the child environment. Host credentials, proxy variables and unrelated markers are excluded. Tokenizer/base loads resolve to the profile's pinned local model directory and retain `local_files_only`, `trust_remote_code=False` and safetensors requirements. Adapter reload additionally requires local safetensors/config and rejects pickle weight suffixes. Acquisition remains separate.

Model outputs stay in the provisional `outputs` directory. The host writes `<role>-<action>-accepted.json` in its protected `receipts` directory only after terminal launch/resource/cleanup acceptance; it pins the guard receipt and output artifacts. Comparison `run.json` and LoRA completion assembly occur on the host after those checks. A failed launch retains evidence and outputs without an acceptance receipt. Exclusive action-attempt files prevent silent retries.

Both Qwen `SETTINGS` ASTs are identical to the assignment base, including historical positive weight 8. Source-family splits, data, prompts and scientific selection logic were not edited. Frozen code now includes the containment helper/harness. Saved original receipts, corpora and outputs remain unchanged. E5's explicit default `guarded_run` behavior remains its prior unrestricted subprocess/RSS path; it is separately unqualified for OS egress containment. No E5 model execution was performed, and old code hashes are not rewritten to match these shared-source changes.

## Explicit profile contract

Profiles are local immutable `profile.json` files under a newly owned scope in `E:/BhuAayam-data/task-data/desktop-model-egress-enforcement/`. Required fields:

- `schemaVersion: usp-qwen-containment-v1`, exact absolute `root`, and relative `python` beneath `runtime`.
- `files`: complete SHA-256 map for every file in `runtime`, `code`, `inputs` and `model`. Staged bootstrap/harness hashes must also match the host implementation.
- `packageRoots`: explicit relative package directories beneath `runtime`; bootstrap enables them after checking containment.
- Positive integer `jobMemoryBytes` ≤ 6 GiB and `timeoutSeconds` ≤ 600, also bounded by the caller's resource settings.
- Existing owned `outputs`, `scratch`, `state` and `receipts` directories. Only output/scratch receive Low integrity and Modify; code/runtime/model/inputs are read-only. Profile/session files are read-only; guard/acceptance receipts are ungranted to the child.

Host checks reject redirected/reparse ancestors, escaping paths, unowned scopes and unexpected explicit owner grants. It assigns exactly non-inheriting same-owner WO on output/scratch for Low-label setup, then removes it and restores Medium with readback. It never grants the original model/runtime or a shared parent. A later authorized model run needs its own fully staged profile and qualification; this task stages no weights or corpus and enables no private-data/application use.

## Actual verification

Final private scope: `E:/BhuAayam-data/task-data/desktop-model-egress-enforcement/control-ec174bfdfc584ab68de7fabc524bafdb`.

The actual adapter was exercised through `resources.guarded_run` using a copied CPython 3.11 standard-library runtime and a technical control payload. Source runtime: `C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none`; retained PSF attribution/licence remains at its `LICENSE.txt`. No package install, model/dependency import, weights, corpus, inference, GPU, provider or external request occurred.

| Control | Observed result |
| --- | --- |
| Actual launch | Exit 0; matching AppContainer SID; zero capabilities; token and effective Job validated before resume; two inherited handles; checked Job close |
| Effective Job cap / deadline | 134,217,728 bytes / 10 seconds; effective flags `0x2200` |
| Terminal resources | Peak Job memory 30,380,032 bytes; sampled RSS/peak working sets 38,576,128 bytes; entire adapter including setup/cleanup 9.672 s |
| Environment and write scopes | Unrelated technical sentinel excluded; writes to code/inputs/model/runtime/state/receipts denied; output write succeeded |
| Missing/over-limit final Job peak | Injected responses retain exit 0 but are rejected; both acceptance receipts absent; cleanup passed |
| Effective cap mismatch | Actual suspended child, actual cap readback altered by one byte; rejected with **zero resume calls**; cleanup passed |
| Direct host roles / spoofed markers | Five focused tests pass, including six prepare/worker/context refusals before any guarded dependency import |
| Static/source integrity | Seven files compile; seven executed source pins and four guard/acceptance artifact pins match; both settings ASTs unchanged |

Final helper/control commands in the explicit owned worktree:

```powershell
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -B -I -S -c "import sys,runpy;sys.path.insert(0,'scripts/usp/learning');runpy.run_path('scripts/usp/learning/test_model_isolation.py',run_name='__main__')" --control
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -B -I -S -c "import sys,runpy;sys.path.insert(0,'scripts/usp/learning');runpy.run_path('scripts/usp/learning/test_model_isolation.py',run_name='__main__')" -v
```

Both final commands exited **0**; five tests completed in 0.075 s. Standard-library compile/hash/AST reconciliation and `git diff --check` exited 0. An initial static use of `ast.literal_eval` could not evaluate existing arithmetic constants; AST-structure comparison subsequently passed without importing/evaluating model code.

Preserved development controls: `control-1a8baec59f914cf59fe48a6b2afd448f` failed because the child tried to inspect an ungranted shared ancestor; checks now remain within the child stage while host ancestor checks remain mandatory. `control-0628252752134e00b566d692df5b40e7` passed the corrected basic adapter. `control-cb9b4ae48273452eb8f84921fa682789` reached the new cap-mismatch rejection but exposed immediate `TerminateProcess` access denied after kill-on-close; cleanup now waits for actual termination before attempting direct termination and verifies the child has exited. The final control passes that exact path. All earlier files remain retained; no failed control is reported as the final-code pass.

All final temporary ACL grants/profile deletions and owner-label cleanup passed, including the effective-cap rejection control. Post-run process query found no Python command for this task/control runner. No shared ACL/firewall/service/config/credential changes require cleanup. Historical weight-1 completion still hashes to `e2eb5b39d27d815b76f848bcc0bda9ebc56bae6a9603f0ce46176e9d50872759`.

| Final artifact | SHA-256 |
| --- | --- |
| `controls.json` | `5a61d538b416df807b6484c7d588a6ababce1e9ac421c9725fd91106a00d568c` |
| `profile.json` | `e8a45bc1bdaf98e110872f2fa6e7b6a248707a1a2d1109bdfa1dbb256ed5d55b` |
| `verification.json` | `7a03d8f1758f24927b67f1906df286b7cd9d855dc634896013a460368c211584` |
| `unit-tests.txt` | `b01afa5f0b1d55121a2a77d9ec802cd795c4164487347324c12c3747d31701cd` |
| Copied `runtime/python.exe` | `0d52d7bf23cdd6df350fcecf015ce42a9094aaee8a57e511df150e0346779fa6` |

## Limits and handoff

This qualifies the adapter's no-model Windows controls and refusal/acceptance path. Actual Qwen prepare/fit/reload/comparison execution with the new bootstrap remains unrun. Existing NET-01 descendant/handle/network observations are reused; native/brokered network attempts and historical training silence receive no new qualification. Arbitrary native descendants still depend on Windows AppContainer/Job inheritance. No scientific quality, operational/private-data, Linux, release or deployment gate advances. Return the owned code and these immutable receipts for independent review, then stop; lead owns integration and any later model execution.
