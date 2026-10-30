import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { AppError } from '../../../infrastructure/errors';
import { DEADLOCK_RETRIES, retryRolledBack } from './deadlock-retry';
import { IntakeService } from './intake-service';

/** S9.6r. A transaction PostgreSQL rolled back is run again; every other outcome answers as before. */
function sqlError(code: string) {
  return Object.assign(new Error(`test_only ${code}`), { code });
}

function scripted(outcomes: unknown[]) {
  const calls = { run: 0, wait: 0 };
  const run = async () => {
    const outcome = outcomes[calls.run++];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  const wait = async () => { calls.wait++; };
  return { calls, run, wait };
}

test('a deadlock victim is run again and its second answer is returned', async () => {
  const script = scripted([sqlError('40P01'), 'kept']);
  assert.equal(await retryRolledBack(script.run, script.wait), 'kept');
  assert.deepEqual(script.calls, { run: 2, wait: 1 });
});

test('a serialization failure is run again too', async () => {
  const script = scripted([sqlError('40001'), sqlError('40P01'), 'kept']);
  assert.equal(await retryRolledBack(script.run, script.wait), 'kept');
  assert.deepEqual(script.calls, { run: 3, wait: 2 });
});

test('three deadlocks in a row throw the third one unchanged', async () => {
  const third = sqlError('40P01');
  const script = scripted([sqlError('40P01'), sqlError('40P01'), third, 'never']);
  await assert.rejects(retryRolledBack(script.run, script.wait), error => error === third);
  assert.deepEqual(script.calls, { run: DEADLOCK_RETRIES + 1, wait: DEADLOCK_RETRIES });
});

test('any other error is thrown at once and never run again', async () => {
  for (const error of [sqlError('23505'), sqlError('55P03'), new AppError(409, 'CONFLICT', 'test_only'),
    new Error('test_only')]) {
    const script = scripted([error, 'never']);
    await assert.rejects(retryRolledBack(script.run, script.wait), thrown => thrown === error);
    assert.deepEqual(script.calls, { run: 1, wait: 0 });
  }
});

test('POST intake/items runs its rolled-back registration transaction again', async () => {
  let runs = 0;
  const refused = new AppError(404, 'NOT_FOUND', 'test_only second run');
  const intake = new IntakeService({ transaction: async () => {
    runs++;
    throw runs === 1 ? sqlError('40P01') : refused;
  } });
  await assert.rejects(intake.register(randomUUID(), { requestKey: randomUUID(), sourceId: randomUUID() }),
    error => error === refused);
  assert.equal(runs, 2);
});
