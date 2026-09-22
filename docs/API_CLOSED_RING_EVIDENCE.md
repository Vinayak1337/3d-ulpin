# Closed-ring save/build evidence

> **Direction note — 23 September 2026:** This is a historical API result at its stated revision and a conventional output path of the existing regression script. Re-run in an isolated environment for a current result. Current implementation and data/testing assignments are in [USP handoff 00](usp-agent-handoffs/00-README.md) and the assigned feature file.

**1/1 checks passed.** Executed: 2026-09-12T09:45:29.338Z.

Target: http://127.0.0.1:3000. Mode: closed-ring save/build regression.

Repeat: `pnpm exec tsx scripts/api-regression.ts --closed-ring-only`.

This check uses the running application and dispatcher without pausing services.

Cases created (all names start with Regression):
- Regression closed-ring 2026-09-12T09:45:29.338Z: `58560e9f-438f-4126-a4e7-b4dc9b126a17`

| Result | Scenario | Detail |
| --- | --- | --- |
| PASS | Closed-ring save and edit preserve the canonical footprint through real queued builds | Passed |

No unrelated cases or stored uploads were deleted. The application currently has no case-delete API; these labelled regression cases remain available for inspection.
