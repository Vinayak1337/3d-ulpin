import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { SpatialModule } from '../apps/api/src/modules/spatial/spatial.module';
import { AiModule } from '../apps/api/src/modules/ai/ai.module';
import { DatasetSearchController, DatasetsController } from '../apps/api/src/modules/spatial/datasets.controller';
import { SpatialMlController } from '../apps/api/src/modules/spatial/spatial-ml.controller';
import { SpatialAreaController, SpatialCoreController, SpatialCalibrationController } from '../apps/api/src/modules/spatial/spatial-core.controller';
import { AiStatusController, OfficerAiController } from '../apps/api/src/modules/ai/ai.controller';
import { ApiExceptionFilter } from '../apps/api/src/common/api-exception.filter';
import { guardLocalRequest } from '../apps/api/src/common/request-context';
import { setRuntimeLoopbackPort } from '../packages/server/src/infrastructure/loopback-host';
import { saveSpatialDataset } from '../packages/server/src/modules/spatial/spatial-datasets';
import { AppError } from '../packages/server/src/infrastructure/errors';
import { GET as legacyCalibrationRead } from '../apps/web/app/api/v1/spatial/calibration/[kind]/[...asset]/route';

// Resolve the API's public dependencies from its package, without changing any
// package manifest or requiring a root dependency on Nest.
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { NestFactory } = requireApi('@nestjs/core');
const { Module } = requireApi('@nestjs/common');
const { SwaggerModule, DocumentBuilder } = requireApi('@nestjs/swagger');
class ValidationApp {}
Module({ imports: [SpatialModule, AiModule] })(ValidationApp);

// Concrete migration risk: wildcard scene URLs and disabled body parsing must
// reach the intended native method and reject invalid input before service IO.
// This check creates no operational records and never calls storage, DB or a provider.
test('native spatial/AI routes publish all 28 operations and enforce non-stateful transport boundaries', async () => {
  const app = await NestFactory.create(ValidationApp, { bodyParser: false, logger: false });
  let port = 0;
  app.use((request: any, response: any, next: () => void) =>
    guardLocalRequest(request, response, next, port, []));
  app.useGlobalFilters(new ApiExceptionFilter());
  try {
    await assert.rejects(saveSpatialDataset('', new Uint8Array()), (error: unknown) =>
      error instanceof AppError && error.status === 410 && error.code === 'RETIRED_SYNTHETIC_INTAKE');
    await app.listen(0, '127.0.0.1');
    for (const controller of [DatasetSearchController, DatasetsController, SpatialMlController, SpatialAreaController,
      SpatialCoreController, SpatialCalibrationController, AiStatusController, OfficerAiController])
      assert.ok(app.get(controller) instanceof controller, controller.name);
    port = app.getHttpServer().address().port;
    setRuntimeLoopbackPort(port);
    const base = `http://127.0.0.1:${port}`;
    const request = async (path: string, status: number, init?: RequestInit) => {
      const response = await fetch(base + path, init);
      assert.equal(response.status, status, path);
      assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      return response.json();
    };
    const intake = await request('/api/v1/spatial-datasets', 410, { method: 'POST' });
    assert.equal(intake.error.code, 'RETIRED_SYNTHETIC_INTAKE');
    assert.match(intake.error.replacement, /import-packages/);
    const calibration = await request('/api/v1/spatial/calibration/garden/manifest.json', 410);
    assert.equal(calibration.error.code, 'RETIRED_SYNTHETIC_CALIBRATION');
    const legacyCalibration = await legacyCalibrationRead(new Request(base + '/api/v1/spatial/calibration/garden/manifest.json'),
      { params: Promise.resolve({ kind: 'garden', asset: ['manifest.json'] }) });
    assert.equal(legacyCalibration.status, 410);
    assert.equal(legacyCalibration.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await legacyCalibration.json(), calibration);
    const crossSite = await request('/api/v1/spatial-ml/status', 403, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(crossSite.error.code, 'CROSS_ORIGIN_READ');
    await request('/api/v1/spatial/calibration/unknown/manifest.json', 404);
    await request('/api/v1/spatial/core/areas/not-an-id/scene/observed/descriptor.json', 400);
    await request('/api/v1/spatial/core/areas/not-an-id?world=observed', 400);
    await request('/api/v1/spatial/areas/not-an-id?world=observed', 400);
    await request('/api/v1/spatial/core/areas/not-an-id/external/not-a-feature', 400);
    await request('/api/v1/spatial-datasets/not-an-id?original=1', 404);
    const malformed = await request('/api/v1/spatial-ml/batches', 422, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });
    assert.equal(malformed.error.code, 'INVALID_INPUT');
    assert.ok(malformed.error.requestId);
    await request('/api/v1/import-packages/not-an-id/ai-extractions', 422, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    });

    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('NEST-13 transport validation').setVersion('1').build());
    const operations = Object.values(doc.paths).flatMap((entry: any) =>
      Object.values(entry).filter((operation: any) => operation?.operationId)) as any[];
    const ledger = JSON.parse(await readFile(new URL('../docs/orchestration/nestjs-operation-ledger.json', import.meta.url), 'utf8'));
    const expected = ledger.operations.filter((operation: any) => operation.batch === 'NEST-13').map((operation: any) => operation.operationId).sort();
    assert.deepEqual(operations.map(operation => operation.operationId).sort(), expected);
    for (const operation of operations) assert.ok(Object.keys(operation.responses).length, operation.operationId);
    const documented = Object.entries(doc.paths).flatMap(([path, entry]: [string, any]) =>
      Object.entries(entry).filter(([,operation]: [string, any]) => operation?.operationId)
        .map(([method, operation]: [string, any]) => ({ path, method: method.toUpperCase(), operationId: operation.operationId })));
    for (const baseline of ledger.operations.filter((operation: any) => operation.batch === 'NEST-13')) {
      const current = documented.find((operation: any) => operation.operationId === baseline.operationId);
      assert.equal(current?.method, baseline.method, baseline.operationId);
      assert.equal(current?.path, baseline.path, baseline.operationId);
    }
  } finally {
    setRuntimeLoopbackPort(undefined);
    await app.close();
  }
});
