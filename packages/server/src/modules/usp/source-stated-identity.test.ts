import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ProjectIdentityReviewSchema, ProjectLocationSchema, normalizeProjectCode,
  verticalLocator } from '@ulpin/contracts/usp';
import { SourceSpaceRequestSchema } from '@ulpin/contracts';
import { transaction } from '../../infrastructure/db';
import { fingerprint } from '../cases/domain';
import { commandSourceSpace } from '../officer/source-spaces';
import { projectCardFactsTx } from './packets/card-projection';
import { retainedTower, towerRequest } from '../officer/source-spaces.test-fixture';
import { finishBuilding, projectSourceRecordedChildren } from '../registry/canonical-building';
import { assertSourceChildRevisions, readSourceProjectCodes } from '../registry/canonical-source-identity';
import { assignProjectCode, prepareProjectIdentityReview, resolveProjectIdentity } from './project-identity';
import { captureRegistrySnapshot } from './snapshots';
import { control, errorCode, legacyNumberedLocation, location, prepare } from './source-stated-identity.test-fixture';

test('a source-stated assign review without location assigns and resolves an unqualified locator offline',
  async () => control(async f => {
    const { snapshot, command, review } = await prepare(f);
    const saved = f.memory.reviews.get(command.reviewId);
    assert(!Object.hasOwn(saved.body, 'location'));
    assert.deepEqual(saved.body, review);
    assert.equal(saved.command_hash, fingerprint(review));
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
    assert.equal(resolved.location, 'NO-ANCHOR / ? / L? / ?');
    assert.deepEqual(f.memory.identities.get(f.recorded.spaceId).location, location);
    assert.equal(verticalLocator(location as any), resolved.location);
    assert(f.memory.assertSourceIntegrity());
    await assertSourceChildRevisions(records, retainedTower.areaId);
  }));

test('unknown kinds may omit numbers; known kinds still need their own numbers and bounds', () => {
  assert.deepEqual(ProjectLocationSchema.parse(location), location);
  assert.deepEqual(ProjectLocationSchema.parse(legacyNumberedLocation), legacyNumberedLocation);
  for (const change of [{ structureKind: 'S' }, { spaceKind: 'R' }, { structureNumber: 0 }, { spaceNumber: 0 },
    { structureNumber: 100 }, { spaceNumber: 1000 }]) {
    const raw = { ...location, locator: { ...location.locator, ...change } };
    assert.equal(ProjectLocationSchema.safeParse(raw).success, false);
  }
  const known = ProjectLocationSchema.parse({ ...location, locator: { ...location.locator,
    structureKind: 'S', structureNumber: 1, spaceKind: 'R', spaceNumber: 1 } });
  assert.equal(verticalLocator(known), 'NO-ANCHOR / S01 / L? / R001');
});

test('a source-stated review that supplies either number is refused with 422 USP_SOURCE_IDENTITY',
  async () => control(async f => {
    const { review } = await prepare(f);
    const before = f.memory.reviews.size;
    for (const numbers of [{ structureNumber: 1 }, { spaceNumber: 1 }]) {
      await assert.rejects(prepareProjectIdentityReview(f.ctx, { ...review,
        location: { ...location, locator: { ...location.locator, ...numbers } },
      }), { status: 422, code: 'USP_SOURCE_IDENTITY' });
    }
    assert.equal(f.memory.reviews.size, before);
    await prepareProjectIdentityReview(f.ctx, { ...review, location });
    assert.equal(f.memory.reviews.size, before + 1);
  }));

test('an assign review of a record that is not source-stated still needs its location',
  async () => control(async f => {
    const { review } = await prepare(f);
    delete f.db.rows.find(row => row.id === f.recorded.spaceId).body.sourceOnly;
    const before = f.memory.reviews.size;
    await assert.rejects(prepareProjectIdentityReview(f.ctx, review),
      { status: 422, code: 'unsupported_lineage_kind' });
    assert.equal(f.memory.reviews.size, before);
  }));

test('stored numbered source-only review, state and snapshot resolve and project the legacy card line unchanged',
  async () => control(async f => {
    const { review, command } = await prepare(f);
    await assignProjectCode(f.ctx, command);
    // Model rows written by the pre-K11 writer, not a new numbered review command.
    const saved = f.memory.reviews.get(command.reviewId);
    saved.body = { ...review, location: legacyNumberedLocation };
    saved.command_hash = fingerprint(saved.body);
    const heldHash = saved.command_hash;
    assert.equal(fingerprint(ProjectIdentityReviewSchema.parse(saved.body)), heldHash);
    f.memory.identities.get(f.recorded.spaceId).location = structuredClone(legacyNumberedLocation);
    const snapshot = await f.capture();
    const code = f.memory.codes.get(f.recorded.spaceId).code;
    const resolved = await resolveProjectIdentity(f.ctx, { scope: snapshot.scope, identifier: code });
    assert.equal(resolved.location, 'NO-ANCHOR / ?01 / L? / ?001');
    const member = snapshot.members.find(member => member.pin.ref.id === f.recorded.spaceId)!;
    const plan = { input: { scope: snapshot.scope, target: member.pin, format: 'pdf' }, entries: [],
      targetBodySha256: member.bodySha256, targetLabel: f.request.space.label };
    const { facts } = await transaction(client => projectCardFactsTx(client, f.ctx, plan as any));
    assert.equal(facts.find(fact => fact.key === 'vertical_locator')?.value, resolved.location);
    assert.equal(saved.command_hash, heldHash);
    assert.deepEqual(f.memory.identities.get(f.recorded.spaceId).location, legacyNumberedLocation);
  }));

