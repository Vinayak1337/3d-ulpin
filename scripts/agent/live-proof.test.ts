import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  extractStoreyFacts, storeyPartSelection, storeyPartsHash, storeyReplayKey, type StoreyPageStore,
} from '../../packages/server/src/modules/ai/document-storey-agent';
import { ControlAdapter } from '../../packages/server/src/modules/model-gateway/adapter';
import { hash } from '../../packages/server/src/modules/model-gateway/config';
import { ModelGateway } from '../../packages/server/src/modules/model-gateway/gateway';
import { TeacherRecordings } from '../../packages/server/src/modules/model-gateway/recordings';
import { controlConfig, ControlLedger, requestContext } from './control-runtime';
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
const STORES = 'E:/BhuAayam-data/task-data/a5/stores';
const NOTHING = { value: null, expression: null, citations: [] };
const ABSTAINS = {
  storeyCount: NOTHING, basementCount: NOTHING, floorExpressions: [], labels: [], heights: [], unitCounts: [],
  conflicts: [], abstain: true, abstainReason: 'software control',
};

/** What a software control leaves behind: one recording of the first planned storey request. */
async function recordControlAnswer(sha256: string, replayKey: string, directory: string) {
  const store = JSON.parse(readFileSync(join(STORES, `${sha256}.pages.json`), 'utf8')) as StoreyPageStore;
  const parts = storeyPartSelection(store).batches[0];
  assert.equal(storeyReplayKey(storeyPartsHash(parts)), replayKey);
  const adapter = new ControlAdapter(async () => ({
    output: ABSTAINS, responseHash: hash(ABSTAINS), httpStatus: 200, rawResponse: { output: ABSTAINS },
    usage: { promptTokens: 1, completionTokens: 1 },
  }));
  return extractStoreyFacts(parts, {
    context: requestContext, gateway: new ModelGateway(controlConfig(), new ControlLedger(), adapter),
    recordings: new TeacherRecordings(directory), authorize: async () => {}, maxAttempts: 1,
    dataPolicy: { dataClass: 'public', split: 'development' },
  });
}

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
  const made = await recordControlAnswer(first.input.sha256, first.request!.replayKey, recordings);
  assert.deepEqual([made.state, made.replayed], ['abstained', false]);
  const result = await dryRun(tariff, scratch(), recordings);
  const [call, replay, ...rest] = result.receipts;
  assert.deepEqual([call.endState, replay.endState], ['replayed_software_control', 'replayed_software_control']);
  assert.deepEqual([call.providerCalls, call.live.actualMicroInr], [0, null]);
  assert(rest.every(receipt => !receipt.replayed));
  const { providerDispatches, fetchAttempts, ledgerReservations } = result.summary;
  assert.deepEqual([providerDispatches, fetchAttempts, ledgerReservations], [0, 0, 0]);
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
