# 10 · Property-scoped evidence packets

Owner **PACK**. Baseline `f623cff897f91bb3ebd4c225f700ac263f7beb72`. Revised 22 September 2026. Read [00](00-README.md), [01](01-shared-contracts-and-ownership.md) and your UI slots in [99](99-ui-ux-and-integration.md). New paths below are implementation destinations, not existing functionality. Audit remedies ER-05/14/15/24 are incorporated here.

The later retained D0/PACK0 receipt is the current implementation baseline; inspect its exact artifact and tests before assigning new work. PACK1 and the GF4 card/QR remain separate gates, not implied by that receipt.

## A. User outcome and product value

Allow an authorized user to select a building, floor or unit and obtain only its relevant permitted evidence, including explicitly applicable shared clauses. Example: one page mentions Flat 101, Flat 102 and their staircase. Flat 101's packet includes its reviewed region and the applicable stair clause, never Flat 102's private contents. The result is a generated compilation, not a certified original or a title determination.

## B. Current implementation and gap analysis

[selectRegisterScope](../../apps/web/lib/register-scope.ts) narrows records/scene, not all source bytes. [exportRegister](../../apps/web/lib/server/officer-investigations.ts) keeps building context. [sourceBundle](../../apps/web/lib/server/source-bundle.ts) intentionally attaches full unchanged originals; keep that separate archival capability. [registerPdf](../../apps/web/lib/server/register-pdf.ts) prints report HTML in an isolated browser, while [pdf-pages](../../apps/web/lib/server/pdf-pages.ts) counts pages rather than redacting them. [Core locators](../../packages/contracts/src/spatial/core/source-schema.ts) and [locator checks](../../apps/web/lib/server/officer.ts) are reusable, but a page reference does not establish every item on that page is releasable.

Missing mechanisms to implement: immutable selection plan, reviewed applicability, bounded page extraction, resumable generation and permission-qualified derivative downloads. A narrowed register plus a whole-source ZIP is not this feature.

## C. Scope and non-goals

**PACK0 / V0:** live target → plan → confirmed text/CSV/JSON extract → private artifact/manifest → reload/download. **PACK1:** PDF/image excerpts after the one-page leakage qualification, summary PDF and ZIP assembly, recovery and optional separately reviewed release. PACK0 completion must explicitly report PDF unavailable until PACK1 passes.

**GF4 card subtype:** a one-page `property_card` is a PACK1 derivative of an exact confirmed packet plan, with its evidence packet retained as the detail/appendix. The finale needs an actual generated PDF, exact revision and a working authorized QR resolver. This does not make the card an original, title certificate or official ULPIN issuance. GF4 follows GF0 data/contracts, GF1 identity/exchange, GF2 domain checks, and GF3 governance/impact; the full public dashboard remains a later product feature. See [27](27-domain-ai-and-cadastral-checks.md) and [28](28-data-acquisition-and-finale-tests.md).

Keep **Property packet** and **Original archive** as different actions. No whole-original fallback for a mixed-property source, automatic legal relevance decision, public release by an LLM, general OCR/conversion platform or official certification. Missing sources remain missing; unsupported optional entries are omitted with a reason, required unavailable context blocks a complete packet.

## D. HLD and end-to-end flow

Choose exact unit → resolve a SnapshotScope through FND → create/preview immutable plan version → confirm included regions/shared context → enqueue fenced child work → store and hash derivatives → assemble approved entries → atomically register artifact and ready event → reauthorize download. Recording/source changes invalidate an unexecuted current-data plan; a completed historical packet retains its exact version and label.

Source bytes never change. The worker reads the approved manifest, not current property data. A browser disconnect does not cancel accepted work. Permissions are checked before preview, execution and delivery.

## E. Targeted LLD

### Plan, applicability and states

`PacketPlan` contains ID/version, TargetPin, SnapshotScope, source/link/relationship pins, purpose, output format, creator, policy/access-view version, expiry, entries, omissions and required-context status. Entry: exact EvidencePointer, source hash, extraction recipe/version, inclusion reason, target path, and optional reviewed applicability decision. Stable entry hash includes all these fields.

Traverse only bounded explicit context links (maximum depth 8, 200 visited links). A shared clause needs a reviewed applicability record tying source part + target + purpose + validity + reviewer/policy to the current manifest. Direct approved links can operate without RIGHTS. No parent-to-all-siblings expansion; unavailable RIGHTS means additional context is unassessed, not inferred. A whole asset requires an explicit exclusive-scope decision and full-source permission.

