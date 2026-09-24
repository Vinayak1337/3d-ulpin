# Late-result race evidence

> **Direction note — 23 September 2026:** This is a historical API result at its stated revision and a conventional output path of the existing regression script. Re-run in an isolated environment for a current result. Current implementation and data/testing assignments are in [USP handoff 00](usp-agent-handoffs/00-README.md) and the assigned feature file.

**1/1 checks passed.** Executed: 2026-09-12T09:45:24.992Z.

Target: http://127.0.0.1:3000. Mode: controlled late-result race.

Repeat: `pnpm exec tsx scripts/api-regression.ts --stale-race-only`.

Coordinate an idle window first. This check briefly pauses the shared Celery worker and restores it in a finally block.

Cases created (all names start with Regression):
- Regression late-result 2026-09-12T09:45:24.992Z: `3f50959b-bc51-4966-ab14-712c211deabe`

| Result | Scenario | Detail |
| --- | --- | --- |
| PASS | Late worker result cannot replace the current model after a controlled edit | Passed |

No unrelated cases or stored uploads were deleted. The application currently has no case-delete API; these labelled regression cases remain available for inspection.
