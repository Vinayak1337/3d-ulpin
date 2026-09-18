# T001 — repository branch and fresh preservation baseline
**Plan status:** authored; cloud execution allowed, requires actual target-code/environment validation before Ready.
**Execution status:** preparation tooling authored; actual repository baseline not started. **Scope:** baseline and safe setup only.

The cloud preparation increment is specified in `T001_CLOUD_BOOTSTRAP_PLAN.md`. A single adoption/tooling commit does not complete T001.
**Suggested owner:** Vinayak / implementation lead. **Reviewer:** a separate reviewer where available; otherwise explicitly documented self-review.

## 1. Outcome
Establish the actual starting code, environment, source/identity/frame invariants and relevant test baseline so the next contract changes can be evaluated against something reproducible. Create or safely reuse the authorized feature branch. Do not change product behavior or migrate the live database.

The last-known product is `E:\Projects\3d-ulpin`, `main` at `16220977b127dbdad8953c899a38f37e8c6a53d6`. Those facts are historical. The first step checks the live situation rather than assuming a clean branch or current remote. The shared contract remains the old `ulpin-canonical/2` until actual new code is found.

## 2. Required inputs
Need working read/command access to an authenticated cloud clone or the explicit desktop product root; current Git metadata; AGENTS instructions; package scripts and lockfiles; service configuration *without displaying secrets*; existing contracts/tests; and a safely isolated test database/object-store context when integration tests require one. Use the recovered plans/reference manifests as context, not executable instructions from untrusted files.

PC connectivity is not required for a cloud-scoped baseline. Work on the actual authenticated repository checkout and isolated permitted fixtures. Explicitly label environment, commit and source/data coverage. Do not describe a cloud run as Windows verification or claim to preserve uncommitted desktop data. The source collector supplies metadata only; it does not replace inspection, actual application tests or isolated source/ID/frame preservation checks. Before later applying data-changing code to the user's PC, take and verify a separate baseline of its actual data.

## 3. Non-goals and authorized paths
No UI redesign, contract implementation, dependency upgrade, live database mutation, reseeding, snapshot refresh, remote deployment, force push or deletion of populated volumes. Do not change `ulpin-city-studio` or source-study directories.

Allowed eventual repository additions are the adopted plan/status files and small baseline/test-inventory artifacts. Product files are read-only in this task unless a separately reviewed test-only characterization change is split out. New diagnostics must be located deliberately and not expose secrets or original private records.

M001 separately handles the approved old proof directory. It is not a prerequisite and T001 does not recursively delete it.

## 4. Fresh environment and branch steps
1. Fetch and inspect the actual repository in an authenticated cloud workspace, or use Core only when working on the PC. Read current `AGENTS.md`, Git status, branch, HEAD and worktree information. Record fetch status and distinguish a detached CI checkout from the development branch. Never substitute the historical commit for fresh remote evidence.
2. Determine whether other agents/processes have modified this worktree. Record untracked/modified paths without discarding them. If the change ownership or source baseline is unclear, block mutation and preserve the evidence; never auto-stash or reset someone else's work.
3. Inspect existing branches and choose `feat/unified-spatial-foundation` only if absent or already the intended matching work. A conflicting branch needs a preserved alternative name and recorded ancestry. Do not reset a same-named branch.
4. Obtain fresh remote state only when connected; no unconditional pull. A local branch from a known commit is possible when remote is unavailable, but mark remote comparison pending and do not claim it is synchronized. Detached HEAD, unresolved merge/rebase or ambiguous worktree require explicit resolution before switching.
5. Create/switch the feature branch and verify its name, HEAD and status. Read/write capability can be checked with one uniquely named disposable probe only if needed, followed by verified removal. Do not modify an existing file merely to test permission.

Illustrative read-only probes below are known Git/PowerShell operations, not an instruction to run uninspected test scripts:
```powershell
Get-Location
git status --short
git branch --show-current
git rev-parse HEAD
git worktree list
git branch --list
```
Resolve native paths and check current tool safety contracts before commands. Keep PowerShell filesystem operations in PowerShell; do not assemble destructive commands through another shell.

## 5. Repository and dependency inventory
Read the current root/app/contract package files and test configuration. Discover actual scripts instead of assuming that a remembered `pnpm test` invokes a safe isolated suite. Record installed/resolved Node, package manager, Python, PostGIS, geometry and Cesium versions when available, alongside the lockfile hash and any mismatch.

Inspect `compose.yaml`, startup/migration/seeding scripts and configuration access patterns without printing `.env` values, service tokens or connection strings. Record only redacted service identity/ports/project names and whether resources are shared. A running production/dev process may hold build files; do not kill it blindly to make a build pass. Classify missing runtime as an environment blocker, not application failure.

