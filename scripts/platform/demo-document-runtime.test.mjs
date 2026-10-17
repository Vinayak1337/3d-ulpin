// Temporary path/profile files only. Never open real demo configuration or change a native dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  demoDir, demoOcrFile, demoOcrProfileFile, readDemoDocumentRuntime, readDemoOcrPaths,
} from './demo-config.mjs';
import { buildDocumentRuntime, documentRuntimeReport, switchOcrPython } from './demo-document-runtime.mjs';
import { root } from './runtime.mjs';

const marker = 'private-path-marker';
const pythonKey = 'ULPIN_DOCUMENT_PAGES_PYTHON';
const scratchKey = 'ULPIN_DOCUMENT_PAGES_SCRATCH';
const profileKey = 'ULPIN_PACKET_REGIONS_PROFILE';
const hashKey = 'ULPIN_PACKET_REGIONS_PROFILE_SHA256';
const ocrPythonKey = 'ULPIN_DOCUMENT_OCR_PYTHON';
const savedName = /^ocr-paths-profile\.previous-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
const nativePython = process.env.ULPIN_DOCUMENT_RUNTIME_TEST_PYTHON;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function temporaryFolder(context) {
  const folder = mkdtempSync(join(tmpdir(), 'demo-document-runtime-'));
  context.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function fixture(context) {
  const folder = temporaryFolder(context);
  const python = join(folder, `${marker}.exe`);
  const profile = join(folder, `${marker}.json`);
  const pages = join(folder, 'pages-scratch');
  const regions = join(folder, 'regions-scratch');
  writeFileSync(python, marker);
  writeFileSync(profile, '{}');
  mkdirSync(pages);
  mkdirSync(regions);
  const paths = {
    [pythonKey]: python, [scratchKey]: pages,
    ULPIN_PACKET_REGIONS_PYTHON: python, [profileKey]: profile, [hashKey]: 'a'.repeat(64),
    ULPIN_PACKET_REGIONS_SCRATCH: regions,
  };
  return { folder, paths, file: join(folder, 'paths.json') };
}

function readPaths(control, paths = control.paths) {
  writeFileSync(control.file, JSON.stringify(paths));
  return readDemoDocumentRuntime(control.file);
}

function refused(control, paths, expected) {
  assert.throws(() => readPaths(control, paths), error => {
    assert.match(error.message, expected);
    for (const value of [marker, control.folder, 'configured-secret-value']) {
      assert.ok(!error.message.includes(value), 'configured values must not escape in a validation message');
    }
    return true;
  });
}

test('absent path file is unconfigured, and complete runtime groups validate without reading demo.env', context => {
  const control = fixture(context);
  assert.deepEqual(readDemoDocumentRuntime(control.file), {});
  assert.deepEqual(documentRuntimeReport({}), {
    pagesConfigured: false, regionsConfigured: false, regionProfileSha256: null, regionRepoMatches: null,
  });
  assert.deepEqual(readPaths(control), control.paths);
  assert.deepEqual(readPaths(control, {}), {});
  const pagesOnly = { [pythonKey]: control.paths[pythonKey], [scratchKey]: control.paths[scratchKey] };
  assert.deepEqual(readPaths(control, pagesOnly), pagesOnly);
});

test('unexpected keys, partial groups, invalid JSON and invalid hash values fail without repeating values', context => {
  const control = fixture(context);
  refused(control, { ...control.paths, 'configured-secret-value': marker }, /unexpected keys/);
  refused(control, { [pythonKey]: control.paths[pythonKey] }, /ULPIN_DOCUMENT_PAGES_SCRATCH/);
  for (const value of [marker, 'A'.repeat(64), 'a'.repeat(63), null, 2]) {
    refused(control, { ...control.paths, [hashKey]: value }, /ULPIN_PACKET_REGIONS_PROFILE_SHA256/);
  }
  for (const text of [`{"${marker}":`, 'null', '[]', '2']) {
    writeFileSync(control.file, text);
    assert.throws(() => readDemoDocumentRuntime(control.file), error => {
      assert.ok(!error.message.includes(marker));
      return true;
    });
  }
});

test('every path must be absolute, present and of the correct filesystem kind', context => {
  const control = fixture(context);
  const pathKeys = Object.keys(control.paths).filter(key => key !== hashKey);
  for (const key of pathKeys) {
    const wrongKind = key.endsWith('_SCRATCH') ? control.paths[pythonKey] : control.paths[scratchKey];
    for (const value of [marker, join(control.folder, `${marker}-missing`), wrongKind, null]) {
      refused(control, { ...control.paths, [key]: value }, new RegExp(key));
    }
  }
});

test('scratch cannot live in a registered checkout, another clone, or a junction into a checkout', context => {
  const control = fixture(context);
  refused(control, { ...control.paths, [scratchKey]: root }, /outside every checkout/);
  const clone = join(control.folder, 'other-checkout');
  const child = join(clone, 'scratch');
  mkdirSync(child, { recursive: true });
  writeFileSync(join(clone, '.git'), marker);
  refused(control, { ...control.paths, [scratchKey]: child }, /outside every checkout/);
  const junction = join(control.folder, 'scratch-junction');
  symlinkSync(child, junction, process.platform === 'win32' ? 'junction' : 'dir');
  refused(control, { ...control.paths, ULPIN_PACKET_REGIONS_SCRATCH: junction }, /outside every checkout/);
});

test('normal build is refused in a worker checkout, and a dry run needs an external absolute folder', () => {
  // Supplying --out makes this refusal safe even if tests are run from the real, stopped demo checkout.
  assert.throws(() => buildDocumentRuntime({ out: marker }), /requires the demo serving checkout/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true }), /--out/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true, out: marker }), /absolute temporary folder/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true, out: root }), /outside every checkout/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true, out: 'E:/BhuAayam-data/runtime/ulpin-demo' }),
    /not the shared runtime/);
});

