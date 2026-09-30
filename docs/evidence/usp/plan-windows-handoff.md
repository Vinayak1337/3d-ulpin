# PLAN-WIN-01 — Windows plan-check portability

30 September 2026. Owned branch `task/desktop-plan-windows` starts at accepted `530774ce5bfb8c466bd55c60a93149db8625533c` in `C:/Users/kvina/.codex/worktrees/backend-review/3d-ulpin`. Initial checkout was clean at completed NET-01 commit `320bda8`; that branch is preserved. Primary staging was read-only, observed at `28932a6693a0dde68d62c37d50ec4d0f1d288ba2`. Requested settings: GPT-6.1 Sol/high/default-standard; actual model/effort/tier are unobserved. Supplied permissions: `never` / `danger-full-access`.

## Correction

- Generated repository identifiers now use POSIX separators for entry-point comparisons, receipt coverage and Git object lookups. Physical paths and outside-repository checks are preserved.
- The isolated test repositories write technical Python fixtures as explicit bytes and use their own `*.py -text` attribute, preserving those bytes through inherited Git text settings. No project/global Git settings or original fixtures change. Test receipt/path helpers emit the same repository identifiers as the validator.
- The existing entry-point mutation test now checks acceptance after correcting the declared gate. One targeted regression proves LF-to-CRLF mutation fails the working-byte hash and, after repinning, still fails the pinned Git-blob hash. Hash verification is not normalized or weakened.
- Only H28's stale D0 acquisition hyperlink is changed: it states the directory is unavailable and links to the existing recorded D0/PACK0 history. No fixture is recreated and no historical observation is promoted.

## Actual checks

From the assigned worktree on Windows, Python 3.13:

| Command | Before | After |
| --- | --- | --- |
| `python -B docs/usp-agent-handoffs/tools/validate_handoffs.py` | Exit 1: two backslash entry-point false errors and absent D0 link | Exit 0; document consistency passes |
| `python -B -m unittest discover -s docs/usp-agent-handoffs/tools/tests` (baseline also used `-v`) | Exit 1; 66/69 pass, three planValidation source/path failures | Exit 0; 70/70 pass |
| `git diff --check` and `git diff --cached --check` | — | Exit 0 |
| `git diff --exit-code 530774ce5bfb8c466bd55c60a93149db8625533c -- fixtures .gitattributes docs/usp-agent-handoffs/release-plan.json docs/usp-agent-handoffs/tools/plan_governance.py` | — | Exit 0; preserved paths unchanged |

Tested source-byte SHA-256: validator `19efec9dc3e9002521e2e1ad2f92c189e0c888c8dcef2e1b15a086d63728b5eb`; test `3c1ad8374d9747aab44e69b35189f39b523b2081eaf5b87de56ea1bbac98d7b4`; H28 `2176eb0d70e72aade1a315218de0bc5e42b24b65a614375bd7ae9e5eea3df562`. An edit helper initially expected 15 path substitutions instead of the actual 14 (exit 1 before writing); its corrected count completed successfully.

The only resources were disposable unit-test repositories, cleaned by the existing test cleanup. No API, Docker, model, download or shared runtime was accessed. Original source bytes, ownership/evidence checks, receipt rules and pending release gates remain unchanged. This passes acceptance-tool checks only; no application/runtime gate or new planValidation receipt is claimed. Lead integration/review remains separate.
