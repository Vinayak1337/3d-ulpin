# PACK1-CROP-01 — private selected PDF region

2 October 2026. Code `9e74109fb74420cc6360bbcf5c0b85e18b844861` implements a **PDF-only, source-authorized extraction leaf**. An acknowledged normalized displayed-CropBox region produces a freshly encoded RGB PNG and source/hash/frame/recipe/transform provenance. The original, whole-source viewers and OCR paths are unchanged. This is PACK1's extraction prerequisite; applicability, immutable packet plans, persistence, assembly, cards/QR and release remain separate.

[Assignment](../../orchestration/PARALLEL_20261002B.md#pack1-crop-01--clean-selected-region-evidence-derivative), dispatch `142a7c3f65c36d92359d8c65a923a88737f67fa6`; branch `task/desktop-packet-region-extract`, exclusive `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Previous branches including `task/desktop-ocr-pixel-bounds@3dad81f` are retained. Staging, b3eb and shared/generated files were read-only.

## Contract and boundary

Dedicated controller: `POST /api/v1/usp/packets/sources/:sourceId/pages/:page/region`. Body contains exact `revision` (decimal string), `sha256`, `purpose: private_source_preview`, and `selection` with the existing page frame/mediaBox/cropBox/box convention, `coordinates: displayed_cropbox_normalized_top_left/1`, normalized `[x0,y0,x1,y1]` and `selectionAcknowledged: true`. No URL, path, object key, caller image or arbitrary padding is admitted. Acknowledgement records the operator's explicit source selection, **not** reviewed property applicability.

Uses `documentPageAuthorityTx`/canonical retained-source subject, case, latest-family revision and access checks without another store. Authorization occurs before original I/O, after original I/O and after rendering/validation. Exact byte/hash checks, authority and recipe drift fences, explicit selection comparison and clean-PNG validation precede publication. General object keys/source names remain absent from provenance. Private/no-store PNG headers include a fixed `region.png` filename, output SHA and base64url `X-Region-Provenance` JSON. No source-to-property link is created.

PDFium renders only an allocated region bitmap. Full-page canvas dimensions describe its transform; no full-page bitmap is allocated. Pixel edges round **inward**, retaining only complete pixels within the selected normalized region. Rotation and CropBox origin are pinned; PDFium's actual displayed dimensions must agree with the existing MuPDF metadata frame or extraction abstains. The output records per-axis pixel-to-display affine and the actual included normalized region. Fresh RGB encoding copies no PDF objects, text layers, annotations, attachments or metadata. PNG validation allows only IHDR/IDAT/IEND, checks CRC/dimensions/format and rejects trailing/ancillary payloads. Forms, encrypted PDFs, JavaScript and external/active resources are unsupported; forms/JS/XFA are never initialized and annotation rendering is disabled.

Stricter leaf profile: original **16 MiB / 8 pages / 50,000 PDF objects**; displayed source side ≤14,400 points; selected sides 1–2,000 points; **1,400 pixels per side / 1.6M output pixels / 8 MiB PNG / 16 KiB metadata**. One extraction per API process, **512 MiB gated Windows Job**, ≤25 child seconds and 35-second operation deadline. Existing scratch ACL/artifact reader, gated supervisor and admission checks are reused unchanged. Node gives the child an explicit environment without application service credentials. Python network APIs are denied and no external PDF resource is resolved; no new OS network-containment qualification is claimed. Unresolved child cleanup retains its private attempt and blocks further leaf launches. Default clean completed attempts are removed; no canonical original is deleted.

## Actual checks and retained source

Final affected checks all exited **0**: five service authority/selection/recipe/PNG/concurrency controls; one dedicated controller/Swagger/private-header control without listener; three Python controls covering nonzero CropBox plus 0/90-degree rotation, green selected pixels versus red neighbours/blue annotation, hidden metadata/attachment exclusion, wrong source/page/frame and active/forms refusal; `pnpm --filter @ulpin/api typecheck`; saved-output Node schema/transform/recipe/PNG validation; staged whitespace check. Technical controls are not operational sources or labels. Current HTTP/SQL/object persistence was not run and the new controller is not yet registered.

One unchanged Haryana RERA/project-submitter T3-1 PDF was rendered: `E:/BhuAayam-data/task-data/association-sources-20260929/haryana-2831-tower3-plan1.pdf`, 1,655,334 bytes, SHA `2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865`. Original frame 2586 × 1695 points, rotation 0; selected source points **`[2265,1545,2530,1680]`**, normalized coordinates retained in `selection.json`. Existing [source review](association-sources/independent-review.md) and [plan-context evidence](plan-context-inputs-handoff.md) retain issuer/acquisition/terms and unresolved approval revision. No new source was acquired or admitted.

Actual output: **795 × 405 RGB**, 123,120 bytes, SHA `b9b6b487ac309582dc79fa03b2651e0698c5f68f8b6eb4fb27f632b658266d7c`. Canvas `[7758,5085]`, region pixels `[6795,4635,7590,5040]`, pixel-to-display `[1/3,0,0,1/3,2265,1545]`; no crop expansion. The emitted crop is legible and contains only the selected title/date/sheet block; project paragraph, signature blocks and neighbouring drawing content are excluded. PIL metadata is `{}` and chunks are only IHDR/IDAT/IEND. This visual inspection is not OCR, an approved revision decision, calibration or property applicability.

Supervised successful child: exit **0**, **0.531 s**, peak Job private **117,854,208 bytes**, peak observed RSS **131,948,544 bytes**, gated start/no stop reason. A changed CropBox pin returned `PACKET_REGION_FRAME_MISMATCH`, exit **1**, 0.266 s, without a PNG or raster allocation. No retained naturally rotated/nonzero-origin official PDF was identified in this scope; those transform behaviours are technical-control qualification only.

The first supervised run safely rejected `PACKET_REGION_RUNTIME_ASSET`: the accepted bootstrap initially resolved the bundled base installation's different PDFium DLL. A metadata-only gated probe established the actual path/hash; the **new CLI only** now prioritizes the supervisor's configured venv purelib. Its corrected run matched the unchanged pinned DLL. The failed receipt and probe remain retained. Initial Python tests also exposed missing PdfPage context-manager support; explicit page/bitmap finally-close fixed it. No historical receipt, shared supervisor or cap was changed, and no OCR/model ran.

## Integration instructions and dependencies

Lead-owned additions:

1. Import/register `PacketRegionController` and `PacketRegionService` in `apps/api/src/modules/evidence/evidence.module.ts` controllers/providers, then publish the actual operation/API-client handoff. The dedicated controller test uses a leaf control module, not a fictitious production registration.
2. Export `packet-region` contracts from the shared contract root if consumers require them. Server wildcard exports already resolve `modules/usp/packets/region-extract`; no new server package dependency is needed.
3. Configure private host `ULPIN_PACKET_REGIONS_PYTHON` and `ULPIN_PACKET_REGIONS_SCRATCH` outside Git. Required installed wheels: **pypdfium2 5.13.0 / PDFium 153.0.7999.0**, **PyMuPDF 1.25.5**, **Pillow 12.3.0**, and existing psutil/supervisor dependencies. No environment or dependency manifest was modified here; no download occurred. The existing OCR venv supplied these assets for local proof, without loading any OCR/model pipeline.

The Windows PDFium DLL is pinned to `fb898a1f5ace57805834f390407500bdb6ef93eff326a252ad334a8aae809d8e`. [Upstream pypdfium2](https://github.com/pypdfium2-team/pypdfium2) installed metadata lists BSD-3-Clause, Apache-2.0 and dependency licences; PDFium build notices are retained in its installed wheel. Existing PyMuPDF metadata is AGPL-3.0/commercial dual licensing; Pillow is MIT-CMU. Private `dependencies.json` records versions, project URLs and installed notice paths. Redistribution/production licensing and source-specific permission clearance remain later release work; no clearance claim is added.

## Proof pins and return

Private root `E:/BhuAayam-data/task-data/desktop-packet-region-extract-20261002/`. Verification pins nine code files separately as physical/Git bytes and 27 fresh artifacts; source, five read-only dependencies and **47 historical files** match their before hashes. No owned trial process remains. Explicit invocation/exits, initial failures and corrected results are retained; cleanup observer excludes its own ancestors. Source/original history and dirty b3eb work were preserved.

| Artifact | SHA-256 |
| --- | --- |
| `verification.json` (15,154 bytes) | `a6f8097132e16044428404f4d7860bc59eb84b088513258d6601beb7faed732a` |
| `commands.json` (4,211 bytes) | `38874cf45a274fcf0e02b9d084df6a3790dd1c0b70224335305b7e4121b3fa4b` |
| `dependencies.json` | `b59f83698db662aa6112b6a27243e13d4b6e00865e572f57d7da906f828cbae6` |
| `real-crop-02/receipt.json` | `d36bf11d6d53af3c0fb2d0bf442ef0106f000b473c9c9645dca6998ff792a031` |
| `real-crop-02/result.json` | `23091f79f24f6799db240973d9e78408872bc62b61faf3c273db12c8e5b36b98` |
| `projection-check.json` | `920bcf71b45cbe87c88bd93913b80918c62830d9177d2548a2522befb6f1680a` |

Executed recipe SHA `e644a74b6c814a49b4a5278081f07bc65db6802f8b18034e13ff4a356b0f6155` hashes the new Python leaf/CLI, unchanged supervisor and contract bytes in fixed order; the current Node projection matched it. Historical execution pins are not rewritten during integration. Supplied permissions `never/danger-full-access`; Sol6.1/xhigh/default-standard requested, actual model/effort/tier unexposed. No Docker/services, model/GPU/provider, held-out inputs, frontend/shared registration/generated files, push/deploy or full PACK1/GF4 qualification. Return by authorized lead callback, then stop.
