# RUN-SURVEY-01 — live survey context exposes completeness-warning defect, 4 October 2026

The retained PID original now completes supported upload, canonical `native_only` extraction and private survey-context HTTP 200. All 17 rows parse, all 471 citation spans match unchanged source lines, and the four frame/height/epoch/object gaps remain actionable. The scoped completion gate is **blocked**: the parser calls this fully populated table `incomplete` solely because the production extractor always emits its standard source-reference/review caution. NVA remains unenrolled and unexecuted after this new concrete defect; no repeat extraction or warning suppression was attempted.

Served code: `e8b9521128cf4e3478849ee097137b5963ec3b64`, exclusive `C:/Users/kvina/.codex/worktrees/desktop-gltf/3d-ulpin`, branch `task/desktop-survey-context-runtime`. Staging was read-only; resume observed `f3018e0a42af08cbd816b01548721b15000396a2`. Previous `task/desktop-control-reference-runtime@00330e69` remains intact. Supplied permissions are `never` / `danger-full-access`; requested Sol6.1/xhigh/default-standard, actual model/effort/tier unexposed. Production code, dependencies, migrations and frontend were untouched.

## Concrete production defect

`packages/server/src/modules/usp/ingestion/survey-report-parser.ts:179–180` makes any nonempty `native.warnings` array a completeness failure. `services/geo/geo/area.py:704` always appends:

> Native text is a source reference only. Facts, entity associations, coordinates and legal claims require explicit review; document instructions were not executed.

The accepted job has `native.status=extracted`, `native.code=null`, and this one warning. Live context returns observed/parsed/enabled **17/17/17**, disabled/unparsed **0/0**, complete header/end/population and 15 reported-statistic entries, but adds `native_extraction_warning` and `table.status=incomplete`. The existing test callback at `tests/survey-report-context.test.ts:40` supplies line parts without the canonical extractor warnings, so its controlled completeness result missed this integration behavior.

Requested correction for the parser owner: distinguish provenance/review cautions from actual extraction incompleteness through the canonical bounded contract. Retain the caution and unresolved qualifications; actual extraction errors, missing/redacted rows and incomplete population must still block completeness. Use the saved accepted job for a current-authority context read where its reader remains eligible; do not rewrite its result or manufacture new parts.

## Live source and results

The unchanged manifest supplies the separate foreign `test_only` family `usace-affiliated-nj-cape-may-2025-test-only`, Cape May/New Jersey/USA, DOI `10.5281/zenodo.17236055`, declared CC BY 4.0 and named USACE/ERDC-affiliated authors. Canonical case metadata comes from that manifest. No Indian/D1/property/ML association, geometry or independent accuracy claim was created.

| PID authority | Exact value |
|---|---|
| Case / case revision | `b6915f00-da0a-49b6-985d-57024a0b7542` / 1 |
| Source / source revision | `c9d5efbe-a149-4ab9-a678-694d8dcb4456` / 1 |
| Original | 6,458 bytes; SHA256 `6a185639d8775640a5103136f536b345bc886560a5baef0ef19a5d529740aff2` |
| Accepted recovery job | `fb4966b9-9078-41f1-aa10-99142e418e6f` |
| Accepted result SHA256 | `fabfdf490a6086d515f88e2fdaef9d482242089eeb880af9595ec3925875f7c6` |
| Current physical reader SHA256 | `ecd90d83f147c60ce9eba0f5c38b12df6531ad42af539ab74e0aabcbe811d183` |
| Context | HTTP 200, `private, no-store`, 147,167 response bytes, `state=needs_input` |

All cited part hashes, source/part/line/UTF-16 spans and original row lines 83–99 compare exactly. Literal `0.000` remains zero and `-0.000` remains signed source text. Reported horizontal/vertical measured counts remain 17/17; reported withholding is 0 of 17. Statistics remain source literals. `coordinateFrame`, `heightLinkage`, `surveyEpoch`, `objectCorrespondence` are `needs_input`; `comparison`, `accuracy`, `learningSplit` are `not_assessed`. One wrong result hash returned **409**, with all twelve observed table counts unchanged.

NVA original remains 44,314 bytes / SHA256 `dfcd0e1fa9030dcdd0b8d9990cf257fe1e8154e73dbd1ff23d1f39c6747e8a0e`. Its rows/exclusions/missing horizontal values were not runtime-qualified here.

## Private helper recovery and preservation

Initial PID upload succeeded (case/source HTTP 201), but private `journey.mjs` failed before transport: its `assert.deepEqual(sourceBytes, bytes)` compared storage `Uint8Array` with local `Buffer`. A read-only diagnosis reproduced that assertion while proving exact byte/hash equality after `Buffer.from`. The original failed job `885a0174-6ef0-4763-a961-00e7db5743ca`, attempt/metadata and failure receipts remain unchanged. Supported pinned retry HTTP 201 reused the same source and created the one accepted job above; no duplicate upload or direct SQL enrollment occurred.

The accepted unchanged Python TEXT extractor ran once through the canonical worker hook in retained image `sha256:e71d87961be773c18685622eb570c034cf664bfa206e21f6fa3691d629b440c9`, network none, read-only mounts/root, 1 CPU, 512 MiB, 32 PIDs and 30-second deadline. `geo.area` physical SHA256 remains `5fd21a3a74d74d4dc29e8f9beafebb477e25dd63b3679b5baa115b5f7aab467b`; transport exited 0 without timeout/overflow and its container was removed. The default HTTP processor path is unqualified. No processor/dispatcher/Celery/model/provider/OCR/GPU/geometry execution occurred.

Every pre-existing full row matches the before snapshot, including originals, jobs, attempts, metadata, operations, outbox, registry/reference/review/native history. Scoped additions are **one case, one source, two jobs/attempts/metadata/operations** (failed helper job plus accepted recovery), five outbox events and two streams. Final counts: cases 40, sources 37, jobs/attempts/metadata 77 each, operations 141, outbox 2,543, streams 103; registry records/sites/drafts 1 each, packets 0, pending jobs 0. Historical reader-bound references were not refreshed.

## Evidence and cleanup

Private proof: `E:/BhuAayam-data/task-data/survey-context-runtime-20261004-run01`. `verification.json` is **34,526 bytes**, SHA256 **`3658ea7ad0beec00c6834d0ac1c37b95234fa8df6cd776bc2c8d43a6be7fd17d`**, with 29 physical/Git code pins and 49 proof pins. It links accepted prior transport receipt SHA256 `0802b27eb5a75c003c09cebd75c815be79ca60095d1a5d411004ba4658dedad8`; originals, exact private request/result pins and failure history remain outside Git.

Actual commands/exits are retained there: runtime preflight/storage start, database before, API start, diagnosis, continuation preparation, blocker closeout, database after, API stop, storage stop and finalization exited **0**. Initial journey exited **1** for the confirmed private type mismatch; continuation exited **1** for the new live completeness defect. No production typecheck/test campaign was added for this evidence-only task.

Identity-checked API PID 15612 is stopped/absent; port 3192 listeners **0**. All three task-started storage containers are stopped, the owned TEXT container is absent, all **24 original container IDs**, **14 volume names** and **eight original profile/config/PID files** are preserved; Docker Engine 29.8.0 stays available. No push, main merge, deployment or public activation. Return this concrete defect once to lead `01a0ed8a-4383-79c3-a0ae-35c1e969ef66`; NVA and scoped completion await the owner correction.
