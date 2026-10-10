import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  LevelScheduleReceiptSchema, NormalizedBuildingSchema, BuildingPlanCandidateReceiptSchema,
  type BuildingCitation, type LevelScheduleContent, type NormalizedBuilding,
} from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-t16/k3b';
const ids = { tower: '6f95d04e-2067-4ac8-a3c2-6cc21ea46325', magnolia: 'e8777ffc-9409-4129-bacf-f680160d8795' };
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

function save(name: string, value: unknown): void {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function current(buildingId: string): Promise<NormalizedBuilding> {
  const response = await fetch(`${base}/buildings/${buildingId}/canonical`);
  assert.equal(response.status, 200);
  return NormalizedBuildingSchema.parse(await response.json());
}

async function command(path: string, request: { requestKey: string } & Record<string, unknown>,
  name: string): Promise<unknown> {
  assert(!existsSync(`${root}/${name}-request.json`), 'Create-once command already reserved; do not repeat.');
  save(`${name}-request`, request);
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': request.requestKey },
    body: JSON.stringify(request) });
  const result = await response.json();
  save(`${name}-receipt`, { httpStatus: response.status, result });
  assert.equal(response.status, 201, name);
  return result;
}

function towerContent(building: NormalizedBuilding): LevelScheduleContent {
  const conflict = building.conflicts.find(entry => entry.property === 'building.storeyLabel');
  assert(conflict && conflict.alternatives.length === 2);
  const a5 = read('docs/evidence/gf-ai/storeys/a5/candidates/haryana-2831-tower3.json');
  return { state: 'conflicting', levels: [], alternatives: conflict.alternatives.map(alternative => ({
    labelLiteral: String(alternative.value), levels: [], citations: alternative.value === 'G+42'
      ? a5.storeyCount.alternatives[0].citations : alternative.citations,
  })) };
}

function magnoliaContent(building: NormalizedBuilding): LevelScheduleContent {
  const retained = read('docs/evidence/gf-ai/plans/vector/20261010-p1-panels/bihar/candidates.json');
  const bytes = readFileSync(retained.fullPrecisionRef.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), retained.fullPrecisionRef.sha256);
  const derivative = JSON.parse(bytes.toString('utf8'));
  const source = building.candidates[0].citations![0];
  type Panel = { titleCitation: { literal: string; bbox: number[] } };
  const panels: Panel[] = derivative.pages['2'].panels;
  assert.deepEqual(panels.map(panel => panel.titleCitation.literal),
    ['GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'SECOND FLOOR PLAN']);
  return { state: 'reviewed', levels: panels.map((panel, order) => {
    const [x, y, right, bottom] = panel.titleCitation.bbox;
    const citation: BuildingCitation = { sourceId: source.sourceId, sourceSha256: source.sourceSha256,
      locator: { kind: 'region', page: 2, x, y, width: right - x, height: bottom - y, unit: 'pt' } };
    return { levelId: randomUUID(), order, labelLiteral: panel.titleCitation.literal, kind: 'floor',
      lowerM: null, upperM: null, verticalReference: null, heightSource: 'unknown', citations: [citation] };
  }) };
}

function decisionReason(kind: 'tower' | 'magnolia'): string {
  if (kind === 'tower') {
    return 'Checked retained S-001 G+41 and UNIT DETAIL / TOWER AREA DETAIL G+42 alternatives; '
      + 'schedule reviewed as conflicting, neither expression expanded into individual levels; heights unknown.';
  }
  const truth = read('docs/evidence/usp/finale/GF-DATA/storey-truth/demo/bihar-magnolia.json');
  const literal = truth.registry.floorExpression.value;
  return `Retained independent RERA floor expression remains literal '${literal}' (not an installed count). `
    + 'GROUND, FIRST and SECOND plan captions reviewed as a labelled inventory, not an automatic numeric conversion. '
    + 'P1 places the TERRACE space label inside SECOND FLOOR PLAN, not a fourth floor caption; '
    + 'terrace candidate retained separately. Heights and global placement remain unknown.';
}

async function reviewSchedule(kind: 'tower' | 'magnolia'): Promise<void> {
  const id = ids[kind];
  assert(!existsSync(`${root}/${kind}-before.json`), 'Schedule journey already started; preserve prior evidence.');
  const before = await current(id);
  save(`${kind}-before`, before);
  const content = kind === 'tower' ? towerContent(before) : magnoliaContent(before);
  const path = `/buildings/${id}/level-schedules`;
  const proposed = LevelScheduleReceiptSchema.parse(await command(path, { action: 'propose', requestKey: randomUUID(),
    expectedCanonicalRevision: before.revisionId, content }, `${kind}-proposal`));
  const candidate = await current(id);
  assert.equal(candidate.levels.length, 0);
  assert.equal(candidate.levelScheduleProposals?.at(-1)?.state, 'candidate');
  save(`${kind}-after-proposal`, candidate);
  const reviewed = LevelScheduleReceiptSchema.parse(await command(path, { action: 'review', requestKey: randomUUID(),
    expectedCanonicalRevision: candidate.revisionId, proposalId: proposed.proposal.proposalId,
    reason: decisionReason(kind) }, `${kind}-review`));
  assert(reviewed.schedule);
  const after = await current(id);
  assert.equal(after.levelSchedule?.state, content.state);
  assert.equal(after.heightM.value, null);
  save(`${kind}-after-schedule`, after);
  save(`${kind}-prisms`, { heightState: 'unknown', generatedPrisms: 0,
    assessments: after.levelSchedule!.prisms, reason: 'No cited vertical limits; no extrusion requested' });
}

async function attachRoom(): Promise<void> {
  const building = await current(ids.magnolia);
  const ground = building.levels.find(level => level.label.value === 'GROUND FLOOR PLAN');
  const room = building.candidates.find(candidate => candidate.levelLabelLiteral === 'GROUND FLOOR PLAN');
  assert(ground && room && room.levelId === null && room.planFrame?.placement === 'unknown');
  const receipt = await command(`/buildings/${ids.magnolia}/candidates`, {
    action: 'attach_level', requestKey: randomUUID(), expectedCanonicalRevision: building.revisionId,
    candidateId: room.candidateId, levelId: ground.levelId,
    reason: 'Officer explicitly selected the reviewed GROUND level and checked the retained GROUND panel room; '
      + 'association only, plan-local polygons stay unplaced and are not registry spaces or measurement truth',
  }, 'room-attach');
  BuildingPlanCandidateReceiptSchema.parse(receipt);
  const after = await current(ids.magnolia);
  const updated = after.candidates.find(candidate => candidate.candidateId === room.candidateId)!;
  assert.equal(updated.state, 'reviewed');
  assert.equal(updated.levelId, ground.levelId);
  assert.equal(updated.planFrame?.placement, 'unknown');
  assert.deepEqual(updated.polygons, room.polygons);
  save('magnolia-after', after);
  save('room-attachment-result', { candidateId: room.candidateId, levelId: ground.levelId,
    state: updated.state, placement: updated.planFrame?.placement, registrySpacesCreated: 0,
    geometryChanged: false, measurementQualificationGranted: false });
}

const action = process.argv[2];
assert(['tower', 'magnolia', 'attach'].includes(action));
if (action === 'tower' || action === 'magnolia') await reviewSchedule(action);
if (action === 'attach') await attachRoom();
