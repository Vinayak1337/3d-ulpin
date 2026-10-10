import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_TARGETS,
  CanonicalTargetDefinitionSchema,
  canonicalTarget,
  MappingTargetSchema,
} from './targets';
import { MappingPlanV2Schema } from './mapping-plan';

test('one reusable vocabulary has labels, meanings, dimensions and copy-only source identifiers', () => {
  for (const [target, definition] of Object.entries(CANONICAL_TARGETS)) {
    assert.equal(CanonicalTargetDefinitionSchema.safeParse(definition).success, true, target);
    if (!definition.modelMayPropose) assert.deepEqual(definition.allowedOperations, ['copy'], target);
  }
  for (const entity of ['building', 'parcel', 'unit', 'level', 'space', 'document'])
    assert(Object.keys(CANONICAL_TARGETS).some((target) => target.startsWith(entity + '.')));
  for (const target of ['building.sourceKey', 'building.name', 'building.geometry'])
    assert(MappingTargetSchema.safeParse(target).success);
  assert.equal(canonicalTarget('building.geometry'), 'building.footprint');
  assert(!MappingTargetSchema.safeParse('owner.name').success);
});

test('the published v2 schema rejects executable literal factors, coordinates, EPSG and invented IDs', () => {
  const field = {
    sourceField: 'column',
    target: 'unknown',
    operation: { kind: 'copy' },
    confidence: 0,
    rationale: 'Schema-only safety control.',
  };
  const base = {
    version: 'mapping-plan/2',
    layoutFingerprint: 'a'.repeat(64),
    sourceKind: 'tabular',
    method: 'reviewer:a1-worker',
    fields: [field],
  };
  assert(MappingPlanV2Schema.safeParse(base).success);
  for (const operation of [
    { kind: 'unit_convert', sourceUnit: 'ft2', factor: 0.09290304 },
    { kind: 'copy', epsg: 'EPSG:4326' },
    { kind: 'copy', coordinates: [77, 28] },
    { kind: 'copy', identifier: 'invented-id' },
  ])
    assert(!MappingPlanV2Schema.safeParse({ ...base, fields: [{ ...field, operation }] }).success);
});
