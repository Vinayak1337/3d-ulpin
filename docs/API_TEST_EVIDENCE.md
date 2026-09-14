# API regression evidence

**17/17 checks passed.** Executed: 2026-09-14T00:19:32.882Z.

Target: http://127.0.0.1:3000. Mode: non-disruptive adversarial suite.

Repeat: `pnpm exec tsx scripts/api-regression.ts`.

This check uses the running application and dispatcher without pausing services.

Focused checks are recorded separately and are not overwritten by this suite:

- [Late-result race](API_STALE_RESULT_EVIDENCE.md): `--stale-race-only`, during a coordinated idle window.
- [Closed-ring save/build](API_CLOSED_RING_EVIDENCE.md): `--closed-ring-only`.

Cases created (all names start with Regression):
- Regression adversarial 2026-09-14T00:19:32.882Z: `5d376d47-acb4-4275-879e-98a0ac163bee`
- Regression foreign-source 2026-09-14T00:19:32.882Z: `6941329f-9f24-415d-9f6e-b478f132baf1`

| Result | Scenario | Detail |
| --- | --- | --- |
| PASS | Unknown API routes return typed 404 | Passed |
| PASS | Malformed request JSON returns typed 400 | Passed |
| PASS | External Origin is rejected before mutation | Passed |
| PASS | Opaque Origin is rejected with typed 403 | Passed |
| PASS | Malformed Origin is rejected with typed 403 | Passed |
| PASS | Unknown case UUID returns typed 404 | Passed |
| PASS | Concurrent identical uploads reuse one source revision | Passed |
| PASS | Source upload and inspection do not automatically prepare units | Passed |
| PASS | Incomplete levels retain explicit unverified candidates | Passed |
| PASS | Malformed JSON and invalid numeric CSV fail real inspection | Passed |
| PASS | Mismatched level benchmark cannot be applied | Passed |
| PASS | Mismatched control benchmark cannot prepare a case | Passed |
| PASS | Foreign case source IDs are rejected in preparation and evidence application | Passed |
| PASS | Source revision upload is immutable and does not auto-apply evidence | Passed |
| PASS | Manual elevation edits clear only the changed evidence binding | Passed |
| PASS | Stale unit, build, and evidence expectedRevision values return 409 | Passed |
| PASS | Manual add stays unverified; invalid geometry and reversed levels reject | Passed |

No unrelated cases or stored uploads were deleted. The application currently has no case-delete API; these labelled regression cases remain available for inspection.
