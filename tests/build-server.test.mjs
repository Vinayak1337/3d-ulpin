import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { assertBuildServerStopped } from '../scripts/check-build-server.mjs';

test('build guard blocks a listening server and permits a stopped server', async () => {
  const server = createServer((socket) => socket.end());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await assert.rejects(assertBuildServerStopped(port), /Stop the local web server before building/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  await assert.doesNotReject(assertBuildServerStopped(port));
});
