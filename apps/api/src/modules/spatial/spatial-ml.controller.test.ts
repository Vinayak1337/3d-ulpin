import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { spatialMlFootprintDraftSchema } from '@ulpin/server/modules/spatial/spatial-ml-footprints';
import { footprintDraftResult, requestWire } from './spatial.openapi';

const spec = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
const operation = spec.paths['/api/v1/spatial-ml/items/{itemId}/footprint-drafts'].post;

function published(schema: { $ref?: string }) {
  if (!schema.$ref) return schema;
  return spec.components.schemas[schema.$ref.split('/').at(-1)!];
}

test('published footprint decisions match the executable request validator and expose a nullable draft package', () => {
  const expected = requestWire(spatialMlFootprintDraftSchema);
  delete expected.$schema;
  assert.deepEqual(published(operation.requestBody.content['application/json'].schema), expected);
  const response = published(operation.responses['200'].content['application/json'].schema);
  assert.deepEqual(response, footprintDraftResult);
  assert.equal(response.properties.package.nullable, true);
  assert(!('minItems' in response.properties.receipt.properties.selections));
  assert.equal(response.properties.receipt.properties.decisions.type, 'array');
});

test('published receipt still retains the existing accept plus reject response fields', () => {
  const retained = JSON.parse(readFileSync('docs/evidence/gf-backend/k2c/roofprint-draft.json', 'utf8'));
  const required = footprintDraftResult.properties.receipt.required;
  assert(required.every(key => key in retained.receipt));
  assert(retained.package.id);
  assert(retained.receipt.selections.length > 0);
  assert(retained.receipt.decisions.some((decision: { outcome: string }) => decision.outcome === 'accepted'));
  assert(retained.receipt.decisions.some((decision: { outcome: string }) => decision.outcome === 'rejected'));
});
