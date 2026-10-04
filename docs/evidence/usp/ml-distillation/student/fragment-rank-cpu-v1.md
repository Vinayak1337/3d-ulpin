# STUDENT-25 — CPU fragment support ranking

Three new leaf sources implement a source-only support prompt, strict score-vector projection, binary-loss reference and pinned training compiler. Code: `ae2ade84b44296d453b5e437c52d93283c8c5f8d`; base: `e7da160fe2bd2ae3aa245bf15ab55c266071d0a3`. All 33 existing execution sources and prior tests remain unchanged.

The actual compiler journey published **57 related pairs from 10 unchanged parents**: **12 label 1, 45 label 0, three empty-selection parents, two frozen training families**. Every label is a deterministic projection of the admitted complete provisional selected set. It is not new source truth, official absence or 57 independent examples. Review state remains `needs_independent_review`, with Sarvam excluded and complete original supervision/provenance preserved.

Scoring inputs contain only version, full context identity, complete original context and focus ID. Target/teacher fields live in separate training/lineage artifacts. Every parent and candidate remains in original order; each pair has exact weight `1/(10*candidateCount)`. The source-identical request pairs retain opposite labels: pair01 candidate `c4` is 1/0, and pair02 candidate `c3` is 1/0. The compiler copies all eight unchanged authorities and writes its publication receipt last.

The fixed future labels are `0=no_direct_support_in_supplied_context` and `1=direct_support_for_request`. Scores use `logit1-logit0`; every candidate must have one finite score in original order, bound to the exact context and policy. Strictly positive margins select; ties abstain. Invalid vectors are rejected as a whole. The existing fragment projection returns unchanged fragments; no top-k, forced selection, semantic postfilter, fallback or threshold tuning is added.

One native-import-blocked CPU invocation passed **four focused controls**. The three new sources compiled in memory once, and the actual unchanged-train compiler journey exited **0**. Correct/incorrect margin-2 NLL references are approximately 0.126928/2.126928; extreme ±1000 logits give 0/2000 with the appropriate label. The controls also verified equal-parent weighting, source-only prompt independence, refusal before publication on changed supervision, and complete finite-vector projection. Synthetic scores are technical fixtures. No old suite, native tokenizer/model, GPU, development context, host expectation or evaluation was opened by this task.

| Artifact | SHA-256 |
| --- | --- |
| Training dataset | `6dc7c52195c9d19683654c6593dd83b08eefc39327803510fdcaca824df529cd` |
| Source-only scoring inputs | `753533a1c654274316aed6b2f06641d20ad47d73bfc2375ba1d73d6e05e12696` |
| Lineage | `7b2291969484aeccb913704e7d88e295f6d7fd26a6cf0de9aea9c87061fb7026` |
| Canonical policy | `ab32fe7cb76e34aca57dbc799b9664c8a05f26aae1eaa13dffdc1e19ae0cb5e2` |
| System prompt UTF-8 | `39ced4c36b37c0d67d3f68c95e10acdd8791c7e745d2139717aa050392cea6b5` |
| Publication receipt | `edffc5d0f047e065f0c1d32f50bc43592206ee9dca224000549f99622cd7cc82` |

Publication: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-rank-cpu-v1-02a328e15b844c0b8c14d137a1f041fa`. Command/log receipts: `E:/BhuAayam-data/task-data/ml-distillation/student/fragment-rank-cpu-return-93b5bdf4da7a4ef8afd12163f3e6da0e`. [JSON evidence](fragment-rank-cpu-v1.json) includes all input/artifact/source pins, exact commands/exits, controls and limitations. An early hash-inspection shell command failed because of a pipeline mistake; exact byte checks subsequently passed before implementation.

Native execution remains disabled. A later frozen assignment must prove real 0/1 token boundaries, both label logits and native loss, then establish a new original-base reference before fitting/reloading. Historical generative baseline/v1/v2 results remain preserved and are not a same-policy rank reference. No quality or release claim follows from these CPU controls.

Supplied permissions were `never` / `danger-full-access`; Astra/xhigh/default-standard was requested, with actual model/effort/tier unexposed. No owned process, service or pending tool session remains. Shared checkouts, providers and deployments were untouched. Return for coordinator review and stop.
