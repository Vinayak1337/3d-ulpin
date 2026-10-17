import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { MappingPlanV2 } from '@ulpin/contracts';
import { layoutFingerprint } from './mapping-plan-v2';
import { lookupMappingMemory, rememberMapping } from './mapping-memory';

const context = { sourceKind: 'tabular' as const,
  fields: [{ name: 'Carpet Area (sq ft)', inferredType: 'number' as const, declaredUnit: 'ft2' as const }] };
const fingerprint = layoutFingerprint(context.fields);
const plan: MappingPlanV2 = {
  version: 'mapping-plan/2', layoutFingerprint: fingerprint, sourceKind: 'tabular', method: 'model:teacher@dev',
  fields: [{ sourceField: context.fields[0].name, target: 'unit.carpetArea', operation: {
    kind: 'unit_convert', sourceUnit: 'ft2',
  }, confidence: 0.9, rationale: 'Source declares carpet area and square feet.' }],
};
const teacher = { source: 'teacher' as const, method: plan.method, labelFileSha256: 'a'.repeat(64) };
const path = () => `E:/BhuAayam-data/task-data/a4/memory/test-${randomUUID()}.jsonl`;

test('exact memory hit revalidates and miss returns null', () => {
  const file = path();
  rememberMapping(plan, context, teacher, file);
  const hit = lookupMappingMemory(fingerprint, context, file);
  assert.equal(hit.plan?.method, `memory:${fingerprint.slice(0, 12)}`);
  assert.equal(hit.plan?.fields[0].target, 'unit.carpetArea');
  assert.equal(lookupMappingMemory('b'.repeat(64), context, file).plan, null);
});

test('latest officer plan outranks later teacher append for the same fingerprint', () => {
  const file = path();
  rememberMapping(plan, context, teacher, file);
  const officer = { ...plan, method: 'reviewer:officer', fields: [{ ...plan.fields[0], target: 'unknown' as const,
    operation: { kind: 'copy' as const }, rationale: 'Officer retains interpretation unresolved.' }] };
  rememberMapping(officer, context,
    { source: 'officer', method: officer.method, officerDecisionId: 'test-only-decision' }, file);
  rememberMapping(plan, context, teacher, file);
  assert.equal(lookupMappingMemory(fingerprint, context, file).plan?.fields[0].target, 'unknown');
});

test('stale same-layout unit evidence fails closed with the verifier reason', () => {
  const file = path();
  rememberMapping(plan, context, teacher, file);
  const stale = { ...context, fields: [{ name: context.fields[0].name, inferredType: 'number' as const }] };
  const hit = lookupMappingMemory(fingerprint, stale, file);
  assert.equal(hit.plan, null);
  assert.equal(hit.reasonCode, 'MAPPING_UNIT_NOT_DECLARED');
});
