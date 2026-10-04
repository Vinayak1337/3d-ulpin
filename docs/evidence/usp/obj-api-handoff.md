# OBJ-02: canonical private OBJ intake

## Delivery and integration

Exclusive branch `task/desktop-obj-api` at `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`, assigned base `1adb4b1af20e693d6357efd3af5a95cfe7518626`. Completed OBJ-01 branch `task/desktop-obj-context@01f5ed0ec63cf72b65d4c6724b251469898b04f1` preserved. Staging read-only; observed clean `d1e8ccaa4ec6833a195ce805725f9839c8f3cb50` at handoff. Requested Sol6.1/xhigh/default-standard1x, per-turn settings unexposed; supplied `never`/`danger-full-access`.

- Code/runtime/controller: `bc50645d5d8142630f3c889beae87cc624d3322d`.
- **Exactly six additive shared seams**, separate commit: `0b59ea5338ef84de032932b851d8e83c2def64e5`.
- Focused check: `998b28635f13b7f076f784936d6c73c1bff62338`.
- This handoff follows those commits.

Bounded unchanged upload uses canonical sources/jobs/metadata/operations/outbox, a dedicated fenced worker calling the unchanged accepted OBJ CLI, private complete/partial status, exact native/original reads and idempotent explicit retry with current pins. Original downloads work without the native profile. `obj-native-v1` or an own `objOriginal` marker (including malformed/null) protects captured AND current sources from legacy snapshot/copy, generic/legacy retry and stream fallback. Literal polygons, signed indices, byte/line/span provenance, declarations and unresolved/unsupported inventories remain intact; unknown frames and context-only qualification remain explicit.

Lead owns contract root exports, module/controller/service registration, operation manifest, generated OpenAPI/client/catalogues and exact existing-reader immutable read aliases below. No module registration or HTTP service was started here. New routes after registration:

- `POST /api/v1/ingestion/cases/:caseId/obj`: multipart `file`, `requestKey`, `expectedCaseRevision`, JSON `lineage`.
- `POST /api/v1/ingestion/cases/:caseId/sources/:sourceId/obj/retries`: strict `ObjRequestSchema`.
- `GET /api/v1/ingestion/cases/:caseId/sources/:sourceId/obj/jobs/:jobId`: bounded status.
- Same job path plus `/native`: exact accepted artifact.
- `GET /api/v1/ingestion/cases/:caseId/sources/:sourceId/obj/original`: unchanged original.

Fresh profile recipe: `C:/Python313/python.exe -I -S -B scripts/usp/obj/profile.py --python C:/Python313/python.exe --scratch <existing-private-directory> --native-lock <fresh-private-lock> --output <fresh-private-profile>`. Configure service-process `ULPIN_OBJ_PROFILE` and `ULPIN_OBJ_PROFILE_SHA256`. Each checkout generates its own physical recipe; historical locks are not rewritten/repointed.

## Actual checks and pins

Reused both unchanged originals in the accepted [OBJ source manifest](native-obj/sources.json); no acquisition/reader campaign. Each has76 vertices,18 four-reference polygons,72 face references. Native artifact bytes exactly match accepted OBJ-01 outputs:

| Original | Source SHA-256 | Status | Artifact bytes / SHA-256 |
| --- | --- | --- | --- |
| `no_material.obj`,2142 bytes | `a57a1c5b94c28f37b6a049e73d6efe1cb293946e9b727b6dd733cc70dcd1974c` | completed | 129927 / `4bea5f798ed652597bcbb3c3ae8ff76b47f7d60919b65ffc97e234499645eaf3` |
| `missing_material_file.obj`,2294 bytes | `0011861ed58098a3524e973547549c4b73f05e3e00eec02d2e98e450a342e988` | partial;10 unresolved material declarations | 138294 / `bb1bb9c56f8330aa54146d7240c2bf0670fb5f91bb468634a8f4c51579a9dfd3` |

`pnpm exec tsx --test tests/obj-ingestion.test.ts`: exit0,1 pass/0 skips,19.848s. **Exactly one actual adapter/accepted CLI invocation per original**, disclosed in-memory canonical SQL/storage controls. Retention/idempotency, claim/accepted fence/outbox/status, exact artifact/original downloads, no-profile original access, retry admission and post-I/O access revocation/protected legacy-path refusal pass. Retry jobs admitted but not executed. These controls are not live HTTP/database/persistence proof.

Review then removed an arbitrary16384-component status-parser cap, preserving accepted unsupported arity under the16MiB artifact bound. Native wrapper/reader/profile unchanged; no native rerun. Execution code aggregate `6f12765bcc5a719ce845e263deda9cbc90a1b43c7a9b5aa8e9e28c4ee43d655f`; final physical code aggregate `3da3d08e63159b51d4f173ff0a1593d5edf0cfdf89d95bbcd033460da7120f9d`. Final `pnpm exec tsx --test --test-name-pattern='status derives' tests/obj-ingestion.test.ts`: exit0,1 pass/0 skips from retained actual native outputs. First pure-summary attempt failed `LOCAL_OPERATOR_CONFIGURATION` because the test unnecessarily used an authority fixture; fixed by hashing retained originals directly. Compact verification records that failure/correction without another native invocation.

