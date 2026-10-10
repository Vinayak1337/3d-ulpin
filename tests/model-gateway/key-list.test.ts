import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { hash, ModelGatewayConfigSchema, providerKeyReferences } from '@ulpin/server/modules/model-gateway/config';
import { SarvamAdapter, SarvamKeyListAdapter } from '@ulpin/server/modules/model-gateway/adapter';
import { PgModelCallLedger, type Transact } from '@ulpin/server/modules/model-gateway/ledger';
import { ModelGateway } from '@ulpin/server/modules/model-gateway/gateway';
import { cost, reservation } from '@ulpin/server/modules/model-gateway/pricing';
import { TeacherRecordings } from '@ulpin/server/modules/model-gateway/recordings';
import { profileColumns } from '@ulpin/server/modules/usp/ingestion/column-profile';
import { proposeMappingWithTeacher } from '@ulpin/server/modules/usp/ingestion/mapping-teacher';

// Software-control inputs only. Keys are synthetic, made here on every run, and never written to a file.
const names = ['ULPIN_PROVIDER_KEY_SARVAM_01', 'ULPIN_PROVIDER_KEY_SARVAM_02', 'ULPIN_PROVIDER_KEY_SARVAM_03'];
const keys = names.map(() => `gk1-synthetic-key-${randomBytes(12).toString('hex')}`);
const usage = { promptTokens: 100, completionTokens: 10 };
const policy = (overrides: Record<string, unknown> = {}) => ModelGatewayConfigSchema.parse({
  projectId: 'model-core-control', policyVersion: 'control-policy-v1', fundingVersion: 'control-funding-v1',
  gatewayExclusiveFunding: true, indiaPrivateApproved: true, secretReference: 'ULPIN_PROVIDER_KEY_CONTROL',
  model: 'sarvam-105b', projectCapMicroInr: '100000000', principalDailyCallCap: 20, paceMs: 1500,
  price: { version: 'h20-software-price-input-v1', inputPerMillionMicroInr: '29280000',
    cachedInputPerMillionMicroInr: '10980000', outputPerMillionMicroInr: '73200000' },
  inputBound: { version: 'control-byte-bound-v1', maxPromptTokens: 34816 }, ...overrides,
});
const listPolicy = (overrides: Record<string, unknown> = {}) =>
  policy({ secretReference: undefined, secretReferences: names, ...overrides });

type Row = Record<string, any>;
const openStates = ['reserved', 'dispatched', 'outcome_unknown', 'usage_unverified'];
function exposure(call: Row): bigint {
  if (call.state === 'released') return 0n;
  return BigInt(call.state === 'settled' ? call.actual_micro_inr : call.reserve_micro_inr);
}

