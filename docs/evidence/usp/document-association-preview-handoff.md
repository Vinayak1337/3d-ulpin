# LINK-01A — cited document/current-target preview checkpoint

30 September 2026. **Implementation checkpoint; live API verification pending runtime transfer.** Base `a6944c064f806defeefeb3f1f77d2025cc7d01a9`, branch `task/desktop-document-association-preview`, worktree `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`. Primary staging/assignment at `26dfdc89fa5c8f0ee5bea0ace121813a8b458dab` was read only. Completed archive/OCR branches and `.pnpm-store/` remain preserved. Supplied permissions: `never` / `danger-full-access`; requested GPT-6.1 Sol/high/default, actual model/effort/request tier unexposed.

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
