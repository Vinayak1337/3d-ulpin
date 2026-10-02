# FUSION-DXF-01 — accepted drawing fragments in combined context

3 October 2026. Code **`9eb6664d14d80c3407df6882d57969ababae58a5`**, base **`fd36a4b964e2c8855c17a9169c5efe43b03f6712`**, branch `task/desktop-fusion-dxf-context`, assigned checkout `C:/Users/kvina/.codex/worktrees/desktop-plan-extraction/3d-ulpin`. [Assignment](../../orchestration/PARALLEL_20261003.md) at `8668a2f2`; primary staging was read-only, observed at `408efe0838d9d5a1d80ab01ccf2b197fdd230dec`. Completed CARD-PDF branch is preserved.

## Delivered

Existing `POST /api/v1/usp/evidence/source-fusion/context` accepts `{kind:'dxf', pin, entityOrdinals:[...]}` alongside document/OCR/CityJSON/IFC. Ordinals select 1–25 unique top-level native records, within the existing aggregate 25-selection limit. Response preserves exact selected entities, source tags/text/handles/locators, parser/encoding, declared or absent units, header/layers and referenced block definitions. Source/result/input/artifact/selection/record hashes retain their separate meanings. Selection hash uses the source digest, artifact digest/size and sorted ordinals; an identical artifact's storage key does not affect it. Blocks are not traversed or exploded; no transform, matching or analytical geometry is inferred.

Admission reuses canonical `dxfStatusTx`, source/private binding, current family/reader checks and exact accepted-attempt/result assertions. Existing complete-set locks and before/after read authorization remain; tool checks run outside SQL locks. Exact bounded receipt/artifact reads and summary reconstruction use existing DXF keys/contracts, aggregate 64 MiB allocation, 30-second deadline and 1 MiB response limits. Older variants/version/hash bodies are unchanged.

DXF is **context-only**. Association literals/manual selection and reviewed citation attachment explicitly refuse it with `SOURCE_FUSION_DXF_CONTEXT_ONLY`; no DXF fragment is silently discarded from an accepted context. Citation return narrowing preserves existing registry consumers after this refusal. Registry, shared DXF intake/config/jobs/source protection, frontend and generated publication are untouched.

## Checked evidence

Reused unchanged MIT ezdxf v1.4.3 development originals and saved native/status artifacts from [the retained manifest](native-dxf/manifest.json), plus the authentic [EPSG 7415 saved document](reference-document-enrollment/manifest.json). These drawings are `test_only`, with no Indian operational or matched-property assertion. No parser rerun or new acquisition.

- `1_polylines.dxf`: ordinal 33, TEXT handle `CB`, exact `5 overlapping rectangles: lines`, tag 1468 / original lines 2937–2938, declared metres. Selected record/locator/literals match unchanged native bytes and original text lines.
- `ASCII_R12.dxf`: ordinals 0/1 preserve block TEXT handle `4A2`, escaped decoded text, INSERT handle `1DE` and `*U1` reference. Units and scale/rotation stay absent; parser-default encoding remains labelled. One exact referenced block definition is returned without expansion.
- Combined context includes exact document fragment `  <gml:name>RD + NAP height</gml:name>`. Association stays `not_assessed`; canonical targets remain empty.

Private evidence root: `E:/BhuAayam-data/task-data/desktop-source-fusion-dxf-20261003`.

| Output | Bytes | SHA256 |
| --- | ---: | --- |
| `retained-projection.json` | 67,868 | `4e1e47b39814e89da1b092d3f617869b1abf5c3ce09f38e2b5f326fc75165a9f` |
| `retained-r12-projection.json` | 46,105 | `2735c9dc337ac9f2d9a1fd5920bfcf6628ed485c1e03d5ff641be3ef8cb3613a` |
| `controlled-context.json` | 68,335 | `3b70c211436066e711713f71e153f050952a6a2fa9d97778cff4075914827df8` |

The historical full DXF accepted input/result envelope was not retained. Pure retained projections use actual saved metadata; separately named controlled selection/context exercise production methods with labelled memory-only SQL/storage/IDs/job envelopes/tool checks. No exact historical accepted job is manufactured. Compact controlled response is 28,678 bytes; context hash `6f0c23315fffa3ff0b6e80a041f28bcb74f15a4afa4085ce07a47f1be87cc276`. The older saved OCR context still reproduces `12058b2711142152e577c0ac2b3dd4e87d17ef64c1e58333421ff12003344a48` and original saved-file SHA `5fbcac319122d09b32db6e6c03de6461fc581d58adbb45e4101498c3115702e9`.

Final checks exited **0**:

- `pnpm exec tsx --test tests/source-fusion-dxf.test.ts tests/source-fusion.test.ts tests/source-fusion-ifc.test.ts`: **16 pass, no skips**. Three new DXF checks cover real literals/incomplete R12, wrong selection/result/artifact pins, explicit context-only refusal and complete-response denial on revocation during later document I/O. Two aggregate captures, no object I/O/tool inventory under SQL and zero writes.
- Existing `grounded native/OCR proposals` check: **1 pass**, via `pnpm exec tsx --test --test-name-pattern 'grounded native/OCR proposals' tests/usp-source-fusion-associations.test.ts`.
- `pnpm typecheck:backend`; `pnpm --filter @ulpin/api-client typecheck`; `git diff --check`; `git diff --cached --check`; private `receipt.mts`: pass. Initial new test failure used the wrong document-part property, then was corrected. Prior checkpoint's exhaustive-union typecheck failure was fixed in the owned citation helper; final server/API checks pass.

Completion receipt `completion-9eb6664d.json`: **10,900 bytes**, SHA256 **`ef444b221bdad6d26f5cf8da1f4de8c1f8baf826076426b99aeb654df5b4e15c`**, eight physical/Git code pins and 19 evidence/source pins.

## Integration and limits

Lead needs only the existing controller operation summary to add DXF, and additive request/response OpenAPI/client republication plus the source-catalogue/ledger handoff. Existing root exports, service/controller/module registration suffice; no new route/store/migration. Shared association request schemas now expose the additional selection alternative, but association/citation use remains explicitly unsupported.

This base uses strict `assertDXFTools` for fusion reads. KML-02 exclusively owns shared job/fingerprint historical-read compatibility; lead must reconcile this call with that lane's canonical immutable-read helper if supplied. No local exception or compatibility allowlist was added here. Fusion-only files are outside `DXF_CODE_FILES`; this branch does not change the base DXF code aggregate.

Current HTTP/PostgreSQL/private storage and actual runtime-tool admission remain **unqualified**. No property/floor identity, geometry/global placement, rights, learning, performance or release gate is qualified. Original bytes/lineage remain preserved. Supplied permissions: never/danger-full-access; requested Sol6.1/xhigh/default-standard, actual per-turn model/effort/tier unexposed. All owned checks exited; no owned native/service/model/GPU/provider process remains. Worktree returns clean after handoff; no push/deployment, polling, schedule or further task creation.
