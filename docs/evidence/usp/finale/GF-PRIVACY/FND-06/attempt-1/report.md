# FND-06 attempt 1 — privacy, egress and Host controls

## Result

Implementation and bounded local verification delivered. **This is not a complete GF-PRIVACY accuracy or residency qualification.** Permitted real identity cases and independent milestone review remain outstanding.

- Branch: `agent/FND-06-privacy-egress`.
- Assigned base: `4eef5a535b9d7e8940401d20a67c578188a31ea0`.
- Final code: `66e3dffb9c653d52a13b8ee2046f3c72b550f587`.
- Worker: `01a0d5d3-c8dd-7472-8ea4-4decef30f0c7`, local host.
- Actual agent: Codex desktop / `gpt-6-astra` / `high`, verified from latest local `turn_context` metadata. Serial execution; no subagents. This worker is not an independent review family.
- Final isolated receipt: [local-f241696bc6e812f7](local-f241696bc6e812f7/runner-receipt.json).

## Changes and producer/consumer coverage

| Boundary | Implementation and coverage |
| --- | --- |
| Shared text redaction | `usp/ingest/redact.ts`: Verhoeff check, last-four masking for matching 12-digit Aadhaar candidates, full masking for other 12-digit identifiers, VID/PAN/Indian mobile/email and labelled personal fields. Obfuscated government email syntax is covered. Structured fields and nested JSON text are sanitized. Explicit null/unknown/absent/withheld/conflicting values are retained. This is pattern-based minimization, not universal anonymization. |
| Provider input | `officer-ai.ts` selects explicit part fields. `extractionMessages` limits parts, excerpts and context fields instead of spreading source metadata or sending all current facts. `callNous` reapplies redaction, rejects multimodal/opaque image messages and enforces policy before reading the key or making a request. Original source and part hashes remain original hashes. Prompt version changes invalidate the old matching cache path. |
| Provider output/errors | Parsed output is sanitized before validation/storage. Upstream envelopes are replaced by sanitized output plus a hash receipt. Unknown response IDs, quota/reset headers and envelope fields are not retained. Transport/catalog errors do not return upstream text. Budget limits, call receipts and existing run authority are retained. No competing gateway, queue, registry or transaction authority was created. |
| New document previews | `areas.extractDocument` sanitizes native extracted text/warnings before both package attachment and `source-cases` reference-part storage. Native originals are still written through the existing original-storage path. |
| Historical previews/index inputs | Area/officer JSON response boundaries sanitize `parts`/`referenceParts`; `domain.sourceFrom` does the same for inspection views. Stored revisions are not rewritten. Non-plain metadata objects such as `Date` remain intact. No separate text search index was found in the inspected officer document path; downstream consumers of these document previews receive masked text. |
| AI run persistence and views | `saveRun` sanitizes stored run/output derivatives; run JSON and historic run reads are sanitized. Historic crop bytes are retained in storage but their preview route returns 403, since a stored hash does not establish visual privacy clearance. |
| Image source/derivative path | Nonempty image selection fails before original reads or crop-processor requests, including when the operator checkbox is true. Provider catalog capabilities report image unavailable. Native crop processing uses a fresh RGB pixel buffer before PNG encoding, removing inherited metadata. Its receipt explicitly says visual redaction is unqualified. EXIF stripping is not visual PII masking. |
| App error/log path | AppError message/details pass the shared sanitizer. The generic API failure log records only its generated request ID, without untrusted error names/bodies. Existing static DB/original-retention warnings were inspected; no prompt logging was added. |
| Provider policy/status | Nous is ignored unless `ULPIN_ALLOW_NON_INDIA_PROVIDER` is exactly `1`; `ULPIN_RELEASE_PROFILE=finale_v1` also vetoes it. Default/example and isolated finale profiles do not opt in. Catalog status has no configured/free/image claim when blocked. Native preparation remains available. |
| Shell | `/workspace-capabilities` reports configuration without a provider call. Copy separates loopback service addresses, optional provider access and unverified physical/full residency. Unknown/unavailable states are explicit. Existing light-only Shell, tokens, Phosphor icon and shared resource hook remain in use. |
| Request entry | Installed Next **16.3.5** Proxy documentation was read. `proxy.ts` has no matcher exclusions, covering SSR, APIs, image optimization and public/compiled static assets. It parses canonical loopback authorities and configured ports; malformed/suffix/alternate-IP forms fail closed. The API principal repeats Host protection. Forwarded headers cannot grant Host permission. Existing Origin checks remain separate. |

## Executed verification

Detailed commands/exits are in [verification.json](verification.json); code hashes are in [code-hashes.json](code-hashes.json).

