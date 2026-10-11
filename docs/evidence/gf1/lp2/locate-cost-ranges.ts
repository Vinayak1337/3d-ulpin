import assert from 'node:assert/strict';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { readStreamingFeatures, sourceRecord }
  from '../../../../packages/server/src/modules/usp/ingestion/streaming-vector-reader';
import { STREAMING_VECTOR_LIMITS } from '../../../../packages/contracts/src/usp/streaming-vector';

async function main() {
  const results = [];
  for (const name of ['nyc', 'niagara', 'halifax']) {
    const input = JSON.parse(readFileSync(`docs/evidence/gf1/lp2/cost-${name}.json`, 'utf8'));
    let range;
    const receipt = await readStreamingFeatures(createReadStream(input.path), 'feature-collection', async item => {
      if (item.index !== input.index) return;
      const record = sourceRecord(item);
      range = { format: 'geojson', featureIndex: item.index, byteStart: record.byteStart, byteEnd: record.byteEnd,
        rawSha256: record.rawSha256, readerVersion: STREAMING_VECTOR_LIMITS.version };
    });
    assert(range);
    assert.equal(receipt.bytes, input.bytes);
    results.push({ name, path: input.path, sourceBytes: input.bytes, sourceSha256: receipt.sha256, range });
  }
  writeFileSync('docs/evidence/gf1/lp2/cost-ranges.json', JSON.stringify(results) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ located: results.length, method: 'reader scan at verified EOF; no import' }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
