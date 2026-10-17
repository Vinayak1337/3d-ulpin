import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runLoop } from './measure-c1';

test('C1 runs the chunked loop once in route order on a real development table', async () => {
  const result = await runLoop();
  assert.deepEqual(result.checks.filter(item => !item.pass), []);
  const [cold] = result.records;
  assert.equal(cold.counters.replayHits, 1);
  assert.equal(cold.counters.executedRows, 0);
  assert(cold.seq < result.officer.approvedSeq && result.officer.approvedSeq < result.learning.seq);
  assert.equal(result.learning.partialFitCalls, 1);
  assert.equal(result.perFile['file1/approved_recipe'].executedRows, 56);
  assert.equal(result.network, 0);
});
