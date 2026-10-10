// Every file here is a temporary one with made-up values; the real demo configuration is never opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDemoSettings, redact } from './demo-config.mjs';
import {
  disableGateway, enableGateway, gatewayReport, gatewayReportLines, ledgerStep, writeKeyList,
} from './demo-gateway.mjs';

const marker = 'zqmarker';
const providerKey = `${marker}-made-up-provider-key`;
const hexSecrets = ['a1', 'b2', 'c3'].map(pair => pair.repeat(32));
const flagKey = 'ULPIN_MODEL_GATEWAY_ENABLED';
const policyKey = 'ULPIN_MODEL_GATEWAY_CONFIG';
const adapterKey = 'ULPIN_MAPPING_TEACHER_ADAPTER';
const stopped = () => [];
// Not named demo.env: the guard these tests run under refuses every file of that kind, made-up or not.
const settingsName = 'demo-settings.txt';
const listNames = ['01', '02', '03'].map(number => `ULPIN_PROVIDER_KEY_SARVAM_${number}`);
const listKeys = listNames.map((_name, index) => `${marker}-made-up-list-key-${index + 1}`);
const listPolicy = (overrides = {}) =>
  policy({ secretReference: undefined, secretReferences: listNames, ...overrides });
const listKeyLines = (keys = listKeys) => keys.map((key, index) => `${listNames[index]}=${key}`);

/** Test-only labels and amounts that satisfy the schema. Not a tariff, cap or funding statement. */
function policy(overrides = {}) {
  return {
    projectId: `${marker}-project`, policyVersion: `${marker}-policy/1`, fundingVersion: `${marker}-funding/1`,
    gatewayExclusiveFunding: true, indiaPrivateApproved: true, secretReference: 'ULPIN_PROVIDER_KEY_SARVAM',
    model: 'sarvam-105b', projectCapMicroInr: '2', projectDailyCapMicroInr: '1', principalDailyCallCap: 1,
    price: {
      version: `${marker}-not-a-tariff`, inputPerMillionMicroInr: '1',
      cachedInputPerMillionMicroInr: '1', outputPerMillionMicroInr: '1',
    },
    inputBound: { version: `${marker}-bound/1`, maxPromptTokens: 34816 }, paceMs: 1500, ...overrides,
  };
}

/** The generator's line order with made-up secrets; gatewayLines replace the generator's single flag line. */
function settingsLines(gatewayLines = [`${flagKey}=0`], keyLine = `ULPIN_PROVIDER_KEY_SARVAM=${providerKey}`) {
  const [password, objectSecret, geoToken] = hexSecrets;
  return [
    'POSTGRES_PORT=15434', 'S3_PORT=19020', 'S3_CONSOLE_PORT=19021', 'REDIS_PORT=16381', 'GEO_PORT=18002',
    'API_PORT=3194', 'ULPIN_PROFILE=demo', 'COMPOSE_PROJECT_NAME=ulpin-demo', 'REPO_DATA=false',
    'POSTGRES_DB=ulpin_demo', 'POSTGRES_USER=ulpin_demo', `POSTGRES_PASSWORD=${password}`,
    `DATABASE_URL=postgresql://ulpin_demo:${password}@127.0.0.1:15434/ulpin_demo`,
    'S3_ENDPOINT=http://127.0.0.1:19020', 'S3_ACCESS_KEY=ulpindemo', `S3_SECRET_KEY=${objectSecret}`,
    'S3_BUCKET=ulpin-demo', 'S3_REGION=us-east-1', `GEO_SERVICE_TOKEN=${geoToken}`,
    'GEO_URL=http://127.0.0.1:18002', 'REDIS_URL=redis://127.0.0.1:16381/0',
    'ULPIN_LOCAL_OPERATOR_SUBJECT=selection-demo-runtime', ...gatewayLines,
    `ULPIN_DEMO_MODEL_DIR=${marker}/models`, ...(keyLine ? [keyLine] : []),
  ];
}

function enabledLines(policyText = JSON.stringify(policy())) {
  return [`${flagKey}=1`, `${policyKey}=${policyText}`];
}

