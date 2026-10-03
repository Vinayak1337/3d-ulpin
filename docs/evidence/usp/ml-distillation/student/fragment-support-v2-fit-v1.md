# STUDENT-22 — fragment support v2 fit

Execution HEAD `32e661a13e04db23b1cab3f0211b12b372474d38`. One fresh stage and one contained original-base fit; no executable repository changes. Status: `contained_fit_saved_proof_passed_awaiting_coordinator_review`.

## Result

Completed **60 updates**, **5,106 supervised tokens**, with finite recorded losses/gradient norms and scale [128.0]. All ten full sequences fit the 4096-token ceiling; maximum 3427. No truncation or row exclusions. All 96 saved tensors match the 540,672-parameter trainable adapter; the original 290-tensor base digest remained `7c651c8be4013651138142820f0e895a170054851eb3edd6ed3fcd64027b0c44`. The unchanged saved-fit proof accepted the result after guard/output completion.

| Example | Prompt tokens | Assistant JSON + EOS | Combined |
| --- | ---: | ---: | ---: |
| teacher-fragments-v1-01 | 2565 | 84 | 2649 |
| teacher-fragments-v1-02 | 3343 | 84 | 3427 |
| teacher-fragments-v1-03 | 2178 | 92 | 2270 |
| teacher-fragments-v1-04 | 1853 | 86 | 1939 |
| teacher-fragments-v1-05 | 1458 | 84 | 1542 |
| teacher-fragments-v1-06 | 1841 | 84 | 1925 |
| teacher-fragments-v2-pair01-a | 1452 | 84 | 1536 |
| teacher-fragments-v2-pair01-b | 1455 | 85 | 1540 |
| teacher-fragments-v2-pair02-a | 2565 | 84 | 2649 |
| teacher-fragments-v2-pair02-b | 2570 | 84 | 2654 |

Native encoding checked every complete prompt/target prefix and EOS; the fit checked assistant-only masking on every update. Literal token-ID/position arrays remain serialized only for the first update. No missing arrays were reconstructed. Supervision remains `provisional_synthetic_supervision` / `needs_independent_review`, `sarvamDerived=false`; these support pairs add no absent/null/withheld state coverage. In-sample loss and completion establish no model quality or generalization.

## Resources and cleanup

Peak Job commitment **6,004,740,096 B** and peak process RSS **4,219,731,968 B** are separate observations. CUDA allocated/reserved peaks were **1,485,943,296/1,604,321,280 B**; minimum sampled free **5,749,342,208 B**. The existing 6 GiB maxima and 1.5 GiB free minimum passed. Guard elapsed 279.500s; native fit loop 129.322s; stage/run command wall 221.053/461.309s. Separate child/setup/cleanup durations are not exposed.

The existing containment guard owns Job/AppContainer/ACL cleanup; its exact outcome is in the companion JSON and original receipts. No native inference/reload or subsequent fit ran. All originals, prior failures and new outputs remain intact.

## Reproduction and next step

Exact stage/run/proof argv, cwd, starts/ends/exits and immutable artifact pins are in the [JSON report](fragment-support-v2-fit-v1.json). The stage command came from the pinned protocol; the run command came unchanged from the actual new `stage.json`. The actual profile has 19,685 entries; freeze SHA `6411c2a8d824617056a8bd5214ac0061a6e6d01522eb19edefb4d95e44ec1fbd`, profile SHA `6a40f31c155eda85224f8e82b1b3e91833667632bde38bd8754ede396d93d9e7`. Source pins cover all 33 physical/canonical/Git/staged files; all 13 inputs, nine original model files and accepted outputs are bound in private receipts.

Stage: `E:\BhuAayam-data\task-data\ml-distillation\student\adapter-fragment-support-v2-fit-23d6787a96704a1b8770b5ef88dc82b5`. Return directory: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-support-v2-fit-return-da5db5ea7abc459ebbd893498ee1ebf9`. Supplied permissions: `never` / `danger-full-access`; requested Astra/xhigh/default-standard, actual model/effort/tier unexposed. No development/expectations/held-out access, installs, acquisition, provider calls, shared checkout change, push or deployment.

Coordinator review/acceptance must precede a separately frozen STUDENT-23 reload. This fit supplies no independent-truth, operational, canonical-association or release qualification.
