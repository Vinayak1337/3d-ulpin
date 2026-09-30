# BUNDLE-02B — private selected GeoJSON member inspection

30 September 2026. Base `4120aa12bc90c06a18a7f75d42c44ec379c5bdb1`, branch `task/desktop-archive-member-api`, assigned worktree `C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin`. Primary staging remained read-only; prior OCR branch and untracked `.pnpm-store/` are preserved. Supplied turn permissions are `never` / `danger-full-access`. GPT-6.1 Sol/high/default was requested; actual model, effort and request tier were not exposed.

## Usable API flow

The existing private document retry queues one selected GeoJSON member of a retained ZIP. The ZIP remains the canonical original; the member is a cited derivative. No independent source, canonical geometry, association or model record is created. Existing source/case/access/job authority, processor transport, accepted member helper and GIS inspector are reused.

`POST /api/v1/ingestion/cases/{caseId}/sources/{sourceId}/documents/retry`:

```json
{
  "requestKey": "<new UUID>",
  "expectedCaseRevision": 1,
  "expectedSourceRevision": 1,
  "sourceSha256": "ec691b929143f520cbf8b427bc071877030c045a035fd99697cdcf231d542111",
  "mode": "native_only",
  "archiveSelection": {
    "ordinal": 24,
    "memberSha256": "107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e",
    "memberBytes": 1103282
  }
}
```

Use the current case/source revisions, not the example revisions, for each caller. Response remains the existing 201 document receipt. Follow its `jobId` through the existing `GET .../documents/jobs/{jobId}`. A completed job returns `archiveInspection: {lineage, inspection}` separately from `native.archiveInventory`, native text parts, OCR and model proposals. Native stays `unsupported` / archive inventory only; the structured inspection is not text extraction. Archive selection requires `native_only` and excludes OCR. Filename/path selection is not accepted.

Selection is included in request-key digests, active-job matching, registered input fingerprints and source/current-input checks. Result validation cross-checks selected member lineage, inventory and inspector hashes/sizes. Publication uses existing attempt/source/access fencing. Serving rechecks the accepted result/attempt after object I/O. Older result shapes without this optional field remain readable. Existing native and OCR paths remain in place; reader changes intentionally make previous current-status projections stale until retried, without rewriting their originals or receipts.

Only the GeoJSON profile is admitted. JSON metadata, ArcGIS JSON disguised as GeoJSON, shapefile companions, raster, point clouds, nested archives and scripts remain unsupported or denied. Failures retain the ZIP and permit a correctly pinned retry. The new wrapper checks the accepted helper's route and the inspector's actual content format. Accepted helper/inspector internals were unchanged. The narrow necessary change outside the listed document files extends `areaGeo` with this operation and an optional streamed response cap, preserving existing transport behavior for other callers.

## Retained real journey

Reused the existing NYC local assembly and its already installed private source from the accepted inventory receipt; no new acquisition or source upload. Original: `E:/BhuAayam-data/task-data/nyc-zcta-10013-context/nyc-10013-official-context.zip`, 4,778,508 bytes, SHA `ec691b929143f520cbf8b427bc071877030c045a035fd99697cdcf231d542111`. Member ordinal 24 is unchanged `layers/buildings-original.geojson`, 1,103,282 bytes, SHA `107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e`. See the [source index](../../api/real-sources.md), [catalogue](../../api/datasets.json) and [accepted member handoff](archive-member-reader-handoff.md) for issuing-source/member terms. NYC remains foreign `test_only`; the outer ZIP is a local assembly, not an issuer-original ZIP.

Private receipt: `E:/BhuAayam-data/task-data/desktop-archive-member-api/receipt-001.json`, SHA `c3ee6a297c96c139de1a1756133abe4285ac757bf6baa2a58425a319a5518685`. It records actual executed code hashes, exact source/member/result pins and controls; its `codeHead` is the base and `uncommittedCode` is true because execution preceded the candidate commit.

