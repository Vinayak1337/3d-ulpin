# PACK1-CROP-01 — private selected PDF region

3 October dependency correction: lead `6b9df073` includes installed optional `defusedxml` and its distribution metadata in frozen runtime inventories. Pillow's optional import previously failed closed before the supervisor returned; no render child ran. Defusedxml 0.7.1, Christian Heimes, https://github.com/tiran/defusedxml, PSFL/retained PSF v2 licence; 26 package/cache/metadata entries are pinned. A fresh profile successfully imports the supervisor without calling it; a separate profile omitting ElementTree.py still refuses unpinned imports. Proof `E:/BhuAayam-data/task-data/packet-region-defusedxml-fix-20261003/verification.json`, SHA256 `00135b2ec16c07b974a3e98964ebe9550d62514dac300f25249032aa9be88086`. Runtime files/caps/import validation and historical profiles are unchanged. The full native/security campaign was not repeated; a real second crop remains pending the packet owner's scoped corrected attempt.

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

## R1/R2 correction — 2 October 2026

Code **`e78115f2facd5a21972f2bab57181c2a0c9f1938`**, continuing candidate `f668c6f60a3bc9ca1b56722603fb682839e578dc` in the same exclusive branch/worktree. Read-only staging was observed at `e218ff37d1536482fe195153b246dc12ebf8dd74`; no staging integration occurred. This section supersedes the historical four-file recipe/configuration and exceptional-cleanup behavior above. Original source/render/recipe receipts remain unchanged. The two reproduced defects are host executable/cache drift and cleanup propagation, not PDF upload exploits.

### Frozen executable profile

New leaf-local `packet_region_loader.py` creates an explicit, immutable `packet-region-runtime/1` profile. Its expected SHA comes from trusted host configuration and becomes the new `recipeSha256`. It pins the full repository Python closure: renderer, CLI, loader, unchanged admission helper/supervisor/Granite utility, package initializers and packet contract. It also pins resolved CPython executable/base DLL/stdlib/bootstrap caches, virtual-environment configuration, installed renderer packages/native assets/configuration data and consulted distribution metadata. Packages include `pypdfium2_cfg`, alongside pypdfium2/raw, PyMuPDF/fitz, Pillow and psutil. No model packages or weights are loaded.

Node verifies the frozen profile and all resolved asset bytes before starting Python. A small `-I -S -B` bootstrap checks and compiles the loader's source bytes. The loader holds Windows read handles denying write/delete sharing, hashes the same source snapshots it retains, rejects unlisted resolved imports, and compiles repository/package Python directly from those snapshots. Existing `.pyc` files are neither executed for these imports nor rewritten. Bootstrap runtime caches are separately inventoried/checked before startup. Verification failures close opened handles; parent and child close their handles on exit.

The shared supervisor's **on-disk source and process-tree/Job/deadline/log cleanup algorithm are unchanged**. The verified local module receives a gate that loads this verified entry without `site.main()`/`.pth` execution, plus a private subprocess binding that inserts `-B` before child interpreter initialization. It does not modify the shared Python subprocess module. The original 512 MiB Job, 25 child seconds, byte/page/pixel bounds and source/authority/PNG checks remain. Node hashes assets with buffers sized to their pinned bytes, in batches of eight.

Final owner profile: **1,346 files / 119,705,136 asset bytes**, largest asset 21,586,944 bytes; profile 297,737 bytes, SHA `036e6af61762ebb0de2004cdee271ec97bf4ab1ced184490b03e60e9aafab987`. Profile admission limits: 5,000 files, 512 MiB total, 32 MiB per asset and 1 MiB profile JSON. This is a host-integrity/configuration boundary around the resolved leaf runtime; it is not an adversarial administrator sandbox or OS network-containment qualification.

### Positive cleanup outcome

CLI emits `packet-region-execution/2`, binding limits and profile SHA to a distinct `cleanup` outcome. `confirmed` is emitted only after the accepted supervisor returns from its process-tree/log cleanup checks. A supervisor exception emits `unresolved` and the fixed `PACKET_REGION_CLEANUP_UNRESOLVED` code, without raw exception text or paths. Failure to emit a trustworthy receipt remains unresolved.

