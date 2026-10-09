import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startProblems, storageProblems, root } from './runtime.mjs';
import { assertDemoConfigMayBeGenerated, demoProject } from './demo-config.mjs';

const receipt = JSON.parse(readFileSync(new URL('./evidence/s03/result.json', import.meta.url)));
test('observed retained inventory cannot authorize replacement ulpin storage; legacy modes keep their original setup route', () => {
  const snapshot = receipt.requestedProjectInventory;
  assert.equal(snapshot.volumes.length, 14);
  assert.equal(snapshot.containers.length, 0);
  assert.equal(storageProblems(snapshot).length, 6);
  assert.equal(startProblems(snapshot).length, 8);
  const start = readFileSync(new URL('../platform-start.sh', import.meta.url), 'utf8');
  assert.ok(start.indexOf('platform/runtime.mjs') < start.indexOf('ulpin_compose up'));
  assert.doesNotMatch(start, /platform-env\.sh|platform-mode\.mjs/);
  assert.match(start, /ULPIN_PROJECT.*ulpin-repo.*pnpm db:migrate/);
  assert.match(start, /ulpin_compose run --rm minio-init/);
  const mode = readFileSync(new URL('./legacy-mode.mjs', import.meta.url), 'utf8');
  assert.match(mode, /repositoryEnvironment\(false\)/);
  assert.doesNotMatch(mode, /repositoryEnvironment\(true\)/);
});

test('the approved demo volume names trigger the missing-configuration password trap without touching configuration', () => {
  const volumes = ['postgres-data', 'minio-data', 'redis-data'].map(name => `${demoProject}_${name}`);
  assert.ok(volumes.every(name => name.startsWith(`${demoProject}_`)));
  assert.throws(() => assertDemoConfigMayBeGenerated(false, volumes, true), /never generate replacement passwords/);
  assert.doesNotThrow(() => assertDemoConfigMayBeGenerated(true, volumes, true));
  assert.doesNotThrow(() => assertDemoConfigMayBeGenerated(false, receipt.requestedProjectInventory.volumes, false));
});

test('demo preload blocks checkout .env access before server imports', () => {
  const script = `const fs=require('node:fs'),path=require('node:path');
    const file=path.resolve('.env'); if(fs.existsSync(file))throw Error('Env visible');
    let blocked=false;try{fs.readFileSync(file)}catch(e){blocked=e.code==='EACCES'}
    if(!blocked)throw Error('Env read allowed'); console.log('blocked');`;
  const output = execFileSync(process.execPath, ['--require', fileURLToPath(new URL('./isolated-env.cjs', import.meta.url)), '-e', script],
    { cwd: root, env: { ...process.env, ULPIN_PROFILE: 'demo' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(output.trim(), 'blocked');
});