- Source case `f38edd3e-56c5-43c4-b5af-3a5b01d1770d`, source `ca37e5eb-60c1-4bfa-97af-abd67eddbcef`; accepted job `b0013da6-c963-4176-aba2-8bbae5e03f14`, result SHA `29c6ae64fbb795ca04689de5038a276efcec0d2481dde23fda99bf59e2f33f41`.
- API inspection exactly equals an independent existing GIS inspector call on bytes extracted independently with `fflate` and verified against the member hash/size. It preserves 1,662 MultiPolygon features, eight fields and their eligibility, `featureIdEligible=false`, `suggestedIdField=doitt_id`, null name suggestion and declared OGC CRS84 evidence.
- Existing quarantine remains: 1,661 accepted, one rejected at zero-based index 1322, source key `751920`, `INVALID_GEOMETRY`, ring self-intersection; `complete=false`, original bytes unchanged, no repair. Lineage preserves all nine unselected inventory issues.
- Exact original download matched SHA and size. Real script ordinal 2 (`acquire-identified.py`, 2,430 bytes, SHA `af65d82bc0c574e2ff46bbba5d273b934589909e10a29b6fe44c163938465f0a`) failed with `ARCHIVE_MEMBER_SCRIPT_INERT`; wrong member SHA failed with `ARCHIVE_MEMBER_REFERENCE_MISMATCH`. Correct selection subsequently completed.
- Replay returned the same job; changed selection under the same request key and wrong source revision returned 409. OCR coexistence returned 422. Cross-case status returned 404; alternate subject status/original reads returned 403. Changed selection failed current-input checks. Rolled-back parent revision and accepted-fence drift were rejected; a superseded publication attempt was denied before its result validator. No persistent control mutation remains.

The initial journey reached exact inspection/download success but exposed a current-input gap: reconstructing a supplied selection alone did not compare it to the registered job. The correction checks the registered payload/fingerprint for member jobs, including an input with a removed selection when the stored job has one. The final journey above passed after an owned app restart. Earlier jobs remain in retained history.

## Verification and cleanup

- `pnpm typecheck:backend` — final exit 0, server and Nest API.
- `pnpm exec tsx --test tests/document-archive-member.test.ts tests/document-archive-inventory.test.ts tests/document-workbook-policy.test.ts` — final exit 0, 9/9. New checks cover exclusive selections, exact derivative pins and cancelling an oversized streamed processor response; existing checks retain older/native inventory and workbook behavior. Initial refined-schema `.pick()` and missing test-only transport environment errors were corrected, then affected checks passed.
- `docker --context desktop-linux run --rm --network none --mount type=bind,source=C:/Users/kvina/.codex/worktrees/b3eb/3d-ulpin/services/geo,target=/app,readonly ulpin-geo:desktop-ai03c-b10ec8c python -m unittest discover -s tests -p test_archive_member_inspection.py -v` — exit 0, 2/2 content/route and integrity-precedence controls.
- `node --import tsx scripts/usp/desktop-archive-member-smoke.ts E:/BhuAayam-data/runtime/prefix-worker-20260929 E:/BhuAayam-data/task-data/desktop-bundle-inventory/runtime-2026-09-29T21-46-20-942Z.json E:/BhuAayam-data/task-data/desktop-archive-member-api/receipt-001.json` — final exit 0. The earlier control-gap run exited 1; it produced no successful receipt.
- `git diff --check` — exit 0.

Guarded runtime project `ulpin-usptest-b050544f3d2cb99e`, API 3192 and geo 28000, model gateway disabled. Launcher start/stop/status exited 0. The launcher reused an older geo/worker container despite rebuilding the image; an explicit `compose up -d --wait --force-recreate --no-deps --no-build geo worker` replaced only those two owned processing containers. Executed image ID is `sha256:1d07b8013303cc9dde515056e14107e6e2c1a2b60546dc7279398b4141a1e260`; in-container API/wrapper/helper/inspector hashes matched the receipt's worktree hashes. No storage reset, reseed, credential change, live provider call or Docker host repair occurred.

Final stop/status: API and dispatcher absent; geo and worker stopped; only populated isolated PostgreSQL, MinIO and Redis remain running. Originals, result objects, private receipts and volumes are preserved. Only pre-existing `.pnpm-store/` remains untracked after committing owned files.

Bounds remain 10 MiB outer/native, 8 MiB selected member, 256 members, 30 MiB expansion, cooperative 15-second member reader, existing 60-second processor HTTP timeout, 120-second job publication deadline and 4 MiB result cap. The HTTP timeout is not a new OS-level processor kill guarantee. No frontend, generated OpenAPI/client, global plan or source catalogue edit is included; lead owns those integration updates. GIS import, property association, learning, broader accuracy/scale, GF gates and deployment remain unqualified.
