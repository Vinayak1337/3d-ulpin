import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import test, { after, mock } from 'node:test';
import { ProjectIdentityReviewSchema, type RequestContext } from '@ulpin/contracts/usp';
import { AppError } from '../../infrastructure/errors';
import { fingerprint } from '../cases/domain';
import { retainedTower } from '../officer/source-spaces.test-fixture';
import { listIdentityReviews } from './identity-reviews';
import { assignProjectCode, prepareProjectIdentityReview } from './project-identity';
import { captureRegistrySnapshot } from './snapshots';
import {
  control, errorCode, legacyNumberedLocation, prepare, type SourceFixture,
} from './source-stated-identity.test-fixture';

type Values = readonly any[];
/** What the shared double does not keep of a review: its two times and the operation of its audit row. */
type Marks = { created: Map<string, Date>; consumed: Map<string, Date>; audited: Map<string, string> };
type Double = {
  marks: Marks; saved: Marks; elsewhere: Map<string, string>; archived: boolean; statements: string[]; began: Date;
};
const globals = globalThis as unknown as { ulpinPool?: unknown };
const siteId = retainedTower.areaId;
const ITEM_KEYS = ['commandSha256', 'createdAt', 'expectedManifestId', 'expectedRecordVersion', 'operation',
  'reason', 'reviewId', 'scope', 'used'];

/** The site statement of identity-reviews.ts: a recorded record on a site whose area is not archived. */
function recordSite(f: SourceFixture, double: Double, recordId: string) {
  const held = f.db.rows.find(row => row.id === recordId && row.revision > 0)?.site_id;
  const site = held ?? double.elsewhere.get(recordId);
  return site && !double.archived ? [{ site_id: site }] : [];
}

/** The page statement of identity-reviews.ts over the reviews and snapshots the shared double holds. */
function page(f: SourceFixture, double: Double, values: Values) {
  const [scopeId, accessViewId, policyVersion, recordIds, limit] = values;
  const wanted: string[] = JSON.parse(recordIds);
  return [...f.memory.reviews.values()]
    .filter(review => {
      const manifest = f.memory.snapshots.get(review.manifest_id);
      return review.scope_id === scopeId && manifest?.scope.scopeId === scopeId
        && manifest.accessViewId === accessViewId && manifest.policyVersion === policyVersion
        && wanted.every(id => review.body.recordIds.includes(id));
    })
    .map(review => ({
      id: review.id, manifest_id: review.manifest_id, operation: review.operation,
      command_hash: review.command_hash, body: structuredClone(review.body),
      created_at: double.marks.created.get(review.id) as Date,
      consumed_at: review.consumed_at ? double.marks.consumed.get(review.id) as Date : null,
      used_operation: double.marks.audited.get(review.id) ?? null,
    }))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1))
    .slice(0, limit);
}

/** Keeps the columns the review insert, the audit insert and the consuming update write besides what the shared
 * double holds. As with now(), each gets the time at which its transaction began; a rollback undoes them. */
function remember(double: Double, sql: string, values: Values) {
  if (sql.startsWith('BEGIN')) {
    double.began = new Date();
    double.saved = structuredClone(double.marks);
  }
  if (sql === 'ROLLBACK') double.marks = double.saved;
  if (sql.startsWith('INSERT INTO usp_project_identity_reviews')) double.marks.created.set(values[0], double.began);
  if (sql.startsWith('INSERT INTO usp_project_identity_audit')) double.marks.audited.set(values[2], values[3]);
  if (sql.startsWith('UPDATE usp_project_identity_reviews SET consumed_at=now()')) {
    double.marks.consumed.set(values[0], double.began);
  }
}

/**
 * One scenario on the identity protocol double with the two statements of the listing added to it. The clock is
 * the double's own and every statement takes one millisecond of it, so two reviews never share a stored time by
 * accident.
 */
