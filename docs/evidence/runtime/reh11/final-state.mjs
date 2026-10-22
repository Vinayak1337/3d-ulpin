import assert from 'node:assert/strict';
import { save } from './audit.mjs';

// A final, read-only product snapshot before intentional shutdown; no direct database or runtime-log access.
const cases = [
  ['act1', '704a2c5e-669a-42a2-ac4c-99099217685c'],
  ['shortCsv', '3b0d10c9-80b2-4137-a2d6-d9bcb6cece1f'],
  ['judges', 'a8287433-2963-49de-aad1-9da46678a79c'],
];
async function get(path) {
  const response = await fetch(`http://127.0.0.1:21026/api/v1${path}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.data ?? body;
}
const result = { at: new Date().toISOString(), cases: {} };
for (const [label, caseId] of cases) {
  const detail = await get(`/cases/${caseId}`);
  const manifest = await get(`/ingestion/cases/${caseId}/intake`);
  result.cases[label] = { caseId,
    items: manifest.items.map(({ itemId, sourceId, name, state, placement, partsDone, partsPlanned, limitReason }) => ({
      itemId, sourceId, name, state, placement, partsDone, partsPlanned, limitReason,
    })),
    jobs: detail.jobs.map(({ id, operation, status, createdAt, completedAt, error }) => ({
      id, operation, status, createdAt, completedAt, error,
    })),
  };
}
save('final-state.json', result);
console.log('Three rehearsal cases read; final items and job outcomes retained.');
