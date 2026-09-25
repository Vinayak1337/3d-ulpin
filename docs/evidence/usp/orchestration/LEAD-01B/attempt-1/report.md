# LEAD-01B · Attempt 1 report

## Handoff

- Assignment: LEAD-01B, attempt 1, T-risk; ready for independent lead review.
- Worker task: `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7`, host `local`.
- Agent observed in this task's session turn context: `Codex / gpt-6-astra / high`.
- Isolated worktree: `/Users/vinayak/.codex/worktrees/51a5/3D Ulpin`.
- Branch: `agent/LEAD-01B-plan-governance`.
- Assigned and verified integration base: `bcf2c81106b38191edbedb72d01f641edd77ad03`.
- Code commit: `3f434995a5b75062337f108740ee11455c0511b9`.
- Evidence commit: supplied in the final callback; it contains this report and the new receipt, without changing the pinned code.

## Implemented

1. Added `plan_governance.py` and the [record contract](../../../../../usp-agent-handoffs/tools/GOVERNANCE.md). Gate approvals bind approver identity, actual decision-source reference, timestamp, selected receipt hashes, tests, waiver records and completion metadata. Known model-family derivation rejects GPT/Astra versus GPT/Sol as a cross-family review. Human review is accepted for GF0–GF4; GF5 and waivers require the designated human owner. Missing or stale evidence fails.
2. Added scoped owner waivers with a reason and explicit claim text present in a hashed before snapshot and absent from the distinct, hashed current claim document. Waivers never mark a test passed. The manifest contains no actual waivers or owner designation.
3. Seeded exactly H90-1–H90-5. Mandatory human activities remain open with unassigned owner identities; optional key/account activities remain not required. Blocked gates must link an open dependency needed for that gate. Resolution requires a matching recorded human action.
4. Added explicit unscheduled/null gate dates. Scheduled dates must be real ISO calendar dates, the fallback decision cannot follow its target, and both dates increase after dependencies. No schedule was invented.
5. Added pending/null release-candidate state. GF5 completion requires the exact pinned ancestor SHA in every selected receipt, execution strictly after evidenced GF4 completion, and owner approval. Earlier gates retain their approved earlier attempts while GF5 selects fresh RC attempts.
6. Added per-test attempts with immutable receipt pins. Failed attempts retain namespace, ancestry, timestamps, review and artifact checks. All reachable manifest history is checked for removal, rewriting or reordering, including after deletion is committed. Complete Git history is required. Current nonwaived test statuses must still be passed.
7. Extended plan-validation provenance: full pinned code SHA, nonfuture UTC check time, fresh hashes covering all active Markdown/entry points and Python helpers/tests. The checked Python bytes must exist at that code commit. The new [receipt](plan-validation.json) covers 45 tracked inputs; older receipts are unchanged.

## Verification

Final executions against the pinned code are recorded with actual timestamps, output and exit codes in [plan-validation.json](plan-validation.json).

| Command | Exit | Result |
| --- | --- | --- |
| `python3 -m unittest discover -s docs/usp-agent-handoffs/tools/tests -q` | 0 | 69 tests passed: all original 40 retained, 29 additional governance tests |
| `python3 docs/usp-agent-handoffs/tools/validate_handoffs.py` | 0 | Active plan, governance and fresh receipt checks passed |
| `python3 docs/engineering-plan/tools/validate_plan.py` | 0 | 26 legacy planning-consistency checks passed |
| `git diff --check` | 0 | No whitespace errors before the code commit |

The new metadata tests include valid/invalid approvals, altered subject/identity/source hashes, same-family mislabelling, future/stale review and completion, owner-only waivers, explicit claim removal, waived tests staying open, dependency triggers/resolution/block references, null and ordered dates, failed attempt retention/tampering/reordering, deletion already committed to Git, later successful retries, fresh exact-RC runs, a different valid ancestor rejected as the RC, GF4 flags without evidence, and stale source-code pins.

Iteration history is preserved here: the first 66-test run exited 1 because the legacy unconditional evidence check rejected an all-waived gate. Gate coverage now accepts only explicit owner waivers for missing tests; the corrected 66-test suite passed. Subsequent 69-test runs passed. The active validator initially exited 1 while its new receipt path was intentionally not yet created; the legacy validator passed at that stage. The new receipt was generated only after the code commit, then the active validator passed. No intermediate failure was presented as a runtime pass.

A structural comparison with the assigned base confirmed that existing baseline, releases, requirements, receipt contract, delivery policy, entry points, gate status/evidence and test status/receipts were preserved. Every actual gate remains pending. Added tests use isolated plan/approval/receipt metadata and the existing test helper; no new operational datasets or analytical truth were generated.

## Scope and limitations

Only the assigned tools directory, governance fields of the handoff manifest, and this new LEAD-01B evidence directory changed. No ledger, AGENTS, UI/product, dataset, credential, dependency, service or deployment changes were made. DATA-09 acquisition was not reopened. No merge or push was performed.

These are record-consistency checks. Hashes do not authenticate the author of an approval export or establish that the source reference is genuine; lead/human review must verify the actual source identity and decision. The validator checks the explicitly identified current claim documents and cannot discover every external public claim. Execution authenticity remains FND-05. Unrecorded attempts and rewritten external Git history cannot be reconstructed. There is no new runtime, accuracy, privacy, learning, GPU, screenshot or deployment qualification.

No actual owner designation, approval, waiver, schedule commitment or release candidate is supplied. Worker self-review is not milestone acceptance; the lead must obtain the required cross-family or human review.