async function withListing(work: (f: SourceFixture, double: Double) => Promise<void>) {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-10T12:00:00.000Z') });
  try {
    await control(async f => {
      const marks = (): Marks => ({ created: new Map(), consumed: new Map(), audited: new Map() });
      const double: Double = { marks: marks(), saved: marks(), elsewhere: new Map(), archived: false,
        statements: [], began: new Date() };
      const query = async (text: string, values: any[] = []) => {
        const sql = text.replace(/\s+/g, ' ').trim();
        mock.timers.tick(1);
        double.statements.push(sql);
        remember(double, sql, values);
        if (sql.startsWith('SELECT r.site_id FROM registry_records r JOIN map_areas')) {
          const rows = recordSite(f, double, values[0]);
          return { rows, rowCount: rows.length };
        }
        if (sql.startsWith('SELECT r.id,r.manifest_id,r.operation,r.command_hash,r.body')) {
          const rows = page(f, double, values);
          return { rows, rowCount: rows.length };
        }
        return f.memory.query(text, values);
      };
      globals.ulpinPool = { connect: async () => ({ query, release() {} }), query };
      await work(f, double);
    });
  } finally {
    mock.timers.reset();
  }
}

const list = (f: SourceFixture, limit?: number) => listIdentityReviews(f.ctx, { recordId: f.recorded.spaceId, limit });
const iso = (time: Date | undefined) => (time as Date).toISOString();

/** A review of the fixture's unit prepared under another caller context, on a snapshot captured under it. */
async function prepareAs(f: SourceFixture, ctx: RequestContext) {
  const recordId = f.recorded.spaceId;
  const record = f.db.rows.find(row => row.id === recordId);
  const pins = [{ ref: { namespace: 'registry_record', id: recordId }, revision: record.revision }];
  const snapshot = await captureRegistrySnapshot(ctx, siteId, { kind: 'targets', pins });
  return prepareProjectIdentityReview(ctx, { operation: 'assign', scope: snapshot.scope, recordIds: [recordId],
    expectedVersions: { [recordId]: record.revision }, reason: f.request.reason,
    evidence: [{ sourceId: f.request.space.evidence.sourceId, revision: 1, locator: record.body.evidence[0].locator }],
  });
}

async function refusal(read: () => Promise<unknown>) {
  try {
    await read();
    return null;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { status: error.status, code: error.code, message: error.message };
  }
}

// Rows of docs/evidence/gf1/k11b/result.json. Written only when K11B_EVIDENCE_FILE is set.
const observations: object[] = [];
function observe(condition: string, expected: string, observed: object) {
  observations.push({ condition, expected, observed });
}
after(async () => {
  const file = process.env.K11B_EVIDENCE_FILE;
  if (file) await writeFile(file, JSON.stringify(observations));
});

test('a listed review carries what the assignment then accepts, and is marked used only after it',
  () => withListing(async (f, double) => {
    const { review, command } = await prepare(f);
    const mark = double.statements.length;
    const before = await list(f);
    const issued = double.statements.slice(mark).filter(sql => !/^(BEGIN|COMMIT)/.test(sql));
    const [item] = before.items;
    const stored = f.memory.reviews.get(command.reviewId);

    assert.deepEqual({ ...before, items: [] },
      { recordId: f.recorded.spaceId, siteId, items: [], truncated: false, unreadable: 0 });
    assert.deepEqual(item, { reviewId: command.reviewId, operation: 'assign', reason: review.reason,
      createdAt: iso(double.marks.created.get(command.reviewId)), scope: review.scope,
      expectedManifestId: command.expectedManifestId, expectedRecordVersion: 1, used: null,
      commandSha256: stored.command_hash });
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
    assert.equal(JSON.stringify(item.scope), JSON.stringify(stored.body.scope));
    assert.equal(issued.length, 2);
    assert.match(issued[0], /^SELECT r\.site_id FROM registry_records r JOIN map_areas a ON a\.site_id=r\.site_id/);
    assert.match(issued[0], / WHERE r\.id=\$1 AND r\.revision>0 AND a\.archived_at IS NULL$/);
    assert.match(issued[1], /FROM usp_project_identity_reviews r JOIN usp_snapshots s ON s\.id=r\.manifest_id WHERE/);
    assert.match(issued[1], /r\.scope_id=\$1 AND s\.scope_id=\$1 AND s\.body->>'accessViewId'=\$2 AND s\.body->>/);
    assert.match(issued[1], /s\.body->>'policyVersion'=\$3 AND r\.body->'recordIds' @> \$4::jsonb ORDER BY/);
    assert.match(issued[1], / ORDER BY r\.created_at DESC,r\.id DESC LIMIT \$5$/);
    assert.match(issued[1], /\(SELECT a\.operation FROM usp_project_identity_audit a WHERE a\.review_id=r\.id /);
    assert(!double.statements.slice(mark).some(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)));

    const receipt = await assignProjectCode(f.ctx, { scope: item.scope, expectedManifestId: item.expectedManifestId,
      reviewId: item.reviewId, requestKey: randomUUID(), recordId: before.recordId,
      expectedRecordVersion: item.expectedRecordVersion });
    const usedAt = iso(double.marks.consumed.get(item.reviewId));
    const afterwards = await list(f);

    assert.equal(receipt.reviewId, item.reviewId);
    assert.deepEqual(afterwards.items, [{ ...item, used: { at: usedAt, operation: 'assign' } }]);
    assert(usedAt > item.createdAt);
    observe('one assign review of the tower unit, read before and after the real assignProjectCode that is given '
      + 'only the listed scope, expectedManifestId, reviewId and expectedRecordVersion',
    'used null before; the assignment accepts the listed values; used { at, operation: assign } after; two '
      + 'statements, no write', { status: 200, items: 1, statements: issued.length, usedBefore: item.used,
      usedAfter: afterwards.items[0].used, createdAt: item.createdAt, expectedRecordVersion: 1,
      keys: Object.keys(item).sort() });
  }));

