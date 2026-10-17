// Settings here are made-up text in temporary files (not named *.env); keys are made-up strings with a marker.
// No runtime's own settings file is opened, no provider is called and no database is reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoFile, readDemoSettings, runtimeDefinition, runtimeSettings, safeEnvironment } from './demo-config.mjs';
import {
  disableGateway, enableGateway, gatewayReport, ledgerChildArguments, ledgerStep, runtimeOption, writeKeyList,
} from './demo-gateway.mjs';
import { root } from './runtime.mjs';

const marker = 'zqmarker';
const stopped = () => [];
const temporary = () => mkdtempSync(join(tmpdir(), 'runtime-gateway-'));
/** A made-up settings file for one runtime, as create would write it, with made-up secrets. */
function settingsFile(name, folder = temporary()) {
  const secrets = ['a1', 'b2', 'c3'].map(pair => pair.repeat(32));
  const text = Object.entries(runtimeSettings(name, () => secrets.shift()))
    .map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
  const file = join(folder, `${name}-settings.txt`);
  writeFileSync(file, text);
  return file;
}
function policyFile(folder) {
  const policy = {
    projectId: `${marker}-project`, policyVersion: `${marker}-policy/1`, fundingVersion: `${marker}-funding/1`,
    gatewayExclusiveFunding: true, indiaPrivateApproved: true, secretReference: 'ULPIN_PROVIDER_KEY_SARVAM',
    model: 'sarvam-105b', projectCapMicroInr: '2', projectDailyCapMicroInr: '1', principalDailyCallCap: 1,
    price: { version: `${marker}-not-a-tariff`, inputPerMillionMicroInr: '1',
      cachedInputPerMillionMicroInr: '1', outputPerMillionMicroInr: '1' },
    inputBound: { version: `${marker}-bound/1`, maxPromptTokens: 34816 }, paceMs: 1500,
  };
  const file = join(folder, 'policy.json');
  writeFileSync(file, JSON.stringify(policy));
  return file;
}
function keysFile(folder) {
  const file = join(folder, 'keys.txt');
  writeFileSync(file, [1, 2, 3].map(number => `${marker}-made-up-list-key-${number}`).join('\n') + '\n');
  return file;
}

test('--runtime <name> ends any gateway command, defaults to ulpin-demo and is checked before anything is read', () => {
  assert.deepEqual(runtimeOption(['status']), { runtime: runtimeDefinition(), rest: ['status'] });
  assert.equal(runtimeOption(['status']).runtime.file, demoFile);
  const named = runtimeOption(['reconcile', '--reason', 'made-up reason', '--runtime', 'ulpin-reh-01']);
  assert.deepEqual([named.runtime.name, named.rest], ['ulpin-reh-01', ['reconcile', '--reason', 'made-up reason']]);
  assert.equal(named.runtime.file, runtimeDefinition('ulpin-reh-01').file);
  assert.notEqual(named.runtime.file, demoFile);
  for (const name of ['ulpin-prod', 'ulpin', 'ulpin-reh-1', 'status']) {
    assert.throws(() => runtimeOption(['status', '--runtime', name]), /Unknown runtime name/);
  }
  assert.throws(() => runtimeOption(['status', '--runtime']), /^Error: Usage: demo-gateway\.mjs status /);
});

test('a switch for a rehearsal reads and writes that runtime\'s settings only; the demo\'s stay byte for byte', () => {
  const folder = temporary();
  const demo = settingsFile('ulpin-demo', folder), rehearsal = settingsFile('ulpin-reh-01', folder);
  const before = { demo: readFileSync(demo, 'hex'), rehearsal: readFileSync(rehearsal, 'hex') };
  const asked = [];
  const running = () => { asked.push('asked'); return []; };
  assert.deepEqual(disableGateway({ runtime: 'ulpin-reh-01', file: rehearsal, running }), []);
  assert.deepEqual(asked, ['asked']);
  assert.equal(gatewayReport(readDemoSettings(rehearsal, 'ulpin-reh-01')).enabled, false);
  assert.deepEqual([readFileSync(demo, 'hex'), readFileSync(rehearsal, 'hex')], [before.demo, before.rehearsal]);
  // One runtime's settings under another's name are refused by the reader, in both directions.
  assert.throws(() => disableGateway({ runtime: 'ulpin-reh-01', file: demo, running: stopped }),
    /Unexpected demo setting [A-Z0-9_]+; refusing profile mixing\./);
  assert.throws(() => disableGateway({ file: rehearsal, running: stopped }), /Unexpected demo setting/);
  assert.throws(() => disableGateway({ runtime: 'ulpin-reh-02', file: rehearsal, running: stopped }),
    /Unexpected demo setting/);
  assert.deepEqual([readFileSync(demo, 'hex'), readFileSync(rehearsal, 'hex')], [before.demo, before.rehearsal]);
});

