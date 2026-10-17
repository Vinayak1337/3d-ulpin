import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readDemo, safeEnvironment } from '../../../../scripts/platform/demo-config.mjs';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k3c';
const magnoliaId = 'e8777ffc-9409-4129-bacf-f680160d8795';
const areaId = 'cb24dc86-2b91-4793-9586-24e8a443b8d8';

function save(name, value) {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function get(path) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  return response.json();
}

async function post(path, input, status) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', 'Idempotency-Key': input.requestKey,
  }, body: JSON.stringify(input) });
  const result = await response.json();
  return { status: response.status, expected: status, result };
}

function inspectDatabase(stage) {
  // Standard runtime configuration reader only; credentials are never inspected or emitted.
  execFileSync(process.execPath, ['--require', resolve('scripts/platform/isolated-env.cjs'), '--import', 'tsx',
    resolve(`${root}/inspect-database.ts`), stage], {
    env: safeEnvironment(readDemo()), encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function existingArea() {
  const area = (await get('/areas')).find(value => value.id === areaId);
  assert(area, 'The retained area must be present in the published area list.');
  return area;
}

function recordRevision(building) {
  return building.inputRevisions.find(pin => pin.namespace === 'registry_record').revision;
}

async function rejectRoom() {
  const before = await get(`/buildings/${magnoliaId}/canonical`);
  const candidate = before.candidates.find(value => !value.review && value.levelId === null);
  assert(candidate);
  const request = { action: 'reject', requestKey: randomUUID(), expectedCanonicalRevision: before.revisionId,
    candidateId: candidate.candidateId,
    reason: 'K3c contract check: reject this retained source room candidate only; '
      + 'not an extraction-accuracy label, space adoption or geometry correction',
  };
  const path = `/buildings/${magnoliaId}/candidates`;
  save('room-before', candidate);
  save('room-request', request);
  const receipt = await post(path, request, 201);
  save('room-receipt', receipt);
  assert.equal(receipt.status, receipt.expected);
  const after = await get(`/buildings/${magnoliaId}/canonical`);
  const rejected = after.candidates.find(value => value.candidateId === candidate.candidateId);
  assert.equal(rejected.state, 'reviewed');
  assert.equal(rejected.review.outcome, 'rejected');
  assert.equal(rejected.levelId, null);
  for (const field of ['polygons', 'planFrame', 'citations']) assert.deepEqual(rejected[field], candidate[field]);
  assert(after.levels.every(level => !level.roomCandidateIds.includes(candidate.candidateId)));
  save('room-after', rejected);
  const replay = await post(path, request, 201);
  assert.deepEqual(replay, receipt);
  const attach = await post(path, { ...request, action: 'attach_level', requestKey: randomUUID(),
    expectedCanonicalRevision: after.revisionId, levelId: after.levels[0].levelId }, 409);
  assert.equal(attach.status, 409);
  assert.equal(attach.result.error.code, 'CANDIDATE_DECIDED');
  return { candidateId: candidate.candidateId, review: rejected.review, recordRevisionBefore: recordRevision(before),
    recordRevisionAfter: recordRevision(after), replayUnchanged: true, laterAttach: 409,
    laterAttachCode: attach.result.error.code, geometryChanged: false, placement: rejected.planFrame.placement };
}

function undecidedImage(area) {
  const groups = new Map();
  for (const candidate of area.candidates) {
    const itemId = candidate.outputRef.match(/\/items\/([^#]+)#/)[1];
    const candidates = groups.get(itemId) ?? [];
    candidates.push(candidate);
    groups.set(itemId, candidates);
  }
  return [...groups.entries()].find(([, candidates]) => candidates.every(candidate => !candidate.review));
}

async function rejectRoofprint() {
  const before = await get(`/areas/${areaId}/canonical`);
  const [itemId, candidates] = undecidedImage(before);
  const candidate = candidates[0];
  const item = await get(`/spatial-ml/items/${itemId}`);
  const source = await get(`/import-packages/${item.packageId}`);
  const area = await existingArea();
  const request = { requestKey: randomUUID(), expectedRevision: source.revision, expectedAreaRevision: area.revision,
    georeference: 'source_geotiff', selections: [], rejected: [{ componentId: candidate.candidateId,
      reason: 'K3c contract check: reject-only source roofprint decision; '
        + 'not an independent accuracy label, registry admission or measurement qualification' }],
  };
  save('roof-before', candidate);
  save('roof-request', request);
  const path = `/spatial-ml/items/${itemId}/footprint-drafts`;
  const receipt = await post(path, request, 200);
  save('roof-receipt', receipt);
  assert.equal(receipt.status, receipt.expected);
  assert.equal(receipt.result.package, null);
  assert.deepEqual(receipt.result.receipt.selections, []);
  const after = await get(`/areas/${areaId}/canonical`);
  const rejected = after.candidates.find(value => value.candidateId === candidate.candidateId);
  assert.equal(rejected.state, 'reviewed');
  assert.equal(rejected.review.outcome, 'rejected');
  assert.deepEqual(rejected.polygons, candidate.polygons);
  save('roof-after', rejected);
  await verifyRoofReplayAndRefusal(path, request, receipt, candidate);
  return { candidateId: candidate.candidateId, itemId, review: rejected.review, recordRevisionBefore: area.revision,
    recordRevisionAfter: (await existingArea()).revision, canonicalChanged: before.revisionId !== after.revisionId,
    packagesCreated: 0, featuresCreated: 0, imageHadNoPriorDecision: true, laterAccept: 422,
    laterAcceptCode: 'ML_REVIEW_SELECTION', replayUnchanged: true };
}

async function verifyRoofReplayAndRefusal(path, request, receipt, candidate) {
  assert.deepEqual(await post(path, request, 200), receipt);
  const laterAccept = await post(path, { ...request, requestKey: randomUUID(), rejected: [],
    selections: [{ componentId: candidate.candidateId, subject: 'K3c decided-component refusal check' }],
    reason: 'A rejected component may not be accepted in a new command' }, 422);
  assert.equal(laterAccept.status, 422);
  assert.equal(laterAccept.result.error.code, 'ML_REVIEW_SELECTION');
}

async function retainedRoomResult() {
  const before = JSON.parse(readFileSync(`${root}/db-before.json`, 'utf8'));
  const saved = JSON.parse(readFileSync(`${root}/room-after.json`, 'utf8'));
  const receipt = JSON.parse(readFileSync(`${root}/room-receipt.json`, 'utf8'));
  assert.equal(receipt.status, 201);
  const building = await get(`/buildings/${magnoliaId}/canonical`);
  assert.deepEqual(building.candidates.find(value => value.candidateId === saved.candidateId), saved);
  return { candidateId: saved.candidateId, review: saved.review,
    recordRevisionBefore: before.records.find(record => record.id === magnoliaId).revision,
    recordRevisionAfter: receipt.result.recordRevision, replayUnchanged: true, laterAttach: 409,
    laterAttachCode: 'CANDIDATE_DECIDED', geometryChanged: false, placement: saved.planFrame.placement };
}

async function retainedRoofResult() {
  const saved = JSON.parse(readFileSync(`${root}/roof-after.json`, 'utf8'));
  const receipt = JSON.parse(readFileSync(`${root}/roof-receipt.json`, 'utf8'));
  const request = JSON.parse(readFileSync(`${root}/roof-request.json`, 'utf8'));
  const area = await get(`/areas/${areaId}/canonical`);
  assert.equal(receipt.status, 200);
  assert.equal(receipt.result.package, null);
  assert.deepEqual(receipt.result.receipt.selections, []);
  assert.deepEqual(area.candidates.find(value => value.candidateId === saved.candidateId), saved);
  const before = JSON.parse(readFileSync(`${root}/roof-before.json`, 'utf8'));
  assert.equal(before.review, undefined);
  return { candidateId: saved.candidateId, itemId: receipt.result.receipt.itemId, review: saved.review,
    recordRevisionBefore: request.expectedAreaRevision, recordRevisionAfter: (await existingArea()).revision,
    packagesCreated: 0, featuresCreated: 0, imageHadNoPriorDecision: true, laterAccept: 422,
    laterAcceptCode: 'ML_REVIEW_SELECTION', replayUnchanged: true,
    evidenceFinalizedFromSavedArtifactsWithoutAdditionalPost: true };
}

function verifyDatabaseCounts() {
  const before = JSON.parse(readFileSync(`${root}/db-before.json`, 'utf8'));
  const after = JSON.parse(readFileSync(`${root}/db-after.json`, 'utf8'));
  for (const key of ['packages', 'features', 'registry']) assert.equal(after.counts[key], before.counts[key]);
  assert.equal(after.counts.roofreceipts, before.counts.roofreceipts + 1);
  assert.equal(after.roofAreaRevision, before.roofAreaRevision);
  return { packagesCreated: 0, featuresCreated: 0, registryRecordsCreated: 0, roofReceiptsAdded: 1 };
}

const mode = process.argv[2];
assert(mode === undefined || ['resume-roof-only', 'finalize-saved-only'].includes(mode));
const finalizeSavedOnly = mode === 'finalize-saved-only';
if (!finalizeSavedOnly && mode !== 'resume-roof-only') {
  assert(!existsSync(`${root}/live-reservation.json`), 'Create-once API journey already reserved; do not rerun.');
  save('live-reservation', { startedAt: new Date().toISOString(), limit: 'one room and one roofprint rejection' });
  inspectDatabase('before');
}
if (mode === 'resume-roof-only') {
  assert(!existsSync(`${root}/roof-request.json`), 'No prior roofprint write may be repeated.');
}
const room = mode ? await retainedRoomResult() : await rejectRoom();
const roofprint = finalizeSavedOnly ? await retainedRoofResult() : await rejectRoofprint();
if (!finalizeSavedOnly) inspectDatabase('after');
save('live-result', { task: 'K3c', room, roofprint, database: verifyDatabaseCounts(),
  writes: 'existing APIs only; database observations read-only', registryAdmission: 'deferred, unchanged' });
console.log('One room rejection and one reject-only roofprint decision recorded and replayed; zero new packages.');
