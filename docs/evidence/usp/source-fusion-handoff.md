# FUSION-01 — source-first combined evidence context

**Integrated and registered, 2 October:** accepted original/correction commits map to `91e9362`, `63f8a71`, `fffbec1`, `6c74ab3`; `15dd8a9` adds the root contract export, EvidenceModule controller/provider and operation manifest, with generated OpenAPI/client. The private context route is now registered: 217 operations / 249 schemas, all prior 216 operations / 247 schemas unchanged. Seven integrated fusion controls, the production-module no-listener control and backend/client typechecks pass. The [review correction is closed](desktop-backend-review/source-fusion-review.md); [reconciliation](finished-work-reconciliation-20261002.md) records receipt checks and the current limits. Saved ordinary context SHA remains `92bfe44612eecbfdb000bc8b3cd7e6a8b25a56d023827967b7be2613c968e8b0`. No real HTTP/SQL/object-authority run or model/association qualification follows. Candidate instructions and observations below retain their historical scope.

Code candidate `671b4141c81348f95d6d539c4bb53e2a39aa9158` delivers a private stateless document/CityJSON context service and proposed controller. It accepts 2–8 exact accepted sources and at most 25 explicitly selected parts/objects, without requiring any recorded building. Source membership is operator selection; association, matching, geometry qualification, cross-source frame alignment and rights remain `not_assessed`. No links, canonical targets or learning labels are created.

