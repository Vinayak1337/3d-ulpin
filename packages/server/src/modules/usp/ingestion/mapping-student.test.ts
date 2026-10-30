import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { profileGisAttributes } from './column-profile';
import { manualTeacherPlan, proposeMapping, type MappingRoutingResult } from './mapping-teacher';
import { fakeStudentChild, type StudentReply } from './mapping-student.fixture';
import { requestContext } from '../../../../../../scripts/agent/control-runtime';

const nyc = JSON.parse(readFileSync('fixtures/real-nyc/original.geojson', 'utf8'));
const profile = profileGisAttributes(nyc.features.map((feature: { properties: Record<string, unknown> }) =>
  feature.properties), ['bin', 'objectid', 'last_edited_date']).profile;
const model = mkdtempSync(join(tmpdir(), 's9-6t-student-'));
writeFileSync(join(model, 'manifest.json'), JSON.stringify({ version: 'v1' }));
const cap = 1024 * 1024;

const options = (learnerModelPath = model) => ({ context: requestContext, authorize: async () => {},
  dataPolicy: { dataClass: 'public' as const, split: 'development' as const },
  memoryPath: join(tmpdir(), `s9-6t-${randomUUID()}.jsonl`), learnerModelPath,
  teacher: async (remaining: typeof profile) => manualTeacherPlan(remaining, 'TEACHER_UNAVAILABLE') });

/** objectid stays uncommitted; last_edited_date is committed as a document date. Routing control, not truth. */
function predictions(input: string, version = 'v1') {
  return (JSON.parse(input) as { profileId: string }[]).map((field, index) => JSON.stringify({
    profileId: field.profileId, target: index === 0 ? 'unknown' : 'document.date', probability: index === 0 ? 0 : 0.9,
    committed: index === 1, version })).join('\n');
}

function mockStudent(t: TestContext, reply: (input: string) => StudentReply) {
  const children: ReturnType<typeof fakeStudentChild>[] = [];
  const spawn = t.mock.method(childProcess, 'spawn', () => {
    children.push(fakeStudentChild(reply));
    return children.at(-1);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { spawn, children };
}

const routed = (result: MappingRoutingResult) => ({ studentReasonCode: result.studentReasonCode,
  method: result.plan.method, fields: result.plan.fields, fieldSources: result.fieldSources,
  issues: result.issues.map(issue => [issue.sourceField, issue.code]) });

test('a committed prediction routes as before, with the same command, environment and stdin', async t => {
  let stdin: { header: string }[] = [];
  const { spawn, children } = mockStudent(t, input => {
    stdin = JSON.parse(input);
    return { code: 0, stdout: predictions(input) };
  });
  const result = await proposeMapping(profile, options());
  const [command, args, run] = spawn.mock.calls[0].arguments as unknown as
    [string, string[], { env: NodeJS.ProcessEnv }];
  assert.equal(command, process.env.ULPIN_PROFILE_PYTHON ?? 'python');
  assert.deepEqual(args, ['-m', 'geo.usp_learning.stage_a', 'predict', '--model', resolve(model), '--profiles', '-']);
  assert.equal(run.env.PYTHONPATH, resolve('services/geo'));
  assert.equal(run.env.PYTHONDONTWRITEBYTECODE, '1');
  assert.deepEqual(stdin.map(field => field.header), ['objectid', 'last_edited_date']);
  assert.equal(children[0].kills, 0);
  assert.equal(result.studentReasonCode, null);
  assert.equal(result.plan.method, 'model:mapping-router@1');
  assert.equal(result.plan.fields.find(field => field.sourceField === 'last_edited_date')?.target, 'document.date');
  assert.deepEqual(result.fieldSources.map(field => [field.sourceField, field.source, field.method]), [
    ['bin', 'rule', result.fieldSources[0].method],
    ['objectid', 'unanswered', 'manual:TEACHER_UNAVAILABLE'],
    ['last_edited_date', 'student', 'model:stage-a@v1'],
  ]);
});

const failures: [string, (input: string) => StudentReply, number][] = [
  ['a non-zero exit', input => ({ code: 1, stdout: predictions(input) }), 0],
  ['invalid output', () => ({ code: 0, stdout: 'not a prediction' }), 0],
  ['a wrong learner version', input => ({ code: 0, stdout: predictions(input, 'v2') }), 0],
  ['a spawn error', () => ({ error: true }), 0],
  ['stdout over 1 MiB', () => ({ code: 0, stdout: ' '.repeat(cap + 1) }), 1],
  ['stderr over 1 MiB', input => ({ code: 0, stdout: predictions(input), stderr: 'e'.repeat(cap + 1) }), 1],
];

for (const [name, reply, kills] of failures) {
  test(`${name} yields the unavailable student, exactly as an absent learner does`, async t => {
    const absent = routed(await proposeMapping(profile, options(join(model, 'missing'))));
    const { spawn, children } = mockStudent(t, reply);
    const result = await proposeMapping(profile, options());
    assert.equal(spawn.mock.callCount(), 1);
    assert.equal(children[0].kills, kills);
    assert.equal(result.studentReasonCode, 'STUDENT_UNAVAILABLE');
    assert.equal(result.activeLearnerVersion, 'v1');
    assert.deepEqual(routed(result), absent);
    assert(result.fieldSources.every(field => field.source !== 'student'));
  });
}

test('a learner that never answers is killed after 30 s and yields the unavailable student', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let spawned!: () => void;
  const started = new Promise<void>(done => { spawned = done; });
  const { children } = mockStudent(t, () => {
    spawned();
    return {};
  });
  const pending = proposeMapping(profile, options());
  await started;
  t.mock.timers.tick(29999);
  assert.equal(children[0].kills, 0);
  t.mock.timers.tick(1);
  const result = await pending;
  assert.equal(children[0].kills, 1);
  assert.equal(result.studentReasonCode, 'STUDENT_UNAVAILABLE');
  assert(result.fieldSources.every(field => field.source !== 'student'));
});

test('the event loop keeps turning while a slow learner runs', async t => {
  const order: string[] = [];
  mockStudent(t, input => ({ code: 0, stdout: predictions(input), delayMs: 50 }));
  setTimeout(() => order.push('timer'), 5);
  const result = await proposeMapping(profile, options());
  order.push('student');
  assert.deepEqual(order, ['timer', 'student']);
  assert.equal(result.studentReasonCode, null);
});
