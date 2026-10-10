import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { UspIdentityReviewListSchema } from '@ulpin/contracts/usp';
import { setRuntimeLoopbackPort } from '@ulpin/server/infrastructure/loopback-host';
import { ApiExceptionFilter } from '../../common/api-exception.filter';
import { guardLocalRequest } from '../../common/request-context';
import { BuildingSnapshotsController } from '../register/building-snapshots.controller';
import { requestSchema } from '../register/documentation';
import { PrivateSpatialGuard } from '../spatial/private-spatial.guard';
import { IdentityReviewsController } from './identity-reviews.controller';

@Module({ controllers: [IdentityReviewsController, BuildingSnapshotsController] })
class ListingReadsModule {}

const globals = globalThis as unknown as { ulpinPool?: unknown };
const known = { recordId: randomUUID(), siteId: randomUUID() };

/** A store that holds one record without reviews, and no building. */
async function query(text: string, values: readonly unknown[] = []) {
  const sql = text.replace(/\s+/g, ' ').trim();
  const held = values[0] === known.recordId;
  if (/^(BEGIN|COMMIT|ROLLBACK|SET )/.test(sql)) return { rows: [], rowCount: 0 };
  if (sql.startsWith('SELECT r.site_id FROM registry_records r JOIN map_areas')) {
    return { rows: held ? [{ site_id: known.siteId }] : [], rowCount: Number(held) };
  }
  if (sql.startsWith('SELECT r.id,r.manifest_id,r.operation,r.command_hash,r.body')) return { rows: [], rowCount: 0 };
  if (sql.startsWith('SELECT a.site_id FROM physical_features')) return { rows: [], rowCount: 0 };
  throw new Error(`Unexpected statement: ${sql}`);
}

/** The review listing and its neighbour, the snapshot listing, behind the loopback guard and the global filter,
 * on an in-process port. */
async function served(work: (base: string) => Promise<void>) {
  const previous = { pool: globals.ulpinPool, subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT };
  const app = await NestFactory.create(ListingReadsModule, { logger: false, bodyParser: false });
  let port = 0;
  app.use((req: any, res: any, next: () => void) => guardLocalRequest(req, res, next, port, []));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  port = app.getHttpServer().address().port;
  setRuntimeLoopbackPort(port);
  globals.ulpinPool = { connect: async () => ({ query, release() {} }), query };
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k11b-offline-protocol-control';
  try {
    await work(`http://127.0.0.1:${port}/api/v1`);
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

test('the review list answers privately, and an unknown record answers the 404 body of the record reads',
  () => served(async base => {
    const path = `${base}/usp/identity/records/${known.recordId}/reviews`;
    const listed = await fetch(path);
    assert.equal(listed.status, 200);
    assert.equal(listed.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(UspIdentityReviewListSchema.parse(await listed.json()),
      { ...known, items: [], truncated: false, unreadable: 0 });

    const refused = await errorOf(await fetch(`${base}/usp/identity/records/${randomUUID()}/reviews`));
    assert.deepEqual(refused, { status: 404, code: 'NOT_FOUND', message: 'This record could not be found.' });
    const neighbour = await errorOf(await fetch(`${base}/buildings/${randomUUID()}/snapshots`));
    assert.deepEqual(Object.keys(refused), Object.keys(neighbour));
    assert.deepEqual([neighbour.status, neighbour.code], [404, 'NOT_FOUND']);

    assert.equal((await fetch(path, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  }));

test('a limit outside 1 to 20, a repeated limit and a malformed record id are refused as the snapshot list refuses',
  () => served(async base => {
    const building = randomUUID();
    for (const search of ['limit=0', 'limit=21', 'limit=1.5', 'limit=', 'limit=1&limit=2']) {
      const refused = await errorOf(await fetch(`${base}/usp/identity/records/${known.recordId}/reviews?${search}`));
      assert.deepEqual([search, refused.status, refused.code], [search, 422, 'INVALID_INPUT']);
      assert.deepEqual(refused, await errorOf(await fetch(`${base}/buildings/${building}/snapshots?${search}`)));
    }
    const malformed = await errorOf(await fetch(`${base}/usp/identity/records/not-a-record/reviews`));
    assert.deepEqual([malformed.status, malformed.code], [422, 'INVALID_INPUT']);
    assert.match(malformed.message, /^recordId: /);
    assert.equal((await fetch(`${base}/usp/identity/records/${known.recordId}/reviews?limit=20`)).status, 200);
  }));

test('the route keeps the private guard and the global error body, and publishes the contract it answers with', () => {
  const guards = Reflect.getMetadata('__guards__', IdentityReviewsController);
  assert(guards.includes(PrivateSpatialGuard));
  assert.equal(Reflect.getMetadata('__exceptionFilters__', IdentityReviewsController), undefined);

  const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const operation = published.paths['/api/v1/usp/identity/records/{recordId}/reviews'].get;
  const ref = operation.responses['200'].content['application/json'].schema.$ref;
  assert.equal(operation.operationId, 'GET_api_v1_usp_identity_records_recordId_reviews');
  assert.deepEqual(published.components.schemas[ref.split('/').at(-1)], requestSchema(UspIdentityReviewListSchema));
});
