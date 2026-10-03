# LINK-IMAGE-01 — officer-selected original image citations

3 October 2026. Code **`bd8af0e7736ef701d26739307f3dc1ef2b51f838`**, based on clean publication `9cb1a398dc61f728545a6e2b9ce48383f8faef45`; branch `task/desktop-reviewed-image-regions`, exclusive `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Completed image-region branch `task/desktop-packet-image-region@52bd5a97` is preserved. Staging remained read-only.

## Delivered existing workflow

Existing private `POST /api/v1/registry-drafts/{draftId}/document-citations` now supports `addImageRegion: {document, region, purpose:"record_evidence"}` for one existing **building or floor correction**. `document` pins exact source/case IDs and revisions, original SHA/bytes; `region` is the acknowledged oriented-original pixel selection from the accepted image-region service. `registry-image-region-citation/1` is a distinct variant: no PDF page, job, result, input, reader or fence pins are fabricated. Caller validation, mixed additions and space/automatic matching are unsupported.

The server captures a read-only draft/target/original preflight, closes it, prepares the crop with `PacketImageRegionService`, then enters the existing bounded canonical amendment transaction. Preparation uses the guarded original-backed crop service outside mutation locks; server-only typed validation is accepted only after exact request/draft/target/source recapture. The original remains retained independently. No raw pixels, private object keys, arbitrary EXIF/text or caller proof are stored in the registry.

Source-only image variants participate in existing complete source-case discovery and sorted early case gates/rows before destination/recording locks. Exact current source family, site, canonical original/subject/access, original frame/selection, transform, display profile, validation hash, historical target body/revision and officer attribution are checked during addition, idempotent replay, private read, canonical review persistence and commit/replay. Case/source protection and final aggregate recapture remain. Copy ancestry is explicitly unsupported. Denied/stale sources refuse disclosure; removing or clearing denied citations remains usable without reading their source authority or crop.

Stored bounded validation pins source bytes/hash, oriented original selection, actual crop/output, included whole-pixel bounds/transforms, recipe/runtime and clean RGB/RGBA display semantics. Validation is capped at 4 KiB; existing 25-citation, private-response and 30-second mutation bounds remain. Citation association is **operator_selected**, qualification **not_assessed**. Applicability means explicit inclusion of that exact source region for the pinned target, effective after canonical review/commit; it establishes no ownership, location, metric quantity or title. Draft attachment does not complete a packet or qualify property facts.

Five owned code/check files changed: registry citation/addition/evidence contract, new image leaf, narrow citation service, shared case-discovery helper and dedicated control. Existing `registry.ts` canonical review/commit consumes these checks unchanged. Existing PDF/native/OCR/IFC/model/raster/point citation versions/hashes, image workers/runtime, packet plans/assembly/jobs, generic services and frontend are unchanged. General projections still hide citations; private evidence returns `{pin}` without invented text/results.

**Lead publication:** regenerate embedded request/citation/evidence/OpenAPI/client schemas and update existing citation route wording, then add a separate source-index/catalogue observation. No new endpoint, store, migration, provider or controller registration is introduced by this task.

## Concrete verification

Retained PNG/JPEG crops and typed provenance from [PACK1-IMAGE-01](packet-image-region-handoff.md) were reused unchanged. Source/case/site/target, extraction transport and SQL rows in these journeys are explicitly technical controls, not an authentic property crosswalk. No original decode, native/render/model/provider run, source acquisition or service startup occurred.

| Journey | Exact preserved crop | Canonical result |
| --- | --- | --- |
| NYC PNG → controlled building correction | SHA `497d5a9ea526f4bb83b5c7106b95c829fc632b8b14d44c73b60bb60a5b723c97`; 172 × 178 / 56,840 bytes | Citation `459a15adeef78ba08234257a8a095ac66d38bd089d87756d7d1acd599779be19`, draft revision 2 → committed record revision 2, immutable target pin revision 1 |
| Libjpeg-turbo JPEG → controlled floor correction | SHA `841b819998fc427d7c873e89dc13e5994c70afc5a88820f37177ca25525c0140`; 197 × 109 / 35,963 bytes | Citation `ef8040a78200c849c2908d59c60a26ffed15553777e19d1a7105004f111e359b`, draft revision 2 → committed record revision 2, immutable target pin revision 1 |

Both pass amendment → private read → idempotent replay → actual canonical review persistence → commit → exact stored history/private read → commit replay, with one preparation adapter call each and unchanged prior history. Public commit projections omit citations. Current revocation denies historical private read and committed replay. Focused refusal also covers caller proof, wrong frame, stale case/family, wrong site, late access revocation before acceptance, transform tampering and space additions; revoked remove/clear succeeds. Source case rows precede destination and recording locks.

Final commands exit 0:

- `pnpm exec tsx --test tests/registry-image-region-evidence.test.ts tests/registry-region-evidence.test.ts`: **six pass, no skips**; two focused image controls and four existing PDF-region compatibility controls.
- `pnpm typecheck:backend`: server and API pass.
- `git diff --cached --check`: pass. Reviewed changed source/target/access, preparation/acceptance, lock discovery, history/projection and bounded-validation flow with no known blocker.

Completion `E:/BhuAayam-data/task-data/desktop-reviewed-image-regions-20261003/completion-bd8af0e7.json`: **20,898 bytes**, SHA **`eb2d1db68ea7f80056bfd1502118c55b2a3fd1ccb86152167cea87788e02ee5f`**, 21 physical and 32 Git pins. Saved PNG building journey is 15,713 bytes / SHA `cc2f496aeafe5e45319b6731022ec244c7df74798c5be02cff80b51c26eb77af`; JPEG floor journey is 16,468 bytes / SHA `8ae1a36c60b2cd666593f3ad052322a132e834cf239a198e7d5640e9926c0740`. Exact outputs, attribution, historical target/body, stored history, public commit and command logs are retained privately. Physical versus normalized Git code bytes are distinguished; no open writer log is pinned.

Prior image completion SHA `9d09c39180f1f0e37b1c60c5fc8f1628f4a144e137d349ba5a66a322ecb6c85a`, crop/provenance/pixel/guard proof, source/runtime history and unchanged originals are preserved. NYC stays foreign `test_only`; JPEG remains a development fixture with unknown geography/acquisition date and independently unestablished photographic rights. Existing native proof is reused rather than promoted to current execution or property evidence.

Current HTTP/PostgreSQL/private persistence/real contention, authentic applicability/identity/geometry/measurement, Indian operational/learning qualification, image packet assembly/completion, scale/deployment and GF4/release remain unqualified. All test/typecheck processes completed; no native/service/model/GPU/provider processes were started. Test evidence environment was restored, private owner ACL reused, and the checkout/index is clean after commits. Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier unexposed; supplied `never`/`danger-full-access`. Return exact commits once to the authorized lead callback, then end without polls/schedules.

## Lead integration, 3 October

Code/handoff `5d74b067` / `11ac4d22`; changed-code review and completion/21 physical/32 Git pin reconciliation passed. Six integrated image/PDF-region controls, backend/client typechecks and API validation pass. Existing route wording and embedded schemas published, 260 operations/295 named schemas; both catalogues add separate observations. No new native run or current HTTP/persistence/property qualification.