test('a switch asks about the named runtime\'s own recorded processes', () => {
  const folder = temporary();
  const file = settingsFile('ulpin-reh-01', folder);
  assert.throws(() => disableGateway({ runtime: 'ulpin-reh-01', file, running: () => ['api'] }),
    /api recorded as running/);
  // Without a stand-in the switch reads <that runtime's folder>/<label>.process.json. Two made-up runtime
  // folders show it: an empty one counts as stopped; a stray record is refused only in the folder it lies in.
  const [first, second] = ['ulpin-reh-01', 'ulpin-reh-02'].map(name => runtimeDefinition(name, folder));
  for (const runtime of [first, second]) mkdirSync(runtime.dir, { recursive: true });
  const stray = { project: 'ulpin-demo', label: 'api', pid: 1, creationDate: 'made-up', executable: 'made-up',
    entry: 'made-up', preload: 'made-up' };
  writeFileSync(join(second.dir, 'api.process.json'), JSON.stringify(stray) + '\n');
  assert.deepEqual(disableGateway({ runtime: first, file }), []);
  assert.throws(() => disableGateway({ runtime: second, file: settingsFile('ulpin-reh-02', folder) }),
    /Unexpected process ownership record/);
});

test('keys for a rehearsal name is refused unless it is a dry run; enable is refused because no key is there', () => {
  const folder = temporary();
  const rehearsal = settingsFile('ulpin-reh-01', folder);
  const before = readFileSync(rehearsal, 'hex');
  const keys = keysFile(folder);
  assert.throws(() => writeKeyList({ keysFile: keys, runtime: 'ulpin-reh-01', file: rehearsal, running: stopped }),
    /^Error: No real key goes into a rehearsal: keys for ulpin-reh-01 is refused without --dry-run\.$/);
  assert.equal(readFileSync(rehearsal, 'hex'), before);
  const out = temporary();
  const names = writeKeyList({ keysFile: keys, runtime: 'ulpin-reh-01', file: rehearsal, outFolder: out });
  assert.deepEqual(names, ['01', '02', '03'].map(number => `ULPIN_PROVIDER_KEY_SARVAM_${number}`));
  assert.deepEqual(readdirSync(out), ['demo-settings-after-keys.txt']);
  assert.equal(readFileSync(rehearsal, 'hex'), before);
  assert.throws(() => enableGateway({ policyFile: policyFile(folder), runtime: 'ulpin-reh-01', file: rehearsal,
    running: stopped }), /ULPIN_PROVIDER_KEY_SARVAM is required while ULPIN_MODEL_GATEWAY_ENABLED is 1\./);
  assert.equal(readFileSync(rehearsal, 'hex'), before);
});

test('the ledger step names a rehearsal to its child; the demo\'s child arguments are as they were', () => {
  assert.deepEqual(ledgerChildArguments(['key-marks']), ['key-marks']);
  assert.deepEqual(ledgerChildArguments(['restore-key', 'ULPIN_PROVIDER_KEY_SARVAM_01', 'made-up'], 'ulpin-demo'),
    ['restore-key', 'ULPIN_PROVIDER_KEY_SARVAM_01', 'made-up']);
  assert.deepEqual(ledgerChildArguments(['key-marks'], 'ulpin-reh-01'), ['--runtime', 'ulpin-reh-01', 'key-marks']);
  assert.throws(() => ledgerChildArguments(['key-marks'], 'ulpin-prod'), /Unknown runtime name/);
  const seen = [];
  const step = args => { seen.push(args); return ['made-up line']; };
  assert.deepEqual(ledgerStep('key-marks', [], step, 'ulpin-reh-01'), ['made-up line']);
  assert.deepEqual(seen, [['key-marks']]);
});

test('the ledger child refuses settings of a runtime other than the one it was named, before any step', () => {
  const preload = join(root, 'scripts/platform/isolated-env.cjs');
  const entry = fileURLToPath(new URL('./demo-gateway-ledger.ts', import.meta.url));
  const child = (project, args) => spawnSync(
    process.execPath, ['--require', preload, '--import', 'tsx', entry, ...args],
    { cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true,
      env: safeEnvironment({ ULPIN_PROFILE: 'demo', REPO_DATA: 'false', COMPOSE_PROJECT_NAME: project }) },
  );
  const refusal = /^MODEL_CONFIGURATION: The ledger step was given another runtime's settings\.$/m;
  const named = ['--runtime', 'ulpin-reh-01', 'key-marks'];
  for (const [project, args] of [['ulpin-reh-01', ['key-marks']], ['ulpin-demo', named], ['ulpin-reh-02', named]]) {
    const result = child(project, args);
    assert.equal(result.status, 1, `${project} ${args.join(' ')}`);
    assert.match(result.stderr, refusal);
    assert.equal(result.stdout, '');
  }
});
