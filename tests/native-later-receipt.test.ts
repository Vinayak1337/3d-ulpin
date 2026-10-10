import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fingerprint } from '../packages/server/src/modules/cases/domain';
import { localReaderControl, readerLifecycle, readerFixture, acceptedReaderJob, type ReaderControl } from
  './reader-pin-control';
import { kmlSourceTx, kmlInput, assertKMLInputTx, kmlStatusTx } from
  '../packages/server/src/modules/usp/ingestion/kml';
import { dxfSourceTx, dxfInput, assertDXFInputTx, dxfStatusTx } from
  '../packages/server/src/modules/usp/ingestion/dxf';
import { ifcSourceTx, ifcInput, assertIFCInputTx, ifcStatusTx } from
  '../packages/server/src/modules/usp/ingestion/ifc';
import { citygmlSourceTx, citygmlInput, assertCityGMLInputTx, citygmlStatusTx } from
  '../packages/server/src/modules/usp/ingestion/citygml';
import { cityjsonSourceTx, cityjsonInput, assertCityJSONInputTx, acceptedCityJSONTx } from
  '../packages/server/src/modules/usp/ingestion/cityjson';
import { gltfSourceTx, gltfInput, assertGltfInputTx, gltfStatusTx } from
  '../packages/server/src/modules/usp/ingestion/gltf';
import { objSourceTx, objInput, assertObjInputTx, objStatusTx } from
  '../packages/server/src/modules/usp/ingestion/obj';
import { geoparquetSourceTx, geoparquetInput, assertGeoParquetInputTx, geoparquetStatusAuthorityTx } from
  '../packages/server/src/modules/usp/ingestion/geoparquet';

async function cityjsonCapture(client: Parameters<typeof acceptedCityJSONTx>[0],
  caseId: string, sourceId: string, jobId: string) {
  const job = (await client.query('SELECT * FROM jobs WHERE id=$1', [jobId])).rows[0];
  const input = job.payload;
  try {
    return await acceptedCityJSONTx(client, { caseId, sourceId, jobId, caseRevision: input.caseRevision,
      sourceRevision: input.sourceRevision, sourceSha256: input.sourceSha256, resultSha256: job.result_ref.sha256 });
  } catch (error) {
    if ((error as any).status === 409) return { stale: true };
    throw error;
  }
}

// Parametrized SQL authority controls. They do not supply original/native artifact bytes or domain facts.
const readers: ReaderControl[] = [
  { name: 'KML', version: 'kml-native/1', profile: 'kml-native-v1', marker: 'kmlOriginal',
    operation: 'kml-native', asset: jobId => `kml:${jobId}:1`, source: kmlSourceTx,
    input: (ctx, jobId) => kmlInput(ctx, jobId, null, null), check: assertKMLInputTx, capture: kmlStatusTx },
  { name: 'DXF', version: 'dxf-native/1', profile: 'dxf-native-v1', marker: 'dxfOriginal',
    operation: 'dxf-native', asset: jobId => `dxf:${jobId}:1`, source: dxfSourceTx,
    input: (ctx, jobId) => dxfInput(ctx, jobId, 'complete_bounded_source', null), check: assertDXFInputTx, capture: dxfStatusTx },
  { name: 'IFC', version: 'ifc-native/1', profile: 'ifc-native-v1', marker: 'ifcOriginal',
    operation: 'ifc-native', asset: jobId => `ifc:${jobId}:1`, source: ifcSourceTx,
    input: (ctx, jobId) => ifcInput(ctx, jobId, 'complete_bounded_source', null), check: assertIFCInputTx, capture: ifcStatusTx },
  { name: 'CityGML', version: 'citygml-native/1', profile: 'citygml-native-v1', marker: 'citygmlOriginal',
    operation: 'citygml-native', asset: jobId => `citygml:${jobId}:1`, source: citygmlSourceTx,
    input: (ctx, jobId) => citygmlInput(ctx, jobId, null), check: assertCityGMLInputTx, capture: citygmlStatusTx },
  { name: 'CityJSON', version: 'cityjson-native/1', profile: 'cityjson-native-v1', marker: 'cityjsonOriginal',
    operation: 'cityjson-native', asset: jobId => `cityjson:${jobId}`, source: cityjsonSourceTx,
    input: (ctx, jobId) => cityjsonInput(ctx, jobId, 'complete_bounded_source'),
    check: assertCityJSONInputTx, capture: cityjsonCapture },
  { name: 'glTF', version: 'gltf-native/1', profile: 'gltf-native-v1', marker: 'gltfOriginal',
    operation: 'gltf-native', asset: jobId => `gltf:${jobId}:1`, source: gltfSourceTx,
    input: (ctx, jobId) => gltfInput(ctx, jobId, null), check: assertGltfInputTx, capture: gltfStatusTx },
  { name: 'OBJ', version: 'obj-native/1', profile: 'obj-native-v1', marker: 'objOriginal',
    operation: 'obj-native', asset: jobId => `obj:${jobId}:1`, source: objSourceTx,
    input: (ctx, jobId) => objInput(ctx, jobId, null), check: assertObjInputTx, capture: objStatusTx },
  { name: 'GeoParquet', version: 'geoparquet-native/1', profile: 'geoparquet-native-v1',
    marker: 'geoparquetOriginal', operation: 'geoparquet-native', asset: jobId => `geoparquet:${jobId}:1`,
    source: geoparquetSourceTx,
    input: (ctx, jobId) => geoparquetInput(ctx, jobId, { startRowIndex: 0, rowCount: 1 }, null),
    check: assertGeoParquetInputTx, capture: geoparquetStatusAuthorityTx },
];

for (const reader of readers) {
  test(`${reader.name}: later receipts preserve claim/completion/read pins and all refusals`, () =>
    localReaderControl(() => readerLifecycle(reader)));
}

test('GeoParquet continuation authority keeps the accepted parent seal and fence across later receipts', () =>
  localReaderControl(async () => {
    const reader = readers.find(item => item.name === 'GeoParquet')!;
    const f = readerFixture(reader);
    const ctx = await reader.source(f.client, f.caseId, f.sourceId);
    const parentInput = reader.input(ctx, randomUUID());
    const parent = acceptedReaderJob(reader, parentInput);
    const continuation = { jobId: parent.id, resultSha256: parent.result_ref.sha256,
      artifactSha256: fingerprint({ protocolArtifact: parent.id }), nextRowIndex: 1,
      inputSha256: fingerprint(parentInput), acceptedFence: 1 };
    const input = geoparquetInput(ctx, randomUUID(), { startRowIndex: 1, rowCount: 1 }, null, continuation);
    const child = acceptedReaderJob(reader, input);
    const query = f.client.query.bind(f.client);
    f.client.query = (async (sql: string, args: any[]) => {
      if (sql.includes('FROM jobs')) return { rows: [structuredClone(args[0] === parent.id ? parent : child)] };
      return query(sql);
    }) as any;
    const enrolled = fingerprint({ parent, child });
    f.current.revision++;
    const row = await geoparquetStatusAuthorityTx(f.client, f.caseId, f.sourceId, child.id);
    assert.equal(row.stale, false);
    assert.equal(fingerprint({ parent, child }), enrolled);
    parent.accepted_fence = parent.attempt_fence = 2;
    assert.equal((await geoparquetStatusAuthorityTx(f.client, f.caseId, f.sourceId, child.id)).stale, true);
  }));
