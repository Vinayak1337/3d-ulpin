import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { UspBuildingSnapshotListSchema } from '@ulpin/contracts/usp';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';
import { ApiExceptionFilter } from '../../common/api-exception.filter';
import { guardLocalRequest } from '../../common/request-context';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { BuildingLedgerController } from './building-ledger.controller';
import { BuildingSnapshotsController } from './building-snapshots.controller';
import { requestSchema } from './documentation';

@Module({ controllers: [BuildingSnapshotsController, BuildingLedgerController] })
class BuildingReadsModule {}

const globals = globalThis as unknown as { ulpinPool?: unknown };
const known = { buildingId: randomUUID(), siteId: randomUUID() };

/** A store that holds one building without snapshots. The ledger's root read is answered for other ids only. */
async function query(text: string, values: readonly unknown[] = []) {
  const sql = text.replace(/\s+/g, ' ').trim();
  const held = values[0] === known.buildingId;
  if (/^(BEGIN|COMMIT|ROLLBACK|SET )/.test(sql)) return { rows: [], rowCount: 0 };
  if (sql.startsWith('SELECT a.site_id FROM physical_features')) {
    return { rows: held ? [{ site_id: known.siteId }] : [], rowCount: Number(held) };
  }
  if (sql.startsWith('SELECT id,digest,body,created_at FROM usp_snapshots')) return { rows: [], rowCount: 0 };
  if (sql.startsWith('SELECT f.id,f.identifier') && !held) return { rows: [], rowCount: 0 };
  throw new Error(`Unexpected statement: ${sql}`);
}

/** The two building controllers behind the loopback guard and the global filter, on an in-process port. */
async function served(work: (base: string) => Promise<void>) {
  const previous = { pool: globals.ulpinPool, subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT };
  const app = await NestFactory.create(BuildingReadsModule, { logger: false, bodyParser: false });
  let port = 0;
  app.use((req: any, res: any, next: () => void) => guardLocalRequest(req, res, next, port, []));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  port = app.getHttpServer().address().port;
  setRuntimeLoopbackPort(port);
  globals.ulpinPool = { connect: async () => ({ query, release() {} }), query };
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k8-offline-protocol-control';
  try {
    await work(`http://127.0.0.1:${port}/api/v1/buildings`);
  } finally {
    await app.close();
    setRuntimeLoopbackPort(undefined);
    globals.ulpinPool = previous.pool;
    if (previous.subject === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous.subject;
  }
}

type ErrorBody = { error: { code: string; message: string; requestId: string; details?: unknown } };

/** The whole error body but its request id, with the status. */
async function errorOf(response: Response) {
  const { error } = await response.json() as ErrorBody;
  const { requestId, ...stated } = error;
  assert.equal(typeof requestId, 'string');
  return { status: response.status, ...stated };
}

test('the snapshot list answers privately, and an unknown building answers the body of the ledger 404',
  () => served(async base => {
    const listed = await fetch(`${base}/${known.buildingId}/snapshots`);
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(UspBuildingSnapshotListSchema.parse(await listed.json()),
      { ...known, items: [], truncated: false, unreadable: 0 });

    const unknown = randomUUID();
    const refused = await errorOf(await fetch(`${base}/${unknown}/snapshots`));
    assert.deepEqual(refused, { status: 404, code: 'NOT_FOUND', message: 'Building not found.' });
    assert.deepEqual(refused, await errorOf(await fetch(`${base}/${unknown}/ledger`)));

    const crossSite = { headers: { 'sec-fetch-site': 'cross-site' } };
    assert.equal((await fetch(`${base}/${known.buildingId}/snapshots`, crossSite)).status, 403);
  }));

test('a limit outside 1 to 20, a repeated limit and a malformed building id are refused as input',
  () => served(async base => {
    const paths = ['limit=0', 'limit=21', 'limit=1.5', 'limit=', 'limit=1&limit=2']
      .map(search => `${known.buildingId}/snapshots?${search}`);
    for (const path of [...paths, 'not-a-building/snapshots']) {
      const refused = await errorOf(await fetch(`${base}/${path}`));
      assert.deepEqual([path, refused.status, refused.code], [path, 422, 'INVALID_INPUT']);
    }
    assert.equal((await fetch(`${base}/${known.buildingId}/snapshots?limit=20`)).status, 200);
  }));

test('the route keeps the private guard and the global error body, and publishes the contract it answers with', () => {
  const guards = Reflect.getMetadata('__guards__', BuildingSnapshotsController);
  assert(guards.includes(PrivateSpatialGuard));
  assert.equal(Reflect.getMetadata('__exceptionFilters__', BuildingSnapshotsController), undefined);

  const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const operation = published.paths['/api/v1/buildings/{buildingId}/snapshots'].get;
  const ref = operation.responses['200'].content['application/json'].schema.$ref;
  assert.equal(operation.operationId, 'GET_api_v1_buildings_buildingId_snapshots');
  assert.deepEqual(published.components.schemas[ref.split('/').at(-1)], requestSchema(UspBuildingSnapshotListSchema));
});
