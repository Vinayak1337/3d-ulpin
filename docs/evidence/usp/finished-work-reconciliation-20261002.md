# INTEGRATE-02 — finished-work reconciliation, 2 October 2026

The reviewed recent backend lanes were already integrated. FUSION-01 was newly accepted and integrated after the lead transferred API registration. A subsequent accepted DATA-FUSION-01 callback adds the bounded retained-plan extraction checkpoint. The private context route/generated client and honest native `needs_ocr` results are now present; no runtime/model/release gate advances.

- Before: clean `staging@b4fe12eb051460bdbf4bc7b9ca53035e2d1d7166` in `E:/Projects/3d-ulpin`.
- After accepted code/data checkpoints: `staging@be0544dba8645278e25e0ccffff95ef9174ee7da`. Initial FUSION registration was `15dd8a9efcd62a4632a8e1f8035cab301116882f`, first reconciliation `99987bda30e925be411b8ba10e02da337e6f97a5`. The final documentation commit's exact SHA is returned in the follow-up completion callback (a report cannot embed its own commit hash).
- Preparation: exclusive `C:/Users/kvina/.codex/worktrees/desktop-integration-20261002/3d-ulpin`, `task/desktop-integration-20261002`. Exact inspected commits were transferred with `git cherry-pick --ff` only after checking staging branch, HEAD, empty index/working tree and the complete parent chain. No historical branch merge, deletion, stash or reset.
- Supplied current-turn instructions confirm `approval_policy=never` and `sandbox_mode=danger-full-access`; environment permission profile is `:danger-full-access`. Astra/xhigh/default-standard was requested. Actual model/effort/request tier are not exposed by these tools; no speed change is claimed or requested.

## Inventory and disposition

The read-only snapshot covers **109 local branches and 18 worktrees**. Eleven branch heads are ancestors of the dispatch base. The remaining histories contain 190 distinct non-ancestor commits: 170 have a stable patch-ID match in staging; 11 are topology-only merges with empty combined diffs; one archive-reader patch was integrated together with its accepted correction; four weight-1 implementation commits are deliberately retired; and four FUSION commits received acceptance during this task and are now integrated. Ancestry alone would have incorrectly reported most completed lanes missing.

Used `git worktree list --porcelain`, `for-each-ref refs/heads`, `rev-list <head> --not <base>`, `git log --branches --no-merges --patch --no-ext-diff --no-textconv` through `git patch-id --stable`, exact tree comparisons and accepted handoff/review records. Current implementation-file comparisons across the nine recent implementation lanes matched 67 of 69 lane/file pairs. The other two are the PDF lane's shared EvidenceModule/manifest, changed only by the subsequently accepted image registration. These are preserved superseding additions, not missing PDF work. Review-branch code differences are the accepted corrections/publication already represented in their implementation branches.

| Finished lane | Original/correction code → staging code | Accepted review / publication already on staging |
| --- | --- | --- |
| IFC private workflow | `f20e97a → b9c58a1`; `9906d61 → f163f72` | closure `e7ed6c0 → 205bdb1`; publication `ec497d0`, event clarification `2daae94` |
| Qwen containment and host loader | `2f0928e → 8310531`; `5c536ff → 9114718` | review `e692b7a → a1c1edb`; lead closure/publication `e09f169` |
| GeoParquet | `eb8ca96 → 0c69598` | `f5521f8 → 37e97ce`; catalogue `d7bba6e` |
| CityGML | `1b2ba4e → 9323784`; `982f064 → 71a3ac5` | `6b179ff → dd87fda`; closure/catalogue `e050cec` |
| Images | `d8ab6ec → 8d67f3d` | `7fe24f4 → 691ec98`; publication `a1c3460` |
| PDF pages | `8bd7419 → d8ba409` | `d7afd46 → 56d339b`; later image registration preserved |
| DXF | `bbdf5cd → a075b61`; `ec13cc5 → 950c894` | `3f675e4 → aa6b791`; source publication `e5b4d4` |
| glTF | `f0a7f0d → ee05954`; `5001f7c → 63462cc` | `44812c1 → 00a938f`; lead correction closure/source publication `e5b4d4` |
| KML | `8ad86d6 → c2cd9d7`; `9500397 → cdae3b3` | `90169d0 → 7b7ac39`; lead correction closure/publication `a1c3460` |

