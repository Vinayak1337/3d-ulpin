import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import type { Pool, PoolClient } from 'pg';
import { IntakeConfirmSchema, type PropertyCardVerification, type TargetPin } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { ingestionBinding } from './events';
import { cardTargetDifference, confirmIntake, intakeConfirmationReason, isCardsOnly,
  packageDifference, retryIntakeConfirmation } from './intake-confirmations';
import { IntakeRunInputSchema, intakeRunKey, stableUuid } from './intake-run';
import { assertIntakeCardVerified, intakeCardVerificationPin, intakeRunRefusal, intakeRunSteps,
  intakeTargetCitation, runIntakeRunJob, type IntakeRunSteps } from './intake-run-worker';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const named = { packageId: id, revision: 2, reviewFingerprint: 'a'.repeat(64) };
const pkg = { id, state: 'REVIEWED', revision: 2,
  review: { packageRevision: 2, inputFingerprint: named.reviewFingerprint } } as ImportPackage;

test('one reason identifies the actual confirmation, with no invented justification', () => {
  assert.equal(intakeConfirmationReason(id, new Date('2026-01-01T01:00:00Z')),
    `Confirmed by the officer in intake confirmation ${id} on 2026-01-01.`);
});

test('a cards-only confirmation states its kind in its reason, which marks it and nothing else', () => {
  const at = new Date('2026-01-01T01:00:00Z');
  const reason = intakeConfirmationReason(id, at, true);
  assert.equal(reason, `Confirmed by the officer in intake confirmation ${id} on 2026-01-01 to card buildings `
    + 'already recorded.');
  assert(isCardsOnly({ confirmation_id: id, created_at: at, reason }));
  assert(!isCardsOnly({ confirmation_id: id, created_at: at, reason: intakeConfirmationReason(id, at) }));
  assert(!isCardsOnly({ confirmation_id: other, created_at: at, reason }));
});

test('keys distinguish confirmation, target and step but not attempt or job id', () => {
  assert.equal(intakeRunKey(id, other, 'plan'), intakeRunKey(id, other, 'plan'));
  assert.notEqual(intakeRunKey(id, other, 'plan'), intakeRunKey(other, other, 'plan'));
  assert.notEqual(intakeRunKey(id, other, 'plan'), intakeRunKey(id, id, 'plan'));
  assert.notEqual(intakeRunKey(id, other, 'plan'), intakeRunKey(id, other, 'card'));
});

test('confirmation rejects a changed revision or fingerprint rather than choosing new pins', () => {
  assert.equal(packageDifference(named, pkg), null);
  assert.match(packageDifference(named, { ...pkg, revision: 3 })!, /revision 3, not 2/);
  assert.match(packageDifference({ ...named, reviewFingerprint: 'b'.repeat(64) }, pkg)!, /another review/);
  assert.match(packageDifference(named, { ...pkg, review: undefined })!, /no review/);
});

test('a confirmation still refuses a package whose intake item belongs to another case', async () => {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  let checkedMembership = false;
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{ id, revision: 0, archived: false }] };
    if (sql.startsWith('SELECT confirmation_id,input_sha256')) return { rows: [] };
    if (sql.startsWith('SELECT p.body FROM import_packages')) {
      assert.match(sql, /usp_intake_items/);
      assert.match(sql, /i\.case_id=\$2/);
      assert.deepEqual(values, [named.packageId, other]);
      checkedMembership = true;
      return { rows: [] };
    }
    assert(['BEGIN', 'ROLLBACK'].includes(sql), sql);
    return { rows: [] };
  } } as unknown as PoolClient;
  globals.ulpinPool = { connect: async () => client } as unknown as Pool;
  try {
    await assert.rejects(confirmIntake(other, { requestKey: id, packages: [named], targets: [],
      acknowledgement: 'Fixture physical observations only.' }), { code: 'INTAKE_CONFIRMATION_STALE' });
    assert(checkedMembership);
  } finally {
    globals.ulpinPool = previous;
  }
});

test('a cards-only confirmation refuses, in words, a carded, stopped, listed or unrecorded building', () => {
  const pin = { ...named, revision: 1 };
  const recorded = { readiness: 'recorded', confirmation_id: null, pin };
  assert.equal(cardTargetDifference(other, recorded), null);
  assert.equal(cardTargetDifference(other, { ...recorded, readiness: 'carded' }),
    `Target ${other} is carded; only a recorded building with no card can be named.`);
  assert.equal(cardTargetDifference(other, { ...recorded, readiness: 'stopped' }),
    `Target ${other} is stopped; only a recorded building with no card can be named.`);
  assert.equal(cardTargetDifference(other, { ...recorded, readiness: 'ready', pin: null }),
    `Target ${other} belongs to a package no confirmation of this case has recorded.`);
  assert.equal(cardTargetDifference(other, { ...recorded, confirmation_id: id }),
    `Target ${other} is already listed in confirmation ${id}.`);
  assert.equal(cardTargetDifference(other, undefined), `Target ${other} is not in this case.`);
});

