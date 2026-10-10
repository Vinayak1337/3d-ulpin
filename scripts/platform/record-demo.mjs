// Lean, read-only runtime receipt. Refuses to qualify imports/seeds or changed retained projects.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { readDemo, demoFile, demoProject, safeEnvironment } from './demo-config.mjs';
import { dockerRuntime, engine, inventory, storageProblems, root } from './runtime.mjs';
import { ownedProcess } from './processes.mjs';
import { gatewayReport } from './demo-gateway.mjs';

const file = join(root, 'scripts/platform/evidence/s03/result.json');
const receipt = JSON.parse(readFileSync(file, 'utf8'));
const env = readDemo(), runtime = dockerRuntime(), info = engine(runtime), snapshot = inventory(runtime, demoProject);
assert.deepEqual(storageProblems(snapshot, demoProject), []);
const configurationSha256 = createHash('sha256').update(readFileSync(demoFile)).digest('hex');
if (receipt.demo) {
  assert.equal(configurationSha256, receipt.demo.configurationSha256, 'Demo configuration changed across resume.');
  assert.deepEqual(snapshot.containers.map(c => c.id).sort(), receipt.demo.containers.map(c => c.id).sort(), 'Demo containers were replaced.');
}
const retained = runtime.docker('ps', '-a', '--format', '{{.ID}} {{.Label "com.docker.compose.project"}} {{.State}}')
  .split('\n').map(line => { const [id, project, state] = line.split(' '); return { id, project, state }; }).filter(c => c.project !== demoProject);
assert.deepEqual(retained.map(c => c.id).sort(), [...receipt.retainedContainerIds].sort());
assert.ok(retained.every(c => c.state === 'exited'));
const demoVolumes = ['postgres-data', 'minio-data', 'redis-data'].map(name => `${demoProject}_${name}`);
assert.deepEqual([...snapshot.volumes].sort(), [...receipt.requestedProjectInventory.volumes, ...demoVolumes].sort());

const client = new pg.Client({ connectionString: env.DATABASE_URL });
let tableCount, nonempty = {}, markers;
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  await client.query("SET LOCAL statement_timeout='3000ms'");
  const tables = (await client.query('SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename', ['public'])).rows;
  tableCount = tables.length;
  for (const { tablename: name } of tables) {
    const count = Number((await client.query(`SELECT count(*) AS n FROM public."${name.replaceAll('"', '""')}"`)).rows[0].n);
    if (count) nonempty[name] = count;
  }
  markers = (await client.query('SELECT name FROM usp_migration_ledger ORDER BY name')).rows.map(r => r.name);
  assert.deepEqual(Object.keys(nonempty).sort(), ['spatial_ref_sys', 'usp_migration_ledger']);
  await client.query('ROLLBACK');
} finally { await client.end(); }
const api = `http://127.0.0.1:${env.API_PORT}/api/v1`;
const response = await fetch(`${api}/health`, { signal: AbortSignal.timeout(10000) });
const health = await response.json();
assert.equal(response.status, 200); assert.equal(health.ok, true); assert.equal(health.databaseReadiness.schema.ready, true);
const areasResponse = await fetch(`${api}/areas`, { signal: AbortSignal.timeout(10000) });
const areas = await areasResponse.json(); assert.equal(areasResponse.status, 200); assert.deepEqual(areas, []);
const output = execFileSync(process.execPath, [join(root, 'scripts/platform/doctor'), '--profile', 'demo'],
  { cwd: root, env: safeEnvironment(env), encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
assert.match(output, /Doctor: all checks passed/);
writeFileSync(join(root, 'scripts/platform/evidence/s03/warm-doctor.txt'), output);
receipt.status = 'demo_runtime_passed_desktop_recurrence_unresolved';
receipt.demo = {
  observedAt: new Date().toISOString(), project: demoProject, configuration: demoFile,
  configurationSha256,
  configurationSecurity: '0600-style; Windows ACL inheritance removed on new demo directory; grants only operator, SYSTEM, Administrators',
  engine: info, gatewayEnabled: gatewayReport(env).enabled,
  ports: Object.fromEntries(['POSTGRES_PORT', 'S3_PORT', 'S3_CONSOLE_PORT', 'REDIS_PORT', 'GEO_PORT', 'API_PORT'].map(key => [key, Number(env[key])])),
  volumes: demoVolumes,
  containers: snapshot.containers.map(c => ({ id: c.id, service: c.service, state: c.state, health: c.health, restart: c.restart })),
  nativeProcesses: Object.fromEntries(['api', 'dispatcher'].map(label => [label, ownedProcess(label)])),
  retainedProjectsUnchanged: { containerIds: true, all24StillStopped: true, all14OriginalVolumeNamesPresent: true, only3ApprovedNewVolumes: true },
  schemaAudit: { publicTables: tableCount, domainTables: tableCount - Object.keys(nonempty).length, domainRows: 0, nonemptyTables: nonempty,
    migrationMarkers: markers, backfills: 'identity_floors/spaces and map_areas derive only from existing units/sites; inserted zero rows in this new database',
    otherMigrations: 'Existing lazy dataset and model-gateway schema producers invoked once; they create no examples and do not change the gateway state (see gatewayEnabled)' },
  api: { healthHttpStatus: response.status, healthOk: health.ok, schemaReady: health.databaseReadiness.schema.ready,
    manifestSha256: health.databaseReadiness.schema.manifestSha256, databaseTargetToken: health.databaseReadiness.schema.targetToken,
    unvalidatedConstraints: health.databaseReadiness.schema.unvalidatedConstraints, areasHttpStatus: areasResponse.status, areas },
  finalDoctor: { command: 'node scripts/platform/doctor --profile demo', exitCode: 0, checks: output.split('\n').filter(line => line.startsWith('PASS ')).length,
    output: 'scripts/platform/evidence/s03/warm-doctor.txt' },
  runs: receipt.demo?.runs,
  leftRunning: true,
};
writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
console.log(`PASS: ${receipt.demo.finalDoctor.checks} doctor checks; ${tableCount - Object.keys(nonempty).length} empty domain tables; retained projects unchanged; demo running.`);