All short SHAs in this report resolve uniquely in this repository. Review acceptance retains its recorded local/code scope; it is not renewed runtime qualification.

**Archive exception:** `2b995d2ec531dfa61dcc8b59762145b8e142357f` is subsumed by `c68b51b`, which includes the independently found sibling-companion correction. Its four current files equal the accepted corrected integration exactly. The original CLI is unchanged; the service/test/handoff differences from the uncorrected worker are exactly the companion rejection, targeted regression and closure receipt. Reapplying the old candidate would remove an accepted safety correction.

**Retired code:** `7a5b0d132253c757911f65fee6a729ec09c4492c`, `9f68399703e0c1bbc9158bfba0afebfc9aaa427e`, `a8f84c9e2d489fe2c12cb380dd95bea0e3ba0abb`, `1926e03d6a5d87b5272bee56cf69a956f68dc5c2` remain on the preserved weight-1 branches. The ledger and integrated resource review `d7f091b` explicitly retire execution after frozen-quality/resource failure; their evidence/report commits are already integrated. The obsolete wrapper is not accepted reusable work and is not copied over the later mandatory containment adapter. No fit/reload/evaluation was reopened.

**Topology-only merges:** `af80c53a`, `61a2df5a`, `7678c07c`, `4bc3e768`, `d00f205d`, `ab104e18`, `19bcfc5b`, `dbfb2e6b`, `fc83d6be`, `7092714f`, `fc8db390` contain no combined-diff content; their non-merge constituent work is accounted for by patch matches above. The detached data-policy worktree at `36385b1605e16d50863448b411045ee42cf45913` is an ancestor of staging. Cached remote-only history contains 36 old handoff-document commits, not another local finished implementation lane; no fetch or remote mutation was performed.

## Newly integrated FUSION-01

The original active/excluded instruction was superseded by the lead's authorized completion callback, recorded in [the assignment amendment](../../orchestration/PARALLEL_20261002.md#integrate-02-scope-amendment--lead-callback-2-october). The owner had stopped; the lead accepted the four-path correction against the completed independent review, matched its receipt/23 physical/four Git pins and ran one passing literal-key regression. This task rechecked the completion receipt, **23 distinct physical pins (26 references)** and four Git pins, and reused the saved native/source proof.

| Accepted source commit | Integrated commit |
| --- | --- |
| `671b4141c81348f95d6d539c4bb53e2a39aa9158` | `91e93622bc64a6d4419b63b8b43ca08f095d9c93` |
| `9ea4e9e6152726c9752262d02c16201612f9ae06` | `63f8a71c13e50074f404c0b3c109597085f39ba6` |
| `3f2cb3e71dc65c12672c500a099ca949a1d2c840` | `fffbec15669cba3eb1189f3a938e03e907b27194` |
| `bbaad609bedac6fcded9a81d3272b475e9d834e2` | `6c74ab367f511f1b30001b1b7b1ef53c99dd68eb` |

Registration/export/manifest/generated handoff commit: **`15dd8a9efcd62a4632a8e1f8035cab301116882f`**. The existing controller check now imports the production EvidenceModule, catching a missing controller/provider registration without opening a listener. No new source reader, job authority, storage authority or frontend implementation was added.

The route is `POST /api/v1/usp/evidence/source-fusion/context`: 2–8 exact accepted document/CityJSON sources, at most 25 explicit fragments, private/no-store, strict bounded reads and a final aggregate authority check. Literal own JSON keys survive safely; fingerprinting follows validation of the actual returned body. Association, frame alignment, geometry qualification, rights and matching remain `not_assessed`.

Completion receipt `E:/BhuAayam-data/task-data/desktop-source-fusion/literal-correction/completion-receipt.json` is 8,133 bytes, SHA-256 `e0e0897ea3a9b51fedffa1c1159cced2ea5c2cd6b26de18eddc55a0191089524`. The ordinary saved reference-document/D1 context remains 16,875 bytes, SHA-256 `92bfe44612eecbfdb000bc8b3cd7e6a8b25a56d023827967b7be2613c968e8b0`. Reconstructed historical CityJSON result metadata retains its explicit reconstruction label; neither it nor reference-document prose becomes new operational evidence.

## Accepted DATA-FUSION-01 follow-up

