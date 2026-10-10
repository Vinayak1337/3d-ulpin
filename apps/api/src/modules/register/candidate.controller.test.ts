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

test('room reject uses the existing digest-pinned command with the same reason validators as association', () => {
  const key = 'f49b730d-311e-4d9f-91a7-cd93e1695506';
  const input = { action: 'reject', requestKey: key, expectedCanonicalRevision: 'a'.repeat(64),
    candidateId: 'retained-room-contract-fixture', reason: '  K3c contract check  ' };
  const parsed = BuildingPlanCandidateRequestSchema.parse(input);
  assert.equal(parsed.action, 'reject');
  if (parsed.action !== 'reject') throw new Error('Unexpected command action.');
  assert.equal(parsed.reason, 'K3c contract check');
  assert(!BuildingPlanCandidateRequestSchema.safeParse({ ...input, reason: 'ab' }).success);
  assert(!BuildingPlanCandidateRequestSchema.safeParse({ ...input, levelId: key }).success);
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
