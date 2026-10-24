import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { IntakeReadingSchema } from '../packages/contracts/src/usp/intake';
import { IntakeService } from '../packages/server/src/modules/usp/ingestion/intake-service';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { createAreaScenario } from '../packages/server/src/modules/areas/area-scenario';
import { areaRoutes } from '../packages/server/src/modules/areas/area-routes';
import { bindExternalIdentifier } from '../packages/server/src/modules/areas/area-resolver';

test('the reading route publishes its contract and uses the item and retained-parent authority without byte reads',
  async () => {
    const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
    requireApi('reflect-metadata');
    const { z } = requireApi('zod');
    const { Module } = requireApi('@nestjs/common');
    const { NestFactory } = requireApi('@nestjs/core');
    const { SwaggerModule, DocumentBuilder } = requireApi('@nestjs/swagger');
    const { IngestionController } = await import('../apps/api/src/modules/ingestion/ingestion.controller');
    const { ManualIngestionService } = await import('../packages/server/src/modules/usp/ingestion/service');
    class ReadingTestModule {}
    Module({ controllers: [IngestionController],
      providers: [{ provide: ManualIngestionService, useValue: {} }] })(ReadingTestModule);
    const app = await NestFactory.create(ReadingTestModule, { logger: false, abortOnError: false });
    const id = '10000000-0000-4000-8000-000000000001'; // Protocol identity, not a dataset record.
    const subject = 'intake-reading-protocol-operator';
    const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = subject;
    let actor = subject, archived = false, child = false, missing = false;
    const statements: string[] = [];
    const client = { query: async (sql: string, values: string[]) => {
      statements.push(sql);
      if (sql.includes('FROM cases')) return { rows: [{ id, archived }] };
      if (sql.startsWith('SELECT i.*')) return { rows: values[0] === id && values[1] === id
        ? [{ source_id: child ? null : id, parent_item_id: id, card: null }] : [] };
      if (sql.startsWith('SELECT source_id')) return { rows: [{ source_id: id }] };
      if (sql.includes('FROM sources')) return { rows: missing ? [] : [{ id, case_id: id,
        profile: 'geojson-manual-v1', bytes: '4', sha256: 'a'.repeat(64), object_key: 'protocol-control',
        inspection: { actor } }] };
      throw new Error(`Unexpected reading SQL: ${sql}`);
    } } as unknown as PoolClient;
    const service = new IntakeService({ transaction: async action => action(client),
      read: async () => { throw new Error('A reading must not open original bytes.'); } });
    try {
      const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Reading card').build());
      const path = '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}/reading';
      const operation = doc.paths[path].get;
      assert.deepEqual(operation.responses[200].content['application/json'].schema,
        z.toJSONSchema(IntakeReadingSchema, { target: 'openapi-3.0' }));
      const controller = app.get(IngestionController);
      Object.assign(controller, { intake: service });
      const reading = await controller.intakeReading(id, id);
      assert.deepEqual(IntakeReadingSchema.parse(reading), reading);
      assert.equal(statements.length, 4);
      child = true;
      statements.length = 0;
      await controller.intakeReading(id, id);
      assert.equal(statements.length, 5, 'an unextracted child uses its retained parent');
      const denied = (status: number) => (error: unknown) => error instanceof AppError && error.status === status;
      for (const read of [service.one.bind(service), controller.intakeReading.bind(controller)]) {
        actor = 'different-access-context';
        await assert.rejects(read(id, id), denied(403));
        actor = subject;
        archived = true;
        await assert.rejects(read(id, id), denied(403));
        archived = false;
        missing = true;
        await assert.rejects(read(id, id), denied(404));
        missing = false;
        await assert.rejects(read(id, '10000000-0000-4000-8000-000000000002'), denied(404));
      }
      statements.length = 0;
      await assert.rejects(controller.intakeReading('invalid', id), z.ZodError);
      assert.equal(statements.length, 0);
    } finally {
      if (previous === undefined) delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
      else process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous;
      await app.close();
    }
  });

// A migration-specific check: retirement must happen before parsing or any writer,
// and the new native transport must retain the real original download unchanged.
test('retired canonical and compatibility crossings return 410 before touching inputs', async () => {
  const retired = (error: unknown) =>
    error instanceof AppError && error.status === 410 && error.code === 'RETIRED_OPERATION';
  await assert.rejects(createAreaScenario('', Number.NaN, 'road'), retired);
  await assert.rejects(areaRoutes(
    new Request('http://127.0.0.1/api/v1/areas/retired/scenario', {method: 'POST', body: '{'}),
    ['areas', 'retired', 'scenario'],
  ), retired);
  await assert.rejects(bindExternalIdentifier({
    scheme: 'demo_ulpin', value: '', issuer: '', sourceId: '', locator: '', expectedRevision: 0,
  }), retired);
});

test('native intake rejects malformed input and downloads unchanged official NYC bytes', async () => {
  const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
  requireApi('reflect-metadata');
  const {NestFactory} = requireApi('@nestjs/core');
  const {SwaggerModule, DocumentBuilder} = requireApi('@nestjs/swagger');
  const {IntakeModule} = await import('../apps/api/src/modules/intake/intake.module');
  const {ApiExceptionFilter} = await import('../apps/api/src/common/api-exception.filter');
  const {guardLocalRequest} = await import('../apps/api/src/common/request-context');
  const {setRuntimeLoopbackPort} = await import('../packages/server/src/infrastructure/loopback-host');
  const app = await NestFactory.create(IntakeModule, {bodyParser: false, logger: false});
  let port = 0;
  app.use((request: Parameters<typeof guardLocalRequest>[0], response: Parameters<typeof guardLocalRequest>[1], next: () => void) =>
    guardLocalRequest(request, response, next, port, []));
  app.useGlobalFilters(new ApiExceptionFilter());
  // Port zero allocates a currently free owned loopback listener atomically.
  await app.listen(0, '127.0.0.1');
  port = app.getHttpServer().address().port;
  setRuntimeLoopbackPort(port);
  try {
    const base = `http://127.0.0.1:${port}/api/v1`;
    const invalid = await fetch(`${base}/cases`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{'});
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
    const retired = await fetch(`${base}/areas/retired/scenario`, {method: 'POST', body: '{'});
    assert.equal(retired.status, 410);
    assert.equal((await retired.json()).error.code, 'RETIRED_OPERATION');
    const original = await fetch(`${base}/demo-assets/real-nyc/original.geojson`);
    assert.equal(original.status, 200);
    assert.equal(original.headers.get('cache-control'), 'private, max-age=60');
    assert.equal(original.headers.get('content-disposition'), 'attachment; filename="original.geojson"');
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), await readFile(new URL('../fixtures/real-nyc/original.geojson', import.meta.url)));
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Intake validation').setVersion('1').build());
    assert.equal(document.paths['/api/v1/cases'].post.operationId, 'POST_api_v1_cases');
    assert.ok(document.paths['/api/v1/cases'].post.responses['201'].content['application/json'].schema.properties.frame);
  } finally {
    await app.close();
    setRuntimeLoopbackPort(undefined);
  }
});
