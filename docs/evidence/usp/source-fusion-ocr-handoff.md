# FUSION-02 — explicit accepted OCR observations

2 October 2026. Code candidate `509c983d96c2480e572fcc48211e4c490a8bf965` adds `document_ocr` to the existing private **POST `/api/v1/usp/evidence/source-fusion/context`**. The operator selects exact accepted-result pins and unique item ordinals 0–63. Empty selection reports a capability gap; no latest-result selection, automatic relationship, recording or learning label is created. Existing native document/CityJSON request and output behavior is preserved.

Assignment: [FUSION_02.md](../../orchestration/FUSION_02.md). Branch `task/desktop-source-fusion-ocr`, worktree `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, pinned base `99987bda30e925be411b8ba10e02da337e6f97a5`. Prior context branch remains at `bbaad609bedac6fcded9a81d3272b475e9d834e2`. Staging was read-only; observed later head `2d1f3da6a878c5ce091524e8bdf8751ac32af8f1` does not change this candidate's base. Supplied permissions: never/danger-full-access. Requested Sol6.1/xhigh/default-standard; exact actual model, effort and per-turn tier remain unexposed.

## Behavior and boundaries

OCR reuses canonical document authority and the exact bounded `DocumentResultSchema` reader. The final all-source transaction still rechecks current access, input/reader/config/accepted-attempt authority after all object I/O. No persistent writes occur. Pure projection additionally validates saved source/page/region/config consistency and rejects unavailable ordinals. A source appears only once, including across native/OCR variants.

Each observation retains the literal item text, label, method and source-page boxes; the source retains frame, requested region, issues, execution/candidate receipt hashes, output status and `textCompleteness=unverified`. Native status/code/warnings remain separate. Missing, empty, failed or unavailable OCR produces an explicit gap, without invented observations. Selected keys include source namespace, job/result and ordinal; `itemSha256` fingerprints `{version: 'source-fusion-ocr-item/1', pin, ordinal, item}`. Ordinals identify accepted extraction observations, not native part UUIDs or canonical entities. OCR content remains evidence, never executable instructions.

Bounds remain 2–8 sources, 25 total selected fragments, 64 KiB request, 1 MiB response, 64 MiB aggregate artifacts and a 30-second service deadline. Existing literal own-key retention and fingerprint of the exact validated returned body remain intact. The production EvidenceModule registration/test is preserved. Document/OCR schemas, readers/config helpers and the separately owned larger-frame work are unchanged.

## Focused checks

All final commands exited **0** in the assigned worktree:

- `pnpm exec tsx --test --test-name-pattern='OCR' tests/source-fusion.test.ts` — 4 passing controls: existing native `needs_ocr`, mixed explicit observations/hashes, missing/partial/failure/item-integrity gaps, and final aggregate OCR-config drift denial with zero writes.
- `pnpm exec tsx --test --test-name-pattern='strict selection|literal own JSON keys' tests/source-fusion.test.ts` — 2 passing existing compatibility controls.
- `pnpm typecheck:backend` — server and API pass. Initial exit 2 exposed the string/number `Set` overload in request validation; its explicit type is fixed, and the initial log is retained.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/source-fusion.controller.test.ts` — 1 passing production-module no-listener check, including the additive OCR discriminator/ordinal schema and received-byte/no-store behavior.
- `pnpm exec tsx E:/BhuAayam-data/task-data/desktop-source-fusion-ocr/ocr-proof.mts` — unchanged saved-field mixed projection and byte-identical ordinary context.
- `git diff --check` and `git diff --cached --check` — pass.

The three new controls target source citation/integrity, explicit selection and stale authority risks introduced by OCR; no unrelated campaign was repeated.

## Retained real-output proof

Private proof root: `E:/BhuAayam-data/task-data/desktop-source-fusion-ocr/`. Projection receipt: 6,187 bytes, SHA-256 `111db66e3deb56c21259efa31faf5d72a0c8a5f8b660cd26d153bbb6bf86ac2b`. It pins unchanged inputs, actual saved accepted job/attempt/result metadata, exact selected observation, current code and outputs. A separate `completion-receipt.json` pins final commits, physical/Git code bytes, proof and command logs.

The unchanged [USGS Central City 1910 source](../../../fixtures/usp/D5/official-runtime-pdf-v1/manifest.json) remains 9,344,939 bytes / `fc554d896f7620149f0c540ad996efc6f0ff26405d8ab77ee7ed1169aaccadcf`, foreign `test_only`. Reused [accepted whole-page OCR evidence](whole-page-ocr-handoff.md): job `4f56a26c-44b0-4c85-8c52-cff39380968c`, accepted fence 1, result `b1b88373bcf8310f7524d5cde8ff91edab4d2d62f6b1aeadead3e8327884ad6f`, recorded result length 5,954 bytes. Reader `ea28ac987cdf381ab976b9f0b0656bf6e344a396584d2bb56ae1829fb8d0e930`, input `0672a6ebce9067b003e00c55eb2d0c76fb1c4b91eb273d68d90f995dcc80bf7e`, OCR config `a3d4f6a75198745af23627104ae353eee45b048f8c97fda59612b52861c66030` remain historical exact pins.

The mixed proof combines one saved native reference-document source, saved D1 CityJSON and **ordinal 11**, exact `CENTRAL CITY, COLO.`. Its source-page box is `[969.6142857142856,1418.1142857142856,1092.4178571428572,1448.0142857142857]`; item hash is `6147bc28861e0734891c54aa8533ea314c25f00c3752abfcec91900d0b01d33d`. Whole-page output has 12 stored items, one explicitly selected, output **partial**, issue `low_confidence_words_withheld`, completeness **unverified**. The prior title check is reused; this is no new OCR accuracy observation.

Mixed pretty context: 17,096 bytes / `5fbcac319122d09b32db6e6c03de6461fc581d58adbb45e4101498c3115702e9`, validated-body fingerprint `12058b2711142152e577c0ac2b3dd4e87d17ef64c1e58333421ff12003344a48`; compact data 11,947 bytes. All ordinary saved sources revalidate to the exact previous **16,875 bytes / `92bfe44612eecbfdb000bc8b3cd7e6a8b25a56d023827967b7be2613c968e8b0`**, fingerprint `5e84138f7202679ee38fb15bdd3069f4e3a06c50b4a0c21eb62c6d551925724d`. Input hashes remain unchanged; historical receipts are untouched.

**Proof limitation:** original raw OCR `DocumentResult` bytes were not found in the bounded retained-file search. This proof uses actual saved status fields plus the unchanged accepted job payload through the pure projection; it invents no result timestamp or full-result serialization. Accepted result SHA/length are cross-checked historical provenance, not a new raw-byte verification. Current reader/config/source/access/attempt authority and HTTP/SQL/object-service execution remain unrun, with the existing runtime blocker unchanged. Historical pins may now be stale. No Indian/property/geometry/rights, learning, scale or release qualification follows.

## Lead publication and return

Republish the existing route's additive request/response schemas through the lead-owned OpenAPI/client pipeline and amend its operation access wording to include explicit OCR ordinals. The existing root `export * from './source-fusion'` already exposes the new schema. No module registration, new operation, source acquisition or dataset entry is needed. Generated OpenAPI/client/catalogue/manifest files were not edited by this owner.

Only the assigned six code/test paths and two documentation paths are changed. No services, listeners, native/OCR/model/GPU processes, provider calls or source acquisitions were started. Worktree returns clean after the documentation commit. Candidate awaits lead review/integration; no push, deployment or public activation occurred. Send the authorized completion callback to lead `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`, then stop.