/** confirmIntake on a store that answers the cards-only checks and records what it was asked to write. */
async function confirmCards(targets: { target_id: string; readiness: string; confirmation_id: string | null;
  pin: typeof named | null }[]) {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const written: { sql: string; values: unknown[] }[] = [];
  const stored = new Error('stored');
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT id,revision,archived')) return { rows: [{ id: other, revision: 0, archived: false }] };
    if (sql.startsWith('SELECT confirmation_id,input_sha256')) return { rows: [] };
    if (sql.startsWith('SELECT t.target_id,t.readiness')) {
      assert.match(sql, /c\.case_id=\$1/);
      assert.match(sql, /COMMITTED/);
      assert.deepEqual(values, [other, targets.map(row => row.target_id)]);
      return { rows: targets };
    }
    if (sql.startsWith('INSERT INTO usp_intake_confirmations') || sql.startsWith('UPDATE usp_intake_targets')) {
      written.push({ sql, values });
      return { rows: sql.startsWith('UPDATE') ? targets.map(row => ({ target_id: row.target_id,
        readiness: values[2], stage: 3 })) : [] };
    }
    if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: 0 }] };
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: '1' }] };
    if (sql.startsWith('INSERT INTO usp_outbox')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM jobs')) return { rows: [{ id }] };
    if (sql.startsWith('SELECT * FROM usp_intake_confirmations')) throw stored;
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as PoolClient;
  globals.ulpinPool = { connect: async () => client } as unknown as Pool;
  try {
    const input = { requestKey: id, packages: [], targets: targets.map(row => row.target_id),
      acknowledgement: 'Cards for recorded buildings.' };
    await confirmIntake(other, input).catch(error => { if (error !== stored) throw error; });
    return written;
  } finally {
    globals.ulpinPool = previous;
  }
}

test('a cards-only confirmation stores the recording pins and keeps its buildings recorded, in order', async () => {
  const pin = { ...named, revision: 1 };
  const ids = ['10000000-0000-4000-8000-000000000033', '10000000-0000-4000-8000-000000000031'];
  const [insert, update] = await confirmCards(ids.map(target_id => ({ target_id, readiness: 'recorded',
    confirmation_id: null, pin })));
  assert.deepEqual(JSON.parse(insert.values[6] as string), [pin]);
  assert.deepEqual(insert.values[7], ids);
  assert.match(insert.values[8] as string, / to card buildings already recorded\.$/);
  assert.deepEqual(update.values.slice(1), [ids, 'recorded', 'Listed for a card; it is carded in the order listed.']);
});

test('a cards-only confirmation naming one refused building stores nothing', async () => {
  const target = { target_id: other, readiness: 'carded', confirmation_id: id, pin: named };
  await assert.rejects(confirmCards([target]), { code: 'INTAKE_CONFIRMATION_STALE',
    message: `Target ${other} is carded; only a recorded building with no card can be named.` });
  await assert.rejects(confirmCards([{ ...target, readiness: 'ready', pin: null }]),
    { code: 'INTAKE_CONFIRMATION_STALE',
      message: `Target ${other} belongs to a package no confirmation of this case has recorded.` });
});

test('the stored list is bounded and cannot contain commands to resolve conflicts or assume facts', () => {
  const input = { requestKey: id, acknowledgement: 'Protocol acknowledgement', packages: [named], targets: [other] };
  assert(IntakeConfirmSchema.safeParse(input).success);
  for (const extra of [{ resolveConflict: true }, { matches: [id, other] }, { owner: 'assumed' }, { height: 0 }]) {
    assert(!IntakeConfirmSchema.safeParse({ ...input, ...extra }).success);
  }
  assert(!IntakeConfirmSchema.safeParse({ ...input, targets: Array(101).fill(other) }).success);
  assert(!IntakeConfirmSchema.safeParse({ ...input, targets: [other, other] }).success);
  assert(IntakeConfirmSchema.safeParse({ ...input, packages: [] }).success);
  assert(!IntakeConfirmSchema.safeParse({ ...input, packages: [], targets: [] }).success);
});

test('the stored acknowledgement preserves the officer words so a whitespace change is a different input', () => {
  const input = { requestKey: id, acknowledgement: '  Protocol acknowledgement  ',
    packages: [named], targets: [other] };
  const parsed = IntakeConfirmSchema.parse(input);
  assert.equal(parsed.acknowledgement, input.acknowledgement);
  assert.notEqual(parsed.acknowledgement,
    IntakeConfirmSchema.parse({ ...input, acknowledgement: input.acknowledgement.trim() }).acknowledgement);
  assert(!IntakeConfirmSchema.safeParse({ ...input, acknowledgement: '   ' }).success);
});

test('two matches remain conflicting: the run does not resolve them or pick the first citation', () => {
  const pointer = { legacyLocator: 'feature protocol-key' };
  assert.equal(intakeTargetCitation([pointer], pointer.legacyLocator), pointer);
  assert.throws(() => intakeTargetCitation([pointer, { ...pointer }], pointer.legacyLocator),
    { code: 'INTAKE_TARGET_CITATION' });
  assert.throws(() => intakeTargetCitation([], pointer.legacyLocator), { code: 'INTAKE_TARGET_CITATION' });
});

test('a product refusal stops, while infrastructure faults are retried by the authority', () => {
  assert.deepEqual(intakeRunRefusal(new AppError(409, 'USP_STALE_TARGET', 'Pin moved.')),
    { code: 'USP_STALE_TARGET', message: 'Pin moved.' });
  assert.equal(intakeRunRefusal(new AppError(503, 'UNAVAILABLE', 'Timeout.')), null);
  assert.equal(intakeRunRefusal(new AppError(408, 'BODY_TIMEOUT', 'Timeout.')), null);
  assert.equal(intakeRunRefusal(new Error('Socket closed.')), null);
  const invalid = z.string().safeParse(0);
  assert(!invalid.success);
  assert.equal(intakeRunRefusal(invalid.error)?.code, 'INTAKE_RUN_INPUT');
});

