// Owner-run frozen runtime builder. Dry runs use task-private output and never read demo.env.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { demoDir, readDemoDocumentRuntime, readDemoOcrPaths, safeEnvironment } from './demo-config.mjs';
import { ownedProcess } from './processes.mjs';
import { root } from './runtime.mjs';

const servingCheckout = 'E:/Projects/ulpin-wt/demo';
const usage = 'Usage: demo-document-runtime.mjs build [--python <absolute file>] [--dry-run --out <temporary folder>]';
const profileKey = 'ULPIN_PACKET_REGIONS_PROFILE';
const hashKey = 'ULPIN_PACKET_REGIONS_PROFILE_SHA256';
const pythonKey = 'ULPIN_PACKET_REGIONS_PYTHON';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The isolated child reuses server helpers without probing checkout .env or carrying service credentials. */
function serverHelper(script, args = [], env = {}) {
  return execFileSync(process.execPath, [
    '--require', join(root, 'scripts/platform/isolated-env.cjs'), '--import', 'tsx', '-e', script, ...args,
  ], {
    cwd: root, env: safeEnvironment({ ULPIN_PROFILE: 'demo', REPO_DATA: 'false', ...env }),
    encoding: 'utf8', timeout: 60000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function privateBuildDirectory(output) {
  const helper = pathToFileURL(join(root, 'packages/server/src/modules/usp/ingestion/document-ocr.ts')).href;
  const script = 'import(process.argv[1]).then(async m => '
    + 'console.log(await m.privateOcrDirectory(process.argv[2], process.argv[3])))';
  try { return serverHelper(script, [helper, output, randomUUID()]); }
  catch { throw new Error('Document runtime scratch keys require the private-directory ACL helper.'); }
}

/** Uses packetRegionRecipeSha(), and therefore the existing verifiedProfile() and its full asset checks. */
function verifiedRegionHash(paths) {
  const helper = pathToFileURL(join(root, 'packages/server/src/modules/usp/packets/region-runtime.ts')).href;
  const script = 'import(process.argv[1]).then(async m => console.log(await m.packetRegionRecipeSha()))';
  try {
    const hash = serverHelper(script, [helper], {
      [profileKey]: paths[profileKey], [hashKey]: paths[hashKey], [pythonKey]: paths[pythonKey],
    });
    if (hash !== paths[hashKey]) throw new Error('hash mismatch');
    return hash;
  } catch {
    throw new Error(`Document runtime verification failed: ${profileKey}, ${hashKey}, ${pythonKey}.`);
  }
}

/** Configuration facts only. No path, profile contents or child diagnostics are printed. */
export function documentRuntimeReport(paths) {
  const pagesConfigured = Boolean(paths.ULPIN_DOCUMENT_PAGES_PYTHON && paths.ULPIN_DOCUMENT_PAGES_SCRATCH);
  const regionsConfigured = Boolean(paths[profileKey] && paths[hashKey] && paths[pythonKey]
    && paths.ULPIN_PACKET_REGIONS_SCRATCH);
  const report = { pagesConfigured, regionsConfigured, regionProfileSha256: null, regionRepoMatches: null };
  if (regionsConfigured) {
    report.regionProfileSha256 = verifiedRegionHash(paths);
    try {
      const profile = JSON.parse(readFileSync(paths[profileKey], 'utf8'));
      report.regionRepoMatches = resolve(profile.repo).toLowerCase() === resolve(root).toLowerCase();
      const interpreterMatches = resolve(profile.python).toLowerCase() === resolve(paths[pythonKey]).toLowerCase();
      if (!report.regionRepoMatches || !interpreterMatches) throw new Error('binding mismatch');
    } catch { throw new Error(`Document runtime binding failed: ${profileKey}, ${pythonKey}.`); }
  }
  return report;
}

function assertBuildLocation(dryRun, output) {
  if (!dryRun) {
    if (resolve(root).toLowerCase() !== resolve(servingCheckout).toLowerCase() || output !== undefined) {
      throw new Error('Normal document runtime build requires the demo serving checkout; '
        + 'use --dry-run --out elsewhere.');
    }
    if (['api', 'dispatcher'].some(label => ownedProcess(label))) {
      throw new Error('Stop the recorded demo native processes before rebuilding document runtime keys.');
    }
    return demoDir;
  }
  if (!output || !isAbsolute(output)) throw new Error('--dry-run requires --out with an absolute temporary folder.');
  const destination = resolve(output).toLowerCase();
  const protectedRuntime = resolve('E:/BhuAayam-data/runtime').toLowerCase();
  if (destination === protectedRuntime || destination.startsWith(protectedRuntime + '/')) {
    throw new Error('--out must be a temporary folder, not the shared runtime.');
  }
  if (process.platform === 'win32' && destination.startsWith(protectedRuntime + '\\')) {
    throw new Error('--out must be a temporary folder, not the shared runtime.');
  }
  if (existsSync(join(output, 'document-runtime-paths.json'))) {
    throw new Error('--out already contains document runtime keys; choose a fresh folder.');
  }
  let parent = resolve(output);
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  let insideCheckout = false;
  try {
    insideCheckout = execFileSync('git', ['-C', parent, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() === 'true';
  } catch { /* A temporary directory outside Git is expected. */ }
  if (insideCheckout) throw new Error('--out must be outside every checkout.');
  return resolve(output);
}

function selectedPython(configured) {
  let python = configured;
  if (!python) {
    try { python = readDemoOcrPaths().ULPIN_DOCUMENT_OCR_PYTHON; }
    catch { throw new Error('Configure ULPIN_DOCUMENT_OCR_PYTHON or supply --python.'); }
  }
  try {
    if (!python || !isAbsolute(python) || !statSync(python).isFile()) throw new Error('python unavailable');
  } catch { throw new Error(`Absolute available runtime file required: ${pythonKey}.`); }
  return python;
}

function buildProfile(python, directory) {
  const profile = join(directory, 'packet-region-runtime.json');
  const builder = join(root, 'scripts/usp/document-models/packet_region_loader.py');
  try {
    const printedHash = execFileSync(python, ['-I', '-B', builder, '--repo', root, '--create-profile', profile], {
      cwd: root, env: safeEnvironment({}), encoding: 'utf8', timeout: 60000,
      windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!/^[a-f0-9]{64}$/.test(printedHash) || sha256(readFileSync(profile)) !== printedHash) {
      throw new Error('builder hash mismatch');
    }
    return { profile, hash: printedHash };
  } catch { throw new Error(`Frozen runtime build failed: ${pythonKey}, ${profileKey}, ${hashKey}.`); }
}

/** Each rollout gets a new immutable profile directory; only the non-secret path-file pointer is replaced. */
export function buildDocumentRuntime({ dryRun = false, out, python: configuredPython } = {}) {
  const output = assertBuildLocation(dryRun, out);
  const python = selectedPython(configuredPython);
  const directory = privateBuildDirectory(output);
  const frozen = buildProfile(python, directory);
  const pagesScratch = join(directory, 'pages-scratch');
  const regionsScratch = join(directory, 'regions-scratch');
  mkdirSync(pagesScratch, { mode: 0o700 });
  mkdirSync(regionsScratch, { mode: 0o700 });
  const paths = {
    ULPIN_DOCUMENT_PAGES_PYTHON: python, ULPIN_DOCUMENT_PAGES_SCRATCH: pagesScratch,
    [pythonKey]: python, [profileKey]: frozen.profile, [hashKey]: frozen.hash,
    ULPIN_PACKET_REGIONS_SCRATCH: regionsScratch,
  };
  const pending = join(directory, 'document-runtime-paths.json');
  writeFileSync(pending, JSON.stringify(paths) + '\n', { flag: 'wx', mode: 0o600 });
  readDemoDocumentRuntime(pending);
  documentRuntimeReport(paths);
  const file = join(output, 'document-runtime-paths.json');
  renameSync(pending, file);
  return { keys: Object.keys(paths), profileSha256: frozen.hash, pathsSha256: sha256(readFileSync(file)) };
}

function options(arguments_) {
  const [action, ...flags] = arguments_;
  if (action !== 'build') throw new Error(usage);
  const result = {};
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--dry-run' && !result.dryRun) result.dryRun = true;
    else if (['--out', '--python'].includes(flag) && flags[index + 1] && !flags[index + 1].startsWith('--')) {
      const key = flag.slice(2);
      if (result[key] !== undefined) throw new Error(usage);
      result[key] = flags[++index];
    } else throw new Error(usage);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const result = buildDocumentRuntime(options(process.argv.slice(2)));
    console.log(`Configured keys: ${result.keys.join(', ')}`);
    console.log(`${hashKey}: ${result.profileSha256}`);
    console.log(`document-runtime-paths.json SHA256: ${result.pathsSha256}`);
  } catch (error) {
    console.error(error.message.startsWith('Document runtime') || error.message.startsWith('Frozen runtime')
      || error.message.startsWith('Normal document') || error.message.startsWith('Stop the recorded')
      || error.message.startsWith('--') || error.message.startsWith('Absolute available runtime')
      || error.message.startsWith('Configure ULPIN') || error.message === usage
      ? error.message : 'Document runtime keys could not be built; private diagnostics withheld.');
    process.exitCode = 1;
  }
}
