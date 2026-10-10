import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  assertLiveStart, buildPlan, dryRun, parseGatewayStatus, readTariff, PROPOSAL_LABEL, PROPOSED_POLICY,
} from './live-proof';

const scratch = () => mkdtempSync(join(tmpdir(), 's1-live-proof-'));

/** A made-up policy file: the proposal with other prices or caps, never an approved tariff. */
function policyFile(overrides: Record<string, unknown>): string {
  const path = join(scratch(), 'policy.json');
  writeFileSync(path, JSON.stringify({ ...PROPOSED_POLICY, policyVersion: 'test-policy/1', ...overrides }));
  return path;
}

const micro = (value: { microInr: string }) => BigInt(value.microInr);

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
