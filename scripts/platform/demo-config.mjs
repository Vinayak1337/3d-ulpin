import {
  existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, realpathSync, statSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command, dockerRuntime, root } from './runtime.mjs';

export const demoRuntime = 'ulpin-demo';
const runtimesFolder = 'E:/BhuAayam-data/runtime';
const rehearsalName = /^ulpin-reh-([0-9]{2})$/;
const demoPorts = {
  POSTGRES_PORT: '15434', S3_PORT: '19020', S3_CONSOLE_PORT: '19021', REDIS_PORT: '16381', GEO_PORT: '18002',
  API_PORT: '3194',
};
const definitions = new WeakSet();

/** Rehearsal NN listens on 21000 + 10 x NN + 1 to + 6, in the order of the demo's port keys: never a demo port. */
function rehearsalPorts(number) {
  const first = 21000 + 10 * number + 1;
  return Object.fromEntries(Object.keys(demoPorts).map((key, index) => [key, String(first + index)]));
}

/**
 * Everything that tells one runtime from another, from its name alone. ulpin-demo keeps the values it was
 * created with. ulpin-reh-NN gets its own folder, project, bucket, database, ports and operator subject, so
 * that no record made in a rehearsal can be mistaken for the demo's. Any other name is refused here, before
 * a file is read. The second argument is for tests on a synthetic folder; no command passes it.
 */
export function runtimeDefinition(name = demoRuntime, folder = runtimesFolder) {
  const rehearsal = typeof name === 'string' ? rehearsalName.exec(name) : null;
  if (name !== demoRuntime && !rehearsal) {
    throw new Error('Unknown runtime name: use ulpin-demo or ulpin-reh-NN with two digits.');
  }
  const dir = `${folder}/${name}`;
  const database = name.replaceAll('-', '_');
  const definition = Object.freeze({
    name, rehearsal: Boolean(rehearsal), dir, project: name, bucket: name, database, databaseUser: database,
    objectAccessKey: name.replaceAll('-', ''),
    operatorSubject: rehearsal ? `rehearsal-runtime-${name}` : 'selection-demo-runtime',
    ports: Object.freeze(rehearsal ? rehearsalPorts(Number(rehearsal[1])) : { ...demoPorts }),
    file: join(dir, rehearsal ? 'runtime.env' : 'demo.env'), marker: join(dir, 'bootstrap.complete.json'),
    ocrFile: join(dir, 'ocr-paths.json'), ocrProfileFile: join(dir, 'ocr-paths-profile.json'),
    tabularFile: join(dir, 'tabular-paths.json'), documentFile: join(dir, 'document-runtime-paths.json'),
    modelDir: join(dir, 'models').replaceAll('\\', '/'),
    // The checkout a runtime is served from, and the processors it runs. The demo builds the image its own
    // compose file names; a rehearsal reuses the demo's reviewed image and has no build step at all.
    servingCheckout: `E:/Projects/ulpin-wt/${rehearsal ? name : 'demo'}`,
    composeFile: `scripts/platform/${rehearsal ? 'rehearsal.compose.yaml' : 'demo.compose.json'}`,
    processorImage: rehearsal ? 'ulpin-geo:demo-k3b' : 'ulpin-geo:demo-s03', buildsProcessorImage: !rehearsal,
  });
  definitions.add(definition);
  return definition;
}

/** A name is resolved; an object passes only if runtimeDefinition() made it. */
export function definedRuntime(runtime = demoRuntime) {
  if (typeof runtime === 'string') return runtimeDefinition(runtime);
  if (!definitions.has(runtime)) throw new Error('Unknown runtime: only a validated runtime name is accepted.');
  return runtime;
}

const demo = runtimeDefinition();
export const demoDir = demo.dir;
export const demoProject = demo.project;
export const demoFile = demo.file;
export const demoOcrFile = demo.ocrFile;
export const demoTabularFile = demo.tabularFile;
export const demoDocumentFile = demo.documentFile;
const documentRuntimeGroups = [
  ['ULPIN_DOCUMENT_PAGES_PYTHON', 'ULPIN_DOCUMENT_PAGES_SCRATCH'],
  ['ULPIN_PACKET_REGIONS_PYTHON', 'ULPIN_PACKET_REGIONS_PROFILE',
    'ULPIN_PACKET_REGIONS_PROFILE_SHA256', 'ULPIN_PACKET_REGIONS_SCRATCH'],
];
export const demoOcrProfileFile = demo.ocrProfileFile;
const ocrNames = ['PYTHON', 'MODELS', 'TESSERACT', 'TESSDATA', 'SCRATCH'];

