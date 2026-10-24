import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  NormalizedBuildingSchema, NormalizedAreaSchema, type NormalizedBuilding,
} from '../../../../packages/contracts/src/canonical/building';
import { toSceneInputs } from '../../../../packages/contracts/src/canonical/building-scene';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2b';
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));
const save = (name: string, value: unknown) => {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
};
async function api(path: string) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  return response;
}
async function building(id: string): Promise<NormalizedBuilding> {
  const response = await api(`/buildings/${id}/canonical`);
  const record = NormalizedBuildingSchema.parse(await response.json());
  assert.equal(response.headers.get('etag'), `"${record.revisionId}"`);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  for (const value of [record.footprint, record.baseM, record.heightM, record.storeys]) {
    assert.equal(value.value, null);
    assert.equal(value.state, 'unknown');
  }
  assert.equal(record.levels.length, 0);
  assert.equal(record.parcelRefs.length, 0);
  return record;
}
function checkUnresolved(tower: NormalizedBuilding): void {
  const before = NormalizedBuildingSchema.parse(read('tower3-before'));
  const decision = read('officer-decision');
  assert.notEqual(tower.revisionId, before.revisionId);
  assert.equal(tower.storeyCount.state, 'conflicting');
  assert.equal(tower.storeyCount.value, null);
  assert.equal(tower.storeyLabel.state, 'conflicting');
  assert.deepEqual(tower.conflictDecisions?.at(-1)?.requestKey, decision.requestKey);
  assert.equal(decision.outcome, 'unresolved');
  assert.match(decision.reason, /checked against.*page 1/);
  assert.equal(tower.resolvedConflicts, undefined);
  const conflict = tower.conflicts.find(entry => entry.property === decision.property)!;
  assert.deepEqual(conflict.alternatives.map(value => value.value), ['G+41', 'G+42']);
  assert(conflict.alternatives.every(value => value.state === 'candidate' && value.method.startsWith('model:')));
  assert.deepEqual(conflict.alternatives.map(value => value.citations),
    before.conflicts[0].alternatives.map(value => value.citations));
  assert(tower.inputRevisions.some(pin => pin.namespace === 'registry_record' && pin.revision === 2));
}
async function verifyTransport(tower: NormalizedBuilding): Promise<void> {
  const exact = await api(`/buildings/${tower.buildingId}/canonical?revision=${tower.revisionId}`);
  assert.deepEqual(await exact.json(), tower);
  const unavailable = await fetch(`${base}/buildings/${tower.buildingId}/canonical?revision=${'0'.repeat(64)}`);
  assert.equal(unavailable.status, 404);
  const denied = await fetch(`${base}/buildings/${tower.buildingId}/canonical`, {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(denied.status, 403);
  const staleInput = { ...read('officer-request'), requestKey: randomUUID() };
  const stale = await fetch(`${base}/buildings/${tower.buildingId}/conflict-decisions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': staleInput.requestKey },
    body: JSON.stringify(staleInput),
  });
  assert.equal(stale.status, 409);
  const replayInput = read('officer-request');
  const replay = await fetch(`${base}/buildings/${tower.buildingId}/conflict-decisions`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': replayInput.requestKey },
    body: JSON.stringify(replayInput),
  });
  assert.equal(replay.status, 201);
  assert.deepEqual(await replay.json(), read('officer-decision'));
  assert.deepEqual(await building(tower.buildingId), tower);
}
async function verifyRetainedHistories(tower: NormalizedBuilding): Promise<void> {
  const pkg = JSON.parse(readFileSync('docs/evidence/gf-backend/k2/tower3-source-commit.json', 'utf8'));
  const live = await (await api(`/import-packages/${pkg.id}`)).json();
  assert.equal(live.revision, pkg.revision);
  assert.deepEqual(live.factCandidates, pkg.factCandidates);
  const response = await api(`/physical-features/${tower.buildingId}/revisions`);
  const history = await response.json();
  assert.equal(history.currentRevision, 2);
  assert.deepEqual(history.revisions.map((entry: { revision: number }) => entry.revision).sort(), [1, 2]);
  const latest = history.revisions.find((entry: { revision: number }) => entry.revision === 2);
  assert.equal(latest.body.properties.officerConflictDecision.requestKey, read('officer-decision').requestKey);
  const first = history.revisions.find((entry: { revision: number }) => entry.revision === 1);
  assert.equal(first.body.properties.officerConflictDecision, undefined);
  assert.equal(tower.conflicts[0].alternatives.length, 2);
}

const tower = await building('6f95d04e-2067-4ac8-a3c2-6cc21ea46325');
const magnolia = await building('e8777ffc-9409-4129-bacf-f680160d8795');
checkUnresolved(tower);
await verifyTransport(tower);
await verifyRetainedHistories(tower);
const area = NormalizedAreaSchema.parse(await (await api(`/areas/${tower.areaId}/canonical`)).json());
assert.equal(area.administrativeContext?.length, 2);
assert(area.administrativeContext!.every(unit => unit.role === 'administrative_context'
  && unit.analyticalEligibility === 'not_assessed'));
assert.equal(toSceneInputs(area, [tower]).footprints.length, 0);
assert.equal(magnolia.storeyCount.state, 'unknown');
assert.equal(magnolia.frame.placement, 'unknown');
const ocr = read('ocr-result');
assert.equal(ocr.status, 'completed');
assert.equal(ocr.ocr.sourceSha256, read('officer-decision').citation.sourceSha256);
assert.deepEqual(ocr.ocr.requestedRegion, [280, 860, 960, 2580]);
save('result', {
  task: 'K2b', gatesPassed: [],
  gateScope: { 'GF-BACKEND': 'candidate provenance and command/runtime invariants verified; OCR still failed',
    'GF-GOVERN': 'backend unresolved officer decision and immutable revision history demonstrated' },
  provenance: { newImportTranscriberRequired: true, agentClaims: 'ai_extraction/unresolved => candidate',
    legacyStoredClaims: 'unchanged; no supported post-commit correction route', legacyProjection: 'candidate',
    destructiveReimport: false },
  officer: { buildingId: tower.buildingId, outcome: 'unresolved', recordRevision: 2,
    registryHistoryWrite: 'transaction appends revision 2; current canonical pin verified',
    physicalHistoryRead: [1, 2], replayCreatesRevision: false,
    selectedPath: 'contract-tested only; no truth-supported live selection', alternatives: ['G+41', 'G+42'],
    chosenFloorCount: null, reason: read('officer-decision').reason },
  canonical: { revisionId: tower.revisionId, current: 200, exactCurrent: 200, unavailable: 404,
    crossSite: 403, staleDecision: 409, unknownFootprintsRemainNull: true, sourceCitationsUnchanged: true },
  ocr: { wholePage: 'documented 2000-point limit; unchanged',
    diagnosedCause: 'Tesseract --list-langs: STATUS_DLL_NOT_FOUND, missing libcurl.dll',
    nativeDependencyProbe: 0, assets: 'eng+hin', hindiExecutionClaimed: false,
    regionApiResult: ocr, furtherRetries: 0 },
  runtime: read('runtime-final'),
  checks: { ...read('checks'), canonicalRuntime: {
    command: 'pnpm exec tsx docs/evidence/gf-backend/k2b/verify-canonical.ts', exitCode: 0,
  } },
});
console.log('Candidate provenance, unresolved decision/history, null dimensions, ETags/404/403/stale 409 verified.');
