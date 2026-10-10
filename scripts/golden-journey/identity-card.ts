import assert from 'node:assert/strict';
import { UspBuildingSnapshotListSchema } from '../../packages/contracts/src/usp/domain';
import { UspPropertyCardListSchema, UspPropertyCardVerificationSchema,
  type PropertyCardList } from '../../packages/contracts/src/usp/property-card';
import { live } from './inputs';
import { building, type Context } from './context';
import { check, object, ok, POST_READS, type Outcome, type Read, type Step, type State } from './read';

type Scopes = ReturnType<typeof UspBuildingSnapshotListSchema.parse>;
type Scope = Scopes['items'][number]['scope'];
type CardRow = PropertyCardList['items'][number];
const snapshotsRoute = '/api/v1/buildings/{buildingId}/snapshots';
const verificationRoute = '/api/v1/usp/property-cards/{cardId}/revisions/{revision}/verification';

function data(read: Read, scope?: Scope): unknown {
  const envelope = object(ok(read));
  if (scope) assert.deepEqual(object(envelope.meta).scope, scope, 'Response changed the answering snapshot scope');
  return envelope.data;
}

async function snapshots(context: Context): Promise<Scopes | Outcome> {
  const read = await context.reader.get(snapshotsRoute, { buildingId: live.target.buildingId }, { limit: 20 });
  if (read.status === 404) {
    const envelope = object(read.body);
    const details = envelope.error ? object(envelope.error) : envelope;
    if (typeof details.message === 'string' && details.message.includes('Cannot GET')) {
      return { state: 'skipped', observed: { status: 404, code: read.code, fixTask: 'R4',
        missing: 'Snapshot listing route not served; R4 rollout required' } };
    }
  }
  const page = UspBuildingSnapshotListSchema.parse(ok(read));
  assert.equal(page.buildingId, live.target.buildingId);
  for (let index = 1; index < page.items.length; index++) {
    assert(Date.parse(page.items[index - 1].createdAt) >= Date.parse(page.items[index].createdAt),
      'Snapshot listing is not newest first');
  }
  return page;
}

async function unit(context: Context) {
  const canonical = await building(context, live.target.buildingId);
  const space = canonical.levels.flatMap(level => level.spaces).find(space => space.spaceId === live.target.spaceId);
  assert(space, 'Recorded unit absent');
  const pin = canonical.inputRevisions.find(pin => pin.namespace === 'registry_record' && pin.id === space.spaceId);
  assert(pin && pin.revision > 0, 'Canonical unit version unavailable');
  return { space, version: pin.revision };
}

export async function identity(context: Context): Promise<Step> {
  return check(context.reader, 'identity', 'Exact snapshot identity matches canonical unit', 'J1b/P5.5',
    'Newest answering scope resolves the reviewed code, record and canonical version', async () => {
      if (POST_READS.find(entry => entry.name === 'identityResolve')?.writes !== false) {
        return { state: 'blocked', observed: { fixTask: 'P5.5', reason: 'Resolver is not proven write-free' } };
      }
      const page = await snapshots(context);
      if (!('items' in page)) return page;
      return resolveUnit(context, page);
    });
}

async function resolveUnit(context: Context, page: Scopes): Promise<Outcome> {
  const { space, version } = await unit(context);
  assert.equal(space.proposedCode.state, 'reviewed', 'Identity is not reviewed');
  assert.equal(space.proposedCode.value, live.assign.code, 'Canonical code differs from committed R3 receipt');
  assert.equal(version, live.resolve.recordVersion, 'Canonical unit version differs from committed R3 receipt');
  const attempts = [];
  for (const [index, item] of page.items.entries()) {
    const read = await context.reader.postRead('/api/v1/usp/identity/resolve',
      { scope: item.scope, identifier: space.proposedCode.value });
    attempts.push({ scope: item.scope, status: read.status, code: read.code });
    if (read.status === 409 && read.code === 'USP_IDENTITY_UNAVAILABLE_IN_SNAPSHOT') continue;
    if (read.status === 403 && read.code === 'USP_IDENTITY_SCOPE') continue;
    const resolved = object(data(read, item.scope));
    const matches = resolved.recordId === space.spaceId && resolved.projectCode === space.proposedCode.value
      && resolved.recordVersion === version && resolved.status === 'assigned' && resolved.profile === 'P3/1';
    return { state: matches ? 'pass' : 'fail', observed: { canonical: { recordId: space.spaceId,
      code: space.proposedCode.value, state: space.proposedCode.state, version }, resolved,
      answeringScope: item.scope, scopeIndex: index, fallbackToOlderScope: index > 0, attempts,
      truncated: page.truncated, unreadable: page.unreadable } };
  }
  return { state: 'fail', observed: { reason: 'No listed snapshot resolves the canonical unit', attempts,
    truncated: page.truncated, unreadable: page.unreadable, fixTask: 'P5.5' } };
}

