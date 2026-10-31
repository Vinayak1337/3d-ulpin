import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Request } from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { poolPressure } from '@ulpin/server/infrastructure/db';
import { settings } from '@ulpin/server/infrastructure/config';
import { checkStorage, closeStorageClient } from '@ulpin/server/infrastructure/storage';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';
import { FoundationController } from './foundation.controller';

const globals = globalThis as unknown as { ulpinPool?: unknown };

function stalledStorage(t: TestContext) {
  t.mock.getter(settings, 's3Endpoint', () => 'http://127.0.0.1:1');
  t.mock.getter(settings, 's3AccessKey', () => 'test_only');
  t.mock.getter(settings, 's3SecretKey', () => 'test_only');
  t.mock.getter(settings, 'geoUrl', () => 'http://127.0.0.1:1');
  t.mock.getter(settings, 'geoToken', () => 'test_only');
  const timeouts: number[] = [];
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    timeouts.push(ms);
    return timeout(10);
  });
  t.mock.method(S3Client.prototype, 'send', async (command: object, options: { abortSignal: AbortSignal }) => {
    assert.equal(command.constructor.name, 'HeadBucketCommand');
    assert(options.abortSignal instanceof AbortSignal);
    return new Promise((_resolve, reject) => {
      options.abortSignal.addEventListener('abort', () => reject(options.abortSignal.reason), { once: true });
    });
  });
  return timeouts;
}

test('storage probe aborts its pending HeadBucket at a three-second deadline', async t => {
  t.after(closeStorageClient);
  const timeouts = stalledStorage(t);
  const keepAlive = setTimeout(() => assert.fail('storage did not abort'), 1000);
  try {
    await assert.rejects(checkStorage(), { name: 'TimeoutError' });
    assert.deepEqual(timeouts, [3000]);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('health reports a timed-out storage probe as failed without changing the response shape', async t => {
  const previous = globals.ulpinPool;
  t.after(() => {
    globals.ulpinPool = previous;
    setRuntimeLoopbackPort(undefined);
    closeStorageClient();
  });
  setRuntimeLoopbackPort(3000);
  globals.ulpinPool = { query: async () => { throw new Error('database unavailable in this test'); } };
  const timeouts = stalledStorage(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true, redis: true, worker: true }));
  const keepAlive = setTimeout(() => assert.fail('health did not finish'), 1000);
  try {
    const request = { headers: { host: '127.0.0.1:3000' }, method: 'GET', url: '/api/v1/health' } as Request;
    const health = await new FoundationController().health(request);
    assert.equal(health.ok, false);
    assert.equal(health.services.storage, false);
    assert.equal(health.services.processor, true);
    assert.deepEqual(timeouts, [3000, 3000]);
    assert.deepEqual(Object.keys(health).sort(),
      ['dataMode', 'databaseReadiness', 'ok', 'pool', 'serviceObservations', 'services']);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('pool pressure never creates a pool and reads current counts, including an empty pool', t => {
  const previous = globals.ulpinPool;
  t.after(() => { globals.ulpinPool = previous; });
  delete globals.ulpinPool;
  assert.equal(poolPressure(), null);
  assert.equal(globals.ulpinPool, undefined);
  const counters = { totalCount: 8, idleCount: 1, waitingCount: 3 };
  globals.ulpinPool = counters;
  assert.deepEqual(poolPressure(), { total: 8, idle: 1, waiting: 3 });
  Object.assign(counters, { totalCount: 0, idleCount: 0, waitingCount: 0 });
  assert.deepEqual(poolPressure(), { total: 0, idle: 0, waiting: 0 });
});

test('health returns pool pressure even when database readiness fails, and documents the nullable shape', async t => {
  const previous = globals.ulpinPool;
  t.after(() => {
    globals.ulpinPool = previous;
    setRuntimeLoopbackPort(undefined);
    closeStorageClient();
  });
  setRuntimeLoopbackPort(3000);
  globals.ulpinPool = { totalCount: 8, idleCount: 0, waitingCount: 2,
    query: async () => { throw new Error('database unavailable in this test'); } };
  t.mock.method(S3Client.prototype, 'send', async () => ({}));
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));
  const request = { headers: { host: '127.0.0.1:3000' }, method: 'GET', url: '/api/v1/health' } as Request;
  const health = await new FoundationController().health(request);
  assert.deepEqual(health.pool, { total: 8, idle: 0, waiting: 2 });
  assert.equal(health.services.database, false);
  const schema = Reflect.getMetadata('swagger/apiResponse', FoundationController.prototype.health)[200].schema;
  assert.ok(schema.required.includes('pool'));
  assert.equal(schema.properties.pool.nullable, true);
  assert.deepEqual(schema.properties.pool.required, ['total', 'idle', 'waiting']);
});
