import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CanonicalMappedValueSchema, type MappingLayoutField, type MappingPlanV2 } from '@ulpin/contracts';
import {
  executeMappingPlanV2,
  parseIndianNumber,
  parseSourceDate,
  type MappingExecutionContext,
} from './mapping-executor';
import { layoutFingerprint, legacyPlanToV2, mappingContextFromGisProfile } from './mapping-plan-v2';
import { normalizeMappedChunk } from './chunk-mapping-normalizer';
import { validateAdaptiveMapping } from './adaptive-mapping';
import { MappingPlanSchema, SourceProfileSchema } from '@ulpin/contracts/usp';
import { inspectedProfile } from './registry';
import { createHash } from 'node:crypto';
import { UNIT_TABLE } from './unit-table';

const planFor = (
  fields: readonly MappingLayoutField[],
  mapping: Partial<MappingPlanV2['fields'][number]>[],
): MappingPlanV2 => ({
  version: 'mapping-plan/2',
  sourceKind: 'tabular',
  layoutFingerprint: layoutFingerprint(fields),
  method: 'reviewer:a1-worker',
  fields: fields.map((field, index) => ({
    sourceField: field.name,
    target: 'unknown',
    operation: { kind: 'copy' },
    confidence: 0,
    rationale: 'Software-only parser control, not a real data-pack record.',
    ...mapping[index],
  })),
});

test('Indian numeric/date parser controls preserve ambiguity; empty and invalid never become zero', () => {
  assert.equal(parseIndianNumber('1,23,456'), 123456);
  assert.equal(parseIndianNumber('१,२३,४५६'), 123456);
  assert.equal(parseIndianNumber('1,234,567.25'), 1234567.25);
  assert.equal(parseIndianNumber('0'), 0);
  for (const value of ['', null, '1,23', '12,34,56', '123/4', 'G', '10\'6"', Infinity])
    assert.equal(parseIndianNumber(value), null);
  assert.equal(parseSourceDate('29/02/2024', 'date_dmy'), '2024-02-29');
  assert.equal(parseSourceDate('३१/१२/२०२५', 'date_dmy'), '2025-12-31');
  assert.equal(parseSourceDate('31/02/2025', 'date_dmy'), null);
  assert.equal(parseSourceDate('01/02/2025', 'date_iso'), null);
});

test('executor controls: identifiers/floors verbatim, sourced unit arithmetic and every failure has a locator', () => {
  // Scalar parser controls from the task brief, never presented as acquired records/evaluation truth.
  const fields = [
    { name: 'khasra', inferredType: 'text' },
    { name: 'floor', inferredType: 'text' },
    { name: 'area', inferredType: 'text', declaredUnit: 'ft2' },
    { name: 'date', inferredType: 'text' },
    { name: 'regional', inferredType: 'text', declaredUnit: 'bigha' },
  ] as const;
  const plan = planFor(fields, [
    { target: 'parcel.khasra' },
    { target: 'unit.floorLabel' },
    { target: 'space.area', operation: { kind: 'unit_convert', sourceUnit: 'ft2' } },
    { target: 'document.date', operation: { kind: 'parse_literal', literalKind: 'date_dmy' } },
    { target: 'parcel.area', operation: { kind: 'unit_convert', sourceUnit: 'bigha' } },
  ]);
  const context: MappingExecutionContext = {
    sourceKind: 'tabular',
    fields,
    sourceRef: 'software-parser-control',
  };
  const result = executeMappingPlanV2(
    plan,
    [
      { khasra: '123/4', floor: 'UGF', area: '१,२३,४५६ ft²', date: '31/12/2025', regional: '1 bigha' },
      { khasra: '१२३/४', floor: 'B1', area: '', date: '31/02/2025', regional: '1 bigha' },
      { khasra: null, floor: 'Terrace', area: '1 sq yd', regional: null },
    ],
    context,
  );
  assert.equal(result.rows[0].fields[0].value, '123/4');
  assert.equal(result.rows[1].fields[0].value, '१२३/४');
  assert.equal(result.rows[0].fields[1].value, 'UGF');
  assert.equal(result.rows[1].fields[1].value, 'B1');
  const area = result.rows[0].fields[2];
  assert.equal(area.value, 123456 * 0.09290304);
  assert.equal(area.literal, '१,२३,४५६ ft²');
  assert.equal(area.unit, 'm2');
  assert.equal(area.conversionSource, UNIT_TABLE.ft2.source);
  assert.equal(result.rows[1].fields[2].state, 'needs_input');
  assert.equal(result.rows[1].fields[2].value, null);
  assert.equal(
    result.rows[2].fields[2].state,
    'needs_input',
    'Mixed unit contradicting declaration is not converted.',
  );
  assert.equal(result.rows[2].fields[3].state, 'absent');
  assert.equal(result.rows[2].fields[0].state, 'null');
  assert.equal(result.rows[0].fields[4].state, 'needs_input');
  for (const row of result.rows)
    for (const field of row.fields) {
      const { sourceField, target, ...value } = field;
      assert(CanonicalMappedValueSchema.safeParse(value).success);
      assert.deepEqual(value.citations, [
        { sourceRef: context.sourceRef, row: row.row, column: sourceField },
      ]);
      assert.equal(value.method, plan.method);
      assert.notEqual(value.state, 'reviewed');
    }
  const bad = { ...plan, fields: [{ ...plan.fields[0], operation: { kind: 'copy', value: 'invented' } }] };
  assert.throws(() => executeMappingPlanV2(bad, [], context), { code: 'MAPPING_PLAN_INVALID' });
});

