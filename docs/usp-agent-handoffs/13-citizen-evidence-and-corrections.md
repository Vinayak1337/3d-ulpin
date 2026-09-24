# 13 · Citizen evidence, corrections and scoped notifications

**Release: `full_product` (FP-PUBLIC).** The separate public data-request/evidence/correction dashboard remains planned with private submissions, released-only discovery, tracking and authorization. It is not a finale prerequisite. GF4 reuses the release/access contracts for the card without enabling a public portal.

Owner **CITIZEN**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`; revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md), DEPLOY ports in [19](19-india-contained-deployment.md) and UI slots in [99](99-ui-ux-and-integration.md). ER-04/06/15/16/22 are incorporated. Local synthetic integration can precede F2; public activation cannot.

## A. User outcome and product value

Allow a person to find an explicitly released property, submit missing evidence or propose a correction, receive precise clarification and track a reviewed outcome. Allow an officer to request the particular fact needed. A citizen saying Flat 201 belongs on a different floor creates a reviewable proposal, not an immediate geometry change or ownership entitlement.

## B. Current implementation and gap analysis

[source-cases](../../apps/web/lib/server/source-cases.ts) retains unassigned sources but extracts before its final receipt; wrap the new durable upload lifecycle rather than exposing it unchanged. [area-resolver](../../apps/web/lib/server/area-resolver.ts) performs identifier synchronization writes; public lookup must use a separate read-only released projection. [search-targets](../../apps/web/features/officer/shared/search-targets.ts) distinguishes area/parent relationships. [Investigations](../../apps/web/lib/server/officer-investigations.ts) already have requests and history; link them instead of creating a duplicate officer portal. [Current API guards](../../apps/web/app/api/v1/%5B...path%5D/route.ts) are local restrictions, not production authentication.

Implement durable targetless intake, hash-bound quarantine/source promotion, explicit review/withdrawal commands, restricted personal submissions and notification delivery semantics. An email/QR never verifies ownership or issues official ULPIN.

## C. Scope and non-goals

First complete local path: D0 contributors A/B and reviewer → released-property lookup → own upload/statement → clarification → accepted draft proposal → existing separate review/record → own receipt. Public mode additionally requires F2, approved release policy and live scanner qualification. Email is optional; in-app status is required.

No public occupant directory, unrestricted original lookup, automatic cadastral changes, Aadhaar/bank-data collection just to find a building, legal adjudication or new mobile/offline synchronization platform. First public upload profile permits PDF, PNG/JPEG, CSV and UTF-8 text only; archives, DOCX and arbitrary binaries remain disabled until separately qualified.

## D. HLD and end-to-end flow

Find released building → select released floor/unit or Not listed → sign in → create private intake receipt → upload/finalize → scan → safe extraction → confirm candidate target/facts → submit → reviewer checks current and submitted evidence → clarification/rejection/accepted-for-proposal → existing proposal/review/commit flow → durable outcome link and notification. Missing target remains an intake matching task; it never fabricates a SnapshotScope or property ID.

## E. Targeted LLD

### Data and states

`Submission` stores ID/version, server subject, IntakeScope, nullable target pin + optional submitted SnapshotScope, request ID, purpose (evidence/correction/missing_space), statement, proposed changes, upload/source refs, candidate alternatives and downstream proposal/commit receipts. Target confirmation is separate from officer association review.

Submission states: draft → scanning → ready_to_submit → submitted → under_review → clarification_required / accepted_for_proposal / rejected. Withdrawal is permitted before accepted_for_proposal. Clarification creates a new immutable version and repeats file safety checks; no editing the submitted old version. Text-only clarification may return directly to ready_to_submit if no file change. At least a nonempty statement or qualifying evidence is required. Accepted-for-proposal means a real draft was created; recorded outcome appears only from an actual commit receipt. A post-acceptance withdrawal request is recorded for reviewer handling and cannot delete already recorded history.

`EvidenceRequest` pins target/scope, requirement or scoped/legacy case, question, allowed input types, optional due date, version, status open/answered/reviewed/closed/cancelled and outcome. Upload does not satisfy a fact. Reviewer explicitly marks answered evidence sufficient/insufficient for the requirement; READY consumes that status with current pins. A closed request does not mean property legal clearance.

Tables: `usp_citizen_requests`, `usp_citizen_submissions`, `usp_citizen_submission_versions`, `usp_citizen_promotions`, `usp_citizen_notifications`, `usp_citizen_subscriptions`, `usp_citizen_deliveries`. Upload primitives are shared FND storage metadata, not a second upload engine.

### Receipt first, quarantine and promotion

Create server-issued upload metadata/owner/version before receiving bytes; acknowledge finalized durable bytes/hash before extraction. Store untrusted files in private quarantine. Check streamed byte count, MIME signature, safe filename, decoded pixel/page limits and parser deadline. Initial public caps: 10 MiB/file, five files/submission, 20 PDF pages and 12 million pixels per rendered page, always constrained further by existing parser limits. These are engineering defaults to test, not proof of safety. Denied/unsafe/quarantined originals are never served inline.

DEPLOY's scanner receipt binds exact asset hash and scanner/version/signature status. Scanner unavailable or signature policy failure keeps quarantine; no assume-clean fallback. Structural/active-content validation and isolated extraction remain necessary even with a clean antivirus verdict. Rendering uses PACK's qualified page pipeline where needed; no unrestricted file-to-HTML serving or remote conversion.

`promoteUpload` in 01 takes upload/hash/clean receipt/destination case/intent key and returns a source-revision receipt. Same promotion intent returns the same linkage; equal bytes submitted by different users or for different purposes do not silently share ownership, permissions or target association. Preserve original hash and citizen-submitted provenance. Extraction and promotion can be retried without duplicate sources; cross-store failures leave unreferenced quarantined objects for delayed cleanup, never delete referenced originals.

### Reviewer and proposal transaction

Review command pins submission version, exact target/base manifest, current evidence and actor. Changed target/relationships produce 409 and an explicit rebase/review step. Confirming a document match cannot approve its contents or rights. An unresolved match returns clarification or matching work, not an invented building.

FND supplies the bounded draft-preparation bridge over existing registry/case services: `prepareProposal(ctx,{kind,target,scope,changes,evidence,guard}) → {proposalId,version,state:'draft'}`. Its same-client implementation creates the draft and links the citizen acceptance receipt/audit/outbox together; register this F1-feature port before enabling acceptance. Later `commitProposal` from 01 records only after the existing review checks, using the same-client receipt contract. No direct CITIZEN write to recorded registry rows and no independently committing nested wrapper. A failed draft creation cannot leave accepted_for_proposal with no proposal. Rejection/clarification needs a safe contributor-visible reason; restricted review notes stay separate.

### Explicit API

Proposed prefix `/api/v1/usp/citizen`; use 01 strict schemas/guards/errors:

| Route | Behavior |
| --- | --- |
| `GET /public/properties`, `GET /public/properties/:publicRef` | Read-only released identifier/address/bbox search, max 20 results, rate limit; no private resolver fallback |
| `POST /submissions` | authenticated create guard; target may be null → durable draft/intake scope |
| `POST /submissions/:id/files` | own mutable version → shared upload receipt and bounded binary intake |
| `POST /submissions/:id/files/:uploadId/finalize` | expected version/hash → durable received state, scan queued |
| `POST /submissions/:id/submit` | expected version, confirmed candidate/statement; safety gate enforced |
| `POST /submissions/:id/clarify` | own clarification-required version → new version with response/evidence |
| `POST /submissions/:id/withdraw` | own pre-acceptance version + reason → withdrawn; post-acceptance returns review-required, no silent reversal |
| `POST /submissions/:id/review` | reviewer, expected submission/target manifest + disposition/reason → clarification/rejection/real draft receipt |
| `GET /submissions/:id` | own or assigned-reviewer projection including exact downstream outcome |
| `POST /requests`, `GET /requests/:id`, `POST /requests/:id/close` | scoped request creation/read and explicit reviewed outcome/version |
| `POST /subscriptions`, `DELETE /subscriptions/:id` | own permitted target/events, create/update guard; revocation effective for later delivery |
| `GET /notifications`, `POST /notifications/:id/read` | own cursor-paginated inbox and versioned read acknowledgement |

Released fields: approved public ref, identifier assertion, address/label, released geometry/status and actions. Interior layouts/floor lists require release too. Private parties, contacts, source URLs and internal findings never reach a public response by default. FND's ReleaseDecision can authorize sanitized output without granting private original access; public projection changes/version/revocation are explicit. Errors, search totals and pagination must not enumerate hidden objects.

### Notifications

Consume committed outbox events at least once; unique `(subscription,event)` creates one in-app notification. Recheck current grants and subscription before delivery. Email contains only minimal status/receipt link; login still required. No owner names, deeds or supposed issued ULPIN. Provider idempotency is used when available. On ambiguous timeout record delivery_unknown and reconcile provider status before retry where possible; do not promise universal exactly-once email. In-app status remains authoritative. Contact-verification tokens are hashed, short-lived, single-purpose and confer no property grant.

## F. Exact implementation map

| File | Change / owner |
| --- | --- |
| Existing source/case/registry/resolver/investigation helpers linked in B | FND narrow receipt/read-only projection/prepareProposal adapters, same-client transactions |
| Proposed `packages/contracts/src/usp/citizen.ts` | CITIZEN submission/request/public/review/delivery schemas |
| Proposed `apps/web/lib/server/usp/citizen/{service,public-projection,uploads,notifications,routes}.ts`, `migrations/13-citizen.ts` | CITIZEN lifecycle and leaf routes; shared receipt/scan/mail via ports |
| Proposed `apps/web/features/usp/citizen/{PropertyFinder,SubmissionForm,SubmissionStatus,EvidenceRequestPanel,ReviewSubmission}.tsx` | CITIZEN leaf UX |
| Proposed `apps/web/app/public/properties/page.tsx`, `apps/web/app/public/submissions/[id]/page.tsx`; existing WorkQueue/register parents | UI mounts; FND supplies SSR access wrapper; never full officer header/search on public page |
| Proposed `tests/usp-citizen.test.ts`, `tests/usp-citizen-integration.ts`, `tests/e2e/usp-citizen.spec.ts` | CITIZEN multi-principal, restart, review and delivery tests |

## G. UI placement and interaction

Public Find my property supports identifier/address/map with optional location permission. Show building context and released floor/unit or My space is not listed. One form step at a time, with an explicit submitting-for-review label. Receipt distinguishes uploaded, submitted, accepted draft and recorded outcome. Studio missing-evidence action opens a request; Batches opens exact submission alongside property/source context. Scanning/loading persists across reload; empty search permits bounded unresolved submission; bad files retain form state; denied data is non-disclosing; clarification lists the exact fact needed. Mobile file/photo controls obey the same limits. UI owns sheets/focus/navigation; CITIZEN owns content.

## H. Ownership and dependencies

`feat/usp-citizen`, only feature files/tests/migration. F0 enables fixtures; F1-feature enables real local synthetic workflow with explicit test identities; F2/DEPLOY and live scanner are mandatory for public activation. Email outage does not block completion of in-app workflow. UI/FND shared changes are patch requests. Public external records are not required for D0 testing; H1 supplies permitted D5 only for real-data qualification.

## I. Implementation sequence

1. Receive D0 A/B/reviewer and not-listed-space cases; implement explicit states and private ownership checks.
2. Build read-only released projection without resolver synchronization side effects.
3. Add receipt-before-extraction, scanner/hash-bound promotion and crash recovery.
4. Connect accepted draft creation and separate actual commit receipt; inject failures between steps.
5. Add requests, in-app notification/revocation, then optional qualified email.
6. Mount UI and run multi-principal real-service journeys; leave public routes disabled until F2 passes.

## J. Test data and acceptance

**D0 before/after:** A selects B-A/U-A101, uploads a synthetic mixed-page plan, receives clarification and a linked draft. B cannot read A's submission/upload/preview/notification/packet by changing any ID. Officer records through normal review; only then does A see recorded. Test same Flat 101 in B-B, missing ULPIN, absent unit, two-parcel building and incomplete target. A contact-verified email yields no ownership grant.

**D5 after local completion:** attempt one permitted plan/section/related clause from [RERA 2831](https://haryanarera.gov.in/view_project/project_preview_open/2831) or [2079](https://haryanarera.gov.in/view_project/project_preview_open/2079), or an openly licensed public document. These are acquisition leads; previous attachments failed. Preserve matched drawing metadata and de-identify permitted fixture. No sensitive original in public Git. If blocked, continue D0 and report real-source gate unmet, not ask teammates to implement the workflow.

Interrupt before/after final upload receipt, scan, promotion, submission and draft creation. Test unavailable scanner, active content, byte/pixel overflow, same bytes/different intent, hash mismatch, stale target, simultaneous reviewers, withdrawal, clarification resubmission, revoked release and mail acknowledgement loss. Accepted-state rollback must leave no orphan draft/link/event. Public projection must not execute database synchronization. Inspect actual records/receipt IDs, not just mocked status messages.

Run `pnpm typecheck`, `pnpm test:case-document-copy`, `pnpm test:api`; `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-citizen.test.ts`; `pnpm exec tsx tests/usp-citizen-integration.ts`; `pnpm exec playwright test tests/e2e/usp-citizen.spec.ts`. Keep local auth fixtures, real scanner qualification and real deployment tests as separate results. Return sanitized receipts, isolation proofs, recovery/delivery states and screenshots.

## K. Copy-paste assignment

> Implement CITIZEN from 00, 01 and this handoff on feat/usp-citizen. Obtain D0 two-person/reviewer data, attempt permitted D5 only for later real-source testing. Build public-release-only lookup, durable targetless receipts, hash-bound quarantine/promotion, explicit submit/clarify/withdraw/review commands and in-app notifications. FND supplies prepareProposal/commit/identity adapters; UI owns mounts; DEPLOY supplies scanner/mail. Complete the real submission→reviewed draft→separate recorded-receipt path, not fake acceptance. Run J crash/isolation/stale/delivery tests and return commits, pack/receipt evidence, screenshots and separate F2 gates. No direct registry writes, private-source public fallback, ownership-by-email, external activation or main merge without authorization.

## Z. Hardening addendum (H97)

Added 24 September 2026 by the cross-family review in [H97](97-review-findings-and-alignment.md). Where this section conflicts with text above in this file, this section wins. This file is **full_product** (FP-PUBLIC, after GF5 and FP-DEPLOY); "F0/F1-feature/F2" gate names above map to FP-DEPLOY and FP-PUBLIC-TEST. Task card: [H29](29-agent-task-cards.md) FP-PUBLIC-01.

### Z1. DPDP Act 2023 and Aadhaar rules

- Pin a `PrivacyNoticeVersion` and a legal basis (consent or a section 7 legitimate use) to every submission. Show the notice before collection, in English and Hindi at least (Eighth Schedule languages on request).
- Retention table per state: quarantine, rejected, withdrawn, accepted evidence kept under a stated legal obligation. Withdrawn or rejected submissions are erased after the stated period, leaving only a hash tombstone. Test it.
- `POST /me/data-requests` for access, correction and erasure, a published grievance contact, and a breach runbook in [H19](19-india-contained-deployment.md) Z3. No processing of children's data.
- Uploaded deeds carry Aadhaar, PAN, phone numbers and photos. Run the shared redaction module ([H01](01-shared-contracts-and-ownership.md) Z1): mask Aadhaar to the last four digits in every derivative (preview, index, logs, model input), strip EXIF from derivatives, keep the original filename as restricted metadata. D0 fixture: a synthetic deed with a Verhoeff-valid dummy Aadhaar and a GPS-tagged JPEG; neither appears in outputs.

### Z2. Abuse controls

Per-subject and per-target submission quotas (429), a required `relationshipToProperty` with an attestation against false statements, hash and near-duplicate grouping into one review item, an `abusive` reviewer disposition that throttles the subject, and a 403 when submitter, reviewer and recorder are the same person or linked. Subscriptions in v1 cover only the user's own submissions and requests, never another property's dispute activity.

### Z3. Identity and ingress

- Citizen sign-in: MeriPehchaan or DigiLocker OIDC first; OTP over SMS as fallback (needs TRAI DLT registration, a full-product prerequisite in [H90](90-required-human-tasks.md)); no Aadhaar e-KYC unless an approved purpose exists.
- The public ingress allowlists only `/public/*` and the citizen API routes; everything else returns 404 at the proxy. Public sessions use a separate cookie. Test that `/studio/*` and other USP routes return 404 from the public origin.
- Public pages meet GIGW 3.0 and WCAG 2.1 AA, ship English and Hindi, and follow the Portal rules in [the design system](../design-system/README.md).
- Replace the D5 RERA-attachment step with the DATA-02 synthetic redacted deed.
