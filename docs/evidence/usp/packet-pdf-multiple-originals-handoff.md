# PACK1-PDF-03 — required regions from multiple PDF originals

3 October 2026. [Assignment](../../orchestration/PARALLEL_20261003.md#next-independent-implementation--pack1-pdf-03-multiple-originals). Exclusive checkout `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`, branch `task/desktop-packet-pdf-multiple-originals`, base/read-only staging observation `1d90fd65e0b1ed71382b1d69be8a5e529d1b57f8`. Code commit **`00ed3ca77bb59d98d9afec546604c216244165cb`**.

## Delivered flow

`pack1-multiple-original-region-image/1`, assembly `packet-pdf-assembly/3` and receipt `packet-pdf/3` add 2–4 required committed PDF regions from at least two canonical `sourceId` originals, for one exact target/snapshot and `record_evidence` purpose. Per-entry originals, bindings, page/frame/selection/renderer/output pins and operator order remain explicit. Repeated selections from one source must retain identical full original pins; aggregate bytes count each distinct source once. Unresolved bindings produce a blocked plan; a fully resolved set must contain at least two originals.

Existing create → revise → confirm → execute → private read/replay → card services accept the new variant. Source/case/target protection covers the complete selected set in canonical lock order, with current authorization before and after I/O. No SQL lock spans crops, PDF assembly or storage. Every crop is checked against its own original authority. Publication atomically links the packet, execution, command receipt and outbox; denied publication leaves no ready row and preserves the unreferenced derivative. Download and replay reauthorize every selected source.

Bounds stay **2–4 pages, 32 MiB PDF, 48M cumulative crop pixels, 16 MiB per original, 35 seconds overall**, with existing stricter child limits. New aggregate distinct-original limit: **32 MiB before extraction**. Crops are sequential and image assembly incremental. No optional entry, inferred applicability, whole-document fallback, image-source extension or public release.

## Actual retained-source result

External evidence root: `E:/BhuAayam-data/task-data/desktop-packet-pdf-multiple-originals-20261003`.

- First original/crop reused unchanged: Haryana T3 plan/area drawing, **1,655,334 bytes**, original SHA256 `2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865`; **795 × 405 RGB** crop SHA256 `b9b6b487ac309582dc79fa03b2651e0698c5f68f8b6eb4fb27f632b658266d7c`.
- One authorized production extraction from the second retained original: T3 section/elevation drawing, **2,448,909 bytes**, original SHA256 `f0dc0d56b786b8dccf55ca7055e6b79af8545b53212a9056c755ec1c82fad62b`. Actual page 1, rotation 0, **2545 × 2590 points**, selected displayed points **`[2180,2405,2525,2570]`**. Result **1035 × 495 RGB / 178,236 bytes**, crop SHA256 `4d633411722112b4c003b5d7c67c0a9619210df911f38b9b4ef33a5c8615de3f`.
- Fresh inventory is byte-identical to the accepted native-continuation profile: **`0640acb3a81dce48bb70577c5a3d71c1e0c3afe2701ccbe4f66f5558ca595760`**, 1,285 files / 117,788,118 asset bytes, zero drift/changes/removals. Extraction script **exit 0**, **3,729 ms including saved evidence/post-inventory**; saved journey elapsed 3,510 ms. Production cleanup succeeded and this attempt's scratch is empty. No retry, runtime/dependency/cache repair or cap change.
- Actual `complete-flow/packet.pdf`: **337,862 bytes**, SHA256 **`cda69b79c3aeccac153b624bb70cb62add81889e7add54a323e0426feb638172`**, two pages / **834,300 crop pixels**, 4,104,243 aggregate original bytes. Operator order: section/elevation crop, then plan/area crop. `flow.json` retains exact plan/confirmation/execution/card linkage; `denials.json` records controlled second-source revocation boundaries.

## Lean verification and review

- Two focused new method checks: **exit 0, two pass, zero skips**. One complete blocked/revise/confirm/execute/read/replay/card flow uses genuine crops from distinct originals. Second-source denial before extraction, after staging and after read blocks publication/disclosure/replay; no execution/outbox/ready rows survive denied staging.
- `pnpm typecheck:backend`: **exit 0**, server and API. Initial **exit 2** was a Zod `safeExtend` literal-type incompatibility; fixed with an explicit strict new receipt schema retaining ordered/distinct binding validation. Failure log preserved.
- `pnpm exec tsx --test tests/usp-packet-pdf.test.ts tests/usp-packet-plans.test.ts tests/usp-property-card.test.ts`: **exit 0, 24 pass, zero skips**, with `ULPIN_PACKET_MULTI_SECOND_ROOT` selecting accepted genuine same-original crops and output-saving variables unset. Existing single-region exact hash remains `452c606114d5d8b7f24694695cfaedb6859225ca7855a57c0a0f2f5462ccc273`.
- Read-only current leaf assembly comparison: **exit 0**. Old same-original bytes/manifest remain exactly equal to the accepted **325,018-byte / `5d4e10fa66e9ee5f8817b93766b9c179a2e9c7a2e00d8020ef05f608e2f33344`** PDF; new assembly also reproduces its saved bytes/manifest exactly. Initial Windows ESM verifier import failure is preserved separately; corrected file-URL verifier passes. No new native execution or PDF export.
- Bundled Poppler page rendering and read-only Python inspection: **exit 0**. Both rendered pages inspected and readable within the explicit selection bounds. Each paints exactly one RGB image, byte-equal to its corresponding crop, at the expected page dimensions. Zero text/annotations/links/attachments/forms; fixed generic metadata.
- Changed-code review and `git diff --cached --check` pass. Only the six owned code/test files changed. Native/region/registry writers and protected shared/source seams remain unchanged from base.

Immutable final completion: **`completion-00ed3ca7-v2.json`**, **25,546 bytes**, SHA256 **`d67109fad9f27e21c42c97fae9da8e1812db96ed29339483c6ff7c5f58c5710f`**. It pins six owned files, 13 unchanged protected files, 36 external evidence files and eight preserved originals/prior proofs, plus the full frozen profile. An earlier completion pinned its still-open writer log at zero bytes; it remains preserved as history and the final revision pins the closed evidence correctly. Receipt freezes code before this documentation-only handoff.

## Scope and qualifications

Original issuing URLs, attribution and permission/approved-revision limits remain in the [association source manifest](association-sources/manifest.json). Both planned drawings are development evidence; no new acquisition, authentic property crosswalk, applicable target, ownership or learning label is inferred. Source-specific reuse/redistribution/ML permissions remain unconfirmed. Earlier failed native scratch/`PACKET_REGION_CLEANUP_UNRESOLVED` history and reused-first-pixel proof remain unchanged.

The delivered result qualifies actual multiple-original crop assembly through a **controlled method journey**. Target, binding/applicability, snapshot, SQL/storage and extraction transport authority are explicit controls; the new native second-original crop itself is genuine. **Current HTTP/PostgreSQL/private persistence, authentic applicability, rights/geometry/learning, scale/performance, GF4 and release remain unqualified.** API/client/catalogue/ledger publication and integration belong to the lead.

Supplied permissions: never/danger-full-access. Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier unexposed. No staging/frontend edit, services/Docker, providers/ML/GPU, runtime/config/cache change, push/deploy, new worker, task polling or schedule. Return code/handoff commits and the final completion pin through the standing authorized lead callback, then end.
