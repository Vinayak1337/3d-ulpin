import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MappingMethodSchema, type ColumnProfileDocument } from '@ulpin/contracts';
import { MappingChunkMetricsSchema, TabularChunkResultSchema } from '@ulpin/contracts/usp';
import { profileColumns, profileGisAttributes } from './column-profile';
import { TabularChunkMapper } from './chunk-mapping-agent';
import { layoutFingerprint, validateMappingPlanV2 } from './mapping-plan-v2';
import { proposeMappingRules } from './mapping-rules';
import { manualTeacherPlan, mappingContextFromColumnProfile, proposeMapping,
  type MappingRoutingResult } from './mapping-teacher';
import { rememberMapping } from './mapping-memory';
import { fakeStudentChild } from './mapping-student.fixture';
import { requestContext, ControlLedger, controlConfig, unknownResponse } from
  '../../../../../../scripts/agent/control-runtime';
import { ModelGateway } from '../../model-gateway/gateway';
import { ControlAdapter, ReplayAdapter } from '../../model-gateway/adapter';
import { TeacherRecordings } from '../../model-gateway/recordings';
import { hash } from '../../model-gateway/config';

const nyc = JSON.parse(readFileSync('fixtures/real-nyc/original.geojson', 'utf8'));
const profile = profileGisAttributes(nyc.features.map((feature: { properties: Record<string, unknown> }) =>
  feature.properties)).profile;
const options = () => ({ context: requestContext, authorize: async () => {},
  dataPolicy: { dataClass: 'public' as const, split: 'development' as const },
  memoryPath: join(tmpdir(), `s4-2-${randomUUID()}.jsonl`) });
const targets = (value: ColumnProfileDocument) => new Map(proposeMappingRules(value)
  .map(({ field }) => [field.sourceField, field.target]));

function headers(names: string[], numeric = false) {
  const value = profileColumns([], names.map(name => ({ name })), 'tabular');
  if (numeric) value.columns.forEach(column => { column.inferredType = 'number'; });
  value.layoutFingerprint = layoutFingerprint(value.columns);
  return value;
}

test('NYC properties name building fields but never assume roof height units', () => {
  const matched = targets(profile);
  assert.equal(matched.get('bin'), 'building.sourceKey');
  assert.equal(matched.get('name'), 'building.name');
  assert.equal(matched.get('height_roof') ?? 'unknown', 'unknown');
  assert.equal(profile.columns.find(column => column.name === 'height_roof')?.declaredUnit, undefined);
});

test('Baton Rouge headers require a count meaning and explicit feet; generic IDs stay unknown', () => {
  const value = headers(['NUMBER OF FLOORS', 'HEIGHT (FEET)', 'ID', 'ID 2'], true);
  const matched = proposeMappingRules(value);
  assert.equal(targets(value).get('NUMBER OF FLOORS'), 'building.storeyCount');
  assert.deepEqual(matched.find(rule => rule.field.sourceField === 'HEIGHT (FEET)')?.field.operation,
    { kind: 'unit_convert', sourceUnit: 'ft' });
  assert.equal(targets(value).get('ID') ?? 'unknown', 'unknown');
  assert.equal(targets(value).get('ID 2') ?? 'unknown', 'unknown');
  assert.equal(targets(headers(['Building Address'])).get('Building Address'), 'building.addressLiteral');
});

test('Gurugram LGD administrative codes and names are not building or parcel fields', () => {
  const [line] = readFileSync('fixtures/usp/D4/reference-area-gurugram-59-63a/lgd-gurugram.csv', 'utf8').split('\n');
  assert.equal(proposeMappingRules(headers(line.trim().split(','))).length, 0);
});

test('Hindi headers work, while ambiguous targets, missing units and floor labels abstain', () => {
  assert.equal(targets(headers(['भवन का नाम'])).get('भवन का नाम'), 'building.name');
  assert.equal(targets(headers(['मंजिलों की संख्या'], true)).get('मंजिलों की संख्या'), 'building.storeyCount');
  assert.equal(targets(headers(['ऊंचाई (m)'], true)).get('ऊंचाई (m)'), 'building.heightM');
  assert.equal(proposeMappingRules(headers(['Building Name', '2|भवन का नाम'])).length, 0);
  assert.equal(proposeMappingRules(headers(['Height', 'Floors', 'Area'], true)).length, 0);
  const labelled = headers(['NUMBER OF FLOORS'], true);
  labelled.columns[0].valueShapes.floorLabelRate = 1;
  assert.equal(proposeMappingRules(labelled).length, 0);
  assert.equal(proposeMappingRules(headers(['Height (sq ft)'], true)).length, 0);
});

