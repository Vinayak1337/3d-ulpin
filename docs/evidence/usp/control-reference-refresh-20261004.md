# RUN-CONTROL-02 — canonical text runtime prerequisite, 4 October 2026

Both unchanged reference originals and all five historical excerpts are available and intact. Refresh remains blocked because the current canonical text extractor requires the stopped Python processor; this assignment excludes starting that processor, an external/native subprocess, manually generated parts and production edits. No jobs, references or reviews were added or changed. This is a prerequisite receipt, not completion of the review persistence flow.

Pinned API/code SHA `a99994ee2907caae507247962d5fe0636afcea3e`, exclusive `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch `task/desktop-control-reference-refresh`. Prior `task/desktop-control-review-runtime@43863cf2` is preserved. Staging stayed read-only. Supplied permissions: never/danger-full-access. Requested GPT-6.1 Sol/xhigh/default-standard; actual model/effort/per-turn tier unexposed.

Private `E:/BhuAayam-data/task-data/control-reference-refresh-20261004-run01/verification.json`: 21,107 bytes, SHA256 `a8cb6f51fbec6c3acd48eedb1a79cbbf612b60461aef8a115da5789acbdc6d89`. It pins current code, the retained prior proof, source/history observations, commands and cleanup. Originals, exact historical pins/parts, logs and private context remain outside Git.

## Verified current inputs

Two authorized original GETs against the pinned API returned 200, once each:

| Source / current case | Original bytes / SHA256 |
| --- | --- |
| `0bb1289a-a087-4b33-9590-4e693ddaa23b` / `18d2aba5-35aa-4db1-9432-d6552d3bdcfb` | 2,037 / `0972790c9b2befabb049c27a17c628cf96faa65ff4eb1bee0e834e845678ecd9` |
| `d37030cf-0c46-4268-ae0b-18097aa30858` / `b45d7625-9d99-41a9-8cde-e366fa933378` | 37,989 / `79f8def3e9b60f24279e0afb7bd03852d3c25afe16a411c5873f4aabb7064aee` |

Both are latest revision 1, UTF-8 text originals. Canonical source/access checks pass; stored/current document inputs still differ only in readerSha256. Historical accepted result objects were inspected after current original/source authorization, explicitly as history. All five selected parts match their historical text/locator hashes and the exact line/character spans of the unchanged original bytes: lines 26, 29, 30 and 1261, 1272 respectively. The exact old pins were saved privately before any potential mutation.

Draft `bacc6fee-3156-438b-9720-8e7a531f9a47` remains revision 5 and equals the prior preserved snapshot. Native candidate SHA256 `d2fced84f45abcfd3150897035dacb84d56a7aa85ea66d51f1e83f47bba2d3e3` and all geometry/vertices/transform selections are unchanged. The retained 33,168-byte native artifact matches SHA256 `634685e1901b7e247878212262e45bf860942b1863490d7b8b67bda0b210022e`; it was read, not regenerated.

## Exact missing runtime

`runDocumentJob` calls `extractSourceDocument` (`document-worker.ts:51`). Its default extraction transport sends every text input to `areaGeo('extract', ...)` (`document-native.ts:70`), which fetches the configured processor (`areas.ts:73`). The existing production UTF-8 line extractor is `geo.area.extract_document`, text branch `services/geo/geo/area.py:570`; no in-process TypeScript text path is provided. The worker's extractor dependency hook cannot by itself supply a canonical implementation.

One bounded TCP observation of configured loopback `127.0.0.1:28000` returned `ECONNREFUSED`. Its canonical endpoint is `http://127.0.0.1:28000/internal/area/extract`. No extraction call, processor startup or deliberately failing queued job was attempted.

The next prerequisite is a separately authorized bounded invocation of that existing Python text-only extractor transport, or an accepted canonical in-process text extraction path. Keep enqueue/run/accept, source authorization, current reader identity and canonical result construction intact. Do not clone the five excerpts into fabricated accepted parts or rewrite old results. After that prerequisite, the two fresh extractions, supported stale-pin removal/reselection and comparison/review/admission journey still need execution.

Enqueue/run, reference removal/attachment, control assessment, wrong-hash denial, review save/read/replay and admission are **unrun**. Independent controls, accuracy, admission and learning remain unqualified.

## Preservation, commands and cleanup

Before/after full row fingerprints match for cases 39, sources 36, jobs 73, registry_records/sites/drafts 1 each, usp_job_attempts/metadata 73 each and packets 0. All prior operations and job states are unchanged; pending jobs 0, added jobs 0, added operations 0, control reviews 0. Source processing metadata and all five references remain unchanged.

Only the exact existing prefix PostgreSQL/MinIO/Redis containers and hidden API were started. Identity-checked API PID 43184 is stopped/absent; port 3192 has no listener. All three task-started containers are stopped, all 24 container IDs and 14 volume names remain, and Docker Engine 29.8.0 stays available. Eight original profile/config/historical PID files match both this run's preflight and the prior accepted run. No migration, dispatcher, processing, native subprocess, model/GPU/provider, push or deploy operation occurred.

`<proof>` is the private directory above. Commands `node <proof>/runtime.mjs preflight`, `start-storage`, `node <proof>/database.mjs before`, `node <proof>/api.mjs start`, the corrected `node --import tsx <proof>/inspect.mjs`, `database.mjs after`, `api.mjs stop`, `runtime.mjs stop-storage` and `finalize.mjs` all exited 0. The initial private inspection helper exited 1 because canonical fingerprint cannot serialize an internal BigInt binding tag; its preservation comparison was corrected to `assert.deepEqual`. The first completed HTTP read and original were retained and reused, with no repeated GET or data mutation. Failure evidence is preserved. No tests/typecheck or unrelated runtime campaign was added for this evidence-only handoff.
