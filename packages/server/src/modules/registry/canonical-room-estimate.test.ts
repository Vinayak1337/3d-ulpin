import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  BuildingPlanCandidateRequestSchema, NormalizedBuildingSchema, RoomPlanEstimateSchema, type NormalizedBuilding,
} from '@ulpin/contracts';
import { retainedTower } from '../officer/source-spaces.test-fixture';
import { finishBuilding } from './canonical-building';
import { addRoomPlanEstimates, roomPlanEstimate } from './canonical-room-estimate';

type Candidate = NormalizedBuilding['candidates'][number];

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const magnolia = NormalizedBuildingSchema.parse(read('docs/evidence/gf-t16/k3b/magnolia-after-current.json'));
const kitchen = magnolia.candidates[0];
type Ring = NonNullable<Candidate['polygons']>[number][number];

function square(x: number, y: number, side: number): Ring {
  return [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]];
}

function room(polygons: Candidate['polygons']): Candidate {
  return { ...structuredClone(kitchen), polygons };
}

function estimated(candidate: Candidate) {
  const estimate = RoomPlanEstimateSchema.parse(roomPlanEstimate(candidate));
  assert.equal(estimate.state, 'estimated');
  return estimate;
}

test('Magnolia rooms read their area and extent from the plan-metre polygon as it is', () => {
  const byLabel = (label: string, level: string) => magnolia.candidates.find(candidate =>
    candidate.labelLiteral === label && candidate.levelLabelLiteral === level)!;
  assert.equal(kitchen.labelLiteral, 'KITCHEN');
  const estimate = estimated(kitchen);
  assert.equal(estimate.areaM2, 6.55);
  assert.deepEqual(estimate.extentM, [2.42, 2.71]);
  assert.deepEqual(estimate.basis, { method: 'polygon_area_in_plan_metres@1', scaleState: 'candidate',
    metresPerPdfPoint: kitchen.planFrame!.metresPerPdfPoint });
  assert.equal(estimate.limitations.length, 3);
  assert.equal(estimated(byLabel('MASTER BEDROOM', 'FIRST FLOOR PLAN')).areaM2, 15.94);
  assert.equal(estimated(byLabel('unknown', 'SECOND FLOOR PLAN')).areaM2, 1.6);
});

test('a square, a holed polygon and a multipolygon give their exact areas and bounding extents', () => {
  assert.deepEqual(estimated(room([[square(1, 2, 3)]])).extentM, [3, 3]);
  assert.equal(estimated(room([[square(1, 2, 3)]])).areaM2, 9);
  assert.equal(estimated(room([[square(0, 0, 10), square(4, 4, 2)]])).areaM2, 96);
  const parts = estimated(room([[square(0, 0, 2)], [square(5, 1, 1)]]));
  assert.equal(parts.areaM2, 5);
  assert.deepEqual(parts.extentM, [6, 2]);
});

test('without a plan frame, a polygon or an enclosed area the estimate is unknown, never 0', () => {
  const { planFrame: _, ...unframed } = structuredClone(kitchen);
  const flat = room([[[[0, 0], [4, 0], [8, 0], [0, 0]]]]);
  for (const candidate of [unframed, room(null), room([]), flat]) {
    const estimate = RoomPlanEstimateSchema.parse(roomPlanEstimate(candidate));
    assert.equal(estimate.state, 'unknown');
    assert.equal(estimate.areaM2, null);
    assert.equal(estimate.extentM, null);
    assert.equal(estimate.basis, null);
    assert.equal(estimate.limitations.length, 1);
  }
});

test('Tower 3, with no room candidate, keeps its canonical output and revisionId byte for byte', () => {
  const building = structuredClone(retainedTower);
  const before = JSON.stringify(building);
  addRoomPlanEstimates(building);
  assert.equal(JSON.stringify(building), before);
  assert.equal(finishBuilding(building).revisionId, finishBuilding(structuredClone(retainedTower)).revisionId);
});

test('only rooms gain an estimate, and the canonical read still parses', () => {
  const building = structuredClone(magnolia);
  addRoomPlanEstimates(building);
  assert(building.candidates.every(candidate => candidate.planEstimate?.state === 'estimated'));
  assert.equal(magnolia.candidates[0].planEstimate, undefined);
  const roofprint = { ...structuredClone(kitchen), kind: 'roofprint' as const };
  building.candidates.push(roofprint);
  addRoomPlanEstimates(building);
  assert.equal(building.candidates.at(-1)!.planEstimate, undefined);
  NormalizedBuildingSchema.parse(building);
});

test('a retain_rooms caller cannot supply an estimate', () => {
  const request = read('docs/evidence/gf-backend/k2c/rooms-request.json');
  BuildingPlanCandidateRequestSchema.parse(request);
  request.candidates[0].planEstimate = roomPlanEstimate(kitchen);
  assert.throws(() => BuildingPlanCandidateRequestSchema.parse(request));
});

test('no packet, plan, card, review or learning builder reads planEstimate', () => {
  const root = 'packages/server/src';
  const readers = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter(path => path.endsWith('.ts') && readFileSync(join(root, path), 'utf8').includes('planEstimate'))
    .map(path => path.replaceAll('\\', '/'));
  assert.deepEqual(readers.sort(), ['modules/registry/canonical-room-estimate.test.ts',
    'modules/registry/canonical-room-estimate.ts']);
});
