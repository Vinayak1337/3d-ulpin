import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import type { RequestContext } from '../../../../../contracts/src/usp';
import { PROPERTY_CARD_CHECK_KEYS } from '../../../../../contracts/src/usp/property-card';
import { fingerprint } from '../../cases/domain';
import { localRequestContext } from '../principal';
import { generatePropertyCard, readPropertyCard } from './card-service';
import { REVISION_CHAIN_LIMIT, verifyPropertyCard } from './card-verification';
import { manifestId, planId, withCardStore, type CardStore } from './card-verification.test-fixture';

const expiresAt = () => new Date(Date.now() + 3600000).toISOString();

async function generate(store: CardStore, ctx: RequestContext) {
  return generatePropertyCard(ctx, { planId, planVersion: 1, cardId: null, expiresAt: expiresAt(),
    guard: { mode: 'create', requestKey: 'card-create' } }, store.io);
}
async function revise(store: CardStore, ctx: RequestContext, cardId: string) {
  const guard = { mode: 'update', requestKey: 'card-revise', expectedVersion: 1, expectedManifestId: manifestId };
  return generatePropertyCard(ctx, { planId, planVersion: 1, cardId, expiresAt: expiresAt(), guard }, store.io);
}
async function states(store: CardStore, ctx: RequestContext, cardId: string, revision = 1) {
  const { report } = await verifyPropertyCard(ctx, { cardId, revision }, store.io);
  assert.deepEqual(report.checks.map(check => check.key), PROPERTY_CARD_CHECK_KEYS);
  return { report, states: Object.fromEntries(report.checks.map(check => [check.key, check.state])),
    reasons: Object.fromEntries(report.checks.map(check => [check.key, check.reasonCode])) };
}
/** The refusal a request gets instead of a report. */
async function refusal(store: CardStore, ctx: RequestContext, command: { cardId: string; revision: number }) {
  return verifyPropertyCard(ctx, command, store.io).then(() => assert.fail('a report was returned'),
    (error: any) => ({ status: error.status as number, code: error.code as string, message: error.message as string }));
}
const allPass = Object.fromEntries(PROPERTY_CARD_CHECK_KEYS.map(key => [key, 'pass']));

// Rows of docs/evidence/gf4/k5/result.json: what each condition returned. Written only when K5_EVIDENCE_FILE is set.
const observations: object[] = [];
function observe(condition: string, expected: string, { report }: Awaited<ReturnType<typeof states>>) {
  const checks = report.checks.map(check => [check.key, check.state, check.reasonCode].filter(Boolean).join(':'));
  const { latestRevision, superseded, expired } = report.lifecycle;
  observations.push({ condition, expected, observed: { status: 200, result: report.result, checks,
    lifecycle: { latestRevision, superseded, expired }, snapshot: report.snapshot.state } });
}
function observeRefusal(condition: string, expected: string, error: { status: number; code: string }) {
  observations.push({ condition, expected, observed: { status: error.status, code: error.code } });
}
after(async () => {
  const file = process.env.K5_EVIDENCE_FILE;
  if (file) await writeFile(file, `[\n${observations.map(row => JSON.stringify(row)).join(',\n')}\n]\n`);
});

test('an untouched card is consistent, every check passes, and the report writes nothing and repeats no card fact',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx), before = { writes: store.writes, puts: store.puts };
    const untouched = await states(store, ctx, card.cardId), { report, states: checks } = untouched;
    observe('untouched card, revision 1', 'consistent; every check pass', untouched);
    assert.equal(report.result, 'consistent');
    assert.deepEqual(checks, allPass);
    assert.deepEqual(report.lifecycle, { latestRevision: 1, superseded: false, expiresAt: card.expiresAt,
      expired: false, revocation: null });
    assert.deepEqual(report.snapshot, { cardTargetRevision: 1, currentTargetRevision: 1, state: 'same_revision' });
    assert.deepEqual(report.signature, { state: 'not_assessed', reasonCode: 'NO_TRUSTED_KEY_POLICY' });
    assert.deepEqual({ writes: store.writes, puts: store.puts }, before);
    assert.deepEqual(Object.keys(report).sort(),
      ['cardId', 'checkedAt', 'checks', 'lifecycle', 'result', 'revision', 'signature', 'snapshot']);
    store.currentRevision = 2;
    const later = await states(store, ctx, card.cardId);
    observe('target record moved to revision 2 after the card', 'consistent; snapshot changed_revision', later);
    assert.equal(later.report.result, 'consistent');
    assert.deepEqual(later.report.snapshot,
      { cardTargetRevision: 1, currentTargetRevision: 2, state: 'changed_revision' });
  }));

