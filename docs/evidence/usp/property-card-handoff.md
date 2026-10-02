# CARD-01 private property card

Implementation `ee2c5832dc09e82557ca4a6a94da5ac3be6d7bc8`, accepted base `031696e35fc39583f91fffc05d2f556260bb22b1`, branch `task/desktop-property-card`. Exclusive checkout: `C:/Users/kvina/.codex/worktrees/desktop-citygml/3d-ulpin`. Packet and declaration checkpoints remain preserved at `f055248f` and `42fe86bd`.

The implemented flow generates a fresh one-page private PDF from an executed, confirmed text/CSV plan. Card revisions retain exact plan, confirmation, packet, target, manifest, source-entry, optional-omission and derivative hashes. Supported snapshot facts come from the captured record, P3 identity and selected accepted declaration; selected parcel assertions require the included exact source part. No sibling declaration text or unselected parcel anchor enters the card. Geometry, frame/datum, measured quantities, selected-space rendering and legal/issuance determinations remain explicitly unavailable or not_assessed for this first profile.

The QR encodes only `http://127.0.0.1:<trusted API_PORT>/api/v1/usp/property-cards/<opaque UUID>/revisions/<exact revision>`. It reads no caller Host or forwarded origin and includes no bearer token, target ID or private facts. Existing server-derived local operator context and common loopback boundary remain required; a QR is not an access grant or human authentication. The PDF labels it a local demonstration link.

Generation, metadata reads, replay and final PDF disclosure reuse the existing protected historical plan authority. Locks follow its case/gate/recording/source/target order and are retained through final authorization. Storage I/O occurs outside card SQL transactions. The PDF reader verifies bounded length/hash and checks current authority again afterward; revoked or expired cards deny. Facts stay immutable while the JSON view and resolver response headers separately identify current target revision and same_revision/changed_revision. Wrong revisions never fall back to latest. Receipt, card registration and outbox publication use the same client. Authorized sequential replay performs no object I/O or writes; concurrent duplicate or failed final publication can leave an unreferenced immutable generated object. Originals, confirmed plans and existing packets are unchanged.

The `property-card-summary-ascii/1` profile supports printable ASCII. Unsupported glyphs return `CARD_TEXT_PROFILE` with a font/shaping limitation; source text is never substituted. One-page overflow returns `CARD_LAYOUT_PROFILE`; output is capped at 512 KiB. Expiry must be within 24 hours. A guarded append changes card revision for the same executed plan; a changed plan/snapshot requires a distinct card. Revision pointers and hashes establish consistency only, with no separately trusted authenticity chain.

## Integration owned by lead

1. Export the additive card contracts from `packages/contracts/src/usp/index.ts` as required by consumers; server functions are already available through existing wildcard package subpaths.
2. Register `PropertyCardController` from `apps/api/src/modules/evidence/property-card.controller.ts` in `EvidenceModule`. The focused leaf test uses its own module; production registration was deliberately untouched.
3. Republish OpenAPI/client/catalogue through the existing lead workflow. New operations are POST `/api/v1/usp/property-cards/generate`, POST `/read`, and GET `/:cardId/revisions/:revision`. Generate takes exact plan/version, nullable card ID, expiry and create/update guard. Read takes exact card ID/revision. Resolve returns authorized PDF bytes with no-store, hash and revision headers.
4. The additive SQL 17–19, manifest and `migrateUsp` registration introduce immutable `usp_property_cards` after packet plans. No migration was applied. Registration requires these prerequisites to be applied through the normal authorized runtime process before serving the feature.

## Focused checks and retained evidence

All commands ran in the exclusive checkout. Actual commands/exits and physical/Git SHA-256 pins for all 15 implementation files are recorded in `E:/BhuAayam-data/task-data/desktop-property-card/completion-receipt.json` (10,880 bytes, SHA-256 `dc80b182cbe26d2bbb0c0f47186c1ff7949fcca374b3a0cf155670d5999f029e`).