test('dry-run output junctions cannot point into the shared runtime', {
  skip: process.platform !== 'win32' || !existsSync('E:/BhuAayam-data/runtime'),
}, context => {
  const folder = temporaryFolder(context);
  const junction = join(folder, 'runtime-junction');
  symlinkSync('E:/BhuAayam-data/runtime', junction, 'junction');
  // An invalid interpreter prevents any build writes even if the destination guard regresses.
  assert.throws(() => buildDocumentRuntime({ dryRun: true, out: junction, python: marker }), /not the shared runtime/);
});

test('CLI refusals print key names, never a configured interpreter value or native exception', context => {
  const folder = temporaryFolder(context);
  const configured = join(folder, marker);
  const child = spawnSync(process.execPath, [
    join(root, 'scripts/platform/demo-document-runtime.mjs'), 'build', '--dry-run', '--out', folder,
    '--python', configured,
  ], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /ULPIN_PACKET_REGIONS_PYTHON/);
  assert.ok(!(child.stdout + child.stderr).includes(marker));
  assert.ok(!(child.stdout + child.stderr).includes(folder));
});

test('dry-run frozen profiles pass existing verifiedProfile only for the exact repo, hash and interpreter', {
  skip: process.platform !== 'win32' || !nativePython || !existsSync(nativePython), timeout: 180000,
}, context => {
  const folder = temporaryFolder(context);
  const built = buildDocumentRuntime({ dryRun: true, out: folder, python: nativePython });
  const file = join(folder, 'document-runtime-paths.json');
  const paths = readDemoDocumentRuntime(file);
  assert.equal(built.profileSha256, hash(readFileSync(paths[profileKey])));
  assert.equal(built.pathsSha256, hash(readFileSync(file)));
  assert.equal(built.keys.length, 6);
  const report = documentRuntimeReport(paths);
  assert.equal(report.pagesConfigured, true);
  assert.equal(report.regionsConfigured, true);
  assert.equal(report.regionRepoMatches, true);
  assert.equal(report.regionProfileSha256, built.profileSha256);

  const profile = JSON.parse(readFileSync(paths[profileKey], 'utf8'));
  const mismatched = join(folder, 'mismatched-profile.json');
  const bytes = Buffer.from(JSON.stringify({ ...profile, repo: folder }));
  writeFileSync(mismatched, bytes);
  const badPaths = { ...paths, [profileKey]: mismatched, [hashKey]: hash(bytes) };
  assert.throws(() => documentRuntimeReport(badPaths), /Document runtime verification failed/);
  assert.throws(() => documentRuntimeReport({ ...paths, [hashKey]: 'b'.repeat(64) }), /verification failed/);
  assert.throws(() => documentRuntimeReport({ ...paths, ULPIN_PACKET_REGIONS_PYTHON: mismatched }), /binding failed/);
  assert.equal(hash(readFileSync(paths[profileKey])), built.profileSha256, 'original frozen profile is unchanged');
});

