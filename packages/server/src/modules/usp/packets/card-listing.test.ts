import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import type { Pool } from 'pg';
import type { RequestContext } from '../../../../../contracts/src/usp';
import type { PropertyCard, PropertyCardList } from '../../../../../contracts/src/usp/property-card';
import { fingerprint } from '../../cases/domain';
import { localRequestContext } from '../principal';
import { listPropertyCards } from './card-listing';
import { revokePropertyCard } from './card-revocation';
import { generatePropertyCard } from './card-service';
import { manifestId, planId, withCardStore, type CardStore } from './card-verification.test-fixture';

type Values = readonly any[];
type Query = (text: string, values?: Values) => Promise<{ rows: unknown[]; rowCount: number }>;
const OTHER_TARGET = '00000000-0000-4000-8000-000000000099';
const expiresAt = () => new Date(Date.now() + 3600000).toISOString();
const keys = (list: PropertyCardList) => list.items.map(item => `${item.cardId}:${item.revision}`);

/**
 * The store double with the page statement of card-listing.ts added. Rows are created one second apart in
 * insertion order, the plan's target stands for the plan join, and `plansHidden` makes the plan reader refuse.
 */
function listingPool(store: CardStore, state: { plansHidden: boolean }) {
  const page = async (values: Values) => {
    const [siteId, subject, namespace, id, limit] = values;
    const plan = (await store.pool.query('SELECT body FROM usp_packet_plans WHERE id=$1 AND version=$2',
      [planId, 1])).rows[0].body;
    const named = plan.input.target.ref.namespace === namespace && plan.input.target.ref.id === id;
    const rows = store.cards.map((row, index) => ({ ...row, created: index }))
      .filter(row => named && row.site_id === siteId && row.subject === subject)
      .sort((a, b) => b.created - a.created).slice(0, limit);
    return rows.map(row => ({ ...row,
      latest_revision: Math.max(...store.cards.filter(card => card.id === row.id).map(card => card.revision)),
      revoked_at: store.revocations.find(item => item.card_id === row.id && item.revision === row.revision)
        ?.revoked_at ?? null,
      read_at: new Date(store.expired ? Date.now() + 2 * 86400000 : Date.now()) }));
  };
  const through = (inner: Query): Query => async (text, values = []) => {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT c.id,c.revision')) {
      const rows = await page(values);
      return { rows, rowCount: rows.length };
    }
    if (state.plansHidden && sql.startsWith('SELECT body FROM usp_packet_plans')) return { rows: [], rowCount: 0 };
    return inner(text, values);
  };
  return { query: through(store.pool.query.bind(store.pool) as Query), connect: async () => {
    const client = await store.pool.connect();
    return { query: through(client.query.bind(client) as Query), release: () => client.release() };
  } } as unknown as Pool;
}

/** One scenario against the store double with the listing statement installed for its duration. */
function withListing(work: (store: CardStore, ctx: RequestContext, state: { plansHidden: boolean }) => Promise<void>) {
  return withCardStore(async (store, ctx) => {
    const state = { plansHidden: false };
    (globalThis as unknown as { ulpinPool: Pool }).ulpinPool = listingPool(store, state);
    await work(store, ctx, state);
  });
}
async function generate(store: CardStore, ctx: RequestContext, requestKey: string) {
  return generatePropertyCard(ctx, { planId, planVersion: 1, cardId: null, expiresAt: expiresAt(),
    guard: { mode: 'create', requestKey } }, store.io);
}
async function revise(store: CardStore, ctx: RequestContext, cardId: string) {
  const guard = { mode: 'update', requestKey: 'card-revise', expectedVersion: 1, expectedManifestId: manifestId };
  return generatePropertyCard(ctx, { planId, planVersion: 1, cardId, expiresAt: expiresAt(), guard }, store.io);
}
function list(ctx: RequestContext, card: PropertyCard, limit?: number, targetId = card.target.ref.id) {
  return listPropertyCards(ctx, { scope: card.scope, target: { ...card.target.ref, id: targetId }, limit });
}

