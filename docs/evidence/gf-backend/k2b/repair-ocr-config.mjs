import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readDemoOcrPaths, demoOcrFile } from '../../../../scripts/platform/demo-config.mjs';

const source = 'E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract';
const prefix = 'E:/BhuAayam-data/task-data/k2/tesseract-runtime-k2b';
const root = 'E:/BhuAayam-data/task-data/k2/mamba-runtime-k2b';
const evidence = 'docs/evidence/gf-backend/k2b';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function nativeEnvironment() {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}
function prepareNativeDependencies() {
  assert(!existsSync(prefix) && !existsSync(root), 'New runtime dependency prefixes must not replace existing files.');
  const result = spawnSync(`${source}/Library/bin/micromamba.exe`, [
    '--no-rc', '--no-env', 'create', '--yes', '--root-prefix', root, '--prefix', prefix,
    '--override-channels', '--channel', 'conda-forge', 'libcurl',
  ], { env: nativeEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 2 * 1024 ** 2 });
  writeFileSync('E:/BhuAayam-data/task-data/k2/ocr-debug/libcurl-acquisition.log',
    result.stdout + result.stderr, { flag: 'wx' });
  assert.equal(result.status, 0, 'Official isolated libcurl dependency acquisition failed; see private log.');
  const destination = `${prefix}/Library/bin`;
  const copied = [];
  for (const name of readdirSync(`${source}/tesseract/Library/bin`)) {
    if (existsSync(join(destination, name))) continue;
    copyFileSync(`${source}/tesseract/Library/bin/${name}`, join(destination, name));
    copied.push({ name, sha256: hash(readFileSync(join(destination, name))) });
  }
  const packages = readdirSync(`${prefix}/conda-meta`).filter(name => name.endsWith('.json')).map(name => {
    const pkg = JSON.parse(readFileSync(`${prefix}/conda-meta/${name}`, 'utf8'));
    return { name: pkg.name, version: pkg.version, build: pkg.build, url: pkg.url,
      sha256: pkg.sha256, licence: pkg.license };
  });
  writeFileSync(`${evidence}/native-dependencies.json`, JSON.stringify({
    cause: 'Tesseract PE imports libcurl.dll, absent from the retained environment; STATUS_DLL_NOT_FOUND',
    operation: 'new isolated conda-forge dependency prefix plus unchanged retained binaries',
    retainedEnvironmentModified: false, prefix, packages, copiedFiles: copied.length,
    copiedManifestSha256: hash(Buffer.from(JSON.stringify(copied))),
  }, null, 2) + '\n');
  writeFileSync('E:/BhuAayam-data/task-data/k2/ocr-debug/copied-native-files.json',
    JSON.stringify(copied, null, 2) + '\n', { flag: 'wx' });
}
function activatePaths() {
  const paths = readDemoOcrPaths();
  const executable = `${prefix}/Library/bin/tesseract.exe`;
  assert.equal(hash(readFileSync(executable)),
    'ea22b4adaa35ba9f449aaff9f111c97550ecd2220510cdce60c1503465a38357');
  const env = nativeEnvironment();
  env.PATH = `${prefix}/Library/bin;` + (env.PATH ?? '');
  env.TESSDATA_PREFIX = 'E:/BhuAayam-data/runtime/ulpin-demo/tessdata';
  const probe = spawnSync(executable, ['--list-langs'], {
    env, timeout: 10000, windowsHide: true, encoding: 'utf8',
  });
  assert.equal(probe.status, 0, 'Repaired native closure must execute before changing active configuration.');
  assert.match(probe.stdout, /eng/);
  assert.match(probe.stdout, /hin/);
  const backup = 'E:/BhuAayam-data/task-data/k2/ocr-debug/ocr-paths-before-k2b.json';
  copyFileSync(demoOcrFile, backup);
  const next = { ...paths, ULPIN_DOCUMENT_OCR_TESSERACT: executable,
    ULPIN_DOCUMENT_OCR_TESSDATA: env.TESSDATA_PREFIX };
  // Explicitly authorised non-secret path configuration only; retained binaries/data are never overwritten.
  writeFileSync(demoOcrFile, JSON.stringify(next, null, 2) + '\n');
  readDemoOcrPaths();
  writeFileSync(`${evidence}/ocr-config.json`, JSON.stringify({
    pathFile: demoOcrFile, backup, paths: next, tesseractListLanguagesExit: probe.status,
    languages: probe.stdout.trim().split(/\r?\n/), hindiExecutionClaimed: false,
  }, null, 2) + '\n');
}

if (process.argv[2] === 'prepare') prepareNativeDependencies();
else if (process.argv[2] === 'activate') activatePaths();
else throw new Error('Use prepare or activate; no retained environment installation.');
