# CITYJSON-REFERENCE-REVIEW-01 — scoped officer-review audit

1 October 2026. **No actionable finding established.** The candidate satisfies the assigned code-review scope for immutable, explicitly selected judgments about reference conventions. Lead integration, generated OpenAPI/client publication and the separately assigned real persistence journey remain pending; this report does not pass a runtime or release gate.

## Reviewed checkpoint

- Implementation base: `1098ca79e3a6f4dc6a5f27abcb173af69d1db7f0`.
- Code: `8d79bcc42822f473481056cdef4334f8b04907d3`.
- Candidate handoff: `7d7c55bf7b1651254dec2b0d74ccc1f3e12c3af6`.
- Assignment and observed read-only staging head: `d9e0f7bcec5ea89cbba200a575bc05ffd2f36061`.
- Reviewer checkout: `C:/Users/kvina/.codex/worktrees/point-review/3d-ulpin`, branch `task/desktop-cityjson-officer-review-audit`, initially clean at the candidate handoff. Only this report is owned and changed.
- Assignment requests Astra/xhigh/default-standard; actual per-turn model, effort and tier are unexposed. Supplied permissions are `never` / `danger-full-access`. No settings were changed.

Reviewed the nine changed code/test files: the register controller/service/operation manifest, contract exports, admission contract/service, new reference-review contract/service and focused test. Traced directly relevant reference/native/document authority, operations readers/store, transaction and route/body helpers. Consulted the migration/operating/backend instructions, implementation/review assignments, candidate handoff and current source index/catalogue. Completed source interpretation and reference-lock reviews remain closed; their checkpoints and retained evidence were preserved.

## Review conclusions

### Receipt integrity and privacy

`cityjson-reference-review.ts` uses the existing `operations` composite primary key with kind `registry-cityjson-reference-review/1` and a draft/review-namespaced key. The server derives the review ID from version, draft, case and request key; the payload digest includes the parsed request and server context. Stored time/context, limited outcome and full authority are covered by the review digest. Exact reads recompute ID, body digest, payload/context binding, outcome and current authority. Replay passes through current reference authority before receipt lookup and returns the original receipt only for an unchanged request and aggregate.

The new path inserts one receipt and has no update/delete, draft revision bump, reference mutation or generic `registry_reviews` write. All reached production operations queries constrain their kind. The generic `cases/domain.ts::operationResult` caller supplies the fixed `upload` kind; document and sufficiency helpers also use fixed, distinct kinds. The checked store consumers cannot select this new receipt as another operation or expose its stored context through those paths. This conclusion covers application consumers, not arbitrary administrative SQL.

The full private response strips `requestKey` and `reviewContext`. Admission parses a strict summary containing only IDs/digests, scope, outcome, currentness, object-control disposition and accuracy status. It contains no stored rationale, source text, principal or object path. Missing and inaccessible review reads use the controlled private 404 pattern; changed authorized evidence conflicts. No latest-review lookup was introduced.

### Authority and lock order

Create, read and replay enter the existing complete reference-authority helper before receipt access. Its lookup discovers the workspace/native/reference case set, acquires sorted common gates before destination rows, then checks the locked identities before calling native authority. Document processing verifies exact accepted input/result/fence, reader, selected part hash/locator, access and native target pins. After document I/O it rechecks document authorities/fences, the held draft, native aggregate and review context. Native accepted authority checks current source/job/attempt pins under the existing locks.

The new consumer adds no case gate after those locks. Same-client receipt reads use the already resolved aggregate; writes check context before and after insertion, with failure propagating to transaction rollback. Admission resolves optional review selection under that same authority and repeats the aggregate after native/optional validation I/O, comparing the review as well as existing authority/reference pins. Static tracing establishes no new receipt-order or late-gate regression; no fresh SQL-contention claim is made.

### Contract, compatibility and meaning

POST/GET use `PrivateSpatialGuard`, private/no-store response metadata, exact UUID/SHA256 parameters and rejection of query fields. POST reads at most 16 KiB before strict parsing; conclusions are bounded, unique and must cover every current selected reference exactly once. Stored/public results are bounded to 32 KiB. Server-derived identity, time and qualification fields cannot be supplied in the request.

Admission selects a review only through optional `referenceReviewId`; omission skips the review lookup and summary/inspection action. Existing optional validation behavior is retained. The action count permits all combinations of selected/omitted validation and review. Generated contract publication is explicitly lead-owned and deferred in this checkpoint.

`supports_declared_convention` means an officer marked all reviewed definition/delivery conclusions supported. Conflicts take precedence; object-control applicability cannot be marked supported, and the overall object-control disposition remains `needs_input` or `unsupported`. Scope stays `selected_reference_conventions`, accuracy `not_assessed` with null metres, admission `unavailable`, and qualification `not_assessed`. Independent reference applicability/controls, measured accuracy, native admission and post-write requirements remain unresolved, with existing recording/geometry capabilities false. This matches the accepted EPSG/3DBAG source limitations, including missing independent object controls and exact historical release applicability. Operator rationales are judgments, not source facts or learning labels.

## Evidence and verification limits

Independently rehashed the retained primary receipt:

`E:/BhuAayam-data/task-data/desktop-cityjson-reference-review/verification.json` — 40,879 bytes, SHA256 `774ba541570ea8f1139b7b4f6ecc825f5537bd9203c17643000d4289915462cb`.

Also rehashed and inspected its final control and four check logs; all five byte counts/digests match the receipt. The lead's recorded reconciliation of 32 unique artifacts and 57 physical/Git pins is reused, not claimed as a second reviewer-wide reconciliation. Accepted reader bytes and saved producer pins were not rewritten or requalified in this checkout.

| Retained owner check | Recorded result, reused here |
| --- | --- |
| `pnpm exec tsx --test tests/registry-cityjson-reference-review.test.ts tests/registry-cityjson-admission.test.ts` | Exit 0; 10 passed, zero skips |
| `pnpm exec tsx --test tests/registry-cityjson-reference-review.test.ts` | Exit 0; final 3 passed, zero skips |
| `pnpm typecheck:backend` | Exit 0; server/API logs inspected |
| No-listener `route-schema-control.mts` | Final exit 0; two private routes and optional admission ID checked |

Final `control-final.json` is 47,350 bytes, SHA256 `46f13b258c07ebb68cbbc259009b5109a2b04baa869c0d66ebd830b39cdd60e7`. It records one receipt insertion, unchanged draft, exact create/read/replay and explicit admission selection over retained revision-5 data with five real reference parts. Review SHA256 is `f4f2da93c239299ffbb58f184e8f815800e2b6587a6dbd1611883325a68f1302`; assessment SHA256 is `6c4894c3375d57d712a9f1d4c2e6408730c340317671c3b043689eae996a98e6`. These are control outputs using authority/query/object-read doubles, not persisted officer reviews. Retained checks exercise wrong/missing IDs, payload conflict, stale pins/aggregate, revocation/context changes, post-I/O drift, omissions and unsupported qualification claims.

Reviewer command `git diff --check 1098ca79e3a6f4dc6a5f27abcb173af69d1db7f0 7d7c55bf7b1651254dec2b0d74ccc1f3e12c3af6` exited 0. No concrete unresolved concern warranted a new reproduction or test rerun. No services, API/SQL/Docker queries, validators, OCR, models or providers were run. Actual persistence, HTTP behavior, contention and deployment remain outside this review. Runtime remains stopped/lead-owned; no worker, polling schedule or resource was created. Goal remains the paused reference. Return this report by the authorized lead callback, then stop.