// Rows of docs/evidence/gf4/k7/result.json. Written only when K7_EVIDENCE_FILE is set.
const observations: object[] = [];
function observe(condition: string, expected: string, observed: object) {
  observations.push({ condition, expected, observed });
}
after(async () => {
  const file = process.env.K7_EVIDENCE_FILE;
  if (file) await writeFile(file, `[\n${observations.map(row => JSON.stringify(row)).join(',\n')}\n]\n`);
});

test('two revisions of one card and a separate card of the same target are listed newest first with superseded right',
  () => withListing(async (store, ctx) => {
    const first = await generate(store, ctx, 'card-create'), second = await revise(store, ctx, first.cardId);
    const separate = await generate(store, ctx, 'card-create-again'), writes = store.writes, puts = store.puts;
    const listed = await list(ctx, first);
    assert.deepEqual(keys(listed), [`${separate.cardId}:1`, `${first.cardId}:2`, `${first.cardId}:1`]);
    assert.deepEqual(listed.items.map(item => [item.latestRevision, item.superseded]),
      [[1, false], [2, false], [2, true]]);
    assert.equal(listed.truncated, false);
    assert.deepEqual(listed.items[1], { cardId: first.cardId, revision: 2, integrity: 'consistent',
      latestRevision: 2, superseded: false, createdAt: second.createdAt, expiresAt: second.expiresAt, expired: false,
      revoked: false, revokedAt: null, targetRevision: 1, currentTargetRevision: 1, snapshotState: 'same_revision',
      profile: second.profile, artifact: { sha256: second.artifact.sha256, bytes: second.artifact.bytes },
      cardSha256: second.cardSha256, resolverUrl: second.resolverUrl });
    assert.deepEqual([store.writes, store.puts], [writes, puts], 'a listing writes nothing');
    store.currentRevision = 2;
    const moved = await list(ctx, first);
    assert.deepEqual(moved.items.map(item => [item.targetRevision, item.currentTargetRevision, item.snapshotState]),
      Array(3).fill([1, 2, 'changed_revision']));
    observe('two revisions of one card and a separate card, same target', 'three rows, newest first; revision 1 '
      + 'superseded; no write', { status: 200, order: ['separate:1', 'first:2', 'first:1'],
      superseded: listed.items.map(item => item.superseded), truncated: listed.truncated, writes: 0 });
    observe('target record moved to revision 2', 'changed_revision on every row',
      { status: 200, snapshotState: moved.items.map(item => item.snapshotState) });
  }));

test('a revoked revision and an expired card are listed with their flags, not left out',
  () => withListing(async (store, ctx) => {
    const first = await generate(store, ctx, 'card-create'), second = await generate(store, ctx, 'card-create-again');
    const receipt = await revokePropertyCard(ctx, { cardId: first.cardId, revision: 1, reasonCode: 'protocol_control',
      reason: 'Recorded listing protocol control', guard: { mode: 'create', requestKey: 'card-revoke' } });
    const listed = await list(ctx, first);
    assert.deepEqual(listed.items.map(item => [item.cardId, item.revoked, item.revokedAt, item.expired]),
      [[second.cardId, false, null, false], [first.cardId, true, receipt.revokedAt, false]]);
    store.expired = true;
    const later = await list(ctx, first);
    assert.deepEqual(later.items.map(item => [item.revoked, item.expired]), [[false, true], [true, true]]);
    observe('one revoked and one unrevoked card', 'both listed; revoked and revokedAt on the revoked one only',
      { status: 200, revoked: listed.items.map(item => item.revoked),
        expired: listed.items.map(item => item.expired) });
    observe('the same cards past their expiry on the database clock', 'both listed; expired true',
      { status: 200, revoked: later.items.map(item => item.revoked), expired: later.items.map(item => item.expired) });
  }));

