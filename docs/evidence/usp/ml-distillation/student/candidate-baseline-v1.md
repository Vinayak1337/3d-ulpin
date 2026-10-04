# STUDENT-14 candidate baseline

One original-base Qwen2.5-0.5B-Instruct run, no adapter, at
`9a8f65ac5af330a901b876bae2f4c514787567c9`. One fresh stage and one contained
inference phase completed with exit 0, authoritative output acceptance and cleanup.

## Result

The frozen tiny development criteria passed: **2/2 complete valid responses,
6/6 correct accepted source signatures, precision 1.0 and coverage 1.0**.
The host-only comparison ran after accepted output hashes and guard cleanup were verified.

| Example | Selected IDs | Candidate coverage | Correct signatures | Generation |
| --- | --- | --- | --- | --- |
| IFC4 | c0, c1, c2, c3 | 4/4 | 4/4 | 2.940 s |
| IFC2x3 | c0, c1 | 2/2 | 2/2 | 2.237 s |

Absent and explicit null each match **1/1**. Both projections retain empty canonical
links and the no-target marker. Inputs were 422/315 tokens; outputs 98/92 tokens.
Both grammars completed with EOS and exact final-byte equivalence, without repair,
truncation or token-cap closing. The native tokenizer/byte transport check passed.

## Contributions and scope

The model selected the IDs; empty and subset selections remained possible.
The controller forced structural validity and current candidate identity. The parser
and projector supplied exact facts, citations, states and canonical no-target markers.
These facts and selected-ID coverage do **not** establish learned relevance or
association accuracy. There are only two related IFC examples in one development
family, with no independent irrelevant-candidate discrimination test.

The earlier constrained-selector policy remains **0/2 usable, 0/6 correct**, without
rerun. Input representation and grammar changed here; this is not an adapter-gain or
unchanged-policy comparison. IFC2x3 georeference, canonical association, operational
data, generalization and production launch remain unqualified.

## Resources and timing

| Measurement | Observed | Limit |
| --- | ---: | ---: |
| Cumulative Job committed peak | 5,206,822,912 bytes | 6,442,450,944 |
| Sampled process RSS/peak working sets | 3,257,536,512 bytes | 6,442,450,944 |
| CUDA allocated peak | 1,070,955,008 bytes | 6,442,450,944 |
| CUDA reserved peak | 1,107,296,256 bytes | 6,442,450,944 |
| Minimum sampled CUDA free | 6,279,921,664 bytes | at least 1,610,612,736 |

Stage host wall: 183.481 s. Guarded-command host wall:
286.889 s, including complete profile verification.
Guard setup/child/cleanup: 126.718 s. Model section:
6.854 s, including 1.672 s load/preflight.
Child-only duration is not separately measured; the whole guard interval is below
the 600 s child bound. These timings do not establish a controlled cross-policy speedup.

Job closed; AppContainer profile, temporary ACL grants and integrity changes were
cleaned up successfully. No owned process or service remains. The candidate worker
completion correctly retains its pre-guard status; the supervisor completion and
accepted receipt are authoritative. Accepted outputs were never rewritten.

## Evidence

Stage: `E:/BhuAayam-data/task-data/ml-distillation/student/candidate-baseline-2036a3daacbb4680a855e21b40ae1057`.
Host report: `E:/BhuAayam-data/task-data/ml-distillation/student/candidate-baseline-v1-host-aec7e18c7fa344a88173c0062b8f97b5/comparison.json`.
The adjacent JSON receipt pins commands, executed sources, profile, model, inputs,
policy, contexts, raw outputs, result, session, guard, cleanup and host comparison.
Original runtime warnings about torch_dtype and unused generation flags are retained;
no settings changed. No inference retry, fit, teacher feedback, held-out access,
promotion, shared API registration, push or deployment occurred.
