# PACK1-PDF-05 — accepted crop recovery

Code: `1b89df260844dfcc63f44ccd635639cf340e9d2a`, based on clean publication `2201f51f4d5c4e639f45eb288e235fa85bc2ad4d`. Exclusive branch `task/desktop-packet-pdf-entry-recovery` in `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`; staging remains read-only. Completed queued-execution branch/checkpoint `dab71216` is preserved.

## Delivered

Queued execution now accepts private immutable crop checkpoints and reuses them on an exact authorized retry or expired-owner recovery. Identity binds the canonical job/input, immutable plan/version/hash/confirmation, ordered entry/binding, target/snapshot, original/source revision, validation/recipe, actor/access/policy and output bytes/hash. The existing independent worker owns this flow; no new queue or public cache API.

Each crop is extracted or read, bounded and verified outside SQL. Complete current plan/source/target authorization and the canonical owned attempt are recaptured around I/O. A short fenced transaction accepts the immutable checkpoint; historical acceptance remains linked to its original attempt even after later failure/expiry. Reuse additionally checks current recipe authority and exact clean PNG bytes. Partial crop acceptance never makes a packet ready. Final all-required packet/execution/command/outbox/job publication remains atomic; synchronous behavior and existing recipe/receipt/plan hashes are unchanged. Unaccepted work may repeat.

**Lead migration work:** register `database/sql/60-usp/20-packet-pdf-entry-checkpoints-schema.sql` through the existing manifest/runner. It adds only `usp_packet_pdf_entry_checkpoints`, with bounded immutable receipts, unique job/entry and object keys, plan and canonical attempt/fence references, and an update/delete rejection trigger. No runner/manifest or live database was changed. Missing table returns `PACKET_PDF_CHECKPOINT_UNAVAILABLE` before crop I/O; synchronous preflight/execution remains usable. Existing worker status exposes that bounded error code.

The optional internal `PdfPacketIo.recipe(sourceId,deadlineAt)` supplies current recipe authority for checkpoint use. The real adapter verifies the configured frozen region profile; it never treats a historical checkpoint recipe as current merely because the bytes match. Existing synchronous callers need no new field.

## Actual controlled recovery

Evidence: `E:/BhuAayam-data/task-data/desktop-packet-pdf-entry-recovery-20261003/complete-flow/flow.json` and `packet.pdf`. The genuine first selected section/elevation crop is accepted under attempt/fence **1/1**; later plan/area extraction fails with no ready packet. Retry retains that exact first receipt and accepts the remaining crop under **2/2**. Extraction attempts are first crop once, later crop twice; crop writes total two, packet writes one.

| Entry | Accepted attempt/fence | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| 0: section/elevation | 1/1, unchanged on retry | 178,236 | `4d633411722112b4c003b5d7c67c0a9619210df911f38b9b4ef33a5c8615de3f` |
| 1: plan/area | 2/2 | 123,120 | `b9b6b487ac309582dc79fa03b2651e0698c5f68f8b6eb4fb27f632b658266d7c` |

Resumed PDF: **337,862 bytes**, SHA-256 `cda69b79c3aeccac153b624bb70cb62add81889e7add54a323e0426feb638172`, byte-identical to the preceding accepted packet. Exact RGB/order inspection passes with no text/annotations/links/attachments/forms; both fresh Poppler PNGs equal the previously visually inspected pages byte-for-byte. No native extraction rerun.

## Verification and limits

- Three targeted recovery controls pass: later failure/reuse; full-set revocation, recipe drift and corrupt bytes; missing migration, expired checkpoint acceptance and unknown entry COMMIT/recovery. Unknown outcomes preserve staged bytes and possible committed checkpoints; obsolete attempts cannot accept them.
- Three existing queue controls pass. The later PDF compatibility command observed **all 15 PDF flow controls passing, zero skips** (including old single-/same-/multiple-original, card/read/replay and queue checks). Its negative-prefix filter did not narrow the runner's observed scope; no further campaign was run.
- `pnpm typecheck:backend` and `git diff --check` exit 0. The saved one-flow recovery check passes. Logs and exact commands are in the receipt; unset saving variables on reruns because outputs use exclusive creation.

Immutable receipt: `completion-1b89df26.json`, **46,582 bytes**, SHA-256 `b870524efbeacce5a744355d52a3f5425389636f9fbc0f3964897c5badbb7f73`. It pins five owned files, 24 protected files, 16 evidence files and 23 preserved source/crop/profile/prior proof files. Its open writer log is excluded.

SQL/storage/extractor/current-recipe/target/applicability/snapshot authority are explicitly controlled. The retained crops have distinct historical recipe profiles (`e644a74b…`, `0640acb3…`); per-source current recipe authority is controlled in this journey. Real reuse requires the configured current profile to match exactly and refuses incompatible old profiles. No current HTTP/PostgreSQL/private persistence, migration application, authentic applicability/approved revision, source-specific rights, geometry/learning, scale/performance or GF4/release qualification follows.

Bounds remain 35 seconds overall, existing child/cleanup limits, 2–4 ordered pages, 32 MiB PDF/distinct originals, 48M crop pixels and 16 MiB per original; each checkpoint PNG stays within the existing 8 MiB region cap and its private receipt within 64 KiB. No source/profile/runtime changes, cleanup/reset, services/listeners/Docker/parser/provider/GPU/dependency/environment/frontend work, push or deployment. Generic jobs/dispatcher/db/storage/config, registry writers and migration registration remain unchanged. Requested Sol6.1/xhigh/default-standard; actual per-turn settings are unexposed. Supplied `never` / `danger-full-access` verified from active instructions.

## Lead integration, 3 October

Accepted as `e4c8f765` / `16d078ac`; completion and 68 physical/supplied Git pins match. Three integrated recovery controls pass, zero skips, using `pnpm exec tsx --test --test-name-pattern='PDF entry recovery' tests/usp-packet-pdf.test.ts`. Backend/client types and API validation pass; unchanged 258 operations/294 schemas. Lead registered `usp_packet_pdf_entry_checkpoints_001` in `migrateUsp` and the SQL manifest with bounded immutable schema and check/mark steps; no database application. Existing SQL audit admits this exact authored task. Hash/provenance checks pass; full static audit stops on the pre-existing ignored directory `infra/postgres/001-extensions.sql` (left unchanged). Separate exact USP query-ID/order check passes all 20 calls. No current migration/persistence qualification is inferred.
