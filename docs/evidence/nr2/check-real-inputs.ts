import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import type { StreamingVectorGeometrySummary } from '@ulpin/contracts/usp';
import { readStreamingFeatures, sourceRecord } from
  '../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import { tallyAcceptedGeometry, tallySetAside } from
  '../../../packages/server/src/modules/usp/ingestion/streaming-vector-worker';

// Existing public fixtures used test_only. No processor, database, acquisition or original rewrite.
const paths = [
  'fixtures/usp/D4/gf0-context-v1/osm-road-centrelines.geojson',
  'fixtures/uttam-nagar/delhi-boundary.geojson',
];

for (const path of paths) {
  const before = createHash('sha256').update(readFileSync(path)).digest('hex');
  const counts: StreamingVectorGeometrySummary['counts'] = {};
  const rejected: Record<string, number> = {};
  const result = await readStreamingFeatures(createReadStream(path), 'feature-collection', async item => {
    const record = sourceRecord(item);
    tallyAcceptedGeometry(counts, record);
    tallySetAside(rejected, record);
  });
  const after = createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(result.sha256, before);
  assert.equal(after, before);
  console.log(JSON.stringify({ path, use: 'test_only', bytes: result.bytes, records: result.features,
    acceptedByKind: counts, rejectedByCode: rejected, sourceUnchanged: true, topology: 'not_run' }));
}
