import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertLiveStart, buildPlan, dryRun, keyMoveWalk, parseGatewayStatus, readTariff, recordSoftwareControl,
  PROPOSAL_LABEL, PROPOSED_POLICY, type KeyScenario,
} from './live-proof';

const scratch = () => mkdtempSync(join(tmpdir(), 's1-live-proof-'));

/** A made-up policy file: the proposal with other prices or caps, never an approved tariff. */
function policyFile(overrides: Record<string, unknown>): string {
  const path = join(scratch(), 'policy.json');
  writeFileSync(path, JSON.stringify({ ...PROPOSED_POLICY, policyVersion: 'test-policy/1', ...overrides }));
  return path;
}

const micro = (value: { microInr: string }) => BigInt(value.microInr);
/** Made-up key names: a policy names keys, it never holds one, and no test here reads a key. */
const KEY_NAMES = [1, 2, 3].map(index => `ULPIN_PROVIDER_KEY_SOFTWARE_${index}`);
const moved = (attempt: number, code = 'MODEL_QUOTA_EXHAUSTED') => ({ attempt, state: 'key_moved_on', code });
const walk = (scenario: KeyScenario) => keyMoveWalk(readTariff(), scratch(), scenario);

test('plan: totals are sums of the calls, every figure names its kind and tariff, the proposal is not approved', () => {
  const plan = buildPlan(readTariff());
  const calls = plan.steps.filter(step => step.request);
  assert.equal(plan.tariff.label, PROPOSAL_LABEL);
  assert.equal(plan.tariff.approved, false);
  assert.equal(plan.totals.calls, calls.length);
  assert.equal(micro(plan.totals.estimate), calls.reduce((sum, step) => sum + micro(step.request!.cost.estimate), 0n));
  assert.equal(micro(plan.totals.atMost), micro(plan.tariff.heldPerCall) * BigInt(calls.length));
  for (const step of calls) {
    const { estimate, upperBound, held } = step.request!.cost;
    assert.deepEqual([estimate.kind, upperBound.kind, held.kind], ['estimate', 'upper_bound', 'upper_bound']);
    assert(micro(estimate) <= micro(upperBound) && micro(upperBound) <= micro(held));
    assert.equal(estimate.tariff, PROPOSED_POLICY.price.version);
    assert.equal(step.input.dataClass, 'public');
    assert(['development', 'demo'].includes(step.input.split) && step.input.permission);
  }
  assert.equal(plan.steps[0].provider, 'call');
  assert.equal(plan.steps[1].id, `replay-of-${plan.steps[0].id}`);
  assert(plan.neverSent.some(refusal => refusal.input.startsWith('tabular family') && !refusal.opened));
});

test('plan: a line left out of a storey call is named under its own reason; a mapping call names its forms', () => {
  const plan = buildPlan(readTariff());
  const calls = plan.steps.filter(step => step.request);
  const storey = calls.filter(step => step.exec.kind === 'storey');
  const omitted = storey.flatMap(step => step.input.omitted ?? []);
  for (const code of ['MODEL_PROMPT_PRIVACY', 'NOT_SELECTED_UNIT_NUMBER']) {
    const lines = omitted.filter(line => line.code === code);
    assert(lines.length > 0, code);
    assert.equal(plan.neverSent.filter(refusal => refusal.reason.includes(`(${code})`)).length, lines.length);
  }
  assert(plan.neverSent.some(refusal => refusal.reason.startsWith('not selected: ')));
  for (const step of storey) {
    const sent = step.exec.kind === 'storey' ? step.exec.parts.map(part => part.partId) : [];
    assert((step.input.omitted ?? []).every(line => !sent.includes(line.partId)));
  }
  for (const step of calls.filter(entry => entry.exec.kind === 'mapping')) {
    assert(Array.isArray(step.input.sampleForms));
    assert.equal(step.input.samplesPerColumn, 10);
  }
});

test('plan: it follows the tariff it is given, and stops where a cap would be crossed', () => {
  const proposal = buildPlan(readTariff());
  const price = {
    ...PROPOSED_POLICY.price, inputPerMillionMicroInr: '30000000', outputPerMillionMicroInr: '120000000',
  };
  const doubled = buildPlan(readTariff(policyFile({ price })));
  assert.equal(micro(doubled.totals.estimate), 2n * micro(proposal.totals.estimate));
  assert.notEqual(doubled.tariff.label, PROPOSAL_LABEL);
  const capped = buildPlan(readTariff(policyFile({ projectDailyCapMicroInr: '2000000' })));
  const refused = capped.steps.filter(step => step.capAdmission && !step.capAdmission.admitted);
  assert.equal(capped.totals.calls, 2);
  assert(refused.length > 0 && refused.every(step => step.capAdmission!.code === 'MODEL_DAILY_CAP'));
});