Tables: `usp_packet_plans`, `usp_packet_jobs`, `usp_packet_assets`, `usp_packet_entry_results`; register their migration through FND. Plans are versioned, not overwritten after confirmation. States: draft/awaiting_review → queued → running → ready, blocked or failed. Unused plans can expire. Entry states distinguish omitted_optional, blocked_required_context and extracted. Ready requires all required entries/context to be extracted and validated. Retrying identical approved work reuses accepted entry results; no duplicate assets or relaxed checks.

### Extractor decisions and budgets

| Input | Required transformation |
| --- | --- |
| CSV/table | Parse complete logical records with schema/header/units; preserve literal values in JSON. Spreadsheet-friendly CSV neutralizes formula-leading cells and records that presentation transform. Never split a quoted multiline record by physical line number. |
| Text/JSON | Exact approved lines or JSON pointers with reviewed required context. A free-text locator needs clarification. |
| PDF | Rasterize only a validated page; crop/rebuild from approved visible regions. Copy no original PDF page objects, text layers, annotations or attachments into the output. |
| Image | Decode within bounds, crop approved region, strip metadata and re-encode. |
| Feature/model element | Only a supported complete feature/element with necessary frame metadata. Unsupported binary extraction is unavailable, never full-file attachment. |

**Default PDF renderer:** pypdfium2/PDFium in the private Python worker, using process isolation, not concurrent threads. FND pins the actual available stable wheel/PDFium versions after PACK's one-page test; record dependency and licence. See [official API and thread/memory requirements](https://pypdfium2.readthedocs.io/en/stable/python_api.html). Do not initialize JavaScript/forms/XFA. Reject active/encrypted/unsupported inputs under policy. The rendering subprocess has no network, no service secrets, read-only input and bounded temporary output; it is not considered safe solely because the input is a PDF. Close page/document/bitmap handles explicitly.

Coordinates are normalized top-left regions on the declared displayed CropBox after source rotation. Record page dimensions, rotation and crop transform. Test rotated/cropped pages and nonzero origins. Clamp/round pixel bounds only through the reviewed transform; padding must not expose adjacent property text. If readability requires more context, request review, not arbitrary expansion.

Initial PACK1 profile: ≤20 entries, ≤10 distinct rendered pages, ≤64 MiB source bytes, ≤12 million pixels per page and ≤120 million cumulative processed pixels; one page decoded at a time; one render process, 512 MiB memory cap and 60-second child deadline. Assembly is a separate bounded job with ≤32 MiB output and 60-second deadline. These are limits to measure, not performance claims. Oversize inputs return an actionable 413 before allocation; do not raise global worker caps. Restart resumes accepted page outputs by hash. Parent waiting time is not child execution time. Delete only unreferenced temporary outputs after a grace period.

Build the summary PDF from clean escaped data and freshly encoded cropped images, using the existing isolated report printer where compatible. Do not copy private metadata into filenames, manifests, errors or thumbnails. A renderer failure leaves PDF capability blocked; text/CSV PACK0 still works, never a whole-PDF fallback.

### API and access

All proposed routes are `/api/v1/usp/packets` and use 01 envelopes/guards:

| Route | Contract |
| --- | --- |
| `POST /plans` | target, SnapshotScope, purpose, format, create guard → plan/version/authorized preview refs |
| `PATCH /plans/:id` | update guard + explicit entry decisions → new immutable plan version; no arbitrary patch |
| `POST /plans/:id/jobs` | exact plan version and manifest + guard → 202 job ref |
| `GET /jobs/:id` | safe job/entry states, completeness and artifact availability |
| `GET /jobs/:id/download` | current private authorization or separately active release decision → hashed bytes |
| `POST /assets/:id/releases` | release.approve + reviewed redaction/applicability/audience + exact output hash/version → ReleaseDecision |
| `POST /releases/:id/revoke` | authorized update guard and reason → revoked release; future service access denied |

Private artifacts inherit contributing-source restrictions. **Released artifacts use the separate release path in 01:** approved exact derivative bytes may be public while originals remain restricted. Public viewers do not need private-original access, but release/audience/expiry/revocation must be checked every time. No AI output or parent public flag grants release. Do not promise recall of bytes already downloaded. Default all generated packets to private.

Manifest pins target, stage/classification, geometry/source/link/relationship versions, extraction/applicability policy, source and output hashes, inclusion reasons and safe omissions. Unapproved public manifests cannot expose source names/parties. Hashes prove byte consistency, not truth.

### Exact-revision Property Card and QR

