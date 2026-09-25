import test from 'node:test';
import assert from 'node:assert/strict';
import type { PhysicalFeature, RegistryRecord } from '@ulpin/contracts';
import { displayClass, recordOutline, rightsClass, utilityType } from '../apps/web/features/officer/block/mapStyleModel';

const feature = (overrides: Partial<PhysicalFeature> = {}) => ({
  kind: 'building', height: { state: 'unknown', value: null }, properties: {},
  ...overrides,
}) as PhysicalFeature;
const record = (rights: RegistryRecord['rights']) => ({ rights }) as RegistryRecord;

test('uncertain geometry and absent status remain distinct from recorded evidence', () => {
  assert.equal(displayClass(feature()), 'unknown');
  assert.equal(displayClass(feature({ height: { state: 'estimated', value: 12, unit: 'm', meaning: 'height', reference: 'local' } })), 'estimated');
  assert.equal(displayClass(feature({ properties: { geometryClass: 'illustrative' } })), 'illustrative');
  assert.equal(recordOutline(feature()), 'unknown');
  assert.equal(recordOutline(feature({ properties: { recordStatus: 'draft' } })), 'draft');
});

test('rights colours require one unambiguous saved right', () => {
  const ownership = { type: 'ownership_claim', party: 'Recorded party', evidence: {} } as RegistryRecord['rights'][number];
  const shared = { ...ownership, type: 'shared_use' } as RegistryRecord['rights'][number];
  assert.equal(rightsClass(record([])), 'unknown');
  assert.equal(rightsClass(record([ownership])), 'claim');
  assert.equal(rightsClass(record([ownership, shared])), 'unknown');
});

test('utilities without a recorded network type do not get an invented APWA colour', () => {
  assert.equal(utilityType(feature({ kind: 'utility' })), 'unknown');
  assert.equal(utilityType(feature({ kind: 'utility', properties: { utility_type: 'water' } })), 'water');
  assert.equal(utilityType(feature({ kind: 'utility', properties: { utility_type: 'mystery' } })), 'unknown');
});