/** Optional non-secret paths only. Never derive or replace credentials. */
export function readDemoOcrPaths(file = demoOcrFile, overrideFile) {
  if (!existsSync(file)) return {};
  let paths = JSON.parse(readFileSync(file, 'utf8'));
  // Any other file is itself read as a demo-scoped override, unless the caller names that runtime's own
  // override file; the scratch must lie in the read file's own folder.
  const profileFile = overrideFile ?? (file === demoOcrFile ? demoOcrProfileFile : file);
  if (existsSync(profileFile)) {
    const override = JSON.parse(readFileSync(profileFile, 'utf8'));
    if (override.profile !== 'demo' || Object.keys(override).sort().join(',') !== 'paths,profile') {
      throw new Error('OCR profile override must be explicitly demo-scoped.');
    }
    paths = override.paths;
  }
  const expected = ocrNames.map(name => `ULPIN_DOCUMENT_OCR_${name}`);
  if (Object.keys(paths).length !== expected.length || Object.keys(paths).some(key => !expected.includes(key))) {
    throw new Error('OCR path configuration has unexpected keys.');
  }
  for (const key of expected) {
    const path = paths[key];
    if (typeof path !== 'string' || !/^[A-Za-z]:[\\/]/.test(path) || !existsSync(path)) {
      throw new Error(`OCR path unavailable: ${key}.`);
    }
    const isFile = key.endsWith('_PYTHON') || key.endsWith('_TESSERACT');
    const entry = statSync(path);
    if (isFile ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error(`OCR path has the wrong kind: ${key}.`);
    }
  }
  const scratch = realpathSync(paths.ULPIN_DOCUMENT_OCR_SCRATCH);
  const runtime = realpathSync(dirname(file));
  const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const runtimeRelative = relative(runtime, scratch);
  const repoRelative = relative(repository, scratch);
  if (!runtimeRelative || runtimeRelative.startsWith('..') || isAbsolute(runtimeRelative)
    || (!repoRelative.startsWith('..') && !isAbsolute(repoRelative))) {
    throw new Error('OCR scratch must be a new directory inside demo runtime and outside the repository.');
  }
  for (const path of [join(paths.ULPIN_DOCUMENT_OCR_TESSDATA, 'eng.traineddata'),
    join(paths.ULPIN_DOCUMENT_OCR_MODELS, 'docling-project--docling-layout-heron', 'model.safetensors')]) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error('Pinned OCR assets are unavailable.');
  }
  return paths;
}
/** Required non-secret paths; a missing bridge or seed must be visible before runtime starts. */
export function readDemoTabularPaths(file = demoTabularFile, runtimeDir = demoDir) {
  if (!existsSync(file)) throw new Error('Demo tabular paths missing; configure tabular-paths.json first.');
  let paths;
  try { paths = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Demo tabular path file must be valid JSON.'); }
  const keys = ['ULPIN_PROFILE_PYTHON', 'ULPIN_TABULAR_LEARNING_DIR', 'ULPIN_TABULAR_LEARNER_SEED'];
  if (!paths || typeof paths !== 'object' || Object.keys(paths).sort().join(',') !== keys.sort().join(',')) {
    throw new Error('Demo tabular path configuration has unexpected keys.');
  }
  for (const key of keys) {
    const path = paths[key];
    if (typeof path !== 'string' || !/^[A-Za-z]:[\\/]/.test(path) || !existsSync(path)) {
      throw new Error(`Demo tabular path unavailable: ${key}.`);
    }
    const entry = statSync(path);
    if (key === 'ULPIN_PROFILE_PYTHON' ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error(`Demo tabular path has the wrong kind: ${key}.`);
    }
  }
  validateTabularArtifacts(paths, runtimeDir);
  return paths;
}

function validateTabularArtifacts(paths, runtimeDir) {
  const learning = realpathSync(paths.ULPIN_TABULAR_LEARNING_DIR);
  const insideRuntime = relative(realpathSync(runtimeDir), learning);
  const repository = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  for (const path of [learning, realpathSync(paths.ULPIN_TABULAR_LEARNER_SEED)]) {
    const insideRepository = relative(repository, path);
    if (!insideRepository.startsWith('..') && !isAbsolute(insideRepository)) {
      throw new Error('Demo tabular artifacts must be outside the repository.');
    }
  }
  if (!insideRuntime || insideRuntime.startsWith('..') || isAbsolute(insideRuntime)) {
    throw new Error('Demo tabular learning directory must be inside demo runtime.');
  }
  const seed = paths.ULPIN_TABULAR_LEARNER_SEED;
  const manifestFile = join(seed, 'manifest.json'), modelFile = join(seed, 'model.npz');
  if (!existsSync(manifestFile) || !existsSync(modelFile)) throw new Error('Demo tabular learner seed is incomplete.');
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestFile, 'utf8')); }
  catch { throw new Error('Demo tabular learner seed manifest is invalid.'); }
  const digest = createHash('sha256').update(readFileSync(modelFile)).digest('hex');
  if (manifest.version !== 'v43' || manifest.modelSha256 !== digest) {
    throw new Error('Demo tabular learner seed must be the intact A4 v43 model.');
  }
}

