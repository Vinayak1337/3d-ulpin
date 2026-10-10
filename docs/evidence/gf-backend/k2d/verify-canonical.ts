import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  NormalizedAreaSchema, NormalizedBuildingSchema,
} from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2d';
const buildingId = 'a2ea9cd6-da0d-413a-9a48-03d7f25cd5e4';
const areaId = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';

async function get(path: string): Promise<Response> {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  return response;
}

async function verifyRoofprint(): Promise<void> {
  const response = await get(`/buildings/${buildingId}/canonical`);
  const building = NormalizedBuildingSchema.parse(await response.json());
  assert.equal(response.headers.get('etag'), `"${building.revisionId}"`);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(building.recordState, 'candidate');
  assert.equal(building.footprint.state, 'candidate');
  assert.equal(building.footprintKind.value, 'roofprint');
  assert.equal(building.footprintKind.state, 'candidate');
  assert.equal(building.heightM.value, null);
  assert.equal(building.baseM.value, null);
  assert.equal(building.storeyCount.value, null);
  assert.equal(building.levels.length, 0);
  assert.equal(building.parcelRefs.length, 0);
  assert.equal(building.inputRevisions.find(pin => pin.namespace === 'area_feature')?.revision, 0);
  const before = JSON.parse(readFileSync(`${root}/roofprint-before.json`, 'utf8'));
  assert.deepEqual(building, before);
  const exact = await get(`/buildings/${buildingId}/canonical?revision=${building.revisionId}`);
  assert.deepEqual(await exact.json(), building);
  const denied = await fetch(`${base}/buildings/${buildingId}/canonical`, {
    headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(denied.status, 403);
}

async function verifyRetainedCandidates(): Promise<void> {
  const area = NormalizedAreaSchema.parse(await (await get(`/areas/${areaId}/canonical`)).json());
  assert.equal(area.candidates?.length, 80);
  assert.equal(area.overlays.length, 22);
  assert.equal(area.candidates?.filter(candidate => candidate.review?.outcome === 'accepted').length, 1);
  assert.equal(area.candidates?.filter(candidate => candidate.review?.outcome === 'rejected').length, 1);
  assert(area.candidates?.every(candidate => candidate.confidenceCalibration === 'uncalibrated'));
  const magnoliaId = 'e8777ffc-9409-4129-bacf-f680160d8795';
  const magnolia = NormalizedBuildingSchema.parse(await (await get(`/buildings/${magnoliaId}/canonical`)).json());
  assert.equal(magnolia.candidates.length, 18);
  assert.equal(magnolia.levels.length, 0);
  assert(magnolia.candidates.every(candidate => candidate.levelId === null));
  const towerId = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
  const tower = NormalizedBuildingSchema.parse(await (await get(`/buildings/${towerId}/canonical`)).json());
  assert.equal(tower.storeyLabel.state, 'conflicting');
  assert.equal(tower.conflictDecisions?.at(-1)?.outcome, 'unresolved');
}

await verifyRoofprint();
await verifyRetainedCandidates();
writeFileSync(`${root}/canonical-check.json`, JSON.stringify({ exitCode: 0, candidateRevision: 0,
  registryReviewedLifecycle: 'blocked, not demonstrated', admissionRefusalPreservesCanonical: true,
  unknownHeightLevelsParcels: true, imageryChips: 22, roofprintCandidates: 80, magnoliaRooms: 18,
  previousSourceSelectionsPreserved: true, addedRejectDecisions: 0,
  etagAndExactCurrent: true, crossSite: 403 }) + '\n');
console.log('Blocked admission preserves candidate lineage and unknowns; existing rooms/conflict unchanged.');
