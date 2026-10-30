import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { DispatchReservations } from './dispatch-lanes';
import { startStallLog } from './dispatch-stall';

const job = (id: string, operation: string) => ({ id, operation, created_at: new Date(Date.UTC(2026, 9, 31)) });

/** Mocked intervals and an injected clock, so a turn can fire late by exactly the time the test blocks for. */
function harness(t: TestContext, held: () => readonly string[] = () => []) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let clock = 0;
  const lines: string[] = [];
  const stop = startStallLog(held, { now: () => clock, warn: line => lines.push(line) });
  const turn = (blockedMs = 0) => {
    clock += 100 + blockedMs;
    t.mock.timers.tick(100);
  };
  return { lines, stop, turn };
}

test('turns that fire on time, or late by no more than 250 ms, write nothing', t => {
  const { lines, stop, turn } = harness(t);
  for (let index = 0; index < 20; index++) turn();
  turn(250);
  turn();
  stop();
  assert.deepEqual(lines, []);
});

test('a 600 ms block writes one line with its lateness and the operations held throughout', t => {
  const held = new DispatchReservations();
  for (const [id, operation] of [['a', 'streamed-profile'], ['b', 'raster-window'], ['c', 'raster-window'],
    ['d', 'build']]) assert.ok(held.admit(job(id, operation), Infinity, [], 0));
  const { lines, stop, turn } = harness(t, () => held.heldOperations());
  turn();
  held.release('d');
  assert.ok(held.admit(job('e', 'inspect'), Infinity, [], 0));
  turn(600);
  turn();
  stop();
  assert.deepEqual(lines, ['Dispatcher event loop stalled 600 ms; holding: raster-window x2, streamed-profile x1']);
});

test('nothing held throughout is written as none, and the lateness is rounded to whole ms', t => {
  const { lines, stop, turn } = harness(t);
  turn(300.6);
  stop();
  assert.deepEqual(lines, ['Dispatcher event loop stalled 301 ms; holding: none']);
});

test('at most one line a second; the stalls in between are counted on the next line', t => {
  const { lines, stop, turn } = harness(t);
  turn(400);
  turn(300);
  turn(300);
  turn();
  turn(500);
  stop();
  assert.deepEqual(lines, ['Dispatcher event loop stalled 400 ms; holding: none',
    'Dispatcher event loop stalled 500 ms; holding: none (+2 more)']);
});

test('the stop function clears the interval', t => {
  let reads = 0;
  const { lines, stop, turn } = harness(t, () => {
    reads++;
    return ['build'];
  });
  turn();
  assert.equal(reads, 2);
  stop();
  turn(900);
  turn(900);
  assert.equal(reads, 2);
  assert.deepEqual(lines, []);
});

test('the line never carries a held job id', t => {
  const held = new DispatchReservations();
  const secret = 'job-7f3c2a90-secret';
  assert.ok(held.admit(job(secret, 'raster-window'), Infinity, [], 0));
  assert.deepEqual(held.heldOperations(), ['raster-window']);
  const { lines, stop, turn } = harness(t, () => held.heldOperations());
  turn(700);
  stop();
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes(secret));
  assert.equal(lines[0], 'Dispatcher event loop stalled 700 ms; holding: raster-window x1');
});
