import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NormalizedBuildingSchema, SourceSpaceRequestSchema, SourceStatedRecordSchema } from '@ulpin/contracts';
import { recordBodySchema } from '../registry/registry';
import { commandSourceSpace, sourceScheduleLevel } from './source-spaces';
import { SourceSpaceControl, towerRequest, retainedTower } from './source-spaces.test-fixture';

process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'k4b-offline-protocol-control';
const errorCode = (code: string) => (error: any) => error.code === code;
const next = (db: SourceSpaceControl) => ({ ...structuredClone(towerRequest), requestKey: randomUUID(),
  expectedCanonicalRevision: db.building.revisionId });

test('source-only floor and unit carry no geometry, height, area, inferred use, parcel or rights', async () => {
  const db = new SourceSpaceControl();
  const receipt = await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  for (const row of db.rows.slice(1)) {
    const body = SourceStatedRecordSchema.parse(row.body);
    assert.deepEqual(body.footprint, []);
    assert.deepEqual(body.rights, []);
    assert.equal(body.placement, 'unknown');
    assert.equal(body.classification, 'test_only');
    assert.equal(body.synthetic, false);
    for (const field of ['geometry', 'height', 'area', 'lower', 'upper', 'use', 'officialUlpin']) {
      assert(!Object.hasOwn(body, field));
      assert(!SourceStatedRecordSchema.safeParse({ ...body, [field]: 0 }).success);
    }
    assert.equal(body.revision, 1);
    assert(db.histories.some(history => history.id === row.id && history.revision === 1));
  }
  assert.equal(receipt.recordRevision, 5);
});

test('labels remain exact officer transcriptions, never integers or inferred grouping', async () => {
  const db = new SourceSpaceControl();
  await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  assert.equal(db.rows[1].body.name, '2ND FLOOR PLAN');
  assert.equal(db.rows[2].body.name, 'UNIT-3B');
  assert.equal(db.rows[2].body.sourceOnly.transcription, 'officer_entered');
  assert.deepEqual(db.rows[2].body.sourceOnly.evidence.region, towerRequest.space.evidence.region);
  assert.equal(db.rows[2].body.sourceOnly.decision.reason, towerRequest.reason);
  const input = structuredClone(towerRequest);
  input.level.label = '2';
  assert(!SourceSpaceRequestSchema.safeParse(input).success);
});

test('missing current originals, source revisions, pages or in-page regions refuse before any recording', async () => {
  const db = new SourceSpaceControl();
  db.sourceAttached = false;
  await assert.rejects(commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps),
    errorCode('SOURCE_SPACE_EVIDENCE'));
  db.sourceAttached = true;
  db.sourceRevision = 2;
  await assert.rejects(commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps),
    errorCode('SOURCE_SPACE_EVIDENCE'));
  db.sourceRevision = 1;
  const page = structuredClone(towerRequest);
  page.space.evidence.page = 2;
  await assert.rejects(commandSourceSpace(retainedTower.buildingId, page, db.deps), errorCode('SOURCE_SPACE_REGION'));
  const outside = structuredClone(towerRequest);
  outside.space.evidence.region[2] = 3000;
  await assert.rejects(commandSourceSpace(retainedTower.buildingId, outside, db.deps), errorCode('SOURCE_SPACE_REGION'));
  assert.equal(db.rows.length, 1);
});

test('one reasoned local officer decision is exact-key idempotent, stale-safe and duplicate-label refusing', async () => {
  const db = new SourceSpaceControl();
  const receipt = await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  assert.deepEqual(await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps), receipt);
  await assert.rejects(commandSourceSpace(retainedTower.buildingId, { ...towerRequest, reason: 'Different reason' },
    db.deps), errorCode('SOURCE_SPACE_KEY'));
  await assert.rejects(commandSourceSpace(retainedTower.buildingId, { ...towerRequest, requestKey: randomUUID() },
    db.deps), errorCode('SOURCE_SPACE_STALE'));
  await assert.rejects(commandSourceSpace(retainedTower.buildingId, next(db), db.deps),
    errorCode('SOURCE_SPACE_DUPLICATE'));
  assert.equal(db.rows.length, 3);
  assert.equal(db.histories.length, 3);
});

test('same-site exact floor and building parents are retained; same source caption reuses the floor', async () => {
  const db = new SourceSpaceControl();
  const first = await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  const input = next(db);
  // Existing UNIT-3A label on this same retained sheet, not a fabricated second real unit.
  input.space.label = input.space.evidence.literal = 'UNIT-3A';
  const second = await commandSourceSpace(retainedTower.buildingId, input, db.deps);
  assert.equal(first.floorId, second.floorId);
  assert.equal(second.floorCreated, false);
  assert.equal(db.rows.filter(row => row.kind === 'floor').length, 1);
  assert(db.rows.every(row => row.site_id === retainedTower.areaId));
  assert.deepEqual(db.rows[1].body.links, [{ type: 'within', targetId: retainedTower.buildingId }]);
  assert.deepEqual(db.rows[2].body.links, [{ type: 'floor', targetId: first.floorId }]);
});

test('a literal floor preserves the reviewed storey conflict and does not derive a count or schedule', async () => {
  const db = new SourceSpaceControl();
  const before = structuredClone(db.rows[0].body.canonicalLevelSchedules);
  const receipt = await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  assert.equal(receipt.scheduleLevelId, null);
  assert.deepEqual(db.rows[0].body.canonicalLevelSchedules, before);
  assert.equal(db.rows[0].body.canonicalLevelSchedules[0].state, 'conflicting');
  assert.equal(db.building.storeyCount.value, null);
});

test('only an exact reviewed Magnolia caption supplies a schedule-level association', () => {
  const magnolia = NormalizedBuildingSchema.parse(JSON.parse(readFileSync(
    'docs/evidence/gf-t16/k3b/magnolia-after-current.json', 'utf8',
  )));
  assert.equal(sourceScheduleLevel(magnolia, 'GROUND FLOOR PLAN'), magnolia.levels[0].levelId);
  assert.equal(sourceScheduleLevel(magnolia, 'GROUND'), null);
  assert.equal(sourceScheduleLevel(retainedTower, '2ND FLOOR PLAN'), null);
});

test('generic registry validators remain closed to source-only floors and units', async () => {
  const db = new SourceSpaceControl();
  await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  assert(db.rows.slice(1).every(row => !recordBodySchema.safeParse(row.body).success));
  const previous = process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  delete process.env.ULPIN_LOCAL_OPERATOR_SUBJECT;
  try { await assert.rejects(commandSourceSpace(retainedTower.buildingId, next(db), db.deps),
    errorCode('LOCAL_OPERATOR_CONFIGURATION')); }
  finally { process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = previous; }
});

test('source command never allocates a P3 code or records candidates as identity targets', async () => {
  const db = new SourceSpaceControl();
  await commandSourceSpace(retainedTower.buildingId, towerRequest, db.deps);
  assert(!db.queries.some(query => query.includes('usp_project_code')));
  assert(db.rows.slice(1).every(row => !Object.hasOwn(row.body, 'projectIdentity')));
  assert(!SourceSpaceRequestSchema.safeParse({ ...towerRequest, candidateId: 'not-an-identity' }).success);
});