test('consistency alone is insufficient: moved pins, expiry, revocation and supersession keep a target stopped', () => {
  const report = { result: 'consistent', snapshot: { state: 'same_revision' },
    lifecycle: { expired: false, superseded: false, revocation: null } } as PropertyCardVerification;
  assert.doesNotThrow(() => assertIntakeCardVerified(report));
  assert.throws(() => assertIntakeCardVerified({ ...report, snapshot: { ...report.snapshot,
    state: 'changed_revision' } }), { code: 'USP_STALE_TARGET' });
  for (const change of [{ expired: true }, { superseded: true },
    { revocation: { revokedAt: '2026-01-01T00:00:00Z', reasonCode: 'protocol_control' } }]) {
    assert.throws(() => assertIntakeCardVerified({ ...report, lifecycle: { ...report.lifecycle, ...change } }),
      { code: 'INTAKE_CARD_UNVERIFIED' });
  }
});

test('verification reads the exact revision from the saved card link, not a fabricated link', () => {
  const url = `http://127.0.0.1:3000/api/v1/usp/property-cards/${id}/revisions/1`;
  assert.deepEqual(intakeCardVerificationPin(url, { id, revision: 1 }), { cardId: id, revision: 1 });
  assert.throws(() => intakeCardVerificationPin(url, { id: other, revision: 1 }), { code: 'INTAKE_CARD_LINK' });
  assert.throws(() => intakeCardVerificationPin(url, { id, revision: 2 }), { code: 'INTAKE_CARD_LINK' });
  assert.throws(() => intakeCardVerificationPin(url.replace('127.0.0.1', 'example.org'), { id, revision: 1 }),
    { code: 'INTAKE_CARD_LINK' });
});

type Target = { target_id: string; package_id: string; readiness: string; blocked_by?: string; reason?: string;
  confirmation_id?: string; locator?: string; artefacts?: Record<string, unknown> };
const locator = 'feature fixture-key';
const made = { id, revision: 1 };

/** The carry steps answer as the product does when every step succeeds, each naming the fixture's one artefact. */
const cardSteps = {
  snapshot: async () => ({ id, digest: 'd'.repeat(64) }),
  resolve: async () => ({ state: 'available', data: { evidence: [{ legacyLocator: locator }] } }),
  createPlan: async () => ({ planId: id, version: 1, planSha256: 'c'.repeat(64), entries: [{ state: 'included' }] }),
  confirmPlan: async () => ({ confirmationId: id }),
  executePlan: async () => ({ packet: { packetId: id } }),
  card: async () => ({ cardId: made.id, revision: made.revision }),
  readCard: async () => ({ card: { resolverUrl: `http://127.0.0.1:3000/api/v1/usp/property-cards/${id}/revisions/1` }
  }),
  verify: async () => ({ report: { snapshot: { state: 'same_revision' }, result: 'consistent',
    lifecycle: { expired: false, revocation: null, superseded: null } } }),
} as unknown as Partial<IntakeRunSteps>;

/** One confirmation of three packages, one listed building each, on a store that answers the run's own SQL.
 * A cards-only one lists the three recorded buildings in the order given, and its packages are already recorded.
 * `late` names an evidence confirmation whose own job is run for the first building instead. */