test('rules precede the student, preserve metadata alignment and shield their fields from the teacher', async t => {
  const model = mkdtempSync(join(tmpdir(), 's4-2-student-'));
  writeFileSync(join(model, 'manifest.json'), JSON.stringify({ version: 'v1' }));
  let inputs: { profileId: string; header: string }[] = [];
  const spawn = t.mock.method(childProcess, 'spawn', () => fakeStudentChild(input => {
    inputs = JSON.parse(input);
    return { code: 0, stdout: inputs.map(input => JSON.stringify({ profileId: input.profileId,
      target: 'unknown', probability: 0, committed: false, version: 'v1' })).join('\n') };
  }));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  let teacherColumns: string[] = [];
  const result = await proposeMapping(profile, { ...options(), learnerModelPath: model,
    learnerColumns: profile.columns.map((column, index) => ({ profileId: String(index), header: column.name,
      neighbourHeaders: [], cellCount: 1, emptyCount: 0 })), teacher: async remaining => {
      teacherColumns = remaining.columns.map(column => column.name);
      return manualTeacherPlan(remaining, 'TEACHER_UNAVAILABLE');
    } });
  for (const name of ['bin', 'name']) {
    assert.equal(result.fieldSources.find(field => field.sourceField === name)?.source, 'rule');
    assert.match(result.fieldSources.find(field => field.sourceField === name)!.method, /^rule:[^@]+@1$/);
    assert(!inputs.some(input => input.header === name));
    assert(!teacherColumns.includes(name));
    assert(!result.issues.some(issue => issue.sourceField === name));
  }
  assert.equal(inputs.length, profile.columns.length - 2);
  assert(inputs.every(input => profile.columns[Number(input.profileId)].name === input.header));
  const allRules = profileGisAttributes(nyc.features.map((feature: { properties: Record<string, unknown> }) =>
    feature.properties), ['bin', 'name']).profile;
  await proposeMapping(allRules, { ...options(), learnerModelPath: model, teacher: async () => {
    assert.fail('All columns were already answered by rules.');
  } });
  assert.equal(spawn.mock.callCount(), 1);
});

test('all-rule chunks skip both later stages, publish rule counts and remain proposals', async () => {
  const draft = await new TabularChunkMapper().map({ jobId: randomUUID(), chunkIndex: 0,
    headers: ['Building ID', 'Building Name'],
    rows: [[nyc.features[0].properties.bin, nyc.features[0].properties.name]],
    sourceRef: 'fixtures/real-nyc/original.geojson' }, { ...options(), teacher: async () => {
      assert.fail('No unmatched columns should reach the teacher.');
    } });
  assert.equal(draft.metrics.ruleFields, 2);
  assert.equal(draft.metrics.teacherCalls, 0);
  assert.equal(draft.metrics.studentFields, 0);
  assert.equal(draft.proposal.studentReasonCode, null);
  assert.equal(draft.proposal.state, 'candidate');
  assert(draft.proposal.fieldSources.every(field => field.source === 'rule'));
  TabularChunkResultSchema.parse({ profile: draft.profile, plan: draft.proposal.plan,
    fieldSources: draft.proposal.fieldSources, questions: draft.questions, metrics: draft.metrics,
    sourceRows: [1], rows: draft.dryRun.rows });
  const { ruleFields: _omitted, ...old } = draft.metrics;
  assert.equal(MappingChunkMetricsSchema.parse(old).ruleFields, undefined);
  assert(MappingMethodSchema.safeParse('rule:building-key@1').success);
  assert(!MappingMethodSchema.safeParse('rule:building-key').success);
});

test('exact officer memory still wins, and an invalid later answer cannot discard validated rule fields', async () => {
  const value = headers(['Building Name']);
  const plan = { ...manualTeacherPlan(value, 'MAPPING_REVIEW_REQUIRED').plan, method: 'reviewer:confirmed' };
  const routing = options();
  rememberMapping(plan, mappingContextFromColumnProfile(value), {
    source: 'officer', method: plan.method, officerDecisionId: randomUUID(),
  }, routing.memoryPath);
  const remembered = await proposeMapping(value, routing);
  assert.equal(remembered.fieldSources[0].source, 'officer');
  assert.equal(remembered.plan.fields[0].target, 'unknown');
  const result = await proposeMapping(profile, { ...options(), teacher: async remaining => {
    const answer = manualTeacherPlan(remaining, 'TEACHER_UNAVAILABLE');
    answer.plan.method = 'model:test@1';
    answer.plan.fields[0].operation = { kind: 'unit_convert', sourceUnit: 'm' };
    return answer;
  } });
  assert.equal(result.plan.fields.find(field => field.sourceField === 'bin')?.target, 'building.sourceKey');
  assert.equal(result.fieldSources.find(field => field.sourceField === 'bin')?.source, 'rule');
  assert(result.fieldSources.filter(field => !['bin', 'name'].includes(field.sourceField))
    .every(field => field.source === 'unanswered' && field.method === 'manual:MAPPING_ROUTING_INVALID'));
  assert(validateMappingPlanV2(result.plan, mappingContextFromColumnProfile(profile)).success);
});

