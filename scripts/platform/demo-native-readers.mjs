// Owner-run builder of the batch's native reader profiles (DXF, CityGML, glTF/GLB, OBJ). Dry runs use
// task-private output and never read demo.env.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { definedRuntime, demoRuntime, nativeReaderKeys, nativeReaders, readDemoNativeReaders, runtimeDefinition,
  safeEnvironment } from './demo-config.mjs';
import { assertBuildLocation, privateBuildDirectory, serverHelper } from './demo-document-runtime.mjs';
import { root } from './runtime.mjs';

const usage = 'Usage: demo-native-readers.mjs build [--python <absolute file>] [--dry-run --out <temporary folder>]'
  + '\n       demo-native-readers.mjs check [--paths <absolute native-reader-paths.json>]'
  + '\nEither action takes --runtime <name> (default ulpin-demo) and works on that runtime only.';
const pathsName = 'native-reader-paths.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * The base interpreter every reader runs: the one the glTF and OBJ runtime scripts name
 * (scripts/usp/desktop-gltf-http-runtime.mjs, desktop-obj-http-runtime.mjs). --python replaces it.
 */
export const defaultPython = 'C:/Python313/python.exe';
/**
 * Each reader's own isolated environment (null: standard library only) and the repository lock its packages must
 * match. The environments are the ones each reader was accepted with (intake-native-readers.test.ts roots).
 */
export const readerSetup = Object.freeze({
  dxf: { environment: 'E:/BhuAayam-data/task-data/desktop-dxf-native/env',
    lock: 'docs/evidence/usp/native-dxf/requirements.lock', config: 'dxfConfig' },
  citygml: { environment: 'E:/BhuAayam-data/task-data/desktop-citygml-native/env',
    lock: 'scripts/usp/citygml/runtime-lock.json', config: 'citygmlConfig' },
  gltf: { environment: 'E:/BhuAayam-data/task-data/desktop-gltf-native/env', lock: null, config: 'gltfConfig' },
  obj: { environment: null, lock: null, config: 'objConfig' },
});

/** A closed reason: no path, profile content or child diagnostic ever leaves this script. */
class Unavailable extends Error {}
const unavailable = reason => { throw new Unavailable(reason); };
const sameFolder = (a, b) => resolve(realpathSync(a)).toLowerCase() === resolve(realpathSync(b)).toLowerCase();

/** The base interpreter: absolute, present and a CPython 3.13 install folder, as each reader's config requires. */
function baseInterpreter(python) {
  try {
    if (!python || !isAbsolute(python) || !statSync(python).isFile()
      || !statSync(join(dirname(python), 'python313.dll')).isFile()) throw new Error('unusable');
  } catch { throw new Error('Native reader interpreter unavailable: supply --python <absolute CPython 3.13 python.exe>.'); }
  return python;
}

/** Packages the repository lock pins, as name/version pairs; null when the reader needs none. */
function lockedPackages(lock) {
  if (!lock) return [];
  const text = readFileSync(join(root, lock), 'utf8');
  if (lock.endsWith('.json')) return JSON.parse(text).dependencies.map(({ name, version }) => [name, version]);
  return text.split(/\r?\n/).map(line => /^([A-Za-z0-9_.-]+)==([^\s]+)/.exec(line)).filter(Boolean)
    .map(([, name, version]) => [name, version]);
}

/** The environment exists, was made from this base interpreter, and holds every locked package at its version. */
function checkEnvironment(reader, environment, python) {
  const site = join(environment, 'Lib', 'site-packages');
  if (!existsSync(site) || !statSync(site).isDirectory()) unavailable('environment missing');
  const config = join(environment, 'pyvenv.cfg');
  const homes = existsSync(config) ? [...readFileSync(config, 'utf8').matchAll(/^home\s*=\s*(.+?)\s*$/gm)] : [];
  if (homes.length !== 1 || !existsSync(homes[0][1]) || !sameFolder(homes[0][1], dirname(python))) {
    unavailable('environment made from another interpreter');
  }
  const normal = name => name.toLowerCase().replaceAll('-', '_').replaceAll('.', '_');
  const installed = new Set(readdirSync(site).filter(name => name.endsWith('.dist-info')).map(normal));
  const missing = lockedPackages(readerSetup[reader].lock)
    .filter(([name, version]) => !installed.has(normal(`${name}-${version}.dist-info`)));
  if (missing.length) unavailable(`environment lacks locked packages: ${missing.map(([n, v]) => `${n}==${v}`).join(', ')}`);
}

