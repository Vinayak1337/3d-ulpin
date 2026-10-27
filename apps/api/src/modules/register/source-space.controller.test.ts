import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import { z } from 'zod';
import { SourceSpaceRequestSchema, SourceSpaceReceiptSchema } from '@ulpin/contracts';
import { OfficerController } from './officer.controller';
import type { OfficerService } from './officer.service';
import { retainedTower, towerRequest } from '@ulpin/server/modules/officer/source-spaces.test-fixture';

// Published and pure controller refusal controls only; no listener, runtime access or database connection.
test('source-spaces publishes strict executable request/receipt schemas and matching idempotency header', () => {
  const spec = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const operation = spec.paths['/api/v1/buildings/{buildingId}/source-spaces'].post;
  const contracts = [
    [operation.requestBody.content['application/json'].schema, SourceSpaceRequestSchema],
    [operation.responses['201'].content['application/json'].schema, SourceSpaceReceiptSchema],
  ] as const;
  for (const [reference, validator] of contracts) {
    const expected = z.toJSONSchema(validator, { target: 'openapi-3.0' });
    delete expected.$schema;
    assert.deepEqual(spec.components.schemas[reference.$ref.split('/').at(-1)], expected);
  }
  assert(operation.parameters.some((parameter: { name: string; required: boolean }) => (
    parameter.name === 'Idempotency-Key' && parameter.required
  )));
});

function request(url: string, key: string, input: unknown): Request {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), {
    headers: {}, originalUrl: url, header: () => key,
  }) as unknown as Request;
}

test('source-space route refuses query fields, a mismatched header key and extra body fields before service I/O',
  async () => {
    const controller = new OfficerController({} as OfficerService);
    const path = `/api/v1/buildings/${retainedTower.buildingId}/source-spaces`;
    await assert.rejects(controller.sourceSpace(retainedTower.buildingId,
      request(`${path}?force=true`, towerRequest.requestKey, towerRequest)),
    (error: any) => error.code === 'SOURCE_SPACE_QUERY');
    await assert.rejects(controller.sourceSpace(retainedTower.buildingId,
      request(path, 'db1d81f5-5c96-4768-92c0-e8be53f84e4c', towerRequest)),
    (error: any) => error.code === 'SOURCE_SPACE_KEY');
    await assert.rejects(controller.sourceSpace(retainedTower.buildingId,
      request(path, towerRequest.requestKey, { ...towerRequest, use: 'residential' })));
  });
