# AI-06D — fixed V8 Qwen LoRA result

30 September 2026. **The single fit completed; the development criterion failed.** No second fit, checkpoint selection, evaluation, diagnostic-family inference or promotion occurred. NET-01 remains pending with the lead.

## Ownership and implementation

- Base: `62fd4ff53fa4111021245abd2ec06c9773b34455` (also the observed staging head before implementation).
- Branch/worktree: `task/desktop-qwen-lora-v8`, `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`.
- Executable commit: `59f81d9`; nine executable/support/test file hashes and byte snapshots are in the private freeze. All nine still matched after execution.
- Primary staging was read-only. Corpus, labels, splits, production/API/frontend paths and previous environments/runs were preserved.
- Requested Astra/high/default; actual model/effort/tier not independently exposed. Supplied permissions: `approval_policy=never`, `sandbox_mode=danger-full-access`.
- New entry point: `scripts/usp/learning/train_reranker_lora.py`; numerical objective/gradient checks: `services/geo/geo/usp_learning/lora.py`. Existing publisher loader, prompt builder, type constraints, threshold selector, metrics and owned-process supervisor are reused unchanged.

## Frozen semantics

Retained Qwen3-Reranker-0.6B revision `e61197ed45024b0ed8a2d74b80b4d909f1255473`; native final-token `logit_yes - logit_no`, float32 BCEWithLogits with positive weight 8. Three targets for every training field, including all-negative fields. The accepted V8 manifest yields 44 fields / 132 pairs / 14 positive pairs / ten families. Calibration is 25 fields / seven positives; only these 69 development fields enter tokenization/inference. All 207 prompts fit without truncation (maximum 238 tokens; limit 512).

Rank 8, q_proj/v_proj in all 28 blocks, alpha 32, dropout zero, 1,146,880 trainable parameters in 112 tensors. Base/output weights remain frozen. Seed 17, three epochs, microbatch one, accumulation eight, AdamW 5e-5, weight decay 0.01, betas 0.9/0.999, epsilon 1e-8, clipping 1.0. No scheduler. FP16 base/autocast, FP32 adapters/loss/gradients, GradScaler initial scale 128 and growth interval 2,000. SDPA, no cache, non-reentrant gradient checkpointing/input gradients during training; deterministic algorithms enabled and TF32 disabled. Final adapter only.

### Equal-family accumulation, including the partial window

For `F=10` families, `n_f` fields in family f, `T=3` pairs per field, the full objective is `sum(loss_pair / (F*n_f*T))`. There are `K=ceil(132/8)=17` optimizer windows per epoch. Each pair backpropagates `loss_pair * K/(F*n_f*T)`. The average of these 17 window objectives at fixed parameters equals exactly the mean-pairs → mean-fields → mean-families objective.

The last four-pair window keeps the same multiplier; it is **not** divided by four or multiplied by two. This preserves each family's total weight across the epoch. Parameters change between windows, as in minibatch optimization. A seed-17 Python shuffle visits every pair exactly once per epoch; all three exact orders are frozen. Total: 51 updates / 396 pair visits.

Preflight used only the first positive training pair, backward without an optimizer step. All 112 adapter gradients were present and finite: 56 nonzero B gradients and 56 initially zero A gradients, expected from zero-initialized B. No frozen parameter received gradients; the adapter was unchanged. Gradients were discarded and seed/scaler reset before fitting. Missing, entirely zero or nonfinite gradients stop the attempt; GradScaler cannot silently skip and retry an overflow.

## Actual result

All 51 updates completed; all 112 adapter tensors changed. Online equal-family losses by epoch: 3.314465, 0.827600, 0.981319. These are training trajectory measurements, not quality acceptance evidence.

Train/calibration margins and yes probabilities were saved before the unchanged global threshold selector ran once. It returned **null**: no cutoff permits zero incorrect calibration accepts while covering every target. The resulting deployed-policy-style decisions abstain on all 14 training and seven calibration positives; this is a failed useful operating point, not a zero-error success.

Saved-matrix inspection explains the failure without another inference or threshold search:

- All seven calibration positives have the correct top allowed target, but the negative Census county polygon scores `0.999322772026062` as building geometry.
- Both correct calibration keys score lower (`0.9990527033805847`, `0.9969956874847412`); both correct names score lower (`0.9857181310653687`, `0.9780517220497131`). Rejecting that county polygon with a global cutoff therefore loses all key/name coverage.
- NOLA `globalid` and NYC `doitt_id` training scores rose to `0.9989596605300903` and `0.9960237741470337`, but neither is **accepted** because no useful calibration cutoff exists. The required recovery criterion fails.
- IGN `cleabs` scores `0.05184547230601311` for the key target. Cambridge/Oregon name-positive scores remain low (`0.1561049073934555`, `0.4339814782142639`). Higher scores on two existing keys do not establish generalization or native-schema coverage.

The existing 65 base-Qwen profiles, matrices and calibrated decisions are reused with source/path/profile/prompt/hash alignment checks. No new baseline inference was performed; the four new V8 fields have no baseline scores. Final inference scored each of the 69 development fields once. After saving, the trained model was released and a fresh base plus saved adapter loaded; the first training field's three candidate margins/probabilities matched bit for bit. No full rescoring occurred.

## Resources and cleanup

| Measurement | Observed |
| --- | ---: |
| Supervised execution | 99.907 seconds |
| Fit | 82.141 seconds |
| GPU peak allocated | 1,319,489,536 bytes |
| GPU peak reserved | 1,350,565,888 bytes |
| Minimum sampled CUDA-reported free GPU memory | 6,005,194,752 bytes |
| Peak owned process-tree working set/RSS | 5,711,343,616 bytes |
| Torch CPU threads | 2 |
| Supervisor/child exit | 0 / 0 |

GPU: RTX 3070. Limits were 6 GiB allocated/reserved, 1.5 GiB sampled free GPU, 6 GiB owned-tree RSS and 600 seconds. No limit exceeded. GPU free memory is the CUDA API measurement, not a claim of continuously observed device-wide headroom. Checks occur after model load and every forward/backward/update. The existing supervisor uses Windows peak working sets plus 50 ms samples; RSS excludes the supervisor and may briefly overshoot before termination.

Owned PIDs 23148, 44428 and 42300 were absent at post-run inspection. No unrelated process, Docker service or data volume was stopped or changed. Adapter/originals/failure history and prior branches remain retained.

## Environment, acquisition and NET-01

Interpreter: `E:/BhuAayam-model-evaluation/20260929/.venv-v8-lora/Scripts/python.exe`, Python 3.11.15. Separate venv contains PEFT 0.17.1 and Accelerate 1.10.1; `retained-qwen.pth` exposes the unchanged retained inference packages (including Torch 2.8.0+cu128, Transformers 4.57.6, NumPy 1.26.4, safetensors 0.8.0, huggingface-hub 0.36.2 and psutil 7.1.3). It is a separate writable extension environment with a shared retained dependency directory, not a duplicated hermetic installation. The freeze records all 27 package versions, installation roots, installed RECORD hashes, interpreter/environment-file hashes and wheel hashes.

Deliberate acquisition before execution: public PyPI metadata and the PEFT/Accelerate wheels, SHA-256 verified against PyPI metadata; dependency requirements inspected and checked against installed versions. Wheel receipts are under `E:/BhuAayam-model-evaluation/20260929/v8-lora-dependencies/`. A first `python -m pip download` exited 1 because the retained venv has no pip; it changed no packages. Used existing uv to create the new venv and install only the two inspected local wheels with `--no-deps`; dry run, installation and import compatibility check exited 0. No foundation model, SWIFT, provider or new corpus download occurred.

The worker preserves `local_files_only=True`, `trust_remote_code=False`, safetensors, `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1` and `HF_HUB_DISABLE_TELEMETRY=1`. The custom loop configures no Trainer callback/reporting SDK; evidence writes are local JSON/safetensors and the existing supervisor. The Codex completion callback is separate from model execution. **These flags and code observations do not prove network silence.** No enforced outbound-denied boundary or network-observation audit ran in this assignment. Dependency inspection and a small saved-adapter development replay under that boundary remain NET-01 work for the lead; no private-document or production qualification follows here.

## Verification and commands

Focused numerical checks prevent incorrect final-window weighting, lost all-negative supervision, FP16 subtraction overflow and silent invalid gradients; these mathematical tensors are not operational/source records.