/** The reader's own profile.py, run by the base interpreter itself without bytecode writes. */
function runProfileHelper(reader, python, environment, folder) {
  const scratch = join(folder, 'scratch');
  const profile = join(folder, 'profile.json');
  mkdirSync(scratch, { mode: 0o700 });
  const args = ['-I', '-S', '-B', join(root, 'scripts/usp', reader, 'profile.py'), '--python', python];
  if (environment) args.push('--environment', environment);
  args.push('--scratch', scratch);
  if (reader === 'obj') args.push('--native-lock', join(folder, 'native-lock.json'));
  args.push('--output', profile);
  let printed;
  try {
    printed = JSON.parse(execFileSync(python, args, {
      cwd: folder, env: safeEnvironment({}), encoding: 'utf8', timeout: 180000, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/).at(-1));
  } catch { unavailable('profile builder failed'); }
  if (!/^[a-f0-9]{64}$/.test(printed?.sha256 ?? '') || sha256(readFileSync(profile)) !== printed.sha256) {
    unavailable('profile builder hash mismatch');
  }
  return { profile, hash: printed.sha256, files: printed.files };
}

const verifyScript = 'import(process.argv[1]).then(m => console.log(m[process.argv[2]]().pins.profileSha256))'
  + '.catch(e => console.log(/^[A-Z0-9_]{3,64}$/.test(e?.code ?? "") ? e.code : "REFUSED"))';

/**
 * The reader's own server configuration, unchanged, in an isolated child: profile hash, full runtime, environment
 * and repository inventory, checkout binding and code pins. Returns null when it accepts, else its closed code.
 */
export function verifyReader(reader, profile, hash) {
  const [profileKey, hashKey] = nativeReaderKeys(reader);
  const helper = pathToFileURL(join(root, `packages/server/src/modules/usp/ingestion/${reader}-config.ts`)).href;
  let printed;
  try {
    printed = serverHelper(verifyScript, [helper, readerSetup[reader].config], { [profileKey]: profile, [hashKey]: hash });
  } catch { return 'VERIFIER_FAILED'; }
  return printed === hash ? null : (/^[A-Z0-9_]{3,64}$/.test(printed) ? printed : 'REFUSED');
}

function buildReader(reader, python, environment, directory) {
  if (environment) checkEnvironment(reader, environment, python);
  const folder = join(directory, reader);
  mkdirSync(folder, { mode: 0o700 });
  const built = runProfileHelper(reader, python, environment, folder);
  const refusal = verifyReader(reader, built.profile, built.hash);
  if (refusal) unavailable(`reader configuration refused the new profile: ${refusal}`);
  return built;
}

/**
 * Each rollout gets a new private directory with one profile per reader; only the non-secret path-file pointer is
 * replaced. A reader that cannot be built here is reported with its reason and left out; the others still build.
 * Nothing is written to the pointer when no reader could be built. The second argument is for tests.
 */
export function buildNativeReaders({ dryRun = false, out, python: configured, runtime } = {},
  { environments = {}, readers = nativeReaders } = {}) {
  const definition = definedRuntime(runtime);
  const output = assertBuildLocation(dryRun, out, definition, 'native reader');
  if (dryRun && existsSync(join(output, pathsName))) {
    throw new Error('--out already contains native reader keys; choose a fresh folder.');
  }
  const python = baseInterpreter(configured ?? defaultPython);
  const directory = privateBuildDirectory(output);
  const paths = {}, results = [];
  for (const reader of readers) {
    const environment = Object.hasOwn(environments, reader) ? environments[reader] : readerSetup[reader].environment;
    try {
      const built = buildReader(reader, python, environment, directory);
      const [profileKey, hashKey] = nativeReaderKeys(reader);
      Object.assign(paths, { [profileKey]: built.profile, [hashKey]: built.hash });
      results.push({ reader, status: 'built', profileSha256: built.hash, files: built.files });
    } catch (error) {
      // Any other failure carries configured paths in its message: it is withheld, and the next reader still builds.
      const reason = error instanceof Unavailable ? error.message : 'reader setup failed; private diagnostics withheld';
      results.push({ reader, status: 'unavailable', reason });
    }
  }
  if (!Object.keys(paths).length) return { readers: results, written: false, pathsSha256: null };
  const pending = join(directory, pathsName);
  writeFileSync(pending, JSON.stringify(paths) + '\n', { flag: 'wx', mode: 0o600 });
  readDemoNativeReaders(pending);
  const file = join(output, pathsName);
  renameSync(pending, file);
  return { readers: results, written: true, pathsSha256: sha256(readFileSync(file)) };
}

/** Each reader of a path file: verified, unconfigured, or refused with its reader's own code. */
export function checkNativeReaders({ runtime, paths: file } = {}) {
  const definition = definedRuntime(runtime);
  if (file !== undefined && !isAbsolute(file)) throw new Error('--paths requires an absolute file.');
  const paths = readDemoNativeReaders(file ?? definition.nativeReaderFile);
  return nativeReaders.map(reader => {
    const [profileKey, hashKey] = nativeReaderKeys(reader);
    if (!paths[profileKey]) return { reader, status: 'unconfigured' };
    const refusal = verifyReader(reader, paths[profileKey], paths[hashKey]);
    return refusal ? { reader, status: 'refused', reason: refusal }
      : { reader, status: 'verified', profileSha256: paths[hashKey] };
  });
}

function options(arguments_) {
  const [action, ...flags] = arguments_;
  if (!['build', 'check'].includes(action)) throw new Error(usage);
  const allowed = action === 'build' ? ['--out', '--python', '--runtime'] : ['--paths', '--runtime'];
  const result = { action };
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--dry-run' && action === 'build' && !result.dryRun) result.dryRun = true;
    else if (allowed.includes(flag) && flags[index + 1] && !flags[index + 1].startsWith('--')) {
      const key = flag.slice(2);
      if (result[key] !== undefined) throw new Error(usage);
      result[key] = flags[++index];
    } else throw new Error(usage);
  }
  // The name is checked here, before any file of any runtime is read.
  return { ...result, runtime: runtimeDefinition(result.runtime ?? demoRuntime) };
}

const line = result => {
  const [, hashKey] = nativeReaderKeys(result.reader);
  if (result.profileSha256) return `${result.reader}: ${result.status}, ${hashKey} ${result.profileSha256}`
    + (result.files ? `, ${result.files} files` : '');
  return `${result.reader}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
};

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const selected = options(process.argv.slice(2));
    if (selected.action === 'check') {
      const results = checkNativeReaders(selected);
      results.forEach(result => console.log(line(result)));
      process.exitCode = results.every(result => result.status === 'verified') ? 0 : 2;
    } else {
      const result = buildNativeReaders(selected);
      result.readers.forEach(reader => console.log(line(reader)));
      console.log(result.written ? `${pathsName} SHA256: ${result.pathsSha256}`
        : `${pathsName} not written: no reader could be built; the existing file is unchanged.`);
      process.exitCode = !result.written ? 1 : result.readers.every(reader => reader.status === 'built') ? 0 : 2;
    }
  } catch (error) {
    console.error(/^(Native reader|Normal native|Stop the recorded|--|Unknown runtime|Document runtime scratch)/
      .test(error.message) || error.message === usage
      ? error.message : 'Native reader keys could not be built; private diagnostics withheld.');
    process.exitCode = 1;
  }
}