/** The ledger's own statements over rows in memory, so the real PgModelCallLedger runs without a database. */
class FakeLedgerDb {
  budget?: Row;
  calls: Row[] = [];
  marks: Row[] = [];
  statements: string[] = [];
  ahead = 0;
  now = () => new Date(Date.now() + this.ahead);
  readonly tx: Transact = action => action({
    query: async (sql: string, values: any[] = []) => ({ rows: this.run(sql.replace(/\s+/g, ' ').trim(), values) }),
  } as any);
  private call = (id: string, state: string) => this.calls.find(row => row.id === id && row.state === state);
  private openMarks = () => this.marks.filter(mark => mark.restored_at === null);
  private run(sql: string, v: any[]): Row[] {
    this.statements.push(sql);
    const step = [...this.budgetSteps, ...this.callSteps, ...this.markSteps].find(([head]) => sql.startsWith(head));
    if (!step) throw new Error(`The fake ledger has no statement for: ${sql.slice(0, 70)}`);
    return step[1](v) ?? [];
  }
  private budgetSteps: [string, (v: any[]) => Row[] | void][] = [
    ['INSERT INTO usp_model_budget', v => {
      this.budget ??= { project_id: v[0], config_hash: v[1], config: JSON.parse(JSON.stringify(v[2])),
        credential_hash: v[3], blocked_reason: null, cooldown_until: null, next_admission_at: null };
    }],
    ['SELECT *, clock_timestamp() now FROM usp_model_budget', () => [{ ...this.budget, now: this.now() }]],
    ['SELECT * FROM usp_model_budget', () => this.budget ? [this.budget] : []],
    ['UPDATE usp_model_budget SET next_admission_at', v => {
      this.budget!.next_admission_at = new Date(this.now().getTime() + v[0]);
    }],
    ['UPDATE usp_model_budget SET blocked_reason=$1', v => { this.budget!.blocked_reason = v[0]; }],
    ["UPDATE usp_model_budget SET blocked_reason='deficit'", () => { this.budget!.blocked_reason = 'deficit'; }],
    ['UPDATE usp_model_budget SET cooldown_until', v => {
      const until = this.now().getTime() + v[0];
      this.budget!.cooldown_until = new Date(Math.max(until, this.budget!.cooldown_until?.getTime() ?? 0));
    }],
    ['UPDATE usp_model_budget SET config_hash=$1', v => {
      Object.assign(this.budget!, { config_hash: v[0], config: JSON.parse(JSON.stringify(v[1])),
        credential_hash: v[2], reconciled_at: this.now(), reconciled_reason: v[3] });
    }],
  ];
  private callSteps: [string, (v: any[]) => Row[] | void][] = [
    ['SELECT * FROM usp_model_calls WHERE project_id=$1', v => this.calls
      .filter(row => row.principal_hash === v[1] && row.invocation_key === v[2])
      .filter(row => v.length < 4 || row.attempt === v[3]).sort((a, b) => a.attempt - b.attempt)],
    ['SELECT * FROM usp_model_calls WHERE id=$1', v => this.calls.filter(row => row.id === v[0])],
    ['SELECT count(*)::int count FROM usp_model_calls WHERE state IN', () =>
      [{ count: this.calls.filter(row => openStates.includes(row.state)).length }]],
    ['SELECT count(*)::int count FROM usp_model_calls WHERE principal_hash=$1', v =>
      [{ count: this.calls.filter(row => row.principal_hash === v[0] && row.state !== 'released').length }]],
    ['SELECT COALESCE(sum(', () => {
      const sum = (rows: Row[]) => rows.reduce((total, row) => total + exposure(row), 0n).toString();
      return [{ total: sum(this.calls), other: sum(this.calls.filter(row => row.consumer !== 'INGEST')) }];
    }],
    ['INSERT INTO usp_model_calls', v => {
      const row = { id: v[0], project_id: v[1], principal_hash: v[2], invocation_key: v[3], attempt: v[4],
        consumer: v[5], input_hash: v[6], scope_hash: v[7], config_hash: v[8], state: 'reserved',
        reserve_micro_inr: v[11], deadline_at: v[12], credential_hash: v[13], actual_micro_inr: null,
        output: null, receipt: null, settlement_hash: null, error_kind: null };
      this.calls.push(row);
      return [row];
    }],
    ["UPDATE usp_model_calls SET state='dispatched'", v => {
      const row = this.call(v[0], 'reserved');
      return row ? [Object.assign(row, { state: 'dispatched' })] : [];
    }],
    ["UPDATE usp_model_calls SET state='released'", v => {
      Object.assign(this.call(v[0], 'reserved') ?? {}, { state: 'released', error_kind: 'pre_dispatch_rejected' });
    }],
    ['UPDATE usp_model_calls SET state=$2,error_kind=$3', v => {
      const row = this.call(v[0], 'dispatched');
      return row ? [Object.assign(row, { state: v[1], error_kind: v[2] })] : [];
    }],
    ["UPDATE usp_model_calls SET state='settled',actual_micro_inr=0", v => {
      const row = this.call(v[0], 'dispatched');
      return row ? [Object.assign(row, { state: 'settled', actual_micro_inr: '0', receipt: v[1],
        settlement_hash: v[2], error_kind: v[3] })] : [];
    }],
    ["UPDATE usp_model_calls SET state='settled',actual_micro_inr=$2", v => {
      const row = this.calls.find(call => call.id === v[0])!;
      return [Object.assign(row, { state: 'settled', actual_micro_inr: v[1], output: JSON.parse(v[2]),
        receipt: v[3], settlement_hash: v[4] })];
    }],
  ];
  private markSteps: [string, (v: any[]) => Row[] | void][] = [
    ['SELECT credential_hash, reason, marked_at FROM usp_model_key_marks', () => this.openMarks()],
    ['INSERT INTO usp_model_key_marks', v => {
      if (this.openMarks().some(mark => mark.credential_hash === v[1])) return;
      this.marks.push({ id: v[0], credential_hash: v[1], secret_reference: v[2], reason: v[3], http_status: v[4],
        call_id: v[5], marked_at: this.now(), restored_at: null, restored_reason: null });
    }],
    ['UPDATE usp_model_key_marks SET restored_at', v => this.openMarks()
      .filter(mark => mark.credential_hash === v[0])
      .map(mark => Object.assign(mark, { restored_at: this.now(), restored_reason: v[1] }))],
  ];
}