test('parent links require exactly one supplied parent key, not merely a syntactically valid field', () => {
  const fields = [{ name: 'source_parent', inferredType: 'text' }] as const;
  const plan = planFor(fields, [
    { target: 'unit.parentSourceKey', operation: { kind: 'link_parent_key', parentField: 'parent_key' } },
  ]);
  const context: MappingExecutionContext = {
    sourceKind: 'tabular',
    fields,
    sourceRef: 'software-link-control',
    parentFields: ['parent_key'],
  };
  const row = { source_parent: '123/4' };
  assert.equal(executeMappingPlanV2(plan, [row], context).rows[0].fields[0].state, 'needs_input');
  assert.equal(
    executeMappingPlanV2(plan, [row], {
      ...context,
      parents: [{ field: 'parent_key', rows: [{ parent_key: '123/4' }] }],
    }).rows[0].fields[0].state,
    'candidate',
  );
  assert.equal(
    executeMappingPlanV2(plan, [row], {
      ...context,
      parents: [{ field: 'parent_key', rows: [{ parent_key: '123/4' }, { parent_key: '123/4' }] }],
    }).rows[0].fields[0].issueCode,
    'MAPPING_PARENT_KEY_AMBIGUOUS',
  );
});

test('unchanged real NYC source: v1 alias, adaptive v2 and chunk v2 seam retain candidate-only provenance', () => {
  const bytes = readFileSync(
    new URL('../../../../../../fixtures/real-nyc/original.geojson', import.meta.url),
  );
  const raw = JSON.parse(bytes.toString()),
    hash = createHash('sha256').update(bytes).digest('hex');
  const inventory = inspectedProfile(bytes, {
    format: 'geojson',
    sourceSha256: hash,
    bytes: bytes.length,
    layers: [],
    layer: null,
    sourceCrs: 'EPSG:4326',
    crsEvidence: raw.crs.properties.name,
    featureCount: raw.features.length,
    geometryTypes: ['MultiPolygon'],
    fields: Object.keys(raw.features[0].properties).map((name) => ({
      name,
      complete: false,
      unique: false,
      idEligible: false,
    })),
    featureIdEligible: false,
    suggestedIdField: null,
    suggestedNameField: null,
    suggestedTitle: 'NYC BUILDING',
    suggestedNamespace: 'source:' + hash,
  });
  const { schemaFingerprint, ...rest } = inventory;
  const uuid = '00000000-0000-4000-8000-000000000001';
  const profile = SourceProfileSchema.parse({
    ...rest,
    source: { sourceId: uuid, familyId: uuid, sourceRevision: 1, sourceSha256: hash, schemaFingerprint },
    caseId: uuid,
    workspaceRevision: 1,
    workspaceFingerprint: 'a'.repeat(64),
  });
  const legacy = MappingPlanSchema.parse({
    version: 'manual-geojson/1',
    mode: 'manual_mapping',
    source: profile.source,
    caseId: uuid,
    workspaceRevision: 1,
    workspaceFingerprint: profile.workspaceFingerprint,
    operations: [
      {
        target: 'building.sourceKey',
        sourcePath: '/features/*/properties/doitt_id',
        conversionId: 'literal_identifier@1',
      },
      { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
    ],
  });
  const context = mappingContextFromGisProfile(profile),
    plan = legacyPlanToV2(legacy, context, 'reviewer:a1-worker');
  assert.equal(validateAdaptiveMapping(plan, profile).status, 'proposed');
  const result = normalizeMappedChunk(
    [
      {
        featureIndex: 0,
        byteStart: 0,
        byteEnd: bytes.length,
        rawSha256: hash,
        disposition: 'accepted',
        issueCode: null,
        feature: raw.features[0],
      },
    ],
    plan,
    profile,
    uuid,
    0,
    [],
  );
  const key = result.rows[0].fields.find((field) => field.target === 'building.sourceKey');
  assert.equal(key?.value, raw.features[0].properties.doitt_id);
  const geometry = result.rows[0].fields.find((field) => field.target === 'building.footprint');
  assert.deepEqual(geometry?.value, raw.features[0].geometry);
  assert.equal(geometry?.state, 'candidate');
  assert.equal(geometry?.sourceCrs, 'EPSG:4326');
  // Regression for an executor seam found during implementation: an unprofiled real column was being dropped.
  const extra = '/features/*/properties/height_roof';
  const driftContext = {
    ...context,
    fields: context.fields.filter((field) => field.name !== extra),
    sourceRef: profile.source.sourceId,
    sourceCrs: 'EPSG:4326',
  };
  const driftPlan = legacyPlanToV2(legacy, driftContext, 'reviewer:a1-worker');
  const drift = normalizeMappedChunk(
    [
      {
        featureIndex: 0,
        byteStart: 0,
        byteEnd: bytes.length,
        rawSha256: hash,
        disposition: 'accepted',
        issueCode: null,
        feature: raw.features[0],
      },
    ],
    driftPlan,
    driftContext,
    uuid,
    0,
    [],
  );
  const retained = drift.rows[0].fields.find((field) => field.sourceField === extra);
  assert.equal(retained?.state, 'needs_input');
  assert.equal(retained?.issueCode, 'MAPPING_ROW_SCHEMA_DRIFT');
  assert.equal(retained?.literal, raw.features[0].properties.height_roof);
  assert.equal(drift.counts.cells, context.fields.length);
});
