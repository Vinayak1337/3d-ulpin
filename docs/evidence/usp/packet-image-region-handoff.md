# PACK1-IMAGE-01 — private original image region

3 October 2026. Code `bae0a448bc2ab940bad0b496d3cd31b1db6eb512`, based on clean publication `4aa6231d8372488349a4ce83abb5afe40508172c`; branch `task/desktop-packet-image-region`, exclusive checkout `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. Prior PDF progress checkpoint is preserved. Staging remains read-only to this owner.

## Delivered leaf and integration

Additive private `POST /api/v1/usp/packets/sources/{sourceId}/image-region`. `PacketImageRegionService` and dedicated `PacketImageRegionController` are implemented and checked without a listener. **Lead still registers the provider/controller in EvidenceModule, exports the contract, publishes the operation/OpenAPI/client and adds the source-index/catalogue observation.** This worker has not registered or published a production endpoint.

Request: exact current `revision` (decimal string), original `sha256`, `purpose:"private_source_preview"` and strict acknowledged selection. Selection has `coordinates:"oriented_original_pixel_edges/1"`, original-oriented width/height, exact EXIF supplied/absent/default state and `[left,top,right,bottom]` pixel edges. Derive oriented dimensions from existing source-image metadata, swapping native width/height for orientations 5–8; these are original pixels, independent of the full-image display raster size. Unknown fields, caller paths/URLs, wrong purpose, outside/subpixel/empty or unacknowledged selections refuse.

Response is fresh RGB/RGBA PNG, with `private, no-store`, `nosniff`, fixed `image-region.png`, exact Content-Length, `X-Region-Sha256` and base64url JSON `X-Region-Provenance`. The latter matches `PacketImageRegionProvenanceSchema`, bounded to 4 KiB before encoding. It retains exact source/case revisions, original/output hashes and bytes, native format/mode/density declarations, orientation and approved selection; included integer pixel bounds; source-to-oriented, oriented-to-output, source-to-output and output-to-oriented affine transforms; recipe/code/runtime pins and explicit color/alpha semantics. Affines use `[a,b,c,d,e,f]`: `x'=a*x+b*y+c`, `y'=d*x+e*y+f`, in top-left pixel-edge frames. Locator remains original image/frame 0, calibration **null**, applicability **not_assessed**.

Canonical `documentImageAuthorityTx`/`documentSourceTx` capture complete source/case/family/subject/access authority before original I/O, after the exact original read and before disclosure. No SQL transaction surrounds object reads, decoding or scratch I/O. The decoder orients the unchanged original, rounds left/top inward with ceil and right/bottom with floor, crops complete pixels, then converts/freshly allocates/resizes. Excluded pixels cannot influence the resize kernel. No preview-raster crop or whole-original fallback exists.

Existing ICC/non-sRGB/pixel-mode refusal policy, RGB/RGBA transparency conversion and `encoded_samples_unmanaged` color interpretation are reused. Fresh pixels strip EXIF/GPS, ICC, comments and text; Node additionally permits only exact IHDR/IDAT/IEND chunks with valid CRCs and expected dimensions/8-bit RGB(A) mode. Density declarations remain `not_calibrated` and never change display geometry.

Only two old files are narrowly changed: `document-images.ts` shares authority/original transport, worker transport and the same busy/cleanup-blocked state; `run_image_inspection.py` shares fresh PNG encoding and an optional original-region callback after existing decode/profile/orientation checks. Old APIs/protocols remain. New crop entry is `run_image_region.py`; shared supervisor is unchanged. One operation per local API process now covers full inspection and crops together. No competing image store, job authority, property binding, completion or certification is added.

Unchanged limits: original 16 MiB; 25M source pixels, 25,000-pixel sides, one frame; 30-second operation, worker at most 25 seconds, 2 GiB Job bound, two-thread CPU environment; output 1.6M pixels, 1,400-pixel sides, 8 MiB. Unresolved process cleanup retains its private attempt and blocks both image paths. Owned scratch is removed on resolved success/failure. Existing absolute private image runtime/scratch settings apply; no configuration/dependency installation or profile rewrite occurred. Socket/offline flags are defense in depth; OS egress enforcement is unqualified.

## Checked retained originals

| Input | Included original bounds | Output |
| --- | --- | --- |
| NYC 2018 PNG, 58,129 bytes, original SHA `b96b407333edc78a855eeba79dc4d166ee21be88f83a91166a884255ec4e0a5e` | `[38,42,210,220]` | 172 × 178 RGB, 56,840 bytes, SHA `497d5a9ea526f4bb83b5c7106b95c829fc632b8b14d44c73b60bb60a5b723c97` |
| Retained libjpeg-turbo JPEG fixture, 5,770 bytes, original SHA `acc6ec555d41d15b368320edaa3b20958ee6fa97cb6e4a18d1213d5ae8bec73b` | `[14,22,211,131]` | 197 × 109 RGB, 35,963 bytes, SHA `841b819998fc427d7c873e89dc13e5994c70afc5a88820f37177ca25525c0140` |

Original paths, issuer/origin/terms/geography and prior receipt are reused from `document-images-handoff.md` and `E:/BhuAayam-data/task-data/desktop-document-images/verification-pins.json`; no acquisition occurred. NYC stays foreign `test_only`. JPEG stays a public development fixture with unknown geography/acquisition date and independently unestablished photographic rights. Source package libjpeg-turbo 3.2.0 is lineage, not the actual decoder version.

Both final native workers had gated start, 23-second bound, exit 0/no stop reason, elapsed 0.266/0.265 seconds and peak Job private bytes 31,096,832/31,301,632. Source/SQL/storage/access for these service journeys were controlled dependencies with explicitly technical IDs, not enrolled operational records. A separate 25-second/2 GiB guarded process compared each output byte-for-byte to its approved decoded original pixels and verified empty output metadata. Node's allowlist also verifies clean PNG framing/CRCs. The originals rehash unchanged.

Unmodified effective runtime reports Python 3.12.14, Pillow 12.3.0, JPEG codec 8.0, libjpeg-turbo 3.1.4.1, zlib 1.3.1.zlib-ng. The existing Job bootstrap runs base Python and uses its bundled `_imaging` binary, SHA `2e62b249f2f10405ca9338240d5a8bd00e839031057352461e3e7c95d9c1e488`, while Pillow Image.py matches the retained venv pin. New provenance records base interpreter, configured launcher, Image.py and actual native extension hashes separately. All sixteen prior runtime pins, including the different venv `_imaging` binary, still match; historical receipts are preserved. This is an additive effective-runtime observation, not a profile repair or claim that the old inventory proved the loaded native binary.

## Verification and completion

Final commands exit 0:

- `pnpm exec tsx --test tests/packet-image-region.test.ts tests/document-images.test.ts`: 7 controls, covering final authority/revocation, exact source/frame/recipe, unsupported/subpixel input, clean metadata and shared operation-slot compatibility.
- From `apps/api`, `pnpm exec tsx --test src/modules/evidence/packet-image-region.controller.test.ts src/modules/evidence/document-images.controller.test.ts`: 2 Nest guard/provider/Swagger/header controls, no listener.
- `pnpm typecheck:backend`: server and API pass.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-packet-image-region-20261003/verify-native.mts`: two final accepted original-backed service crops, three authority captures each, private scratch empty.
- Existing interpreter with `-B E:/BhuAayam-data/task-data/desktop-packet-image-region-20261003/guarded-controls.py`: 5 focused old/new technical controls plus the two guarded real-output pixel comparisons. Rotated inward crop, alpha, metadata/profile refusal and independence from excluded pixels during downscale pass; technical inputs do not form operational evidence. Job exits 0, elapsed 0.531 seconds, peak private bytes 35,536,896.
- `git diff --cached --check`: pass; changed authority, transport, crop/transform, metadata and contract code reviewed with no known blocker.