type Answer = (key: string, init?: RequestInit) => Response | Promise<Response>;
const answered = () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"control":true}' } }],
  usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens } });
const refused = (status: number, code?: string, headers: Record<string, string> = {}) => Response.json(
  { error: { message: 'control', code, request_id: 'control' } }, { status, headers });
const usedUp = () => refused(429, 'insufficient_quota_error');
const rejected = () => refused(403, 'invalid_api_key_error');
const rateLimited = () => refused(429, 'rate_limit_exceeded_error', { 'retry-after': '30' });

/** A gateway on the fake ledger and an injected fetcher; `sent` holds the key of every request that left. */
function harness(config = listPolicy(), answer: Answer = () => answered(), db = new FakeLedgerDb(), secrets = keys) {
  const sent: string[] = [];
  const fetcher = (async (_url: unknown, init?: RequestInit) => {
    const key = new Headers(init?.headers).get('api-subscription-key')!;
    sent.push(key);
    return answer(key, init);
  }) as typeof fetch;
  const listed = config.secretReferences !== undefined;
  const ledger = new PgModelCallLedger(db.tx, config, listed ? secrets.map(hash) : hash(secrets[0]), 'sarvam');
  const adapter = listed ? new SarvamKeyListAdapter(secrets, fetcher) : new SarvamAdapter(secrets[0], fetcher);
  return { db, sent, ledger, gateway: new ModelGateway(config, ledger, adapter) };
}
const context = { requestId: 'control', accessViewId: 'control', policyVersion: 'usp-local-1', principal: {
  subject: `local-os:${userInfo().uid}:${userInfo().username}`, roles: ['operator'],
  entitlementVersion: 'local-1', mode: 'local_demo' } } as const;
const thrown: unknown[] = [];
let asked = 0;
/** One gateway call on a fresh invocation key; the clock then moves past the pace. Errors go to the last test. */
async function ask(gateway: ModelGateway, db: FakeLedgerDb, invocationKey = `control-${++asked}`, attempt = 1) {
  const trusted = { invocationKey, attempt, consumer: 'INGEST' as const, scopeHash: hash('control'),
    sourceHashes: [], deadlineAt: new Date(db.now().getTime() + 40000), taskKind: 'control',
    outputSchemaId: 'control-v1', outputSchema: { type: 'object' }, authorize: async () => {},
    minimizeOutput: (value: unknown) => value };
  const request = { taskKind: 'control', evidenceRefs: [], input: { messages: [{ role: 'user', content: 'control' }] },
    outputSchemaId: 'control-v1', budget: { maxInputBytes: 32768, deadlineMs: 45000 },
    policyVersion: gateway.config.policyVersion };
  try {
    return await gateway.propose(context as any, request, trusted);
  } catch (error) {
    thrown.push(error);
    throw error;
  } finally {
    db.ahead += 2000;
  }
}
const code = (expected: string, status?: number) => (error: any) =>
  error.code === expected && (status === undefined || error.status === status);