/** A synthetic interpreter: an environment folder, its launcher file and a pyvenv.cfg that names the given base. */
function environment(folder, name, base) {
  const scripts = join(folder, name, 'Scripts');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(base, { recursive: true });
  writeFileSync(join(folder, name, 'pyvenv.cfg'), `home = ${base}\r\nimplementation = CPython\r\n`);
  writeFileSync(join(scripts, 'python.exe'), marker);
  return join(scripts, 'python.exe');
}

/** A demo-scoped override in its own --out folder. The old interpreter's base lies outside its environment. */
function ocrFixture(context) {
  const folder = temporaryFolder(context);
  const out = join(folder, 'out');
  const outsideBase = join(folder, 'another-application', 'python');
  const oldPython = environment(folder, 'old-env', outsideBase);
  const privatePython = environment(folder, 'private-env', join(folder, 'private-env', 'base'));
  const layout = join(folder, 'models', 'docling-project--docling-layout-heron');
  for (const directory of [layout, join(folder, 'tessdata'), join(out, 'ocr-scratch')]) {
    mkdirSync(directory, { recursive: true });
  }
  const tesseract = join(folder, 'tesseract.exe');
  for (const file of [join(layout, 'model.safetensors'), join(folder, 'tessdata', 'eng.traineddata'), tesseract]) {
    writeFileSync(file, marker);
  }
  const paths = {
    ULPIN_DOCUMENT_OCR_MODELS: join(folder, 'models'), [ocrPythonKey]: oldPython,
    ULPIN_DOCUMENT_OCR_TESSERACT: tesseract, ULPIN_DOCUMENT_OCR_TESSDATA: join(folder, 'tessdata'),
    ULPIN_DOCUMENT_OCR_SCRATCH: join(out, 'ocr-scratch'),
  };
  const file = join(out, 'ocr-paths-profile.json');
  writeFileSync(file, JSON.stringify({ profile: 'demo', paths }, null, 2) + '\n');
  return { folder, out, file, oldPython, privatePython, outsideBase };
}

/** Every file under the folder with the hash of its bytes: equal trees mean nothing was written or removed. */
function tree(folder) {
  const files = readdirSync(folder, { recursive: true }).map(name => join(folder, name));
  const hashes = files.filter(file => statSync(file).isFile()).map(file => [file, hash(readFileSync(file))]);
  return Object.fromEntries(hashes);
}

function dryRunSwitch(control, options, seams = { preflight: () => {} }) {
  return switchOcrPython({ dryRun: true, out: control.out, ...options }, seams);
}

function refusedSwitch(control, options, expected, seams) {
  const before = tree(control.folder);
  assert.throws(() => dryRunSwitch(control, options, seams), expected);
  assert.deepEqual(tree(control.folder), before, 'a refused action writes nothing');
}

function switchCli(control, ...flags) {
  return spawnSync(process.execPath, [
    join(root, 'scripts/platform/demo-document-runtime.mjs'), 'switch-ocr-python', '--dry-run', '--out', control.out,
    ...flags,
  ], { encoding: 'utf8', timeout: 240000, windowsHide: true });
}

test('the shared OCR reader keeps the demo files as its default and reads another file as an override', context => {
  assert.equal(resolve(dirname(demoOcrFile)), resolve(demoDir), 'the default scratch rule is still the demo folder');
  assert.equal(demoOcrProfileFile, join(demoDir, 'ocr-paths-profile.json'));
  const control = ocrFixture(context);
  const override = JSON.parse(readFileSync(control.file, 'utf8'));
  assert.deepEqual(readDemoOcrPaths(join(control.out, 'absent.json')), {});
  assert.deepEqual(readDemoOcrPaths(control.file), override.paths);
  const plain = join(control.out, 'plain.json');
  writeFileSync(plain, JSON.stringify(override.paths));
  assert.throws(() => readDemoOcrPaths(plain), /explicitly demo-scoped/);
  const elsewhere = join(control.folder, 'tessdata', 'ocr-paths-profile.json');
  writeFileSync(elsewhere, JSON.stringify(override));
  assert.throws(() => readDemoOcrPaths(elsewhere), /OCR scratch must be/);
});

