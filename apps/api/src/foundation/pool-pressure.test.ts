import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { S3Client } from '@aws-sdk/client-s3';
import { poolPressure } from '@ulpin/server/infrastructure/db';
import { closeStorageClient } from '@ulpin/server/infrastructure/storage';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';
import { FoundationController } from './foundation.controller';

const globals = globalThis as unknown as { ulpinPool?: unknown };

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
