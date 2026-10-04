# STUDENT-32 — contained checkpoint paths

Code `81c841b4f01e99ff858b8e14529eb0ad9450fbb2` repairs the observed pre-native PermissionError from base `37fac56393acce067d717d5f259d9bf760396727`. This is code and standard-library CPU verification only.

## Change

The worker now passes the root returned by `require_model_boundary(args)` explicitly through phase dispatch/admission, shared-fit authority, proof control, restore and checkpoint save/read. Child path validation checks canonical containment, the verified root and every in-scope component, then stops at that root. Host callers retain full-ancestor checks. In-scope permission errors, aliases, escapes and reparse points still fail; bounded reads and exclusive durable writes remain.

Later-phase original predecessor/acceptance locations are structural metadata in the child. The host stager still checks the original guard, output map and independent acceptance. The child reads and validates only its exact pinned readonly copies. The 35-file runtime closure, original recipe/state schema and protected containment/loader behavior are unchanged.

## Verification

One `python.exe -B -I -S .../test_fragment_rank_checkpoint.py ContainedPathControls` invocation passed **3 targeted tests**, exit 0, on the first invocation. **4 edited sources** compiled in memory; diff checks passed. All **43 protected sources**, **14 train authorities** and retained failure receipts match their pins.

Controls cover actual worker-to-shared-fit admission stopping before native imports, checkpoint publish/read and session restore/save with forbidden outside parents, exact phase2 copied-state/proof admission, and escape/alias/reparse/in-scope-denial/forged-host-acceptance rejection. The revised path validator stays real. OS boundary/virtual readonly filesystem, tensor/device/RNG/optimizer/scaler and safetensors are disclosed doubles; separate save/read controls use real temporary files. Native proof execution is doubled only to check scoped proof-file propagation. No actual AppContainer or native equivalence result is claimed.

## Handoff

[Structured evidence](fragment-rank-contained-path-code-v1.json) records exact commands, hashes, doubles and limitations. Private root: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-rank-contained-path-code-v1-f3fccf0966dc4be8b7e0e36915227a49`. Receipt-index SHA256: `09598a57848c7e8a2abd56eb78cb161951c82736a1348287ee10d61680ddb6ef`. Three future phase prototypes remain disabled.

The consumed phase1 guard and both earlier failures are immutable. No native retry, stage/profile, model/tokenizer byte access, GPU, development/expectations/evaluation or provider/host/service change occurred. Native serialization/RNG/continuity/fit/save/reload/resources and learning quality remain unrun. A future attempt needs separate review and a fresh final-head assignment/profile. Requested Astra/xhigh/default-standard; observed model/effort/tier unexposed. Supplied permissions: never/danger-full-access.
