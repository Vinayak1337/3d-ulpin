# DATA-10 — Karnataka district vector source inspection

**Status:** acquired and inspected; permission and scale qualification remain open.

The [official Sujala III / Karnataka Watershed Development Department portal](https://sujala3lri.karnataka.gov.in/) lists district boundaries and links to a Shape File download. The direct [KSRSAC-hosted District.zip](https://kgis.ksrsac.in/kgisdocuments/PDF_KML_SHP/District/Shapefiles/District.zip) returned HTTP 200 without authentication. KSRSAC is identified by the portal as the Karnataka State Remote Sensing Applications Centre under DPAR (e-Governance). The [data.gov.in Karnataka district resource](https://www.data.gov.in/resource/district-boundary) was checked first; its available reference was WMS, which was not harvested.

The original archive is preserved outside Git at /Users/vinayak/.codex/task-data/ulpin-data-10/District.zip: **3,935,596 bytes**, SHA-256 0f5b59339c5d4e3a3c1efd4be810edd38264e40a51f29f17ab78b19067f88891. The response Last-Modified header was 4 August 2026; this is not evidence of boundary validity. The archive contains one Polygon shapefile with **31 records, 76 parts and 374,947 positions**. District.prj explicitly names WGS 84 / UTM zone 43N and metres. The projected source extent is X 401,635.7704–888,865.7545 and Y 1,282,418.1262–2,044,540.0312. No vertical coordinates or reference are present. DBF fields include KGISDistri, LGD_Distri, KGISDist_1 and BhuCodeDis; the two first code fields are nonblank and unique across all 31 records. The source does not document their stable-key semantics.

**Permission:** public download access is observed, but reuse, redistribution and training permissions remain unconfirmed. The official terms page returned a shell with an embedded CMS frame; the frame returned 404, and no source-specific licence was readable. licenceFamily is therefore null. The original is excluded from Git. Do not admit it to runtime ingestion, publication, training or performance evaluation until the source terms are established.

**Search bound:** data.gov.in’s All India Pincode Boundary catalog had no result and its resource endpoint timed out. The PMRDA resource reported zero downloads and timed out. The Karnataka data.gov.in resource exposed a WMS reference; no tiles were requested. These were the three candidates. Search notes and reproducible source metadata are in [source-observations.json](../../../../../../fixtures/usp/D3/official-scale-v1/source-observations.json); the source inventory is [manifest.json](../../../../../../fixtures/usp/D3/official-scale-v1/manifest.json).

**Supported profile:** official 2D administrative district polygon inventory and bounded source-byte inspection only. This is not a 3D city, parcel or ownership layer and does not establish boundary accuracy/currentness. It has not been ingested or rendered. GF-SCALE-1 remains open: no source permission for runtime use was verified and no service budget was measured. It supports no 100k/1M or production-scale claim.

**Verifier:** python3 scripts/usp/data/DATA-10-official-scale.py --check checks the outside-Git original hash, ZIP member pins, SHP/DBF structure, counts, source CRS literal and manifest/observation consistency without network access. pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D3/official-scale-v1/manifest.json checks the shared pack schema and all in-pack byte pins.

The DATA-10 source checker is an acquisition/inspection check only. It is not independent source review, runtime qualification, performance testing, or a pass of GF-DATA or GF-SCALE-1.

## Receipt

- Pinned task base: e281a4dabe1549c4f4a092bb2daa71b61978f628.
- Source archive: 3,935,596 bytes, SHA-256 0f5b59339c5d4e3a3c1efd4be810edd38264e40a51f29f17ab78b19067f88891.
- Manifest SHA-256: 49f930a3d66ab3a4714fc9d300dba5d942f5f185fdca8c154858ad45953270af.
- Source observations SHA-256: fc6c44eea14f0f522c85837c167aa6b89806787bad68af563357952b1eb7499f.
- Source checker SHA-256: d04ea1250803ad60d086e7ef6e59bf96ec7f8b9e9091813c0fbb20fc7a27ee52.
- python3 -m py_compile scripts/usp/data/DATA-10-official-scale.py — exit 0.
- python3 scripts/usp/data/DATA-10-official-scale.py --check — exit 0; archive hash, 7 archive members, 31 polygons, 76 parts, 374,947 positions, DBF keys and projected extent matched the recorded observations.
- pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D3/official-scale-v1/manifest.json — exit 254; this worktree does not have tsx installed. Dependencies were not installed, so the shared Zod pack-schema command remains unverified.
- Requested task setting was Luna / max with Fast priority configured. Runtime model, effort and tier were not exposed to this worker and are not asserted.

## Lead integration check

At consolidated staging `6073b131ad5691e332bfba94a769c94d4b148645`, the lead reran the offline source checker and the shared `pnpm exec tsx scripts/usp/data/verify-pack.ts fixtures/usp/D3/official-scale-v1/manifest.json` command: both exited 0. The shared check verified the 7,032-byte observations asset and correctly reported the original as outside Git. This closes the worker's missing-dependency verification gap only; permission, runtime and scale qualification remain open.
