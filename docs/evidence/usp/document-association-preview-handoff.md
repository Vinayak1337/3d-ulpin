# LINK-01A — cited document/current-target preview handoff

30 September 2026. **Real API continuation passed; processing stopped and storage retained.** The historical implementation checkpoint below is preserved; the final continuation and exact receipts are recorded at the end. Base `a6944c064f806defeefeb3f1f77d2025cc7d01a9`, branch `task/desktop-document-association-preview`, worktree `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`. Primary staging/assignment at `26dfdc89fa5c8f0ee5bea0ace121813a8b458dab` was read only. Completed archive/OCR branches and `.pnpm-store/` remain preserved. Supplied permissions: `never` / `danger-full-access`; requested GPT-6.1 Sol/high/default, actual model/effort/request tier unexposed.

## Private stateless flow

`POST /api/v1/usp/evidence/document-association/preview` accepts:

```text
document: {caseId, caseRevision, sourceId, sourceRevision, sourceSha256, jobId, resultSha256}
partIds: 0–25 exact native part UUIDs, no duplicates
scope: exact recorded SnapshotScope, or null only when no targets are selected
targets: 0–25 unique current registry_record building/floor TargetPins
```

No caller labels, text, issuer aliases or association assertions are accepted. A null scope and empty targets explicitly prepare a source-only incomplete response; they do not select a building automatically. Supplied invalid/stale selections fail rather than broaden or switch to latest.

The response uses the existing USP envelope and returns exact native part/hash/typed locator citations with authorized target labels, identifier assertions, revisions, and relationships **within the explicit selection**. Unselected/missing relationships produce partial coverage; missing selected floor parents and multiple selected floors are explicit. Duplicate literal identifiers retain each target's scheme, issuer/source context, state and leading zeros. Workbook empty/formula/marker parts remain cited but are ineligible for identifier review. Native parts can be reviewed separately from an OCR result; image-only or archive-geometry results remain `not_assessed`/unsupported for this profile.

`state=available` means cited review context is available, not that an association was established. Missing citations/targets return `needs_input`; unsupported native profiles return `not_assessed`. Every response keeps `association.state=not_assessed`, reason `source_target_linkage_unqualified`, and identifier overlap `not_assessed` / `source_key_namespace_unqualified`. No filename, proximity, name similarity, alias or inferred floor-count matching is performed. Optional literal overlap suggestions are deliberately absent until source-key namespaces/linkage are qualified. No global registry no-match is claimed.

The preview reads the exact accepted result through `readDocumentResult`, preserving its full source/input/part integrity. Existing `assertDocumentInputTx` and `assertDocumentAcceptedResultTx` authorize source/job/attempt pins before and after object I/O. Targets use `readManifest`, `readSnapshotBody`, `resolveRegistryTarget` and `registrySourceTx`; a new read-only adapter compares the captured target to its current registry row/body/project identity. Exact target selection in a snapshot is not broadened. Both authorities are checked again before serving. The payload reserves 4 KiB for the USP envelope within the existing 4 MiB result bound. No original I/O, re-extraction, provider, write, new table, record/entityIds mutation or learning label occurs in this route.

Supported target authority is recorded registry buildings/floors. Area features, revision-zero proposals, retained/draft targets and missing floors are not substituted. Existing shared readers, ingestion registrations, jobs, USP index, CityJSON, frontend and generated API/client files were untouched. Lead owns integration/OpenAPI/catalogue updates.

## No-service verification

- `pnpm typecheck:backend`: final exit 0 (server and Nest API). An initial nullable identity-field type mismatch was corrected; no runtime was involved.
- `pnpm exec tsx --test tests/document-association-preview.test.ts`: exit 0, 4 focused checks covering exact/unique/bounded selections, literal zeros and marker eligibility, ambiguity/incomplete/unsupported states, same-revision target-body/identity drift, wrong-site denial, and source/target revocation after I/O. Technical test doubles are not operational records or labels.
- `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/modules/evidence/document-association.controller.test.ts`: exit 0, real provider injection and route/request metadata using a Nest app **without a listener**.
- `node --check scripts/usp/desktop-document-association-preview-smoke.mjs`: exit 0, syntax only; the API journey was not run.
- `git diff --check`: exit 0.

Reviewed the changed flow for source/hash/attempt scope, snapshot membership/current target drift, private source authority, exact citations, marker exclusion and statelessness. These checks do not qualify a live API, source association, training label or release gate.

## Retained evidence and runtime checkpoint

Consulted the current [source index](../../api/real-sources.md), [catalogue](../../api/datasets.json), [native CSV/DOCX evidence](native-table-docx-handoff.md), [XLSX evidence](native-xlsx-handoff.md) and [completed crosswalk review](association-crosswalk/review.md). An unchanged LGD reference CSV (`b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`, 89,622 bytes) or retained MHRA blank DOCX (`3d709b94da96e91c83e7c901b3b1dca1b4d1403f0602696eff8c77973d2aae92`, 67,023 bytes) can supply native citation evidence only. Their original/native-table receipts remain unchanged. The Bihar/Haryana observations leave current approved revisions and canonical building/floor matches `not_assessed`; they must not be forced onto NYC/Dutch objects. **A genuine matched document/building/floor positive association journey remains unqualified.**

CITYJSON-02 remains the exclusive API/Docker owner. This checkpoint ran no API call, Docker command, live database query/mutation, listener, model/GPU/provider or source acquisition. No resource or live-state cleanup was needed; current service state is not asserted.