test('the forward switch changes only the interpreter value and saves the old bytes, all under --out', context => {
  const control = ocrFixture(context);
  const before = readFileSync(control.file);
  const treeBefore = tree(control.folder);
  const checked = [];
  const preflight = python => checked.push(python);
  const result = dryRunSwitch(control, { python: control.privatePython }, { preflight });
  const after = readFileSync(control.file);
  assert.deepEqual(checked, [control.privatePython], 'the import preflight ran once, on the new interpreter');
  assert.match(result.savedPreviousFile, savedName);
  assert.deepEqual(result, {
    restored: false, previousPython: control.oldPython, newPython: control.privatePython,
    baseInsideEnvironment: true, savedPreviousFile: result.savedPreviousFile,
    previousSha256: hash(before), newSha256: hash(after),
  });
  const expectedText = before.toString().replace(JSON.stringify(control.oldPython),
    () => JSON.stringify(control.privatePython));
  assert.equal(after.toString(), expectedText, 'every byte outside the one value is unchanged');
  const [was, is] = [before, after].map(bytes => JSON.parse(bytes.toString()));
  assert.deepEqual(is, { ...was, paths: { ...was.paths, [ocrPythonKey]: control.privatePython } });
  assert.deepEqual([Object.keys(is), Object.keys(is.paths)], [Object.keys(was), Object.keys(was.paths)]);
  const saved = join(control.out, result.savedPreviousFile);
  assert.deepEqual(tree(control.folder), { ...treeBefore, [control.file]: hash(after), [saved]: hash(before) });
  assert.deepEqual(readDemoOcrPaths(control.file), is.paths);
});

test('a missing override, an unusable interpreter and an outside base each refuse and write nothing', context => {
  const control = ocrFixture(context);
  const noConfiguration = join(control.folder, 'bare-env', 'Scripts', 'python.exe');
  mkdirSync(dirname(noConfiguration), { recursive: true });
  writeFileSync(noConfiguration, marker);
  const unavailable = /Absolute available runtime file required: ULPIN_DOCUMENT_OCR_PYTHON/;
  refusedSwitch(control, { python: 'private-env/Scripts/python.exe' }, unavailable);
  refusedSwitch(control, { python: join(control.folder, 'missing', 'python.exe') }, unavailable);
  refusedSwitch(control, { python: noConfiguration }, /requires a pyvenv\.cfg/);
  refusedSwitch(control, { python: control.oldPython }, error => {
    assert.match(error.message, /base lies outside its environment/);
    assert.ok(error.message.endsWith(realpathSync(control.outsideBase)), 'the refusal names the base');
    return true;
  });
  refusedSwitch(control, {}, /Usage/);
  refusedSwitch(control, { python: control.privatePython, restore: 'any' }, /Usage/);
  const empty = { folder: control.folder, out: join(control.folder, 'no-override') };
  mkdirSync(empty.out);
  refusedSwitch(empty, { python: control.privatePython }, /override not found: ocr-paths-profile\.json/);
});

test('a failed import preflight refuses the switch and writes nothing', context => {
  const control = ocrFixture(context);
  // The synthetic launcher cannot start, so the real preflight fails as one without the packages would.
  refusedSwitch(control, { python: control.privatePython }, /import preflight failed/, {});
});

test('a failure at the rename leaves the override as it was; the saved copy and the pending file stay', context => {
  const control = ocrFixture(context);
  const before = tree(control.folder);
  const rename = () => { throw new Error('injected rename failure'); };
  assert.throws(() => dryRunSwitch(control, { python: control.privatePython }, { rename, preflight: () => {} }),
    /injected rename failure/);
  const after = tree(control.folder);
  assert.deepEqual(Object.keys(before).filter(file => after[file] !== before[file]), [], 'no file changed');
  const added = Object.keys(after).filter(file => !(file in before));
  const saved = added.find(file => savedName.test(basename(file)));
  const pending = added.find(file => basename(file).startsWith('ocr-paths-profile.json.pending-'));
  assert.equal(added.length, 2);
  assert.equal(after[saved], before[control.file], 'the saved copy holds the old bytes');
  assert.equal(JSON.parse(readFileSync(pending, 'utf8')).paths[ocrPythonKey], control.privatePython);
});