const clashProfile = profileGisAttributes(nyc.features.map((feature: { properties: Record<string, unknown> }) =>
  feature.properties), ['bin', 'objectid', 'last_edited_date']).profile;

function assertRuleClash(result: MappingRoutingResult, stage: 'teacher' | 'student') {
  assert.equal(result.fieldSources.find(field => field.sourceField === 'bin')?.source, 'rule');
  assert.equal(result.plan.fields.find(field => field.sourceField === 'bin')?.target, 'building.sourceKey');
  const clashing = result.plan.fields.find(field => field.sourceField === 'objectid')!;
  assert.equal(clashing.target, 'unknown');
  assert.deepEqual(clashing.operation, { kind: 'copy' });
  assert.equal(clashing.confidence, 0);
  const issues = result.issues.filter(issue => issue.sourceField === 'objectid');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'MAPPING_RULE_TARGET_TAKEN');
  assert.match(issues[0].message!, /rule column "bin"/u);
  assert.equal(clashing.rationale, issues[0].message);
  assert.equal(result.plan.fields.find(field => field.sourceField === 'last_edited_date')?.target, 'document.date');
  assert.equal(result.fieldSources.find(field => field.sourceField === 'last_edited_date')?.source, stage);
  assert(!result.issues.some(issue => issue.sourceField !== 'objectid'));
  assert(validateMappingPlanV2(result.plan, mappingContextFromColumnProfile(clashProfile)).success);
}

test('a replay teacher clash changes only the losing column; another teacher answer survives', async () => {
  const recordings = new TeacherRecordings(mkdtempSync(join(tmpdir(), 's4-2-clash-replay-')));
  const control = new ModelGateway(controlConfig(), new ControlLedger(), new ControlAdapter(async request => {
    const response = unknownResponse(request);
    const columns = JSON.parse(request.messages[1].content).columnProfile.columns;
    const output = { fields: columns.map((column: { sourceField: string }, index: number) => ({
      sourceField: column.sourceField, target: index === 0 ? 'building.sourceKey' : 'document.date',
      operation: { kind: 'copy' }, confidence: 'high', rationale: 'Replay routing control, not evaluation truth.',
    })) };
    return { ...response, output, responseHash: hash(output), rawResponse: { output } };
  }));
  await proposeMapping(clashProfile, { ...options(), gateway: control, recordings });
  const replay = new ModelGateway(controlConfig(), new ControlLedger(),
    new ReplayAdapter(key => recordings.replay(key)));
  const result = await proposeMapping(clashProfile, { ...options(), gateway: replay });
  assert.equal(result.replayed, true);
  assertRuleClash(result, 'teacher');
});

test('a stubbed student clash changes only the losing column without running Python', async t => {
  const model = mkdtempSync(join(tmpdir(), 's4-2-clash-student-'));
  writeFileSync(join(model, 'manifest.json'), JSON.stringify({ version: 'v1' }));
  const spawn = t.mock.method(childProcess, 'spawn', () => fakeStudentChild(input => {
    const inputs: { profileId: string }[] = JSON.parse(input);
    return { code: 0, stdout: inputs.map((input, index) => JSON.stringify({ profileId: input.profileId,
      target: index === 0 ? 'building.sourceKey' : 'document.date', probability: 1,
      committed: true, version: 'v1' })).join('\n') };
  }));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const result = await proposeMapping(clashProfile, { ...options(), learnerModelPath: model,
    teacher: async () => { assert.fail('The student already supplied both unmatched columns.'); } });
  assert.equal(spawn.mock.callCount(), 1);
  assert.equal(result.studentReasonCode, null);
  assertRuleClash(result, 'student');
});

test('an invalid rule-enriched fallback returns the plain manual plan and no rule provenance', async () => {
  const invalid = { ...clashProfile, layoutFingerprint: 'f'.repeat(64) };
  const result = await proposeMapping(invalid, { ...options(), teacher: async remaining =>
    manualTeacherPlan(remaining, 'TEACHER_UNAVAILABLE') });
  assert.equal(result.plan.method, 'manual:MAPPING_ROUTING_INVALID');
  assert(result.plan.fields.every(field => field.target === 'unknown'));
  assert(result.fieldSources.every(field => field.source === 'unanswered'));
  assert.equal(result.issues.length, invalid.columns.length);
});