`CardPlan` extends a confirmed `PacketPlan` with card template/version, [H26's project `P3/1` code and lifecycle pin](26-identifiers-and-standard-exchange.md), supplied official parent ULPIN assertion if present, selected target/geometry revision and frame, source-supported lower/upper levels with their **actual** vertical datum and height type, named quantity definitions/units, declared share basis/reference, approved rights summary, evidence entry refs and selected-space render ref. The application code is labelled as proposed/project-issued, never as an official ULPIN. Missing or incompatible facts print `unavailable`/`unassessed` with reasons; a GNSS/local height is never relabelled AMSL and a derived share or area is never silently substituted for a declaration. A selected-space view must be keyed to the same target and revision as the card and export, not a current camera image of a changed record. The detailed packet remains accessible under the same plan and independent authorization.

FND supplies the namespaced identity/retired-alias resolver; PACK owns the card bytes, exact packet linkage, release decision and QR target. A permanent QR contains only a stable resolver URL plus opaque exact card revision or approved released-derivative ID. It contains no private download token, private source name or access grant. The resolver pins the requested historical revision, resolves retired IDs through explicit lineage, checks current authorization or the active exact-output release on every request, and returns a safe unavailable/denied state after expiry or revocation. A released projection may show fewer fields than a private card; its output hash and release ID are distinct. Public-dashboard deferral does not remove this minimal controlled read path.

**GF4 required mode is `local_operator`:** generate/decode the QR and open its exact-revision resolver in the authorized browser on the same workstation. Preserve H01/H19 loopback-only binding and existing server-derived operator scope; test unauthorized requests and revocation in isolated services. Label the QR “local demonstration link”; it is not a phone/public service. No widening of the operator session to LAN.

A phone scan is an additional conditional demonstration, not a GF4 prerequisite: qualify a separate authenticated read-only resolver or exact released derivative on a reachable host with F2/DEPLOY ingress, TLS, audience, expiry/revocation and device tests first. No original-file, mutation or local-operator routes are exposed through it. `localhost` on the laptop cannot be reached by a phone. Record network/device/access mode and show unavailable until this extra gate passes. A printed QR stays stable while authorization can change.

Integrity display uses source-byte and derivative hashes for consistency. If a predecessor chain is implemented, FND pins canonical serialization, predecessor revision, chain head and missing-link behavior; PACK displays the verification result for the exact revision. A rewritable chain can be recomputed, so an independent authenticity claim additionally needs a separately trusted signed/checkpointed head and key policy. QR and hashes alone do not prove title, source authenticity or legal validity.

## F. Exact implementation map

| File | Change / owner / dependency |
| --- | --- |
| Proposed `packages/contracts/src/usp/packets.ts` | PACK plan/entry/job/release schemas; import F0 refs/guards |
| Proposed `apps/web/lib/server/usp/packets/{selector,service,extract,routes}.ts`, `migrations/10-packets.ts` | PACK selection/persistence/page orchestration/routes; FND mounts/migrates |
| Proposed `services/geo/geo/usp_packets.py` | PACK isolated raster/crop operations; FND owns dependency/task registration |
| Proposed `apps/web/features/usp/packets/{PacketAction,PacketPreview,PacketStatus}.tsx` | PACK leaf UI, no independent map/state |
| Existing scope/export/source/PDF helpers linked in B | Read-only reuse or narrow FND adapter; preserve full-original archive |
| [QuickRecords](../../apps/web/features/studio/product/QuickRecords.tsx), [RegisterPage](../../apps/web/features/officer/register/RegisterPage.tsx), [ScopedExport](../../apps/web/features/officer/shared/ScopedExport.tsx) | UI alone mounts separate packet action |
| Proposed `tests/usp-packets.test.ts`, `tests/usp-packets-integration.ts`, `services/geo/tests/test_usp_packets.py`, `tests/e2e/usp-packets.spec.ts` | PACK exact selection, leakage, persistence, permission and browser evidence |
| Proposed `apps/web/lib/server/usp/packets/{card,qr-resolver}.ts`, `apps/web/features/usp/packets/PropertyCard.tsx`, `tests/usp-card.test.ts` | PACK GF4 card generation and exact-revision QR; FND mounts resolver/identity guard, UI mounts leaf |

## G. UI placement and interaction

Map → building → floor/unit → Evidence → Property packet. One drawer keeps exact unit/version visible, shows direct/shared/omitted entries and one Confirm generation action. Full register reuses it. Loading retains the scope header; empty offers existing source/workspace navigation; incomplete names required missing context; denied does not disclose private sources; failure preserves the plan; ready shows historical/current manifest and download. Changing selected property never retargets an open plan. Invalid unit links disable generation instead of exporting the building. Mobile uses one sheet with focus return and no hidden hover actions.

## H. Agent ownership and dependencies

Branch `feat/usp-packets`; own only PACK paths. F0 permits selector fixtures; F1-min permits PACK0 live integration. FND may initially hold PACK0 ownership under 00; explicitly transfer before parallel editing. PDF requires the measured extractor gate, not public authentication. Public release requires F2/DEPLOY; private local generation does not. RIGHTS optional; absent contextual provider never guessed. UI/FND apply shared patches.

## I. Implementation sequence

1. Inspect the recorded D0 mixed-source PACK0 receipt against DATA's independent expected selection and source hashes; preserve its real-service behavior.
2. Close only verified PACK0 gaps in selection/plan/text generation/private download and V0 source navigation.
3. Run one-page PDF qualification: source retained, only approved pixels in rebuilt output, hidden-layer inspection and measured memory/time. On failure retain explicit PDF-unavailable state and finish unaffected work.
4. Add page checkpoints, final assembly, exact-manifest staleness, fenced retry and two-path release checks.
5. Mount leaves via UI; test rapid property changes and invalid links.
6. Use D4 or a permitted D5 multi-property source after preserving real bytes; do not infer a geometry join from its filename.
7. After GF1–GF3 inputs qualify, generate the GF4 card subtype from the exact plan, then qualify the loopback-only local_operator resolver; qualify any phone/released mode separately before demonstrating it.

## J. Test data, expected result and commands

**Before coding:** D0 from [H28](28-data-acquisition-and-finale-tests.md), using `ONLY_A101`, `NEVER_A102`, `SHARED_STAIR_CONTEXT` on one page plus equivalent table rows. DATA supplies precise approved regions/applicability and immutable source hash. **After PACK0:** inspect actual ZIP/JSON/CSV and private manifest, not just HTTP 200. **After PACK1:** render output and inspect PDF objects/text/annotations/metadata and every ZIP member; `NEVER_A102` must be absent everywhere, approved shared clause present, original hash unchanged. Compare image regions visually; absence of searchable text alone does not prove no leaked pixels.

**Real source:** [DDA inventory](https://dda.gov.in/sites/default/files/Housing_Department/list_of_flats_and_garages_dda_premium_housing_scheme_2026.pdf), first page, preserved and rechecked before extraction. Extract the intended row and required headings without adjacent unit rows; keep Block/Pocket columns distinct. No complete inventory/owner inference. If source is unreachable or redistribution unclear, use local permitted copy or D0 and leave real-source qualification unpassed.

Negative tests: wrong target, source-link change after plan, missing page, rotation/CropBox, corrupt hash, mixed page with only whole-page permission, missing shared context, access cycle, duplicate generation, late worker, crash between page and assembly, revoked grant/release and approved public derivative whose viewer cannot read originals. One optional omission must not hide a required-context blocker. Original archive regression must still pass separately.

**GF-T21 card/QR oracle:** one building with two sibling units and a shared clause; independently expected card fields and selected source regions. Compare card, live view, model export and resolver target IDs/revisions. Inspect rendered pixels, PDF text, annotations, attachments, metadata and filenames for sibling leakage. Decode/open in the authorized same-device local_operator mode and prove loopback isolation; if the optional phone mode is enabled, test its actual device/network and separate authenticated or released-only audience; test expired/revoked release, retired alias with successor link, wrong-unit link, missing historical revision and tampered predecessor/hash. Expected outcomes are exact historical bytes or safe denied/unavailable, never a silently updated current card. Record output/source hashes and whether any separately trusted chain head exists; absent one, report consistency only.

Run `pnpm typecheck`, `pnpm test:register-scope`, `pnpm test:register-exports`; then `pnpm exec tsx --tsconfig apps/web/tsconfig.json --test tests/usp-packets.test.ts`, `pnpm exec tsx tests/usp-packets-integration.ts`, `python -m pytest services/geo/tests/test_usp_packets.py`, `pnpm exec playwright test tests/e2e/usp-packets.spec.ts`. Proposed tests must first be created. Save sanitized artifact/hash and V5/V8 evidence under the 00 evidence convention. Report PACK0, PACK1, real-source and public-release status separately.

## K. Copy-paste agent assignment

> Implement PACK using 00, 01 and this A–K handoff. On isolated feat/usp-packets, inspect the retained D0/PACK0 live receipt and attempt the bounded D4 sample; preserve sources and source-to-target truth. Close verified PACK0 gaps, then qualify the specified one-page PDFium crop/rebuild path and add checkpointed PDF generation. After GF1–GF3 inputs qualify, generate the GF4 card from the exact packet plan and verify the same-device loopback QR resolver; phone access remains conditional on its separate protected-ingress gate. Follow exact SnapshotScope, job fencing and private-versus-released derivative rules. Do not broaden scope, attach whole mixed originals, invent legal applicability or build a second map/router. Request narrow FND/UI changes. Run J through real services and inspect actual bytes/pixels, not mocks; return commits, pack/output hashes, leakage/recovery/permission evidence, screenshots and explicit unsupported gates. Routine technical decisions follow this handoff; no main merge or public activation without authorization.
