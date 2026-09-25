# Plan governance record contract

`validate_handoffs.py` loads `plan_governance.py`. These checks implement the remaining LEAD-01 governance fields. They validate record consistency and evidence bindings; they do not execute the application or confer runtime qualification.

## Pending state and scheduling

The current manifest deliberately has no approvals, waivers, release candidate, or schedule commitments. Every gate has `scheduleStatus: unscheduled`, null `targetDate` and `fallbackDecisionDate`, null `completedAt` and `approvedBy`, and an empty `blockedBy` array. `releaseCandidate` has `status: pending` and `commit: null`. `projectOwner` is null until a real designation is recorded.

For a scheduled gate, both dates must be real calendar dates in `YYYY-MM-DD` form. The fallback decision date must be no later than the target date. Both dates must increase strictly relative to every dependency's corresponding date; a scheduled dependent gate therefore requires scheduled dependencies. No dates are inferred from the decision date or the system clock.

## Human dependencies

`humanDependencies` contains exactly H90-1 through H90-5, corresponding to the five entries in [H90](../90-required-human-tasks.md). Each entry has `id`, `neededFor` (gate IDs), `status`, `owner`, and `fallback`. Owner is an identity/role string or explicit null while unassigned. The first three entries remain open until resolved. The two optional entries start `not_required`; activating either requires a nonempty `trigger` describing the applicable H90 request.

A gate with status `blocked` must identify an open dependency in `blockedBy`, and that dependency must name the gate in `neededFor`. This records a specific human blocker without making every future human activity a blocker of today's implementation.

A resolved entry needs hash-pinned JSON `evidence` with schema `ulpin-human-dependency/1`, matching `id`, `neededFor`, `owner`, and `status: resolved`, plus UTC `recordedAt`, a nonempty `statement`, and a stable `sourceReference` to the actual human action. Public claims and release-freeze approval still use the approval contract below; resolving H90-3 alone cannot approve a waiver or GF5.

## Attempts and gate evidence

Every test has an `attempts` array. Each entry has a unique `id`, unique `receipt` path, `sha256` of that receipt, and `status: passed|failed`. Executed tests need retained attempts. A current test receipt must identify an attempt with the same status. A failed test must retain its current failure receipt. An attempt with status failed cannot pass a gate.

Runtime attempts retain the existing receipt contract, namespace restrictions, artifact hashes, code ancestry, UTC timestamps, producer settings and distinct receipt reviewer. Failed receipts identify a nonzero command exit or a failed expected/actual case; a command/case that passed cannot be labelled a failure to evade the passing contract. Receipt artifacts remain hash-checked for failed attempts too.

Attempt arrays are append-only against every reachable Git version of the manifest, including merged history. Prior entries cannot be removed, reordered or rewritten, even after the attempted deletion is committed. Validation requires complete Git history. Receipt hashes protect the bytes, and the receipt's artifact hashes protect its outputs. Work that was never recorded or committed cannot be reconstructed by this check.

A complete gate selects retained passed attempts in `evidence` for every nonwaived test. Current statuses for those tests must still be passed. Evidence need not be the test's newest receipt: earlier gates can retain their reviewed runs while GF5 selects new runs at the release candidate. The gate approval binds those exact receipt hashes, tests, waivers and completion timestamp. No unrelated, failed or duplicate receipt can fill a gate's evidence.

## Approvals and owner identity

`approvedBy` is an object containing `identity`, UTC `approvedAt`, and hash-pinned `evidence` (`path`, `sha256`). The evidence is a UTF-8 JSON export with:

- `schemaVersion: ulpin-approval-source/1`;
- the identical `identity`, `decision: approved`, and `recordedAt` equal to `approvedAt`;
- `subjectSha256`, computed by `plan_governance.digest(subject)`;
- a nonempty explicit `statement` and a stable `sourceReference` to the actual review or human decision.

An identity has a nonempty `id` and `kind: human|agent`. Agent identities also carry observed `product`, `model`, `modelFamily` and `effort`. For cross-family approval, the validator derives OpenAI, Anthropic or Google from recognized model names and compares against every runtime producer. A claimed family label cannot turn GPT/Sol versus GPT/Astra into independent model families. Unknown models need an explicit code update to the family resolver or a human review. An approver cannot be a producer of any selected receipt.

GF0–GF4 permit an independent cross-family agent or a human. GF5 and all waivers require a human with `role: owner` whose identity matches `projectOwner.id`. An all-waived gate has no runtime producer family and therefore requires a human gate review.

A nonnull `projectOwner` carries `id` and hash-pinned `evidence`. The JSON designation has schema `ulpin-owner-designation/1`, matching `ownerId`, `role: owner`, UTC `recordedAt`, a nonempty explicit `statement` and a stable `sourceReference`. Owner approval cannot predate that designation.

For a gate, the approved subject contains `gate`, ordered `tests`, ordered `evidence` path/hash pins, applicable ordered `waivers` including their approvals, `completedAt`, and `releaseCandidate` (the RC SHA only for GF5; null otherwise). Approval must follow all selected execution/review times and waiver approvals; completion must follow approval and dependency completion. Future timestamps fail. Changing any bound field invalidates the approval evidence until the actual reviewer approves the changed subject.

These records are hashed, not authenticated signatures. A hash detects changed bytes; it cannot prove that a purported human or remote agent authored an export. The lead/human review must check the real source reference and identity. The validator never generates owner designation or approval sources. None are supplied by this implementation. Execution authenticity remains the separate FND-05 workstream.

## Waivers

A waiver has `test`, `gate`, explicit `reason`, `approvedBy`, and nonempty `claimRemovedFrom`. Each removed-claim entry has the exact nonempty `claim` text, a hash-pinned `before` text snapshot containing that claim, and a distinct hash-pinned `after` path naming the current claim document from which the text is absent. Both paths are repository-local UTF-8 files. Changes to the current document invalidate its hash and the approval binding.

The approved waiver subject contains exactly `test`, `gate`, `reason` and `claimRemovedFrom`. The owner approves this whole subject. The validator checks the identified documents; the owner/source review must establish that these are the relevant public claims and that the removal is sufficient. It cannot discover every public claim outside the repository.

Waivers are scoped to one test and one gate. A waived test stays planned, blocked or failed with its failures retained; it is never relabelled passed. To use a waiver at another gate, that gate needs its own explicit owner decision. There are no real waivers in the manifest.

## Release candidate and fresh validation

A pinned `releaseCandidate.commit` must be a full 40-character SHA and a verified ancestor of HEAD. Every GF5 selected receipt must use that exact SHA and run strictly after GF4's evidenced completion. GF4's own receipts, approval and chronology are also validated; a status flag or timestamp alone is insufficient. GF5 completion requires a pinned RC, evidenced GF4 completion and owner approval, including when waivers are present.

`planValidation` remains a documentation/validator result. Its JSON receipt pins the code commit, UTC check time and `filesSha256` of the manifest, every active Markdown input/entry point, and every Python file under this tools directory. A new helper or test file must be covered, and every checked Python source must match the bytes stored at the pinned code commit. Old receipts remain historical records and are never overwritten to simulate freshness.

The unit suite uses isolated plan metadata, approval exports and receipt metadata. The preexisting receipt helper is retained; these records are not operational datasets, accuracy oracles, application evidence, public claim approval, or a real gate pass.
