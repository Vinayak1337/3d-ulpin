# FND-06 attempt 3 — scalar correction closure

**Bounded acceptance: the remaining standalone-exponent text finding is resolved. No actionable defect found in this correction.** This closes the specific attempt-2 finding, not the full GF-PRIVACY qualification.

- Base: `b09e1b4c870480cb9b21ced568159a68552a67f4`.
- Reviewed code: `727e506064321dff76ba72c7374fd68d22cf2b5a`; result: `027471bda3d2a35eb70b82e1372b138e80b64cf0`.
- Report branch/worktree: `review/fnd06-attempt3-astra`, `/Users/vinayak/.codex/worktrees/fnd06-attempt3-astra-review`, created at the result pin.
- Requested and observed: Codex desktop / `gpt-6-astra` / `medium`, verified from latest local `turn_context`. Same-family engineering check only, not independent milestone approval.

Read the operating guide and reviewed only the two-file correction plus its evidence. At `apps/web/lib/server/usp/ingest/redact.ts:103–105`, the string visitor now recognizes a complete JSON number token, including exponent notation, and runs the existing lexical number masker before parsing. Both message text and historic document projection therefore reach the same masking path for the previously bypassed scalar. Array/object behavior is unchanged. The condition remains inside `typeof input === 'string'`; ordinary typed domain numbers still reach the unchanged numeric return path. No blanket numeric-field masking was added.

The existing grounding test now derives exponential spelling from its retained historical input and asserts the corrected message and document-preview behavior (`tests/ai-extraction/grounding.test.ts:52–54`). Reused the [worker evidence](../../finale/GF-PRIVACY/FND-06/attempt-3/report.md): grounding 22/22, typecheck and diff-check passed. No suite or probe was repeated. The result commit adds only its report. Historical regression evidence does not qualify real-identity detection; permitted official PII cases and the broader privacy/residency/manual/independent-review qualifications remain open.

Only this report changed; review `git diff --check` passed. No implementation, fixtures, installations, keys, provider requests, services, ports, containers or data mutations. Existing worktrees/edits and persistent preview `http://127.0.0.1:3187` were untouched; its served revision was not inspected or changed. Report worktree retained for integration; no owned running resources.
