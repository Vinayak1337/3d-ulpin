import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { UspPreviewPropertyCardSchema, UspPropertyCardPreviewSchema }
  from '../../../../../contracts/src/usp/property-card';
import { AppError } from '../../../infrastructure/errors';
import { generatePropertyCard, previewPropertyCard } from './card-service';
import { revokePropertyCard } from './card-revocation';
import { manifestId, planId, withCardStore, type CardStore } from './card-verification.test-fixture';

const command = () => ({ planId, planVersion: 1, cardId: null,
  expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create' as const } });
const code = (expected: string) => (error: unknown) => error instanceof AppError && error.code === expected;

/** Trace the existing store protocol without changing that shared fixture or any existing card test. */
function traceQueries(store: CardStore) {
  const queries: string[] = [];
  const pool = { query: store.pool.query.bind(store.pool), connect: async () => {
    const client = await store.pool.connect();
    return { release: () => client.release(), query: async (text: string, values?: any[]) => {
      queries.push(text.replace(/\s+/g, ' ').trim());
      return client.query(text, values);
    } };
  } } as unknown as Pool;
  (globalThis as unknown as { ulpinPool: Pool }).ulpinPool = pool;
  return queries;
}

function noWrites(queries: string[]) {
  assert.deepEqual(queries.filter(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)), []);
  assert(!queries.some(sql => sql.includes('usp_command_receipts')), 'preview has no request receipt');
  assert.equal(queries.filter(sql => sql === 'BEGIN').length,
    queries.filter(sql => sql === 'COMMIT' || sql === 'ROLLBACK').length, 'every transaction lock ends');
}

test('repeated preview stores nothing; generate answers the same facts, revision, expiry and scope',
  () => withCardStore(async (store, ctx) => {
    const request = command(), trace = traceQueries(store);
    const before = structuredClone({ cards: store.cards, receipts: store.receipts, events: store.events });
    const preview = UspPropertyCardPreviewSchema.parse(await previewPropertyCard(ctx, request, store.io));
    assert.deepEqual(await previewPropertyCard(ctx, request, store.io), preview);
    assert.deepEqual({ cards: store.cards, receipts: store.receipts, events: store.events }, before);
    assert.deepEqual([store.writes, store.puts], [0, 0]);
    assert.equal(preview.mode, 'create');
    assert(!('cardId' in preview));
    noWrites(trace);
    const card = await generatePropertyCard(ctx, { ...request,
      guard: { ...request.guard, requestKey: 'after-preview' } }, store.io);
    assert.deepEqual(preview, { mode: 'create', revision: card.revision, facts: card.facts,
      expiresAt: card.expiresAt, scope: card.scope });
    assert.equal(store.cards.length, 1);
    assert.equal(store.receipts.length, 1);
  }));

test('revision preview shares the guard and projection and predicts generate revision without appending one',
  () => withCardStore(async (store, ctx) => {
    const request = command();
    const card = await generatePropertyCard(ctx, { ...request,
      guard: { ...request.guard, requestKey: 'first' } }, store.io);
    const update = { ...request, cardId: card.cardId, guard: { mode: 'update' as const,
      expectedVersion: 1, expectedManifestId: manifestId } };
    const before = structuredClone(store.cards), writes = store.writes, puts = store.puts;
    const trace = traceQueries(store);
    const preview = await previewPropertyCard(ctx, update, store.io);
    assert.deepEqual(store.cards, before);
    assert.deepEqual([store.writes, store.puts], [writes, puts]);
    assert.equal(preview.mode, 'update');
    assert.equal(preview.revision, 2);
    noWrites(trace);
    const generated = await generatePropertyCard(ctx, { ...update,
      guard: { ...update.guard, requestKey: 'second' } }, store.io);
    assert.equal(generated.revision, preview.revision);
    assert.deepEqual(generated.facts, preview.facts);
  }));

test('a revoked latest revision refuses preview and generate with CARD_REVISION_REVOKED',
  () => withCardStore(async (store, ctx) => {
    const request = command();
    const card = await generatePropertyCard(ctx, { ...request,
      guard: { ...request.guard, requestKey: 'first' } }, store.io);
    await revokePropertyCard(ctx, { cardId: card.cardId, revision: 1, reasonCode: 'withdrawn',
      reason: 'Protocol-only revocation', guard: { mode: 'create', requestKey: 'revoke' } });
    const update = { ...request, cardId: card.cardId, guard: { mode: 'update',
      expectedVersion: 1, expectedManifestId: manifestId } };
    const trace = traceQueries(store), before = structuredClone(store.cards);
    await assert.rejects(previewPropertyCard(ctx, update, store.io), code('CARD_REVISION_REVOKED'));
    assert.deepEqual(store.cards, before);
    noWrites(trace);
    await assert.rejects(generatePropertyCard(ctx, { ...update,
      guard: { ...update.guard, requestKey: 'denied-revision' } }, store.io), code('CARD_REVISION_REVOKED'));
  }));

test('preview repeats expiry and plan-access refusals and writes nothing', () => withCardStore(async (store, ctx) => {
  const request = command(), trace = traceQueries(store);
  const beyond = { ...request, expiresAt: new Date(Date.now() + 25 * 3600000).toISOString() };
  await assert.rejects(previewPropertyCard(ctx, beyond, store.io), code('CARD_EXPIRY'));
  await assert.rejects(previewPropertyCard({ ...ctx, accessViewId: 'other' }, request, store.io),
    code('PACKET_PLAN_ACCESS'));
  noWrites(trace);
  await assert.rejects(generatePropertyCard(ctx, { ...beyond,
    guard: { ...beyond.guard, requestKey: 'expiry' } }, store.io), code('CARD_EXPIRY'));
  await assert.rejects(generatePropertyCard({ ...ctx, accessViewId: 'other' }, { ...request,
    guard: { ...request.guard, requestKey: 'access' } }, store.io), code('PACKET_PLAN_ACCESS'));
  assert.deepEqual([store.writes, store.puts], [0, 0]);
}));

test('revision context, stale version and corrupt linked packet refuse without storing a preview',
  () => withCardStore(async (store, ctx) => {
    const request = command();
    const card = await generatePropertyCard(ctx, { ...request,
      guard: { ...request.guard, requestKey: 'first' } }, store.io);
    const update = { ...request, cardId: card.cardId, guard: { mode: 'update' as const,
      expectedVersion: 1, expectedManifestId: manifestId } };
    const trace = traceQueries(store), before = structuredClone(store.cards);
    await assert.rejects(previewPropertyCard(ctx, { ...update,
      guard: { ...update.guard, expectedManifestId: 'different-snapshot' } }, store.io),
    code('CARD_REVISION_CONTEXT'));
    await assert.rejects(previewPropertyCard(ctx, { ...update,
      guard: { ...update.guard, expectedVersion: 2 } }, store.io), code('NOT_FOUND'));
    store.objects.set('control-packet', Buffer.from('changed packet bytes'));
    await assert.rejects(previewPropertyCard(ctx, request, store.io), code('USP_PACKET_INTEGRITY'));
    assert.deepEqual(store.cards, before);
    noWrites(trace);
  }));

test('preview schema accepts generate fields without its request key and requires exact revision context', () => {
  const request = command();
  assert(UspPreviewPropertyCardSchema.safeParse(request).success);
  assert(!UspPreviewPropertyCardSchema.safeParse({ ...request,
    guard: { mode: 'create', requestKey: 'not-a-preview-field' } }).success);
  assert(!UspPreviewPropertyCardSchema.safeParse({ ...request,
    guard: { mode: 'update', expectedVersion: 1, expectedManifestId: manifestId } }).success);
});