The lead's accepted data callback crossed the first completion message and explicitly retained sole staging ownership for this bounded addition. The lead confirmed no intervening staging/index write. Exact candidate `80514149f995f549301c03563a08219bf235fb16` maps to **`be0544dba8645278e25e0ccffff95ef9174ee7da`**, adding only [the runner](../../../scripts/usp/desktop-plan-extraction.py) and [handoff](plan-extraction-handoff.md). It was absent by patch comparison before integration. The lead inspected both files and matched five receipts/24 referenced physical pins; this integration rechecked the five immutable receipts, nine original/output pins, accepted runner Git SHA-256 and source-only syntax (exit 0). No extraction, metadata render or OCR was rerun, and no moving production file was inspected as a finished result.

All three unchanged T3-1/T3-2/T3-4 originals genuinely produced one page, zero text/parts and `needs_ocr`. The local environment used pypdf **6.10.0**, versus production **5.5.0**; this mismatch remains explicit and prevents production-runtime qualification. Measured T3-2 is **2586 × 1694 points**. The existing 2000-point full-page precheck refuses it before considering a region, so **no OCR ran**. Prior visual floor/title evidence, multiple-floor scopes, G+41/G+42 conflict and unknown current approved revision remain separate from machine outputs. No accepted API artifacts, canonical links or learning labels were fabricated.

The subsequent **OCR-LARGE-PLAN-01** continuation in the same document-owner worktree is excluded. Its renderer, OCR-frame contract, tests and context/pin compatibility code remain under that owner's exclusive control. No production OCR/contract change or regenerated API publication is needed for this two-file local checkpoint.

## Checks and preserved evidence

