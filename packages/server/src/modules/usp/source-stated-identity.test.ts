import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { normalizeProjectCode, verticalLocator } from '@ulpin/contracts/usp';
import { retainedTower, towerRequest } from '../officer/source-spaces.test-fixture';
import { finishBuilding, projectSourceRecordedChildren } from '../registry/canonical-building';
import { assertSourceChildRevisions, readSourceProjectCodes } from '../registry/canonical-source-identity';
import { assignProjectCode, prepareProjectIdentityReview, resolveProjectIdentity } from './project-identity';
import { captureRegistrySnapshot } from './snapshots';
import { control, errorCode, location, prepare } from './source-stated-identity.test-fixture';

test('real Tower labels traverse source-record → exact snapshot → P3 review/assign → canonical read-back offline',
  async () => control(async f => {
    const { snapshot, command } = await prepare(f);
    assert(snapshot.members.some(member => member.pin.ref.id === f.recorded.floorId));
    assert(snapshot.members.some(member => member.pin.ref.id === retainedTower.buildingId));
    const receipt = await assignProjectCode(f.ctx, command);
    assert('outcome' in receipt);
    const code = (receipt.outcome as any).codes[f.recorded.spaceId];
    assert.equal(normalizeProjectCode(code), code);
    assert.equal(receipt.after[0].revision, 2);
    assert.equal(f.memory.audit.length, 1);
    assert.equal(f.memory.sequence, 1);
    const records = f.db.rows.map(row => ({ ...row.body, revision: row.revision }));
    const codes = await readSourceProjectCodes(records, retainedTower.areaId);
    const building = structuredClone(retainedTower);
    projectSourceRecordedChildren(building, records, codes);
    const space = finishBuilding(building).levels[0].spaces[0];
    assert.equal(space.proposedCode.value, code);
    assert.equal(space.proposedCode.state, 'reviewed');
    assert.equal(space.polygons.value, null);
    assert.equal(space.lowerM.value, null);
    assert.equal(building.levelSchedule?.state, 'conflicting');
    const resolved = await resolveProjectIdentity(f.ctx, { scope: receipt.snapshot, identifier: code });
    assert.equal(resolved.projectCode, code);
    assert.equal(resolved.location, 'NO-ANCHOR / ?01 / L? / ?001');
    assert.equal(verticalLocator(location as any), resolved.location);
    assert(f.memory.assertSourceIntegrity());
    await assertSourceChildRevisions(records, retainedTower.areaId);
  }));

test('source-stated P3 preserves replay integrity, source privacy and stale/current-child guards',
  async () => control(async f => {
    const { command } = await prepare(f);
    const receipt = await assignProjectCode(f.ctx, command);
    assert.deepEqual(await assignProjectCode(f.ctx, command), receipt);
    await assert.rejects(assignProjectCode(f.ctx, { ...command, reviewId: randomUUID() }), errorCode('STALE_REVISION'));
    assert.equal(f.memory.audit.length, 1);
    const records = f.db.rows.map(row => ({ ...row.body, revision: row.revision }));
    f.db.rows.find(row => row.id === f.recorded.spaceId).revision++;
    await assert.rejects(assertSourceChildRevisions(records, retainedTower.areaId),
      errorCode('CANONICAL_CURRENT_ONLY'));
    f.memory.archived = true;
    await assert.rejects(assignProjectCode(f.ctx, command), errorCode('DOCUMENT_DENIED'));
    assert.equal(f.memory.audit.length, 1);
  }));

test('P3 assignment rollback never leaves a code, revision, consumed review or audit after a write fault',
  async () => control(async f => {
    const { command } = await prepare(f);
    await assert.rejects(assignProjectCode(f.ctx, command, undefined, async () => {
      throw new Error('Bounded protocol rollback fault');
    }), /rollback fault/);
    assert.equal(f.memory.codes.size, 0);
    assert.equal(f.memory.audit.length, 0);
    assert.equal(f.db.rows.find(row => row.id === f.recorded.spaceId).revision, 1);
    assert(!f.memory.reviews.get(command.reviewId).consumed_at);
  }));