const servedBy = (db: FakeLedgerDb) => db.calls.map(call => keys.findIndex(key => hash(key) === call.credential_hash));

test('one key: the policy and its hashes are unchanged, and a used-up answer blocks the pool as before', async () => {
  const single = policy();
  assert.equal(hash(single), 'd6212efc956d5a5c74ee6fe2e56886ca078b3cce92e307e793cd944bab0d5d8a');
  assert.deepEqual(providerKeyReferences(single), ['ULPIN_PROVIDER_KEY_CONTROL']);
  assert.equal('secretReferences' in single, false);
  const { db, sent, ledger, gateway } = harness(single, () => usedUp());
  assert.equal(ledger.configHash, 'd6880b1466a876e339139668fc782cde45a44dbed57ecc9df96b039ed41e335c');
  await assert.rejects(ask(gateway, db), (error: any) => error.code === 'MODEL_QUOTA_EXHAUSTED'
    && error.details === undefined && /exposure remains reserved/.test(error.message));
  assert.equal(db.budget!.credential_hash, hash(keys[0]));
  assert.equal(db.budget!.blocked_reason, 'quota_exhausted');
  assert.equal(db.calls[0].state, 'outcome_unknown');
  assert.equal(db.calls[0].credential_hash, hash(keys[0]));
  await assert.rejects(ask(gateway, db), code('MODEL_POOL_BLOCKED'));
  assert.equal(sent.length, 1);
  assert.equal(db.statements.some(sql => sql.includes('usp_model_key_marks')), false);
});

test('a policy names its key one way: one name or a list of 2 to 32 different names in the key namespace', () => {
  const list = listPolicy();
  assert.deepEqual(providerKeyReferences(list), names);
  assert.equal(list.secretReference, names[0], 'readers written for one key get the first name of the list');
  assert.notEqual(hash(list), hash(listPolicy({ secretReferences: [names[1], names[0], names[2]] })));
  const invalid = [{ secretReferences: names }, { secretReference: undefined },
    { secretReference: undefined, secretReferences: [names[0]] },
    { secretReference: undefined, secretReferences: [names[0], names[0]] },
    { secretReference: undefined, secretReferences: Array.from({ length: 33 }, (_, i) => `${names[0]}_${i}`) }];
  for (const overrides of invalid) assert.throws(() => policy(overrides), (error: any) => error.name === 'ZodError');
  assert.throws(() => listPolicy({ secretReferences: [names[0], 'DATABASE_URL'] }), code('MODEL_SECRET_REFERENCE'));
  assert.throws(() => new PgModelCallLedger(new FakeLedgerDb().tx, list, [hash('a'), hash('a'), hash('b')],
    'sarvam'), code('MODEL_CONFIGURATION', 422));
  assert.throws(() => new PgModelCallLedger(new FakeLedgerDb().tx, list, hash('a'), 'sarvam'),
    code('MODEL_CONFIGURATION', 422));
});

