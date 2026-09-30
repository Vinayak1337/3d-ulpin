# LINK-02 — reviewed document citations, code checkpoint

30 September 2026. Implementation `47f7f4d135b6fd957d193005041a5751c5ea6ea1`, accepted base `e1eba7c403f20e65eb0a813f8eabe5d134db90fb`, branch `task/desktop-reviewed-document-links`, worktree `C:/Users/kvina/.codex/worktrees/desktop-raster/3d-ulpin`. Primary staging is read-only; latest observed lead head is accepted OCR handoff `626d87a166f2740611483f8253c043f034271b3a`. That newer code is not merged into this candidate. Completed CityJSON branches are preserved and their work was not repeated.

## Implemented amendment and read

The canonical `RegistryBody` gains optional bounded `documentCitations`. Pins contain the exact document source/case revisions/hash, accepted job/result/input/reader/attempt, native part ID/hash/typed locator, immutable recorded target body/revision, and server-attributed selection context. Native text is resolved privately rather than copied into registry bodies. `operator_selected` describes an explicit citation attachment; `qualification:not_assessed` remains. It confers no identity, geometry, rights or qualified learning label.

- `POST /api/v1/registry-drafts/{draftId}/document-citations`: one existing recorded building/floor correction, expected draft/record revisions, UUID request key, optional one-document selection of 1–25 exact part IDs and/or citation IDs to remove. At most 25 citations remain. Caller text, hashes, locators and attribution are rejected. Response is the resulting draft/record revision receipt, with `changed` state.
- `GET /api/v1/registry-drafts/{draftId}/document-citations`: returns exact pinned citations and their native text through current source/attempt/target/draft checks. Both routes reject undeclared query fields and send `private, no-store`; mutation body is bounded at 32 KiB in Nest and the streaming compatibility adapter.
- Existing create/edit/review/commit authorities remain canonical. Generic edit preserves omitted existing citations and rejects direct citation changes. Source/citation validation runs during writes, review preparation and commit. The review fingerprint includes the exact citation changes and server review context. Final review persistence now rechecks the draft/site/current records and evidence under transaction locks after processor I/O. Geometry qualification requirements are unchanged.

The mutation locks site/draft/current target and uses a caller-owned extraction-authority helper, avoiding nested independent writes. Current source/site/operator, latest input/reader, accepted result/attempt and literal eligibility are checked around object I/O. Formula/empty/redacted/nonliteral/unsupported native selections cannot become attached citations. Incompatible or stale targets/drafts fail; identical request replay cannot duplicate citations or overwrite a later edit. Existing `operations` stores only the idempotency receipt. Removal can recover an active correction from a revoked citation while remaining citations still require current authority. No new table, association store, entityIds write, geometry/record creation or sibling-floor propagation.

General registry/detail/draft/history/review/commit projections omit private citation pins. The dedicated read also checks recorded completion/currentness; superseded corrections do not silently switch targets. Immutable historical pins remain stored for audit.

## Snapshot and exchange privacy extension

Lead explicitly assigned the additional `snapshots.ts`, `document-association-targets.ts` and narrow `exchange.ts` changes. Captured registry reads remove only nested `body.documentCitations` after verifying the saved raw body/hash; storage is not rewritten. Existing LINK preview compares the complete captured/current raw target internally in a transaction assertion returning no private body. It therefore still accepts unchanged cited targets and rejects same-revision body/citation changes. Exchange explicitly omits the field and reports the canonical served-body hash separately from the immutable captured-body hash. Geometry/export algorithms and existing source authority remain unchanged.

## Focused no-service evidence

After stabilization:

- `pnpm typecheck:backend` — exit 0, server and Nest API.
- `node --import tsx --test tests/registry-document-evidence.test.ts tests/document-association-preview.test.ts tests/registry-validation.test.ts` — exit 0, 15 checks: seven new exact-part/write/read/replay/revocation/context/projection controls and eight directly affected existing checks.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/register/document-citations.controller.test.ts` — exit 0, one real Nest provider/route/strict selection metadata check, without a listener.
- `git diff --cached --check` — exit 0. Reviewed owned code for canonical persistence, access/currentness after I/O, stable historical pins, source/target selection and private projection boundaries. The missing-review-context regression initially raised an untyped hash error; it now denies with typed 403 and is covered.

All new protocol cases use memory-only technical doubles, including the canonical transaction mutation, extracted real source/accepted-result helper and actual commit rejection gates. They do not create operational facts, database records, geometry or labels. Actual database concurrency, successful persisted review/commit and the real API journey remain unrun at this checkpoint.

Private receipt: `E:/BhuAayam-data/task-data/desktop-reviewed-document-links/receipt.json`, SHA `c1bdbb986bea6bf24a6888f196ad33714f57551e3d4812b93e425b5119ea027d`. It binds the code commit, 15 physical working-file/Git-blob hashes, commands/exits, reference bytes, scope and resource state. Its generator is retained beside it.

## Source limits and runtime handoff

Consulted the source index/catalogue, accepted LINK preview, native table/DOCX and XLSX evidence and completed crosswalk review. Unchanged LGD CSV rechecks at 89,622 bytes / SHA `b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`. It supplies administrative citations, with no genuine matched building/floor. Haryana/Bihar canonical matches and approved-revision ambiguities remain unqualified. No fabricated positive pair or weakened geometry requirement supplies a runtime pass.

Requested GPT-6.1 Sol/xhigh/default-standard; actual model/effort/tier are not independently exposed. Supplied `never`/`danger-full-access` permissions verified. No workers, API/Docker/listener, populated database query, provider/model/GPU, source acquisition, frontend/generated API edit, credential change, reset, push or deployment occurred. No resource shutdown was needed; OCR-02's stopped runtime state is lead-reported, not independently queried here.

Return this clean checkpoint to lead for review, compatible merge of accepted OCR handoff and explicit runtime ownership. Current native receipts may be reader-stale after OCR changes and must remain preserved rather than relabelled. The subsequent bounded eligible retained-source API check needs a separate actual receipt; positive association accuracy and all release/learning/geometry claims remain unqualified. Lead owns generated OpenAPI/client/catalogue and integration. Stop after the checkpoint callback until runtime transfers.