test('source-only identity guards pin hash, review subject and source currentness exactly',
  async () => control(async f => {
    const { command } = await prepare(f);
    const saved = f.memory.reviews.get(command.reviewId);
    saved.reviewer_subject = 'another-officer';
    await assert.rejects(assignProjectCode(f.ctx, command), errorCode('STALE_REVISION'));
    f.memory.reviews.get(command.reviewId).reviewer_subject = f.ctx.principal.subject;
    f.memory.sources.find(source => source.id === towerRequest.space.evidence.sourceId).revision = 2;
    await assert.rejects(assignProjectCode(f.ctx, command), errorCode('SOURCE_SPACE_SNAPSHOT'));
    assert.equal(f.memory.codes.size, 0);
  }));

test('exact source P3 stays unknown until assigned; corruption or later identity version drift refuses projection',
  async () => control(async f => {
    const records = f.db.rows.map(row => ({ ...row.body, revision: row.revision }));
    assert.equal((await readSourceProjectCodes(records, retainedTower.areaId)).size, 0);
    const { command } = await prepare(f);
    await assignProjectCode(f.ctx, command);
    const current = f.db.rows.map(row => ({ ...row.body, revision: row.revision }));
    const code = f.memory.codes.get(f.recorded.spaceId);
    const assigned = code.code;
    code.code = 'P3-not-an-assigned-check-symbol';
    await assert.rejects(readSourceProjectCodes(current, retainedTower.areaId), errorCode('CANONICAL_PROJECT_CODE'));
    code.code = assigned;
    f.memory.identities.get(f.recorded.spaceId).version++;
    await assert.rejects(readSourceProjectCodes(current, retainedTower.areaId), errorCode('CANONICAL_CURRENT_ONLY'));
  }));

test('source-only singular location refuses a known level before recording an identity review',
  async () => control(async f => {
    const { review } = await prepare(f);
    const before = f.memory.reviews.size;
    await assert.rejects(prepareProjectIdentityReview(f.ctx, { ...review, location: {
      ...location, locator: { ...location.locator, levels: ['F02'] },
    } } as any), errorCode('USP_SOURCE_IDENTITY'));
    assert.equal(f.memory.reviews.size, before);
  }));

test('source-only per-record locations cannot bypass the unknown-location guard with a valid singular location',
  async () => control(async f => {
    const { review } = await prepare(f);
    const before = f.memory.reviews.size;
    await assert.rejects(prepareProjectIdentityReview(f.ctx, { ...review, locations: {
      [f.recorded.spaceId]: { ...location, locator: { ...location.locator, levels: ['F02'] } },
    } } as any), errorCode('USP_SOURCE_IDENTITY'));
    assert.equal(f.memory.reviews.size, before);
    await prepareProjectIdentityReview(f.ctx, { ...review, locations: { [f.recorded.spaceId]: location } } as any);
    assert.equal(f.memory.reviews.size, before + 1);
  }));

test('literal 2ND caption never authorizes F02 or an anchor; generic snapshots remain extraction-gated',
  async () => control(async f => {
    const { review } = await prepare(f);
    const guessed = { ...review, location: { ...location, locator: { ...location.locator, levels: ['F02'] } } };
    await assert.rejects(prepareProjectIdentityReview(f.ctx, guessed as any), errorCode('USP_SOURCE_IDENTITY'));
    const utility = { ...review, location: { ...location, locator: { ...location.locator, spaceKind: 'U' } } };
    await assert.rejects(prepareProjectIdentityReview(f.ctx, utility as any), errorCode('USP_SOURCE_IDENTITY'));
    await assert.rejects(captureRegistrySnapshot(f.ctx, retainedTower.areaId, { kind: 'site' }),
      errorCode('DOCUMENT_STAGE_UNAVAILABLE'));
    const candidate = { ...review, recordIds: [randomUUID()] };
    await assert.rejects(prepareProjectIdentityReview(f.ctx, candidate as any));
    assert.equal(f.memory.codes.size, 0);
  }));
