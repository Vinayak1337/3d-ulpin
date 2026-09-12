# Late-result race evidence

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
