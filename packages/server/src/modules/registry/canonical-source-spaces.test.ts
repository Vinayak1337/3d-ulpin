import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NormalizedBuildingSchema, sourceSpaceStatementLocator } from '@ulpin/contracts';
import { commandSourceSpace } from '../officer/source-spaces';
import { retainedTower, SourceSpaceControl, towerRequest } from '../officer/source-spaces.test-fixture';
import { collectCanonicalCitationPins, finishBuilding, projectSourceRecordedChildren } from './canonical-building';
import { applyLevelSchedules } from './canonical-level-schedule';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k4b-offline-protocol-control';
const bodies = (db: SourceSpaceControl) => db.rows.map(row => row.body);

test('recorded UNIT-3B and literal 2ND caption project with unknown dimensions and exact source citation', async () => {
  const db = new SourceSpaceControl();
  const receipt = await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  const building = structuredClone(retainedTower);
  const schedule = structuredClone(building.levelSchedule);
  const conflicts = structuredClone(building.conflicts);
  projectSourceRecordedChildren(building, bodies(db));
  assert.deepEqual(building.levelSchedule, schedule);
  assert.deepEqual(building.conflicts, conflicts);
  const parsed = finishBuilding(building);
  assert.equal(parsed.levels.length, 1);
  const level = parsed.levels[0];
  assert.equal(level.registryFloorId, receipt.floorId);
  assert.equal(level.label.value, '2ND FLOOR PLAN');
  assert.equal(level.spaces[0].spaceId, receipt.spaceId);
  assert.equal(level.spaces[0].label?.value, 'UNIT-3B');
  for (const value of [level.lowerM, level.upperM, level.spaces[0].lowerM, level.spaces[0].upperM,
    level.spaces[0].areaM2, level.spaces[0].kind, level.spaces[0].proposedCode]) assert.equal(value?.value, null);
  assert.equal(level.polygons?.state, 'absent');
  assert.equal(level.spaces[0].polygons.state, 'absent');
  assert.equal(parsed.storeyCount.value, null);
  assert.equal(parsed.footprint.value, null);
  assert.equal(parsed.heightM.value, null);
  const citation = level.spaces[0].label?.citations[0];
  assert.equal(citation?.sourceId, towerRequest.space.evidence.sourceId);
  assert.equal(citation?.sourceRevision, 1);
  assert.equal(citation?.locator.kind, 'region');
  assert(collectCanonicalCitationPins(parsed).has(towerRequest.space.evidence.sourceId));
});

test('buildings without recorded children keep byte-identical canonical output', () => {
  const building = structuredClone(retainedTower);
  const before = JSON.stringify(building);
  projectSourceRecordedChildren(building, []);
  assert.equal(JSON.stringify(building), before);
});

test('reviewed caption mapping preserves spaces and does not create a storey', async () => {
  const db = new SourceSpaceControl();
  await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  const building = NormalizedBuildingSchema.parse(JSON.parse(readFileSync(
    'docs/evidence/gf-t16/k3b/magnolia-after-current.json', 'utf8',
  )));
  const records = bodies(db);
  const ground = building.levels[0];
  records[0].id = building.buildingId;
  records[0].canonicalLevelSchedules = [structuredClone(building.levelSchedule)];
  for (const child of records.slice(1)) {
    child.sourceOnly.buildingId = building.buildingId;
    child.sourceOnly.scheduleLevelId = ground.levelId;
  }
  records[1].sourceOnly.parentId = building.buildingId;
  records[1].links[0].targetId = building.buildingId;
  records[1].name = records[1].alias = records[1].sourceOnly.evidence.literal = 'GROUND FLOOR PLAN';
  records[1].evidence[0].locator = sourceSpaceStatementLocator(records[1].sourceOnly.evidence);
  // Protocol control of the exact reviewed caption mapping, not adoption of Tower evidence as Magnolia truth.
  applyLevelSchedules(building, records);
  const storeys = structuredClone(building.storeys);
  projectSourceRecordedChildren(building, records);
  assert.equal(building.levels.length, 3);
  assert.equal(building.levels[0].spaces.length, 1);
  assert.deepEqual(building.storeys, storeys);
});

test('cross-site and orphaned source-only children are refused rather than silently projected', async () => {
  const db = new SourceSpaceControl();
  await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  const records = bodies(db);
  records[2].siteId = '9bdbd95e-7280-4472-bfe4-3803d0a39ee1';
  assert.throws(() => projectSourceRecordedChildren(structuredClone(retainedTower), records),
    (error: any) => error.code === 'CANONICAL_SOURCE_PARENT');
  records[2].siteId = records[0].siteId;
  assert.throws(() => projectSourceRecordedChildren(structuredClone(retainedTower), [records[0], records[2]]),
    (error: any) => error.code === 'CANONICAL_SOURCE_PARENT');
});