function commitRun(loseLeaseAtRenewal = 0, cardsOnly: number[] | null = null, late: string | null = null) {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  const caseId = '10000000-0000-4000-8000-000000000003';
  const binding = ingestionBinding(caseId);
  const confirmationId = '10000000-0000-4000-8000-000000000005';
  const ids = [1, 2, 3].map(n => `10000000-0000-4000-8000-00000000001${n}`);
  const targetIds = [1, 2, 3].map(n => `10000000-0000-4000-8000-00000000002${n}`);
  const order = late ? { phase: 'evidence', confirmationId: late, targetId: targetIds[0] }
    : { phase: 'commit', confirmationId };
  const input = IntakeRunInputSchema.parse({ version: 'intake-run/1', jobId: '10000000-0000-4000-8000-000000000004',
    caseId, caseRevision: 0, subject: binding.subject, accessSha256: binding.access, ...order });
  const createdAt = new Date();
  const confirmation = { confirmation_id: confirmationId, case_id: caseId, subject: binding.subject,
    acknowledgement: 'Fixture physical observations only.', expires_at: new Date(Date.now() + 3600_000),
    packages: ids.map(packageId => ({ ...named, packageId })), targets: cardsOnly?.map(n => targetIds[n - 1]) ?? [],
    created_at: createdAt, reason: intakeConfirmationReason(confirmationId, createdAt, Boolean(cardsOnly)) };
  const store = { status: 'queued', logical: 'queued', error: null as string | null, renewals: 0,
    attempts: [] as { number: number; fence: number; owner: string; state: string; lease_until: Date;
      failure_cause?: unknown }[],
    targets: ids.map(id => ({ target_id: `target:${id}`, package_id: id, readiness: 'confirmed' })) as Target[],
    committed: [] as string[], carded: [] as string[], pending: [] as { target: string; row: unknown }[],
    streamVersion: 0, snapshotTransactions: [] as number[] };
  if (cardsOnly) store.targets = ids.map((id, index) => ({ target_id: targetIds[index], package_id: id,
    readiness: 'recorded', confirmation_id: confirmationId, locator, artefacts: { record: made } }));
  const attempt = (number: unknown) => store.attempts.find(row => row.number === number);
  let transactionNumber = 0, repeatableVersion: number | null = null;
  const answers: [string, (values: unknown[], sql: string) => unknown[]][] = [
    ['SELECT * FROM jobs', () => [{ id: input.jobId, status: store.status, payload: input }]],
    ['SELECT status FROM jobs', () => [{ status: store.status }]],
    ['SELECT id,revision,archived FROM cases', () => [{ id: caseId, revision: 0, archived: false }]],
    ['SELECT id FROM cases WHERE id=$1 FOR KEY SHARE', () => [{ id: caseId }]],
    ['SELECT * FROM usp_job_metadata', () => [{ logical_state: store.logical, input_sha256: fingerprint(input) }]],
    ['SELECT * FROM usp_job_attempts WHERE job_id=$1 ORDER BY', () => store.attempts.slice(-1)],
    ['SELECT * FROM usp_job_attempts WHERE job_id=$1 AND number=$2', values =>
      [{ ...attempt(values[1]), input_sha256: fingerprint(input) }]],
    ['INSERT INTO usp_job_attempts', ([, number, fence, owner]) => {
      store.attempts.push({ number: number as number, fence: fence as number, owner: owner as string,
        state: 'active', lease_until: new Date(Date.now() + 180_000) });
      return store.attempts.slice(-1);
    }],
    ['UPDATE usp_job_attempts SET lease_until', ([, number]) => {
      const row = attempt(number)!;
      if (++store.renewals === loseLeaseAtRenewal) row.lease_until = new Date(0);
      return row.state === 'active' && row.lease_until.getTime() > Date.now() ? [row] : [];
    }],
    ['UPDATE usp_job_attempts SET failure_cause=', ([, number, cause]) => {
      const row = attempt(number)!;
      assert.equal(row.state, 'active', 'the cause must be stored before fencing');
      row.failure_cause = cause;
      return [];
    }],
    ['UPDATE usp_job_attempts SET state=', (values, sql) => {
      attempt(values.at(-1))!.state = /state='(\w+)'/.exec(sql)![1];
      return [];
    }],
    ['UPDATE usp_job_metadata SET logical_state=', (_values, sql) => {
      store.logical = /logical_state='(\w+)'/.exec(sql)![1];
      return [];
    }],
    ['UPDATE jobs SET status=', (values, sql) => {
      store.status = /status='(\w+)'/.exec(sql)![1];
      if (store.status === 'failed') store.error = values[1] as string;
      return [];
    }],
    ['UPDATE jobs SET error=', () => { store.error = 'INTAKE_RUN_RETRY'; return []; }],
    ['SELECT * FROM usp_intake_confirmations', () => [confirmation]],
    ['UPDATE usp_intake_targets t SET readiness=\'recorded\'', ([id]) => {
      for (const row of store.targets) if (row.package_id === id && row.readiness === 'confirmed') {
        row.readiness = 'recorded';
      }
      return [];
    }],
    ['SELECT target_id,readiness FROM usp_intake_targets', () => []],
    ['SELECT target_id FROM usp_intake_targets', ([, id]) => store.targets.filter(row =>
      row.readiness === 'confirmed' && (id === undefined || row.package_id === id))],
    ['UPDATE usp_intake_targets SET readiness=\'stopped\'', ([id, , code, message]) => {
      Object.assign(store.targets.find(row => row.target_id === id)!,
        { readiness: 'stopped', blocked_by: code, reason: message });
      return [];
    }],
    ['SELECT * FROM usp_intake_targets WHERE target_id=$1', ([id]) =>
      [structuredClone(store.targets.find(row => row.target_id === id))]],
    ['SET TRANSACTION ISOLATION LEVEL', () => {
      repeatableVersion = store.streamVersion;
      store.snapshotTransactions.push(transactionNumber);
      return [];
    }],
    ['SELECT confirmation_id,pins,acknowledgement,expires_at', ([, decisions]) => {
      const { targetId } = JSON.parse(decisions as string)[0];
      return store.pending.flatMap(item => item.target === targetId ? [item.row] : []);
    }],
    ['SELECT body FROM usp_snapshot_bodies', () => []],
    ['SELECT site_id FROM registry_records', () => [{ site_id: caseId }]],
    ['SELECT body FROM usp_snapshots', () => [{ body: { scope: { kind: 'targets', pins: [] } } }]],
    ['UPDATE usp_intake_targets SET stage=', ([id, stage, readiness, reason, artefacts]) => {
      const row = store.targets.find(value => value.target_id === id)!;
      Object.assign(row, { readiness, reason, artefacts: { ...row.artefacts, ...artefacts as object } });
      if (readiness === 'carded') store.carded.push(id as string);
      return [{ case_id: caseId, target_id: id, readiness, stage }];
    }],
    ['UPDATE usp_outbox_streams', () => [{ sequence: '1' }]],
    ['INSERT INTO usp_outbox', () => []],
    ['SELECT revision FROM cases', () => [{ revision: 0 }]],
  ];
  const ask = async (sql: string, values: unknown[] = []) => {
    if (sql === 'BEGIN') {
      transactionNumber++;
      repeatableVersion = null;
    }
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('INSERT INTO usp_outbox_streams') && repeatableVersion !== null
      && repeatableVersion !== store.streamVersion) {
      throw Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' });
    }
    const text = sql.replace(/\s+/g, ' ');
    const answer = answers.find(([start]) => text.startsWith(start));
    assert(answer, `Unexpected query: ${text}`);
    return { rows: answer[1](values, text) };
  };
  const steps: IntakeRunSteps = { ...intakeRunSteps, ...cardSteps,
    package: (async (id: string) => ({ ...pkg, id, ...(cardsOnly || store.committed.includes(id)
      ? { state: 'COMMITTED', revision: named.revision + 1 } : {}) })) as IntakeRunSteps['package'],
    commit: (async (id: string) => { store.committed.push(id); }) as unknown as IntakeRunSteps['commit'] };
  const run = async (change: Partial<IntakeRunSteps> = {}) => {
    const globals = globalThis as unknown as { ulpinPool?: unknown };
    const previous = globals.ulpinPool;
    globals.ulpinPool = { query: ask, connect: async () => ({ query: ask, release() {} }) };
    try {
      await runIntakeRunJob(input.jobId, { ...steps, ...change });
    } finally {
      globals.ulpinPool = previous;
    }
  };
  return { caseId, confirmationId, confirmation, ids, targetIds, store, run };
}