- `python -m unittest discover -s services/geo/tests -p test_learning_lora.py -v`: **5 passed**, exit 0 (0.036 seconds).
- AST syntax parsing of the three new Python files: exit 0.
- `git diff --cached --check`: exit 0 before executable commit.
- `prepare`: exit 0; hashes/replays the accepted V8 originals/proof and existing baseline, validates model/dependencies, verifies lengths, snapshots code/config before any gradient.
- `run`: one invocation, supervisor exit 0; real gradient preflight, fit, save/reload and development scoring as above.
- Post-run read-only inspection: all **29 receipt artifact hashes** and **nine current code hashes** matched; owned PIDs absent. No model inference or fit in that inspection.

Exact PowerShell execution shape from the owned worktree (interpreter abbreviated only below):

```powershell
$env:PYTHONPATH='C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin/services/geo'
$env:PYTHONDONTWRITEBYTECODE='1'
$env:PYTHONUTF8='1'
$learnerPython='E:/BhuAayam-model-evaluation/20260929/.venv-v8-lora/Scripts/python.exe'
# Executed once with prepare, then once with run. Do not rerun the fit.
& $learnerPython scripts/usp/learning/train_reranker_lora.py run `
  --corpus 'E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/completion-v8/revision-02/learning-corpus-v8-immutable.json' `
  --input-proof 'E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/completion-v8/revision-02/input-proof-v8.json' `
  --originals-dir 'E:/BhuAayam-data/task-data/ai-06a-learning' `
  --retained-dir 'E:/BhuAayam-model-evaluation/20260929' `
  --baseline-dir 'E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v7-reranker-01' `
  --output-dir 'E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v8-lora-01'
```

## Immutable evidence

Private run root: `E:/BhuAayam-data/task-data/ai-06a-learning/desktop-ai06a/v8-lora-01/`. The completion receipt covers the complete freeze, code snapshots, inputs, epoch reports, final adapter/config, saved matrices, threshold selection, baseline reuse, reload check, result and supervisor receipt.

| Artifact | SHA-256 |
| --- | --- |
| `completion.json` | `e26460b4bcb7709e80d23b21f7dadc591ea903a98232c08a3e02f3b48095bc3e` |
| `freeze.json` | `1075a64cc50da8c84cd09818d6aba9822aa2afe7a34846b1a45d898763799005` |
| `run/adapter/adapter_model.safetensors` | `a1af6c945c37475d7f7db05f89a91f72120bec18df1ec08d73941dcbae74152c` |
| `run/adapter/adapter_config.json` | `75ef0046d112012dc4f6ce516ebad31609d5fd737b4af8d6dec10e429646f0db` |
| `run/scores.json` | `db8af9d3e922a212cc2015c2b812091c86fa8a0dd600a9f05236aa50e8943e74` |
| `run/result.json` | `dfb3f0a7f586e6949eb3d6a571e487103f316076d988530c41f51e987a140564` |
| `run/reload.json` | `7fcd1872ecf0fd8e3c112c9eabb59debebc61d4962080946260edca407f9ab42` |
| Accepted V8 corpus | `ff9c80d3e1c31dec126d7f534a88c45b37ed0d589b35792ad67d4b2ed850efee` |
| Accepted V8 input proof | `d2ff07556ded56d8eaf7b0744f6cf2a8dd8c15f076f8df81f3136254a425fa9a` |
| Base model weights | `27cd75a405b9c1b46b59abfd88aaa209e6fed2a1972cde9b70e7659537c5e65b` |
| Base `config.json` | `d479c427a9ca5295218063d4f9aca4f297ab4ac27487cca7af42c84643d51ef0` |
| Base `tokenizer.json` | `aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4` |
| Base `tokenizer_config.json` | `253153d0738ceb4c668d2eff957714dd2bea0b56de772a9fdccd96cbf517e6a0` |

All other retained model files, dependencies and executable hashes are listed in `freeze.json`. Foreign development schema evidence does not qualify Indian operational data, arbitrary document understanding, building/floor association or a release gate. Halifax/Kitchener evaluation and DC/SF diagnostics remain closed even after this completed fit.