/** Registered worktrees plus ancestor .git checks cover other checkouts and resolved directory junctions. */
function documentCheckouts() {
  try {
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [root, ...output.split(/\r?\n/).filter(line => line.startsWith('worktree ')).map(line => line.slice(9))];
  } catch {
    throw new Error('Document runtime scratch keys require checkout inventory.');
  }
}

function insideDirectory(parent, path) {
  const location = relative(parent, path);
  return location !== '..' && !location.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(location);
}

function assertDocumentScratch(path, key, checkouts) {
  const actual = realpathSync(path);
  if (checkouts.some(checkout => insideDirectory(realpathSync(checkout), actual))) {
    throw new Error(`Document runtime scratch must be outside every checkout: ${key}.`);
  }
  for (let parent = actual; ; parent = dirname(parent)) {
    if (existsSync(join(parent, '.git'))) {
      throw new Error(`Document runtime scratch must be outside every checkout: ${key}.`);
    }
    if (dirname(parent) === parent) break;
  }
}

function validateDocumentRuntimePath(paths, key, checkouts) {
  const value = paths[key];
  if (key.endsWith('_SHA256')) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
      throw new Error(`Document runtime hash is invalid: ${key}.`);
    }
    return;
  }
  if (typeof value !== 'string' || !isAbsolute(value) || !existsSync(value)) {
    throw new Error(`Document runtime path unavailable: ${key}.`);
  }
  const entry = statSync(value);
  const directory = key.endsWith('_SCRATCH');
  if (directory ? !entry.isDirectory() : !entry.isFile()) {
    throw new Error(`Document runtime path has the wrong kind: ${key}.`);
  }
  if (directory) assertDocumentScratch(value, key, checkouts);
}

/** Optional non-secret paths. Each runtime is either wholly configured or absent; never read demo.env here. */
export function readDemoDocumentRuntime(file = demoDocumentFile) {
  if (!existsSync(file)) return {};
  let paths;
  try { paths = JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error('Document runtime path keys require readable valid JSON.'); }
  const keys = documentRuntimeGroups.flat();
  if (!paths || Array.isArray(paths) || typeof paths !== 'object'
    || Object.keys(paths).some(key => !keys.includes(key))) {
    throw new Error('Document runtime path configuration has unexpected keys.');
  }
  for (const group of documentRuntimeGroups) {
    if (group.some(key => Object.hasOwn(paths, key)) && group.some(key => !Object.hasOwn(paths, key))) {
      throw new Error(`Document runtime requires keys: ${group.join(', ')}.`);
    }
  }
  try {
    const checkouts = documentCheckouts();
    for (const key of Object.keys(paths)) validateDocumentRuntimePath(paths, key, checkouts);
  } catch (error) {
    // Filesystem exceptions contain configured values. Only our closed validation messages may escape.
    if (error.message.startsWith('Document runtime')) throw error;
    throw new Error('Document runtime path keys could not be validated.');
  }
  return paths;
}