test('one changed byte in the stored PDF fails artifact_bytes and the independent checks are still reported',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx), key = store.cards[0].object_key;
    const bytes = Buffer.from(store.objects.get(key)!);
    bytes[bytes.length - 1] ^= 1;
    store.objects.set(key, bytes);
    const changed = await states(store, ctx, card.cardId), { report, states: checks, reasons } = changed;
    observe('one changed byte in the stored PDF', 'inconsistent; artifact_bytes fail; plan_link and packet_bytes run',
      changed);
    assert.equal(report.result, 'inconsistent');
    assert.deepEqual(checks, { ...allPass, artifact_bytes: 'fail' });
    assert.equal(reasons.artifact_bytes, 'CARD_ARTIFACT_INTEGRITY');
    store.objects.delete(key);
    const missing = await states(store, ctx, card.cardId);
    observe('stored PDF object missing', 'inconsistent; artifact_bytes fail', missing);
    assert.equal(missing.reasons.artifact_bytes, 'CARD_ARTIFACT_MISSING');
  }));

test('a changed body under the old cardSha256 fails card_body, leaves its dependents unchecked and widens no access',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    const other = { ...ctx.principal, subject: 'another-operator' };
    store.alter(1, row => ({ ...row, body: { ...row.body, creator: other, expiresAt: '2099-01-01T00:00:00.000Z' } }));
    const changed = await states(store, ctx, card.cardId), { report, states: checks, reasons } = changed;
    observe('body creator and expiry changed, old cardSha256 kept',
      'inconsistent; card_body fail; dependents not_checked; expiry unknown', changed);
    assert.equal(report.result, 'inconsistent');
    assert.deepEqual(checks, { card_body: 'fail', stored_linkage: 'not_checked', revision_chain: 'not_checked',
      artifact_bytes: 'not_checked', plan_link: 'not_checked', packet_bytes: 'pass' });
    assert.equal(reasons.card_body, 'CARD_FINGERPRINT');
    assert.equal(reasons.stored_linkage, 'DEPENDS_ON_CARD_BODY');
    assert.equal(report.lifecycle.expiresAt, null, 'an expiry read from a changed body is not reported');
    assert.equal(report.lifecycle.expired, null);
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = other.subject;
    const named = localRequestContext('card-verification-other');
    const refused = await refusal(store, named, { cardId: card.cardId, revision: 1 });
    observeRefusal('the operator named by the changed body asks for the report', '403; access not widened', refused);
    assert.deepEqual([refused.status, refused.code], [403, 'CARD_ACCESS']);
  }));

test('a re-fingerprinted body that names another artifact fails stored_linkage, not card_body',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    store.alter(1, row => {
      const { cardSha256: _, ...body } = row.body;
      const changed = { ...body, artifact: { ...body.artifact, sha256: 'c'.repeat(64) } };
      return { ...row, body: { ...changed, cardSha256: fingerprint(changed) } };
    });
    const changed = await states(store, ctx, card.cardId), { states: checks, reasons } = changed;
    observe('body re-fingerprinted to name another artifact hash', 'inconsistent; stored_linkage fail', changed);
    assert.deepEqual(checks, { card_body: 'pass', stored_linkage: 'fail', revision_chain: 'not_checked',
      artifact_bytes: 'not_checked', plan_link: 'pass', packet_bytes: 'pass' });
    assert.equal(reasons.artifact_bytes, 'DEPENDS_ON_STORED_LINKAGE');
  }));