test('a review bound to a manifest of another access view or policy takes no slot',
  () => withListing(async f => {
    await prepare(f);
    const before = await list(f);
    await prepareAs(f, { ...f.ctx, accessViewId: 'another-view-1' });
    await prepareAs(f, { ...f.ctx, policyVersion: 'usp-local-2' });

    assert.equal(f.memory.reviews.size, 3);
    assert.equal(before.items.length, 1);
    assert.deepEqual(await list(f), before);
    assert.deepEqual(await list(f, 1), before);
    observe('two newer reviews of the same unit on manifests of another access view and another policy',
      'neither listed; the answer equals the one before them, also at limit 1 (truncated stays false)',
      { status: 200, stored: f.memory.reviews.size, items: before.items.length, truncated: before.truncated });
  }));

test('two reviews of one record are listed newest first, and limit 1 answers the newest and says truncated',
  () => withListing(async (f, double) => {
    const older = (await prepare(f)).command.reviewId;
    const newer = (await prepare(f)).command.reviewId;
    const both = await list(f);
    const one = await list(f, 1);

    assert.deepEqual(both.items.map(item => item.reviewId), [newer, older]);
    assert(both.items[0].createdAt > both.items[1].createdAt);
    assert.notEqual(both.items[0].expectedManifestId, both.items[1].expectedManifestId);
    assert.deepEqual([both.truncated, (await list(f, 2)).truncated], [false, false]);
    assert.deepEqual(one.items, [both.items[0]]);
    assert.equal(one.truncated, true);

    // Equal stored times fall back to the id, descending.
    double.marks.created.set(older, double.marks.created.get(newer) as Date);
    assert.deepEqual((await list(f)).items.map(item => item.reviewId), [older, newer].sort().reverse());
    const mark = double.statements.length;
    for (const limit of [0, 21, 1.5]) await assert.rejects(list(f, limit), { name: 'ZodError' });
    await assert.rejects(listIdentityReviews(f.ctx, { recordId: 'not-a-record' }), { name: 'ZodError' });
    assert.equal(double.statements.length, mark);
    observe('two reviews of the unit; limit absent, 2 and 1; limit 0 / 21 / 1.5 and a malformed record id',
      'newest first; truncated false, false and true with the newest one; malformed input refused before any '
      + 'statement', { items: both.items.length, truncatedAtOne: one.truncated, refused: 'ZodError' });
  }));

test('a record that is unknown, not recorded or on an archived area answers the 404 of the record reads',
  () => withListing(async (f, double) => {
    await prepare(f);
    const expected = { status: 404, code: 'NOT_FOUND', message: 'This record could not be found.' };
    const unknown = await refusal(() => listIdentityReviews(f.ctx, { recordId: randomUUID() }));
    f.db.rows.find(row => row.id === f.recorded.spaceId).revision = 0;
    const unrecorded = await refusal(() => list(f));
    f.db.rows.find(row => row.id === f.recorded.spaceId).revision = 1;
    double.archived = true;
    const archived = await refusal(() => list(f));

    assert.deepEqual([unknown, unrecorded, archived], [expected, expected, expected]);
    observe('an id the store does not hold; the unit at revision 0; the unit while its area is archived',
      'the same 404 NOT_FOUND for each', expected);
  }));

