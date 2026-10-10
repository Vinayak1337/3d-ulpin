import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { NormalizedAreaSchema, NormalizedBuildingSchema } from '../../../../packages/contracts/src/index';

const root = 'docs/evidence/gf-t16/k3b';
const base = 'http://127.0.0.1:3194/api/v1';
const ids = { tower: '6f95d04e-2067-4ac8-a3c2-6cc21ea46325', magnolia: 'e8777ffc-9409-4129-bacf-f680160d8795' };
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));

async function current(id: string) {
  const response = await fetch(`${base}/buildings/${id}/canonical`);
  assert.equal(response.status, 200);
  const building = NormalizedBuildingSchema.parse(await response.json());
  assert.equal(response.headers.get('etag'), `"${building.revisionId}"`);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  return building;
}

async function post(id: string, input: { requestKey: string }, suffix = '/level-schedules', key = input.requestKey) {
  return fetch(`${base}/buildings/${id}${suffix}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(input) });
}

async function verifySchedule(kind: 'tower' | 'magnolia') {
  const building = await current(ids[kind]);
  assert.equal(building.heightM.value, null);
  assert.equal(building.heightState, 'unknown');
  assert.equal(building.baseM.value, null);
  assert.equal(building.footprint.value, null);
  assert.equal(building.levelScheduleProposals!.length, 1);
  assert.equal(building.levelSchedule!.state, kind === 'tower' ? 'conflicting' : 'reviewed');
  if (kind === 'tower') {
    assert.equal(building.storeys.state, 'conflicting');
    assert.equal(building.levels.length, 0);
    assert.deepEqual(building.levelSchedule!.alternatives!.map(row => row.labelLiteral).sort(), ['G+41', 'G+42']);
    assert.equal(building.storeyLabel.state, 'conflicting');
    assert.equal(building.conflictDecisions!.at(-1)!.outcome, 'unresolved');
  } else {
    assert.deepEqual(building.levels.map(level => level.label.value),
      ['GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'SECOND FLOOR PLAN']);
    assert.equal(building.storeyCount.value, null, 'Caption inventory must not silently become a numeric claim.');
    assert(building.levels.every(level => level.lowerM.value === null && level.upperM.value === null
      && level.heightState === 'unknown' && level.heightSource === 'unknown'
      && level.prismAssessment?.prism === null));
    const attached = building.candidates.filter(candidate => candidate.levelId !== null);
    assert.equal(attached.length, 1);
    assert.equal(attached[0].state, 'reviewed');
    assert.equal(attached[0].planFrame?.placement, 'unknown');
    assert.equal(attached[0].planFrame?.scaleState, 'candidate');
    assert(building.levels[0].roomCandidateIds?.includes(attached[0].candidateId));
    assert.equal(building.levels.flatMap(level => level.spaces).length, 0);
  }
  writeFileSync(`${root}/${kind}-after-current.json`, JSON.stringify(building) + '\n');
  return building;
}

async function verifyHistory(kind: 'tower' | 'magnolia'): Promise<void> {
  const response = await fetch(`${base}/physical-features/${ids[kind]}/revisions`);
  assert.equal(response.status, 200);
  const history = await response.json();
  const revisions = history.revisions.map((entry: { revision: number }) => entry.revision);
  assert.deepEqual(revisions, kind === 'tower' ? [4, 3, 2, 1] : [5, 4, 3, 2, 1]);
  const previous = history.revisions.find((entry: { revision: number }) => entry.revision === 2).body;
  for (const entry of history.revisions.filter((entry: { revision: number }) => entry.revision > 2)) {
    assert.deepEqual({ ...entry.body, revision: 2 }, previous);
  }
  writeFileSync(`${root}/${kind}-physical-history.json`, JSON.stringify(history) + '\n');
}

async function verifyReplay(kind: 'tower' | 'magnolia'): Promise<void> {
  const before = await current(ids[kind]);
  for (const action of ['proposal', 'review']) {
    const input = read(`${kind}-${action}-request`);
    const response = await post(ids[kind], input);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), read(`${kind}-${action}-receipt`).result);
  }
  if (kind === 'magnolia') {
    const response = await post(ids[kind], read('room-attach-request'), '/candidates');
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), read('room-attach-receipt').result);
  }
  assert.deepEqual(await current(ids[kind]), before);
}

async function verifyRetainedImagery(): Promise<void> {
  const areaId = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';
  const response = await fetch(`${base}/areas/${areaId}/canonical`);
  assert.equal(response.status, 200);
  const area = NormalizedAreaSchema.parse(await response.json());
  assert.equal(area.candidates?.length, 80);
  assert.equal(area.overlays.length, 22);
  const imagery = area.imagery![0];
  assert.equal(imagery.classification, 'test_only');
  assert.equal(imagery.analyticalEligibility, 'not_assessed');
  assert.equal(imagery.chips.length, 22);
  for (const chip of imagery.chips) {
    const original = await fetch(`${base}/sources/${chip.sourceId}/file`);
    assert.equal(original.status, 200);
    const digest = createHash('sha256').update(new Uint8Array(await original.arrayBuffer())).digest('hex');
    assert.equal(digest, chip.sourceSha256);
  }
  assert.equal(area.candidates!.filter(candidate => candidate.review?.outcome === 'accepted').length, 1);
  assert.equal(area.candidates!.filter(candidate => candidate.review?.outcome === 'rejected').length, 1);
  assert(area.candidates!.every(candidate => candidate.confidenceCalibration === 'uncalibrated'));
  const roof = await current('a2ea9cd6-da0d-413a-9a48-03d7f25cd5e4');
  const before = JSON.parse(readFileSync('docs/evidence/gf-backend/k2d/roofprint-before.json', 'utf8'));
  assert.deepEqual(roof, before);
  assert.equal(roof.inputRevisions.find(pin => pin.namespace === 'area_feature')?.revision, 0);
}

function withoutCurrentProjectionPins(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCurrentProjectionPins);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'revisionId')
      .map(([key, entry]) => [key, withoutCurrentProjectionPins(entry)]));
  }
  return value;
}

async function verifyOriginalRoomsAndConflict(): Promise<void> {
  const magnolia = await current(ids.magnolia);
  const before = read('magnolia-before');
  assert.equal(magnolia.candidates.length, 18);
  for (const room of magnolia.candidates) {
    const prior = before.candidates.find((candidate: { candidateId: string }) =>
      candidate.candidateId === room.candidateId);
    for (const key of ['polygons', 'planFrame', 'frameId', 'citations', 'sourceSha256', 'derivativeSha256', 'method']) {
      assert.deepEqual(room[key as keyof typeof room], prior[key]);
    }
  }
  const tower = await current(ids.tower);
  assert.deepEqual(withoutCurrentProjectionPins(tower.conflictDecisions),
    withoutCurrentProjectionPins(read('tower-before').conflictDecisions));
  assert.notDeepEqual(withoutCurrentProjectionPins({ expectedCanonicalRevision: 'before' }),
    withoutCurrentProjectionPins({ expectedCanonicalRevision: 'after' }));
  for (const key of ['heightM', 'baseM', 'storeyLabel', 'storeyCount'] as const) {
    assert.deepEqual(withoutCurrentProjectionPins(tower[key]), withoutCurrentProjectionPins(read('tower-before')[key]),
      `Retained ${key} literal/state/citations, apart from current projection pin`);
  }
}

async function verifyRefusals(): Promise<void> {
  const building = await current(ids.magnolia);
  const input = read('magnolia-proposal-request');
  const uncited = structuredClone(input);
  uncited.requestKey = randomUUID();
  uncited.expectedCanonicalRevision = building.revisionId;
  uncited.content.levels[0].citations = [];
  assert.equal((await post(ids.magnolia, uncited)).status, 422);
  const stale = { ...input, requestKey: randomUUID() };
  assert.equal((await post(ids.magnolia, stale)).status, 409);
  assert.equal((await post(ids.magnolia, input, '/level-schedules', randomUUID())).status, 422);
  assert.equal((await post(ids.magnolia, input, '/level-schedules?unexpected=true')).status, 422);
  const cross = await fetch(`${base}/buildings/${ids.magnolia}/canonical`, {
    headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  const exact = await fetch(`${base}/buildings/${ids.magnolia}/canonical?revision=${building.revisionId}`);
  assert.equal(exact.status, 200);
  assert.deepEqual(await exact.json(), building);
  const priorRevision = read('magnolia-before').revisionId;
  const unavailable = await fetch(`${base}/buildings/${ids.magnolia}/canonical?revision=${priorRevision}`);
  assert.equal(unavailable.status, 404);
  assert.deepEqual(await current(ids.magnolia), building);
}

await verifySchedule('tower');
await verifySchedule('magnolia');
await verifyHistory('tower');
await verifyHistory('magnolia');
await verifyReplay('tower');
await verifyReplay('magnolia');
await verifyRefusals();
await verifyRetainedImagery();
await verifyOriginalRoomsAndConflict();
writeFileSync(`${root}/canonical-check-extended.json`, JSON.stringify({ exitCode: 0, towerSchedule: 'conflicting',
  towerLevels: 0, alternatives: ['G+41', 'G+42'], magnoliaReviewedLevels: 3, separateTerraceLevelInvented: false,
  roomAssociationsReviewed: 1, roomPlacement: 'unknown', spacesCreated: 0, prismsGenerated: 0,
  sourceHistoriesUnchangedExceptRevision: true, requestReplaysAppendRevisions: false,
  imageryOriginalHashesVerified: 22, roofCandidatesPreserved: 80, previousSourceDecisionsPreserved: true,
  roofprintCanonicalExactlyUnchanged: true, roofprintPhysicalRevision: 0, originalRoomGeometryRetained: 18,
  priorTowerUnresolvedDecisionUnchangedApartFromCurrentProjectionPins: true,
  citationRefusal: 422, staleRefusal: 409, headerRefusal: 422, queryRefusal: 422, crossSite: 403,
  unavailableHistoricalProjection: 404 }) + '\n');
console.log('Schedules, conflict alternatives, unknown prisms, room association, histories and refusals verified.');