Final `pnpm typecheck:backend`: exit0 for server/API. New Python helper/server `compile()` syntax: exit0, no bytecode writes. Staged whitespace: exit0. No unrelated suite repeated.

Actual native Job/process512MiB/one child/45s total: observed0.067337/0.056622s; peaks26054656/25980928 bytes. Separate Python host/tree Job1GiB/two processes/75s Node-enforced deadline: observed2.965421/2.898450s; peaks49680384/49811456 bytes. Host attached before profile/CLI import; native imported after inner Job attachment. Node/API memory, OS thread and egress ceilings are not implied. Canonical worker150s; input/output16MiB, small status/result512KiB; exact streaming object reads capped/cancellable.

Private root `E:/BhuAayam-data/task-data/desktop-obj-api`:

- `verification.json`: 11088 bytes, SHA`e0451a5c8848bff345039ed039bd28b74277b5dd83d32b697ca9b36548e368bb`; complete final code constituents, commands/exits, failure and cleanup.
- `current-profile01.json`:489563 bytes,2528 exact runtime/repository constituents, SHA`7de737b4d9642395bf3277ecce2a40452079426fa00130f0ced7478235827c40`.
- `current-native-lock01.json`:SHA`f77eef14b873477a1ceafaf4322ee7d9242815335fcb9fd5c71f61bbbcd5dbab`.
- `bridge-run01/no_material.obj.journey.json`:9093 bytes, SHA`8568be5e0bd65d4d711cf25687b82227427c7e56d7585d1b402887c9ec1bb827`.
- `bridge-run01/missing_material_file.obj.journey.json`:9097 bytes, SHA`3755430333e72c5d936912721b1dcf2b4dfb09377155d197c937fdb1e2288cd1`.

Reader aggregate `c2591f28100a7857db3769313f249193d4e6808103afc8d16504db022bca00a7`; wrapper/profile aggregate `0d2b157a60fbe1db18db3b50f566060ed5f8010efca207c2a310f0d6ec03be52`; committed adapter declaration SHA`fd2694fc22d16939cf86d3602e3200fd5f76e1cd878c93c56b8df5bcd126342e`. Reused read-only CPython3.13.7/std lib; no installs/large environment copy.

## Pre-change read compatibility

Captured **before shared-seam edits**, actual clean checkout/branch/assigned HEAD/time plus exact existing CODEFILES constituent paths/bytes/hashes: `prechange-read-pins.json`,22479 bytes,SHA`20d072f6bded423ff180e22728cd9ba45cfa2cb83861cb003b24c77d781fc830`. Physical and assigned-base Git/LF receipts are separate. Lead may add exact immutable-read aliases; writers/current tools and non-code runtime/source guards stay strict.

| Reader | Physical pre-change aggregate | Assigned-base Git/LF aggregate |
| --- | --- | --- |
| ifc | `b5db10a0e2b01c8d9941e99bb1a74d872185c0e80c7138ce8d023eb3d019a742` | `3f8e872b66b74886e9850d99bb13b12877e15fcc39db7508d1acf10eeb079247` |
| dxf | `c4192dbadeb7cbb819e97b00b53930577dee77e25b4f5500a4ccc9409de137e7` | `6d317ec105921543d3ce17bff115969ee89d2e4cfaa22477843f9fa173526bbb` |
| kml | `d010ddefa567afff305aa333458ca50cf5b338f4c6e9a812e5e3a15f54fbd5e4` | `16e65e18446b132b445eb133dcd67c0019179fc4a02351314a1d6a5c9e5a6e5b` |
| citygml | `8310d1e8abd384dda09ccbdf5ba9d7836f189f34d9d4c250aaa7cf1f6e5fc2a3` | `3ecd27225165fcb1bd5b76e9037c4792a35c9a15c79ad55647002e2026c7e1d5` |
| geoparquet | `f53fa951e99f578fe39f0b9e5c5b28ec2bc5636617d81f80c3f92df06cb9f2a8` | `15b55b6192ecf8345dfd05c4bc117e4d6f33288886d785e9da781f17ee796eec` |
| gltf | `0dd2070c9001591fad9263e06203bc8d3f316f0277db8fb4552a9464a918514d` | `a65e70ab797791693b65d0d23c42389fe10248856022a1d9264210301908ba3b` |

## Cleanup and limitations

Owned scratch empty, native PIDs21752/43316 absent, test exited0. New private profile/proofs retained; historical originals/artifacts/locks preserved. Shared services/caches/volumes untouched. No runtime enrollment, Docker/provider/GPU/frontend/dependency/migration/push/main/deployment work. Foreign unplaced graphics test_only lineage remains; no analytical geometry, transforms, triangulation, measurements, rights/accuracy/property identity/registry/learning promotion. Live HTTP/database persistence, universal OBJ coverage and release gates remain unqualified.
