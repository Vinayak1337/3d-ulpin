import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { CaseIngestionEventSchema } from '../../packages/contracts/src/usp/index';

// Regenerate the changed native SSE producer only; preserve unrelated runtime receipts and producer pins.
type SchemaSerializer = {
  z: { toJSONSchema: (schema: typeof CaseIngestionEventSchema,
    options: { target: 'openapi-3.0' }) => Record<string, unknown> };
};
const { z } = createRequire(resolve('packages/contracts/package.json'))('zod') as SchemaSerializer;
const specPath = 'docs/api/openapi.json';
const pinsPath = 'docs/api/source-pins.json';
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
const event = spec.paths['/api/v1/ingestion/cases/{caseId}/events'].get.responses['200']
  .content['text/event-stream'];
assert(event['x-change-data-schema'], 'A3_SSE_PRODUCER_UNAVAILABLE');
event['x-change-data-schema'] = z.toJSONSchema(CaseIngestionEventSchema, { target: 'openapi-3.0' });
const producers = ['packages/contracts/src/usp/ingestion-events.ts',
  'packages/server/src/modules/usp/ingestion/chunk-mapping-agent.ts'];
for (const path of producers) {
  pins.sourceSha256[path] = createHash('sha256').update(readFileSync(path).toString('latin1')
    .replace(/\r\n/g, '\n'), 'latin1').digest('hex');
}
writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + '\n');
console.log(JSON.stringify({ regenerated: 'CaseIngestionEventSchema', repinned: producers }));