test('a confirmation run renews its lease after each committed package', async () => {
  const { ids, store, run } = commitRun();
  await run();
  assert.equal(store.renewals, 3);
  assert.deepEqual(store.committed, ids);
  assert.deepEqual(store.targets.map(row => row.readiness), ['recorded', 'recorded', 'recorded']);
  assert.equal(store.status, 'succeeded');
});

test('a lease lost after package 2 stops nothing, and the retry commits only package 3', async () => {
  const { ids, store, run } = commitRun(2);
  await assert.rejects(run(), { status: 503, code: 'INTAKE_RUN_LEASE_LOST' });
  assert.deepEqual(store.committed, ids.slice(0, 2));
  assert.deepEqual(store.targets.map(row => row.readiness), ['recorded', 'recorded', 'confirmed']);
  assert.deepEqual([store.status, store.logical, store.error, store.attempts[0].state],
    ['running', 'running', null, 'active']);
  assert.equal(store.attempts[0].failure_cause, undefined, 'a lost lease records no failure');
  await run();
  assert.deepEqual(store.committed, ids);
  assert.equal(store.renewals, 5);
  assert.deepEqual(store.targets.map(row => row.readiness), ['recorded', 'recorded', 'recorded']);
  assert.deepEqual([store.status, store.attempts.length], ['succeeded', 2]);
});

test('a thrown infrastructure error keeps its bounded cause on the fenced attempt', async () => {
  const { store, run } = commitRun();
  const error = Object.assign(new Error('Private infrastructure detail.'), { code: '40P01' });
  const commit = (async () => { throw error; }) as unknown as IntakeRunSteps['commit'];
  await assert.rejects(run({ commit }), error);
  assert.equal(store.attempts[0].state, 'fenced');
  assert.deepEqual(store.attempts[0].failure_cause, { errorCode: 'INTAKE_RUN_RETRY', code: '40P01',
    class: 'Error', message: 'Private infrastructure detail.' });
  assert.equal(store.error, 'INTAKE_RUN_RETRY');
});

test('a package refused by its own checks still stops its building in its own words', async () => {
  const { ids, store, run } = commitRun();
  const refusal = new AppError(422, 'PACKAGE_REVIEW_REQUIRED', 'The package needs a current review.');
  const commit = async (id: string) => {
    if (id === ids[1]) throw refusal;
    store.committed.push(id);
  };
  await assert.rejects(run({ commit: commit as unknown as IntakeRunSteps['commit'] }), refusal);
  assert.deepEqual(store.committed, [ids[0], ids[2]]);
  assert.equal(store.renewals, 3);
  assert.deepEqual(store.targets[1], { target_id: `target:${ids[1]}`, package_id: ids[1], readiness: 'stopped',
    blocked_by: refusal.code, reason: refusal.message });
  assert.deepEqual([store.targets[0].readiness, store.targets[2].readiness], ['recorded', 'recorded']);
  assert.deepEqual([store.status, store.error, store.attempts[0].state], ['failed', refusal.code, 'fenced']);
});

test('a cards-only confirmation of three recorded buildings makes three cards in its order and commits nothing',
  async () => {
    const { targetIds, store, run } = commitRun(0, [3, 1, 2]);
    await run();
    assert.deepEqual(store.carded, [targetIds[2], targetIds[0], targetIds[1]]);
    assert.deepEqual(store.committed, []);
    assert.equal(store.renewals, 3);
    assert.deepEqual(store.targets.map(row => row.readiness), ['carded', 'carded', 'carded']);
    assert.equal(store.status, 'succeeded');
  });

test('a cards-only run that loses its lease after card 2 makes only card 3 on its retry', async () => {
  const { targetIds, store, run } = commitRun(2, [1, 2, 3]);
  await assert.rejects(run(), { status: 503, code: 'INTAKE_RUN_LEASE_LOST' });
  assert.deepEqual(store.carded, targetIds.slice(0, 2));
  await run();
  assert.deepEqual(store.carded, targetIds);
  assert.deepEqual([store.committed, store.status, store.attempts.length], [[], 'succeeded', 2]);
});

test('a cards-only building refused at a step stops in its own words; the others are still carded', async () => {
  const { targetIds, store, run } = commitRun(0, [1, 2, 3]);
  const refusal = new AppError(409, 'USP_STALE_TARGET', 'The card target changed after it was pinned.');
  let calls = 0;
  const resolve = async () => {
    if (++calls === 2) throw refusal;
    return { state: 'available', data: { evidence: [{ legacyLocator: locator }] } };
  };
  await assert.rejects(run({ resolve: resolve as unknown as IntakeRunSteps['resolve'] }), refusal);
  assert.deepEqual(store.carded, [targetIds[0], targetIds[2]]);
  assert.deepEqual([store.targets[1].readiness, store.targets[1].blocked_by, store.targets[1].reason],
    ['stopped', refusal.code, refusal.message]);
  assert.deepEqual([store.renewals, store.committed, store.status, store.error], [3, [], 'failed', refusal.code]);
});

