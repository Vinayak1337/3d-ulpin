import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repositoryMode, repositoryEnvironment } from '../scripts/repo-env.mjs';

test('data selection is explicit and rejects misspelled values', () => {
  assert.equal(repositoryMode('true'), true);
  assert.equal(repositoryMode('false'), false);
  assert.equal(repositoryMode(''), false);
  for (const value of ['TRUE', 'yes', '1', 'false ']) assert.throws(() => repositoryMode(value));
});
test('isolated credentials are created once and preserved on reruns', () => {
  const root = mkdtempSync(join(tmpdir(), 'ulpin repo mode '));
  try {
    assert.throws(() => repositoryEnvironment(false, root), /repo:init/);
    assert.equal(existsSync(join(root, '.env')), false);
    const first = repositoryEnvironment(true, root);
    const bytes = readFileSync(join(root, '.runtime/repo-data.env'));
    assert.deepEqual(repositoryEnvironment(true, root), first);
    assert.deepEqual(readFileSync(join(root, '.runtime/repo-data.env')), bytes);
    assert.equal(first.POSTGRES_DB, 'ulpin_repo');
    assert.equal(first.S3_BUCKET, 'ulpin-repo');
    assert.equal(first.COMPOSE_PROJECT_NAME, 'ulpin-repo');
    assert.equal(new URL(first.DATABASE_URL).port, '15433');
    assert.equal(new URL(first.S3_ENDPOINT).port, '19010');
    assert.equal(new URL(first.GEO_URL).port, '18001');
    assert.equal(new URL(first.REDIS_URL).port, '16380');
    assert.notEqual(first.POSTGRES_PASSWORD, first.S3_SECRET_KEY);
    assert.ok(first.POSTGRES_PASSWORD.length >= 48);
    assert.equal(existsSync(join(root, '.env')), false);
    writeFileSync(join(root, '.runtime/repo-data.env'), bytes.toString().replace('S3_BUCKET=ulpin-repo', 'S3_BUCKET=ulpin'));
    assert.throws(() => repositoryEnvironment(false, root), /unexpected S3_BUCKET/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
