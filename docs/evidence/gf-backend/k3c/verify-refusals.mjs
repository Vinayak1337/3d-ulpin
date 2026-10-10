import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k3c';
const magnoliaId = 'e8777ffc-9409-4129-bacf-f680160d8795';
const roof = JSON.parse(readFileSync(`${root}/roof-receipt.json`, 'utf8')).result;
const roofRequest = JSON.parse(readFileSync(`${root}/roof-request.json`, 'utf8'));

async function get(path) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function refused(path, input, status, code) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', 'Idempotency-Key': input.requestKey,
  }, body: JSON.stringify(input) });
  const result = await response.json();
  assert.equal(response.status, status);
  if (code) assert.equal(result.error.code, code);
  return { status: response.status, code: result.error.code };
}

const before = await get(`/buildings/${magnoliaId}/canonical`);
const attached = before.candidates.find(candidate => candidate.review?.outcome === 'accepted');
assert(attached && attached.levelId);
const attachThenReject = await refused(`/buildings/${magnoliaId}/candidates`, { action: 'reject',
  requestKey: randomUUID(), expectedCanonicalRevision: before.revisionId, candidateId: attached.candidateId,
  reason: 'K3c contract check must refuse rejection after the prior explicit reviewed attachment',
}, 409, 'CANDIDATE_DECIDED');
const emptyDecisions = await refused(`/spatial-ml/items/${roof.receipt.itemId}/footprint-drafts`,
  { ...roofRequest, requestKey: randomUUID(), rejected: [] }, 422);
assert.deepEqual(await get(`/buildings/${magnoliaId}/canonical`), before);
writeFileSync(`${root}/refusals.json`, JSON.stringify({ attachThenReject, emptyDecisions,
  buildingCanonicalUnchanged: true, newDecisionsWritten: 0,
}) + '\n', { flag: 'wx' });
console.log('Attached-room rejection is 409 CANDIDATE_DECIDED; an empty roof decision is 422.');