test('--restore publishes the saved bytes after saving the current file, with a base the switch refuses', context => {
  const control = ocrFixture(context);
  const original = readFileSync(control.file);
  const forward = dryRunSwitch(control, { python: control.privatePython });
  const switched = readFileSync(control.file);
  const before = tree(control.folder);
  const result = dryRunSwitch(control, { restore: forward.savedPreviousFile },
    { preflight: () => assert.fail('a restore runs no import preflight') });
  assert.deepEqual(result, {
    restored: true, previousPython: control.privatePython, newPython: control.oldPython,
    baseInsideEnvironment: false, savedPreviousFile: result.savedPreviousFile,
    previousSha256: hash(switched), newSha256: hash(original),
  });
  assert.ok(readFileSync(control.file).equals(original), 'the restored override is byte-equal to the saved file');
  assert.match(result.savedPreviousFile, savedName);
  assert.notEqual(result.savedPreviousFile, forward.savedPreviousFile);
  const saved = join(control.out, result.savedPreviousFile);
  assert.deepEqual(tree(control.folder), { ...before, [control.file]: hash(original), [saved]: hash(switched) });
  refusedSwitch(control, { python: control.oldPython }, /base lies outside its environment/);
});

test('--restore refuses a path, another name, a missing file, another profile and a lost interpreter', context => {
  const control = ocrFixture(context);
  const stamp = millisecond => `ocr-paths-profile.previous-2026-10-10T00-00-00-00${millisecond}Z.json`;
  const [name, otherProfile, lostInterpreter, missing] = [0, 1, 2, 3].map(stamp);
  const override = JSON.parse(readFileSync(control.file, 'utf8'));
  const lostPaths = { ...override.paths, [ocrPythonKey]: join(control.folder, 'lost-env', 'Scripts', 'python.exe') };
  writeFileSync(join(control.out, name), readFileSync(control.file));
  writeFileSync(join(control.out, otherProfile), JSON.stringify({ ...override, profile: 'staging' }));
  writeFileSync(join(control.out, lostInterpreter), JSON.stringify({ ...override, paths: lostPaths }));
  const notSavedNames = [
    join(control.out, name), `./${name}`, `..\\out\\${name}`, `saved/${name}`, `${name}.pending`,
    'ocr-paths-profile.json', 'ocr-paths-profile.previous-latest.json',
  ];
  for (const restore of notSavedNames) {
    refusedSwitch(control, { restore }, /requires a saved ocr-paths-profile\.previous-<UTC>\.json file name/);
  }
  refusedSwitch(control, { restore: missing }, /override not found/);
  refusedSwitch(control, { restore: otherProfile }, /explicitly demo-scoped/);
  refusedSwitch(control, { restore: lostInterpreter }, /OCR path unavailable: ULPIN_DOCUMENT_OCR_PYTHON/);
  assert.equal(dryRunSwitch(control, { restore: name }).restored, true);
});

test('the CLI prints one JSON line for a restore and names the outside base when it refuses a switch', context => {
  const control = ocrFixture(context);
  const name = 'ocr-paths-profile.previous-2026-10-10T00-00-00-000Z.json';
  writeFileSync(join(control.out, name), readFileSync(control.file));
  const restored = switchCli(control, '--restore', name);
  assert.equal(restored.status, 0);
  assert.equal(restored.stderr, '');
  const lines = restored.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])), [
    'restored', 'previousPython', 'newPython', 'baseInsideEnvironment', 'savedPreviousFile',
    'previousSha256', 'newSha256',
  ]);
  assert.ok(!restored.stdout.includes('tesseract'), 'no other value of the file is printed');
  const refused = switchCli(control, '--python', control.oldPython);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, '');
  assert.ok(refused.stderr.includes(realpathSync(control.outsideBase)));
  assert.match(switchCli(control).stderr, /Rollback: switch-ocr-python --restore/);
});

test('the CLI switch passes the real import preflight with the project-owned interpreter, on a copy', {
  skip: process.platform !== 'win32' || !nativePython || !existsSync(nativePython), timeout: 300000,
}, context => {
  const control = ocrFixture(context);
  const child = switchCli(control, '--python', nativePython);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.restored, false);
  assert.equal(result.newPython, nativePython);
  assert.equal(result.baseInsideEnvironment, true);
  assert.equal(readDemoOcrPaths(control.file)[ocrPythonKey], nativePython);
});