test('a surface event during snapshot capture cannot spend a card job attempt on outbox serialization', async () => {
  const { store, run } = commitRun(0, [1]);
  const snapshot = async () => {
    // test_only: a surface worker commits to the same case stream after the repeatable-read view began.
    store.streamVersion++;
    return { id, digest: 'd'.repeat(64) };
  };
  await run({ snapshot } as unknown as Partial<IntakeRunSteps>);
  assert.equal(store.snapshotTransactions.length, 1, 'capture still uses repeatable read');
  assert.deepEqual([store.status, store.attempts.length, store.targets[0].readiness], ['succeeded', 1, 'carded']);
});

test('a snapshot captured before lease loss is never linked by the fenced attempt', async () => {
  const { store, run } = commitRun(0, [1]);
  const snapshot = async () => {
    store.attempts[0].lease_until = new Date(0);
    return { id, digest: 'd'.repeat(64) };
  };
  await assert.rejects(run({ snapshot } as unknown as Partial<IntakeRunSteps>),
    { code: 'INTAKE_RUN_LEASE_LOST' });
  assert.equal(store.targets[0].artefacts!.snapshot, undefined);
  assert.equal(store.targets[0].readiness, 'recorded');
  assert.equal(store.attempts[0].state, 'active');
});

test('a building with confirmed evidence is pinned at its cited revision; the others as recorded', async () => {
  const { targetIds, store, run } = commitRun(0, [1, 2, 3]);
  const written = { confirmationIds: ['10000000-0000-4000-8000-000000000031'],
    record: { ...made, revision: made.revision + 1 } };
  const pins: number[] = [];
  const citeEvidence = async (_tx: unknown, building: { targetId: string }) =>
    building.targetId === targetIds[1] ? written : null;
  const snapshot = async (_client: unknown, _ctx: unknown, _site: string, selection: { pins: TargetPin[] }) => {
    pins.push(selection.pins[0].revision);
    return { id, digest: 'd'.repeat(64) };
  };
  await run({ citeEvidence, snapshot } as unknown as Partial<IntakeRunSteps>);
  assert.deepEqual(pins, [1, 2, 1]);
  assert.deepEqual([store.carded, store.status], [targetIds, 'succeeded']);
});

type OpenRun = ReturnType<typeof commitRun>;
type Stored = { confirmationId: string; packages: string[]; status: () => string };

/** The recording query answered from stored confirmations, oldest first: the one naming each asked package whose
 * job is queued or running, never `except` and never a recorded package. */
function recordingRows(values: unknown[], open: OpenRun, others: Stored[]) {
  const [caseId, packageIds, except] = values as [string, string[], string | null];
  const stored = [{ confirmationId: open.confirmationId, packages: open.ids, status: () => open.store.status },
    ...others];
  return packageIds.flatMap(id => {
    const by = caseId === open.caseId && !open.store.committed.includes(id) ? stored.find(row =>
      row.confirmationId !== except && row.packages.includes(id) && ['queued', 'running'].includes(row.status()))
      : undefined;
    return by ? [{ package_id: id, confirmation_id: by.confirmationId }] : [];
  });
}

/** confirmIntake naming one package and one ready building of it, in the case of `open`'s confirmation, on a store
 * where that confirmation is the only other: it names its packages while its run's job is queued or running. */
async function confirmBeside(open: OpenRun, packageId: string) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const stored: unknown[][] = [];
  const done = new Error('stored');
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT id,revision,archived')) {
      return { rows: [{ id: open.caseId, revision: 0, archived: false }] };
    }
    if (sql.startsWith('SELECT confirmation_id,input_sha256')) return { rows: [] };
    if (sql.startsWith('SELECT p.body FROM import_packages')) return { rows: [{ body: { ...pkg, id: values[0] } }] };
    if (sql.startsWith('SELECT DISTINCT ON (p.id)')) return { rows: recordingRows(values, open, []) };
    if (sql.startsWith('SELECT target_id,package_id,readiness')) {
      return { rows: [{ target_id: other, package_id: packageId, readiness: 'ready' }] };
    }
    if (sql.startsWith('INSERT INTO usp_intake_confirmations')) {
      stored.push(values);
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE usp_intake_targets')) {
      return { rows: [{ target_id: other, readiness: 'confirmed', stage: 2 }] };
    }
    if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: 0 }] };
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: '1' }] };
    if (sql.startsWith('INSERT INTO usp_outbox')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM jobs')) return { rows: [{ id }] };
    if (sql.startsWith('SELECT * FROM usp_intake_confirmations')) throw done;
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as PoolClient;
  globals.ulpinPool = { connect: async () => client } as unknown as Pool;
  try {
    await confirmIntake(open.caseId, { requestKey: other, packages: [{ ...named, packageId }], targets: [other],
      acknowledgement: 'Record this package.' }).catch(error => { if (error !== done) throw error; });
    return stored;
  } finally {
    globals.ulpinPool = previous;
  }
}

