import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { AnyRetainSourceSchema } from '../packages/contracts/src/usp/ingestion';

const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
requireApi('reflect-metadata');

function upload(fields: Record<string, string>) {
  const form = new FormData();
  form.set('file', new File(['key,value\n1,2\n'], 'protocol-control.csv', { type: 'text/csv' }));
  form.set('format', 'csv');
  form.set('requestKey', randomUUID());
  form.set('expectedWorkspaceRevision', '0');
  form.set('selection', JSON.stringify({ format: 'csv', sheet: 'csv', table: null, headerRows: [1] }));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

test('multipart table provenance reaches the service unchanged; absent and invalid fields stay distinct', async () => {
  const { NestFactory } = requireApi('@nestjs/core');
  const { Module } = requireApi('@nestjs/common');
  const { SwaggerModule, DocumentBuilder } = requireApi('@nestjs/swagger');
  const { IngestionController } = await import('../apps/api/src/modules/ingestion/ingestion.controller');
  const { ManualIngestionService } = await import('../packages/server/src/modules/usp/ingestion/service');
  const { PrivateSpatialGuard } = await import('../apps/api/src/modules/spatial/private-spatial.guard');
  const { ApiExceptionFilter } = await import('../apps/api/src/common/api-exception.filter');
  const calls: Record<string, unknown>[] = [];
  const service = { retain: async (_caseId: string, raw: Record<string, unknown>) => {
    calls.push(raw);
    AnyRetainSourceSchema.parse(raw);
    return { received: true };
  } };
  class UploadCheckModule {}
  Module({ controllers: [IngestionController], providers: [
    { provide: ManualIngestionService, useValue: service },
    { provide: PrivateSpatialGuard, useValue: { canActivate: () => true } },
  ] })(UploadCheckModule);
  const app = await NestFactory.create(UploadCheckModule, { logger: false, bodyParser: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1');
  try {
    const port = app.getHttpServer().address().port;
    const url = `http://127.0.0.1:${port}/api/v1/ingestion/cases/${randomUUID()}/sources`;
    await verifyUploads(url, calls);
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const operation = document.paths['/api/v1/ingestion/cases/{caseId}/sources'].post;
    const schema = operation.requestBody.content['multipart/form-data'].schema;
    for (const key of ['issuer', 'licence', 'containsPersonalData']) {
      assert.ok(schema.properties[key]);
      assert.ok(!schema.required.includes(key));
    }
    assert.ok(!schema.properties.origin);
  } finally {
    await app.close();
  }
});

async function verifyUploads(url: string, calls: Record<string, unknown>[]) {
  const fields = { issuer: 'Protocol control issuer', licence: 'open', containsPersonalData: 'no' };
  assert.equal((await fetch(url, { method: 'POST', body: upload(fields) })).status, 201);
  for (const [key, value] of Object.entries(fields)) assert.equal(calls[0][key], value);
  assert.equal((await fetch(url, { method: 'POST', body: upload({}) })).status, 201);
  for (const key of Object.keys(fields)) assert.ok(!Object.hasOwn(calls[1], key));
  const invalid = await fetch(url, { method: 'POST', body: upload({ licence: 'public' }) });
  assert.equal(invalid.status, 422);
  const error = (await invalid.json()).error;
  assert.equal(error.code, 'INVALID_INPUT');
  assert.match(error.message, /Invalid input/);
  assert.match(error.requestId, /^[a-f0-9-]{36}$/);
  const origin = await fetch(url, { method: 'POST', body: upload({ origin: 'officer_supplied' }) });
  assert.equal(origin.status, 422);
  assert.equal(calls.length, 3);
}
