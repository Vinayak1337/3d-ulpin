// Startup on a task-private marker and stand-in commands only: no runtime settings or Docker are read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeDefinition } from './demo-config.mjs';
import { startRuntime } from './demo.mjs';

const ready = { ready: true, missingRelations: [], missingColumns: [], missingMigrations: [], invalidIndexes: 0 };
const pending = { ...ready, ready: false, missingMigrations: ['usp_job_failure_cause_001'],
  missingColumns: ['public.usp_job_attempts.failure_cause'] };
const stores = ['postgres', 'minio', 'redis'];

function existingInventory(project) {
  const storage = [['postgres', 'postgres-data', '/var/lib/postgresql/data'],
    ['minio', 'minio-data', '/data'], ['redis', 'redis-data', '/data']];
  return {
    volumes: storage.map(([, volume]) => `${project}_${volume}`),
    volumeOwners: Object.fromEntries(storage.map(([, volume]) => [`${project}_${volume}`, { project, volume }])),
    containers: [...storage.map(([service, volume, destination]) => ({ project, service, state: 'exited',
      mounts: [{ Type: 'volume', Name: `${project}_${volume}`, Destination: destination, RW: true }] })),
    ...['geo', 'worker'].map(service => ({ project, service }))],
  };
}

for (const [name, schemas, expected, refusal] of [
  ['pending migrations run once between stores and processes', [pending, ready],
    ['stores', 'readiness', 'db:migrate', 'demo-schema.ts', 'readiness', 'processes', 'health', 'doctor']],
  ['ready schema runs neither migration command', [ready], ['stores', 'readiness', 'processes', 'health', 'doctor']],
  ['still missing schema refuses before processes', [pending, pending],
    ['stores', 'readiness', 'db:migrate', 'demo-schema.ts', 'readiness'], true],
]) {
  test(name, async t => {
    const folder = mkdtempSync(join(tmpdir(), 'resume-migrations-'));
    const definition = runtimeDefinition('ulpin-demo', folder);
    mkdirSync(definition.dir);
    const marker = JSON.stringify({ project: definition.project, schemaOnly: true });
    writeFileSync(definition.marker, marker);
    const events = [], commands = [];
    const output = t.mock.method(console, 'log', () => {});
    const env = { ULPIN_PROFILE: 'demo', REPO_DATA: 'false', API_PORT: '3194' };
    const action = startRuntime(definition, false, {
      connect: () => ({}), readDemo: () => env,
      inventory: (_runtime, project) => existingInventory(project),
      compose: (_runtime, childEnv, args, _timeout, target) => {
        assert.equal(childEnv, env);
        assert.equal(target, definition);
        assert.deepEqual(args, ['--profile', 'app', 'start', '--wait', '--wait-timeout', '120',
          ...stores, 'geo', 'worker']);
        events.push('stores');
      },
      execute: (file, args, childEnv) => {
        commands.push({ file, args, env: childEnv });
        if (args.includes('--eval')) {
          assert.match(args.at(-1), /databaseReadiness/);
          assert.match(args.at(-1), /finally \{ await closePool\(\); \}/);
          events.push('readiness');
          return JSON.stringify(schemas.shift());
        }
        if (args.some(arg => arg.endsWith('demo-schema.ts'))) events.push('demo-schema.ts');
        else if (args.some(arg => arg.endsWith('doctor'))) events.push('doctor');
        else events.push('db:migrate');
        return '';
      },
      launchProcesses: async () => events.push('processes'),
      waitForApi: async () => events.push('health'),
      clearStoppedOnPurpose: () => {}, gatewayReport: () => ({ enabled: false }),
    });
    if (refusal) await assert.rejects(action, /still missing.*usp_job_failure_cause_001.*failure_cause/);
    else await action;
    assert.deepEqual(events, expected);
    const migrations = commands.filter(command => command.args.includes('db:migrate')
      || command.args.includes('pnpm db:migrate') || command.args.some(arg => arg.endsWith('demo-schema.ts')));
    assert.equal(migrations.length, expected.includes('db:migrate') ? 2 : 0);
    if (migrations.length) {
      assert.deepEqual(migrations[0].args, process.platform === 'win32'
        ? ['/d', '/s', '/c', 'pnpm db:migrate'] : ['db:migrate']);
      assert.match(migrations[0].env.NODE_OPTIONS, /isolated-env\.cjs/);
      assert.equal(migrations[1].file, process.execPath);
      assert.equal(migrations[1].env, env);
      assert.match(output.mock.calls.map(call => call.arguments[0]).join('\n'), /usp_job_failure_cause_001/);
    } else {
      const notices = output.mock.calls.filter(call => /no pending migrations; nothing applied/.test(call.arguments[0]));
      assert.equal(notices.length, 1);
    }
    assert.deepEqual(readdirSync(definition.dir), ['bootstrap.complete.json']);
    assert.equal(readFileSync(definition.marker, 'utf8'), marker);
  });
}

test('doctor directs a failed migration admission to platform:start', () => {
  const doctor = readFileSync(new URL('./doctor', import.meta.url), 'utf8');
  assert.match(doctor, /DB migrations applied[\s\S]*run pnpm platform:start.*pending additive migrations/);
});
