# Bounded native point batches — AI-05B

Worker `72225896700c9430985c360cb1b8ee184f96fcce` and correction `385f793fa9644de4b14a32e0b7416c4b23f2d6c1` integrated as `cde9302` and `78a4ee3` on 30 September 2026. [Independent review](desktop-backend-review/point-review.md) found one unproven MVT compatibility hash; the correction removes it and checks that it is denied. Only the independently reconstructed pre-point parent hash remains, with exact self-hash and non-code pins. Lead reviewed the correction and the source/job/artifact flow.

Under `/api/v1/ingestion/cases/{caseId}`:

- `POST points`: multipart `file`, `requestKey`, `expectedCaseRevision`, JSON `lineage`; retain unchanged bytes and queue the first batch.
- `POST sources/{sourceId}/point-batches`: pin current case/source revisions and source hash, then select integer `batch.start` and `batch.count` with a request key.
- `GET sources/{sourceId}/point-batches/jobs/{jobId}`: current status, recoverable error and accepted native record/reference metadata.
- `GET sources/{sourceId}/point-batches/jobs/{jobId}/artifact`: authorized hash-checked native records as `application/vnd.las.point-records`, with `private, no-store`.

The existing outbox emits `point-batch.changed`. The profile accepts compressed LAS 1.4 format 6 without extra dimensions: 16 MiB retained originals, at most five million points, and at most 8,192 selected 30-byte records. Artifact and receipt budgets are 512 KiB and 32 KiB; admission permits two queued/running jobs, 32 jobs per source, and 64 sources/256 MiB retained. The full bounded original is spooled and hash-checked before reading a batch. This is not large remote COPC/range ingestion. Caller-supplied lineage stays `caller_declared`; changed source, case, access or reader pins prevent current artifact publication/read.

## Retained evidence

The unchanged NYC derivative `E:/BhuAayam-data/task-data/nyc-10013-multimodal/upload/nyc-10013-lidar-2017.laz` contains 1,726,222 points in 11,110,715 bytes; SHA256 `8c565f320533dcefc7ba8438682b32c0eb5e0a06b323600922b0b0b6092d6790`, rechecked by the lead. Parent `20170504_980200.copc.laz` is retained whole: 77,948,603 bytes, SHA256 `927b6af830dbbebdd9ebf8fc1cde5c4e37858cc0a1feaa9978c440c1c01c3809`; it exceeds this upload profile. Existing manifest `E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json` preserves issuing URLs, acquisition and derivative lineage. No new source acquisition or broader permission was inferred.

Private HTTP receipt `E:/BhuAayam-data/task-data/desktop-ai05b-point/point-http-final.json`, SHA256 `1c9f4f94bf3ebbeacae4549dd582d6fc369bda000b864524d3272114213bf4f2`, independently rechecked by reviewer and lead, records first/later completed 8,192-point batches (245,760 bytes each), out-of-range rejection, foreign-Origin 403 and an earlier reader-pin stale result. Artifact hashes are `83286b0b5d8edf731d469b0cce1b768ba5a9af22abcb905ab294cbbb6a8dcaec` and `a6deca7309c7e4e4474252a39f7cb0544d0a07fa19bc351105570fb74af270f0`. The worker reported exact native-record byte comparisons; reviewer and lead did not repeat those comparisons or the HTTP run.

Native EPSG:6347/NAVD88 reference metadata, 0.01 scales and all 18 dimensions remain exposed. Global placement, physical height accuracy, rendering, arbitrary point formats and scale remain unqualified. Foreign survey data does not establish Indian property facts or ownership.

Worker checks: backend typecheck, Python compilation, native record comparisons and real HTTP journey passed; correction's existing MVT tests passed 7/7. Integrated backend/client typechecks passed. Generated API handoff has 187 operations and 215 named schemas; existing schemas are unchanged, with four added routes and one additive ingestion-event variant. Owned processing is stopped and isolated volumes remain. No provider, GPU training, deployment or public activation occurred. The historical machine-readable runtime map is unchanged, so these routes retain `x-runtime-verified: false`; the private receipt qualifies only this reported bounded run. No release gate is promoted.