function temporaryFolder(context) {
  const folder = mkdtempSync(join(tmpdir(), 'demo-gateway-'));
  context.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function writeSettings(folder, lines, newline = '\n') {
  const file = join(folder, settingsName);
  writeFileSync(file, lines.join(newline) + newline);
  return file;
}

function assertNamesNoValue(message) {
  for (const value of [marker, ...hexSecrets]) {
    assert.ok(!message.toLowerCase().includes(value), 'a refusal must not repeat a configured value');
  }
}

function assertRefused(folder, lines, expected) {
  assert.throws(() => readDemoSettings(writeSettings(folder, lines)), error => {
    assert.match(error.message, expected);
    assertNamesNoValue(error.message);
    return true;
  });
}

test('a disabled gateway passes, and carries neither a policy nor the live teacher', context => {
  const folder = temporaryFolder(context);
  const disabledWith = line => settingsLines([`${flagKey}=0`, line]);
  assert.equal(readDemoSettings(writeSettings(folder, settingsLines()))[flagKey], '0');
  assert.equal(readDemoSettings(writeSettings(folder, disabledWith(`${adapterKey}=manual`)))[adapterKey], 'manual');
  const policyLine = `${policyKey}=${JSON.stringify(policy())}`;
  assertRefused(folder, disabledWith(policyLine), /ULPIN_MODEL_GATEWAY_CONFIG is not allowed/);
  assertRefused(folder, disabledWith(`${adapterKey}=sarvam`), /ULPIN_MAPPING_TEACHER_ADAPTER cannot/);
});

test('an enabled gateway needs a schema-valid policy, the Sarvam key reference, the key and a daily cap', context => {
  const folder = temporaryFolder(context);
  assert.equal(readDemoSettings(writeSettings(folder, settingsLines(enabledLines())))[flagKey], '1');
  const withPolicy = overrides => settingsLines(enabledLines(JSON.stringify(policy(overrides))));
  const keyRequired = /ULPIN_PROVIDER_KEY_SARVAM is required/;
  assertRefused(folder, settingsLines(enabledLines(), null), keyRequired);
  assertRefused(folder, settingsLines(enabledLines(), 'ULPIN_PROVIDER_KEY_SARVAM='), keyRequired);
  assertRefused(folder, settingsLines([`${flagKey}=1`]), /ULPIN_MODEL_GATEWAY_CONFIG must be valid JSON/);
  assertRefused(folder, settingsLines(enabledLines(`{"projectId":"${marker}"`)), /must be valid JSON/);
  assertRefused(folder, withPolicy({ secretReference: `ULPIN_PROVIDER_KEY_${marker.toUpperCase()}` }),
    /secretReference must be exactly ULPIN_PROVIDER_KEY_SARVAM/);
  assertRefused(folder, withPolicy({ projectDailyCapMicroInr: undefined }), /projectDailyCapMicroInr is required/);
  assertRefused(folder, withPolicy({ price: undefined }), /refused by the model gateway schema/);
});

test('a flag other than 0 or 1 is refused', context => {
  const lines = settingsLines([`${flagKey}=2`, ...enabledLines().slice(1)]);
  assertRefused(temporaryFolder(context), lines, /ULPIN_MODEL_GATEWAY_ENABLED must be 0 or 1/);
});

test('enable then disable restores the original bytes in either newline style, and no other line moves', context => {
  for (const newline of ['\n', '\r\n']) {
    const folder = temporaryFolder(context);
    const file = writeSettings(folder, settingsLines(), newline);
    const policyFile = join(folder, 'policy.json');
    writeFileSync(policyFile, JSON.stringify(policy(), null, 2));
    const original = readFileSync(file);
    const gatewayLine = /^ULPIN_(MODEL_GATEWAY|MAPPING_TEACHER)_/;
    const otherLines = text => text.split(newline).filter(line => !gatewayLine.test(line));

    assert.deepEqual(enableGateway({ policyFile, file, running: stopped }), [flagKey, policyKey, adapterKey]);
    const enabled = readFileSync(file, 'utf8');
    assert.deepEqual(otherLines(enabled), otherLines(original.toString('utf8')));
    assert.equal(enabled.split(newline).length, original.toString('utf8').split(newline).length + 2);
    assert.equal(readDemoSettings(file)[adapterKey], 'sarvam');

    assert.deepEqual(disableGateway({ file, running: stopped }), [flagKey, policyKey, adapterKey]);
    assert.ok(readFileSync(file).equals(original));
    assert.deepEqual(readdirSync(folder).sort(), [settingsName, 'policy.json']);
  }
});

test('a refused change leaves the file and its folder as they were', context => {
  const folder = temporaryFolder(context);
  const file = writeSettings(folder, settingsLines());
  const policyFile = join(folder, 'policy.json');
  const original = readFileSync(file);
  writeFileSync(policyFile, JSON.stringify(policy()));
  assert.throws(() => enableGateway({ policyFile, file, running: () => ['api'] }), /api recorded as running/);
  assert.throws(() => disableGateway({ file, running: () => ['api', 'dispatcher'] }), /api and dispatcher recorded/);
  writeFileSync(policyFile, JSON.stringify(policy({ price: undefined })));
  assert.throws(() => enableGateway({ policyFile, file, running: stopped }), error => {
    assert.match(error.message, /refused by the model gateway schema/);
    assertNamesNoValue(error.message);
    return true;
  });
  assert.ok(readFileSync(file).equals(original));
  assert.deepEqual(readdirSync(folder).sort(), ['policy.json', settingsName].sort());
});

test('a list policy needs every key it names; a refusal names the missing name and never a value', context => {
  const folder = temporaryFolder(context);
  const enabled = (overrides, keys = listKeyLines()) =>
    settingsLines([...enabledLines(JSON.stringify(listPolicy(overrides))), ...keys], null);
  assert.equal(readDemoSettings(writeSettings(folder, enabled()))[flagKey], '1');
  assertRefused(folder, enabled({}, listKeyLines().slice(0, 2)), /ULPIN_PROVIDER_KEY_SARVAM_03 is required/);
  assertRefused(folder, enabled({}, [listKeyLines()[0], `${listNames[1]}=`, listKeyLines()[2]]),
    /ULPIN_PROVIDER_KEY_SARVAM_02 is required/);
  const form = /secretReferences must list names of the form ULPIN_PROVIDER_KEY_SARVAM_01/;
  assertRefused(folder, enabled({ secretReferences: [listNames[0], listKeys[1]] }), form);
  assertRefused(folder, enabled({ secretReferences: listNames[0] }), form);
  assertRefused(folder, enabled({ secretReferences: [listNames[0], listNames[0]] }), /refused by the model gateway/);
  assertRefused(folder, enabled({ secretReference: 'ULPIN_PROVIDER_KEY_SARVAM' }), /refused by the model gateway/);
});

test('the keys step writes numbered key lines, prints names only, and its rehearsal changes nothing', context => {
  const folder = temporaryFolder(context);
  const file = writeSettings(folder, settingsLines(), '\r\n');
  const keysFile = join(folder, 'keys.txt');
  const original = readFileSync(file);
  writeFileSync(keysFile, `${listKeys.join('\n')}\n\n`);
  assert.deepEqual(writeKeyList({ keysFile, file, outFolder: folder }), listNames);
  assert.ok(readFileSync(file).equals(original), 'a rehearsal leaves the settings as they were');
  const rehearsed = readFileSync(join(folder, 'demo-settings-after-keys.txt'), 'utf8');
  assert.throws(() => writeKeyList({ keysFile, file, running: () => ['api'] }), /api recorded as running/);
  assert.deepEqual(writeKeyList({ keysFile, file, running: stopped }), listNames);
  assert.equal(readFileSync(file, 'utf8'), rehearsed);
  assert.equal(rehearsed, original.toString('utf8') + listKeyLines().join('\r\n') + '\r\n');
  // A shorter list replaces the numbered lines; the owner's single key line is never touched.
  writeFileSync(keysFile, listKeys.slice(0, 2).reverse().join('\r\n'));
  assert.deepEqual(writeKeyList({ keysFile, file, running: stopped }), listNames.slice(0, 2));
  const env = readDemoSettings(file);
  assert.deepEqual([env[listNames[0]], env[listNames[1]], env[listNames[2]], env.ULPIN_PROVIDER_KEY_SARVAM],
    [listKeys[1], listKeys[0], undefined, providerKey]);
  for (const text of [listKeys[0], `${listKeys[0]}\n${listKeys[0]}`, `${listKeys[0]}\n${marker} two words`]) {
    writeFileSync(keysFile, text);
    assert.throws(() => writeKeyList({ keysFile, file, running: stopped }), error => {
      assert.match(error.message, /keys file/);
      assertNamesNoValue(error.message);
      return true;
    });
  }
  assert.throws(() => writeKeyList({ keysFile: join(folder, 'absent.txt'), file, running: stopped }), /readable/);
});

/** The command as the owner types it, in a child process: only there does the argument rule apply. */
function keysCommand(options) {
  const script = fileURLToPath(new URL('./demo-gateway.mjs', import.meta.url));
  return spawnSync(process.execPath, [script, 'keys', ...options], { encoding: 'utf8', timeout: 60000,
    windowsHide: true });
}

test('a keys rehearsal without --settings is refused with the usage text and reads no file', context => {
  const folder = temporaryFolder(context);
  const out = join(folder, 'out');
  mkdirSync(out);
  // The keys file does not exist. It is read before the settings, so a run that read anything would say so
  // instead of printing the usage text; the demo settings are never the starting point.
  const absentKeys = join(folder, 'absent-keys.txt');
  for (const rest of [['--out', out], ['--out', out, '--settings'], []]) {
    const refused = keysCommand(['--from', absentKeys, '--dry-run', ...rest]);
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /^Usage: demo-gateway\.mjs status /);
    assert.ok(refused.stderr.includes('keys --from <file> [--dry-run --out <folder> --settings <file>]'));
    assert.doesNotMatch(refused.stderr, /readable|absent-keys/);
    assert.equal(refused.stderr.trim().split(/\r?\n/).length, 3, 'the usage text and nothing else');
  }
  assert.deepEqual([readdirSync(out), readdirSync(folder)], [[], ['out']]);
});