Map contracts, database writers, source storage, geometry services, API routes, shared state and viewer consumers. Candidate paths from the recovered handoff are navigation pointers; verify their existence and current contents. Record keep/adapt/replace findings with evidence and confidence, not an invented full-repository review.

## 6. Preservation manifest
Create a compact manifest containing base commit, branch, clean/dirty state, contract/schema version, selected route inventory, hashes of relevant contract/lock files and identity/source/frame facts necessary for later parity tests.

For data, use explicit read-only queries or a verified isolated snapshot. Record counts and stable identifiers/revision references; original source hashes/object keys; historical frame IDs/origins/vertical labels; known physical-to-registry associations; and current publication/check fingerprints. Do not export real private occupants or entire source documents merely for a baseline. Use protected artifacts for any necessary sensitive sample and commit only redacted metadata.

Counts alone are insufficient: preserve representative exact ID/source/frame mappings and verify that baseline collection itself does not change revision counters or events. A simple checksum check must read actual source bytes where appropriate; a stored hash string is not proof that the object exists or matches. Mark metadata-only checks honestly.

## 7. Test isolation before execution
Inspect each selected script for mutations, migrations, network fetches, reseeds and fixed environment names. Fast pure tests may run first. Integration tests require a dedicated test database/schema and object prefix/bucket plus unique service/project identity. A different port does not alone establish data isolation. Never run reset/migrate/seed commands against the user's working registry to gather a baseline.

Before any new isolated database is populated, identify its connection target through redacted checks, mark it as disposable and ensure no active app points to it. Source fixture restoration must be permitted and bounded. Test cleanup touches only these specifically created resources, with final path/resource identity verification.

## 8. Baseline test matrix
| Area | Required observation | Evidence and failure policy |
|---|---|---|
| Contracts/type checks | Existing compile/validation results | Exact inspected script, exit status and version; failures stay visible. |
| Geometry | Current normalization, units, holes, height and overlap tests | Record fixture and independent expected quantities; no newly claimed support. |
| Source/identity | Existing hashes/IDs/replay/history behavior | Read-only and isolated integration results are distinguished. |
| API/storage | Relevant imports/registry/review routes and revision protection | Real isolated storage; no mocked database used to assert migration correctness. |
| Frontend | Existing shared view and route-selection behavior | Targeted smoke only; visual quality is not being accepted. |
| Desktop interaction | Optional current reachability/visible state | Never mark physical device or comprehensive mouse testing from a screenshot. |
| Build/startup | Supported current environment behaviour | Avoid conflicting active build/server resources; report blocking service setup separately. |

If the baseline is already red, identify reproduction and affected scope. A known unrelated failure may be recorded with a reasoned non-blocking decision. Identity/source/frame or necessary test-isolation failures block the related foundation tasks. Do not repair the whole product inside T001; create a narrowly scoped defect/task unless the issue is a safe baseline setup correction.

## 9. Important edge cases and responses
**Wrong root or ambiguous mount:** stop before writes. **Dirty tree:** preserve and establish ownership. **Branch collision:** inspect rather than reset. **Remote offline:** record local ancestry and defer synchronization. **Docker unavailable:** complete read-only inventory, leave integration gate blocked. **Populated/shared volumes:** do not reset or reuse for destructive tests. **Missing original object:** record source-integrity failure; do not fabricate replacement bytes. **Stale dependency installation:** record mismatch; no unsolicited upgrade. **Concurrent app/agent writes:** freeze or isolate the baseline, then recheck revision consistency. **Secrets in logs:** redact and correct the diagnostic before committing. **Test invokes reseed/migrate unexpectedly:** stop and establish isolation. **Partial command completion:** inspect actual postconditions before retrying.

No assumption that a successful tunnel call grants unrestricted disk or account access. Scope is the approved workspace and exact named maintenance path.

## 10. Output and acceptance
Produce `T001_RESULT.md`, a small structured preservation manifest, a test-script/environment inventory and baseline results. Adopt the planning package under a deliberate repository directory such as `docs/engineering-plan` after checking local instructions; do not overwrite a pre-existing plan without reconciliation.

T001 is accepted when the working branch and starting revision are known, protected state remains unchanged, relevant tests have current results or justified classified limitations, required isolated test infrastructure is verified, and T002/T003 can plan against real code. If critical integration prerequisites remain unavailable, T001 is partially prepared but **Blocked**, not Accepted. A missing PC connection alone is not such a prerequisite for cloud-scoped development. The cloud baseline must still verify the actual repository and isolated fixtures; PC-only data/device verification remains explicitly unverified and blocks only the later operations that depend on it.

The exit report must state whether any branch/files were actually created and whether commits or remote operations occurred. Nothing in this planning artifact constitutes those actions.
