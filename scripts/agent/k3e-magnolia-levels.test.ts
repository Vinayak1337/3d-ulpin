import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NormalizedBuildingSchema, type BuildingCitation } from '../../packages/contracts/src/index';
import {
  BUILDING_PATH, citationsArePinned, inchesOf, metresOf, project, readCitations, readTextLayer, reviewInDryRun,
  reviewReason, scheduleContent, verifyLiterals, VERTICAL_REFERENCE, type Citations,
} from './k3e-magnolia-levels';

const citations = readCitations();
const building = NormalizedBuildingSchema.parse(JSON.parse(readFileSync(BUILDING_PATH, 'utf8')));
const [ground, first, second] = citations.levels.map(pin => pin.levelId);
const sheetMissing = !existsSync(citations.source.path);

function changed(key: string, update: Partial<Citations['literals'][string]>): Citations {
  const copy = structuredClone(citations);
  copy.literals[key] = { ...copy.literals[key], ...update };
  return copy;
}

function regionTop(citation: BuildingCitation): number | null {
  return citation.locator.kind === 'region' ? citation.locator.y : null;
}

test('the four level and interval forms of the sheet convert by the code-owned inch factor', () => {
  const forms = [['FFL ±00', 0, 0], ['FFL +1\'6"', 18, 0.4572], ['FFL +32\'6"', 390, 9.906],
    ['10\'-7"', 127, 3.2258], ['10\'', 120, 3.048]] as const;
  for (const [literal, inches, metres] of forms) {
    assert.equal(inchesOf(literal), inches);
    assert.equal(metresOf(inches), metres);
  }
  assert.throws(() => inchesOf('FFL +1\'12"'), /out of range/);
  assert.throws(() => inchesOf('+10.500'), /Not a level/);
});

test('every cited literal reads back from the text layer; a changed character or box refuses', {
  skip: sheetMissing && 'retained original not on this machine',
}, () => {
  const lines = readTextLayer(citations);
  verifyLiterals(citations, lines);
  assert.throws(() => verifyLiterals(changed('fflRoof', { expected: 'FFL +32\'8"' }), lines), /fflRoof reads/);
  const [x0, y0, x1, y1] = citations.literals.arrowSecond.box;
  assert.throws(() => verifyLiterals(changed('arrowSecond', { box: [x0, y0 + 1, x1, y1] }), lines), /No text-layer/);
});

test('stated levels project as reviewed drawing-local limits that wait for a reviewed footprint', async () => {
  const content = scheduleContent(citations, building);
  const projected = project(building, await reviewInDryRun(building, content, reviewReason(citations, content)));
  assert(citationsArePinned(building, content));
  const levels = new Map(projected.levels.map(level => [level.levelId, level]));
  assert.deepEqual([...levels.keys()], building.levels.map(level => level.levelId));
  assert.deepEqual([levels.get(ground)!.lowerM.value, levels.get(ground)!.upperM.value], [0.4572, 3.5052]);
  assert.deepEqual([levels.get(first)!.lowerM.value, levels.get(first)!.upperM.value], [3.5052, 6.731]);
  for (const id of [ground, first]) {
    assert.equal(levels.get(id)!.upperM.state, 'reviewed');
    assert.equal(levels.get(id)!.prismAssessment?.reason, 'reviewed_footprint_unavailable');
    assert.equal(content.levels.find(row => row.levelId === id)!.verticalReference, VERTICAL_REFERENCE);
  }
  assert.deepEqual(levels.get(ground)!.roomCandidateIds, building.levels[0].roomCandidateIds);
  assert.equal(levels.get(second)!.prismAssessment?.reason, 'level_limits_unknown');
});

test('SECOND keeps both limits unknown and cites both finished floor levels and the disagreeing arrow', async () => {
  const content = scheduleContent(citations, building);
  const row = content.levels.find(level => level.levelId === second)!;
  assert.deepEqual([row.heightSource, row.lowerM, row.upperM], ['unknown', null, null]);
  const tops = row.citations.map(regionTop);
  for (const key of ['fflSecond', 'fflRoof', 'arrowSecond']) assert(tops.includes(citations.literals[key].box[1]));
  const projected = project(building, await reviewInDryRun(building, content, reviewReason(citations, content)));
  const level = projected.levels.find(entry => entry.levelId === second)!;
  assert.notEqual(level.upperM.state, 'reviewed');
  assert.equal(level.upperM.value, null);
  assert.match(reviewReason(citations, content), /give 10'5" while the printed arrow says 10'-7"/);
});
