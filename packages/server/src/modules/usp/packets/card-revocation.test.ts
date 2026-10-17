import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import type { RequestContext } from '../../../../../contracts/src/usp';
import { schemaRequirements } from '../../../infrastructure/database-readiness';
import { sha256 } from '../../../infrastructure/storage';
import { canonical } from '../../cases/domain';
import { localRequestContext } from '../principal';
import { revokePropertyCard } from './card-revocation';
import { generatePropertyCard, readPropertyCard, resolvePropertyCard } from './card-service';
import { verifyPropertyCard } from './card-verification';
import { manifestId, planId, withCardStore, type CardStore } from './card-verification.test-fixture';

const expiresAt = () => new Date(Date.now() + 3600000).toISOString();
// Protocol literals of this test; neither is an operational reason.
const REASON_CODE = 'protocol_control', REASON = 'Recorded revocation protocol control';

async function generate(store: CardStore, ctx: RequestContext, requestKey = 'card-create') {
  return generatePropertyCard(ctx, { planId, planVersion: 1, cardId: null, expiresAt: expiresAt(),
    guard: { mode: 'create', requestKey } }, store.io);
}
async function revise(store: CardStore, ctx: RequestContext, cardId: string, expectedVersion = 1) {
  const guard = { mode: 'update', requestKey: `card-revise-${expectedVersion}`, expectedVersion,
    expectedManifestId: manifestId };
  return generatePropertyCard(ctx, { planId, planVersion: 1, cardId, expiresAt: expiresAt(), guard }, store.io);
}
function command(cardId: string, revision = 1, requestKey = 'card-revoke') {
  return { cardId, revision, reasonCode: REASON_CODE, reason: REASON, guard: { mode: 'create', requestKey } };
}
/** The refusal a request gets instead of an answer. */
function refusal(work: Promise<unknown>) {
  return work.then(() => assert.fail('the request was answered'),
    (error: any) => ({ status: error.status as number, code: error.code as string, message: error.message as string }));
}
/** What a revocation must leave as it was: every card row and every stored object. */
function stored(store: CardStore) {
  return { cardRowsSha256: sha256(canonical(store.cards)),
    objectsSha256: [...store.objects].map(([key, bytes]) => [key, sha256(bytes)]) };
}

// Rows of docs/evidence/gf4/k5/result.json. Written only when K5_REVOCATION_EVIDENCE_FILE is set.
const observations: object[] = [];
function observe(condition: string, expected: string, observed: object) {
  observations.push({ condition, expected, observed });
}
after(async () => {
  const file = process.env.K5_REVOCATION_EVIDENCE_FILE;
  if (file) await writeFile(file, `[\n${observations.map(row => JSON.stringify(row)).join(',\n')}\n]\n`);
});

test('the creator revokes one exact revision: one row, one receipt, one event, and the card row and PDF are unchanged',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx), before = stored(store);
    const counts = { receipts: store.receipts.length, events: store.events.length, puts: store.puts };
    const receipt = await revokePropertyCard(ctx, command(card.cardId));
    assert.deepEqual(receipt, { cardId: card.cardId, revision: 1, cardSha256: card.cardSha256, reasonCode: REASON_CODE,
      reason: REASON, scope: card.scope, revokedAt: receipt.revokedAt });
    assert.deepEqual(store.revocations, [{ card_id: card.cardId, revision: 1, subject: ctx.principal.subject,
      reason_code: REASON_CODE, body: receipt, revoked_at: receipt.revokedAt }]);
    assert.equal(store.receipts.length, counts.receipts + 1);
    assert.equal(store.receipts.at(-1).operation, 'property_card_revoke');
    assert.equal(store.events.length, counts.events + 1);
    assert.deepEqual(store.events.at(-1), { type: 'property.card.revoked', scope: card.scope, cardId: card.cardId,
      revision: 1, cardSha256: card.cardSha256, reasonCode: REASON_CODE, correlationId: ctx.requestId });
    const afterwards = stored(store);
    assert.deepEqual(afterwards, before);
    assert.equal(store.puts, counts.puts, 'a revocation writes no object');
    observe('creator revokes revision 1', 'one row, one receipt, one event; card row and PDF hashes unchanged',
      { status: 200, revocationRows: store.revocations.length, event: 'property.card.revoked',
        cardRowsSha256: [before.cardRowsSha256, afterwards.cardRowsSha256],
        pdfSha256: [before.objectsSha256.at(-1)?.[1], afterwards.objectsSha256.at(-1)?.[1]] });
  }));