- Six focused configuration, transport and short-checksum-arithmetic tests passed. No dummy identity/document/image records or generated 12-digit identifiers were used. Blocked, finale-vetoed and no-key paths made zero fetch calls; the opted-in route used only an injected fake transport.
- Typecheck passed, including after restoring generated `next-env.d.ts`. Python compile, syntax checks, `git diff --check` and the UI design scanner passed. Historical synthetic source suites were not rerun as privacy qualification.
- The final HTTP/browser run denied **26 forged-Host requests** across SSR, API, public CSS, image optimization and an actual compiled Next chunk. Three canonical authorities (`localhost`, `127.0.0.1`, `[::1]`) passed. Forwarded-host manipulation did not bypass the guard.
- The active Shell displayed blocked optional AI and unverified residency. Dark OS preference still produced the light Shell; reduced viewport equivalent to 200% zoom preserved readable copy and keyboard Escape. This is not a full accessibility audit.
- Fetch tripwire installed in eight Next processes: **zero provider attempts, zero non-loopback fetches dispatched**. One Next development-version lookup was blocked. Installed `next/dist/server/dev/hot-reloader-shared-utils.js` identifies that registry lookup; it was not silently allowed or counted as a provider request. Browser external-request count was zero. This fetch-scoped rehearsal is not a machine-wide firewall proof.
- In a network-disabled, read-only container, the locked native dependencies (Pillow 11.2.1, Shapely 2.0.7) stripped three metadata keys from an unchanged official PNG. Output contained only IHDR/IDAT/IEND chunks; the original hash remained unchanged. The source had **zero EXIF entries**, so an EXIF-bearing real case is still unqualified.

### Official unchanged sources

Discovery started with [data.gov.in Connect with us](https://www.data.gov.in/connect-with-us/). The browser retrieval timed out; a subsequent ordinary HTTPS retrieval returned 200. The page visibly carries the Government Open Data License–India notice. Only its published institutional contact was used, through deterministic text/preview/response checks and fake transport; no private operational identity or model training/inference was used.

- HTML: 1,018,545 bytes; SHA-256 `9e89cc4b8633f2156e6518ef5db9e5dc3e480e498e0c0cebb47f1edced4b690f`.
- Linked [official NIC PNG](https://www.data.gov.in/_nuxt/img/logo-nic.bd517ce.png): 4,478 bytes; SHA-256 `11d6143dddceb1af3e5f9786bce2227abd5242e74875b8fcb8ab23eb1752c212`.
- Original files remain outside Git under `/Users/vinayak/.codex/task-data/ulpin-fnd-06/`. Only hashes/counts and test receipts are committed. No contact values or image republications are in this evidence.
- [UIDAI's masked-Aadhaar description](https://uidai.gov.in/en/my-aadhaar) supports the last-four display convention; it is not a real-identity test fixture.

See [official-source-check.json](official-source-check.json) and [native-image-check.json](native-image-check.json).

## Integrity, failures and cleanup

The runner reused the recorded historical repository snapshot, not a newly manufactured source case: dump SHA-256 `92cbdeb930c7b20f9a90f7857f92787ebe2562c65892ad835a758bdf1b6cfda8`, 44 tables, 497 objects and manifest-bound scene assets. Exact restore checks passed. Existing additive migration/replay changed only the recorded jobs-table digest; post-browser tables matched that migrated baseline and all object hashes matched. No original/dataset/env/volume in the linked environment was overwritten, reseeded or removed.

Earlier failed runs remain recorded:

1. `local-8fb5578451e8c624`: duplicated verification preload stopped Next before readiness; corrected launch arguments.
2. `local-d155087ea07d6420`: preview sanitizer mishandled `Date`, causing workspace sorting failure; fixed and added a focused regression check.
3. `local-e9f9fa92f32f85b9`: application/browser checks passed, but an overly broad zero-attempt assertion counted Next's blocked version lookup; classified the known denied lookup without enabling egress.

The first native-container check failed because PYTHONPATH did not include the mounted package; rerunning with `/app` passed against the locked image. None of these failures is represented as a pass.

All four nonce-owned Compose projects and volumes and both metadata-check containers were removed. Port 3108 is closed. Only this task's generated Next type-path change was restored. Other services and the original checkout's staged changes were untouched. Build guard was observed passing because port 3000 was already absent; no production build, push, merge, public activation or deployment occurred. See [cleanup-check.json](cleanup-check.json).

## Remaining qualification and review

- Permitted real Aadhaar positive/negative, VID, PAN and Indian-mobile cases; EXIF-bearing official images; broad free-prose/multilingual names and visual PII. Pattern code and a public institutional contact do not establish those accuracy claims.
- Images intentionally remain unavailable for AI egress/AI crop previews until visual privacy qualification exists. Authorized retained-original inspection remains on its existing path.
- Existing private historic DB payloads were not purged. Non-document GIS/registry/spatial-model derivatives and future PACK/ASSIST producers were not claimed as comprehensively qualified by this bounded officer-path patch; new consumers must adopt the shared module and receive their own review.
- Host protection does not establish authentication, CSRF protection, complete egress controls or physical India residency. Source/storage/provider permission and application residency remain separate qualifications. No live provider keys, billing, account balances, calls or model permissions were tested.
- Production behavior/build and independent model-family or human milestone review remain pending. Lead review should treat this as a bounded implementation delivery, not a completed privacy runtime gate.

## UI design check

**Blocking:** none found in the changed Shell slot. **Design system:** no findings in the bounded copy/icon change. **Checked, no issue:** existing light tokens, shared Phosphor wrapper, live capability-derived copy, explicit unknown/unavailable state and keyboard close. Scanner exit 0; only its temporary root resolver was adjusted for this worktree, with scanner rules unchanged. No redesign or unrelated UI changes were made.

Fresh screenshots: [desktop](local-f241696bc6e812f7/screenshots/workspace-processing-status.png), [200% viewport equivalent](local-f241696bc6e812f7/screenshots/workspace-processing-200-percent.png).
