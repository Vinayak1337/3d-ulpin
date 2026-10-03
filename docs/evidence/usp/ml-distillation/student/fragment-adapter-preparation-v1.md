# STUDENT-18 fragment adapter preparation

CPU preparation is complete at code commit `47e47f0b5e1b1301f8c8d9ebb1a0cdb0bdaa033f`. Native fit and reload remain unqualified. Assignment v2 is pinned to `d0444d2d273486dc76ceb5b1214bec0f4a00577eb53cd8df7cf714c65886f5f6`; task base is `a1f424f7d0496f920388c51c0fc891b3c9a2762e`.

## Implementation

- Exact dataset/row pins admit six unchanged Haryana/Bihar train rows through the shared fragment codec and existing encoder/fit loop. Source-derived technical wrappers preserve original rows; prompt tokens remain masked and the unchanged assistant JSON plus EOS is supervised.
- The guard-required `--teacher-v1` aliases the same six-row file as `--training-data`. Fit excludes development requests and host expectations.
- Strict fit/reload admission and a leaf stager reuse existing profile/copy, saved-fit proof and resource machinery. Fragment reload is explicit/default-off and reuses the inference runner, grammar and adapter comparison.
- `stage_adapter.py` changes only inside `accepted_fit()`. The retained AST check confirms all other functions are unchanged. Common order/token/loss/base/tensor/resource/guard/cleanup proof remains authoritative; historical baseline protected hashes remain strict.

## Checks and planned recipe

Seven sources compiled without imports or bytecode output, exit **0**. All **six CPU controls passed**, exit **0** (`Ran 6 tests in 0.122s`). Code staged whitespace check exited **0**; the code checkout was clean after commit.

Exact CPU invocation from `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`:

```powershell
& 'C:/Users/kvina/AppData/Roaming/uv/python/cpython-3.11-windows-x86_64-none/python.exe' -B -I -S 'C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin/scripts/usp/learning/association/test_fragment_adapter.py'
```

Controls cover unchanged rows/prompt/target/masking, PREP/mixed/source-drift refusal, fit input separation, explicit loader dispatch, saved-fit binding and common proof admission. The fake tokenizer checks masking only. Compilation used `compile(raw_bytes, absolute_path, "exec")`; its receipt records the method/exit, without a separate full shell invocation.

Metadata recording exited **0**, using the same interpreter and `-B -I -S` with `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-adapter-preparation-b9cf90caa3e94fc690bd024dab634016/record_preparation.py`. Exact invocation, logs and physical pins are in the JSON evidence. No native package imports occurred.

Planned recipe: **6 rows x 6 seed-17 epochs = 36 updates**, with 35 candidate appearances and ten selections. Preserve q/v LoRA rank 8, alpha 16, dropout 0.05, AdamW learning rate 0.0002, batch 1 and the 4096 combined-token limit. Existing float32 adapter/loss, frozen float16 base, 64-token head chunks, 128-query attention and reclamation controls remain. Bounds remain 6 GiB Job/CUDA, at least 1.5 GiB CUDA free, two CPU threads and 600 seconds per child phase.

Supervision stays `provisional_synthetic_supervision` / `needs_independent_review`, with `sarvamDerived=false`. No learning gain or independent truth is established.

## Pinned authorities and disabled plans

| Artifact | SHA-256 |
| --- | --- |
| Six-row training bytes | `32c7fc4071754431f87756d0ebd121539a5357187ef0efb139083f5b86e4d742` |
| Source pins (31 sources; 25 protected) | `d88e245081cac0ae9814010cb9b2d88ab9863a1fef942a5c07a5e9e9de052639` |
| Preparation summary | `dac368ed3b769017dad94ba175cf068febb037bff5ed9c4a03c90353098d5c3c` |
| Runtime-only donor profile | `a09ee7907b8dc207b01712d84ec33245218773f479cf91301957ee76b32ae503` |
| Model/source donor profile | `86b0f0b19d4e740f2e6e38f7eea8eaccd24b7b3072883f8b7d22421c39b8ef75` |
| Fit template | `683bb1fee135e9078a7b10208208c66ed2268f05289e5f19a88cc881e7b05ae1` |
| Reload template | `2b29c4c404daeb0ff135095515619b80d0464f50d6e28534fa58900bc4af8550` |
| Fit profile plan | `38846b490ef978105fcefb1d3d2e445d5d68975b08fd0805a14bbdd1103cbd7b` |
| Reload profile plan | `206551aa93fde80e9c83037f5ee81e531b4cba1d0e81550b74fcc7f7773ac237` |

Runtime metadata supplies retained PEFT 0.17.1 and Accelerate 1.10.1 (19,630 entries); future copying is restricted to `runtime/*` and the pinned resolved-requirements companion. The accepted fragment donor supplies nine model metadata entries and source authority: `Qwen/Qwen2.5-0.5B-Instruct`, revision `7ae557604adf67be50417f59c2c2f167def9a775`, weights `fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe`. Donor code, old data/freezes/outputs and saved adapters are excluded.

Both templates have `executable=false`, zero fresh phases and disabled execution allowances. Fit plans **19,679** profile entries; reload plans **19,688**. These are metadata plans. Final execution HEAD/source pins and actual phase/profile hashes remain unresolved. Reload also needs accepted saved-fit/adapter/proof hashes. Placeholder stage commands are in the JSON; no native run command is authorized.

## Limits, settings and handoff

No stage, native tokenizer/model load, fit, reload, inference, evaluation or promotion ran. Native sequence lengths, resource fit and learning gain are unmeasured. No host expectations, held-out or retired corpora were reopened. Runtime/weight contents were not read or copied. Originals remain intact; no owned native/model process or pending tool session remains.

Supplied permissions verify `never` / `danger-full-access`. Assignment requested Astra/xhigh/default-standard; actual model, effort and per-turn service tier are unexposed and are not claimed from a prompt or global setting.

Private receipts: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-adapter-preparation-b9cf90caa3e94fc690bd024dab634016`. [JSON evidence](fragment-adapter-preparation-v1.json), SHA-256 `350bd3be2be494432bff264d01335a5b4b616405db6de012a50ad683be106088`, records exact commands/exits, all 19 private artifact pins, seven compile-source hashes, input metadata and phase dependencies. The code commit owns seven files; this return owns only the two assigned evidence documents. Shared checkouts were read-only; no push/deployment occurred.

Next: coordinator review, then a separate **STUDENT-19-FRAGMENT-FIT** positive freeze. A subsequent **STUDENT-20-FRAGMENT-RELOAD** freeze must bind an accepted saved fit. This preparation does not authorize either native phase.