test('the same request key returns the first receipt and writes nothing; the same key with other inputs is refused',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    const first = await revokePropertyCard(ctx, command(card.cardId)), writes = store.writes;
    const replay = await revokePropertyCard(ctx, command(card.cardId));
    assert.deepEqual(replay, first);
    assert.equal(store.writes, writes);
    const other = { ...command(card.cardId), reason: 'Another stated reason' };
    const changed = await refusal(revokePropertyCard(ctx, other));
    assert.deepEqual([changed.status, changed.code], [409, 'STALE_REVISION']);
    assert.equal(store.writes, writes);
    observe('replay with the same request key', 'the first receipt; no write',
      { status: 200, sameReceipt: canonical(replay) === canonical(first), writes: store.writes - writes });
    observe('the same request key with another reason', '409', { status: changed.status, code: changed.code });
  }));

test('a second request key for a revoked revision answers with the first revocation and adds no row, receipt or event',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    const first = await revokePropertyCard(ctx, command(card.cardId)), writes = store.writes;
    const second = await revokePropertyCard(ctx, { ...command(card.cardId, 1, 'card-revoke-again'),
      reasonCode: 'another_code', reason: 'Another stated reason' });
    assert.deepEqual(second, first);
    assert.equal(store.writes, writes);
    assert.equal(store.revocations.length, 1);
    observe('second request key, other reason', 'the first revocation; no second row',
      { status: 200, sameReceipt: canonical(second) === canonical(first), revocationRows: store.revocations.length,
        writes: store.writes - writes });
  }));

test('the consistency report of a revoked card still runs every check and reports lifecycle.revocation',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx), receipt = await revokePropertyCard(ctx, command(card.cardId));
    const revocation = { revokedAt: receipt.revokedAt, reasonCode: REASON_CODE };
    const { report } = await verifyPropertyCard(ctx, { cardId: card.cardId, revision: 1 }, store.io);
    assert.equal(report.result, 'consistent');
    assert(report.checks.every(check => check.state === 'pass'));
    assert.deepEqual(report.lifecycle, { latestRevision: 1, superseded: false, expiresAt: card.expiresAt,
      expired: false, revocation });
    observe('consistency report of a revoked, untouched card', 'consistent; every check pass; revocation reported',
      { status: 200, result: report.result, checks: report.checks.map(check => `${check.key}:${check.state}`),
        revocation: report.lifecycle.revocation });
    const key = store.cards[0].object_key, bytes = Buffer.from(store.objects.get(key)!);
    bytes[bytes.length - 1] ^= 1;
    store.objects.set(key, bytes);
    const changed = (await verifyPropertyCard(ctx, { cardId: card.cardId, revision: 1 }, store.io)).report;
    assert.equal(changed.result, 'inconsistent');
    assert.deepEqual(changed.lifecycle.revocation, revocation);
    store.alter(1, row => ({ ...row, body: { ...row.body, expiresAt: '2099-01-01T00:00:00.000Z' } }));
    const unknown = (await verifyPropertyCard(ctx, { cardId: card.cardId, revision: 1 }, store.io)).report;
    assert.equal(unknown.lifecycle.expired, null, 'the expiry of a changed body stays unknown');
    assert.deepEqual(unknown.lifecycle.revocation, revocation, 'the revocation is keyed by the row, not the body');
    observe('revoked card with one changed PDF byte, then a changed body',
      'inconsistent; revocation still reported; expiry unknown for the changed body',
      { status: 200, result: [changed.result, unknown.result], expired: [changed.lifecycle.expired,
        unknown.lifecycle.expired], revocationReported: [!!changed.lifecycle.revocation,
        !!unknown.lifecycle.revocation] });
  }));

test('read and resolve of a revoked revision answer 403 CARD_REVOKED, before expiry; another revision is unaffected',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    await revise(store, ctx, card.cardId);
    await revokePropertyCard(ctx, command(card.cardId));
    const exact = { cardId: card.cardId, revision: 1 };
    const read = await refusal(readPropertyCard(ctx, exact, store.io));
    const resolved = await refusal(resolvePropertyCard(ctx, exact, store.io));
    assert.deepEqual([read.status, read.code], [403, 'CARD_REVOKED']);
    assert.deepEqual(resolved, read);
    const later = await readPropertyCard(ctx, { cardId: card.cardId, revision: 2 }, store.io);
    assert.equal(later.card.revision, 2);
    store.expired = true;
    const expiredToo = await refusal(readPropertyCard(ctx, exact, store.io));
    assert.equal(expiredToo.code, 'CARD_REVOKED');
    const expiredOnly = await refusal(readPropertyCard(ctx, { cardId: card.cardId, revision: 2 }, store.io));
    assert.deepEqual([expiredOnly.status, expiredOnly.code], [403, 'CARD_EXPIRED']);
    observe('read of revoked revision 1', '403 CARD_REVOKED', { status: read.status, code: read.code });
    observe('resolve (PDF) of revoked revision 1', '403 CARD_REVOKED',
      { status: resolved.status, code: resolved.code });
    observe('read of unrevoked revision 2 of the same card', 'answered',
      { status: 200, revision: later.card.revision });
    observe('revoked revision 1 past its expiry', '403 CARD_REVOKED, not CARD_EXPIRED',
      { status: expiredToo.status, code: expiredToo.code });
  }));

