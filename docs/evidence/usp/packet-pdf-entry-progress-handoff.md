# PACK1-PDF-06 — private accepted-entry progress

Code `93a9b2c3a2622b3e38cb00f29f772ba0fe6111ee`, base `30fb6b93c22a7f2ec1acfab0db0ef0c334e84c1e`. Exclusive `task/desktop-packet-pdf-entry-progress` at `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`; staging read-only. Completed recovery branch `910e90a5` is preserved.

## Existing status, additive field

`PacketPdfJobStatusSchema` now includes `entryProgress`. The same enqueue/status/control responses return it; no endpoint, input, store or migration is added. Existing plan/recipe/receipt hashes and final result fields remain unchanged.

```json
{
  "checkpointCapability": "available",
  "requiredCount": 2,
  "acceptedCount": 1,
  "currentReuseEligibility": "not_assessed",
  "entries": [
    {"index": 0, "required": true, "state": "accepted_checkpoint"},
    {"index": 1, "required": true, "state": "pending"}
  ]
}
```

This is committed checkpoint work. It does not qualify current crop reuse or imply an accepted final packet. The status path performs no object/crop/native/profile/recipe I/O. Execution still separately validates current recipe and bytes before reuse. A synchronous completed winner can have a ready final result without checkpoint rows; pending entries mean no committed checkpoint recorded. Only existing canonical job/execution acceptance exposes the final result.

Missing schema reports `checkpointCapability: unavailable`, `acceptedCount: null`, and ordered `checkpoint_unavailable` entry states. It does not crash the reader or invent zero accepted work. Queued execution keeps its existing `PACKET_PDF_CHECKPOINT_UNAVAILABLE` refusal; synchronous behavior is unchanged.

## Authority and bounds

Full current authorized source/plan/target protection precedes the canonical job share lock. Status then recaptures enrollment and projects coherent job/attempt/entry/result state. The helper reads at most five rows to detect an invalid extra row beyond the four-entry limit; SQL caps JSON receipts at 64 KiB and keys at 512 bytes before materialization. Exact receipt identity/hash/scalars and canonical attempt/fence/owner/input linkage are validated. Fenced historical attempts may report accepted checkpoint work. Corrupt, wrong-target, changed-attempt or revoked full-set authority denies disclosure.

Public ordered rows contain only index, required and state. No object key, source name/identifier, crop content, private receipt, actor or attempt owner is included. Existing safe overall fields remain. The identity refactor shares the same exact receipt calculation for execution and projection; unchanged saved recovery rows validate it.

## Concrete checks

Saved projections in `E:/BhuAayam-data/task-data/desktop-packet-pdf-entry-progress-20261003/complete-flow/statuses.json`:

| Phase | Overall state | Accepted checkpoints | Final result |
| --- | --- | --- | --- |
| Before work | queued | 0/2 | absent |
| First crop accepted, later failure | failed | 1/2 | absent |
| Exact retry | queued | 1/2 | absent |
| Completion | succeeded | 2/2 | accepted |

Three focused controls pass, zero skips: the journey above with zero status object/recipe I/O; missing-schema and corrupt/wrong-target/canonical-attempt/full-set-revocation checks; read-only projection over unchanged retained recovery checkpoint/attempt/input/plan rows. The retained helper check does not claim a recovered historical status API invocation. One existing durable enqueue/dispatcher/accepted private-result check passes. Registered Nest controller/schema check passes without a listener; `pnpm typecheck:backend` and `git diff --check` exit 0. Earlier accepted native/recovery/rendering campaigns were reused.

Immutable receipt: `E:/BhuAayam-data/task-data/desktop-packet-pdf-entry-progress-20261003/completion-93a9b2c3.json`, **29,790 bytes**, SHA-256 `308fc89fdc2b8bf93b855f789a464f94d1f59e8eacf4d85677f61b8a43fc1723`. It pins four owned files, 27 protected files, nine evidence files and 27 preserved originals/crops/profile/prior proof files. Its writer log is excluded. Saving variables must be unset for reruns; outputs use exclusive creation.

## Publication and limits

Lead publishes the additive status schema/API/client/catalogue. Controlled SQL/storage/extractor/current-recipe/target/snapshot authority and unchanged genuine crop inputs remain distinct from current HTTP/PostgreSQL/private persistence, migration application, authentic applicability/approved revision, source rights, geometry/learning, scale/performance and GF4/release. Current reuse eligibility is deliberately unqualified by this reader.

No new renderer/native/model/source acquisition/service/listener/Docker/provider/GPU/environment/dependency/cache/profile/frontend/push/deploy work. Generic jobs/dispatcher/db/storage/config, registry writers, worker/runtime and registered migration bytes remain unchanged. Supplied `never` / `danger-full-access`; requested Sol6.1/high/default-standard, actual per-turn settings unexposed.

## Lead integration, 3 October

Code/handoff `7d642917` / `e25faf43`; three integrated progress controls plus queue compatibility pass. Status published in OpenAPI/client. Completion/67 physical/31 Git pins matched. Backend/client types and API validation pass; 259 operations/294 named schemas. No current HTTP/persistence or broader qualification follows.
