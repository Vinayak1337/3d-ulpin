import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  LevelScheduleContentSchema, LevelScheduleProposalSchema, NormalizedBuildingSchema,
  type LevelScheduleContent, type RegistryRecord,
} from '@ulpin/contracts';
import { resolveScheduleHeights, reviewedLevelSchedule } from './level-schedules';
import { applyLevelSchedules, assessSchedulePrisms } from '../registry/canonical-level-schedule';
import { attachCandidateLevel } from '../usp/ingestion/source-building-candidates';

const read = (name: string) => JSON.parse(readFileSync(`docs/evidence/gf-backend/${name}`, 'utf8'));
const magnolia = NormalizedBuildingSchema.parse(read('k2c/magnolia-after-rooms.json'));
const tower = NormalizedBuildingSchema.parse(read('k2b/tower3-after.json'));
const actor = 'fixture-officer';
const at = '2026-10-10T05:30:00Z';
const citation = magnolia.candidates[0].citations![0];

function content(): LevelScheduleContent {
  return LevelScheduleContentSchema.parse({ state: 'reviewed', levels: [{ levelId: randomUUID(), order: 0,
    labelLiteral: 'GROUND FLOOR PLAN', kind: 'floor', lowerM: null, upperM: null, heightSource: 'unknown',
    verticalReference: null, citations: [citation] }] });
}

function reviewed(input: LevelScheduleContent, building = magnolia) {
  const proposal = LevelScheduleProposalSchema.parse({ proposalId: randomUUID(), buildingId: building.buildingId,
    recordRevision: 3, state: 'candidate', content: input, actor, at });
  return reviewedLevelSchedule(building, proposal,
    'Cited source inventory reviewed, not an elevation claim', actor, at, 4);
}

function project(input: LevelScheduleContent, source = magnolia) {
  const building = structuredClone(source);
  const schedule = reviewed(input, source);
  const record = { id: building.buildingId, canonicalLevelSchedules: [schedule] } as unknown as RegistryRecord;
  applyLevelSchedules(building, [record]);
  return NormalizedBuildingSchema.parse(building);
}

test('reviewed cited schedule projects labels without deriving levels or heights from a count', async () => {
  const input = content();
  const schedule = reviewed(input);
  const building = project(input);
  assert.equal(building.levels.length, 1);
  assert.equal(building.levels[0].label.state, 'reviewed');
  assert.equal(building.levels[0].lowerM.value, null);
  assert.equal(building.levels[0].upperM.value, null);
  assert.equal(building.levels[0].heightState, 'unknown');
  assert.deepEqual(await assessSchedulePrisms(building, schedule), { [input.levels[0].levelId]: {
    method: 'prism/2', analyticalEligibility: 'not_assessed', state: 'not_assessed',
    heightState: 'unknown', reason: 'level_limits_unknown', prism: null,
  } });
});

test('conflicting G+41/G+42 expressions retain both alternatives without expanding an invented floor inventory', () => {
  const alternatives = tower.conflicts.find(conflict => conflict.property === 'building.storeyLabel')!.alternatives;
  const input = LevelScheduleContentSchema.parse({ state: 'conflicting', levels: [],
    alternatives: alternatives.map(alternative => ({ labelLiteral: alternative.value,
      citations: alternative.citations, levels: [] })) });
  const building = project(input, tower);
  assert.equal(building.storeys.state, 'conflicting');
  assert.equal(building.storeys.value, null);
  assert.equal(building.levels.length, 0);
  assert.deepEqual(building.levelSchedule!.alternatives!.map(row => row.labelLiteral).sort(), ['G+41', 'G+42']);
  assert.equal(building.conflicts.at(-1)?.property, 'building.levelSchedule');
});

test('every listed level requires a citation and conflicting review cannot silently select one inventory', () => {
  const input = content();
  input.levels[0].citations = [];
  assert.equal(LevelScheduleContentSchema.safeParse(input).success, false);
  assert.equal(LevelScheduleContentSchema.safeParse({ ...content(), state: 'conflicting' }).success, false);
});

test('unstated limits cannot be filled with a typical height, nor derived without an explicit stated base', () => {
  const input = content();
  assert.deepEqual(resolveScheduleHeights(input), input);
  input.levels[0] = { ...input.levels[0], lowerM: 0, upperM: 3 };
  assert.equal(LevelScheduleContentSchema.safeParse(input).success, false);
  input.levels[0] = { ...input.levels[0], lowerM: null, upperM: null,
    heightSource: 'derived', statedHeightM: 3, verticalReference: 'building_relative' };
  assert.throws(() => resolveScheduleHeights(input), /stated base/);
});

test('controlled stated-height fixture accumulates only from its explicitly cited base', () => {
  // Arithmetic-only hypothetical contract input; it asserts no height about the retained Magnolia document.
  const input = content();
  input.statedBase = { valueM: 5, verticalReference: 'building_relative', citations: [citation] };
  input.levels[0] = { ...input.levels[0], heightSource: 'derived', statedHeightM: 4,
    verticalReference: 'building_relative' };
  const resolved = resolveScheduleHeights(input);
  assert.equal(resolved.levels[0].lowerM, 5);
  assert.equal(resolved.levels[0].upperM, 9);
  assert.equal(input.levels[0].lowerM, null);
});

test('a reviewed room association preserves plan-local placement; a foreign building level is refused', () => {
  const building = project(content());
  const room = magnolia.candidates[0];
  const attached = attachCandidateLevel(building, room, building.levels[0].levelId,
    'Officer checked the GROUND panel citation', actor, at);
  assert.equal(attached.state, 'reviewed');
  assert.deepEqual(attached.polygons, room.polygons);
  assert.equal(attached.planFrame?.placement, 'unknown');
  assert.throws(() => attachCandidateLevel(tower, room, building.levels[0].levelId,
    'Foreign level fixture', actor, at), /existing reviewed level/);
});

test('a replacement schedule cannot silently orphan a previously reviewed room association', () => {
  const input = content();
  const building = project(input);
  const room = attachCandidateLevel(building, building.candidates[0], building.levels[0].levelId,
    'Explicit fixture association', actor, at);
  building.candidates[0] = room;
  const proposal = LevelScheduleProposalSchema.parse({ proposalId: randomUUID(), buildingId: building.buildingId,
    recordRevision: 5, state: 'candidate', content: content(), actor, at });
  assert.throws(() => reviewedLevelSchedule(building, proposal, 'Replacement fixture', actor, at, 6), /orphan/);
});

test('candidate schedule proposals do not project levels before officer review', () => {
  const building = structuredClone(magnolia);
  const proposal = { proposalId: randomUUID(), buildingId: magnolia.buildingId, recordRevision: 3,
    state: 'candidate', content: content(), actor, at };
  applyLevelSchedules(building, [{ id: building.buildingId,
    levelScheduleProposals: [proposal] } as unknown as RegistryRecord]);
  assert.equal(building.levels.length, 0);
  assert.equal(building.levelScheduleProposals![0].state, 'candidate');
});