test('a keys rehearsal with --settings writes only into the out folder and prints names only', context => {
  const folder = temporaryFolder(context);
  const [source, out] = ['source', 'out'].map(name => join(folder, name));
  mkdirSync(source);
  mkdirSync(out);
  const file = writeSettings(source, settingsLines(), '\r\n');
  const keysFile = join(source, 'keys.txt');
  writeFileSync(keysFile, `${listKeys.join('\n')}\n`);
  const before = [file, keysFile].map(path => readFileSync(path));
  const rehearsal = keysCommand(['--from', keysFile, '--dry-run', '--out', out, '--settings', file]);
  assert.deepEqual([rehearsal.status, rehearsal.stderr], [0, '']);
  assert.ok(rehearsal.stdout.startsWith(`3 keys would be written as ${listNames[0]} to ${listNames[2]}\n`));
  assert.match(rehearsal.stdout, /Rehearsal only: the demo settings were not changed\./);
  assertNamesNoValue(rehearsal.stdout);
  assert.deepEqual(readdirSync(out), ['demo-settings-after-keys.txt']);
  assert.deepEqual(readdirSync(source).sort(), [settingsName, 'keys.txt'].sort());
  assert.deepEqual(readdirSync(folder).sort(), ['out', 'source']);
  [file, keysFile].forEach((path, index) => assert.ok(readFileSync(path).equals(before[index]), 'inputs unchanged'));
  assert.equal(readFileSync(join(out, 'demo-settings-after-keys.txt'), 'utf8'),
    before[0].toString('utf8') + listKeyLines().join('\r\n') + '\r\n');
});

