# 13 · Citizen evidence, corrections and scoped notifications

Owner **CITIZEN** · Priority **P2** · Baseline `main@f623cff897f91bb3ebd4c225f700ac263f7beb72` · [F0/F1](01-shared-contracts-and-ownership.md) for local implementation; **F2 and DEPLOY are mandatory before public activation**.

## A. User outcome and product value

Allow a person to find the correct property space, contribute requested evidence or propose a correction, and see what happened to their submission. Allow an officer to request a particular missing fact rather than ask citizens to upload every document they possess. This is a supporting participation workflow that makes evidence-linked mapping useful to the public.

Synthetic example: a resident identifies Building A, chooses the second floor and reports that Flat 201 is mapped to the first floor. They submit a relevant plan excerpt. The system shows the proposed target and extracted fact for confirmation; an officer reviews it against existing records. The upload does not immediately move the flat or grant the submitter access to other residents' records.

## B. Current implementation and gap analysis

[source-cases.ts](../../apps/web/lib/server/source-cases.ts) can receive unassigned documents, retain original bytes, deduplicate request keys and keep native text without inventing placement. [area-resolver.ts](../../apps/web/lib/server/area-resolver.ts) resolves identifiers and explicitly distinguishes suggested spatial neighbours from confirmed associations. [search-targets.ts](../../apps/web/features/officer/shared/search-targets.ts) avoids arbitrary parent/area pairing. Reuse these semantics behind protected adapters.

The existing identifier resolver performs `syncLegacyIdentifiers` writes while resolving; a public read endpoint must not simply expose that routine. FND must separate read-only permitted projections from internal synchronization. [officer investigations](../../apps/web/lib/server/officer-investigations.ts) already support requests and revisioned review notes. Existing [API access](../../apps/web/app/api/v1/%5B...path%5D/route.ts) is local-demo access, not citizen authentication.

Missing: publicly releasable field projections, authenticated personal submissions, quarantined public upload intake, explicit evidence-request lifecycle, correction review, secure receipt/status links and scoped change subscriptions. Email/QR delivery is not existing ownership verification and must not be presented as such.

## C. Scope and non-goals

First release: approved public property lookup/map, exact-space selection with “not listed” fallback, signed-in contribution/correction, officer evidence requests, own-submission tracking, in-app notifications and optional policy-qualified email receipt. Local synthetic multi-principal tests can proceed before F2; deployment is disabled until the access and infrastructure gates pass.

No direct citizen writes to registry identities, rights or geometry; no open directory of occupants; no ownership verification from email or document possession; no unrestricted bulk downloads or public source search. Do not request Aadhaar, bank details or whole household documents merely to identify a building. Offline/mobile-app synchronization and legal dispute adjudication are optional future work.

## D. HLD and end-to-end flow

Public lookup → choose approved building/floor/unit or mark unresolved → authenticate → start submission → bounded upload into quarantine → scan and safe extraction → show candidate association/facts → submit → officer reviews against pinned records → request clarification or create a reviewed proposal → existing commit workflow records accepted changes → contributor receives a minimal status update.

An officer may start the loop from READY's missing-evidence action or an existing investigation. Requests cite the missing fact and target, not a generic demand for every registry source. Closing a request means its question was handled; it does not mean the underlying property has legal clearance.

## E. Targeted LLD

### Identity, data and state

Proposed `EvidenceRequest`: target/scope, requirement ID or investigation link, question, accepted input types, creator, due date optional, revision, status `open|answered|reviewed|closed|cancelled`, and review outcome. Attach typed source pointers after review; never count an upload as satisfying a request automatically.

Proposed `Submission`: server-derived subject, target pin or unresolved area/building selection, request ID optional, purpose (`evidence`, `correction`, `missing_space`), statement, proposed field changes, source revision references, version and status. State machine: `draft → scanning → ready_to_submit → submitted → under_review → clarification_required | accepted_for_proposal | rejected | withdrawn`. A response to clarification creates a new submission version; preserve the old one. `recorded` is a linked downstream outcome only after the existing reviewed commit succeeds, not a synonym for submission acceptance.

Proposed tables `usp_citizen_requests`, `usp_citizen_submissions`, `usp_citizen_submission_versions`, `usp_citizen_notifications`, `usp_citizen_subscriptions`. Private upload blobs live in the existing object store under quarantine access. A clean accepted source is passed to the existing receipt service through FND; preserve its original bytes/hash and mark its provenance as citizen-submitted. Do not write directly into `sources` from feature code or invent a confirmed association before review.

### Upload and review controls