test('a stored numbered assignment receipt replays unchanged without rewriting its review or snapshot',
  async () => control(async f => {
    const { review, command } = await prepare(f);
    const receipt = await assignProjectCode(f.ctx, command);
    const saved = f.memory.reviews.get(command.reviewId);
    saved.body = { ...review, location: legacyNumberedLocation };
    saved.command_hash = fingerprint(saved.body);
    f.memory.identities.get(f.recorded.spaceId).location = structuredClone(legacyNumberedLocation);
    const legacySnapshot = await f.capture();
    f.memory.receipts.get(command.requestKey).body = { ...receipt, snapshot: legacySnapshot.scope };
    const stored = structuredClone(f.memory.receipts.get(command.requestKey).body);
    const snapshotCount = f.memory.snapshots.size;
    assert.deepEqual(await assignProjectCode(f.ctx, command), stored);
    assert.equal(f.memory.snapshots.size, snapshotCount);
    assert.equal(saved.command_hash, fingerprint(saved.body));
  }));

test('two source-stated units of one building receive different codes at the same unqualified location',
  async () => control(async f => {
    // Both literals are in the retained K4a inventory's same broad drawing region; no boundary is asserted.
    const request = SourceSpaceRequestSchema.parse({ ...towerRequest, requestKey: randomUUID(),
      expectedCanonicalRevision: f.db.building.revisionId,
      space: { label: 'UNIT-3A', evidence: { ...towerRequest.space.evidence, literal: 'UNIT-3A' } } });
    const other = await commandSourceSpace(retainedTower.buildingId, request, f.db.deps);
    assert.equal(other.floorId, f.recorded.floorId);
    const first = await assignProjectCode(f.ctx, (await prepare(f)).command);
    const capture = () => captureRegistrySnapshot(f.ctx, retainedTower.areaId, { kind: 'targets', pins: [{
      ref: { namespace: 'registry_record', id: other.spaceId }, revision: 1,
    }] });
    const secondFixture = { ...f, recorded: other, request, capture };
    const second = await assignProjectCode(f.ctx, (await prepare(secondFixture)).command);
    assert('outcome' in first);
    assert('outcome' in second);
    assert.notEqual((first.outcome as any).codes[f.recorded.spaceId], (second.outcome as any).codes[other.spaceId]);
    assert.deepEqual(f.memory.identities.get(f.recorded.spaceId).location,
      f.memory.identities.get(other.spaceId).location);
    assert.equal(f.memory.codes.size, 2);
    assert(f.memory.assertSourceIntegrity());
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
    await assert.rejects(prepareProjectIdentityReview(f.ctx, { ...review, location, locations: {
      [f.recorded.spaceId]: { ...location, locator: { ...location.locator, levels: ['F02'] } },
    } } as any), errorCode('USP_SOURCE_IDENTITY'));
    await assert.rejects(prepareProjectIdentityReview(f.ctx, { ...review, location, locations: {
      [f.recorded.spaceId]: legacyNumberedLocation,
    } }), { status: 422, code: 'USP_SOURCE_IDENTITY' });
    assert.equal(f.memory.reviews.size, before);
    await prepareProjectIdentityReview(f.ctx, { ...review, location,
      locations: { [f.recorded.spaceId]: location } });
    assert.equal(f.memory.reviews.size, before + 1);
  }));

test('literal 2ND caption never authorizes F02 or an anchor; generic snapshots remain extraction-gated',
  async () => control(async f => {
    const { review } = await prepare(f);
    const guessed = { ...review, location: { ...location, locator: { ...location.locator, levels: ['F02'] } } };
    await assert.rejects(prepareProjectIdentityReview(f.ctx, guessed as any), errorCode('USP_SOURCE_IDENTITY'));
    const utility = { ...review, location: { ...location,
      locator: { ...location.locator, spaceKind: 'U', spaceNumber: 1 } } };
    await assert.rejects(prepareProjectIdentityReview(f.ctx, utility as any), errorCode('USP_SOURCE_IDENTITY'));
    await assert.rejects(captureRegistrySnapshot(f.ctx, retainedTower.areaId, { kind: 'site' }),
      errorCode('DOCUMENT_STAGE_UNAVAILABLE'));
    const candidate = { ...review, recordIds: [randomUUID()] };
    await assert.rejects(prepareProjectIdentityReview(f.ctx, candidate as any));
    assert.equal(f.memory.codes.size, 0);
  }));