Two observed failures are retained in separate logs: missing trusted sibling import under the unchanged runpy bootstrap, then an integrity mismatch from conflating base interpreter and venv launcher hashes. Both were fixed before final crops. No native retry campaign or shared-supervisor edit occurred.

Immutable completion: `E:/BhuAayam-data/task-data/desktop-packet-image-region-20261003/completion-bae0a448.json`, **34,038 bytes**, SHA **`9d09c39180f1f0e37b1c60c5fc8f1628f4a144e137d349ba5a66a322ecb6c85a`**; 56 physical and 28 Git pins, with physical code versus normalized Git bytes explicit and no still-open writer log pinned. Separate private outputs, provenance, execution, final command logs, guarded comparisons and source/runtime/code hashes are retained under that directory. Before native checks: 18.4 GB free RAM, 28 logical CPUs, 45% observed load, no Python process; learner untouched. Final scratch count and owned image process count are zero; evidence ACL grants only the current owner.

Current source-bound HTTP/PostgreSQL/private persistence, property applicability/measurement/geographic/colorimetric accuracy, learning, Indian operational data, packet completion, scale/deployment and GF4/release remain unqualified. Frontend, ML/GPU/provider/services/Docker, PDF/plan/citations, shared configuration/dependencies, staging/index, main and remote push/deploy were untouched. Requested Sol6.1/xhigh/default-standard; actual per-turn model/effort/tier unexposed; supplied permissions `never`/`danger-full-access`. Return exact commits once to the authorized lead callback, then stop without polls/schedules.

## Lead integration, 3 October

Code/handoff `ac509938` / `ed1f5997` accepted after changed-code review and matching completion/56 physical/28 Git pins. Seven integrated service/old-image controls, two Nest metadata controls, backend/client typechecks and API validation pass. EvidenceModule provider/controller, contract export, operation manifest, OpenAPI/client and both catalogues are published: 260 operations/295 named schemas. Saved guarded native crops and comparisons reused; no new native execution or broader qualification.
