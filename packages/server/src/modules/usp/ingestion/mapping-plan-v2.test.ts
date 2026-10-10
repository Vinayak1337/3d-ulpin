import test from 'node:test';
import assert from 'node:assert/strict';
import type { MappingLayoutField, MappingPlanV2 } from '@ulpin/contracts';
import { layoutFingerprint, validateMappingPlanV2, type MappingValidationContext } from './mapping-plan-v2';
import { validateAdaptiveMapping } from './adaptive-mapping';

export const controlPlan = (
  fields: readonly MappingLayoutField[],
  overrides: Partial<MappingPlanV2['fields'][number]> = {},
): MappingPlanV2 => ({
  version: 'mapping-plan/2',
  sourceKind: 'tabular',
  method: 'model:validator-control@1',
  layoutFingerprint: layoutFingerprint(fields),
  fields: fields.map((field) => ({
    sourceField: field.name,
    target: 'unknown',
    operation: { kind: 'copy' },
    confidence: 0,
    rationale: 'Software-only validation control; not a source record or training label.',
    ...overrides,
  })),
});

test('layout hashing normalises headers, keeps order/types and includes Devanagari', () => {
  const fields = [
    { name: '  Floor   Label ', inferredType: 'text' },
    { name: 'खसरा', inferredType: 'text' },
  ] as const;
  assert.equal(
    layoutFingerprint(fields),
    layoutFingerprint([{ name: 'floor label', inferredType: 'text' }, fields[1]]),
  );
  assert.notEqual(layoutFingerprint(fields), layoutFingerprint([...fields].reverse()));
  assert.notEqual(
    layoutFingerprint(fields),
    layoutFingerprint([{ ...fields[0], inferredType: 'number' }, fields[1]]),
  );
});

test('stable literal rejection and target/operation/source/unit/parent checks fail closed', () => {
  const fields = [{ name: 'Area', inferredType: 'text', declaredUnit: 'ft2' }] as const;
  const context: MappingValidationContext = { sourceKind: 'tabular', fields };
  const plan = controlPlan(fields, {
    target: 'parcel.area',
    operation: { kind: 'unit_convert', sourceUnit: 'ft2' },
  });
  assert(validateMappingPlanV2(plan, context).success);
  assert.equal(validateAdaptiveMapping(plan, context).status, 'proposed');
  const code = (raw: unknown, ctx = context) => validateMappingPlanV2(raw, ctx).errors[0]?.code;
  for (const injection of [
    { factor: 0.09290304 },
    { epsg: 'EPSG:4326' },
    { coordinates: [77, 28] },
    { identifier: 'invented-id' },
    { tool: 'approve' },
  ]) {
    const raw = {
      ...plan,
      fields: [{ ...plan.fields[0], operation: { ...plan.fields[0].operation, ...injection } }],
    };
    assert.equal(code(raw), 'MAPPING_LITERAL_FORBIDDEN');
  }
  assert.equal(
    code({ ...plan, fields: [{ ...plan.fields[0], target: 'parcel.fake' }] }),
    'MAPPING_TARGET_UNKNOWN',
  );
  assert.equal(
    code({ ...plan, fields: [{ ...plan.fields[0], target: 'parcel.ulpinAnchor' }] }),
    'MAPPING_OPERATION_NOT_ALLOWED',
  );
  assert(
    validateMappingPlanV2(
      { ...plan, fields: [{ ...plan.fields[0], target: 'parcel.ulpinAnchor' }] },
      context,
    ).errors.some((e) => e.code === 'MAPPING_IDENTIFIER_COPY_ONLY'),
  );
  assert.equal(
    code({ ...plan, fields: [{ ...plan.fields[0], sourceField: 'not-a-column' }] }),
    'MAPPING_SOURCE_FIELD_UNKNOWN',
  );
  assert.equal(code({ ...plan, layoutFingerprint: 'b'.repeat(64) }), 'MAPPING_LAYOUT_MISMATCH');
  assert.equal(
    code(plan, { ...context, fields: [{ ...fields[0], declaredUnit: 'm2' }] }),
    'MAPPING_UNIT_NOT_DECLARED',
  );
  assert.equal(
    code(
      controlPlan(fields, {
        target: 'level.label',
        operation: { kind: 'parse_literal', literalKind: 'number' },
      }),
    ),
    'MAPPING_PARSE_KIND_NOT_ALLOWED',
  );
  assert.equal(
    code(
      controlPlan(fields, {
        target: 'unit.parentSourceKey',
        operation: { kind: 'link_parent_key', parentField: 'missing' },
      }),
    ),
    'MAPPING_PARENT_FIELD_UNKNOWN',
  );
  assert.equal(code({ ...plan, fields: [] }), 'MAPPING_SCHEMA_INVALID');
});