test('a record no review names, on the same site or another, sees none of the reviews',
  () => withListing(async (f, double) => {
    await prepare(f);
    const elsewhere = { recordId: randomUUID(), siteId: randomUUID() };
    double.elsewhere.set(elsewhere.recordId, elsewhere.siteId);
    const empty = { items: [], truncated: false, unreadable: 0 };

    assert.deepEqual(await listIdentityReviews(f.ctx, { recordId: elsewhere.recordId }),
      { ...elsewhere, ...empty });
    assert.deepEqual(await listIdentityReviews(f.ctx, { recordId: retainedTower.buildingId }),
      { recordId: retainedTower.buildingId, siteId, ...empty });
    observe('a record of another site; the building record of the same site, which the review does not name',
      'no item for either', { status: 200, otherSiteItems: 0, unnamedItems: 0 });
  }));

test('a caller who is not the local operator is refused before any statement',
  () => withListing(async (f, double) => {
    await prepare(f);
    const mark = double.statements.length;
    const other = { ...f.ctx, principal: { ...f.ctx.principal, subject: 'another-operator' } };

    await assert.rejects(listIdentityReviews(other, { recordId: f.recorded.spaceId }), errorCode('USP_LOCAL_ONLY'));
    assert.equal(double.statements.length, mark);
    observe('another subject asks', '403 USP_LOCAL_ONLY, no statement', { code: 'USP_LOCAL_ONLY', statements: 0 });
  }));

test('a stored review of the earlier form, whose location carries numbers, is listed without its location',
  () => withListing(async (f, double) => {
    const { review, command } = await prepare(f);
    const stored = f.memory.reviews.get(command.reviewId);
    stored.body = ProjectIdentityReviewSchema.parse({ ...review, location: legacyNumberedLocation });
    stored.command_hash = fingerprint(stored.body);
    stored.consumed_at = true;
    double.marks.consumed.set(command.reviewId, new Date('2026-10-10T12:30:00.000Z'));
    double.marks.audited.set(command.reviewId, 'assign');
    const [item] = (await list(f)).items;

    assert.deepEqual(item.used, { at: '2026-10-10T12:30:00.000Z', operation: 'assign' });
    assert.equal(item.commandSha256, stored.command_hash);
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS);
    observe('a consumed review whose stored command holds a location with structure and space numbers (the form '
      + 'of the one review stored before K11)', 'listed with used set; no location among its keys',
    { status: 200, items: 1, used: item.used, keys: Object.keys(item).sort() });
  }));

test('a row that does not agree with itself is counted, not listed',
  () => withListing(async (f, double) => {
    const first = (await prepare(f)).command.reviewId;
    const second = (await prepare(f)).command.reviewId;
    const third = (await prepare(f)).command.reviewId;
    f.memory.reviews.get(first).command_hash = 'f'.repeat(64);
    const one = await list(f);
    f.memory.reviews.get(second).consumed_at = true;
    double.marks.consumed.set(second, new Date());
    const two = await list(f);
    f.memory.reviews.get(third).operation = 'correct';
    const three = await list(f, 2);

    assert.deepEqual(one.items.map(item => item.reviewId), [third, second]);
    assert.deepEqual([one.unreadable, one.truncated], [1, false]);
    assert.deepEqual([two.items.map(item => item.reviewId), two.unreadable], [[third], 2]);
    assert.deepEqual([three.items.length, three.unreadable, three.truncated], [0, 2, true]);
    observe('a hash that is not the stored command\'s; a consumed time without an audit row; a command of '
      + 'another operation than its row', 'each left out of items and counted in unreadable; truncated '
      + 'still counts stored rows', { firstUnreadable: one.unreadable, thenUnreadable: two.unreadable,
      atLimitTwo: { items: three.items.length, unreadable: three.unreadable, truncated: three.truncated } });
  }));
