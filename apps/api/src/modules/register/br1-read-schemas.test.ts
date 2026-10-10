import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildingLedgerDocumentation } from './building-ledger.documentation';

const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
function responseSchema(path: string) {
  const ref = published.paths[path].get.responses['200'].content['application/json'].schema.$ref;
  return published.components.schemas[ref.split('/').at(-1)];
}

test('published ledger history keeps stored answers valid and adds nullable kind, name and actor', () => {
  const schema = responseSchema('/api/v1/buildings/{buildingId}/ledger');
  assert.deepEqual(schema, buildingLedgerDocumentation);
  const entry = schema.properties.history.properties.registry.items;
  assert.deepEqual(entry.required, ['recordId', 'revision', 'recordedAt']);
  assert.deepEqual(entry.properties.recordKind,
    { type: 'string', enum: ['parcel', 'building', 'floor', 'space'], nullable: true });
  assert.deepEqual(entry.properties.recordName, { type: 'string', nullable: true });
  assert.deepEqual(entry.properties.actor, { type: 'string', nullable: true });
});
