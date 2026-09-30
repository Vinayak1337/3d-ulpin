# NET-01R independent AppContainer correction review

30 September 2026. Reviewed candidate `320bda8a108ed771b3b3c41ba959af54393a1c2f` against `1acea15e00563e8d8792b22e14bec056258f54a3`, closing the findings in [review `86e991d`](appcontainer-audit-review.md). Review checkout: `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-appcontainer-correction-review`. Primary staging was read-only, observed at `5be1ad6aa61008e35ca0921dbba0bd2f627600d5`.

## Verdict

**Both P1 findings and the P2 cleanup finding are closed for the scoped audit harness.** No remaining blocking defect was identified in the correction diff. Recommend accepting the corrected audit mechanics with the saved local controls. The historical one-field clone observation retains its earlier narrow qualification; it was not rerun with this correction. This review does not qualify production enforcement, model quality or a release gate.

| Prior finding | Correction and evidence | Result |
| --- | --- | --- |
| P1: unrestricted inherited handles | `appcontainer_audit.py:223–255` installs a two-handle `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`: a newly opened read-only `NUL` input and the captured output pipe. Parent stdin is no longer inherited. The native descendant uses its own explicit list at `net01_probe.c:113–132`. The saved positive control reads the harmless marker when explicitly inherited; the corrected launcher returns `ERROR_INVALID_HANDLE` (6), with no marker read, both without a Job and with a 128 MiB Job. | Closed |
| P1: execution before token validation and permissive descendant parsing | Every direct child starts suspended and must pass the actual AppContainer flag, exact SID and integer zero-capability assertion before resume (`appcontainer_audit.py:162–183,275–296`). Rejection terminates/waits and closes process/thread handles (`:347–358`). The native descendant is also checked while suspended, and its creation/resume/exit must succeed (`net01_probe.c:130–154`). Replay invokes the structured descendant validator and fails on a scoring-child error (`appcontainer_audit.py:418–445`). The saved controls show six rejected observations with zero resumes and confirmed termination, a real successful descendant with three matching zero-capability snapshots, and five rejected altered descendant reports. | Closed |
| P2: cleanup errors reported as success or skipping later cleanup | `cleanup_scope` independently attempts every reverse-order revocation, `FreeSid` and profile deletion, then raises `CleanupError` on any failed outcome (`appcontainer_audit.py:192–217`). Revocations have a 30-second timeout. Grant paths are tracked before attempting the grant, and main cleanup remains in `finally`. Four saved injected cleanup failures attempt all four actions and fail the audit; actual cleanup succeeds and no owned SID grants remain. The separate body-failure control also records successful cleanup and propagated failure. | Closed |

## Evidence identity and checks

Reused private evidence directory: `E:/BhuAayam-model-evaluation/20260929/net01-correction-cc795c82e32c49189e8d82b9df5e2961/`.

| Artifact | Independently checked SHA-256 |
| --- | --- |
| `controls.json` | `2fc5a24f4b71b4931ff33d2030a629d51fd5c9b2f7087ad75ebd838b23213550` |
| `net01_probe.exe` | `b3157166ece119bfab21dc2c4373b35c20437a6fed3fa588f46ee1c1ac2381f4` |
| Candidate launcher Git blob / tested LF source | `4bf6475dd5bdb31d80d145d63de90eaef48aec9d054f6495c3d62db25d4249c9` |
| Candidate native-probe Git blob / tested LF source | `fdf580bcfac47b4d29b15393a58b57f6e7b2a13f6efbdc516b7ddeda603b532c` |
| Candidate local-control Git blob / tested LF source | `832e1e72b0e69d663f0607af7869382268b8ac93996f835c074fd0689adebe91` |

All three source pins in the receipt equal the candidate Git-blob hashes. The checkout copies have CRLF line endings; replacing CRLF with LF gives byte-for-byte equality with those blobs. Raw checkout hashes therefore differ and are not represented as the tested bytes.

Reviewer checks: inspected the four-file candidate diff, affected control flow, local-control script and saved `local_controls_pass` receipt; `C:/Python313/python.exe -B -` using `hashlib`, `git show` byte comparisons and `ast.parse` for both changed Python files (exit 0); `git diff --check 1acea15 320bda8` (exit 0). The initial attempt to read the prior report from the candidate worktree found it absent; the accepted report was then read from primary staging. No new runtime control was needed to resolve a concrete suspicion. The implementation owner's compiler/runtime commands and exits remain recorded in [the correction receipt](v8-lora-net-review.md#review-02-correction--bounded-local-controls); they were inspected, not rerun by this reviewer.

The six invalid-token cases deliberately alter observations after reading real valid tokens; they establish rejection before execution, not an OS mislaunch. Descendant negatives alter saved output. Cleanup injections report failure after performing the actual cleanup, establishing continuation and failure reporting without deliberately retaining access. They do not prove that an actual OS cleanup failure can always be repaired. The saved receipt reports successful profile deletion and zero remaining owned SID grants; the owner's final process query, rather than a new reviewer query, supplies the no-probe-process observation.

## Limits retained

- Earlier clone/source integrity, missing-config failure and exact one-field score evidence remain those accepted in `86e991d`. No inference, fitting, evaluation reopening, download or clone recreation was performed here. The final corrected launcher has local-control qualification, not a fresh model replay.
- Historical training silence, external UDP delivery denial and brokered DNS behavior remain unobserved. A zero-capability token and these controls do not establish absence of all native or brokered network attempts.
- The explicit native descendant is validated before resume. Arbitrary descendants created by a model runtime still depend on Windows AppContainer and Job inheritance; this harness does not independently intercept every descendant creation. Replay and its descendant preflight use a kill-on-close Job; Jobless launch cleanup covers the direct process.
- The Qwen quality result remains `development_fail`, with a null threshold and zero accepted positives. Application enforcement, private-document serving and deployment require their own integration qualification; the lead retains the overall NET-01 acceptance decision.

Only this report is owned by the reviewer. No service, probe process, external traffic, shared ACL, original, model artifact or primary-checkout file was changed. Supplied permissions: `approval_policy=never`, `sandbox_mode=danger-full-access`. Requested review model/effort: Astra/xhigh at default/standard speed; actual runtime model, effort and service tier were not exposed and are not attested.
