// The demo project, or a named rehearsal beside it. Existing linked/repository/worker projects are never
// operated on, and an action for one runtime name reads, starts and stops that runtime only.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDemo, readDemo, definedRuntime, demoRuntime, runtimeDefinition, safeEnvironment, redact,
} from './demo-config.mjs';
import { dockerRuntime, engine, inventory, startProblems, root } from './runtime.mjs';
import { launchProcesses, stopProcesses, waitForApi } from './processes.mjs';
import { gatewayReport } from './demo-gateway.mjs';
import { gatewayStateText } from './demo-gateway-state.mjs';

const usage = 'Usage: demo.mjs start [--create] [--runtime <name>] | stop [--runtime <name>]';

function execute(file, args, env, timeout = 180000) {
  try {
    return execFileSync(file, args, { cwd: root, env: safeEnvironment(env), windowsHide: true,
      timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    const detail = redact(String(error.stderr || error.stdout || '').slice(-6000), env);
    throw new Error(`Runtime command failed (${error.status ?? 'timeout'}): ${detail}`);
  }
}
const imageSteps = ['build', '--build', 'watch', 'commit', 'push', 'publish'];
/**
 * The docker arguments of one compose step: always this runtime's settings file, project and compose
 * definition, never another's. Given a rehearsal name, a step that could build or tag an image is refused
 * here, so no caller can rebuild or retag the demo's image under a rehearsal's name.
 */
export function composeArguments(context, args, name = demoRuntime) {
  const definition = definedRuntime(name);
  const creates = args.includes('up') || args.includes('create');
  if (!definition.buildsProcessorImage
    && (args.some(arg => imageSteps.includes(arg)) || (creates && !args.includes('--no-build')))) {
    throw new Error(`${definition.name} never builds or tags a processor image: it reuses the reviewed `
      + `${definition.processorImage}.`);
  }
  return ['--context', context, 'compose', '--project-directory', root,
    '--env-file', definition.file, '-p', definition.project, '-f', join(root, 'compose.yaml'),
    '-f', join(root, definition.composeFile), ...args];
}
export function demoCompose(runtime, env, args, timeout, name = demoRuntime) {
  return execute('docker', composeArguments(runtime.context, args, name), env, timeout);
}
function migrate(env, definition) {
  const preload = join(root, 'scripts/platform/isolated-env.cjs');
  const migrationEnv = { ...env, NODE_OPTIONS: `--require "${preload.replaceAll('\\', '/')}"` };
  console.log(`Applying existing additive migrations to ${definition.name} only (no seeds).`);
  execute(process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm db:migrate'] : ['db:migrate'], migrationEnv);
  const schema = join(root, 'scripts/platform/demo-schema.ts');
  execute(process.execPath, ['--require', preload, '--import', 'tsx', schema], env);
}

/** The engine steps of stop, behind one seam so that a test can stand in for Docker. */
const localEngine = {
  connect() {
    const runtime = dockerRuntime(); engine(runtime);
    return runtime;
  },
  containers: (runtime, project) => inventory(runtime, project).containers,
  stop: (runtime, ids) => execute('docker', ['--context', runtime.context, 'stop', '--timeout', '20', ...ids], {}),
};

/** Stops the named runtime's recorded processes and the containers labelled with its project; no other's. */
export async function stopRuntime(name = demoRuntime, docker = localEngine) {
  const definition = definedRuntime(name);
  // Stop owned native processes even if Desktop is down or configuration is missing.
  await stopProcesses(definition);
  try {
    const runtime = docker.connect();
    const ids = docker.containers(runtime, definition.project)
      .filter(c => c.project === definition.project && c.service !== 'minio-init').map(c => c.id);
    if (ids.length) docker.stop(runtime, ids);
  } catch {
    throw new Error('Demo native processes stopped, but Docker containers could not be verified/stopped; '
      + 'restore the engine and rerun demo stop.');
  }
  console.log(`${definition.name} API/dispatcher and containers stopped; all data volumes preserved.`);
}

/**
 * The create steps in order. The demo's are the ones it was created with. A rehearsal never builds: where the
 * demo builds its image, a rehearsal only checks (read-only) that the demo's reviewed image is on the engine.
 */
export function bootstrapSteps(name = demoRuntime) {
  const definition = definedRuntime(name);
  const noBuild = definition.buildsProcessorImage ? [] : ['--no-build'];
  const stores = ['postgres', 'minio', 'redis'];
  return [
    { compose: ['up', '-d', ...noBuild, '--no-recreate', '--wait', '--wait-timeout', '90', ...stores] },
    { compose: ['run', '--rm', 'minio-init'] },
    { migrate: true },
    definition.buildsProcessorImage ? { compose: ['build', 'geo'], timeout: 900000 }
      : { reviewedImage: definition.processorImage },
    { compose: ['--profile', 'app', 'up', '-d', '--no-build', '--no-recreate', '--wait', '--wait-timeout', '120'] },
  ];
}

function bootstrap(definition, runtime, env, compose) {
  console.log(`Creating/resuming the explicitly approved new ${definition.name} project.`);
  for (const step of bootstrapSteps(definition)) {
    if (step.compose) compose(step.compose, step.timeout);
    else if (step.migrate) migrate(env, definition);
    else {
      try { runtime.docker('image', 'inspect', step.reviewedImage, '--format', '{{.Id}}'); }
      catch { throw new Error(`The reviewed image ${step.reviewedImage} is not on this engine; none is built.`); }
    }
  }
  const marker = { project: definition.project, schemaOnly: true, completedAt: new Date().toISOString() };
  writeFileSync(definition.marker, JSON.stringify(marker) + '\n', { flag: 'wx', mode: 0o600 });
}

/** A rehearsal is served from its own checkout only, so its process records never point into another's. */
export function assertServingCheckout(name = demoRuntime, checkout = root) {
  const definition = definedRuntime(name);
  if (definition.rehearsal && resolve(checkout).toLowerCase() !== resolve(definition.servingCheckout).toLowerCase()) {
    throw new Error(`${definition.name} is served from ${definition.servingCheckout} only; start it from there.`);
  }
}

function resume(definition, runtime, compose) {
  const { project } = definition;
  if (JSON.parse(readFileSync(definition.marker, 'utf8')).project !== project) {
    throw new Error('Unexpected demo bootstrap ownership marker.');
  }
  const problems = startProblems(inventory(runtime, project), false, project);
  if (problems.length) throw new Error(`Demo resume refused: ${problems.join(' ')} No replacements will be created.`);
  const services = ['postgres', 'minio', 'redis', 'geo', 'worker'];
  compose(['--profile', 'app', 'start', '--wait', '--wait-timeout', '120', ...services]);
}

async function startRuntime(definition, create) {
  assertServingCheckout(definition);
  const runtime = dockerRuntime(); engine(runtime);
  const env = create ? await createDemo(definition) : readDemo(definition);
  const compose = (args, timeout) => demoCompose(runtime, env, args, timeout, definition);
  if (!existsSync(definition.marker)) {
    if (!create) {
      throw new Error('Demo bootstrap is incomplete; explicit --create is required to resume schema-only setup.');
    }
    bootstrap(definition, runtime, env, compose);
    if (definition.rehearsal) {
      // Its document runtime can only be built while its API and dispatcher are stopped: create ends here.
      console.log(`${definition.name} created: storage, schema and processors are up; API and dispatcher not `
        + 'started. Build its document runtime, then start it.');
      return;
    }
  } else resume(definition, runtime, compose);
  await launchProcesses(env, definition);
  await waitForApi(env, definition);
  const gateway = gatewayStateText(gatewayReport(env));
  console.log(`${definition.name} running: http://127.0.0.1:${env.API_PORT}/api/v1/health (${gateway}).`);
  const named = definition.rehearsal ? ['--runtime', definition.name] : [];
  const doctor = [join(root, 'scripts/platform/doctor'), '--profile', 'demo', ...named];
  console.log(execute(process.execPath, doctor, env));
}

export async function demoAction(action, create = false, name = demoRuntime) {
  const definition = definedRuntime(name);
  if (action === 'stop') return stopRuntime(definition);
  if (action !== 'start') throw new Error(usage);
  return startRuntime(definition, create);
}

/** The action, --create and the runtime, checked before a file is read or a command is run. */
export function parseArguments([action, ...flags]) {
  if (action !== 'start' && action !== 'stop') throw new Error(usage);
  let name = demoRuntime, named = false, create = false;
  for (let index = 0; index < flags.length; index++) {
    if (flags[index] === '--create' && action === 'start') create = true;
    else if (flags[index] === '--runtime' && !named && index + 1 < flags.length) {
      name = flags[++index];
      named = true;
    } else throw new Error(usage);
  }
  return { action, create, runtime: runtimeDefinition(name) };
}

const entry = process.argv[1] && resolve(process.argv[1]).toLowerCase();
// The platform shell invokes this entry directly; imports (e.g. doctor) must not run actions.
if (entry === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const { action, create, runtime } = parseArguments(process.argv.slice(2));
    await demoAction(action, create, runtime);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
