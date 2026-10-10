// Every file here is a temporary one with made-up values; the real demo configuration is never opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDemoSettings, redact } from './demo-config.mjs';
import { disableGateway, enableGateway, gatewayReport, gatewayReportLines } from './demo-gateway.mjs';

const marker = 'zqmarker';
const providerKey = `${marker}-made-up-provider-key`;
const hexSecrets = ['a1', 'b2', 'c3'].map(pair => pair.repeat(32));
const flagKey = 'ULPIN_MODEL_GATEWAY_ENABLED';
const policyKey = 'ULPIN_MODEL_GATEWAY_CONFIG';
const adapterKey = 'ULPIN_MAPPING_TEACHER_ADAPTER';
const stopped = () => [];

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
  const file = join(folder, 'demo.env');
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
    assert.deepEqual(readdirSync(folder).sort(), ['demo.env', 'policy.json']);
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
  assert.deepEqual(readdirSync(folder).sort(), ['demo.env', 'policy.json']);
});

test('the report states five facts and no configured value', () => {
  const disabled = gatewayReport({ [flagKey]: '0', ULPIN_PROVIDER_KEY_SARVAM: providerKey });
  assert.deepEqual(disabled, {
    enabled: false, policyHash: null, providerKeyPresent: true, mappingTeacherAdapter: 'replay', dailyCapPresent: false,
  });
  const enabled = gatewayReport({
    [flagKey]: '1', [policyKey]: JSON.stringify(policy()), [adapterKey]: 'sarvam',
    ULPIN_PROVIDER_KEY_SARVAM: providerKey,
  });
  assert.match(enabled.policyHash, /^[a-f0-9]{64}$/);
  assert.deepEqual({ ...enabled, policyHash: null }, {
    enabled: true, policyHash: null, providerKeyPresent: true, mappingTeacherAdapter: 'sarvam', dailyCapPresent: true,
  });
  assert.equal(gatewayReport({ [flagKey]: '0', [adapterKey]: 'sarvam' }).mappingTeacherAdapter, 'manual');
  const lines = gatewayReportLines(enabled);
  assert.equal(lines.length, 5);
  assertNamesNoValue(lines.join('\n'));
});

test('redaction covers the provider key and ignores empty values', () => {
  const env = { ULPIN_PROVIDER_KEY_SARVAM: providerKey, S3_ACCESS_KEY: '' };
  assert.equal(redact(`failed with ${providerKey} in output`, env), 'failed with [redacted] in output');
});