Use the existing [document format limits](../../apps/web/lib/document-formats.ts) as an upper bound and a stricter public policy where appropriate. First release accepts explicitly configured PDF, PNG/JPEG and structured/text documents; no public archives or arbitrary executable files. Validate actual file type, decoded size/page count, document active content, antivirus/quarantine verdict and extraction runtime. Rejected/unsafe content is not served inline. Scanner unavailable means remain quarantined; no “assume safe” fallback. DOCX requires safe archive-member and macro/relationship handling before activation.

Persist a receipt before extraction and survive browser closure. Failed scanning/extraction preserves the user's draft and gives a safe status. A normalized extraction must quote a bounded source location and pass validators; model text is untrusted input. Let the user correct the proposed association, but do not convert their confirmation into officer review or an ownership assertion. Matching “Flat 101” in two buildings produces explicit alternatives.

Officer review uses current target revision plus submitted base revision. If the target changed, return a stale-review conflict and show a difference; never silently rebase the correction. `accepted_for_proposal` calls FND's proposal adapter with exact fields/evidence and preserves the existing separate review/commit mechanism. Rejections require a reason visible to the contributor unless a separately documented restricted reason must remain internal.

### Public projection and API

Public view fields are allowlisted: public identifier assertions, approved address/building label, released geometry/general status and public actions. Exclude recorded parties, contacts, internal findings, source URLs and confidential unit details unless separately released. A floor list itself requires a release policy; do not assume every interior layout is public.

Proposed under `/api/v1/usp/citizen`:

| Endpoint | Behavior |
| --- | --- |
| `GET /public/properties` | Bounded query/address/identifier or bbox over released records only; max 20 results and rate limits; no side-effect synchronization |
| `GET /public/properties/:publicRef` | Approved summary and selection references, not a full dossier |
| `POST /submissions` | Authenticated draft with target/request/purpose and idempotency key |
| `POST /submissions/:id/files` | Own draft only; bounded binary upload and private quarantine receipt |
| `POST /submissions/:id/submit` | Expected submission version, confirmed association/statement; cannot bypass quarantine |
| `GET /submissions/:id` | Own submission or scoped reviewer; safe version/history projection |
| `POST /submissions/:id/review` | Scoped reviewer, expected target/submission revisions, disposition/reason; delegates accepted proposal |
| `POST /requests` | Scoped reviewer creates exact evidence request; optional READY requirement ID |
| `GET /requests/:id` | Request-specific authorized detail; no guessable private evidence |
| `POST /subscriptions` | Own subject + permitted target/event types; confirm and allow revoke |
| `GET /notifications` | Own in-app status notifications with cursor and unread state |

Status/withdraw/clarification commands use explicit expected-version mutations in the feature routes; no generic arbitrary-field PATCH. FND supplies session/capability validation and non-enumerable errors. Unresolved target submissions remain an officer matching task; they do not auto-create a property.

Notifications consume committed outbox events, deduplicated by subscription/event ID. Recheck subscription and grants at delivery. Prefer in-app messages; email is optional and requires an approved deployment mail transport. Emails contain only a minimal receipt/status link, not raw deeds, owner names or a newly “issued” official ULPIN. Receipt IDs are references, not bearer authorization; login still applies. Link tokens, if needed for contact verification, are short-lived, one-purpose and stored hashed. Email verification establishes contact control only.

## F. Exact implementation map

| Existing or proposed file | Required change | Reason | Owner | Shared dependency |
| --- | --- | --- | --- | --- |
| [source-cases.ts](../../apps/web/lib/server/source-cases.ts), [areas.ts](../../apps/web/lib/server/areas.ts) | FND exposes access-qualified receipt/proposal adapters | Reuse originals and extraction | FND | CITIZEN request context |
| [area-resolver.ts](../../apps/web/lib/server/area-resolver.ts) | Separate synchronization from public read projection | Public lookup must be read-only and scoped | FND | F2 public release policy |
| [officer-investigations.ts](../../apps/web/lib/server/officer-investigations.ts) | Link requests/reviews without duplicating existing investigation history | One officer review path | FND | Request references |
| Proposed new `packages/contracts/src/usp/citizen.ts` | Request/submission/review/public DTOs | Strict permission-dependent contracts | CITIZEN | F0/F2 |
| Proposed new `apps/web/lib/server/usp/citizen/{service,public-projection,uploads,notifications,routes}.ts`, `migrations/13-citizen.ts` | State machine, quarantine integration and notifications | Durable participation loop | CITIZEN | FND storage/outbox/access; DEPLOY mail/scan |
| Proposed new `apps/web/features/usp/citizen/{PropertyFinder,SubmissionForm,SubmissionStatus,EvidenceRequestPanel,ReviewSubmission}.tsx` | Public and officer leaf experiences | One target-specific workflow | CITIZEN | UI selection/access widgets |
| Proposed new `apps/web/app/public/properties/page.tsx`, `apps/web/app/public/submissions/[id]/page.tsx` | Thin gated route mounts | Separate public projection from officer shell | UI | F2 and CITIZEN leaves |
| [WorkQueue](../../apps/web/features/officer/work/WorkQueue.tsx), [register Evidence](../../apps/web/features/officer/register/Evidence.tsx) | Mount submission/request entry points | Avoid separate officer portal | UI | CITIZEN and READY |
| Proposed new `tests/usp-citizen.test.ts`, `tests/usp-citizen-integration.ts`, `tests/e2e/usp-citizen.spec.ts` | Multi-principal workflow/security/recovery tests | Verify actual privacy boundaries | CITIZEN | Isolated auth/scan/mail fixtures |

