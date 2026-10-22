import assert from 'node:assert/strict';
import test from 'node:test';
import { intakeRunSteps, runNextIntakeRunJob } from './intake-run-worker';

// Protocol job names only: the injected scheduler never reaches the database or a domain command.
test('ready successors start directly, one at a time, and yield after three jobs under one reservation', async () => {
  const ready = ['commit', 'priority-target', 'older-target', 'later-target'];
  const sent: string[] = [];
  let active = false;
  await runNextIntakeRunJob(intakeRunSteps, {
    next: async () => {
      assert.equal(active, false, 'select only after the preceding attempt settles');
      return ready.shift() ?? null;
    },
    run: async (jobId, steps) => {
      assert.equal(steps, intakeRunSteps);
      assert.equal(active, false, 'do not increase dispatcher concurrency');
      active = true;
      sent.push(jobId);
      await Promise.resolve();
      active = false;
    },
  });
  assert.deepEqual(sent, ['commit', 'priority-target', 'older-target']);
  assert.deepEqual(ready, ['later-target'], 'bounded chaining yields for fresh dispatcher admission');
});

test('an empty due-job selection ends the chain without claiming anything', async () => {
  let selections = 0;
  await runNextIntakeRunJob(intakeRunSteps, {
    next: async () => {
      selections++;
      return null;
    },
    run: async () => assert.fail('no ready job was selected'),
  });
  assert.equal(selections, 1);
});

test('a failed attempt ends the chain rather than bypassing its retry delay or claiming its successor', async () => {
  const failure = new Error('Infrastructure unavailable');
  let selections = 0;
  await assert.rejects(runNextIntakeRunJob(intakeRunSteps, {
    next: async () => {
      selections++;
      return 'commit';
    },
    run: async () => { throw failure; },
  }), failure);
  assert.equal(selections, 1);
});
