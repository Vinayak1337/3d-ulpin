# STUDENT-09-BASELINE v2 — execution passes; development quality fails

3 October 2026. One renewed pretrained selector baseline completed inside the existing containment boundary. **Both responses failed strict JSON; accepted coverage remains 0/6.** No repair, retry, fitting, held-out evaluation or promotion followed.

Executed exact clean `409bae3baafcebb9ad152a702cef07e3c286815a` in `C:/Users/kvina/.codex/worktrees/56f9/3d-ulpin`. Assignment SHA-256 `c4e2a9f077109dba637f27b11897336ef42590079a91da10f47716b630e19d63`; coordinator checkpoint `264b1a77bbd4a6d906c3f7d0946a5319902f0ea2`. All twelve code pins, physical protected sources and accepted input/runtime/model pins matched. No executable changed. V1 blocked evidence remains unchanged with null metrics.

## Actual result

| Check | Result |
| --- | --- |
| Strict JSON / selector schema / valid selector spans / valid expanded output | 0/2 each |
| Accepted claim emissions / unique accepted signatures / correct expected claims | 0 / 0 / 0 of 6 |
| Source-native precision / coverage | Undefined (no accepted claims) / 0% |
| Valid no-canonical-target abstentions | 0/2; rejected fallback projections receive no credit |
| Input / generated token counts | IFC4: 536 / 115; IFC2X3: 493 / 288 |
| Per-example generation | 6.013 s / 13.429 s |
| Input or output limit reached | Neither; no truncation |

Both raw outputs start with Markdown fences and fail at `raw_json`, character zero. Raw text also uses free-form literal strings rather than selector triples, omits citations, and the second response repeats `unit` keys. Raw strings and the validator's errors are preserved. No fences were removed or outputs repaired. Strict emitted-claim counts are null because neither response parses; eight lexical role-key occurrences (2/6) are separately recorded and confer no claim credit.

After guard/output/cleanup acceptance, a single in-memory host comparator pinned the retained expectations and compared only valid accepted expanded claims by the unchanged `(role,state,literal,unit)` signature per example. The original six expectations stayed outside inference. This failed the predeclared tiny development criteria and shows no gain over the original 0/2-valid, 0/6-accepted baseline. Two related IFC examples do not establish conflict accuracy, canonical matching or generalization.

## Execution and resources

Qwen/Qwen2.5-0.5B-Instruct revision `7ae557604adf67be50417f59c2c2f167def9a775`, unchanged pretrained weights, prompt `association-selector-prompt/1`, seed/settings and greedy generation. Source-only lexical offsets and both prompt lengths were saved before model loading; Python 3.11.15 / Unicode 14.0.0. Runtime: torch 2.8.0+cu128, transformers 4.57.6, CUDA 12.8, RTX 3070.

| Measured resource | Result | Bound |
| --- | ---: | ---: |
| Job peak committed | 4.838 GiB | 6 GiB |
| Sampled peak process RSS | 2.989 GiB | 6 GiB |
| CUDA peak allocated / reserved | 1.013 / 1.064 GiB | 6 GiB each |
| Minimum sampled free CUDA | 5.815 GiB | At least 1.5 GiB |

Stage exit 0 in 194.156 s; 19,402 pinned files / 8,601,228,765 bytes copied. Model host invocation exit 0 in 394.500 s (includes profile/boundary startup); guard scope 230.485 s; runner 21.521 s, including 2.073 s load/preflight. Zero-capability AppContainer token and 6-GiB Job were validated before resume; owned Job closed and ACL/profile/owner-scope cleanup passed. Child output was not truncated. Library deprecation/inactive sampling-flag warnings are preserved in the guard output; generation stayed greedy. No owned process cleanup remains.

## Evidence

[Machine-readable receipt](selector-baseline-v2.json), SHA-256 `0936eadc73365ac5813ece30f14ce224161651432452017543ea3b6bd741c90d`, records exact commands/exits, code/model/input/prompt/schema/profile/freeze pins, 30 artifact pins and host metrics.

- Private stage: `E:/BhuAayam-data/task-data/ml-distillation/student/selector-baseline-d5cce4ac0de0494ca17fee3a3e5b1b69`.
- Host logs and comparison: `E:/BhuAayam-data/task-data/ml-distillation/student/selector-baseline-v2-host-20261003-409bae3b`.
- Profile SHA-256 `083145a4da0e41143e7adee67ca0e9b779ac9fa352cff0139c23791db08075a7`; freeze SHA-256 `e9bcb496b0775c7e9ad2df910c24d467bc6a174474e9f7c79f59c792ccff22bb`.
- Host summary SHA-256 `30d0f2422c34a58e8213874d86fcbb65ab8d174c494c111531d2126c8e22e7af`. Six output artifacts match the guard acceptance receipt; raw outputs, lexical preflight and completion are retained.

Requested Astra/xhigh/default-standard; supplied permissions `never` / `danger-full-access`. Actual model/effort/tier unexposed; no setting change claimed. Only this new evidence pair is committed. Return to coordinator and stop for inspection.
