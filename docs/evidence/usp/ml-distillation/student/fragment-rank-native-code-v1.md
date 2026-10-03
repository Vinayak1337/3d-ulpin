# STUDENT-26 — fragment rank native wiring

Code: `0bc9836a7b64be84b43a009378cd36c16893996d`. Status: **code and CPU controls complete; coordinator review pending**.

The new default-off rank assignment uses the existing stager, original Qwen loader and containment guard. It admits the unchanged two development contexts (four and three candidates), builds the freeze before stage effects, proves each prompt-bound single-token 0/1 continuation, requests only last-position logits, casts both label logits to float32, and preserves seven raw scores before complete-vector projection. Native technical proof code checks two-logit NLL, analytic gradients and equal-parent weighting on isolated synthetic logits. Worker outputs remain subordinate to guard completion.

## Verification

- Four focused CPU controls: exit 0; no native import attempts.
- Real source/input admission and `make_freeze` reached the intercepted first `mkdir`; no stage was created. Nine actual source-only metadata files and both pinned donor profiles were used.
- Future assignment/clean Git state, tokenizer bytes/IDs, native modules/model forward and technical native loss proof were explicitly mocked. Synthetic scores establish wiring only.
- Seven owned sources compiled in memory once; `git diff --check` passed. All 32 protected existing sources match their accepted physical and canonical hashes.
- Complete execution source map: 23 files. Policy `ab32fe7cb76e34aca57dbc799b9664c8a05f26aae1eaa13dffdc1e19ae0cb5e2` and prompt `39ced4c36b37c0d67d3f68c95e10acdd8791c7e745d2139717aa050392cea6b5` are unchanged.

## Limits and handoff

No actual native imports, tokenizer/model bytes, GPU, staging/profile, fit, inference, host comparison, teacher or evaluation was run. Training labels/publication remain untouched. This does not establish relevance, accuracy or release readiness. The disabled prototype is metadata, has no run command and grants no execution. A separately frozen STUDENT-27 final-head packet is required after coordinator review.

Receipts: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-rank-native-code-return-e0b6a5398a994648b142cec85b3a59ef`. Exact commands, exits, source/input/donor/prototype hashes and settings are in the adjacent JSON report. Supplied permissions are `never` / `danger-full-access`; model, reasoning and per-turn tier are unexposed. No active owned process remains. Staging was read only; no push or deployment.