test('a card of another operator is not listed, by its subject column and by the creator its body names',
  () => withListing(async (store, ctx) => {
    const card = await generate(store, ctx, 'card-create');
    const mine = await generate(store, ctx, 'card-create-again');
    const other = { ...ctx.principal, subject: 'another-operator' };
    store.alter(1, row => {
      if (row.id !== card.cardId) return row;
      const { cardSha256: _, ...body } = row.body;
      const changed = { ...body, creator: other };
      return { ...row, body: { ...changed, cardSha256: fingerprint(changed) } };
    });
    const listed = await list(ctx, card);
    assert.deepEqual(keys(listed), [`${mine.cardId}:1`], 'an intact body that names another creator is left out');
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = other.subject;
    const theirs = await list(localRequestContext('card-listing-other'), card);
    assert.deepEqual(theirs, { items: [], truncated: false }, 'no row carries the other subject');
    observe('row of the caller whose intact body names another creator', 'left out', { status: 200, items: 1 });
    observe('another operator lists the same target', 'empty list', { status: 200, items: theirs.items.length });
  }));

test('a card whose plan the plan reader no longer admits is left out, not an error',
  () => withListing(async (store, ctx, state) => {
    const card = await generate(store, ctx, 'card-create');
    state.plansHidden = true;
    const listed = await list(ctx, card);
    assert.deepEqual(listed, { items: [], truncated: false });
    observe('the plan reader refuses the plan of the only card (404)', 'empty list, not an error',
      { status: 200, items: 0 });
  }));

test('a row with a changed body is listed as inconsistent with every other field null',
  () => withListing(async (store, ctx) => {
    const card = await generate(store, ctx, 'card-create'), intact = await generate(store, ctx, 'card-create-again');
    store.alter(1, row => row.id === card.cardId
      ? { ...row, body: { ...row.body, expiresAt: '2099-01-01T00:00:00.000Z' } } : row);
    const listed = await list(ctx, card);
    assert.deepEqual(keys(listed), [`${intact.cardId}:1`, `${card.cardId}:1`]);
    const { cardId, revision, integrity, ...rest } = listed.items[1];
    assert.deepEqual([cardId, revision, integrity], [card.cardId, 1, 'inconsistent']);
    assert(Object.values(rest).every(value => value === null));
    assert.equal(Object.keys(rest).length, 14);
    assert.equal(listed.items[0].integrity, 'consistent');
    observe('one row with a changed body beside an intact one', 'both listed; the changed one inconsistent, nulls',
      { status: 200, integrity: listed.items.map(item => item.integrity),
        nullFields: Object.values(rest).filter(value => value === null).length });
  }));

test('an unknown target is an empty list, and a scope that is not the stored snapshot is refused as on other reads',
  () => withListing(async (store, ctx) => {
    const card = await generate(store, ctx, 'card-create');
    assert.deepEqual(await list(ctx, card, undefined, OTHER_TARGET), { items: [], truncated: false });
    const stale = { ...card.scope, snapshotDigest: 'c'.repeat(64) };
    const refused = await listPropertyCards(ctx, { scope: stale, target: card.target.ref }).then(
      () => assert.fail('a list was returned'), (error: any) => ({ status: error.status, code: error.code }));
    assert.deepEqual(refused, { status: 409, code: 'USP_SCOPE_STALE' });
    observe('known scope, unknown target', 'empty list', { status: 200, items: 0 });
    observe('a scope that differs from the stored snapshot', '409, the house rule of scoped USP reads', refused);
  }));

test('the limit bounds the page and truncated says that more rows matched',
  () => withListing(async (store, ctx) => {
    const first = await generate(store, ctx, 'card-create');
    await generate(store, ctx, 'card-create-again');
    const newest = await generate(store, ctx, 'card-create-third');
    const two = await list(ctx, first, 2), one = await list(ctx, first, 1), all = await list(ctx, first, 3);
    assert.deepEqual([two.items.length, two.truncated], [2, true]);
    assert.deepEqual([keys(one), one.truncated], [[`${newest.cardId}:1`], true]);
    assert.deepEqual([all.items.length, all.truncated], [3, false]);
    for (const limit of [0, 51, 1.5])
      await assert.rejects(() => list(ctx, first, limit), (error: any) => error.name === 'ZodError');
    observe('three rows, limit 2, 1 and 3', 'page bounded; truncated true, true, false',
      { status: 200, items: [2, 1, 3], truncated: [two.truncated, one.truncated, all.truncated] });
  }));