export const gatewayFlag = 'ULPIN_MODEL_GATEWAY_ENABLED';
export const gatewayConfigKey = 'ULPIN_MODEL_GATEWAY_CONFIG';
export const teacherAdapterKey = 'ULPIN_MAPPING_TEACHER_ADAPTER';
export const providerKeyName = 'ULPIN_PROVIDER_KEY_SARVAM';
const policyHashScript = 'import(process.argv[1]).then(gateway => console.log(gateway.modelGatewayPolicyHash()))';

/**
 * Runs the one ModelGatewayConfigSchema, in TypeScript, on the policy and returns modelGatewayPolicyHash().
 * The child receives the policy only, never the provider key, and its output is never shown.
 */
export function gatewayPolicyHash(policyJson) {
  const preload = join(root, 'scripts/platform/isolated-env.cjs');
  const gatewayRuntime = pathToFileURL(join(root, 'packages/server/src/modules/model-gateway/runtime.ts')).href;
  const env = safeEnvironment({ ULPIN_PROFILE: 'demo', [gatewayFlag]: '1', [gatewayConfigKey]: policyJson });
  let output = '';
  try {
    output = execFileSync(
      process.execPath,
      ['--require', preload, '--import', 'tsx', '-e', policyHashScript, gatewayRuntime],
      { cwd: root, env, encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    // A schema refusal, a missing toolchain and a timeout all fail closed below.
  }
  if (!/^[a-f0-9]{64}$/.test(output)) {
    throw new Error(`Demo setting ${gatewayConfigKey} was refused by the model gateway schema.`);
  }
  return output;
}

function assertGatewayDisabled(env) {
  if (env[gatewayConfigKey] !== undefined) {
    throw new Error(`Demo setting ${gatewayConfigKey} is not allowed while ${gatewayFlag} is 0.`);
  }
  if (env[teacherAdapterKey] === 'sarvam') {
    throw new Error(`Demo setting ${teacherAdapterKey} cannot select the live teacher while ${gatewayFlag} is 0.`);
  }
}

/** The key names a policy asks for, in the owner's order: its list, or its one name. A name, never a value. */
export function providerKeyNames(policy) {
  if (policy?.secretReferences === undefined) {
    if (policy?.secretReference !== providerKeyName) {
      throw new Error(`${gatewayConfigKey}.secretReference must be exactly ${providerKeyName}.`);
    }
    return [providerKeyName];
  }
  const names = policy.secretReferences;
  // A refused entry is never repeated: a key pasted where a name belongs must not reach a message.
  if (!Array.isArray(names) || names.some(name => !/^ULPIN_PROVIDER_KEY_SARVAM_[0-9]{2}$/.test(name))) {
    throw new Error(`${gatewayConfigKey}.secretReferences must list names of the form ${providerKeyName}_01.`);
  }
  return names;
}

/** Only the fields this profile gates on; every other rule is the schema's, through gatewayPolicyHash(). */
function assertGatewayEnabled(env) {
  let policy;
  try { policy = JSON.parse(env[gatewayConfigKey] ?? ''); }
  catch { throw new Error(`Demo setting ${gatewayConfigKey} must be valid JSON while ${gatewayFlag} is 1.`); }
  const missing = providerKeyNames(policy).find(name => !env[name]);
  if (missing) throw new Error(`Demo setting ${missing} is required while ${gatewayFlag} is 1.`);
  if (typeof policy.projectDailyCapMicroInr !== 'string' || !policy.projectDailyCapMicroInr) {
    throw new Error(`${gatewayConfigKey}.projectDailyCapMicroInr is required while ${gatewayFlag} is 1.`);
  }
  gatewayPolicyHash(env[gatewayConfigKey]);
}

/** Exactly two gateway states pass. Messages name keys, never values. */
function assertDemoGateway(env) {
  if (env[gatewayFlag] === '0') assertGatewayDisabled(env);
  else if (env[gatewayFlag] === '1') assertGatewayEnabled(env);
  else throw new Error(`Demo setting ${gatewayFlag} must be 0 or 1.`);
}

/** The whole configuration of one runtime: its settings file and its three path files, and no other's. */
export function readDemo(name = demoRuntime) {
  const runtime = definedRuntime(name);
  let tabular;
  try { tabular = readDemoTabularPaths(runtime.tabularFile, runtime.dir); }
  catch (error) {
    console.error(error.message); // Only path-validation messages, never demo.env values.
    throw error;
  }
  return {
    ...readDemoSettings(runtime.file, runtime), ...readDemoOcrPaths(runtime.ocrFile, runtime.ocrProfileFile),
    ...tabular, ...readDemoDocumentRuntime(runtime.documentFile),
  };
}
/**
 * The settings-file part of readDemo(). Only tests and the gateway script's unrenamed copy pass another file.
 * The file must hold exactly the named runtime's project, bucket, database and ports: one runtime's settings
 * are refused under another's name.
 */
export function readDemoSettings(file = demoFile, name = demoRuntime) {
  const runtime = definedRuntime(name);
  if (!existsSync(file)) throw new Error('Demo configuration missing; use --profile demo --create after inventory reconciliation.');
  // Only this explicitly authorized external file is read, never checkout .env.
  const env = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const at = line.indexOf('=');
    if (at <= 0) throw new Error('Invalid demo configuration.');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  for (const [key, value] of Object.entries({ ...runtime.ports, ULPIN_PROFILE: 'demo',
    COMPOSE_PROJECT_NAME: runtime.project, POSTGRES_DB: runtime.database, POSTGRES_USER: runtime.databaseUser,
    S3_BUCKET: runtime.bucket, REPO_DATA: 'false' })) {
    if (env[key] !== value) throw new Error(`Unexpected demo setting ${key}; refusing profile mixing.`);
  }
  assertDemoGateway(env);
  for (const key of ['POSTGRES_PASSWORD', 'S3_SECRET_KEY', 'GEO_SERVICE_TOKEN']) if (!/^[a-f0-9]{64}$/.test(env[key] || '')) throw new Error(`Missing demo secret ${key}; never regenerate credentials for populated volumes.`);
  if (env.DATABASE_URL !== `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`
    || env.S3_ENDPOINT !== `http://127.0.0.1:${env.S3_PORT}` || env.GEO_URL !== `http://127.0.0.1:${env.GEO_PORT}`
    || env.REDIS_URL !== `redis://127.0.0.1:${env.REDIS_PORT}/0`) throw new Error('Demo endpoint binding mismatch.');
  return env;
}
export async function freePort(port) {
  await new Promise((ok, fail) => {
    const server = createServer(); server.once('error', () => fail(new Error(`Loopback port ${port} is occupied.`)));
    server.listen(Number(port), '127.0.0.1', () => server.close(ok));
  });
}
export function assertDemoConfigMayBeGenerated(hasConfig, volumes, hasContainers, project = demoProject) {
  if (!hasConfig && (volumes.some(v => v.startsWith(`${project}_`)) || hasContainers))
    throw new Error('Demo storage/containers already exist but demo.env is missing. STOP: recover its original configuration; never generate replacement passwords.');
}
/**
 * The settings a new runtime is created with, in the order they are written. `secret` is called three times:
 * database password, object-store secret, processor token. The gateway always starts disabled.
 */
export function runtimeSettings(name, secret) {
  const runtime = definedRuntime(name);
  const { ports, database, databaseUser } = runtime;
  const password = secret();
  return { ...ports, ULPIN_PROFILE: 'demo', COMPOSE_PROJECT_NAME: runtime.project, REPO_DATA: 'false',
    POSTGRES_DB: database, POSTGRES_USER: databaseUser, POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgresql://${databaseUser}:${password}@127.0.0.1:${ports.POSTGRES_PORT}/${database}`,
    S3_ENDPOINT: `http://127.0.0.1:${ports.S3_PORT}`, S3_ACCESS_KEY: runtime.objectAccessKey,
    S3_SECRET_KEY: secret(), S3_BUCKET: runtime.bucket, S3_REGION: 'us-east-1', GEO_SERVICE_TOKEN: secret(),
    GEO_URL: `http://127.0.0.1:${ports.GEO_PORT}`, REDIS_URL: `redis://127.0.0.1:${ports.REDIS_PORT}/0`,
    ULPIN_LOCAL_OPERATOR_SUBJECT: runtime.operatorSubject, ULPIN_MODEL_GATEWAY_ENABLED: '0',
    ULPIN_DEMO_MODEL_DIR: runtime.modelDir };
}

/** Limit Windows ACL inheritance BEFORE secrets are written. No security-product settings changed. */
function restrictFolder(dir) {
  if (process.platform !== 'win32') return;
  const identity = '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value';
  const sid = command('powershell.exe', ['-NoProfile', '-Command', identity]);
  const grants = [`*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'];
  command('icacls.exe', [dir, '/inheritance:r', '/grant:r', ...grants]);
}

/** What a rehearsal shares with the demo, read-only: the demo's own two path files, through their readers. */
function sharedDemoPaths() {
  return { tabular: readDemoTabularPaths(), ocr: readDemoOcrPaths() };
}

function writeOnce(file, paths) {
  if (existsSync(file)) return false;
  writeFileSync(file, JSON.stringify(paths) + '\n', { flag: 'wx', mode: 0o600 });
  return true;
}

/**
 * A rehearsal's two path files, so that create finishes in one run. The interpreters, the learner seed, the
 * OCR models and Tesseract are the demo's (non-secret paths, only ever read); the learning folder and the OCR
 * scratch are new folders inside the rehearsal's own folder, never the demo's. A file that exists is left as
 * it is, so a resumed create writes nothing twice. Both files must then pass their readers. Returns the
 * names written. The second argument is for tests.
 */
export function writeRehearsalPaths(name, shared = sharedDemoPaths()) {
  const runtime = definedRuntime(name);
  if (!runtime.rehearsal) throw new Error('Path files are written for a rehearsal only; the demo keeps its own.');
  const learning = join(runtime.dir, 'learning'), scratch = join(runtime.dir, 'ocr-scratch');
  mkdirSync(learning, { recursive: true, mode: 0o700 });
  const { ULPIN_PROFILE_PYTHON, ULPIN_TABULAR_LEARNER_SEED } = shared.tabular;
  const tabular = { ULPIN_PROFILE_PYTHON, ULPIN_TABULAR_LEARNING_DIR: learning, ULPIN_TABULAR_LEARNER_SEED };
  const written = writeOnce(runtime.tabularFile, tabular) ? [basename(runtime.tabularFile)] : [];
  // Local OCR is optional for the demo; a rehearsal has it exactly when the demo does.
  if (shared.ocr.ULPIN_DOCUMENT_OCR_PYTHON) {
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    const ocr = { ...shared.ocr, ULPIN_DOCUMENT_OCR_SCRATCH: scratch };
    if (writeOnce(runtime.ocrFile, ocr)) written.push(basename(runtime.ocrFile));
  }
  readDemoTabularPaths(runtime.tabularFile, runtime.dir);
  readDemoOcrPaths(runtime.ocrFile, runtime.ocrProfileFile);
  return written;
}

/**
 * Makes a runtime's folder and settings once. An existing settings file is only read back: nothing is
 * regenerated. For a rehearsal the shared paths are read before anything is written, and its two path files
 * follow the settings in the same run.
 */
export async function createDemo(name = demoRuntime) {
  const definition = definedRuntime(name);
  const { file, dir, project } = definition;
  const runtime = dockerRuntime();
  const volumes = runtime.docker('volume', 'ls', '--format', '{{.Name}}').split('\n');
  const filter = `label=com.docker.compose.project=${project}`;
  const containers = runtime.docker('ps', '-a', '--filter', filter, '--format', '{{.ID}}');
  assertDemoConfigMayBeGenerated(existsSync(file), volumes, !!containers, project);
  const shared = definition.rehearsal ? sharedDemoPaths() : null;
  if (!existsSync(file)) {
    for (const port of Object.values(definition.ports)) await freePort(port);
    mkdirSync(join(dir, 'logs'), { recursive: true, mode: 0o700 });
    mkdirSync(join(dir, 'models'), { recursive: true, mode: 0o700 });
    restrictFolder(dir);
    const env = runtimeSettings(definition, () => randomBytes(32).toString('hex'));
    const text = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
    chmodSync(file, 0o600);
  }
  if (shared) writeRehearsalPaths(definition, shared);
  return readDemo(definition);
}
export function safeEnvironment(env) {
  const keys = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT'];
  return { ...Object.fromEntries(keys.filter(key => process.env[key]).map(key => [key, process.env[key]])), ...env };
}
export function redact(text, env) {
  for (const [key, value] of Object.entries(env)) if (value && /PASSWORD|SECRET|TOKEN|_KEY(?:_|$)|DATABASE_URL/.test(key)) text = text.replaceAll(value, '[redacted]');
  return text.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, '$1[redacted]@');
}