- `pnpm exec tsx --test tests/usp-property-card.test.ts`, with `CARD_EVIDENCE_DIR=E:/BhuAayam-data/task-data/desktop-property-card/journey-01` and `CARD_PDFTOPPM` set to bundled Poppler: exit 0, 2/2. One executed-plan generation/read/rendered-QR/resolver journey covers immutable historical facts with changed current target revision, zero-I/O replay, payload conflict, exact missing revision, guarded append/stale guard, unsupported glyphs/overflow, revocation after PDF I/O and rejected final publication. These are controlled persistence/access checks, not PostgreSQL concurrency measurements.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/property-card.controller.test.ts`: exit 0, 1/1. Test-only Nest/Swagger boundary, private decorators and malformed bodies/path revisions; no listener or domain I/O.
- `pnpm typecheck:backend`: exit 0, server/API pass after final fact/revision bounds. The two service checks also passed again after those bounds; saved PDF evidence was preserved.
- Bundled Python `scripts/db/verify_extraction.py`: exit 0. Historical 25 files/136 statement hashes preserved; 22 authored additions and 46 named runtime migration queries pass. Narrow manifest formatting was preserved; no SQL applied.
- Bundled Poppler at 144 dpi plus jsQR decoded the actual PDF QR, whose exact card/revision was passed to the resolver. PNG visual inspection shows no overlap, clipping or missing glyphs. Bundled pypdf confirms one page and one exact local URI annotation, with no forms, attachments, JavaScript or additional actions. The initial overstrict no-OpenAction probe exited 1; read-only inspection showed jsPDF's ordinary `/FitH` page destination, and the corrected inspection passed (recorded in `pdf-inspection.json`).

The generated PDF is `E:/BhuAayam-data/task-data/desktop-property-card/journey-01/property-card.pdf`, 6,758 bytes, SHA-256 `54e6186f6a5f754bf304934d255270800fbc6d69a0c23fac123d7bebb9d55eeb`. Decoded QR, rendered PNG, extracted PDF text, immutable view and inspection receipt are beside it, all hash-pinned in the completion receipt. Protocol original bytes SHA-256: `06c171f22108394df0199f5455c740f954269209e7475fc7f43ba9035a8bbc27`. This technical input is not an official matched property, title, issuing identifier or operational qualification; no new data acquisition or original modification occurred.

To reproduce artifact evidence, run the focused service test with a fresh `CARD_EVIDENCE_DIR` and a Poppler `pdftoppm` executable in `CARD_PDFTOPPM`; leave retained `journey-01` unchanged. Without those optional environment variables, the same service/access controls run without exporting or decoding a PDF artifact.

## Dependency origin and limits

Pinned server additions were installed with scripts disabled. `jspdf@4.2.1` was already present at root and is now an explicit server dependency. Lockfile changes are limited to these additions and their transitive resolution.

| Package | Use | Upstream origin | Declared licence |
| --- | --- | --- | --- |
| jspdf 4.2.1 | Fresh vector/text summary | https://github.com/parallax/jsPDF | MIT |
| qrcode 1.5.4 | Vector QR matrix | https://github.com/soldair/node-qrcode | MIT |
| @types/qrcode 1.5.6 | Development types | DefinitelyTyped/types/qrcode | MIT |
| jsqr 1.4.0 | Development rendered-QR decode | https://github.com/cozmo/jsQR | Apache-2.0 |
| pngjs 7.0.0 / @types/pngjs 6.0.5 | Development PNG decode/types | https://github.com/pngjs/pngjs / DefinitelyTyped/types/pngjs | MIT |

Formal launch/license clearance remains a later release workstream; no such clearance or deployment is claimed. No GPU/model/provider inference, source fitting, services, DB, Docker, migrations, public activation, push or frontend work occurred. Current private object storage, PostgreSQL/MVCC, registered HTTP and authorized-browser runtime remain unqualified. PACK1/GF4 and GF0 do not advance from these controls.

Requested GPT-6.1 Sol/xhigh/default-standard; supplied `approval_policy=never`, `sandbox_mode=danger-full-access`. Actual model/effort/per-turn tier are unexposed; no Fast/priority request or tier change is claimed. All modeled SQL connections close and storage I/O holds no connection. The completion callback is authorized by PARALLEL_20261002C; the worker stops after sending it.