export async function card(context: Context): Promise<Step> {
  return check(context.reader, 'card', 'Discover and verify every listed unit card', 'J1b/K7/K8',
    'Cards present; list and exact verification consistent; all checks pass; no revoked or expired revision',
    async () => {
      const page = await snapshots(context);
      if (!('items' in page)) return page;
      return discoverCards(context, page);
    });
}

async function discoverCards(context: Context, page: Scopes): Promise<Outcome> {
  const attempts = [];
  for (const [index, item] of page.items.entries()) {
    const read = await context.reader.postRead('/api/v1/usp/property-cards/list',
      { scope: item.scope, target: { namespace: 'registry_record', id: live.target.spaceId }, limit: 50 });
    attempts.push({ scope: item.scope, status: read.status, code: read.code });
    // A listed manifest can still refuse document access. Keep each refusal and disclose any older fallback.
    if ([403, 404, 409, 422].includes(read.status)) continue;
    const cards = UspPropertyCardListSchema.parse(data(read, item.scope));
    if (!cards.items.length) continue;
    const result = await verifyCards(context, cards);
    return { state: result.state, observed: { ...result.observed, answeringScope: item.scope,
      scopeIndex: index, fallbackToOlderScope: index > 0, attempts,
      snapshotListTruncated: page.truncated, unreadable: page.unreadable } };
  }
  return { state: 'fail', observed: { reason: 'No cards discovered for the recorded unit', attempts,
    snapshotListTruncated: page.truncated, unreadable: page.unreadable, fixTask: 'K7/P7' } };
}

async function verifyCards(context: Context, cards: PropertyCardList) {
  const { version } = await unit(context);
  const observations = [];
  let failed = cards.truncated;
  let expired = false;
  for (const row of cards.items) {
    const result = await verifyCard(context, row, version);
    observations.push(result.observed);
    failed ||= result.state === 'fail';
    expired ||= row.expired === true;
  }
  const expectedCardPresent = cards.items.some(row => row.cardId === live.card.cardId
    && row.revision === live.card.revision);
  failed ||= !expectedCardPresent;
  let state: State = 'pass';
  if (expired) state = 'blocked';
  if (failed) state = 'fail';
  return { state, observed: { cards: observations, truncated: cards.truncated, expectedCardPresent, expired,
      expiresAt: cards.items.map(row => row.expiresAt),
      ...(expired ? { next: 'A write-mode officer action must append a new card revision', fixTask: 'P7' } : {}) } };
}

async function verifyCard(context: Context, row: CardRow, version: number): Promise<Outcome> {
  let read: Read | undefined;
  try {
    read = await context.reader.get(verificationRoute, { cardId: row.cardId, revision: row.revision });
    const report = UspPropertyCardVerificationSchema.parse(data(read));
    assert.equal(report.cardId, row.cardId);
    assert.equal(report.revision, row.revision);
    assert.equal(row.integrity, 'consistent', 'Listed card is inconsistent');
    assert.equal(report.result, 'consistent', 'Verification is inconsistent');
    assert(report.checks.every(check => check.state === 'pass'), 'Not all verification checks passed');
    assert.deepEqual([row.latestRevision, row.superseded, row.expiresAt, row.expired, row.revoked, row.revokedAt],
      [report.lifecycle.latestRevision, report.lifecycle.superseded, report.lifecycle.expiresAt,
        report.lifecycle.expired, report.lifecycle.revocation !== null, report.lifecycle.revocation?.revokedAt ?? null],
      'Listing and verification lifecycle differ');
    assert.deepEqual([row.targetRevision, row.currentTargetRevision, row.snapshotState],
      [report.snapshot.cardTargetRevision, report.snapshot.currentTargetRevision, report.snapshot.state],
      'Listing and verification snapshot differ');
    assert.equal(row.currentTargetRevision, version, 'Card does not read the canonical current unit version');
    assert.equal(row.revoked, false, 'Card is revoked');
    return { state: row.expired ? 'blocked' : 'pass', observed: { cardId: row.cardId, revision: row.revision,
      integrity: row.integrity, result: report.result, checks: report.checks, snapshot: report.snapshot,
      lifecycle: report.lifecycle, expired: row.expired, expiresAt: row.expiresAt, revoked: row.revoked,
      signature: report.signature } };
  } catch (error) {
    return { state: 'fail', observed: { cardId: row.cardId, revision: row.revision,
      status: read?.status ?? null, code: read?.code ?? null,
      expired: row.expired, expiresAt: row.expiresAt, revoked: row.revoked,
      reason: error instanceof Error ? error.message.split('\n')[0] : 'Card verification undecidable' } };
  }
}