## G. UI placement and interaction

Public entry **Find my property** provides identifier/address search and map selection; location permission is optional, not required. Confirm visible building context, then select an available released floor/unit or **My space is not listed**. Show one upload/request step at a time with an explicit “You are submitting information for review” label. The final receipt shows the chosen property, submitted items and review status—not a success badge suggesting ownership.

In Studio, READY's **Request evidence** opens EvidenceRequestPanel within the selected register. `/studio/work` can filter incoming submissions; an item opens ReviewSubmission beside the existing property/source context. Loading/scanning has persisted progress; empty lookup offers a bounded unresolved request; invalid files have actionable type/size errors; permission denial hides other submissions; clarification shows exactly what is needed; accepted shows the proposal link and whether recording remains pending. Mobile forms support camera/photo inputs only when type limits pass; essential actions are not hover-only. UI owns page/layout integration; CITIZEN owns forms and state-machine content.

## H. Agent ownership and dependencies

Use `feat/usp-citizen`. CITIZEN owns its new contracts/services/migration/components/tests; FND owns identity/session/grants and existing receipt/review adaptations; UI owns routes and parents; DEPLOY owns approved transports and boundary validation. F0 permits isolated state-machine/fixture work. F1 connects local synthetic workflows. F2 plus scanner/transport policy gates public activation. Email absence does not block the in-app MVP; public authentication/quarantine absence does block public uploads.

## I. Implementation sequence

1. Build two-person and reviewer fixtures, exact target selection and private submission state machine.
2. Implement read-only released-property projection; test that the original resolver's synchronization is not exposed publicly.
3. Add quarantine intake, persistent receipts, safe extraction and confirmed-target submission.
4. Connect reviewer decisions to existing proposal/commit adapters; add stale-review handling.
5. Add evidence requests and in-app notifications; integrate optional email only after DEPLOY qualification.
6. Mount public/officer leaves through UI and run complete authenticated isolation/recovery tests before enabling deployment.

## J. Acceptance criteria and verification

Demonstrate resident A finding a synthetic building, choosing a unit, submitting a plan, receiving clarification and obtaining a linked recorded outcome only after officer review/commit. Resident B cannot read A's receipt, original, preview, notification or derived packet by changing IDs. A public caller cannot see private parties or trigger identifier synchronization. A correctly delivered email gives no property entitlement.

Test unlisted unit, ambiguous building, missing official ULPIN, duplicate upload/request key, source hash mismatch, malicious or oversized file, scan outage, interrupted upload, stale target, double reviewer action, withdrawal, revoked subscription and retry without duplicate mail. An uploaded claim cannot silently modify canonical geometry or rights. In-app operation remains usable with email disabled.

Run `pnpm typecheck`, `pnpm test:case-document-copy`, `pnpm test:api`; proposed tests via `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-citizen.test.ts`, `pnpm exec tsx tests/usp-citizen-integration.ts`, and `pnpm exec playwright test tests/e2e/usp-citizen.spec.ts`. Record F0/F1 results separately from F2 deployment qualification. Do not use real personal records for automated fixtures.

## K. Copy-paste agent assignment

> Implement CITIZEN on `feat/usp-citizen`. Read the index/shared contracts, this handoff and linked source-receipt, resolver and investigation files. Build the proposed private submission/request/review/notification modules and public-projection leaves; do not expose the existing full resolver or dossier. Use FND authentication, grants and reviewed proposal adapters; UI owns route/parent mounts. Email/QR confirms a contact or opens a record, never proves ownership or issues an official identifier. Keep public activation gated on F2/DEPLOY and safe upload quarantine. Run section J multi-principal and live workflow tests; return commits, privacy/retry evidence, screenshots and explicit unresolved deployment gates. No direct registry publication or main merge without authorization.
