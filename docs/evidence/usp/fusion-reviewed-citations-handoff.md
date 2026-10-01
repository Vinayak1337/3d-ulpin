# FUSION-03 — fusion to reviewed native/OCR citations

2 October 2026. Code candidate `6f958f791138b4f74d0ddf988ab4596755b70870` adds an explicit combined-source citation amendment to the existing registry building/floor correction workflow. Native citation v1 remains readable and unchanged in meaning; OCR uses separate `registry-document-ocr-citation/1` pins and never a native part UUID. Citation attachment remains `operator_selected`, with qualification `not_assessed`.

Assignment: [PARALLEL_20261002B.md](../../orchestration/PARALLEL_20261002B.md#fusion-03--reviewed-ocrnative-evidence-citations), dispatch/base `142a7c3f65c36d92359d8c65a923a88737f67fa6`. Branch `task/desktop-fusion-reviewed-citations`, exclusive worktree `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`. Preserved OCR branch `task/desktop-source-fusion-ocr@5440fb1d90dd2b5445cd44435b45a5640bffc415`. Staging was read-only and matched the dispatch pin when checked. Supplied permissions: never/danger-full-access. Requested Sol6.1/xhigh/default-standard; exact actual model/effort/per-turn tier remains unexposed.

## Operator flow and authority

Use existing **POST `/api/v1/registry-drafts/{draftId}/document-citations`**, selecting one existing building/floor correction and exact draft/record revisions. Its additive body field is:

```ts
addFusion: {
  contextSha256: string;
  selection: SourceFusionRequest; // exact request used to assemble that context
}
```

The operator explicitly selects the intended native/OCR fragments through fusion, then submits that selection and its returned context hash. All selected document fragments in `addFusion` become citations; CityJSON remains contextual and creates no text citation. Native-only `add`, removals and standalone `clearAll:true` remain compatible. Do not combine `add` with `addFusion`. One correction per amendment keeps floors explicit; no automatic propagation, filename links, floor ranges, confidence or recording occurs.

The bridge reassembles accepted inputs/results through existing fusion authority on the **same caller-owned registry transaction**, compares the returned context hash and prechecks site eligibility for citation sources. Complete current/retained/added source case gates are acquired before destination locks. Exact verified immutable document results are reused only within that amendment, with full-pin equality for OCR; authority is still rechecked. After all result I/O, the registry validates every retained/new citation and target, then rechecks the complete fusion selection immediately before writes. Replay reassembles the selected context and reauthorizes it too. No caller-supplied context, text, locator, attribution or citation pin is trusted.

OCR pins retain accepted source/case/job/result/input/reader/config/fence/byte identity, ordinal/item hash, selected page/region, exact item method/label/boxes, source frame, execution/candidate hashes and partial/unverified metadata. Text is not copied into registry bodies. Existing **GET `/api/v1/registry-drafts/{draftId}/document-citations`** resolves native `{pin, part}` or OCR `{pin, item}` through current source/site/attempt/target/draft access and final aggregate checks. General record/draft/review/snapshot/exchange reads retain their existing redaction. Explicit removal/clear remains usable when evidence becomes unavailable.

Existing registry review preparation and commit include the new citation version in their exact record/review fingerprints and use the same protected citation checks. Ordinary recording evidence, target revision, geometry and findings requirements are preserved. A narrow internal checker dependency permits the real commit function to be exercised with the real citation checker and memory-only source/result transport; HTTP and USP callers use the unchanged default authority and cannot supply that dependency.

The registry request remains **32 KiB**, total stored citations **25**, and existing native reader limits remain. Fusion reassembly retains 2–8 sources, 25 total fragments, 64 KiB fusion request, 1 MiB context, 64 MiB aggregate artifacts and a 30-second deadline. New fusion amendments also use the existing deadline-aware transaction at 30 seconds. OCR private validation reuses the bounded exact full-result reader; native v1 keeps its existing read profile. No migrations, new store, USP command/snapshot/declaration/packet change or service registration is needed.

## Focused verification

Final commands in the assigned worktree, all exit **0**:

- `pnpm exec tsx --test --test-name-pattern='fusion OCR|canonical amendment|private read rechecks|actual canonical commit|generic registry' tests/registry-document-evidence.test.ts` — **6/6**: two new mixed selection/read/review/commit and tamper/stale/revocation controls, plus four affected native/privacy/commit compatibility controls.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/register/document-citations.controller.test.ts` — **1/1**, production RegisterModule/provider and additive strict fusion request metadata, without a listener.
- `pnpm typecheck:backend` — server and API pass.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-fusion-reviewed-citations/projection-proof.mts` — unchanged saved native/OCR literal field projection, schema roundtrip and input hashes.
- `git diff --check` and `git diff --cached --check` — pass.

The new controls exercise canonical amendment/private read, read-only review validation and actual commit control flow using memory-only technical fixtures and the actual bounded result parser. Source revocation before amendment/commit writes is denied; wrong ordinal/result, stale OCR config and revoked private reads are denied; removal recovers without modifying prior record/history. A positive memory commit remains a protocol check, not PostgreSQL persistence/atomicity or a real property association. Initial fixture failures (missing ordinary recording evidence, then source timestamp) are retained in separate logs; required production guards were preserved and the fixture corrected. No completed model/source/runtime campaign was repeated.

## Saved real-observation proof and limits

Private proof root: `E:/BhuAayam-data/task-data/desktop-fusion-reviewed-citations/`. Projection receipt: **6,228 bytes / SHA-256 `cc3d53896edcc0795a0db7af29396fff810ed41ebdfd4dd522957d02ba323e39`**. It reuses unchanged [FUSION-02](source-fusion-ocr-handoff.md) saved context and accepted [USGS OCR](whole-page-ocr-handoff.md) status fields. No recorded target, reviewer or operational relationship was fabricated.

Exact historical USGS job `4f56a26c-44b0-4c85-8c52-cff39380968c`, result `b1b88373bcf8310f7524d5cde8ff91edab4d2d62f6b1aeadead3e8327884ad6f`, fence 1 / recorded 5,954 bytes, input `0672a6ebce9067b003e00c55eb2d0c76fb1c4b91eb273d68d90f995dcc80bf7e`, reader `ea28ac987cdf381ab976b9f0b0656bf6e344a396584d2bb56ae1829fb8d0e930` and config `a3d4f6a75198745af23627104ae353eee45b048f8c97fda59612b52861c66030` are preserved. Ordinal 11 retains `CENTRAL CITY, COLO.`, item hash `6147bc28861e0734891c54aa8533ea314c25f00c3752abfcec91900d0b01d33d`, exact source-page box and partial/unverified execution metadata.

`ocr-citation-source-fields.json`: **2,408 bytes / `2b7c3a5ca66b4c5ec8285644e7b88a464297791844c166b0568e16c6c1eda0fd`**. `literal-ocr-observation.json`: **414 bytes / `b2f20ea909d592c44db95596374ad6bd1903b857f5b3f54e76488c2c05bb306d`**. Native reference-document observations are retained separately. The source-field projection omits text, native part ID and target; schema validation does not invent those missing fields. All retained input hashes remain unchanged. Completion receipt additionally pins final commits, physical/Git code, proof scripts/results and command logs.

Original raw accepted OCR result bytes remain unavailable; saved fields are not a new full-result read or current accepted authority. Current API/SQL/object persistence, actual registry review/commit, real source-to-property applicability and concurrency remain **unrun** under the retained runtime blocker. USGS remains foreign `test_only`, OCR partial/unverified. Haryana sheet/height/revision/crosswalk conflicts, qualified matching/learning, rights, geometry, packets and release gates remain unchanged. This supplies a manual reviewed bridge prerequisite; ML association is not complete.

## Lead publication and return

Republish the existing two citation operations' additive request/evidence schemas and client types, including the new OCR pin version, then update their operation wording. Existing root exports, RegisterService wiring and controller/module registration already cover the change. No new endpoint or dataset acquisition/entry is required. Generated OpenAPI/client/catalogue/manifest/root exports remain lead-owned and untouched.

Seven owned code/test files and this handoff changed; registry lock helper, fusion/document readers, USP commands/snapshots/migrations and declaration/packet files are unchanged. No service/listener/native reader/OCR/model/GPU/provider/source acquisition was started, and no owned process remains. Worktree is clean after handoff commit; no push/deploy/public activation. Candidate awaits lead review/integration. Send the authorized completion callback once to `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`, then stop.

## P1 correction — accepted document source policy

Correction code **`e51400548ed9150191ae0b1f41a17a454e59c19f`** continues `de480d0` and addresses the accepted finding in review `b9f2271`. Canonical successful native/OCR sources remain `needs_input`; citation addition/replay and retained private read/review/commit validation now use `registryDocumentSourceAccessTx`. It shares the existing site/operator/archive lookup and canonical document/lineage/access authority with `registrySourceTx`, then the citation flow still checks the exact current accepted input/result/config/fence. Ordinary metadata/record/right/geometry evidence and the recorded target retain the original readiness guard and its check order. No source status/history, endpoint, contract or generated publication changes.

Final checks in the assigned worktree, all exit **0**:

- `pnpm exec tsx --test --test-name-pattern='actual source policy' tests/registry-document-evidence.test.ts` — **1/1** new regression using actual production source/document/accepted-result helpers with memory SQL/object transport. Both canonical `needs_input` document variants progress through addition/replay/read, native compatibility and read-only/protected validation. Wrong site, absent extraction marker/accepted attempt, stale completion and ordinary recording readiness remain denied; source rows remain unchanged.
- `pnpm exec tsx --test --test-name-pattern='fusion OCR|canonical amendment|private read rechecks' tests/registry-document-evidence.test.ts` — **4/4** affected compatibility controls, including the existing memory commit flow.
- `pnpm typecheck:backend` — server/API pass; `git diff --cached --check` passes. Prior controller, source projection and review proof are reused.

Private correction receipt: `E:/BhuAayam-data/task-data/desktop-fusion-reviewed-citations/correction/correction-receipt.json`, **11,374 bytes / SHA-256 `d4f4c95b87e2edaba30226ac8b6c4b676e81ac33c7a5a9860f6b68dd7233f7f7`**. It pins three changed files, unchanged authority/dependencies, commands/logs and the unchanged prior completion/projection/reviewer/baseline evidence. The original review reproducer is reused without another source campaign. These checks qualify protocol behavior, not current PostgreSQL/HTTP/object authority, atomicity/concurrency or a real property relationship. Raw historical accepted OCR bytes remain unavailable; USGS/Haryana and learning/release limitations above are unchanged. Staging stayed read-only; no services, acquisition, OCR/model/provider execution or push/deploy. Lead owns focused review closure, integration and original additive API publication.
