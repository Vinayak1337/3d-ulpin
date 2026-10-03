# STUDENT-27 — original-base fragment rank baseline

**Technically accepted; development retrieval criterion failed.** One fresh stage and one guarded run used clean execution HEAD `8ae5484d21764777466651e95b184ed10d5c267f`. No executable code changed.

## Outcome

| Request | Candidates | Expected | Selected | Exact |
| --- | ---: | --- | --- | --- |
| IfcBuilding Name | 4 | c1 | none | No |
| Supplied non-null numerical building elevation | 3 | none | none | Yes |

Both complete vectors are valid (2/2), but only 1/2 request sets match. All seven margins are negative. There are zero selections, zero true positives, zero false positives and one missed positive. Precision is null (zero selected denominator); positive recall is 0/1. The unsupported elevation request correctly remains empty. Empty output is context-limited and does not establish property absence; the name request is a model miss.

## Technical acceptance

- Actual seven prompt-bound single-token 0/1 proofs passed. Token counts: four at 1,318 and three at 951; no truncation.
- Original Qwen2.5-0.5B-Instruct, Transformers 4.57.6, float16/SDPA, one last-position forward per focus; both logits cast to float32 before margin.
- Native isolated synthetic NLL, ten-parent weighting and analytic equal/opposite gradients passed on CPU float64 (1e-10) and CUDA float32 (1e-6). No model updates or training-label reads.
- Stage map: 19,674 entries (19,630 runtime, nine model, 23 code, 12 inputs). Map/freeze match the packet. Copied 8,604,709,773 bytes.
- Guard exit 0; authoritative output hashes accepted; Job closed, AppContainer profile deleted and ACLs restored. Host expectations were read once only after acceptance, followed by one host-only comparison.

## Measured resources

- Peak Job commitment: 4.868 GiB; peak process RSS: 2.994 GiB (separate measures, both below 6 GiB).
- CUDA allocated/reserved peaks: 1.199/1.250 GiB; minimum sampled free: 5.632 GiB (floor 1.5 GiB).
- Stage: 192.472 s; host run wall time: 288.560 s; guard interval: 122.813 s; model section: 2.286 s. Separate child/cleanup timing is unexposed. No speedup claim.

This is the first original-base reference for this scoring objective. Historical generative results are separate. Two development requests in one family do not qualify generalization, extraction accuracy, canonical linkage, evaluation, promotion or release. Any fit/reload needs a separately justified frozen assignment.

Exact commands, timestamps, exits, raw scores and all profile/proof/guard/accepted/cleanup/host hashes are in the adjacent JSON. Receipts: `E:\BhuAayam-data\task-data\ml-distillation\student\fragment-rank-baseline-v1-return-8d894c8e979341bf8dd66f2f07743984`. Native stage retained unchanged for evidence; no active owned process remains. Requested Astra/xhigh/default-standard; actual model/effort/tier unexposed. Supplied permissions: `never` / `danger-full-access`.
