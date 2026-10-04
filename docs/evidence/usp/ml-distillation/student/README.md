# STUDENT-01 — cited association baseline

Latest checkpoint: [STUDENT-07's two training-family generations](training-generation-v1.md) pass JSON/schema checks but only **1/2** passes full validation, yielding **1/7 accepted provisional claims**. Bihar's unknown approval-date output exactly matches its target; Haryana misbinds citations and assigns incorrect roles/states despite unchanged printed literals. This is in-sample reconstruction only; development remains 0/2 valid and 0/6 accepted. One inference phase, exact adapter reload, bounds and cleanup pass. No fitting, evaluation or promotion follows.

Previous checkpoint: [STUDENT-06's checkpointed query attention](query-sdpa-attempt-v1.md) passed the frozen attention controls and completed all 66 updates within bounds (Job peak 5.10 GiB). The base remained unchanged; all 96 saved adapter tensors reloaded exactly. The original development comparison still yields **0/2 valid outputs and 0/6 accepted claims**: malformed JSON and invalid missing-value semantics. Quality criteria fail; no promotion or evaluation follows. Both runs exited and cleanup passed.

Previous checkpoint: [STUDENT-05's pre-backward reclamation](live-graph-reclamation-attempt-v1.md) preserved the tested live graph/state/RNG and released 769,654,784 bytes of reserve before the longest example's backward. That backward still failed after six updates, with Job peak above 6 GiB. The fit was rejected; no adapter, reload or new quality result exists. Cleanup passed.

Previous checkpoint: [STUDENT-04's unused-cache reclamation](reclamation-attempt-v1.md) passed the state/RNG/next-step control, released unused reserve and completed six updates within bounds. The longest seventh example failed during backward with a CUDA allocation error and recorded Job committed-memory peak above 6 GiB. The fit was rejected; no adapter, reload or new quality result exists. Containment cleanup passed.

Previous checkpoint: [STUDENT-03's loss-memory repair](memory-repair-attempt-v1.md) passed contained loss/gradient equivalence and the original first backward/update. The run was rejected after optimizer step 3 for a recorded Job committed-memory peak above 6 GiB. No adapter, reload or new quality result was accepted.

Subsequent checkpoint: [STUDENT-02's single frozen adapter attempt](adapter-attempt-v1.md) passed teacher/token preflight but failed native allocation during its first backward, with recorded Job committed memory above the 6 GiB cap. Zero updates completed; no adapter/reload or new quality result exists. The baseline record below remains its original historical checkpoint.

2 October 2026. **Contained execution passed; pretrained output quality failed.** Code commit `5df8a978f631192082651270269d747c601bcb93` implements the runnable source-to-model-to-validation path. Both raw responses violate the frozen contract, so the accepted projection contains only explicit abstentions. No format repair or additional prompt/model attempt was used. [The receipt](baseline-v1.json) records exact commands, source/model/input pins, raw output, resource acceptance and limitations.

The assigned worktree is `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`, branch `task/ml-association-student-20261002`, created clean at coordinator `c351625f5ae258ee8653be2413082b16d3c09835`. The prior `task/desktop-model-egress-enforcement@5c536ff8` and retired weight-1 branch remain preserved. Supplied permissions are `never` / `danger-full-access`; requested Astra/max follows the explicit human override. Default/standard is required; actual request tier is unexposed. Primary staging and coordinator/teacher files were read-only.

## Delivered flow

- `prepare_inputs.py` verifies two retained IFC reader results and their original bytes, then projects small exact native attribute fragments, byte spans and source building/storey relations. It reuses extraction. Independent expected claims are frozen before model output and kept outside the inference stage/prompt.
- `validation.py` checks the coordinator's schema, frozen family/source membership, exact citations/literals/identifiers/units, native attribute roles/states and marked conflicts. Invalid raw output becomes `invalid_student_output` plus `no_canonical_targets`; it is never repaired or counted as valid model output. Methods and original locators remain on each fragment.
- `association_student.py` and `student.py` provide the local CLI/adapter. The only containment extension is one fixed nested role, its explicit input arguments/private staging root and completion receipt. Existing launcher, source pins, token/Job checks, explicit environment, handles and cleanup remain in use.
- Acquisition/staging/summary scripts make the bounded run reproducible. Raw responses are saved individually and together, separately from accepted projections. No gateway/API registration or canonical write is included.

The source examples are buildingSMART's unchanged Simple-Scene/Building-Architecture IFC4 and IFC2x3, one development family under the coordinator freeze. Source hashes are `8790a1e193e82b8e7e7f337ec2633cd40f2120590317a1443503a25b079e2e80` and `c4db65ba847f6b369a95d6c54fa11f4750cbe6d59f021934e8923d8d578e5885`. Attribution: buildingSMART International Ltd., Certification-datasets revision `80d976a9b193a26a8e928c3e79bff67af1de68a8`, CC-BY-4.0. These remain `test_only`, in their original unknown/unqualified geography. No original or parser output was changed.

## Actual baseline

Checkpoint: `Qwen/Qwen2.5-0.5B-Instruct@7ae557604adf67be50417f59c2c2f167def9a775`, Apache-2.0. The public acquisition downloaded only the fixed JSON/tokenizer/text files and safetensors, verifying Git/LFS upstream identities and recording SHA-256. Weight SHA-256: `fdf756fa7fcbe7404d5c60e26bff1a0c8b8aa1f72ced49e7dd0210fe288fb7fe`. Its instruction generation architecture fits this output task; the retired yes/no reranker was not reused. Model/private input execution used local-only loading, `trust_remote_code=False` and the accepted zero-capability AppContainer.

One prompt/settings freeze, seed 17, float16, greedy generation, batch 1, 2 CPU threads, input cap 2,048 and output cap 768 tokens. Actual input lengths were 464/442; output lengths 180/199, with neither cap reached. All rich locators/hashes remain in input artifacts; the prompt contains only exact fragment keys/text, with no expected claims.

| Observation | Actual result |
| --- | --- |
| Valid raw model outputs | **0 / 2** |
| Expected source-native claims accepted | **0 / 6**, coverage 0% |
| Accepted precision / citation accuracy | Undefined: no accepted claims and neither raw response parses as the contract |
| Complete example | Copies project/building/floor text into an incorrect `source`/`facts` envelope, inside Markdown fences; citations empty |
| Incomplete example | Markdown fences, wrong roles/states, and explicit null not preserved; citations empty |
| Validator fallback | 2 / 2 explicit invalid-output/canonical-target abstention projections; no links or invented accepted facts |
| Generation time | 4.698 / 4.676 seconds |
| Model load / model section | 1.191 / 10.576 seconds, excluding dependency import and boundary/profile work |
| Complete host command | 304.686 seconds; guard setup, child and cleanup portion 132.312 seconds |
| GPU peak allocated / reserved | 1,076,171,264 / 1,111,490,560 bytes, both below 6 GiB |
| Minimum sampled GPU free | 6,275,727,360 bytes across 383 observations, above 1.5 GiB |
| Job peak committed / sampled peak RSS | 5,176,061,952 / 3,207,282,688 bytes, separately measured below 6 GiB |
| OS boundary and cleanup | Matching AppContainer SID, zero capabilities, token and 6 GiB Job checked before resume, two handles, Job closed, ACL/profile/owner-label cleanup passed |

Representative raw complete-case excerpt: `"facts": [{"role":"building","state":"declared","literal":"Single-family house","unit":null,"citations":[]}]`. This is rejected output, not a validated building assertion. Both full raw responses are retained. Conflict accuracy is unmeasured because this compact development slice has no natural conflict; canonical matching and generalization remain unqualified.

The immutable run is `E:/BhuAayam-data/task-data/ml-distillation/student/baseline-af47550c33ea4dc2a3dc1aebc56363c4/`. Its `stage.json`/`host-command-result.json` contain the exact argument vector and exit **0**. Profile SHA-256 is `e06f20f9c285af4d3052c441e76a039ad04eba5c6b11fa618ea0a2a2ddbc5438`, covering 19,399 files. The reused locked runtime contains Torch `2.8.0+cu128`, Transformers `4.57.6`, CUDA `12.8`; no dependencies were installed or changed. CUDA is the RTX 3070. The generation library warned that inherited sampling-only flags are ignored under the explicitly frozen greedy setting; no setting was changed or rerun.

Key result hashes: raw `af7c76269ae7ddcf3304f2143e296d8ebf2b38ed01fc5b1f4c551f10db70cf3b`, projection/result `753949a220d65e923b4391f30e72bdbcd46f82a7dc328cad0dfd3e2271b1e1d6`, guard `ee92955091fe70f1b9eaf505ac70ef88f033b37d8b960db08b3c6e7c6330a6fb`, independent expected claims `061b98c57bdb386c8fc4bce38660b18fd16340d739d40f75b60b10f95a6f93ce`. All 23 compact receipt/artifact pins and executed physical code pins are in `baseline-v1.json`.

## Verification and next increment

Six new focused regressions pass (0.024 s), covering exact real-source literals/null/absence, fabricated citations/IDs/units, family/evaluation refusal, marked conflict omission, direct host refusal and fixed nested role/input paths. The six existing containment controls also pass (0.184 s); the full sandbox campaign was not repeated. Ten owned Python sources compile; `git diff --check` passes. Commands use the stated CPython 3.11 interpreter with `-B -I -S`; complete test logs and physical/Git pins are under private `checks-v1/`. New code uses LF bytes; unchanged checked-out dependencies/harness may use CRLF, recorded separately from canonical Git bytes.

The accepted teacher batch `71e218b2a13ad26938f0b4ab5f4111125af8530dfbd0a01c0c3b9680f3bfefec` passes the new schema/citation/literal/family checks for **11 / 11** train-only examples. It was not included in the baseline stage or prompt. It remains provisional supervision; five rejected OCR interpretations remain excluded. No fit, save/reload or tuned comparison has run. The concrete next increment is coordinator-owned: measure compact teacher sequence lengths, freeze one bounded adaptation, then save/reload and compare against this unchanged development baseline. Model format/citation/state errors are now observed targets; no quality improvement is promised by training completion alone.

All owned processes exited; the actual guard confirms grants/profile cleanup and Job closure. Copied runtime/model, fresh technical test fixtures and useful receipts are retained. No service, Docker, source catalogue, frontend, shared dependency, credential, global resource, main/remote or deployment change occurred. Evaluation content, prior mapping data and historical fit settings remained unopened/unchanged. This increment qualifies execution and honest rejection only; source-native quality, canonical association, operational rights, evaluation/generalization and gateway registration remain open. Return to the ML coordinator for the next concrete assignment, then stop.