| Command/check | Actual result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` in integration worktree | exit 0; locked offline packages, zero downloads; manifests/lockfile unchanged |
| `pnpm exec tsx --test tests/source-fusion.test.ts` | exit 0; seven controls pass, including incomplete native input, literal keys/hash, final authority revocation and bounds |
| `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/source-fusion.controller.test.ts` | exit 0; one production-module/no-listener route/provider/guard/filter/body/no-store check |
| `pnpm typecheck:backend` | exit 0; server and API |
| `REPO_DATA=false pnpm --filter @ulpin/api exec tsx --tsconfig tsconfig.json scripts/openapi.ts` | exit 0; 217 operations / 249 schemas, no listener/domain call |
| `pnpm --filter @ulpin/api-client generate` and `typecheck` | both exit 0 |
| JSON comparison against dispatch OpenAPI | exit 0; all 216 prior operations and 247 named schemas exactly equal; one route/two schemas added; new `x-runtime-verified=false` |
| `python scripts/api/build-dataset-catalog.py --check` | exit 0; existing catalogue unchanged |
| `python scripts/api/check.py` on integrated staging | exit 0; all pins, manifests, models, links and runtime evidence references valid |
| OpenAPI generator `--check` on integrated staging | exit 0; generated catalogue matches |
| `python docs/usp-agent-handoffs/tools/validate_handoffs.py` | exit 0; document consistency only |
| Git whitespace / owned-path / parent-chain checks | exit 0 |

One initial API checker call in the new integration worktree exited 1: its checkout materialized the historical `docs/evidence/usp/cityjson-validation-runtime.json` as CRLF, while its immutable expected hash is the LF Git blob. Read-only comparison proves that sole difference and the correct canonical hash; the original staging physical receipt already matches. No receipt, fingerprint or EOL rule was rewritten. The unchanged checker subsequently passes in integrated staging. Test runs above are code/in-process checks, not HTTP/SQL/object persistence or fresh source accuracy.

Eleven selected historical acceptance receipts (IFC correction, Qwen host-loader correction, GeoParquet review, CityGML correction, images review, PDF verification, DXF closure, glTF correction, archive companion closure, KML review and FUSION completion) were rehashed against their linked review/handoff SHA-256 values; all match. Existing broader source/process/review campaigns were reused, not rerun. Source index gets only the new context capability/limitation note; `datasets.json`, original source bytes and historical receipt pins are unchanged.

## Worktree preservation and next work

All 18 worktrees and 109 branch names are retained. Only this integration branch and staging are written. `main` remains `16220977b127dbdad8953c899a38f37e8c6a53d6`; no push, deployment, service activation, Docker/socket action, database, provider/model/GPU work or process termination occurred. No owned process remains.

Preserved dirty paths:

- `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`: the two status entries `services/geo/geo/cityjson_processing.py`, `services/geo/geo/native_cityjson.py`, plus untracked `.pnpm-store/`; no normalization or cleanup.
- `C:/Users/kvina/.codex/worktrees/backend-review/3d-ulpin`: physical EOL/status entries `services/geo/geo/area.py`, `services/geo/geo/native_archive.py`, `services/geo/geo/native_pdf.py`; no index refresh/write or normalization. Status entries had empty content diffs and were deliberately retained.
- `E:/Projects/ulpin-ab-isolated-implementation-20260923`: all 19 staged additions under `ab-task/`, including `solution.zip`; their saved physical hashes and staged path state are preserved.
- `desktop-plan-extraction` remains independently owned. Only exact accepted DATA-FUSION-01 commit `80514149` is integrated; its moving OCR-LARGE-PLAN-01 continuation remains excluded.

No unresolved accepted finished-code delta remains in the audited local lanes. Actual next backend work is:

1. Complete the independently assigned OCR-LARGE-PLAN-01 selected-region path for the observed oversized T3-2 page; then assess its actual cited output against retained visual observations. Native extraction is now accepted but has no readable parts. Preserve multiple-floor scopes, G+41/G+42 conflict and unknown approved revision. Retrieval/ranking/reconciliation still needs usable inputs and separate scope; no qualified relationship labels or model fit are implied.
2. Once the existing Docker environment is restored through its separate authorized owner, perform FUSION's current accepted-source HTTP/SQL/object-authority journey. Reuse existing code/proof; do not fabricate accepted rows or bypass historical producer pins.
3. Under the same runtime dependency, generate an IFC profile/2 for the exact integrated runtime and finish its canonical persistence flow; finish the previously accepted officer-reference review persistence check. Neither is a reason to replay completed local/native campaigns now.

Delegated staging integration ownership is released to the lead by the completion callback after the documentation commit. This bounded integration task stops; continuing project work remains with the lead and existing owners. GF0 stays open.

## Complete local-branch map

Snapshot heads below are exact local observations; source FUSION's returned head is included after its callback. The integration/staging rows show the audited dispatch base; the new FUSION/registration commits above record their subsequent advance. Branches prefixed `task/desktop-` are abbreviated to their suffix in this table. `ancestor` means already reachable, not fresh acceptance of every historical capability; `patch` means the head's stable patch match, with earlier branch commits reconciled as described above. Retired and active lanes are explicit.

| Local branch (prefix rule above) | Snapshot head | Staging equivalent / disposition |
| --- | --- | --- |
| `feat/studio-reference-rebuild` | `da00fc1dfa38` | ancestor; preserved |
| `feat/ulpin-ab-isolated-implementation-20260923` | `777c978cb333` | ancestor; preserved |
| `feat/unified-spatial-foundation` | `ee661068f5ba` | ancestor; preserved |
| `feat/uttam-nagar-google-open-buildings` | `680981d90000` | ancestor; preserved |
| `feat/uttam-nagar-map-registry` | `680981d90000` | ancestor; preserved |
| `feat/uttam-nagar-study` | `16220977b127` | ancestor; preserved |
| `main` | `16220977b127` | ancestor; preserved |
| `staging` | `b4fe12eb0514` | dispatch base; advanced as recorded above |
| `ai03c-prefix` | `d7bc97ac3d6e` | patch `7b76708b1d59` |
| `ai04b-documents` | `9f3eea20a79c` | patch `5abc0beaeb76` |
| `ai04c-scan-trial` | `23d6e88b05a8` | patch `a813636e5199` |
| `ai04d-native-documents` | `cc144e5fe873` | patch `3ef4c6ffde66` |
| `ai04e-xlsx` | `6f62c4ed354b` | patch `ccbfed487fcd` |
| `ai05a-raster` | `1e40adbb8cce` | patch `81aef7136948` |
| `ai05b-points` | `385f793fa964` | patch `78a4ee31c6ee` |
| `ai06a-corpus` | `448c95c9edf6` | patch `b68e6627dff1` |
| `ai06a-training-coverage` | `dfd54ab08e48` | patch `54d638a6f9d5` |
| `ai06a-v7-fit` | `91a582eb89d2` | patch `f53635aa940e` |
| `ai06b-qwen-comparison` | `cb2bafd5c8e5` | patch `825fee264114` |
| `ai06c-v8-corpus` | `58a76687a832` | patch `a8a9edc61e7f` |
| `appcontainer-audit-review` | `86e991d00d79` | patch `0fa1563d48bf` |
| `appcontainer-correction-review` | `b01ab0fd5515` | patch `9d622263b1a3` |
| `archive-member-api` | `a15ebc55b383` | patch `e7e806a3f7a6` |
| `archive-member-api-review` | `1710e871fae3` | patch `f3fd8c0e823e` |
| `archive-member-reader` | `2b995d2ec531` | corrected/subsumed by `c68b51b` |
| `archive-member-review` | `998e8f9b0d45` | patch `2d5dcd904802` |
| `association-crosswalk` | `efaed669ac54` | ancestor; preserved |
| `association-crosswalk-recovery` | `5d14c939494d` | patch `82952e7bf8c7` |
| `association-sources` | `17e0c1198fdf` | patch `b0ddefbd2d98` |
| `backend-review` | `4010db750612` | patch `a4106f9cd7ba` |
| `building-ledger` | `2fcae26b73fa` | patch `e62609b9218d` |
| `bundle-correction-review` | `95a736e5434e` | patch `872b3ce6ec11` |
| `bundle-inventory` | `89815011f484` | patch `43bbaeed5e1a` |
| `bundle-inventory-review` | `135f3db90e40` | patch `a23ae3f34cec` |
| `canonical-exchange-path` | `a49ce108d207` | patch `46965e912761` |
| `citygml-native-audit` | `6b179ff9a502` | patch `dd87fdaf4deb` |
| `citygml-native-reader` | `a4dce87d0998` | patch `f44931b2f862` |
| `cityjson-admission-assessment` | `6990bd81f8bd` | patch `5c92d9d477ad` |
| `cityjson-admission-readiness` | `3a44b6cc918c` | patch `aadb485e31d2` |
| `cityjson-api` | `2c19bb415ac9` | patch `d5d6a9532e09` |
| `cityjson-api-review` | `6537c217074f` | patch `147d80d6f52f` |
| `cityjson-draft` | `4525459c32b4` | patch `ee97f70c9edd` |
| `cityjson-draft-review` | `c16a5f41129c` | patch `0b5af5315ab6` |
| `cityjson-officer-review-audit` | `4b06a068343d` | patch `8e5cb93dea4a` |
| `cityjson-reader` | `d46b1860b0e6` | patch `2c3777f3786a` |
| `cityjson-reader-eol` | `9995539427ef` | patch `31b458dcd331` |
| `cityjson-reference-binding` | `f984860b6ca6` | patch `b8353039dcc4` |
| `cityjson-reference-evidence` | `ec2290716e1b` | patch `eae0b7c5df8d` |
| `cityjson-reference-officer-review` | `9123956b96f3` | patch `420aa1ee4255` |
| `cityjson-reference-review` | `57664a05ccd9` | patch `76e8356091d8` |
| `cityjson-validation-jobs` | `2dd6bd711995` | patch `633a20f8c795` |
| `cityjson-validation-review` | `67208762989b` | patch `29445694be06` |
| `cityjson-validity` | `591305067ec5` | patch `4effe462bfd2` |
| `docling-tesseract` | `a1f769ba0a73` | patch `1cb1be0ef0cf` |
| `docling-tesseract-review` | `fe613b48bcc7` | patch `b130f8247bdd` |
| `document-association-preview` | `63f82c29db60` | patch `c8d3b17e07e4` |
| `document-association-review` | `f0393471b6d0` | patch `35d0e70f87c2` |
| `document-images-audit` | `7fe24f43fcd6` | patch `691ec98c1b90` |
| `document-pages-audit` | `d7afd46fdb5d` | patch `56d339b6caf3` |
| `drawing-relationship-review` | `c25e3f90165b` | patch `ddcb1357d9fa` |
| `dxf-native-audit` | `3f675e4af12c` | patch `aa6b79186d9f` |
| `dxf-native-reader` | `ce3b341128a6` | patch `2e10a217392a` |
| `geoparquet-native-audit` | `f5521f8a48eb` | patch `37e97cee235d` |
| `geoparquet-native-reader` | `2679ee5cfa0d` | patch `47c400b3c76f` |
| `gltf-context-audit` | `44812c1c3a5e` | patch `00a938fd1cde` |
| `gltf-context-reader` | `5001f7c180b6` | patch `63462ccf4510` |
| `haryana-approval-evidence` | `b0888340887c` | patch `126bdb0165f5` |
| `ifc-api-audit` | `25c71149ccbb` | patch `83964905c4d8` |
| `ifc-correction-audit` | `e7ed6c0d6da0` | patch `205bdb111f89` |
| `ifc-native-audit` | `e297b44d61ee` | patch `cbb4a2529360` |
| `ifc-native-reader` | `6f3957f90d69` | patch `236e7b6e1ce7` |
| `ifc-private-api` | `b1c0b170c7a1` | patch `fb3a78139fe6` |
| `integration-20261002` | `b4fe12eb0514` | this assignment; advanced as recorded above |
| `kml-native-audit` | `90169d0389d5` | patch `7b7ac398981c` |
| `kml-native-reader` | `b66ab2d9e664` | patch `9caafd297594` |
| `learner-technique-research` | `92853758a7bc` | patch `a8e0366158f7` |
| `ledger-rereview` | `43ba98cfdd1f` | patch `55586a6f86d3` |
| `ledger-review` | `fcdd7c6bd86a` | patch `49e4c2993631` |
| `model-egress-audit` | `8a7b3836d3d8` | patch `1fa6ad8999b4` |
| `model-egress-enforcement` | `5c536ff8f432` | patch `911471875cdd` |
| `model-egress-enforcement-audit` | `e692b7ac70db` | patch `a1c1edb18c52` |
| `pdf-bounds` | `899592e726ba` | patch `61d0008b4fb1` |
| `pdf-review` | `0f887a792729` | patch `4580b0c16d41` |
| `plan-extraction` | `b4fe12eb0514` | later accepted `80514149 → be0544d`; moving OCR continuation excluded |
| `plan-windows` | `b67441dd240a` | patch `a6944c064f80` |
| `point-review` | `1f659aa2d338` | patch `69d418098a1c` |
| `prediction-model-fit` | `1b84e5299e9b` | patch `42ae7bde8284` |
| `private-document-images` | `1ec741413bab` | patch `52e36d682886` |
| `private-document-pages` | `4f81f09f435d` | patch `64a2fbade41b` |
| `private-ocr-jobs` | `05ebec4ce5c8` | patch `0272544cb92e` |
| `prototype-reuse` | `2e284bb785a3` | patch `19c7c92f4d11` |
| `qwen-lora-network-review` | `320bda8a108e` | patch `973393a4cc1a` |
| `qwen-lora-v8` | `7659b88c5dac` | patch `030caf34fc4c` |
| `qwen-lora-weight1` | `f41ae65b6895` | evidence patch `eaeb9d214f15`; four implementation commits retired |
| `qwen-review` | `9b6fe452ef2e` | patch `7482545055e4` |
| `reference-document-enrollment` | `6ac3d0342585` | patch `01bf8e1de981` |
| `reviewed-document-links` | `d8ef8193692a` | patch `5fc9982c4b2b` |
| `reviewed-document-links-review` | `e8d35eea5c30` | patch `d95b58b0a241` |
| `scan-review` | `2fd401cfc7fa` | patch `cc110a9147af` |
| `source-fusion-audit` | `1b11fe8b5a25` | patch `480d497be88d` |
| `source-fusion-context` | `bbaad609beda` | `6c74ab3` + registration `15dd8a9`; now integrated |
| `source-key-01` | `78f3dd092119` | patch `eda98cb2d550` |
| `source-ocr-adapter` | `da5f0706f0bd` | patch `46454b8aa231` |
| `v7-review` | `e5b614325909` | patch `1ade382e599b` |
| `v8-source-review` | `ff27bccd3ed8` | patch `d6ab5fdcef6e` |
| `weight1-resource-review` | `c05ccbe65669` | evidence patch `d7f091ba580f`; four implementation commits retired |
| `whole-page-ocr` | `92eb55642a7e` | patch `ab9930d024b6` |
| `xlsx-correction-review` | `0264f415a333` | patch `d0580078e0dd` |
| `xlsx-review` | `630dbae52761` | patch `d2e2236dcc9c` |
