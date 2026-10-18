import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Response } from 'express';
import { untilClientCloses } from './area-sources.controller';

function response() {
  const emitter = new EventEmitter() as EventEmitter & { writableFinished: boolean };
  emitter.writableFinished = false;
  return emitter;
}

/** Lines the route logs while `work` runs. */
async function logged(work: () => Promise<void>) {
  const lines: string[] = [], warn = console.warn;
  console.warn = (line: string) => { lines.push(line); };
  try { await work(); } finally { console.warn = warn; }
  return lines;
}

test('a client that closes before the response aborts the read, answers nothing and logs one line', async () => {
  const closing = response();
  const lines = await logged(async () => {
    const result = untilClientCloses('display-window', closing as unknown as Response, signal =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
    closing.emit('close');
    assert.equal(await result, undefined);
  });
  assert.deepEqual(lines.map(line => JSON.parse(line)),
    [{ event: 'area-read-abandoned', route: 'display-window', reason: 'client_closed' }]);
  assert.equal(closing.listenerCount('close'), 0);
});

test('a response that was sent is unchanged and a later close aborts nothing', async () => {
  const sent = response();
  let seen: AbortSignal | undefined;
  const lines = await logged(async () => {
    const body = await untilClientCloses('display-summary', sent as unknown as Response, async signal => {
      seen = signal;
      return { featureCount: 3 };
    });
    sent.writableFinished = true;
    sent.emit('close');
    assert.deepEqual(body, { featureCount: 3 });
  });
  assert.equal(seen!.aborted, false);
  assert.deepEqual(lines, []);
});

test('a read that fails for its own reason still fails with that reason', async () => {
  await assert.rejects(untilClientCloses('display-window', response() as unknown as Response,
    async () => { throw new Error('plain failure'); }), /plain failure/);
});
