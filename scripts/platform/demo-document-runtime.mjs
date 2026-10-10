// Owner-run frozen runtime builder. Dry runs use task-private output and never read demo.env.
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { demoDir, demoOcrProfileFile, readDemoDocumentRuntime, readDemoOcrPaths,
  safeEnvironment } from './demo-config.mjs';
import { ownedProcess } from './processes.mjs';
import { root } from './runtime.mjs';

const servingCheckout = 'E:/Projects/ulpin-wt/demo';
const usage = 'Usage: demo-document-runtime.mjs build [--python <absolute file>] [--dry-run --out <temporary folder>]'
  + '\n       demo-document-runtime.mjs switch-ocr-python (--python <absolute file> | --restore <saved file name>)'
  + ' [--dry-run --out <temporary folder>]'
  + '\nRollback: switch-ocr-python --restore <the saved previous file name the switch printed>, then build.';
const ocrPythonKey = 'ULPIN_DOCUMENT_OCR_PYTHON';
const savedOverrideName = /^ocr-paths-profile\.previous-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
/** Exactly the third-party imports of the OCR step (run_source_ocr.py) and the region step (run_packet_region.py). */
const importPreflight = [
  'import fitz, psutil, pypdfium2, pypdfium2_raw',
  'from PIL import Image',
  'from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions',
  'from docling.datamodel.base_models import ConversionStatus, InputFormat',
  'from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions, TesseractCliOcrOptions',
  'from docling.document_converter import DocumentConverter, ImageFormatOption',
].join('\n');
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
  let parent = resolve(output);
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  const destination = resolve(realpathSync(parent), relative(parent, resolve(output))).toLowerCase();
  const protectedRuntime = resolve('E:/BhuAayam-data/runtime').toLowerCase();
  if (destination === protectedRuntime || destination.startsWith(protectedRuntime + '/')) {
    throw new Error('--out must be a temporary folder, not the shared runtime.');
  }
  if (process.platform === 'win32' && destination.startsWith(protectedRuntime + '\\')) {
    throw new Error('--out must be a temporary folder, not the shared runtime.');
  }
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
  return availableInterpreter(python, pythonKey);
}

function availableInterpreter(python, key) {
  try {
    if (!python || !isAbsolute(python) || !statSync(python).isFile()) throw new Error('python unavailable');
  } catch { throw new Error(`Absolute available runtime file required: ${key}.`); }
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

/** One bounded CPU import check shared by the forward switch and the build; only imports run, no model. */
function preflightImports(python) {
  try {
    execFileSync(python, ['-I', '-B', '-c', importPreflight], {
      cwd: root, timeout: 180000, windowsHide: true, stdio: 'ignore',
      env: safeEnvironment({ CUDA_VISIBLE_DEVICES: '', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }),
    });
  } catch { throw new Error('Document runtime import preflight failed: the OCR and region packages must import.'); }
}

/** The base named by the environment's pyvenv.cfg; null when no single absolute, existing home can be read. */
function interpreterBase(python) {
  const environment = realpathSync(dirname(dirname(python)));
  const config = join(environment, 'pyvenv.cfg');
  const homes = existsSync(config) ? [...readFileSync(config, 'utf8').matchAll(/^home\s*=\s*(.+?)\s*$/gm)] : [];
  if (homes.length !== 1 || !isAbsolute(homes[0][1]) || !existsSync(homes[0][1])) {
    return { base: null, baseInsideEnvironment: null };
  }
  const base = realpathSync(homes[0][1]);
  const location = relative(environment, base);
  const inside = location !== '' && location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location);
  return { base, baseInsideEnvironment: inside };
}

/** The shared reader validates the file; its own refusals name keys only, and any other failure stays private. */
function readOverride(folder, name) {
  const file = join(folder, name);
  if (!existsSync(file)) throw new Error(`Document runtime OCR override not found: ${name}; this action creates none.`);
  if (dirname(realpathSync(file)).toLowerCase() !== realpathSync(folder).toLowerCase()) {
    throw new Error('Document runtime OCR override must resolve inside its own folder.');
  }
  const bytes = readFileSync(file);
  let paths;
  try { paths = readDemoOcrPaths(file); }
  catch (error) {
    const reason = /^(OCR|Pinned OCR) /.test(error.message) ? error.message : 'the shared reader could not parse it.';
    throw new Error(`Document runtime OCR override refused: ${reason}`);
  }
  if (!readFileSync(file).equals(bytes)) throw new Error('Document runtime OCR override changed during validation.');
  return { paths, bytes };
}

