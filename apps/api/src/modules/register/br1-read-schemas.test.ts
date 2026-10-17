import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildingLedgerDocumentation } from './building-ledger.documentation';
import { workQueue } from './documentation';

const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
function responseSchema(path: string) {
  const ref = published.paths[path].get.responses['200'].content['application/json'].schema.$ref;
  return published.components.schemas[ref.split('/').at(-1)];
}

test('published ledger history keeps stored answers valid and adds nullable kind, name and actor', () => {
  const schema = responseSchema('/api/v1/buildings/{buildingId}/ledger');
  const entry = schema.properties.history.properties.registry.items;
  assert.deepEqual(schema, buildingLedgerDocumentation);
  assert.deepEqual(entry.required, ['recordId', 'revision', 'recordedAt']);
  assert.deepEqual(entry.properties.recordKind,
    { type: 'string', enum: ['parcel', 'building', 'floor', 'space'], nullable: true });
  assert.deepEqual(entry.properties.recordName, { type: 'string', nullable: true });
  assert.deepEqual(entry.properties.actor, { type: 'string', nullable: true });
});

test('published work queue adds an optional table-source list so stored rows still compile', () => {
  const schema = responseSchema('/api/v1/work-queue');
  const item = schema.properties.items.items;
  assert.deepEqual(schema, workQueue);
  assert.deepEqual(item.properties.tableSourceIds, { type: 'array', items: { type: 'string' } });
  assert(!item.required.includes('tableSourceIds'));
  assert(!Object.hasOwn(item.properties, 'tableSourceId'));
});
