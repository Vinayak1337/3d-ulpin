// Explicit new demo project. Existing linked/repository/worker projects are never operated on.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemo, readDemo, demoDir, demoProject, demoFile, safeEnvironment, redact } from './demo-config.mjs';
import { dockerRuntime, engine, inventory, startProblems, root } from './runtime.mjs';
import { launchProcesses, stopProcesses, waitForApi } from './processes.mjs';
import { gatewayReport } from './demo-gateway.mjs';
import { gatewayStateText } from './demo-gateway-state.mjs';

function execute(file, args, env, timeout = 180000) {
  try {
    return execFileSync(file, args, { cwd: root, env: safeEnvironment(env), windowsHide: true,
      timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = redact(String(error.stderr || error.stdout || '').slice(-6000), env);
    throw new Error(`Runtime command failed (${error.status ?? 'timeout'}): ${detail}`);
  }
}
export function demoCompose(runtime, env, args, timeout) {
  return execute('docker', ['--context', runtime.context, 'compose', '--project-directory', root,
    '--env-file', demoFile, '-p', demoProject, '-f', join(root, 'compose.yaml'),
    '-f', join(root, 'scripts/platform/demo.compose.json'), ...args], env, timeout);
}
function migrate(env) {
  const preload = join(root, 'scripts/platform/isolated-env.cjs');
  const migrationEnv = { ...env, NODE_OPTIONS: `--require "${preload.replaceAll('\\', '/')}"` };
  console.log('Applying existing additive migrations to ulpin-demo only (no seeds).');
  execute(process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm db:migrate'] : ['db:migrate'], migrationEnv);
  execute(process.execPath, ['--require', preload, '--import', 'tsx', join(root, 'scripts/platform/demo-schema.ts')], env);
}
export async function demoAction(action, create = false) {
  if (action === 'stop') {
    // Stop owned native processes even if Desktop is down or configuration is missing.
    await stopProcesses();
    try {
      const runtime = dockerRuntime(); engine(runtime);
      const snapshot = inventory(runtime, demoProject);
      const ids = snapshot.containers.filter(c => c.service !== 'minio-init').map(c => c.id);
      if (ids.length) execute('docker', ['--context', runtime.context, 'stop', '--timeout', '20', ...ids], {});
    } catch {
      throw new Error('Demo native processes stopped, but Docker containers could not be verified/stopped; restore the engine and rerun demo stop.');
    }
    console.log('ulpin-demo API/dispatcher and containers stopped; all data volumes preserved.');
    return;
  }
  if (action !== 'start') throw new Error('Usage: demo.mjs start [--create] | stop');
  const runtime = dockerRuntime(); engine(runtime);
  const env = create ? await createDemo() : readDemo();
  const complete = join(demoDir, 'bootstrap.complete.json');
  if (!existsSync(complete)) {
    if (!create) throw new Error('Demo bootstrap is incomplete; explicit --create is required to resume schema-only setup.');
    console.log('Creating/resuming the explicitly approved new ulpin-demo project.');
    demoCompose(runtime, env, ['up', '-d', '--no-recreate', '--wait', '--wait-timeout', '90', 'postgres', 'minio', 'redis']);
    demoCompose(runtime, env, ['run', '--rm', 'minio-init']);
    migrate(env);
    demoCompose(runtime, env, ['build', 'geo'], 900000);
    demoCompose(runtime, env, ['--profile', 'app', 'up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '120']);
    writeFileSync(complete, JSON.stringify({ project: demoProject, schemaOnly: true, completedAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
  } else {
    if (JSON.parse(readFileSync(complete, 'utf8')).project !== demoProject) throw new Error('Unexpected demo bootstrap ownership marker.');
    const snapshot = inventory(runtime, demoProject);
    const problems = startProblems(snapshot, false, demoProject);
    if (problems.length) throw new Error(`Demo resume refused: ${problems.join(' ')} No replacements will be created.`);
    demoCompose(runtime, env, ['--profile', 'app', 'start', '--wait', '--wait-timeout', '120', 'postgres', 'minio', 'redis', 'geo', 'worker']);
  }
  await launchProcesses(env);
  await waitForApi(env);
  const gateway = gatewayStateText(gatewayReport(env));
  console.log(`ulpin-demo running: http://127.0.0.1:${env.API_PORT}/api/v1/health (${gateway}).`);
  const output = execute(process.execPath, [join(root, 'scripts/platform/doctor'), '--profile', 'demo'], env);
  console.log(output);
}
const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
// The platform shell invokes this entry directly; imports (e.g. doctor) must not run actions.
if (invoked) {
  try {
    const [action, ...flags] = process.argv.slice(2);
    if (flags.some(flag => flag !== '--create') || (action !== 'start' && flags.length)) throw new Error('Usage: demo.mjs start [--create] | stop');
    await demoAction(action, flags.includes('--create'));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
