import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { AppError } from '@ulpin/server/infrastructure/errors';
import { inspectModelGateway } from '@ulpin/server/modules/ai/officer-ai-provider';
import { teacherFailureCode } from '@ulpin/server/modules/usp/ingestion/mapping-teacher';

// Software-control inputs only. Keys are synthetic, made here on every run, and never written to a file.
const names = ['ULPIN_PROVIDER_KEY_SARVAM_01', 'ULPIN_PROVIDER_KEY_SARVAM_02', 'ULPIN_PROVIDER_KEY_SARVAM_03'];
const keys = names.map(() => `gk2-synthetic-key-${randomBytes(12).toString('hex')}`);
const policy = (keyNames: Record<string, unknown>) => JSON.stringify({
  projectId: 'model-core-control', policyVersion: 'control-policy-v1', fundingVersion: 'control-funding-v1',
  gatewayExclusiveFunding: true, indiaPrivateApproved: true, model: 'sarvam-105b', projectCapMicroInr: '100000000',
  projectDailyCapMicroInr: '25000000', principalDailyCallCap: 20, paceMs: 1500,
  price: { version: 'h20-software-price-input-v1', inputPerMillionMicroInr: '29280000',
    cachedInputPerMillionMicroInr: '10980000', outputPerMillionMicroInr: '73200000' },
  inputBound: { version: 'control-byte-bound-v1', maxPromptTokens: 34816 }, ...keyNames,
});
const present = (count: number) => Object.fromEntries(names.slice(0, count).map((name, index) => [name, keys[index]]));
const gatewayEnv = (keyNames: Record<string, unknown>, count: number) => ({
  ULPIN_MODEL_GATEWAY_ENABLED: '1', ULPIN_MODEL_GATEWAY_CONFIG: policy(keyNames), ...present(count) });
const holdsNoKey = (text: string) => assert.equal(keys.some(key => text.includes(key.slice(18, 26))), false);

/** The officer provider reads process.env: for one check it holds exactly these variables, then what it held before. */
async function inspectWith(env: Record<string, string>) {
  const before = Object.fromEntries([...names, ...Object.keys(env)].map(name => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  Object.assign(process.env, env);
  try {
    return await inspectModelGateway();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('every key of a used-up list is a budget refusal to the mapping teacher', () => {
  const refusal = new AppError(503, 'MODEL_KEYS_EXHAUSTED', 'control');
  assert.equal(teacherFailureCode(refusal), 'TEACHER_BUDGET_EXHAUSTED');
  assert.equal(teacherFailureCode(new AppError(503, 'MODEL_QUOTA_EXHAUSTED', 'control')), 'TEACHER_BUDGET_EXHAUSTED');
  assert.equal(teacherFailureCode(new AppError(503, 'MODEL_OUTCOME_UNKNOWN', 'control')), 'TEACHER_UNAVAILABLE');
});

test('the officer provider accepts a list with every key present and names the one that is absent', async () => {
  const list = { secretReferences: names };
  const available = await inspectWith(gatewayEnv(list, 3));
  assert.deepEqual([available.status.state, available.status.configured, available.model?.id],
    ['available', true, 'sarvam-105b']);
  for (const count of [2, 0]) {
    const absent = await inspectWith(gatewayEnv(list, count));
    assert.deepEqual([absent.status.state, absent.status.configured, absent.model], ['unconfigured', false, undefined]);
    assert.match(absent.status.message, new RegExp(`provider key ${names[count]} is absent`));
    holdsNoKey(JSON.stringify(absent));
  }
  holdsNoKey(JSON.stringify(available));
  // One key, as before: present is available, absent names the one name.
  const single = { secretReference: names[0] };
  assert.equal((await inspectWith(gatewayEnv(single, 1))).status.state, 'available');
  assert.match((await inspectWith(gatewayEnv(single, 0))).status.message, new RegExp(`${names[0]} is absent`));
});

// The child can send nothing: a request or a socket would throw here, whatever the script went on to do.
const closedNetwork = `data:text/javascript,${encodeURIComponent(`import net from 'node:net';
const closed = () => { throw new Error('GK2_NETWORK_CLOSED'); };
globalThis.fetch = closed; net.Socket.prototype.connect = closed;`)}`;

/** The qualifier is a script that runs on import, so its refusals are read from a child that gets only this env. */
function qualifier(env: Record<string, string>) {
  const system = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT'];
  const inherited = Object.fromEntries(system.filter(name => process.env[name]).map(name => [name, process.env[name]]));
  // The demo preload hides the checkout's settings file from the child; the file argument does not exist, so a run
  // that gets past the key check stops there.
  const preloads = ['--require', resolve('scripts/platform/isolated-env.cjs'), '--import', 'tsx', '--import',
    closedNetwork];
  const run = [resolve('scripts/agent/mapping-teacher.ts'), 'gk2-no-such-file.csv', '--public-development', '--live'];
  return spawnSync(process.execPath, [...preloads, ...run], { env: { ...inherited, ULPIN_PROFILE: 'demo', ...env },
    encoding: 'utf8', timeout: 120000, windowsHide: true });
}

test('the one-call qualifier refuses a list with one absent key by its name, before it reads anything', () => {
  const absent = qualifier(gatewayEnv({ secretReferences: names }, 2));
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /the key named ULPIN_PROVIDER_KEY_SARVAM_03 is absent/);
  assert.doesNotMatch(absent.stderr, /gk2-no-such-file/);
  const other = qualifier(gatewayEnv({ secretReferences: [names[0], 'ULPIN_PROVIDER_KEY_CONTROL'] }, 1));
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /names only ULPIN_PROVIDER_KEY_SARVAM keys/);
  // Every key present: the key check passes and the run stops at the missing file, with nothing sent.
  const complete = qualifier(gatewayEnv({ secretReferences: names }, 3));
  assert.notEqual(complete.status, 0);
  assert.match(complete.stderr, /ENOENT.*gk2-no-such-file/);
  assert.doesNotMatch(complete.stderr, /one-call qualifier|GK2_NETWORK_CLOSED/);
  assert.equal(complete.stdout, '');
  for (const run of [absent, other, complete]) holdsNoKey(`${run.stdout}\n${run.stderr}`);
});