test('a package a running confirmation names cannot be confirmed again; once that run stops, it can', async () => {
  const open = commitRun();
  const [, refused] = open.ids;
  await assert.rejects(confirmBeside(open, refused), { status: 409, code: 'INTAKE_CONFIRMATION_PENDING',
    message: `Package ${refused} is already being recorded by confirmation ${open.confirmationId}.` });
  const refusal = new AppError(422, 'PACKAGE_REVIEW_REQUIRED', 'The package needs a current review.');
  const commit = async (id: string) => {
    if (id === refused) throw refusal;
    open.store.committed.push(id);
  };
  await assert.rejects(open.run({ commit: commit as unknown as IntakeRunSteps['commit'] }), refusal);
  assert.deepEqual([open.store.status, open.store.targets[1].readiness], ['failed', 'stopped']);
  const [stored] = await confirmBeside(open, refused);
  assert.deepEqual(JSON.parse(stored[6] as string), [{ ...named, packageId: refused }]);
});

/** retryIntakeConfirmation of `open`'s confirmation beside the `others`; it says whether the commit was queued again,
 * and keeps the case lock, every package lock and the recording query it was asked, in order. */
async function retryBeside(open: OpenRun, others: Stored[]) {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  const previous = globals.ulpinPool;
  const asked: { sql: string; values: unknown[] }[] = [];
  let requeued = false;
  const done = new Error('read');
  const client = { release() {}, query: async (sql: string, values: unknown[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('SELECT id,revision,archived')) {
      if (sql.endsWith('FOR UPDATE')) asked.push({ sql, values });
      return { rows: [{ id: open.caseId, revision: 0, archived: false }] };
    }
    if (sql.startsWith('SELECT * FROM usp_intake_confirmations')) {
      if (!sql.endsWith('FOR UPDATE')) throw done;
      return { rows: [open.confirmation] };
    }
    if (sql.startsWith('SELECT id FROM import_packages')) {
      asked.push({ sql, values });
      return { rows: [{ id: values[0] }] };
    }
    if (sql.startsWith('SELECT DISTINCT ON (p.id)')) {
      asked.push({ sql, values });
      return { rows: recordingRows(values, open, others) };
    }
    if (sql.startsWith('UPDATE usp_intake_targets SET readiness=CASE')) {
      const stopped = open.store.targets.filter(row => row.readiness === 'stopped');
      for (const row of stopped) row.readiness = 'confirmed';
      // The run's fixture names its targets by package; the event carries each one's own id.
      return { rows: stopped.map(row => ({ target_id: open.targetIds[open.store.targets.indexOf(row)],
        readiness: 'confirmed', stage: 2 })) };
    }
    if (sql.startsWith('SELECT revision FROM cases')) return { rows: [{ revision: 0 }] };
    if (sql.startsWith('UPDATE usp_outbox_streams')) return { rows: [{ sequence: '1' }] };
    if (sql.startsWith('INSERT INTO usp_outbox')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM jobs')) {
      requeued = true;
      return { rows: [{ id }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  } } as unknown as PoolClient;
  globals.ulpinPool = { connect: async () => client } as unknown as Pool;
  try {
    await retryIntakeConfirmation(open.caseId, open.confirmationId)
      .catch(error => { if (error !== done) throw error; });
    return { requeued, asked };
  } finally {
    globals.ulpinPool = previous;
  }
}

test('a stopped confirmation is not retried while another open run records its package; once that ends, it is',
  async () => {
    const open = commitRun();
    const [, taken] = open.ids;
    const commit = async (id: string) => {
      if (id === taken) throw new AppError(422, 'PACKAGE_REVIEW_REQUIRED', 'The package needs a current review.');
      open.store.committed.push(id);
    };
    await assert.rejects(open.run({ commit: commit as unknown as IntakeRunSteps['commit'] }));
    assert.deepEqual([open.store.status, open.store.targets[1].readiness], ['failed', 'stopped']);
    const [storedB] = await confirmBeside(open, taken);
    let status = 'queued';
    const b: Stored = { confirmationId: storedB[0] as string, packages: [taken], status: () => status };
    await assert.rejects(retryBeside(open, [b]), { status: 409, code: 'INTAKE_CONFIRMATION_PENDING',
      message: `Package ${taken} is already being recorded by confirmation ${b.confirmationId}.` });
    assert.equal(open.store.targets[1].readiness, 'stopped');
    status = 'failed';
    const retried = await retryBeside(open, [b]);
    assert.deepEqual([retried.requeued, open.store.targets[1].readiness], [true, 'confirmed']);
    assert.deepEqual(retried.asked.map(call => /FROM (\w+)/.exec(call.sql)![1]),
      ['cases', ...open.ids.map(() => 'import_packages'), 'usp_intake_confirmations']);
    assert.match(retried.asked[0].sql, /FOR UPDATE$/);
    assert.deepEqual(retried.asked.slice(1, 4).map(call => call.values[0]), open.ids);
    assert.deepEqual(retried.asked.at(-1)!.values, [open.caseId, open.ids, open.confirmationId]);
  });

/** An evidence confirmation stored after its building was carded, as the store holds it until it is written. */
function lateConfirmation(caseId: string, confirmationId: string) {
  return { confirmation_id: confirmationId, case_id: caseId, subject: process.env.ULPIN_LOCAL_OPERATOR_SUBJECT,
    acknowledgement: 'Checked the register row.', expires_at: new Date(Date.now() + 3600_000),
    created_at: new Date('2026-10-21T00:00:00.000Z') };
}

/** The writer as the run sees it: each pending confirmation is written once as the next record revision, and the
 * target keeps what the writer's own transaction keeps; a card is named by the request key that made it. */
function lateSteps(run: ReturnType<typeof commitRun>) {
  const { store } = run, writes: { record: number; written: unknown }[] = [], pins: number[] = [];
  const cards: { cardId: unknown; requestKey: string }[] = [];
  const citeEvidence = async (_tx: unknown, building: { targetId: string; record: { revision: number };
    written?: { confirmationIds: string[] } }) => {
    const ids = store.pending.filter(item => item.target === building.targetId)
      .map(item => (item.row as { confirmation_id: string }).confirmation_id);
    if (!ids.length) return null;
    writes.push({ record: building.record.revision, written: building.written });
    store.pending = store.pending.filter(item => item.target !== building.targetId);
    const written = { confirmationIds: [...building.written?.confirmationIds ?? [], ...ids],
      record: { ...made, revision: building.record.revision + 1 } };
    const row = store.targets.find(target => target.target_id === building.targetId)!;
    const { snapshot, plan, planConfirmation, packet, card, verification, ...kept } = row.artefacts!;
    Object.assign(row, { readiness: 'recorded', artefacts: { ...kept, evidence: written } });
    return written;
  };
  const snapshot = async (_client: unknown, _ctx: unknown, _site: string, selection: { pins: TargetPin[] }) => {
    pins.push(selection.pins[0].revision);
    return { id, digest: 'd'.repeat(64) };
  };
  const card = async (_ctx: unknown, command: { cardId: unknown; guard: { requestKey: string } }) => {
    cards.push({ cardId: command.cardId, requestKey: command.guard.requestKey });
    return { cardId: stableUuid(command.guard.requestKey), revision: 1 };
  };
  const readCard = async (_ctx: unknown, made: { cardId: string; revision: number }) => ({ card: {
    resolverUrl: `http://127.0.0.1:3000/api/v1/usp/property-cards/${made.cardId}/revisions/${made.revision}` } });
  return { writes, pins, cards,
    steps: { citeEvidence, snapshot, card, readCard } as unknown as Partial<IntakeRunSteps> };
}

test('evidence confirmed after a building is carded is written once and carried to a new card; the first card is '
  + 'kept and a replay writes nothing', async () => {
  const lateId = '10000000-0000-4000-8000-000000000041';
  const open = commitRun(0, [1, 2, 3], lateId), { store, targetIds, caseId } = open;
  const first = { id: other, revision: 1 };
  store.targets[0] = { ...store.targets[0], readiness: 'carded', artefacts: { record: made,
    snapshot: { id, digest: 'd'.repeat(64) }, identity: 'not_applicable: codes are for recorded spaces only',
    plan: { id, version: 1, sha256: 'c'.repeat(64) }, planConfirmation: { id }, packet: { id }, card: first,
    verification: 'consistent' } };
  store.pending.push({ target: targetIds[0], row: lateConfirmation(caseId, lateId) });
  const late = lateSteps(open);
  await open.run(late.steps);
  assert.deepEqual(late.writes, [{ record: 1, written: undefined }], 'written once, at the carded revision');
  assert.deepEqual(late.pins, [2], 'the new snapshot pins the cited revision');
  assert.deepEqual(late.cards, [{ cardId: null, requestKey: intakeRunKey(lateId, targetIds[0], 'card') }],
    'a new card under the late confirmation; the first card is never sent to a step');
  const [target] = store.targets;
  assert.equal(target.readiness, 'carded');
  assert.deepEqual(target.artefacts!.card, { id: stableUuid(intakeRunKey(lateId, targetIds[0], 'card')),
    revision: 1 });
  assert.notDeepEqual(target.artefacts!.card, first);
  assert.deepEqual(target.artefacts!.evidence, { confirmationIds: [lateId], record: { ...made, revision: 2 } });
  assert.deepEqual([store.carded, store.status], [[targetIds[0]], 'succeeded']);
  // The same job claimed again: the confirmation holds its receipt, so nothing is written or carded again.
  Object.assign(store, { status: 'queued', logical: 'queued' });
  await open.run(late.steps);
  assert.deepEqual([late.writes.length, late.pins.length, late.cards.length, store.carded.length], [1, 1, 1, 1]);
});

test('a confirmation stored while its building was carried is written when that carry ends; the others are not '
  + 'carded again', async () => {
  const lateId = '10000000-0000-4000-8000-000000000042';
  const open = commitRun(0, [1, 2, 3]), { store, targetIds, caseId } = open;
  const late = lateSteps(open), carded = late.steps.readCard!;
  // test_only: the officer confirms evidence for building 2 while its first card is being verified.
  const readCard = (async (ctx: never, made: never) => {
    if (store.targets[1].artefacts?.card && !store.targets[1].artefacts.evidence && !store.pending.length) {
      store.pending.push({ target: targetIds[1], row: lateConfirmation(caseId, lateId) });
    }
    return carded(ctx, made);
  }) as IntakeRunSteps['readCard'];
  await open.run({ ...late.steps, readCard });
  assert.deepEqual(late.pins, [1, 1, 2, 1], 'building 2 is pinned again at its cited revision before building 3');
  assert.deepEqual(late.cards.map(card => card.requestKey), [intakeRunKey(open.confirmationId, targetIds[0], 'card'),
    intakeRunKey(open.confirmationId, targetIds[1], 'card'), intakeRunKey(lateId, targetIds[1], 'card'),
    intakeRunKey(open.confirmationId, targetIds[2], 'card')]);
  assert.deepEqual(store.targets.map(target => target.readiness), ['carded', 'carded', 'carded']);
  assert.deepEqual([store.carded, store.status], [[targetIds[0], targetIds[1], targetIds[1], targetIds[2]],
    'succeeded']);
});