test('a list of three: the first key serves until the provider says it is used up, then the second', async () => {
  let firstIsUsedUp = false;
  const { db, sent, ledger, gateway } = harness(listPolicy(), key => {
    return key === keys[0] && firstIsUsedUp ? usedUp() : answered();
  });
  await ask(gateway, db);
  await ask(gateway, db);
  firstIsUsedUp = true;
  await assert.rejects(ask(gateway, db, 'control-moved'), (error: any) => error.code === 'MODEL_QUOTA_EXHAUSTED'
    && error.status === 503 && error.details.retryable === true);
  const refusedCall = db.calls[2];
  assert.deepEqual([refusedCall.state, refusedCall.actual_micro_inr, refusedCall.error_kind, refusedCall.output],
    ['settled', '0', 'quota_exhausted', null]);
  assert.equal(refusedCall.receipt.httpStatus, 429);
  assert.match(refusedCall.receipt.responseHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(db.marks.map(mark => [mark.secret_reference, mark.reason, mark.http_status, mark.call_id]),
    [[names[0], 'quota_exhausted', 429, refusedCall.id]]);
  assert.equal(db.budget!.blocked_reason, null, 'a used-up key of a list does not block the pool');
  // The closed call is never sent again under its own reservation; the next call goes to the second key.
  await assert.rejects(ask(gateway, db, 'control-moved'), code('MODEL_QUOTA_EXHAUSTED', 503));
  const result = await ask(gateway, db);
  assert.equal(result.receipt?.httpStatus, 200);
  await ask(gateway, db, 'control-moved', 2);
  assert.deepEqual(sent, [keys[0], keys[0], keys[0], keys[1], keys[1]]);
  assert.deepEqual(servedBy(db), [0, 0, 0, 1, 1], 'each ledger row names the key that served it');
  assert.deepEqual((await ledger.keyStates()).map(key => [key.reference, key.state, key.reason]), [
    [names[0], 'used_up', 'quota_exhausted'], [names[1], 'in_use', undefined], [names[2], 'waiting', undefined]]);
});

test('the money caps count across keys: the project cap and the per-person daily cap', async () => {
  const price = policy().price, spent = cost(usage, price), reserve = reservation(listPolicy());
  const capped = listPolicy({ projectCapMicroInr: (reserve + spent * 2n - 1n).toString() });
  let firstIsUsedUp = false;
  const one = harness(capped, key => key === keys[0] && firstIsUsedUp ? usedUp() : answered());
  await ask(one.gateway, one.db);
  firstIsUsedUp = true;
  await assert.rejects(ask(one.gateway, one.db), code('MODEL_QUOTA_EXHAUSTED'));
  await ask(one.gateway, one.db);
  assert.deepEqual(servedBy(one.db), [0, 0, 1]);
  // The second key has spent once; only the first key's spend puts the next reservation over the cap.
  await assert.rejects(ask(one.gateway, one.db), code('MODEL_PROJECT_CAP'));
  assert.equal(one.sent.length, 3);

  firstIsUsedUp = false;
  const two = harness(listPolicy({ principalDailyCallCap: 3 }), key => {
    return key === keys[0] && firstIsUsedUp ? usedUp() : answered();
  });
  await ask(two.gateway, two.db);
  firstIsUsedUp = true;
  await assert.rejects(ask(two.gateway, two.db), code('MODEL_QUOTA_EXHAUSTED'));
  await ask(two.gateway, two.db);
  await assert.rejects(ask(two.gateway, two.db), code('MODEL_PRINCIPAL_CAP', 429));
  assert.deepEqual(servedBy(two.db), [0, 0, 1]);
});

test('a rate limit cools every key down and tries no other key', async () => {
  const { db, sent, ledger, gateway } = harness(listPolicy(), () => rateLimited());
  await assert.rejects(ask(gateway, db), code('MODEL_RATE_LIMITED', 429));
  assert.equal(db.marks.length, 0);
  assert.equal(db.calls[0].state, 'outcome_unknown');
  assert(db.budget!.cooldown_until.getTime() - db.now().getTime() > 20000);
  await assert.rejects(ask(gateway, db), code('MODEL_COOLDOWN', 429));
  assert.deepEqual(sent, [keys[0]]);
  assert.equal((await ledger.keyStates())[0].state, 'in_use');
});

test('a timeout, a 5xx and an undocumented answer move nothing and keep the reservation', async () => {
  const hang: Answer = (_key, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const answers: [Answer, string][] = [[hang, 'outcome_unknown'], [() => refused(503), 'outcome_unknown'],
    [() => refused(404), 'outcome_unknown'], [() => refused(402), 'quota_exhausted'],
    [() => refused(401), 'credential_invalid'], [() => refused(403, 'insufficient_quota_error'), 'quota_exhausted'],
    [() => refused(429, 'invalid_api_key_error'), 'rate_limited'], [() => refused(403), 'capability_denied']];
  for (const [answer, kind] of answers) {
    const { db, sent, ledger, gateway } = harness(listPolicy({ timeoutMs: 1000 }), answer);
    await assert.rejects(ask(gateway, db), code(`MODEL_${kind.toUpperCase()}`));
    assert.equal(db.marks.length, 0, kind);
    assert.deepEqual([db.calls[0].state, db.calls[0].error_kind, db.calls[0].actual_micro_inr],
      ['outcome_unknown', kind, null]);
    assert.equal(exposure(db.calls[0]), reservation(listPolicy()), 'the reservation is still held');
    assert.equal((await ledger.keyStates())[0].state, 'in_use');
    db.ahead += 86400000;
    await assert.rejects(ask(gateway, db), (error: any) => /^MODEL_(EXPOSURE_PENDING|POOL_BLOCKED)$/.test(error.code));
    assert.deepEqual(sent, [keys[0]], 'no other key is tried');
  }
});

test('every key used up: one named refusal, nothing is sent, and the mapping teacher prepares manually', async () => {
  const { db, sent, ledger, gateway } = harness(listPolicy(), key => key === keys[1] ? rejected() : usedUp());
  await assert.rejects(ask(gateway, db), code('MODEL_QUOTA_EXHAUSTED'));
  await assert.rejects(ask(gateway, db), code('MODEL_CREDENTIAL_INVALID', 503));
  await assert.rejects(ask(gateway, db), code('MODEL_QUOTA_EXHAUSTED'));
  assert.deepEqual(db.marks.map(mark => [mark.secret_reference, mark.reason, mark.http_status]), [
    [names[0], 'quota_exhausted', 429], [names[1], 'credential_invalid', 403], [names[2], 'quota_exhausted', 429]]);
  await assert.rejects(ask(gateway, db), code('MODEL_KEYS_EXHAUSTED', 503));
  assert.deepEqual([sent.length, db.calls.length], [3, 3]);

  const profile = profileColumns([{ Area: '123' }], [{ name: 'Area' }], 'tabular');
  const teacher = await proposeMappingWithTeacher(profile, { context: context as any, gateway,
    dataPolicy: { dataClass: 'public', split: 'development' }, authorize: async () => {},
    recordings: new TeacherRecordings(mkdtempSync(join(tmpdir(), 'gk1-recordings-'))) });
  assert(teacher.issues.length > 0 && teacher.issues.every(issue => issue.code === 'TEACHER_UNAVAILABLE'));
  assert(teacher.plan.fields.every(field => field.target === 'unknown'));
  assert.deepEqual([sent.length, db.calls.length], [3, 3], 'the teacher sent nothing and reserved nothing');

  // Only the owner restores a key, with a reason; the mark row is kept.
  await assert.rejects(ledger.restoreKey('ULPIN_PROVIDER_KEY_SARVAM_09', 'control'), code('MODEL_SECRET_REFERENCE'));
  await assert.rejects(ledger.restoreKey(names[2], ' '), (error: any) => error.name === 'ZodError');
  assert.equal(await ledger.restoreKey(names[2], 'control: credits added'), true);
  assert.equal(await ledger.restoreKey(names[2], 'control: credits added'), false);
  assert.deepEqual([db.marks.length, db.marks[2].restored_reason], [3, 'control: credits added']);
  assert.deepEqual((await ledger.keyStates()).map(key => key.state), ['used_up', 'used_up', 'in_use']);
  await assert.rejects(ask(gateway, db), code('MODEL_QUOTA_EXHAUSTED'));
  assert.deepEqual(sent.at(-1), keys[2]);
});

test('a changed or reordered list is refused until the owner reconciles it; an unchanged list never is', async () => {
  const first = harness();
  await ask(first.gateway, first.db);
  assert.equal(await first.ledger.reconcileKeys('control: nothing changed'), 'unchanged');
  await ask(first.gateway, first.db);

  const order = [1, 0, 2];
  const reordered = harness(listPolicy({ secretReferences: order.map(i => names[i]) }), () => answered(), first.db,
    order.map(i => keys[i]));
  await assert.rejects(ask(reordered.gateway, first.db), code('MODEL_RECONCILIATION_REQUIRED'));
  assert.equal(reordered.sent.length, 0);
  assert.equal(await reordered.ledger.reconcileKeys('control: the owner put the second key first'), 'reconciled');
  assert.equal(first.db.budget!.reconciled_reason, 'control: the owner put the second key first');
  await ask(reordered.gateway, first.db);
  assert.deepEqual(reordered.sent, [keys[1]]);
  await assert.rejects(ask(first.gateway, first.db), code('MODEL_RECONCILIATION_REQUIRED'));

  // The same names with one different key value is a change too; a changed cap is never the key step's business.
  const replaced = harness(listPolicy({ secretReferences: order.map(i => names[i]) }), () => answered(), first.db,
    [keys[1], keys[0], `gk1-synthetic-key-${randomBytes(12).toString('hex')}`]);
  await assert.rejects(ask(replaced.gateway, first.db), code('MODEL_RECONCILIATION_REQUIRED'));
  const recapped = harness(listPolicy({ principalDailyCallCap: 19 }), () => answered(), first.db);
  await assert.rejects(recapped.ledger.reconcileKeys('control: cap and keys'), code('MODEL_RECONCILIATION_REQUIRED'));
  assert.equal(await harness().ledger.reconcileKeys('control: empty ledger'), 'unpinned');
});

test('a one-key ledger becomes a list by the owner step, and never while a call has unresolved exposure', async () => {
  const single = harness(policy({ secretReference: names[0] }));
  await ask(single.gateway, single.db);
  const list = harness(listPolicy(), () => answered(), single.db);
  await assert.rejects(ask(list.gateway, single.db), code('MODEL_RECONCILIATION_REQUIRED'));
  single.db.calls[0].state = 'outcome_unknown';
  await assert.rejects(list.ledger.reconcileKeys('control: the list replaces the one key'),
    code('MODEL_EXPOSURE_PENDING'));
  single.db.calls[0].state = 'settled';
  assert.equal(await list.ledger.reconcileKeys('control: the list replaces the one key'), 'reconciled');
  await ask(list.gateway, single.db);
  assert.deepEqual(servedBy(single.db), [0, 0]);
});

test('no error, thrown object or ledger row holds a synthetic key or a part of one', async () => {
  const { db, gateway } = harness(listPolicy(), (key, init) => refused(429, 'insufficient_quota_error',
    { 'x-echo': key, 'x-body': String(init?.body).length.toString() }));
  await assert.rejects(ask(gateway, db), code('MODEL_QUOTA_EXHAUSTED'));
  assert(thrown.length > 20, 'the errors of every test above are checked');
  const seen = [...thrown.map(error => `${inspect(error, { depth: 9 })} ${JSON.stringify(error)} ${String(error)}`),
    inspect([db.calls, db.marks, db.budget], { depth: 9 }), JSON.stringify(db.statements)].join('\n');
  for (const key of keys) {
    const random = key.slice('gk1-synthetic-key-'.length);
    const parts = Array.from({ length: random.length - 7 }, (_, start) => random.slice(start, start + 8));
    assert.equal([key, ...parts].some(part => seen.includes(part)), false);
  }
  assert.equal(seen.includes('gk1-synthetic-key-'), false);
});
