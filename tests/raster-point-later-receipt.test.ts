import test from 'node:test';
import { assertRasterInputTx, rasterInput, rasterSourceTx, rasterWindowCaptureTx } from
  '../packages/server/src/modules/usp/ingestion/raster-window';
import { assertPointInputTx, pointInput, pointSourceTx, pointBatchCaptureTx } from
  '../packages/server/src/modules/usp/ingestion/point-batch';
import { localReaderControl, readerLifecycle, type ReaderControl } from './reader-pin-control';

// Source/job/accepted-result SQL controls only; no raster/point bytes or native outputs are invented.
const lineage = { kind: 'unknown', issuer: null, originalUrl: null, acquiredAt: null,
  permissionReference: null, geography: null, upstreamBytes: null, upstreamRetained: null,
  parentSha256: null, limitations: [], note: null };
const readers: ReaderControl[] = [
  { name: 'raster', version: 'raster-window/1', profile: 'geotiff-raster-v1', marker: 'rasterOriginal',
    operation: 'raster-window', asset: jobId => `raster:${jobId}`, lineage,
    source: rasterSourceTx, input: (ctx, jobId) => rasterInput(ctx, jobId, null),
    check: assertRasterInputTx, capture: rasterWindowCaptureTx },
  { name: 'point', version: 'point-batch/1', profile: 'laz-point-v1', marker: 'pointOriginal',
    operation: 'point-batch', asset: jobId => `point:${jobId}`, lineage,
    source: pointSourceTx, input: (ctx, jobId) => pointInput(ctx, jobId, null),
    check: assertPointInputTx, capture: pointBatchCaptureTx },
];

for (const reader of readers) {
  test(`${reader.name}: later receipts preserve claim/completion/read pins and all refusals`, () =>
    localReaderControl(() => readerLifecycle(reader)));
}
