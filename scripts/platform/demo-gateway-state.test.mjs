// Made-up values only; the real demo configuration is never opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayReport } from './demo-gateway.mjs';
import { gatewayStateText } from './demo-gateway-state.mjs';

const marker = 'zqmarker';
const providerKey = `${marker}-made-up-provider-key`;

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

test('a disabled gateway is reported as disabled, even with a provider key present', () => {
  const env = { ULPIN_MODEL_GATEWAY_ENABLED: '0', ULPIN_PROVIDER_KEY_SARVAM: providerKey };
  assert.equal(gatewayStateText(gatewayReport(env)), 'gateway disabled');
});

test('an enabled gateway names its policy hash and daily cap, and no configured value', () => {
  const env = {
    ULPIN_MODEL_GATEWAY_ENABLED: '1', ULPIN_MODEL_GATEWAY_CONFIG: JSON.stringify(policy()),
    ULPIN_PROVIDER_KEY_SARVAM: providerKey,
  };
  const report = gatewayReport(env);
  const text = gatewayStateText(report);
  assert.equal(text, `gateway enabled: policy ${report.policyHash}, daily cap set`);
  assert.match(report.policyHash, /^[a-f0-9]{64}$/);
  assert.ok(!text.includes(marker), 'the sentence must not repeat a configured value');
});

test('an enabled gateway without a daily cap says so', () => {
  const text = gatewayStateText({ enabled: true, policyHash: 'a'.repeat(64), dailyCapPresent: false });
  assert.equal(text, `gateway enabled: policy ${'a'.repeat(64)}, no daily cap`);
});
