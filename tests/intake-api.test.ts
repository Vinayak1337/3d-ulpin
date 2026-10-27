import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { IntakeTablePlacementSchema } from '../packages/contracts/src/usp/intake';

// Metadata generation only; Nest application is never initialized or made to listen.
test('four intake routes publish strict request and response schemas', async () => {
  const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
  requireApi('reflect-metadata');
  const { NestFactory } = requireApi('@nestjs/core');
  const { AppModule } = await import('../apps/api/src/app.module');
  const { createApiDocument } = await import('../apps/api/src/openapi');
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
  try {
    const document = createApiDocument(app);
    const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
    const base = '/api/v1/ingestion/cases/{caseId}/intake';
    for (const [method, path, status] of [['post', `${base}/items`, '201'], ['get', base, '200'],
      ['get', `${base}/items/{itemId}`, '200'], ['post', `${base}/items/{itemId}/pin`, '200']]) {
      const operation: any = document.paths[path]?.[method as 'get' | 'post'];
      assert.ok(operation);
      assert.equal(operation['x-runtime-verified'], false);
      assert.deepEqual(operation.responses[status], published.paths[path][method].responses[status]);
      assert.equal(operation.parameters.find((value: any) => value.name === 'caseId').schema.format, 'uuid');
      if (method === 'post') {
        const request = operation.requestBody.content['application/json'].schema;
        const schema = document.components?.schemas?.[request.$ref.split('/').pop()] as any;
        assert.equal(schema.additionalProperties, false);
        assert.ok(schema.required.includes('requestKey'));
      }
    }
    const placement: any = document.paths[`${base}/items/{itemId}/table-placement`]?.post;
    const ref = placement.requestBody.content['application/json'].schema.$ref.split('/').pop();
    const schema = document.components?.schemas?.[ref] as any;
    assert.deepEqual(schema.properties.decimalMark.enum, ['point', 'comma']);
    assert.equal(schema.properties.decimalMark.default, 'point');
    assert.equal(schema.additionalProperties, false);
    const request = { requestKey: '40000000-0000-4000-8000-000000000001',
      coordinates: { kind: 'columns', x: 0, y: 1 }, crs: 'EPSG:4326' };
    assert.equal(IntakeTablePlacementSchema.parse(request).decimalMark, 'point');
    assert.equal(IntakeTablePlacementSchema.parse({ ...request, decimalMark: 'comma' }).decimalMark, 'comma');
    assert.equal(IntakeTablePlacementSchema.safeParse({ ...request, decimalMark: 'auto' }).success, false);
  } finally { await app.close(); }
});
