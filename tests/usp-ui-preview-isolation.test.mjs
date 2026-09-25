import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUspIsolation } from '../scripts/usp/local-isolation.mjs';

const nonce = '0123456789abcdef';
const project = `ulpin-usptest-${nonce}`;
const database = `ulpin_usptest_${nonce}`;
const password = 'a'.repeat(64);
const preview = {
  ULPIN_ISOLATION_PROFILE: 'local-preview', ULPIN_LOCAL_NONCE: nonce,
  DOCKER_CONTEXT: process.platform === 'darwin' ? 'colima-ulpin' : 'default',
  REPO_DATA: 'false', ULPIN_BASELINE_PROJECT: project,
  POSTGRES_DB: database, POSTGRES_USER: 'ulpin_usptest', POSTGRES_PASSWORD: password,
  POSTGRES_PORT: '25432', DATABASE_URL: `postgresql://ulpin_usptest:${password}@127.0.0.1:25432/${database}`,
  S3_ACCESS_KEY: 'ulpin_usptest', S3_SECRET_KEY: 'b'.repeat(64), S3_BUCKET: project,
  S3_ENDPOINT: 'http://127.0.0.1:29000', S3_PORT: '29000', S3_CONSOLE_PORT: '29001',
  REDIS_URL: 'redis://127.0.0.1:26379/0', REDIS_PORT: '26379',
  GEO_URL: 'http://127.0.0.1:28000', GEO_PORT: '28000', GEO_SERVICE_TOKEN: 'c'.repeat(64),
  ULPIN_TEST_URL: 'http://127.0.0.1:3108',
};

test('UI preview accepts only the explicit nonce-owned loopback profile', () => {
  if (!['darwin', 'linux'].includes(process.platform)) return;
  assert.equal(assertUspIsolation(preview).project, project);
  for (const [key, value] of [
    ['ULPIN_TEST_URL', 'http://127.0.0.1:3000'],
    ['ULPIN_TEST_URL', 'http://example.com:3108'],
    ['DATABASE_URL', `postgresql://ulpin_usptest:${password}@example.com:25432/${database}`],
    ['S3_ENDPOINT', 'http://example.com:29000'],
    ['POSTGRES_DB', 'ulpin_usptest_other'],
    ['S3_BUCKET', 'ulpin-usptest-other'],
    ['DOCKER_CONTEXT', 'remote'],
    ['REPO_DATA', 'true'],
    ['NOUS_API_KEY', 'remote-key'],
  ]) assert.throws(() => assertUspIsolation({ ...preview, [key]: value }), key);
});
