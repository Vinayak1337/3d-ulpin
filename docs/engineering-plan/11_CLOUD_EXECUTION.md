# Cloud-first execution and first commit
**Plan revision 1.1 — 18 September 2026**

## What changed
The user authorized beginning on GitHub without accessing the PC. A cloud clone/Codespace/authorized coding worker and hosted CI can run the repository work. The user's PC is not an architectural dependency. This supersedes the previous turn's wait-for-tunnel wording, not its preservation or test requirements.

One commit is appropriate for this coherent adoption/tooling increment. Subsequent tasks remain individually planned and verified; do not squash the whole rebuild into an unreviewable change. A task may need more than one commit when verification reveals a defect. Do not hide fixes to maintain an arbitrary count.

## First candidate commit
Branch: `feat/unified-spatial-foundation`.

Message: `chore(T001): adopt engineering plan and cloud baseline tooling`.

Payload: this plan folder and `.github/workflows/ulpin-engineering-baseline.yml`. It does not alter product code, installed dependencies, source fixtures, secrets, databases, main, or existing workflows. The authenticated executor must inspect current root instructions and path collisions before applying. Do not replace `AGENTS.md` from memory; reconcile relevant instructions through a reviewed change if needed.

## What the included workflow proves
The candidate workflow validates plan records, tests the collector on temporary synthetic Git repositories, checks the generated backlog, and attempts a committed-source inventory. It uses GitHub-hosted Ubuntu, read-only repository permission, no saved checkout credentials, pinned official actions and seven-day retention for one small report. No app scripts, dependency installs, migrations, deployments or self-hosted PC jobs are included.

A successful run does NOT prove T001 complete: code inspection, safe application test execution and isolated data/source/identity/frame checks must follow on the actual checkout. Script names are discovered but command bodies are neither reported nor automatically trusted/executed. Inventory warnings such as malformed or oversized manifests require review. The collector is not a security scanner or a live database backup.

The read model is committed HEAD. A PR workflow may use a synthetic merge commit and detached HEAD; record it rather than pretending it is the feature branch tip. The collector does not fetch, so it explicitly does not establish remote freshness. Subsequent repository fetch and review establish actual branch ancestry.

## Environment-specific gates
| Concern | Cloud execution | Remaining boundary |
|---|---|---|
| Branch, source, schema, tests | Actual authenticated checkout; inspected scripts | No claim about uncommitted PC work |
| DB and object integration | Dedicated disposable resources and permitted fixtures | No claims about private PC-only records |
| Browser interaction | Hosted/headless or cloud browser, explicitly labelled | Native phone/GPU acceptance remains separate |
| Visual fidelity | Actual rendered scenes and comparison on declared environment | Reviewer acceptance still required |
| Apply new migrations on PC | Not part of cloud development | Fresh private-data baseline and recovery rehearsal first |
| M001 proof cleanup | Not applicable | Needs direct access to that exact Windows directory |

## T001 continuation
Read the updated detailed plan. Inspect actual source and scripts before installing/running them. Add or reuse isolated CI test jobs based on those findings, not historical command guesses. Record fixture counts, IDs, source bytes/hashes, origins and revisions before and after tests. Keep cloud and desktop preservation receipts distinct. Do not make a green metadata-only workflow the required replacement for real application CI.

## Present execution status
The original candidate was prepared without target access. That boundary is now historical: the package is adopted in the real Windows repository, baseline repairs were exercised, and an isolated integration workflow was added. Consult `T001_PROGRESS.md`, `PLAN_STATUS.json` and actual Git/Actions state for execution. The metadata-only workflow still does not establish application or database correctness; the separate integration workflow restores and verifies actual fixtures on owned hosted resources.

## Primary references checked for this candidate
- GitHub-hosted runners: https://docs.github.com/en/actions/concepts/runners/github-hosted-runners
- Workflow syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- Secure use: https://docs.github.com/en/actions/reference/security/secure-use
- Checkout v7.0.1 action contract: https://github.com/actions/checkout/blob/v7.0.1/action.yml
- Verified checkout release commit: https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1
- Upload artifact v7.0.1 action contract: https://github.com/actions/upload-artifact/blob/v7.0.1/action.yml
- Verified upload release commit: https://github.com/actions/upload-artifact/commit/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a

These primary sources support the workflow contract, not evidence of a run against this repository. Pinned action IDs prevent tag drift; pinning alone is not a complete supply-chain audit.
