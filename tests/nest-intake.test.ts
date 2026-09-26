import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { createAreaScenario } from '../packages/server/src/modules/areas/area-scenario';
import { areaRoutes } from '../packages/server/src/modules/areas/area-routes';
import { bindExternalIdentifier } from '../packages/server/src/modules/areas/area-resolver';

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