test('revision 2 fails revision_chain when its revision 1 row is missing or altered',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    await revise(store, ctx, card.cardId);
    assert.deepEqual((await states(store, ctx, card.cardId, 2)).states, allPass);
    const first = store.cards[0];
    store.alter(1, row => ({ ...row, body: { ...row.body, policyVersion: 'changed-policy' } }));
    const altered = await states(store, ctx, card.cardId, 2);
    observe('revision 2; revision 1 row altered', 'inconsistent; revision_chain fail', altered);
    assert.equal(altered.report.result, 'inconsistent');
    assert.deepEqual(altered.states, { ...allPass, revision_chain: 'fail' });
    assert.equal(altered.reasons.revision_chain, 'REVISION_BODY');
    store.alter(1, () => null);
    const missing = await states(store, ctx, card.cardId, 2);
    observe('revision 2; revision 1 row missing', 'inconsistent; revision_chain fail', missing);
    assert.deepEqual(missing.states, { ...allPass, revision_chain: 'fail' });
    assert.equal(missing.reasons.revision_chain, 'REVISION_MISSING');
    store.cards.unshift(first);
    assert.deepEqual((await states(store, ctx, card.cardId, 2)).states, allPass);
  }));

test('a chain longer than the stated limit fails revision_chain instead of passing unread',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx), revision = REVISION_CHAIN_LIMIT + 2;
    store.alter(1, row => {
      const { cardSha256: _, ...body } = row.body;
      const moved = { ...body, revision, previousRevision: revision - 1,
        resolverUrl: body.resolverUrl.replace(/1$/, String(revision)) };
      const object_key = `usp/property-cards/${row.id}/${revision}/${row.artifact_hash}`;
      store.objects.set(object_key, store.objects.get(row.object_key)!);
      return { ...row, revision, object_key, body: { ...moved, cardSha256: fingerprint(moved) } };
    });
    const long = await states(store, ctx, card.cardId, revision), { states: checks, reasons } = long;
    observe(`revision ${revision}: more than ${REVISION_CHAIN_LIMIT} earlier revisions`,
      'inconsistent; revision_chain fail, not a silent pass', long);
    assert.deepEqual(checks, { ...allPass, revision_chain: 'fail' });
    assert.equal(reasons.revision_chain, 'REVISION_CHAIN_LIMIT');
  }));

test('revision 1 stays consistent after revision 2 exists and is reported as superseded',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    await revise(store, ctx, card.cardId);
    const first = await states(store, ctx, card.cardId), { report } = first;
    observe('revision 1 after revision 2 exists', 'consistent; superseded; latestRevision 2', first);
    assert.equal(report.result, 'consistent');
    assert.equal(report.lifecycle.superseded, true);
    assert.equal(report.lifecycle.latestRevision, 2);
    const latest = await states(store, ctx, card.cardId, 2);
    assert.equal(latest.report.lifecycle.superseded, false);
  }));

test('an expired card is reported as expired with its checks run, while the read still answers 403',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    store.expired = true;
    const expired = await states(store, ctx, card.cardId), { report, states: checks } = expired;
    observe('card past its expiry', 'expired true; checks still run; consistent', expired);
    assert.equal(report.lifecycle.expired, true);
    assert.equal(report.result, 'consistent');
    assert.deepEqual(checks, allPass);
    const read = await readPropertyCard(ctx, { cardId: card.cardId, revision: 1 }, store.io).then(
      () => assert.fail('the expired card was read'), (error: any) => ({ status: error.status, code: error.code }));
    observeRefusal('existing read route on the same expired card', '403 CARD_EXPIRED, unchanged', read);
    assert.deepEqual(read, { status: 403, code: 'CARD_EXPIRED' });
  }));

test('another operator is refused with 403; an unknown card and an unknown revision get the same 404',
  () => withCardStore(async (store, ctx) => {
    const card = await generate(store, ctx);
    const unknownCard = await refusal(store, ctx, { cardId: '00000000-0000-4000-8000-000000000099', revision: 1 });
    const unknownRevision = await refusal(store, ctx, { cardId: card.cardId, revision: 9 });
    observeRefusal('unknown card', '404', unknownCard);
    observeRefusal('known card, unknown revision', 'the same 404 body', unknownRevision);
    assert.equal(unknownCard.status, 404);
    assert.deepEqual(unknownRevision, unknownCard);
    process.env.ULPIN_LOCAL_OPERATOR_SUBJECT = 'another-operator';
    const other = await refusal(store, localRequestContext('card-verification-other'),
      { cardId: card.cardId, revision: 1 });
    observeRefusal('another operator, untouched card', '403', other);
    assert.deepEqual([other.status, other.code], [403, 'CARD_ACCESS']);
  }));
