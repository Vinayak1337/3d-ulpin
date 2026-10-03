# STUDENT-19 fragment adapter fit

One fresh stage and one contained fit completed at execution HEAD `d47d33999a8ac644a1147180b4e38f434825931c`. Stage, fit command and existing `accepted_fit()` proof all exited **0**. The supervisor accepted outputs and cleanup. Coordinator review remains pending; no reload or quality evaluation ran.

## Native run

The unchanged six Haryana/Bihar train rows completed six seed-17 epochs: **36 updates**, **3,084 supervised tokens**, with original q/v LoRA rank 8, alpha 16, dropout 0.05 and AdamW learning rate 0.0002. Epoch orders match the frozen plan; all recorded losses and gradient norms are finite, with gradient scale 128 throughout. Supervision remains `provisional_synthetic_supervision` / `needs_independent_review`, `sarvamDerived=false`.

All full sequences fit the 4,096-token ceiling, with no truncation or row exclusions:

| Example | Prompt tokens | Assistant JSON + EOS | Combined |
| --- | ---: | ---: | ---: |
| teacher-fragments-v1-01 | 2565 | 84 | 2649 |
| teacher-fragments-v1-02 | 3343 | 84 | 3427 |
| teacher-fragments-v1-03 | 2178 | 92 | 2270 |
| teacher-fragments-v1-04 | 1853 | 86 | 1939 |
| teacher-fragments-v1-05 | 1458 | 84 | 1542 |
| teacher-fragments-v1-06 | 1841 | 84 | 1925 |

The first-update receipt preserves exact target IDs, positions, 84 supervised tokens and EOS 151645. **Receipt limitation:** the existing runner does not serialize target-ID/label arrays for the other five rows. Its executed encoder verifies every complete prompt/target boundary and EOS; every update verifies the assistant-only mask. Full per-row counts/hashes and all 36 supervised-token counts are retained. No second native tokenizer run was performed.

Existing head-loss, attention and live-graph/reclamation controls passed. The base's 290-tensor digest remained `7c651c8be4013651138142820f0e895a170054851eb3edd6ed3fcd64027b0c44`. All **96 saved tensors** exactly match the trainable adapter; **540,672 parameters** are recorded. The saved-fit validator passed after guard/output completion without native imports.

Epoch mean training loss decreased from 0.13540216 to 0.00739172. This is an in-sample training observation, not a learning-gain or selection-quality result.

## Resource and cleanup result

| Observation | Bytes | Frozen bound |
| --- | ---: | ---: |
| Peak Job committed memory | 6,019,911,680 | 6,442,450,944 maximum |
| Peak process RSS | 4,226,834,432 | 6,442,450,944 maximum |
| Peak CUDA allocated | 1,485,943,296 | 6,442,450,944 maximum |
| Peak CUDA reserved | 1,604,321,280 | 6,442,450,944 maximum |
| Minimum sampled CUDA free | 5,749,342,208 | 1,610,612,736 minimum |

GPU: RTX 3070; two CPU threads, batch one. Stage wall time was 224.563s; fit command wall time 501.797s; guard elapsed 318.750s; fit loop 97.487s. Child/setup/cleanup durations are not separately exposed. The existing 600-second child guard accepted exit 0.

The guard verified its capability-free AppContainer token and Job before resume, closed the Job, revoked scoped ACLs, restored owner/integrity settings and deleted the AppContainer profile (`0x00000000`). Cleanup passed without errors. No owned native process or tool session remains. All originals, staged files and results are retained.

## Reproduction and pins

Exact stage/run/proof command arrays, working directories, timestamps and exits are in [JSON evidence](fragment-adapter-fit-v1.json). The stage command came unchanged from the pinned protocol; the fit command came unchanged from the new `stage.json`. The existing `accepted_fit(new_stage_root)` was invoked once by the private `accept_saved_fit.py` helper. No executable repository changes or retry occurred.

| Artifact | SHA-256 |
| --- | --- |
| Assignment | `a2d9139dadb222a34f270bcd9a5ae152c09731340a6ebe3b194b1e42c4cb7541` |
| Actual generated freeze | `48ef397f475601b5b5a7f184cc23e9973738bc8b2c0c1dd087f6a4a0b461464d` |
| Actual runtime profile | `62ae8fa1ab76cf458b08685f0d134f30c92fae1adcaed08b7c4c7253e0d63709` |
| Guard | `074c3aa2790ca4cdb81e7bc3f34e113da1eaae476d0f570e2841b238a110bd64` |
| Output acceptance | `c5d9eb5ab27979774df3d087ed58d6d7cce6110c3172e75369200e7586fdf814` |
| Fit result | `7227d04269978f9de1b8f9a4b85e1d7814d68618a597a9ad7dea5ec95acf3a82` |
| Adapter manifest | `de3388ad8cffe76a2d6a4462373e53d23950f6e1e27d2ac04dcdc7fc1569abfe` |
| Adapter safetensors | `f56683a79a493bd21cd909616f22be83720a3b4721a1ccc3c55e0f93ddf7630b` |
| Saved-fit proof | `573dff67b4b9a385c047cb3a8bd439ae97e87c280ffb3ec27db71840b234bde9` |

The new profile contains 19,679 exact entries; 19,678 copied files total 8,604,909,767 bytes plus the generated freeze. Runtime and model/source donor authorities stayed separate. The 31 physical/canonical/Git source pins, model/input pins and all 21 output files are referenced in the JSON. No disabled preparation profile was used as the actual profile.

Stage root: `E:/BhuAayam-data/task-data/ml-distillation/student/adapter-fragment-fit-df9b4b53a7e84b0ba3246baeb1221851`. Return receipts: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-fit-return-fbae28f9c8e94e0694cd080de1a5f376`. Permissions were supplied as `never` / `danger-full-access`; requested Astra/xhigh/default-standard, with actual model/effort/tier unexposed. Native package versions and two nonfatal reporting/deprecation warnings are retained in the receipts.

No inference/reload, host expectations, development training, held-out evaluation, acquisitions/installations, provider calls, shared checkout edits, push or deployment occurred. A separate **STUDENT-20** freeze must bind the reviewed saved-fit proof before reload.