Assignment [FUSION_01.md](../../orchestration/FUSION_01.md), dispatch `4f6ca13858823c9453ca14854aa81ed81a2700f1`; branch `task/desktop-source-fusion-context` in `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. The prior glTF branch is preserved at `5001f7c180b6249c80f8d934f549df86fae76d80`. Read-only staging observation during final review: `a1c3460033b01831e02a106fe23d7a627036a50e`; the candidate stays on its assigned dispatch base for lead integration.

## Behavior and authority

The strict discriminated request pins case/source revisions and hashes, accepted job/result, reader, input fingerprint, accepted fence and result length. Document selections may be empty to retain an incomplete native capability. CityJSON objects require explicit native IDs. Equal object IDs and names across files remain separated by case/source/revision namespaces. The reproducible fingerprint uses canonical source/selection ordering and the existing fingerprint function.

Document projections retain exact selected text, part/text/source hashes, typed locators and native redaction markers. Native `needs_ocr`, unsupported, encrypted and tool-error states remain source-level gaps; assisted outputs stay outside this profile. CityJSON projections preserve selected native IDs/pointers/types, literal attributes and hierarchy links, geometry presence/type/status/LoD, source metadata, frame and transform declarations, and hierarchy issues. Absent declarations and declared null values stay distinct. Geometry/vertex/boundary arrays are omitted; exact artifact hash and pointers remain. Source-native IDs, prospective matching inputs and official/canonical identities remain distinct.

Both authority captures use the existing source-case advisory gates, ordered case UPDATE locks and selected-source SHARE locks before reusing `associationDocumentInputTx` / `acceptedCityJSONTx`. Existing authorities recheck current access, source/case/producer pins, job payload and accepted attempts. A single final aggregate transaction runs after **all** object I/O and compares the exact input/reader/fence capture. No persistent SQL or storage write occurs. Source-row prelocking also protects the document helper's read-before-lock sequence against same-revision drift. Locks are released between captures; no object read occurs inside either transaction.

The existing deadline-aware transaction runs a SELECT guard before its callback, so an isolation-level change there would be too late. This implementation uses canonical locks for both coherent captures rather than changing the shared transaction helper. Database runtime verification remains unrun.

Received request bound: 64 KiB / 5-second body timeout. Service bound: 30 seconds including reads and final authority, 64 MiB aggregate artifact-byte reservations, 1 MiB response with 8 KiB reserved for the USP envelope. Individual accepted document results retain their 4 MiB bound; CityJSON results retain 16 KiB and artifacts 32 MiB. JSON depth is limited to 64 and visited values to two million. Existing `openObjectStream` enforces exact declared Content-Length before collection, cancellation and deadlines; the service verifies actual bytes/SHA and native text/continuation integrity. Existing whole-buffer readers have no cancellation argument, so their schemas/key/integrity conventions are reused over that existing bounded stream without changing any shared reader or storage client.

Private source failures return a common message without partial fragments. `PrivateSpatialGuard`, `EvidenceExceptionFilter` and `private, no-store` apply. The USP envelope intake scope anchors the first canonically selected evidence case; every source retains its own case/revision pins. That envelope is not a common property or cross-source relationship assertion.

## Saved real-output check

Private proof: `E:/BhuAayam-data/task-data/desktop-source-fusion/`. `projection-receipt.json` is 8,538 bytes, SHA-256 `99f40fe4ae7315092df3d18ec2d1355bfabbc8357d698842d79ce567b7198d6d`. The final completion receipt also pins the script, logs, all six code files (physical SHA-256 and Git bytes), and output files.

| Retained input | Bytes | SHA-256 |
| --- | ---: | --- |
| EPSG:7415 accepted native document result | 20,352 | `76aeb8d859c59e4af3d80eadaec3517c0bdee06b89a4a9fe8529a53a0021930c` |
| 3DBAG API documentation accepted native result | 412,076 | `4e94b38fb271b181fdf22bb97ca557b9eb7004b93e0c2c1f4a690e71202f9ce3` |
| D1 unchanged native CityJSON artifact | 33,168 | `634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e` |
| Accepted CityJSON result metadata reserialization | 1,941 | `c43beea3877c207a49c99f1348f390e7ae92627013f0bfc3cf95a0dc7f4db855` |

The two document inputs use reader `e745ab9bf180da35d3fd59be8021da0f0944b203b34debb83549a590921d6166`; CityJSON uses `377edfe71f3d08e0a1f4fb710441022b9a26fdadd0efa70724d0d1dea0f3d398`. All retained accepted fences are 1. Full case/source/job/input pins and exact selected part/object IDs are in the proof receipt and `selection.json`; document origins/versions/permissions remain in the [accepted enrollment manifest](reference-document-enrollment/manifest.json).

The original raw CityJSON result file was not located in the bounded retained-file search. Its receipt metadata was deterministically reserialized from the unchanged saved status fields and accepted job payload in `desktop-cityjson-reference-runtime/baseline.json`. Its bytes and SHA match the previously recorded bucket length and accepted attempt hash exactly. The receipt explicitly labels reconstruction, and the unchanged native artifact is independently hash-verified. This is no new acquisition, original-native extraction or fabricated source observation.

The actual bounded result adapters read those private retained bytes through an in-process stream adapter, then pure projection combines five exact reference-document parts and both D1 objects. Aggregate artifact reservation is **467,537 bytes**; compact response data is **11,902 bytes**. Saved pretty `context.json` is 16,875 bytes / SHA-256 `92bfe44612eecbfdb000bc8b3cd7e6a8b25a56d023827967b7be2613c968e8b0`; context fingerprint is `5e84138f7202679ee38fb15bdd3069f4e3a06c50b4a0c21eb62c6d551925724d`. Input hashes were checked unchanged after the proof.

These documents retain their **reference-document** role and D1 retains its **foreign exterior test** role. They are not matched building/floor documents, Indian operational evidence, qualified ML relationships or geometry/accuracy/rights qualification. **Current accepted authority and HTTP remain unrun**; historic producer pins were not rewritten or retried.

The [accepted Haryana crosswalk](association-crosswalk/review.md) and [approval evidence](haryana-approval-evidence/README.md) remain the next separate same-planned-drawing-set target: T3-1/T3-2/T3-4, explicit floor scopes, G+41/G+42 conflict and unknown current approved revision. Review prose was not converted into native results or training labels. Missing-sanction discovery remains closed.

## Verification

Final stabilized commands, all exit **0**, run from the assigned worktree:

- `pnpm exec tsx --test tests/source-fusion.test.ts` — six focused controls: strict bounds, heterogeneous ordering/exact selection/namespace separation, incomplete capability, same-revision drift, source A revoked while reading B / one final aggregate denial / zero writes, and allocation/hash/depth/response/deadline bounds.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/source-fusion.controller.test.ts` — one local-module no-listener check: exact provider/guard/filter/route/schema/error metadata, received-byte rejection and no-store. Production module registration is deliberately excluded.
- `pnpm typecheck:backend` — server and API.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-source-fusion/projection-proof.mts` — saved-output bounded adapters and pure heterogeneous projection described above.
- `git diff --cached --check` — owned code/handoff whitespace.

Focused authority tests use technical transaction/row controls; they are code checks, not real DB transactions. No API/DB/Docker runtime, GPU, model inference/fitting/held-out evaluation, new source discovery, labels or operational rows ran. The in-memory Nest app was closed and owned commands finished; no listener or owned process remains. Dependencies were installed from the locked offline cache with scripts disabled; no manifests/lockfiles changed. No frontend, compatibility route, registry, shared reader/job/authority or generated handoff file changed.

Supplied actual permissions: `approval_policy=never`, `sandbox_mode=danger-full-access`. Requested GPT-6.1 Sol/xhigh/default-standard. Exact actual model/effort/per-turn service tier is unexposed; no per-turn tier change is claimed.

## Exact lead-owned integration

The candidate controller is **not registered**. Lead must wire and regenerate the API/client/catalogue before claiming an endpoint delivery. No additional helper change is needed.

Add to `packages/contracts/src/index.ts`:

```ts
export * from './source-fusion';
```

Existing server subpath exports already resolve the service; no server package export map change is needed. If a root service export is desired, the additive line is:

```ts
export {SourceFusionService} from './modules/usp/ingestion/source-fusion';
```

Add to `apps/api/src/modules/evidence/evidence.module.ts`:

```ts
import {SourceFusionService} from '@ulpin/server/modules/usp/ingestion/source-fusion';
import {SourceFusionController} from './source-fusion.controller';
```

Append `SourceFusionController` to the existing `controllers` array and `SourceFusionService` to `providers`. The proposed private route is **POST `/api/v1/usp/evidence/source-fusion/context`**.

Add one operation-manifest entry:

```json
{"method":"POST","path":"/api/v1/usp/evidence/source-fusion/context","operationId":"POST_api_v1_usp_evidence_source_fusion_context","disposition":"added","batch":"FUSION-01","controller":"SourceFusionController.context","requestSchema":"SourceFusionRequestSchema","responseSchema":"SourceFusionContextSchema","runtimeEvidence":"pending","access":"PrivateSpatialGuard; private, no-store; 2–8 explicit accepted document/CityJSON source pins; 25 parts/objects total; final aggregate current-authority check; association not_assessed"}
```

Then republish OpenAPI and the generated API/client/catalogue through the lead-owned pipeline. The new controller metadata check remains usable before registration. Existing single-document preview, recorded-target citations and consumer compatibility are untouched. This candidate does not advance runtime, learning, scale, release or deployment gates.

## Literal-preservation correction — 2 October

Code correction `3f2cb3e71dc65c12672c500a099ca949a1d2c840` continues the preserved candidate `9ea4e9e6152726c9752262d02c16201612f9ae06`. The [independent review](desktop-backend-review/source-fusion-review.md), original commit `1b11fe8b5a2547f7cb35437f86e88b95a7334d2c`, established one P2: locked Zod's JSON record parser dropped own `__proto__` properties after the fingerprint was computed. Read-only lead dispatch head was `d7b1de4ae3e06c40f6157a87f8ff9bc492ee48a3`; this correction stays on the assigned branch for lead integration.

Fusion's dynamic declarations, frame and hierarchy-issue values now use a local literal JSON validator that inspects own data descriptors without rebuilding records or assigning dynamic keys. Nested legal own keys, including `__proto__` and `constructor`, survive with their ordinary object prototypes intact. Nonfinite/non-JSON values, accessors, non-JSON array properties, excessive depth and excessive value counts are rejected. No shared parser/fingerprint/authority/dependency changes were made. OpenAPI describes JSON scalar/array/object alternatives and dynamic own object properties. The response is validated first, measured against the existing response allowance including its hash field, then fingerprinted over that exact validated returned body.

One added focused regression covers nested own-key retention in attributes, frame, metadata and hierarchy issues; no prototype mutation; JSON wire/schema roundtrip; returned-body fingerprint equality; and rejection of accessors, nonfinite/undefined values and excessive depth. Only the affected existing read/response-bound control was rerun, alongside the existing no-listener controller conversion and backend typecheck. Completed authority/lock review and native/source campaigns were reused.

New proof files stay under `E:/BhuAayam-data/task-data/desktop-source-fusion/literal-correction/`; historical owner and reviewer receipts/files are unchanged. The actual fusion bounded-result adapters reuse the reviewer's saved 191-byte original and 1,251-byte native technical control, without rerunning Python. Corrected returned attributes match the review's pre-loss declaration exactly, and the returned body recomputes to the review's intended `6b88dc85c380eb59aa3d8ae2b54a17b0d84d1c1774baec20b7cc5ff6c5d551ca`. This remains an isolated synthetic technical control, with no operational job/source, authority transaction or training label.

The changed native declaration projection was also checked against the unchanged saved D1 artifact/result metadata, reusing the saved document projections. Ordinary context remains **16,875 bytes / SHA-256 `92bfe44612eecbfdb000bc8b3cd7e6a8b25a56d023827967b7be2613c968e8b0`**, with unchanged context fingerprint `5e84138f7202679ee38fb15bdd3069f4e3a06c50b4a0c21eb62c6d551925724d`. Input hashes remained unchanged. The correction proof receipt is **4,011 bytes / SHA-256 `7b11f16654e19fe813f2b221729f38749658b8b1e4ff961da7dc4b31f4d3eac0`**; its completion receipt additionally pins the correction code/Git bytes, handoff, scripts, outputs and observed checks.

Fresh relevant checks, all final exit **0**:

- `pnpm exec tsx --test --test-name-pattern='literal own JSON keys' tests/source-fusion.test.ts` — one new regression.
- `pnpm exec tsx --test --test-name-pattern='read allocation' tests/source-fusion.test.ts` — one affected bounds control.
- `pnpm typecheck:backend` — server and API; the running command completed with exit 0.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/source-fusion.controller.test.ts` — existing no-listener provider/guard/route/OpenAPI check.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-source-fusion/literal-correction/literal-proof.mts` — reviewer control reuse, unchanged ordinary projection and explicit literal-schema conversion.
- `git diff --check` and `git diff --cached --check` — correction code/handoff.

Three initial private proof invocations exited 1 because its import path and schema lookup were wrong (missing root Zod link, then `anyOf` lookup against the discriminator's `oneOf`). Their logs are retained separately; the harness now uses the installed locked Zod path and correct discriminator shape. These were proof-harness errors, with no production/runtime/source mutation; the final proof passes.

Actual supplied permissions remain never/danger-full-access. This continuation requested Sol6.1/high/default-standard; exact actual model/effort/per-turn tier remains unexposed. Only fusion contract/projection/test/handoff changed; no owned process remains. Registration stays lead-owned and the candidate awaits narrow review closure. Current DB/access/concurrency/HTTP, model/learning, geometry/rights and release qualifications remain unchanged and unrun.