test('dry run: a key and an enabled gateway in the environment change nothing; all steps fail closed', async t => {
  const names = ['ULPIN_MODEL_GATEWAY_ENABLED', 'ULPIN_MODEL_GATEWAY_CONFIG', 'ULPIN_PROVIDER_KEY_SARVAM',
    'ULPIN_MAPPING_TEACHER_ADAPTER'];
  const before = names.map(name => process.env[name]);
  t.after(() => names.forEach((name, index) => {
    if (before[index] === undefined) delete process.env[name];
    else process.env[name] = before[index];
  }));
  const values = ['1', JSON.stringify(PROPOSED_POLICY), 'made-up-value-for-this-test', 'sarvam'];
  names.forEach((name, index) => { process.env[name] = values[index]; });
  const tariff = readTariff();
  const result = await dryRun(tariff, scratch(), scratch());
  const planned = buildPlan(tariff).steps.filter(step => step.request).length;
  const { providerDispatches, fetchAttempts, ledgerReservations, requestsMatchingPlan } = result.summary;
  assert.deepEqual([providerDispatches, fetchAttempts, ledgerReservations], [0, 0, 0]);
  assert.equal(requestsMatchingPlan, planned);
  for (const receipt of result.receipts) {
    assert.equal(receipt.mode, 'dry_run');
    assert(['needs_input', 'teacher_unavailable'].includes(receipt.endState));
    assert.deepEqual([receipt.providerCalls, receipt.live.inputTokens, receipt.live.actualMicroInr], [0, null, null]);
  }
});

test('dry run: a recording made by a software control ends the first step and its replay as a control', async () => {
  const tariff = readTariff();
  const first = buildPlan(tariff).steps[0];
  const recordings = scratch();
  const made = await recordSoftwareControl(first, tariff, recordings);
  assert.deepEqual([made?.state, made?.replayed], ['abstained', false]);
  const result = await dryRun(tariff, scratch(), recordings);
  const [call, replay, ...rest] = result.receipts;
  assert.deepEqual([call.endState, replay.endState], ['replayed_software_control', 'replayed_software_control']);
  assert.deepEqual([call.providerCalls, call.live.actualMicroInr], [0, null]);
  assert(rest.every(receipt => !receipt.replayed));
  const { providerDispatches, fetchAttempts, ledgerReservations } = result.summary;
  assert.deepEqual([providerDispatches, fetchAttempts, ledgerReservations], [0, 0, 0]);
});

test('plan: a key list adds at most one extra attempt per key and no rupees; one key adds none', () => {
  const one = buildPlan(readTariff());
  const list = buildPlan(readTariff(policyFile({ secretReference: undefined, secretReferences: KEY_NAMES })));
  assert.deepEqual([one.keyMoves.keysInPolicy, one.keyMoves.extraAttemptsAtMost], [1, 0]);
  assert.deepEqual([list.keyMoves.keysInPolicy, list.keyMoves.extraAttemptsAtMost], [3, 3]);
  assert.equal(list.keyMoves.ledgerRowsAtMost, list.totals.calls + 3);
  assert.deepEqual([list.keyMoves.costOfAMovedOnCall.microInr, list.keyMoves.costOfAMovedOnCall.kind],
    ['0', 'upper_bound']);
  assert.deepEqual([list.totals.calls, micro(list.totals.atMost)], [one.totals.calls, micro(one.totals.atMost)]);
});

