import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { z } from 'zod';
import { BuildingPlanCandidateReceiptSchema, BuildingPlanCandidateRequestSchema } from '@ulpin/contracts';

function checkPublishedContract(): void {
  const spec = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
  const operation = spec.paths['/api/v1/buildings/{buildingId}/candidates'].post;
  const contracts = [
    [operation.requestBody.content['application/json'].schema, BuildingPlanCandidateRequestSchema],
    [operation.responses['201'].content['application/json'].schema, BuildingPlanCandidateReceiptSchema],
  ] as const;
  for (const [reference, validator] of contracts) {
    const expected = z.toJSONSchema(validator, { target: 'openapi-3.0' });
    delete expected.$schema;
    assert.deepEqual(spec.components.schemas[reference.$ref.split('/').at(-1)], expected);
  }
  assert(operation.parameters.some((parameter: { name: string; required: boolean }) => (
    parameter.name === 'Idempotency-Key' && parameter.required
  )));
}

test('published room candidate command and receipt exactly match executable validators', () => {
  checkPublishedContract();
});

test('real Magnolia retention preserves unknown levels and rejects title-derived automatic attachment', () => {
  const input = JSON.parse(readFileSync('docs/evidence/gf-backend/k2c/rooms-request.json', 'utf8'));
  const parsed = BuildingPlanCandidateRequestSchema.parse(input);
  assert.equal(parsed.action, 'retain_rooms');
  if (parsed.action !== 'retain_rooms') throw new Error('Unexpected fixture action.');
  assert.equal(parsed.candidates.length, 18);
  assert(parsed.candidates.every(candidate => candidate.levelId === null && candidate.state === 'candidate'));
  const changed = structuredClone(input);
  changed.candidates[0].levelId = changed.candidates[0].levelLabelLiteral;
  assert(!BuildingPlanCandidateRequestSchema.safeParse(changed).success);
});
