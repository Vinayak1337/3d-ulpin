# Bounded native GeoTIFF windows — AI-05A

Worker `1e40adbb8cce17c6c11be66443f72652aff1d153`, integrated as `81aef71` on 29 September 2026. Lead reviewed the new contract/controller, source checks, canonical job fencing, immutable artifact acceptance and private read path. No new database authority or migration.

Under `/api/v1/ingestion/cases/{caseId}`:

- `POST rasters`: multipart `file`, `requestKey`, `expectedCaseRevision`, JSON `lineage`; retains exact bytes and queues the first window.
- `POST sources/{sourceId}/raster-windows`: JSON request key, expected case/source revisions, source hash and integer pixel window.
- `GET sources/{sourceId}/raster-windows/jobs/{jobId}`: status, safe failure code and accepted reference/band/window metadata.
- `GET sources/{sourceId}/raster-windows/jobs/{jobId}/artifact`: current authorized hash-checked TIFF, `private, no-store`.

The canonical case outbox emits `raster-window.changed`. Reuse an intent key for the same request. Changed case, source, reader or access pins prevent current publication/download; a new current request may be needed after a change. No arbitrary URL or caller filesystem path is fetched. Lineage supplied at receipt is explicitly `caller_declared`.

Limits: retained input 16 MiB; at most 100 million declared pixels/four bands; a window at most 256×256 pixels/2 MiB raw samples; TIFF artifact at most 4 MiB; metadata at most 32 KiB; two queued/running jobs, 32 jobs per source, 64 sources/256 MiB retained across this bounded profile. The reader spools and verifies the full retained input before decoding a window. This is not large remote COG/range ingestion.

## Checked source and behavior

Retained NYC DEM native-grid crop `nyc-10013-dem-2017.tif`: 989,186 bytes, SHA256 `955d7f051c26cc2a26b7a1e9c00bacb9f4e96b6b5611c716d56be6d91e11d317`. Manifest `E:/BhuAayam-data/task-data/nyc-10013-multimodal/manifest.json`, SHA256 `0a382828c60e5b519da2e7a313f6e26202e511ed2d90e862f6550f4307bd10f5`. Lead rechecked both hashes. The unchanged crop is a traceable derivative; the 673,930,486-byte issuing TIFF was not retained. Foreign geography stays in lower Manhattan.

The worker's real HTTP journey retained the crop and completed two windows: `(0,0,256,256)` and `(256,256,256,256)`. EPSG:2263, float32 nodata and native affine shifts were retained. First artifact: 117,186 bytes, SHA256 `485852110798ca7833f717bb55c03f75345f4243c228b8af48d9699c0f801c4e`; second: 117,798 bytes. An out-of-bounds request failed with `RASTER_WINDOW_OUT_OF_BOUNDS`, and a foreign Origin artifact request returned 403. Direct reader checks rejected arbitrary object keys and byte/hash mismatch. Vertical reference remains unknown and global placement unqualified. Raw sample values are not qualified physical elevations or ownership evidence.

Private receipts are preserved at `E:/BhuAayam-data/task-data/desktop-ai05a-raster/`:

- `raster-http-receipt.json`: SHA256 `60d0e8debbb5524e6351e55abdfd561210cf6e9167a703bee9f7da22d5a787ae`.
- `raster-second-window.json`: SHA256 `5c6663aa7b5d6b69d8875f2847654ee288a7863dae75d703b62c59f2b20d4b4c`.

Worker checks: frozen dependency installation, backend typecheck, Python compilation, isolated image build/start, guarded SQL migration, both HTTP scripts and diff check exited 0. The first smoke invocation failed on its timestamp format; the corrected invocation is the accepted receipt. Lead reused these real-source runs and passed the integrated backend typecheck. Owned API/dispatcher and all five Compose services are stopped; `ulpin-raster-worker-20260929` volumes remain. Geo/worker each had a 1 GiB container cap; 98/95 MiB were idle samples, not peak memory measurements.

Sol/max was requested and observed in turn metadata; full local access/approval never was verified. Default tier was configured; actual per-turn tier unobserved. No GPU, provider, deployment or public activation. Renderer, arbitrary GeoTIFF band semantics, point-cloud ingestion, large-file/scale behavior and measured heights remain unqualified. These private receipts are not yet added to the historical machine-readable runtime map, so OpenAPI `x-runtime-verified` remains false for these routes.
