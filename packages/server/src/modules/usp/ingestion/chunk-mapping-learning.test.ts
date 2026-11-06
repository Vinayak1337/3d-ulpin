import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { sha256 } from '../../../infrastructure/storage';
import { trainOfficerBatch } from './chunk-mapping-learning';
import { fakeStudentChild, type StudentReply } from './mapping-student.fixture';

const cap = 1024 * 1024;
const parentSha = sha256(Buffer.from('parent'));

/** A fresh approval folder with an examples file and a resume model; the learner writes into its learner/ folder. */
function approval() {
  const directory = mkdtempSync(join(tmpdir(), 's9-8f-learner-'));
  const examples = join(directory, 'examples.jsonl');
  writeFileSync(examples, '{"example":1}\n');
  const resume = join(directory, 'resume');
  mkdirSync(resume);
  writeFileSync(join(resume, 'manifest.json'), JSON.stringify({ modelSha256: parentSha }));
  return { directory, examples, resume, out: join(directory, 'learner') };
}

/** What the real learner leaves behind: a pinned model folder with its manifest. Not model weights. */
function writeModel(examples: string, out: string, version = 'v1') {
  const model = join(out, version), bytes = Buffer.from('checkpoint stand-in');
  mkdirSync(model, { recursive: true });
  writeFileSync(join(model, 'model.npz'), bytes);
  writeFileSync(join(model, 'manifest.json'), JSON.stringify({ version,
    approvedBatchSha256: sha256(readFileSync(examples)), modelSha256: sha256(bytes), parentModelSha256: parentSha }));
  return { model, version };
}

function mockLearner(t: TestContext, reply: (args: string[]) => StudentReply) {
  const children: ReturnType<typeof fakeStudentChild>[] = [];
  const spawn = t.mock.method(childProcess, 'spawn', (_command: string, args: string[]) => {
    children.push(fakeStudentChild(() => reply(args)));
    return children.at(-1);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { spawn, children };
}

const succeeds = (args: string[]): StudentReply => ({
  code: 0, stdout: JSON.stringify(writeModel(args[args.indexOf('--examples') + 1], args[args.indexOf('--out') + 1])) });

const unavailable = (error: unknown) => (error as { status: number; code: string }).status === 503 &&
  (error as { code: string }).code === 'TABULAR_LEARNER_UNAVAILABLE';

test('a finished batch returns its pinned model with the same command, environment and receipt as before', async t => {
  const a = approval();
  const { spawn, children } = mockLearner(t, succeeds);
  const result = await trainOfficerBatch(a.examples, a.resume);
  assert.deepEqual(result, { model: join(a.out, 'v1'), version: 'v1' });
  const [command, args, run] = spawn.mock.calls[0].arguments as unknown as
    [string, string[], { env: NodeJS.ProcessEnv }];
  assert.equal(command, process.env.ULPIN_PROFILE_PYTHON ?? 'python');
  assert.deepEqual(args, ['-m', 'geo.usp_learning.stage_a', 'online', '--examples', a.examples, '--out', a.out,
    '--resume', a.resume]);
  assert.equal(run.env.PYTHONPATH, resolve('services/geo'));
  assert.equal(run.env.PYTHONDONTWRITEBYTECODE, '1');
  assert.deepEqual(JSON.parse(readFileSync(join(a.out, 'completed.json'), 'utf8')), result);
  assert.equal(children[0].kills, 0);
});

const failures: [string, StudentReply, number][] = [
  ['a non-zero exit', { code: 1, stdout: '{}' }, 0],
  ['a spawn error', { error: true }, 0],
  ['stdout over 1 MiB', { code: 0, stdout: ' '.repeat(cap + 1) }, 1],
  ['stderr over 1 MiB', { code: 0, stdout: '{}', stderr: 'e'.repeat(cap + 1) }, 1],
];

for (const [name, reply, kills] of failures) {
  test(`${name} stays TABULAR_LEARNER_UNAVAILABLE and records nothing`, async t => {
    const a = approval();
    const { spawn, children } = mockLearner(t, () => reply);
    await assert.rejects(() => trainOfficerBatch(a.examples, a.resume), unavailable);
    assert.equal(spawn.mock.callCount(), 1);
    assert.equal(children[0].kills, kills);
    assert.throws(() => readFileSync(join(a.out, 'completed.json')), { code: 'ENOENT' });
  });
}

test('a learner that never answers is killed after 60 s and stays TABULAR_LEARNER_UNAVAILABLE', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = approval();
  let spawned!: () => void;
  const started = new Promise<void>(done => { spawned = done; });
  const { children } = mockLearner(t, () => {
    spawned();
    return {};
  });
  const pending = trainOfficerBatch(a.examples, a.resume);
  const outcome = assert.rejects(() => pending, unavailable);
  await started;
  t.mock.timers.tick(59999);
  assert.equal(children[0].kills, 0);
  t.mock.timers.tick(1);
  await outcome;
  assert.equal(children[0].kills, 1);
});

test('an unpinned version is TABULAR_LEARNER_OUTPUT and writes no receipt', async t => {
  const a = approval();
  mockLearner(t, () => ({ code: 0, stdout: JSON.stringify({ model: join(a.out, 'v1'), version: 'latest' }) }));
  await assert.rejects(() => trainOfficerBatch(a.examples, a.resume),
    (error: any) => error.status === 503 && error.code === 'TABULAR_LEARNER_OUTPUT');
  assert.throws(() => readFileSync(join(a.out, 'completed.json')), { code: 'ENOENT' });
});

test('a completed checkpoint is returned without starting the learner again', async t => {
  const a = approval();
  const { spawn } = mockLearner(t, succeeds);
  const first = await trainOfficerBatch(a.examples, a.resume);
  assert.deepEqual(await trainOfficerBatch(a.examples, a.resume), first);
  assert.equal(spawn.mock.callCount(), 1);
});

test('an incomplete checkpoint is refused for owner recovery without starting the learner', async t => {
  const a = approval();
  mkdirSync(a.out);
  const { spawn } = mockLearner(t, succeeds);
  await assert.rejects(() => trainOfficerBatch(a.examples, a.resume),
    (error: any) => error.status === 503 && error.code === 'TABULAR_LEARNER_CHECKPOINT');
  assert.equal(spawn.mock.callCount(), 0);
});

test('the event loop keeps turning while a slow learner runs', async t => {
  const a = approval();
  const order: string[] = [];
  mockLearner(t, args => ({ ...succeeds(args), delayMs: 50 }));
  setTimeout(() => order.push('timer'), 5);
  await trainOfficerBatch(a.examples, a.resume);
  order.push('learner');
  assert.deepEqual(order, ['timer', 'learner']);
});