/** Replaces the one literal value in place: every other byte, value and key position stays as it was. */
function withInterpreter(bytes, python) {
  const text = bytes.toString('utf8');
  const literal = /("ULPIN_DOCUMENT_OCR_PYTHON"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
  const changed = text.replace(literal, (_, key) => key + JSON.stringify(python));
  const expected = JSON.parse(text);
  expected.paths[ocrPythonKey] = python;
  if ([...text.matchAll(literal)].length !== 1 || JSON.stringify(JSON.parse(changed)) !== JSON.stringify(expected)) {
    throw new Error(`Document runtime OCR override must hold ${ocrPythonKey} exactly once, as a literal.`);
  }
  return Buffer.from(changed);
}

/** Forward switch: no flag relaxes the private-base rule, and the imports are proven before anything is written. */
function forwardOverride(current, python, preflight) {
  availableInterpreter(python, ocrPythonKey);
  const { base, baseInsideEnvironment } = interpreterBase(python);
  if (base === null) {
    throw new Error('Document runtime interpreter requires a pyvenv.cfg with one absolute, existing home.');
  }
  if (!baseInsideEnvironment) {
    throw new Error(`Document runtime interpreter base lies outside its environment: ${base}`);
  }
  const bytes = withInterpreter(current.bytes, python);
  preflight(python);
  return { python, bytes, baseInsideEnvironment };
}

/** Rollback: the saved file's bytes return as they were; the private-base rule is reported, not applied. */
function savedOverride(folder, name) {
  if (typeof name !== 'string' || !savedOverrideName.test(name)) {
    throw new Error('Document runtime restore requires a saved ocr-paths-profile.previous-<UTC>.json file name.');
  }
  const saved = readOverride(folder, name);
  const python = saved.paths[ocrPythonKey];
  return { python, bytes: saved.bytes, baseInsideEnvironment: interpreterBase(python).baseInsideEnvironment };
}

/** Saves the current bytes beside the override, then replaces it by one rename. Nothing is ever deleted. */
function publishOverride(file, before, after, rename) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const savedPreviousFile = `${basename(file, '.json')}.previous-${stamp}.json`;
  const pending = `${file}.pending-${randomUUID()}`;
  writeFileSync(pending, after, { flag: 'wx', mode: 0o600 });
  readOverride(dirname(file), basename(pending));
  writeFileSync(join(dirname(file), savedPreviousFile), before, { flag: 'wx', mode: 0o600 });
  if (!readFileSync(file).equals(before)) throw new Error('Document runtime OCR override changed before publication.');
  rename(pending, file);
  return { savedPreviousFile, previousSha256: sha256(before), newSha256: sha256(after) };
}

/** Owner-run. A dry run works only on the copy already in --out. The second argument is for tests. */
export function switchOcrPython({ dryRun = false, out, python, restore } = {}, seams = {}) {
  const { rename = renameSync, preflight = preflightImports } = seams;
  if ((python === undefined) === (restore === undefined)) throw new Error(usage);
  const folder = assertBuildLocation(dryRun, out);
  const name = basename(demoOcrProfileFile);
  const current = readOverride(folder, name);
  const next = restore === undefined ? forwardOverride(current, python, preflight) : savedOverride(folder, restore);
  const published = publishOverride(join(folder, name), current.bytes, next.bytes, rename);
  return {
    restored: restore !== undefined, previousPython: current.paths[ocrPythonKey], newPython: next.python,
    baseInsideEnvironment: next.baseInsideEnvironment, ...published,
  };
}

/** Each rollout gets a new immutable profile directory; only the non-secret path-file pointer is replaced. */
export function buildDocumentRuntime({ dryRun = false, out, python: configuredPython } = {}) {
  const output = assertBuildLocation(dryRun, out);
  if (dryRun && existsSync(join(output, 'document-runtime-paths.json'))) {
    throw new Error('--out already contains document runtime keys; choose a fresh folder.');
  }
  const python = selectedPython(configuredPython);
  preflightImports(python);
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
  if (!['build', 'switch-ocr-python'].includes(action)) throw new Error(usage);
  const result = { action };
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--dry-run' && !result.dryRun) result.dryRun = true;
    else if (['--out', '--python', '--restore'].includes(flag) && flags[index + 1]
      && !flags[index + 1].startsWith('--')) {
      const key = flag.slice(2);
      if (result[key] !== undefined) throw new Error(usage);
      result[key] = flags[++index];
    } else throw new Error(usage);
  }
  if (action === 'build' && result.restore !== undefined) throw new Error(usage);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try {
    const selected = options(process.argv.slice(2));
    if (selected.action === 'switch-ocr-python') {
      console.log(JSON.stringify(switchOcrPython(selected)));
    } else {
      const result = buildDocumentRuntime(selected);
      console.log(`Configured keys: ${result.keys.join(', ')}`);
      console.log(`${hashKey}: ${result.profileSha256}`);
      console.log(`document-runtime-paths.json SHA256: ${result.pathsSha256}`);
    }
  } catch (error) {
    console.error(error.message.startsWith('Document runtime') || error.message.startsWith('Frozen runtime')
      || error.message.startsWith('Normal document') || error.message.startsWith('Stop the recorded')
      || error.message.startsWith('--') || error.message.startsWith('Absolute available runtime')
      || error.message.startsWith('Configure ULPIN') || error.message === usage
      ? error.message : 'Document runtime keys could not be built; private diagnostics withheld.');
    process.exitCode = 1;
  }
}
