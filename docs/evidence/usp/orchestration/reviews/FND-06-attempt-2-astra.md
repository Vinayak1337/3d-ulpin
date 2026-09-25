# FND-06 attempt 2 — focused Astra follow-up

**Disposition: one remaining correction required.** Prior P2 is resolved; prior P1 is materially improved but still bypassable for standalone JSON numeric text. No full GF-PRIVACY or independent milestone approval.

- Base `31fcc015c07d0aeff2d98ef12a9b028956d71f3d`; code `ec0a0459d515dca241a9a294c3cf8db3194f864c`; result `55d6c8642f4803e344f863e8e1952ea01c481975`.
- Review branch `review/fnd06-attempt2-astra`; worktree `/Users/vinayak/.codex/worktrees/fnd06-attempt2-astra-review`, created at result pin. Later preview-port changes are outside this review.
- Observed Codex desktop / `gpt-6-astra` / `high`, verified from latest local `turn_context`. Same-family engineering review only.
- Scope: operating guide, prior two findings, their narrow fixes, affected text/provider/package paths and evidence consistency. No implementation or delegation.

## Remaining P1 — standalone JSON numbers skip the new token masker

`apps/web/lib/server/usp/ingest/redact.ts:81–82,103–107`: `redactMessageText` now delegates to `redactDerivative`, but that visitor invokes `maskJsonNumberTokens` only when the text starts with `[` or `{`. A valid standalone JSON number in exponential notation therefore falls through to the lexical `redactPrivateText` patterns; its decoded identifier-sized value remains unchanged. `redactDocumentViews` forwards historic part text to this path at line 92. The same text can survive the shared message boundary; provider access remains independently default-denied.

A focused pure-function probe reused the exact number already present in the retained grounding regression and derived its exponential spelling with `Number(retained).toExponential()`; it did not invent a new identity/source fact. Observed booleans:

- `decimalMasked: true`
- `arrayExponentialMasked: true`
- `scalarStillSameNumber: true`
- `previewStillSameNumber: true`

**Smallest fix:** apply the lexical JSON-number masking before interpreting valid JSON scalar text as well as container text, while preserving ordinary prose and leaving typed domain numeric values alone. Extend the already affected assertion with the retained input's alternate serialization. No new source corpus or broad matrix is necessary. This is a control-flow finding; the historical input establishes no real-person detection accuracy.

## Resolved and preserved behavior

- Prior metadata P2 is resolved in source: `officer-ai.ts:162–168,183` sends apply results through the document-aware package response. Package/feature names, numeric geometry and revisions are no longer traversed by the generic personal-key sanitizer. Document parts/locators plus question/answer prose and warnings are masked. Strict `name` masking remains for untrusted generic objects. This is source confirmation, not a newly executed API apply journey.
- The provider-output part of prior P1 is addressed: `minimizeExtractionOutput` rejects unexpected object fields, retains explicit extraction fields, sanitizes textual fields and permits numbers only under bounded measurement/geometry properties. `boundedPolygon` rejects extra geometry properties and preserves supported coordinates. Subsequent grounding validation remains in place; bounded output is not treated as source truth. Unsupported numeric payloads do not receive a generic pass-through in this new output path.
- The decimal scalar and JSON-container numeric cases from the previous finding are fixed. Typed domain numbers outside untrusted text/provider boundaries remain numeric. Source hashes/originals are not rewritten. No weakening of opt-in/finale veto, opaque/image denial or fixed transport endpoint was found in the correction.
- The three stale grounding expectations now distinguish default denial from explicit opt-in/no-key/catalog behavior and expect image denial while retaining no-tools checks. Historic assertions are regression evidence only.

## Evidence assessment

Reused [attempt-2 report](../../finale/GF-PRIVACY/FND-06/attempt-2/report.md) and its pinned hold receipt/egress log. The receipt identifies code `ec0a0459…`, `STOPPED_INTEGRITY_PASSED`, 44 tables/497 objects, the explicit jobs migration delta and owned cleanup. Egress log agrees with five tripwire installations and one denied development-version lookup. No UI journey is claimed by the hold smoke.

The worker report records grounding 22/22, controls 6/6, corrected typecheck, production build exit 0 and compiled Host probes: SSR 307/403, API 503/403 without services, icon/chunk 200/403. These checks were not rerun. Build/production probe results are recorded narratively in the report; no separate production probe receipt is committed in this evidence directory. The hold receipt's “no production build qualification” limitation applies to that hold run and does not contradict the separately reported build. Canonical API 503 proves neither successful API operation nor full runtime qualification.

The only new execution was the bounded scalar probe: `node --import '<Sol-fix-worktree>/node_modules/tsx/dist/loader.mjs' --input-type=module` with stdin, importing the **review worktree's pinned redactor**, extracting the retained regression number from `tests/ai-extraction/grounding.test.ts`, then comparing its decimal/array/scalar text and document projection. Exit 0; output contained only the booleans above. The existing installed loader was reused read-only; no dependency installation or source fixture file was created.

Permitted real Aadhaar/VID/PAN/mobile accuracy, multilingual/free-prose names, visual PII/EXIF coverage, complete derivative coverage, residency/provider permission, manual product acceptance and independent milestone review remain unqualified. Public-contact/PNG and historical regression results cannot stand in for those requirements.

Cleanup: only this report changed; `git diff --check` passed. No keys, provider requests, services, ports, containers, protected-data changes or production edits. Persistent preview 3187 and temporary 3108 were untouched. Review worktree retained for report integration; no owned running resources. Prior review branches and Sol's worktrees preserved.