After the lead transfers runtime ownership, run the bounded smoke against **one existing current accepted native document result** with one or two exact first-page parts and `scope:null, targets:[]`. Use a fresh request/receipt file outside Git. The script checks native citation equality, explicit unavailable targets, stateless replay, stale-result/invalid-part/foreign-Origin denial and the unchanged retained job. It never uploads or retries/re-extracts a source. Older source jobs may require a current extraction receipt from the existing document authority before this journey; no stale pins are silently refreshed by preview. Then stop owned processing and preserve storage as directed. Runtime source/result/code pins and actual journey outcome will be appended on that continuation, not claimed at this checkpoint.

## Completed real API continuation — 30 September 2026

Reused accepted independent LINK review `f0393471b6d0870a716dc43517712dd803c93708`. Merged exact lead handoff `4ec1905bd8a3b95cc8d8f732ceaf510d47a8244a` into implementation `e915af9c447c8967d1b5a39a71b00073b5c7629e` without conflicts or history rewriting. Combined served commit: `fc83d6beeaf8da3d76bf01a3164f42ff78f0cb01`. No production-code correction or repeated CityJSON/archive review/campaign was needed. CityJSON private original/no-store delegation and archive dispatch remain present.

Guarded status initially showed only PostgreSQL/MinIO/Redis. Startup checked free ports and enabled the combined Nest API at `http://127.0.0.1:3192` with providers disabled. The stopped geo container still referenced image `b6495fa4208391083746f7087af04055f237c384010e9cebc5e4370d0b3ba263`; route introspection confirmed CityJSON existed. Refreshed only geo/worker with the already-built current image using the assigned Compose files and `up -d --wait --force-recreate --no-deps --no-build geo worker`. Both then used `sha256:d7b23c0ea7f9dcc2cd73bf372ad320408b88b5f223baeccd40075760b67fda8f`. Five served Python files (`api`, `area`, `native_schedule`, `archive_member_inspection`, `cityjson_processing`) matched worktree bytes exactly; private receipts retain their hashes and process identities.

Retained LGD and later MHRA status reads returned `stale`; the corresponding source histories had no newer job. Used the authorized **single canonical `native_only` LGD retry**, outside the preview. Before retry, unchanged private-original download verified 89,622 bytes and SHA-256 `b8901c98350a4057d3371ce14228181e4bb12cc447f847490efee599a0e38b59`. Case `2c5ca5cc-d98a-48e9-9be0-16f2c590d0a3`, source `59b3f4b2-0a3a-4acd-9c99-60b989dda5f8`, both revision 1. New accepted job `a5e60c45-8c42-4811-b70d-643df74bfd01`, result `f1b651ac7b21d37dc97831e858175162769d86f200e118a16eeb5e5e467d8d87`, reader `cb1f45fc7253f40a16c2886f851866b83293eeae33d8dc34f7273c242530bc8a`. Native extraction completed; model remained `not_requested`. Source metadata and the prior job payload/status/result reference were byte-for-byte structurally unchanged. No upload/acquisition or target creation occurred.

The existing smoke used first-page CSV rows 4 and 5, exact part IDs `a1200203-7c6d-42b7-971a-d3ec2b5001bc` and `96549ada-5671-48be-8a39-4cff263161f2`, with `scope:null, targets:[]`. The response preserved exact text/hash/locators, including `049`, `000` and an empty local name. It returned `needs_input` / `target_selection_unavailable`, with both association and identifier overlap `not_assessed`. Stateless replay matched; wrong result hash returned 409, an unknown part returned 422, foreign Origin returned 403, and the retained job/result remained unchanged. All checked responses were `no-store`. **Positive building/floor association remains unqualified; this is native citation and incomplete-target API evidence only.**

Actual commands/exits:

- `git merge --no-edit 4ec1905bd8a3b95cc8d8f732ceaf510d47a8244a`: 0, no conflicts.
- `pnpm typecheck:backend`: 0 once on stabilized combined code.
- `node scripts/usp/desktop-prefix-runtime.mjs status|preflight|start <assigned-runtime>`: each 0; owned Compose refresh: 0.
- Private `prepare-native-current.mjs`: initial import setup exited 1 before API/DB/retry work; corrected Windows ESM file URLs, then exit 0 with exactly one retry. An attempted geo OpenAPI diagnostic failed because OpenAPI is disabled; used actual container route introspection instead.
- `node scripts/usp/desktop-document-association-preview-smoke.mjs <assigned-runtime> <private exact-current-request.json> <private runtime-receipt.json>`: 0 on the first API journey.
- Guarded `stop` and final `status`: 0. Final ownership/port check: 0; API/dispatcher absent, geo/worker stopped, ports 3192/28000 free, only the three populated storage services running.

Private receipt directory: `E:/BhuAayam-data/task-data/desktop-document-association-preview/` (kept outside Git):

| Receipt | SHA-256 |
| --- | --- |
| `native-preparation-receipt.json` | `0d0032490e69befd3942bf5b6d43e0d623e612d77c974f0d902ccb71ad90b5fc` |
| `runtime-receipt.json` | `0467b55d0db0f3395fdf6b7d99f1df1038bf5472d8956308b662b6e57387b93a` |
| `combined-runtime.json` | `aa7577e379ba354046677e3350b91f9d1f0dcfb4395871893f0eb54227a7b8ad` |
| `cleanup-receipt.json` | `5112b67c38c255aa20f40dcfdd8db25762b75a27e45a89f76d4695a638ce5abf` |

Combined receipt pins the preparation/request/status/smoke artifacts, source-facing shared code, actual images and processes; the smoke receipt pins the seven preview production files. Lead retains generated OpenAPI/client/catalogue integration. Primary staging, credentials, populated volumes, originals and `.pnpm-store/` were preserved. No frontend, GPU/model execution, provider use, deployment or release-gate qualification follows.
