import {
  existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, realpathSync, statSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { command, dockerRuntime, root } from './runtime.mjs';

export const demoDir = 'E:/BhuAayam-data/runtime/ulpin-demo';
export const demoProject = 'ulpin-demo';
export const demoFile = join(demoDir, 'demo.env');
export const demoOcrFile = join(demoDir, 'ocr-paths.json');
export const demoTabularFile = join(demoDir, 'tabular-paths.json');
const demoOcrProfileFile = join(demoDir, 'ocr-paths-profile.json');
const ocrNames = ['PYTHON', 'MODELS', 'TESSERACT', 'TESSDATA', 'SCRATCH'];

/** Optional non-secret paths only. Never derive or replace credentials. */
export function readDemoOcrPaths() {
  if (!existsSync(demoOcrFile)) return {};
  let paths = JSON.parse(readFileSync(demoOcrFile, 'utf8'));
  if (existsSync(demoOcrProfileFile)) {
    const override = JSON.parse(readFileSync(demoOcrProfileFile, 'utf8'));
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
  const runtime = realpathSync(demoDir);
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
export function readDemoTabularPaths(file = demoTabularFile) {
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
  validateTabularArtifacts(paths);
  return paths;
}

function validateTabularArtifacts(paths) {
  const learning = realpathSync(paths.ULPIN_TABULAR_LEARNING_DIR);
  const insideRuntime = relative(realpathSync(demoDir), learning);
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

/** Only the fields this profile gates on; every other rule is the schema's, through gatewayPolicyHash(). */
function assertGatewayEnabled(env) {
  let policy;
  try { policy = JSON.parse(env[gatewayConfigKey] ?? ''); }
  catch { throw new Error(`Demo setting ${gatewayConfigKey} must be valid JSON while ${gatewayFlag} is 1.`); }
  if (policy?.secretReference !== providerKeyName) {
    throw new Error(`${gatewayConfigKey}.secretReference must be exactly ${providerKeyName}.`);
  }
  if (!env[providerKeyName]) {
    throw new Error(`Demo setting ${providerKeyName} is required while ${gatewayFlag} is 1.`);
  }
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

const expectedPorts = { POSTGRES_PORT: '15434', S3_PORT: '19020', S3_CONSOLE_PORT: '19021', REDIS_PORT: '16381', GEO_PORT: '18002', API_PORT: '3194' };
export function readDemo() {
  let tabular;
  try { tabular = readDemoTabularPaths(); }
  catch (error) {
    console.error(error.message); // Only path-validation messages, never demo.env values.
    throw error;
  }
  return { ...readDemoSettings(), ...readDemoOcrPaths(), ...tabular };
}
/** The demo.env part of readDemo(). Only tests and the gateway script's unrenamed copy pass another file. */
export function readDemoSettings(file = demoFile) {
  if (!existsSync(file)) throw new Error('Demo configuration missing; use --profile demo --create after inventory reconciliation.');
  // Only this explicitly authorized external file is read, never checkout .env.
  const env = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
    const at = line.indexOf('=');
    if (at <= 0) throw new Error('Invalid demo configuration.');
    return [line.slice(0, at), line.slice(at + 1)];
  }));
  for (const [key, value] of Object.entries({ ...expectedPorts, ULPIN_PROFILE: 'demo', COMPOSE_PROJECT_NAME: demoProject,
    POSTGRES_DB: 'ulpin_demo', POSTGRES_USER: 'ulpin_demo', S3_BUCKET: demoProject, REPO_DATA: 'false' })) {
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
export function assertDemoConfigMayBeGenerated(hasConfig, volumes, hasContainers) {
  if (!hasConfig && (volumes.some(v => v.startsWith(`${demoProject}_`)) || hasContainers))
    throw new Error('Demo storage/containers already exist but demo.env is missing. STOP: recover its original configuration; never generate replacement passwords.');
}
export async function createDemo() {
  const runtime = dockerRuntime();
  const volumes = runtime.docker('volume', 'ls', '--format', '{{.Name}}').split('\n');
  const containers = runtime.docker('ps', '-a', '--filter', `label=com.docker.compose.project=${demoProject}`, '--format', '{{.ID}}');
  assertDemoConfigMayBeGenerated(existsSync(demoFile), volumes, !!containers);
  if (existsSync(demoFile)) return readDemo();
  for (const port of Object.values(expectedPorts)) await freePort(port);
  mkdirSync(join(demoDir, 'logs'), { recursive: true, mode: 0o700 });
  mkdirSync(join(demoDir, 'models'), { recursive: true, mode: 0o700 });
  // Limit Windows ACL inheritance BEFORE writing secrets. No security-product settings changed.
  if (process.platform === 'win32') {
    const sid = command('powershell.exe', ['-NoProfile', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value']);
    command('icacls.exe', [demoDir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F']);
  }
  const secret = () => randomBytes(32).toString('hex');
  const password = secret();
  const env = { ...expectedPorts, ULPIN_PROFILE: 'demo', COMPOSE_PROJECT_NAME: demoProject, REPO_DATA: 'false',
    POSTGRES_DB: 'ulpin_demo', POSTGRES_USER: 'ulpin_demo', POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgresql://ulpin_demo:${password}@127.0.0.1:${expectedPorts.POSTGRES_PORT}/ulpin_demo`,
    S3_ENDPOINT: `http://127.0.0.1:${expectedPorts.S3_PORT}`, S3_ACCESS_KEY: 'ulpindemo', S3_SECRET_KEY: secret(),
    S3_BUCKET: demoProject, S3_REGION: 'us-east-1', GEO_SERVICE_TOKEN: secret(),
    GEO_URL: `http://127.0.0.1:${expectedPorts.GEO_PORT}`, REDIS_URL: `redis://127.0.0.1:${expectedPorts.REDIS_PORT}/0`,
    ULPIN_LOCAL_OPERATOR_SUBJECT: 'selection-demo-runtime', ULPIN_MODEL_GATEWAY_ENABLED: '0',
    ULPIN_DEMO_MODEL_DIR: join(demoDir, 'models').replaceAll('\\', '/') };
  writeFileSync(demoFile, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  chmodSync(demoFile, 0o600);
  return readDemo();
}
export function safeEnvironment(env) {
  const keys = ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT'];
  return { ...Object.fromEntries(keys.filter(key => process.env[key]).map(key => [key, process.env[key]])), ...env };
}
export function redact(text, env) {
  for (const [key, value] of Object.entries(env)) if (value && /PASSWORD|SECRET|TOKEN|_KEY(?:_|$)|DATABASE_URL/.test(key)) text = text.replaceAll(value, '[redacted]');
  return text.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, '$1[redacted]@');
}
