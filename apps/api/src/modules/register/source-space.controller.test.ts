import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { SourceSpaceRequestSchema, SourceSpaceReceiptSchema } from '@ulpin/contracts';

// Published contract control only; no listener, configuration file or runtime access.
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
