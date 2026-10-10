import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  NormalizedAreaSchema, NormalizedBuildingSchema, type NormalizedBuilding,
} from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2c';
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function get(path: string): Promise<Response> {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  return response;
}
async function building(id: string): Promise<NormalizedBuilding> {
  const response = await get(`/buildings/${id}/canonical`);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const value = NormalizedBuildingSchema.parse(await response.json());
  assert.equal(response.headers.get('etag'), `"${value.revisionId}"`);
  assert.equal(value.heightM.value, null);
  assert.equal(value.baseM.value, null);
  assert.equal(value.heightM.state, 'unknown');
  assert.equal(value.levels.length, 0);
  assert.equal(value.parcelRefs.length, 0);
  return value;
}
async function transport(value: NormalizedBuilding): Promise<void> {
  const exact = await get(`/buildings/${value.buildingId}/canonical?revision=${value.revisionId}`);
  assert.deepEqual(await exact.json(), value);
  const old = await fetch(`${base}/buildings/${value.buildingId}/canonical?revision=${'0'.repeat(64)}`);
  assert.equal(old.status, 404);
  const denied = await fetch(`${base}/buildings/${value.buildingId}/canonical`, {
    headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(denied.status, 403);
}
async function candidateCommand(buildingId: string, input: unknown, key: string): Promise<Response> {
  return fetch(`${base}/buildings/${buildingId}/candidates`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) });
}
async function verifyRooms(): Promise<NormalizedBuilding> {
  const id = read('rooms-receipt').buildingId;
  const current = await building(id);
  assert.equal(current.footprint.value, null);
  assert.equal(current.frame.placement, 'unknown');
  assert.equal(current.candidates.length, 18);
  assert(current.candidates.every(candidate => candidate.state === 'candidate' && candidate.levelId === null
    && candidate.method === 'deterministic:vector-plan@1' && candidate.coordinateFrame?.startsWith('plan-local:')));
  assert(current.candidates.every(candidate => candidate.citations?.every(citation => citation.locator.kind === 'region'
    && citation.locator.page === 2 && citation.locator.unit === 'pt')));
  const input = read('rooms-request');
  const replay = await candidateCommand(id, input, input.requestKey);
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), read('rooms-receipt'));
  const stale = { ...input, requestKey: randomUUID() };
  assert.equal((await candidateCommand(id, stale, stale.requestKey)).status, 409);
  assert.equal((await candidateCommand(id, input, randomUUID())).status, 422);
  const attach = { action: 'attach_level', requestKey: randomUUID(), expectedCanonicalRevision: current.revisionId,
    candidateId: current.candidates[0].candidateId, levelId: randomUUID(), reason: 'No reviewed level exists; reject' };
  assert.equal((await candidateCommand(id, attach, attach.requestKey)).status, 422);
  assert.deepEqual(await building(id), current);
  await transport(current);
  const history = await (await get(`/physical-features/${id}/revisions`)).json();
  assert.equal(history.currentRevision, 2);
  assert.deepEqual(history.revisions.map((entry: { revision: number }) => entry.revision).sort(), [1, 2]);
  const original = history.revisions.find((entry: { revision: number }) => entry.revision === 1).body;
  const latest = history.revisions.find((entry: { revision: number }) => entry.revision === 2).body;
  assert.deepEqual({ ...latest, revision: 1 }, original);
  return current;
}
async function verifyImagery(): Promise<void> {
  const pkg = read('imagery-import');
  const areaResponse = await get(`/areas/${pkg.areaId}/canonical`);
  const area = NormalizedAreaSchema.parse(await areaResponse.json());
  assert.equal(areaResponse.headers.get('etag'), `"${area.revisionId}"`);
  assert.equal(areaResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(area.imagery?.[0].chips.length, 22);
  assert.equal(area.imagery?.[0].classification, 'test_only');
  assert.equal(area.imagery?.[0].analyticalEligibility, 'not_assessed');
  assert.equal(area.overlays.length, 22);
  assert.equal(area.candidates?.length, 80);
  assert(area.candidates?.every(candidate => candidate.confidenceCalibration === 'uncalibrated'
    && candidate.kind === 'roofprint' && candidate.polygons?.length && candidate.citations?.length));
  assert.equal(area.candidates?.filter(candidate => candidate.review?.outcome === 'accepted').length, 1);
  assert.equal(area.candidates?.filter(candidate => candidate.review?.outcome === 'rejected').length, 1);
  assert.equal(area.candidates?.filter(candidate => candidate.state === 'candidate').length, 78);
  assert.equal(area.frame.origin.hEllipsoidal, null);
  for (const chip of pkg.imagery.chips) {
    const path = `/sources/${chip.sourceId}/file`;
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.equal(hash(new Uint8Array(await response.arrayBuffer())), chip.sourceSha256);
  }
  const context = await (await get(`/areas/${pkg.areaId}/context`)).json();
  assert.equal(context.features.length, 0);
  assert.equal(context.displayFeatures.length, 1);
  const draft = read('roofprint-draft');
  const selected = await building(draft.package.features[0].id);
  assert.equal(selected.recordState, 'candidate');
  assert.equal(selected.footprintKind.value, 'roofprint');
  assert.equal(selected.footprint.state, 'candidate');
  assert.equal(selected.inputRevisions.find(pin => pin.namespace === 'area_feature')?.revision, 0);
  await transport(selected);
  assert.equal(read('roofprint-recording').body.error.code, 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED');
}
async function verifyTower(): Promise<void> {
  const tower = await building('6f95d04e-2067-4ac8-a3c2-6cc21ea46325');
  const before = JSON.parse(readFileSync('docs/evidence/gf-backend/k2b/tower3-after.json', 'utf8'));
  assert.deepEqual(tower, before);
  assert.equal(tower.storeyLabel.state, 'conflicting');
  assert.equal(tower.conflictDecisions?.at(-1)?.outcome, 'unresolved');
  await transport(tower);
}
await verifyRooms();
await verifyImagery();
await verifyTower();
writeFileSync(`${root}/canonical-check.json`, JSON.stringify({ exitCode: 0, imageryOriginalsVerified: 22,
  imageryOverlays: 22, roofprintCandidates: 80, acceptedSourceSelections: 1, rejectedSourceSelections: 1,
  physicalRecordsCreated: 0, registryAcceptanceBlocked: 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED',
  roomCandidates: 18, magnoliaLevelsCreated: 0, magnoliaPhysicalHistory: [1, 2],
  replayCreatesRevision: false, unavailableHistory: 404, crossSite: 403, staleCandidateCommand: 409,
  unknownLevelAttachment: 422, mismatchedIdempotencyHeader: 422,
  towerConflictUnchanged: true }) + '\n');
console.log('Canonical imagery/candidates and original hashes verified; '
  + 'room/history and fail-closed transport checks passed.');
