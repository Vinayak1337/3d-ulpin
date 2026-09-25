# FND-06 attempt 1 — Astra risk review

**Decision: corrections required before integration.** Two source-confirmed defects below; no completed GF-PRIVACY or independent milestone approval.

- Base: `4eef5a535b9d7e8940401d20a67c578188a31ea0`; code: `66e3dffb9c653d52a13b8ee2046f3c72b550f587`; reviewed result: `bc115d2bc4815a2d91b7a44a286a0ed48c75cfd3`.
- Review branch: `review/fnd06-attempt1-astra`; worktree: `/Users/vinayak/.codex/worktrees/fnd06-astra-review`.
- Observed agent: Codex desktop / `gpt-6-astra` / `high`, verified from this task's local `turn_context` metadata (`01a0da57-0bf3-7783-bfdb-5bf063998b3b`). Same GPT family, **not independent milestone approval**.
- Scope: operating guide; H29 FND-06, H14 Z2, H19 Z1/Z4; actual redaction, provider and Host paths. Original worker checkout verified clean at the result pin. No implementation, recursive delegation or UI03 review.

## Blocking findings

### P1 — JSON numeric tokens bypass text redaction

`apps/web/lib/server/usp/ingest/redact.ts:50–52,73–84` parses JSON before masking and returns numeric leaves unchanged. Consequently, a historic document part consisting of an identifier-shaped numeric token is returned unchanged by `redactDocumentViews` (line 62). New native text documents also accept JSON arrays/objects on a line (`services/geo/geo/area.py:536–546`): numeric personal identifiers in arrays or under an unrecognized column key bypass `areas.extractDocument`'s sanitizer. The same parsed-output path retains arbitrary numeric leaves in the provider `raw.output` derivative (`officer-ai-provider.ts:88–92`, persisted by `officer-ai.ts:54–55`). Recognized personal keys are protected; string patterns alone do not protect these numeric leaves.

This is a control-flow defect independent of missing real-identity accuracy evidence. No fabricated identifier, document or provider response was generated to demonstrate it. Current `extractionMessages` source excerpts receive `redactPrivateText` first, so this finding does **not** assert that ordinary selected-part input currently leaks through that path. The shared `callNous` boundary nevertheless also uses the parse-first function (line 73).

**Smallest fix:** preserve pattern masking at document/message *text* boundaries regardless of JSON syntax; apply typed minimization to retained provider output so unapproved numeric payloads cannot survive. Preserve authorized measurements/coordinates in typed domain records rather than indiscriminately masking all numbers across the application. Verify with permitted official numeric coverage when available; missing cases remain unqualified.

### P2 — AI apply response corrupts nonpersonal package metadata

`apps/web/lib/server/officer-ai.ts:160,174` applies `redactDerivative` to the entire `ImportPackage` returned by `applyRun`. Its unconditional personal key `name` (`redact.ts:25,82`) replaces package and feature names, and any nested technical `name` metadata, with the personal-field marker. These are contract fields (`packages/contracts/src/area.ts:85,213–239`), not inherently personal identities. Applying valid suggestions therefore returns a different package representation from the normal package GET, even when every name is nonpersonal. DB package contents are not rewritten by this response sanitizer. The current AssistancePanel discards the apply response and refetches (lines 289–293), limiting visible UI impact; API consumers still receive the corrupted response.

**Smallest fix:** use a typed package response boundary that preserves record/geometry metadata and sanitizes actual document/personal fields, or an explicit acknowledgement followed by the canonical package read with a deliberate contract update. Keep strict personal-key masking for untrusted document/provider objects. Do not remove `name` protection globally.

## Other triage and bounded acceptance

- Provider policy precedes key access/network in `inspectNous` and `callNous`; exact opt-in and finale veto are explicit. Image selection is denied before original/crop access, and historic AI crop previews are denied. These are intentional safe unavailability, not regressions requiring re-enablement. Fixed endpoint, redirect rejection, generic transport/API errors and hashed upstream envelopes reduce egress/log exposure.
- Host parsing checks raw authority before URL normalization, accepts only canonical loopback hosts/configured ports, ignores forwarding headers for authorization, and Proxy has no path exclusions; API principal repeats the check. Existing Origin protection remains separate. No additional Host defect found in this bounded review.
- Lead-reported retained grounding results are 19 pass / 3 fail. Source inspection confirms obsolete expectations at `tests/ai-extraction/grounding.test.ts:58–76`: tests must explicitly select default-blocked versus opted-in/no-key/catalog behavior, and assert image denial. Preserve no-network/no-tools assertions. Correct these directly affected tests before acceptance; do not weaken policy to restore old behavior. This review did not rerun the historical synthetic corpus.

## Evidence, production check and limits

Reused the pinned [implementation report](../../finale/GF-PRIVACY/FND-06/attempt-1/report.md), verification record and final `local-f241696bc6e812f7/runner-receipt.json`: six control tests/typecheck passed; development HTTP evidence covers 26 denied forged Hosts and three canonical authorities, including compiled/public assets; fetch tripwire reports zero dispatched non-loopback/provider fetches. Integrity receipts record 44 tables/497 objects, the explicit jobs migration delta, and unchanged post-browser originals. These are existing worker receipts, not freshly repeated review tests.

Source review suffices to request the fixes; no additional runtime check was needed to resolve these findings. No production build/start was run. Build-guard success is only a prerequisite. Before claiming production Host enforcement, run a focused guarded production build/start on the corrected pin and exercise one SSR route, API, public asset and emitted chunk with canonical/forged Host; no database restore or broad UI matrix is needed for that boundary. Production qualification remains pending, without making a full production rehearsal a prerequisite for this source-review decision.

Public institutional email and official PNG metadata evidence do not qualify Aadhaar/VID/PAN/mobile, free-prose/multilingual names, visual PII or EXIF-bearing inputs. No machine-wide firewall, full-product derivative coverage, physical India residency, live provider permission or independent milestone qualification is established.

Review actions: Git pin/status/diff and targeted source/receipt reads only; report `git diff --check` passed. No keys read, provider requests, new source data, tests, services, containers, ports or dependencies. Only this report changed; original checkout, worker checkout and shared staged edits were untouched. Review worktree retained for report integration; no owned running resources to clean up.