test('the ledger steps need the owner\'s reason and a key name; nothing else reaches the ledger', () => {
  const steps = [];
  const step = args => { steps.push(args); return ['done']; };
  assert.deepEqual(ledgerStep('key-marks', [], step), ['done']);
  ledgerStep('reconcile', ['--reason', ' the owner reordered the keys '], step);
  ledgerStep('restore-key', [listNames[1], '--reason', 'credits added'], step);
  assert.deepEqual(steps, [['key-marks'], ['reconcile', 'the owner reordered the keys'],
    ['restore-key', listNames[1], 'credits added']]);
  for (const [action, options] of [['reconcile', []], ['reconcile', ['--reason', 'x']], ['key-marks', ['extra']],
    ['restore-key', [listNames[1]]], ['restore-key', [listKeys[1], '--reason', 'credits added']], ['rotate', []]]) {
    assert.throws(() => ledgerStep(action, options, step), error => {
      assert.match(error.message, /^Usage:/);
      assertNamesNoValue(error.message);
      return true;
    });
  }
  assert.equal(steps.length, 3);
  assert.equal(existsSync(new URL('./demo-gateway-ledger.ts', import.meta.url)), true);
});

test('the report states seven facts and no configured value', () => {
  const disabled = gatewayReport({ [flagKey]: '0', ULPIN_PROVIDER_KEY_SARVAM: providerKey });
  assert.deepEqual(disabled, {
    enabled: false, policyHash: null, providerKeyPresent: true, mappingTeacherAdapter: 'replay', dailyCapPresent: false,
    providerKeysNamed: 0, providerKeysPresent: 1,
  });
  const staged = Object.fromEntries(listKeyLines().map(line => line.split('=')));
  assert.deepEqual(gatewayReport({ [flagKey]: '0', ...staged, S3_SECRET_KEY: hexSecrets[1] }), {
    enabled: false, policyHash: null, providerKeyPresent: true, mappingTeacherAdapter: 'replay', dailyCapPresent: false,
    providerKeysNamed: 0, providerKeysPresent: 3,
  });
  assert.equal(gatewayReport({ [flagKey]: '0' }).providerKeyPresent, false);
  const listEnv = { [flagKey]: '1', [policyKey]: JSON.stringify(listPolicy()), [adapterKey]: 'sarvam', ...staged };
  const listed = gatewayReport(listEnv);
  assert.deepEqual([listed.providerKeyPresent, listed.providerKeysNamed, listed.providerKeysPresent,
    listed.mappingTeacherAdapter], [true, 3, 3, 'sarvam']);
  const oneMissing = gatewayReport({ ...listEnv, [listNames[2]]: '' });
  assert.deepEqual([oneMissing.providerKeyPresent, oneMissing.providerKeysNamed, oneMissing.providerKeysPresent,
    oneMissing.mappingTeacherAdapter], [false, 3, 2, 'manual']);
  assertNamesNoValue(gatewayReportLines(listed).join('\n'));
  const enabled = gatewayReport({
    [flagKey]: '1', [policyKey]: JSON.stringify(policy()), [adapterKey]: 'sarvam',
    ULPIN_PROVIDER_KEY_SARVAM: providerKey,
  });
  assert.match(enabled.policyHash, /^[a-f0-9]{64}$/);
  assert.deepEqual({ ...enabled, policyHash: null }, {
    enabled: true, policyHash: null, providerKeyPresent: true, mappingTeacherAdapter: 'sarvam', dailyCapPresent: true,
    providerKeysNamed: 1, providerKeysPresent: 1,
  });
  assert.equal(gatewayReport({ [flagKey]: '0', [adapterKey]: 'sarvam' }).mappingTeacherAdapter, 'manual');
  const lines = gatewayReportLines(enabled);
  assert.equal(lines.length, 7);
  assertNamesNoValue(lines.join('\n'));
});

test('redaction covers the provider key and ignores empty values', () => {
  const env = { ULPIN_PROVIDER_KEY_SARVAM: providerKey, S3_ACCESS_KEY: '' };
  assert.equal(redact(`failed with ${providerKey} in output`, env), 'failed with [redacted] in output');
});
