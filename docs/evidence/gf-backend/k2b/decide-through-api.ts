import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  BuildingConflictDecisionRequestSchema, BuildingConflictDecisionSchema, NormalizedBuildingSchema,
} from '../../../../packages/contracts/src/canonical/building';

const base = 'http://127.0.0.1:3194/api/v1';
const evidence = 'docs/evidence/gf-backend/k2b';
const buildingId = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const save = (name: string, value: unknown) => {
  writeFileSync(`${evidence}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
};
async function canonical() {
  const response = await fetch(`${base}/buildings/${buildingId}/canonical`);
  assert.equal(response.status, 200);
  return NormalizedBuildingSchema.parse(await response.json());
}
function unresolvedRequest(before: Awaited<ReturnType<typeof canonical>>) {
  const truth = JSON.parse(readFileSync(
    'docs/evidence/usp/finale/GF-DATA/storey-truth/demo/haryana-2831-tower3.json', 'utf8',
  ));
  assert.equal(truth.floorExpression.state, 'conflicting');
  assert.equal(truth.registry.floorExpression.value, null);
  const conflict = before.conflicts.find(entry => entry.property === 'building.storeyLabel')!;
  return BuildingConflictDecisionRequestSchema.parse({
    requestKey: randomUUID(), expectedCanonicalRevision: before.revisionId, property: conflict.property,
    outcome: 'unresolved', citation: conflict.alternatives[0].citations[0],
    reason: 'checked against site-plan page 1; D2 truth preserves G+41/G+42 conflict; '
      + 'unresolved, needs a current Tower-3-keyed approved source',
  });
}

const requestPath = `${evidence}/officer-request.json`;
const before = await canonical();
const request = existsSync(requestPath)
  ? BuildingConflictDecisionRequestSchema.parse(JSON.parse(readFileSync(requestPath, 'utf8')))
  : unresolvedRequest(before);
if (!existsSync(requestPath)) {
  save('tower3-before', before);
  save('officer-request', request);
}
const send = () => fetch(`${base}/buildings/${buildingId}/conflict-decisions`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
});
const response = await send();
const raw = await response.json();
assert.equal(response.status, 201, JSON.stringify(raw));
const decision = BuildingConflictDecisionSchema.parse(raw);
save('officer-decision', decision);
const after = await canonical();
save('tower3-after', after);
assert.equal(after.storeyLabel.state, 'conflicting');
assert.equal(after.storeyCount.value, null);
assert.equal(after.conflictDecisions?.at(-1)?.outcome, 'unresolved');
assert(after.conflicts[0].alternatives.every(alternative => alternative.state === 'candidate'));
const replay = await send();
assert.equal(replay.status, 201);
assert.deepEqual(await replay.json(), decision);
assert.deepEqual(await canonical(), after);
const revisionsResponse = await fetch(`${base}/physical-features/${buildingId}/revisions`);
assert.equal(revisionsResponse.status, 200);
const revisions = await revisionsResponse.json();
assert.equal(revisions.currentRevision, 2);
assert.deepEqual(revisions.revisions.map((entry: { revision: number }) => entry.revision), [2, 1]);
save('revision-history', { featureId: buildingId, currentRevision: revisions.currentRevision,
  revisions: revisions.revisions.map((entry: { revision: number; createdAt: string; body: { properties: object } }) => ({
    revision: entry.revision, createdAt: entry.createdAt,
    hasOfficerDecision: Object.hasOwn(entry.body.properties, 'officerConflictDecision'),
  })), originalsOrAlternativesDeleted: false });
console.log('Tower 3 unresolved officer decision appended; revision 1 retained; exact replay made no new revision.');
