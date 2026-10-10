// Temporary path/profile files only. Never open real demo configuration or change a native dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDemoDocumentRuntime } from './demo-config.mjs';
import { buildDocumentRuntime, documentRuntimeReport } from './demo-document-runtime.mjs';
import { root } from './runtime.mjs';

const marker = 'private-path-marker';
const pythonKey = 'ULPIN_DOCUMENT_PAGES_PYTHON';
const scratchKey = 'ULPIN_DOCUMENT_PAGES_SCRATCH';
const profileKey = 'ULPIN_PACKET_REGIONS_PROFILE';
const hashKey = 'ULPIN_PACKET_REGIONS_PROFILE_SHA256';
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
  assert.throws(() => buildDocumentRuntime(), /requires the demo serving checkout/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true }), /--out/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true, out: marker }), /absolute temporary folder/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true, out: root }), /outside every checkout/);
  assert.throws(() => buildDocumentRuntime({ dryRun: true, out: 'E:/BhuAayam-data/runtime/ulpin-demo' }),
    /not the shared runtime/);
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