test('dry run: a used-up key moves step 1 on and replay answers it; every key marked ends the run', async () => {
  const tariff = readTariff();
  const steps = buildPlan(tariff).steps;
  const { oneKeyUsedUp, everyKeyMarked } = (await dryRun(tariff, scratch(), scratch())).keyMoves;
  assert.deepEqual(oneKeyUsedUp.firstStep, {
    id: steps[0].id, attempts: 2, keyMoves: [moved(1)], gatewayCode: null, endState: 'replayed_software_control',
    code: null, requestMatchesPlan: true,
  });
  assert.deepEqual([oneKeyUsedUp.stopped, oneKeyUsedUp.stepsWalked, oneKeyUsedUp.notRun], [null, steps.length, []]);
  assert.deepEqual([oneKeyUsedUp.softwareKeyList.asksRefused, oneKeyUsedUp.softwareKeyList.markedAtEnd], [1, 1]);

  const { attempts, keyMoves, gatewayCode, endState } = everyKeyMarked.firstStep;
  assert.deepEqual([attempts, keyMoves, gatewayCode, endState], [1, [], 'MODEL_KEYS_EXHAUSTED', 'teacher_unavailable']);
  assert.match(everyKeyMarked.stopped!, /every key of the policy is marked used up \(MODEL_KEYS_EXHAUSTED\)/);
  assert.deepEqual(everyKeyMarked.notRun, steps.slice(1).map(({ step, id }) => ({ step, id, endState: 'not_run' })));
  assert.deepEqual([everyKeyMarked.stepsWalked, everyKeyMarked.softwareKeyList.asksRefused], [1, 0]);
  for (const proof of [oneKeyUsedUp, everyKeyMarked]) {
    assert.deepEqual([proof.providerDispatches, proof.fetchAttempts], [0, 0]);
  }
});

test('key moves: past the second, a step is attempted again only while the key report shows a free key', async () => {
  const three = await walk({ keys: 3, markedAtStart: 0, refused: 3 });
  assert.deepEqual([three.firstStep.attempts, three.firstStep.keyMoves], [3, [moved(1), moved(2), moved(3)]]);
  assert.match(three.stopped!, /every key of the policy is marked used up, by the report of key states/);
  assert.deepEqual([three.softwareKeyList.asksRefused, three.stepsWalked, three.notRun.length > 0], [3, 1, true]);

  const last = await walk({ keys: 2, markedAtStart: 1, refused: 1 });
  assert.deepEqual([last.firstStep.attempts, last.firstStep.keyMoves, last.firstStep.gatewayCode],
    [2, [moved(1)], 'MODEL_KEYS_EXHAUSTED']);
  assert.deepEqual([last.softwareKeyList.asksRefused, last.stepsWalked], [1, 1]);

  const rejected = await walk({ keys: 2, markedAtStart: 0, refused: 1, answer: 'credential_invalid' });
  assert.deepEqual(rejected.firstStep.keyMoves, [moved(1, 'MODEL_CREDENTIAL_INVALID')]);
  assert.deepEqual([rejected.firstStep.attempts, rejected.stopped, rejected.notRun], [2, null, []]);
});

test('key moves: a rate limit, an unknown outcome and a one-key quota answer are not attempted again', async () => {
  const cases: [KeyScenario, string][] = [
    [{ keys: 2, markedAtStart: 0, refused: 1, answer: 'rate_limited' }, 'MODEL_RATE_LIMITED'],
    [{ keys: 2, markedAtStart: 0, refused: 1, answer: 'outcome_unknown' }, 'MODEL_OUTCOME_UNKNOWN'],
    [{ keys: 1, markedAtStart: 0, refused: 1 }, 'MODEL_QUOTA_EXHAUSTED'],
  ];
  for (const [scenario, code] of cases) {
    const { firstStep, softwareKeyList, notRun } = await walk(scenario);
    assert.deepEqual([firstStep.attempts, firstStep.keyMoves, firstStep.gatewayCode], [1, [], code], code);
    assert.deepEqual([softwareKeyList.asksRefused, softwareKeyList.markedAtEnd, notRun], [1, 0, []], code);
    assert.equal(firstStep.endState, 'teacher_unavailable', code);
  }
});

test('live: refuses to start without an explicit enabled gateway state that carries the planned policy hash', () => {
  const tariff = readTariff(policyFile({}));
  const status = (enabled: boolean, policyHash: string | null) => parseGatewayStatus([
    `enabled: ${enabled}`, `policyHash: ${policyHash}`, 'providerKeyPresent: true',
    'mappingTeacherAdapter: sarvam', 'dailyCapPresent: true',
  ].join('\n'));
  assert.doesNotThrow(() => assertLiveStart(status(true, tariff.policyHash), tariff));
  const refusals: [unknown, typeof tariff][] = [
    [undefined, tariff], [status(false, tariff.policyHash), tariff], [status(true, null), tariff],
    [status(true, 'a'.repeat(64)), tariff], [status(true, readTariff().policyHash), readTariff()],
    [{ ...status(true, tariff.policyHash), mappingTeacherAdapter: 'replay' }, tariff],
  ];
  for (const [state, given] of refusals) assert.throws(() => assertLiveStart(state, given), /LIVE_PROOF_REFUSED/);
});