test('a new revision of a card whose latest revision is revoked is refused with its own code; a new card is created',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    await revokePropertyCard(ctx, command(card.cardId));
    const revised = await refusal(revise(store, ctx, card.cardId));
    assert.deepEqual([revised.status, revised.code], [422, 'CARD_REVISION_REVOKED']);
    assert.equal(store.cards.length, 1);
    const fresh = await generate(store, ctx, 'card-create-again');
    assert.notEqual(fresh.cardId, card.cardId);
    assert.equal((await readPropertyCard(ctx, { cardId: fresh.cardId, revision: 1 }, store.io)).card.revision, 1);
    observe('new revision of a card whose latest revision is revoked', '422 CARD_REVISION_REVOKED',
      { status: revised.status, code: revised.code, cardRows: 1 });
    observe('a separate new card after that refusal', 'created and readable',
      { status: 200, revision: fresh.revision });
  }));

test('a card whose earlier revision is revoked still takes a new revision after its unrevoked latest one',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    await revise(store, ctx, card.cardId);
    await revokePropertyCard(ctx, command(card.cardId));
    const third = await revise(store, ctx, card.cardId, 2);
    assert.equal(third.revision, 3);
  }));

test('only the creator under the same access view revokes (403); an unknown card and revision get the same 404',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    const unknownCard = await refusal(revokePropertyCard(ctx, command('00000000-0000-4000-8000-000000000099')));
    const unknownRevision = await refusal(revokePropertyCard(ctx, command(card.cardId, 9)));
    assert.equal(unknownCard.status, 404);
    assert.deepEqual(unknownRevision, unknownCard);
    const view = await refusal(revokePropertyCard({ ...ctx, accessViewId: 'another-access-view' },
      command(card.cardId)));
    assert.deepEqual([view.status, view.code], [403, 'CARD_ACCESS']);
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'another-operator';
    const other = await refusal(revokePropertyCard(localRequestContext('card-revocation-other'),
      command(card.cardId)));
    assert.deepEqual([other.status, other.code], [403, 'CARD_ACCESS']);
    assert.equal(store.revocations.length, 0);
    observe('unknown card', '404', { status: unknownCard.status, code: unknownCard.code });
    observe('known card, unknown revision', 'the same 404 body',
      { status: unknownRevision.status, code: unknownRevision.code,
        sameBody: canonical(unknownRevision) === canonical(unknownCard) });
    observe('another operator revokes', '403; no row', { status: other.status, code: other.code, revocationRows: 0 });
    observe('the creator under another access view revokes', '403; no row',
      { status: view.status, code: view.code, revocationRows: 0 });
  }));

test('until usp_property_card_revocations_001 has run, readiness names what is missing and no card route answers',
  () => withCardStore(async (store, ctx) => {
    const required = schemaRequirements();
    assert(required.relations.includes('public.usp_property_card_revocations'));
    assert(required.markers.includes('usp_property_card_revocations_001'));
    const card = await generate(store, ctx), exact = { cardId: card.cardId, revision: 1 };
    store.revocationTable = false;
    const attempts: Record<string, () => Promise<unknown>> = {
      read: () => readPropertyCard(ctx, exact, store.io), resolve: () => resolvePropertyCard(ctx, exact, store.io),
      verification: () => verifyPropertyCard(ctx, exact, store.io),
      revoke: () => revokePropertyCard(ctx, command(card.cardId)),
      generate: () => generate(store, ctx, 'card-create-again') };
    for (const [route, attempt] of Object.entries(attempts)) {
      // Not an AppError: the HTTP filter answers a database error as 503 USP_REQUEST_FAILED.
      const error = await attempt().then(() => assert.fail(`${route} was answered`), (thrown: any) => thrown);
      assert.equal(error.code, '42P01', route);
      assert.equal(error.status, undefined, route);
    }
    assert.equal(store.cards.length, 1, 'no card is stored without the revocation lookup');
    observe('database without usp_property_card_revocations_001',
      'readiness lists the relation and the step; read, resolve, verification, revoke and generate all reject',
      { requiredRelation: 'public.usp_property_card_revocations', requiredStep: 'usp_property_card_revocations_001',
        rejected: Object.keys(attempts), error: 'SQLSTATE 42P01 (HTTP 503 USP_REQUEST_FAILED through the filter)' });
  }));