Node validates that receipt **before reading result/PNG files, including nonzero exits**. Missing/malformed/mismatched/unresolved cleanup retains the attempt and blocks further launches in the API process. Ordinary completed input refusals verify their result hash, remove their owned scratch and release admission; confirmed timeout/resource failures likewise clean the owned attempt. Recovery still requires the lead/operator to resolve the retained attempt before restoring the runtime; there is no automatic reset or cross-instance cleanup claim.

### Focused verification

Final commands exited **0**:

- Configured `pnpm exec tsx --test tests/packet-region-runtime.test.ts`: actual CLI and actual runtime/service source, technical authority/scratch adapters, and the actual shared bounded artifact reader. Five recorded controls: valid timestamp/size-poisoned renderer cache ignored with **zero blue annotation pixels**; omitted admission-helper drift denied before launch; resolved private runtime dependency drift denied before launch; injected supervisor exception retained/blocked (one attempt/one launch across two calls); missing cleanup receipt retained/blocked. The normal active-input refusal is reusable and its next valid crop succeeds. No orphan was deliberately created.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test tests/packet-region-extract.test.ts apps/api/src/modules/evidence/packet-region.controller.test.ts`: six existing service/controller controls pass without a listener.
- Configured Python `-B -m unittest services.geo.tests.test_packet_regions -v`, with `PYTHONPATH=services/geo`: three existing functional controls pass using an explicitly inventoried test context.
- `pnpm --filter @ulpin/api typecheck` and staged whitespace check pass.

Initial harness failures are retained: the cache fixture initially named a render flag this leaf does not use; the draft package closure omitted `pypdfium2_cfg` and safely refused rendering; the direct test context omitted its harness package initializers; the first controller invocation omitted the API tsconfig. The corrected final logs and technical fixture copies are retained. Final process observation found no owned correction process.

Private evidence: `E:/BhuAayam-data/task-data/desktop-packet-region-correction-20261002/`. `verification.json` is **16,333 bytes**, SHA **`2dcc2a1eacdbdd2dc816e24bf3df630a63c3bed8506c341ee0d913e645059e76`**; it pins six physical/Git code files, the frozen runtime profile and final control/log/output artifacts. All inventoried runtime assets and five shared dependencies match. The original T3-1 source, successful crop, owner receipt and three primary review receipts retain their exact hashes. Earlier 47-file historical reconciliation and actual normal-timeout/PID cleanup proof are reused, without another official render/OCR or timeout campaign.

### Lead integration/configuration

Production controller registration/publication remains lead-owned. For the final integrated physical checkout, create a **fresh** profile outside Git with its selected installed Python:

```powershell
& '<configured Python>' -B '<integrated checkout>/scripts/usp/document-models/packet_region_loader.py' --repo '<integrated checkout>' --create-profile '<new private profile path>'
```

Configure `ULPIN_PACKET_REGIONS_PROFILE` to that absolute file and `ULPIN_PACKET_REGIONS_PROFILE_SHA256` to the printed SHA, alongside existing `ULPIN_PACKET_REGIONS_PYTHON` and `ULPIN_PACKET_REGIONS_SCRATCH`. Profile creation refuses an existing output; extraction never refreshes pins automatically. The optional `--purelib` selects an explicit package directory for isolated/configured runtimes; normal creation uses the chosen Python's purelib. The owner profile binds this worker checkout, so it cannot serve as a staging profile after cherry-pick/path/line-ending changes. Review and regenerate pins deliberately when integrated code or runtime assets change.

Same requested Sol6.1/xhigh/default-standard and supplied never/danger-full-access; actual model/effort/tier unexposed. No shared reader/supervisor/authority, originals, global/package cache, frontend, registry, generated registration, DB/service/model/provider, push or deployment change. Current HTTP/SQL, natural official rotated/nonzero-origin coverage, property applicability, immutable packets/cards and GF4 remain unqualified. Return corrections for the existing reviewer's R1/R2 closure, then stop.

## Bootstrap-only continuation — 2 October 2026

Code **`f839d51b1743c63d32067dafd22486befd116d2d`** continues clean `9c609b2f` under the final [assignment](../../orchestration/PACKET_REGION_01_REVIEW.md#bootstrap-only-correction-continuation--2-october). Read-only staging observed at `671e7696eaf67a40963eb6c8250f56773448533c`. Closure `6b984dec`/`95fbdda0` is reused: R2 and the original helper/renderer cases remain closed. Only parent/gated-child startup and its targeted control changed.

Both interpreter launches now pass **`-X pycache_prefix=\\.\NUL`** before initialization, alongside `-I -S -B`. Win32 NUL returns no cache bytes, so newly present source-directory bytecode cannot be consumed before the verified finder activates. Both bootstraps check the exact prefix before their first non-builtin import. The child's option is inserted through the existing private subprocess binding; shared supervisor/interpreter/cache files are unchanged. The frozen profile, verified source snapshots/read locks, Job/process/byte/pixel caps and execution/2 cleanup behavior are preserved. This supported Windows/CPython profile does not introduce an OS sandbox claim.

One new isolated control passed: `pnpm exec tsx --test --test-name-pattern bootstrap tests/packet-region-runtime.test.ts`, with the configured existing Python and `ULPIN_PACKET_REGION_TEST_ROOT=E:/BhuAayam-data/task-data/desktop-packet-region-correction-20261002/bootstrap-01`. It copies the inventoried interpreter/stdlib into a private fixture, freezes its profile with no sysconfig cache, then adds a valid timestamp/size-matching `sysconfig.pyc`. A direct ordinary import in that private interpreter executes the cache's marker, proving the fixture is valid. The corrected actual runtime/service completes an ordinary crop and a crop with that new cache present; **neither parent nor gated child executes the marker**. Both supervised receipts confirm cleanup; two attempts/two launches are removed. Poisoned-launch worker: exit 0, gated start, 1.547 seconds, peak Job private 159,371,264 bytes, RSS 157,474,816 bytes. No operational PDF/OCR, timeout or closed-finding campaign was repeated.

`pnpm --filter @ulpin/api typecheck`, staged whitespace check and exact pin/cleanup reconciliation exited **0**. Final owned-process observation is empty; only immutable private fixture/cache/positive-control artifacts remain. No installed cache or interpreter was changed. Three changed files have physical/Git pins; both new profiles and all inventoried asset bytes match. Reused original source/crop/correction receipt and five shared dependencies remain unchanged.

Evidence: `E:/BhuAayam-data/task-data/desktop-packet-region-correction-20261002/bootstrap-01/verification.json`, **8,758 bytes**, SHA **`6098f16bc302a60160fb2b5b8be111e8e774f90e07c5ecfdeaeddf7215c5abee`**. New owner profile SHA `d86046356d747d37a0bdf1caee7deeefeca81555a4ab5aae9f8479688f8d2629` (1,346 files / 119,705,243 asset bytes); private control profile SHA `86afffcf6372351137942e87a5934b5b3e646b2a2c66dde0e8d6acd6342d4e9a`. Historical profiles are preserved. Lead must still create a fresh profile for integrated physical bytes/paths; controller registration/publication is unchanged and lead-owned.

Supplied permissions verified from this turn: never/danger-full-access. Sol6.1/xhigh/default-standard requested; actual per-turn model/effort/tier unexposed. No additional worker/reviewer, staging merge, shared seam, services/Docker/GPU/model, API registration/generated publication, push or deployment. Prior HTTP/SQL/source applicability/packet/card/GF4 limitations remain. Return this narrow delta and stop.


## Lead integration and publication — 2 October

Implementation/corrections integrate through `3d5af6c5`; bootstrap fix `23aeeb22` closes R1 using the inspected isolated new-cache control. R2 remains closed. Lead registered PacketRegionController/PacketRegionService in EvidenceModule and added its operation manifest. Six integrated service/controller checks and backend/client typechecks pass; API validation passes at 238 operations/280 schemas, one additive operation/request schema and no existing changes. Existing generated client is sufficient; no unused root contract export. Retained original crop and worker technical runtime evidence are reused, not fresh staging rendering. A fresh checkout-bound profile is required before native use; current HTTP/SQL/storage, reviewed property applicability, finished PDF packet and GF4 remain unqualified.
