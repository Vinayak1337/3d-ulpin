import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { ImportPackage } from '@ulpin/contracts';
import type { Pool, PoolClient } from 'pg';
import { IntakeConfirmSchema, type PropertyCardVerification } from '@ulpin/contracts/usp';
import { AppError } from '../../../infrastructure/errors';
import { fingerprint } from '../../cases/domain';
import { ingestionBinding } from './events';
import { confirmIntake, intakeConfirmationReason, packageDifference } from './intake-confirmations';
import { IntakeRunInputSchema, intakeRunKey } from './intake-run';
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

test('the stored list is bounded and cannot contain commands to resolve conflicts or assume facts', () => {
  const input = { requestKey: id, acknowledgement: 'Protocol acknowledgement', packages: [named], targets: [other] };
  assert(IntakeConfirmSchema.safeParse(input).success);
  for (const extra of [{ resolveConflict: true }, { matches: [id, other] }, { owner: 'assumed' }, { height: 0 }]) {
    assert(!IntakeConfirmSchema.safeParse({ ...input, ...extra }).success);
  }
  assert(!IntakeConfirmSchema.safeParse({ ...input, targets: Array(101).fill(other) }).success);
  assert(!IntakeConfirmSchema.safeParse({ ...input, targets: [other, other] }).success);
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

type Target = { target_id: string; package_id: string; readiness: string; blocked_by?: string; reason?: string };

/** One confirmation of three packages, one listed building each, on a store that answers the run's own SQL. */
function commitRun(loseLeaseAtRenewal = 0) {
  process.env.ULPIN_LOCAL_OPERATOR_SUBJECT ??= 'e1-protocol-operator';
  const caseId = '10000000-0000-4000-8000-000000000003';
  const binding = ingestionBinding(caseId);
  const confirmationId = '10000000-0000-4000-8000-000000000005';
  const input = IntakeRunInputSchema.parse({ version: 'intake-run/1', jobId: '10000000-0000-4000-8000-000000000004',
    caseId, caseRevision: 0, subject: binding.subject, accessSha256: binding.access, phase: 'commit', confirmationId });
  const ids = [1, 2, 3].map(n => `10000000-0000-4000-8000-00000000001${n}`);
  const confirmation = { confirmation_id: confirmationId, case_id: caseId, subject: binding.subject,
    acknowledgement: 'Fixture physical observations only.', expires_at: new Date(Date.now() + 3600_000),
    packages: ids.map(packageId => ({ ...named, packageId })), targets: [] };
  const store = { status: 'queued', logical: 'queued', error: null as string | null, renewals: 0,
    attempts: [] as { number: number; fence: number; owner: string; state: string; lease_until: Date }[],
    targets: ids.map(id => ({ target_id: `target:${id}`, package_id: id, readiness: 'confirmed' })) as Target[],
    committed: [] as string[] };
  const attempt = (number: unknown) => store.attempts.find(row => row.number === number);
  const answers: [string, (values: unknown[], sql: string) => unknown[]][] = [
    ['SELECT * FROM jobs', () => [{ id: input.jobId, status: store.status, payload: input }]],
    ['SELECT status FROM jobs', () => [{ status: store.status }]],
    ['SELECT id,revision,archived FROM cases', () => [{ id: caseId, revision: 0, archived: false }]],
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
    ['UPDATE usp_outbox_streams', () => [{ sequence: '1' }]],
    ['INSERT INTO usp_outbox', () => []],
  ];
  const ask = async (sql: string, values: unknown[] = []) => {
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    const text = sql.replace(/\s+/g, ' ');
    const answer = answers.find(([start]) => text.startsWith(start));
    assert(answer, `Unexpected query: ${text}`);
    return { rows: answer[1](values, text) };
  };
  const steps: IntakeRunSteps = { ...intakeRunSteps,
    package: (async (id: string) => ({ ...pkg, id, ...(store.committed.includes(id)
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
  return { ids, store, run };
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
  await run();
  assert.deepEqual(store.committed, ids);
  assert.equal(store.renewals, 5);
  assert.deepEqual(store.targets.map(row => row.readiness), ['recorded', 'recorded', 'recorded']);
  assert.deepEqual([store.status, store.attempts.length], ['succeeded', 2]);
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
