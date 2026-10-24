// K9c rehearsal: the roll-out order on a synthetic override in a fresh folder. Dry runs only; no runtime file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [out, receipt] = process.argv.slice(2).map(value => resolve(value));
const retained = 'E:/BhuAayam-data/task-data/desktop-ai04f-docling-tesseract';
const oldPython = `${retained}/venv/Scripts/python.exe`;
const newPython = 'E:/BhuAayam-data/ml/venv-demo-documents-20261010/Scripts/python.exe';
const builder = resolve('scripts/platform/demo-document-runtime.mjs');
const override = join(out, 'ocr-paths-profile.json');
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The file is synthetic; its values name retained assets outside the runtime folder, which are only inspected. */
function writeSyntheticOverride() {
  mkdirSync(join(out, 'ocr-scratch'), { recursive: true });
  const paths = {
    ULPIN_DOCUMENT_OCR_PYTHON: oldPython, ULPIN_DOCUMENT_OCR_MODELS: `${retained}/models`,
    ULPIN_DOCUMENT_OCR_TESSERACT: 'E:/BhuAayam-data/task-data/k2/tesseract-runtime-k2b/Library/bin/tesseract.exe',
    ULPIN_DOCUMENT_OCR_TESSDATA: `${retained}/tesseract/share/tessdata`,
    ULPIN_DOCUMENT_OCR_SCRATCH: join(out, 'ocr-scratch'),
  };
  writeFileSync(override, JSON.stringify({ profile: 'demo', paths }) + '\n', { flag: 'wx' });
}

function run(...arguments_) {
  const child = spawnSync(process.execPath, [builder, ...arguments_, '--dry-run', '--out', out], {
    encoding: 'utf8', timeout: 400000, windowsHide: true,
  });
  return { exit: child.status, stdout: child.stdout.trim().split(/\r?\n/), stderr: child.stderr.trim() };
}

writeSyntheticOverride();
const original = sha256(override);
const forward = run('switch-ocr-python', '--python', newPython);
const switched = JSON.parse(forward.stdout[0]);
const build = run('build', '--python', newPython);
const restore = run('switch-ocr-python', '--restore', switched.savedPreviousFile);
const restored = JSON.parse(restore.stdout[0]);
const refused = run('switch-ocr-python', '--python', oldPython);
assert.deepEqual([forward.exit, build.exit, restore.exit, refused.exit], [0, 0, 0, 1]);
assert.equal(switched.previousSha256, original);
assert.equal(restored.newSha256, original);
assert.equal(sha256(override), original, 'the restored copy equals the first bytes');
assert.equal(restored.baseInsideEnvironment, false);
writeFileSync(receipt, JSON.stringify({ original, forward, build, restore, refused }, null, 2) + '\n', { flag: 'wx' });
console.log(`rehearsal passed: switch ${forward.exit}, build ${build.exit}, restore ${restore.exit}, `
  + `switch to the outside-base interpreter refused ${refused.exit}`);
