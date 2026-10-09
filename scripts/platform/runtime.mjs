// Read-only Docker inventory shared by the doctor and the fail-closed start guard.
// Never inspect container Env, load configuration/credentials, or create storage.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const project = 'ulpin';
export const storage = [
  ['postgres', 'postgres-data', '/var/lib/postgresql/data'],
  ['minio', 'minio-data', '/data'],
  ['redis', 'redis-data', '/data'],
];
export const services = [...storage.map(([service]) => service), 'geo', 'worker'];

export function command(executable, args, timeout = 15000) {
  return execFileSync(executable, args, {
    encoding: 'utf8', timeout, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }).trim();
}

export function dockerRuntime() {
  if (process.env.DOCKER_HOST) throw new Error('DOCKER_HOST override is not allowed by the local runtime guard.');
  const context = process.env.ULPIN_DOCKER_CONTEXT || process.env.DOCKER_CONTEXT || command('docker', ['context', 'show']);
  const docker = (...args) => command('docker', ['--context', context, ...args]);
  const endpoint = JSON.parse(docker('context', 'inspect', context, '--format', '{{json .Endpoints.docker.Host}}'));
  if (!/^(npipe:\/\/|unix:\/\/)/.test(endpoint)) throw new Error('The selected Docker context is not local.');
  return { context, docker };
}

export function engine(runtime) {
  const info = JSON.parse(runtime.docker('info', '--format',
    '{"OSType":{{json .OSType}},"ServerVersion":{{json .ServerVersion}},"Containers":{{json .Containers}}}'));
  if (info.OSType !== 'linux') throw new Error('The selected engine is not Linux.');
  // Return only non-secret engine metadata.
  return { version: info.ServerVersion, containers: info.Containers };
}

export function inventory(runtime, selectedProject = project) {
  const { docker } = runtime;
  const volumes = docker('volume', 'ls', '--format', '{{.Name}}').split('\n').filter(Boolean);
  const ids = docker('ps', '-a', '--filter', `label=com.docker.compose.project=${selectedProject}`, '--format', '{{.ID}}').split('\n').filter(Boolean);
  const containers = ids.map(id => JSON.parse(docker('inspect', id, '--format',
    '{"id":{{json .Id}},"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"state":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},"health":{{if (index .State "Health")}}{{json (index (index .State "Health") "Status")}}{{else}}null{{end}},"mounts":{{json .Mounts}},"ports":{{json .NetworkSettings.Ports}},"restart":{{json .HostConfig.RestartPolicy.Name}}}')));
  const volumeOwners = Object.fromEntries(storage.map(([, volume]) => {
    const name = `${selectedProject}_${volume}`;
    if (!volumes.includes(name)) return [name, null];
    return [name, JSON.parse(docker('volume', 'inspect', name, '--format',
      '{"project":{{json (index .Labels "com.docker.compose.project")}},"volume":{{json (index .Labels "com.docker.compose.volume")}}}'))];
  }));
  return { volumes, volumeOwners, containers };
}

export function storageProblems(snapshot, selectedProject = project) {
  const problems = [];
  for (const [service, volume, destination] of storage) {
    const name = `${selectedProject}_${volume}`;
    const owner = snapshot.volumeOwners[name];
    if (!snapshot.volumes.includes(name)) problems.push(`Missing existing volume ${name}.`);
    else if (owner?.project !== selectedProject || owner?.volume !== volume) problems.push(`Volume ${name} has unexpected ownership labels.`);
    const matches = snapshot.containers.filter(c => c.project === selectedProject && c.service === service);
    if (matches.length !== 1) {
      problems.push(`Expected one existing ${selectedProject}/${service} container.`);
      continue;
    }
    const container = matches[0];
    if (container.state === 'created' || container.startedAt?.startsWith('0001-')) problems.push(`${service} has never started; initialization is not authorized.`);
    const mount = container.mounts.find(m => m.Destination === destination);
    if (mount?.Type !== 'volume' || mount.Name !== name || mount.RW !== true) problems.push(`${service} does not attach to the expected existing volume ${name}.`);
  }
  return problems;
}

export function startProblems(snapshot, infraOnly = false, selectedProject = project) {
  const problems = storageProblems(snapshot, selectedProject);
  for (const service of infraOnly ? [] : ['geo', 'worker']) {
    if (snapshot.containers.filter(c => c.project === selectedProject && c.service === service).length !== 1)
      problems.push(`Expected one existing ${selectedProject}/${service} container; automatic creation is disabled.`);
  }
  return problems;
}

export function migrationReady(health, manifestSha256, dataMode = 'linked') {
  return health?.dataMode === dataMode && health?.databaseReadiness?.status === 'structurally_ready'
    && health.databaseReadiness.schema?.ready === true
    && health.databaseReadiness.schema.manifestSha256 === manifestSha256;
}

function guard() {
  const infraOnly = process.argv.includes('--infra-only');
  const runtime = dockerRuntime();
  const info = engine(runtime);
  const projectIndex = process.argv.indexOf('--project');
  const selectedProject = projectIndex >= 0 ? process.argv[projectIndex + 1] : project;
  if (!['ulpin', 'ulpin-repo'].includes(selectedProject)) throw new Error('Unsupported legacy project.');
  const snapshot = inventory(runtime, selectedProject);
  console.log(`Docker context ${runtime.context}; Linux engine ${info.version}.`);
  console.log(`Existing volumes (${snapshot.volumes.length}): ${snapshot.volumes.join(', ') || 'none'}`);
  console.log(`Existing ${selectedProject} containers: ${snapshot.containers.map(c => `${c.name.replace(/^\//, '')} (${c.service}, ${c.state})`).join(', ') || 'none'}`);
  if (process.argv.includes('--stop')) {
    const ids = [...snapshot.containers].sort((a, b) => services.indexOf(b.service) - services.indexOf(a.service)).map(c => c.id);
    if (ids.length) command('docker', ['--context', runtime.context, 'stop', '--timeout', '20', ...ids], 120000);
    console.log('Existing ulpin containers stopped; volumes preserved. Native API/dispatcher are managed separately.');
    return;
  }
  const problems = startProblems(snapshot, infraOnly, selectedProject);
  if (problems.length) {
    problems.forEach(problem => console.error(`STOP: ${problem}`));
    console.error('Fix: ask the owner to reconcile the intended existing project/volumes; do not create replacements.');
    process.exitCode = 1;
  } else console.log('PASS: existing ulpin storage bindings confirmed; start may only resume existing containers.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { guard(); }
  catch {
    console.error('STOP: local Linux Docker engine/context could not be verified.');
    console.error('Fix: start Docker Desktop and select its existing local Linux context; inspect Desktop logs if it fails.');
    process.exitCode = 1;
  }
}
