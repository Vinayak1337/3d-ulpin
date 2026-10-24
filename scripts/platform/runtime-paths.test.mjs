// Everything here is made up on a temporary folder: stand-in interpreters, seed, models and Tesseract files.
// No runtime's own folder is opened, and the demo's path files are replaced by the second argument.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  readDemoOcrPaths, readDemoTabularPaths, runtimeDefinition, writeRehearsalPaths,
} from './demo-config.mjs';

/** The shape the demo's two readers return, pointing at stand-ins. The demo-side folders must never be reused. */
function madeUpShared(folder) {
  const at = (...parts) => join(folder, 'shared', ...parts);
  const file = (path, bytes = 'made-up') => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, bytes);
  };
  for (const directory of ['demo-learning', 'demo-ocr-scratch']) mkdirSync(at(directory), { recursive: true });
  file(at('python', 'python.exe'));
  file(at('tesseract', 'tesseract.exe'));
  file(at('tessdata', 'eng.traineddata'));
  file(at('models', 'docling-project--docling-layout-heron', 'model.safetensors'));
  file(at('seed', 'model.npz'), 'made-up model bytes');
  const modelSha256 = createHash('sha256').update('made-up model bytes').digest('hex');
  file(at('seed', 'manifest.json'), JSON.stringify({ version: 'v43', modelSha256 }));
  return {
    tabular: { ULPIN_PROFILE_PYTHON: at('python', 'python.exe'), ULPIN_TABULAR_LEARNING_DIR: at('demo-learning'),
      ULPIN_TABULAR_LEARNER_SEED: at('seed') },
    ocr: { ULPIN_DOCUMENT_OCR_PYTHON: at('python', 'python.exe'), ULPIN_DOCUMENT_OCR_MODELS: at('models'),
      ULPIN_DOCUMENT_OCR_TESSERACT: at('tesseract', 'tesseract.exe'), ULPIN_DOCUMENT_OCR_TESSDATA: at('tessdata'),
      ULPIN_DOCUMENT_OCR_SCRATCH: at('demo-ocr-scratch') },
  };
}
const temporary = () => mkdtempSync(join(tmpdir(), 'runtime-paths-'));
const inside = (parent, path) => /^[a-z][a-z-]+$/.test(relative(parent, path));
const json = file => JSON.parse(readFileSync(file, 'utf8'));

test('create\'s writer makes a rehearsal\'s learning folder and OCR scratch and writes its two path files', () => {
  const folder = temporary();
  const shared = madeUpShared(folder);
  const runtime = runtimeDefinition('ulpin-reh-01', folder);
  assert.deepEqual(writeRehearsalPaths(runtime, shared), ['tabular-paths.json', 'ocr-paths.json']);
  const tabular = json(runtime.tabularFile), ocr = json(runtime.ocrFile);
  assert.deepEqual(tabular, { ...shared.tabular, ULPIN_TABULAR_LEARNING_DIR: join(runtime.dir, 'learning') });
  assert.deepEqual(ocr, { ...shared.ocr, ULPIN_DOCUMENT_OCR_SCRATCH: join(runtime.dir, 'ocr-scratch') });
  for (const own of [tabular.ULPIN_TABULAR_LEARNING_DIR, ocr.ULPIN_DOCUMENT_OCR_SCRATCH]) {
    assert.ok(statSync(own).isDirectory() && inside(runtime.dir, own), own);
    assert.deepEqual(readdirSync(own), []);
  }
  // The same readers the launcher uses accept both files for this runtime.
  assert.deepEqual(readDemoTabularPaths(runtime.tabularFile, runtime.dir), tabular);
  assert.deepEqual(readDemoOcrPaths(runtime.ocrFile, runtime.ocrProfileFile), ocr);
  const made = ['learning', 'ocr-paths.json', 'ocr-scratch', 'tabular-paths.json'];
  assert.deepEqual(readdirSync(runtime.dir).sort(), made);
});

test('the demo-side learning folder and scratch are never written into a rehearsal\'s files', () => {
  const folder = temporary();
  const shared = madeUpShared(folder);
  const runtime = runtimeDefinition('ulpin-reh-01', folder);
  writeRehearsalPaths(runtime, shared);
  const written = readFileSync(runtime.tabularFile, 'utf8') + readFileSync(runtime.ocrFile, 'utf8');
  for (const demoSide of [shared.tabular.ULPIN_TABULAR_LEARNING_DIR, shared.ocr.ULPIN_DOCUMENT_OCR_SCRATCH]) {
    assert.equal(written.includes(JSON.stringify(demoSide).slice(1, -1)), false);
    assert.deepEqual(readdirSync(demoSide), []);
  }
});

test('a resumed create writes nothing twice, and two rehearsals get separate folders', () => {
  const folder = temporary();
  const shared = madeUpShared(folder);
  const [first, second] = ['ulpin-reh-01', 'ulpin-reh-02'].map(name => runtimeDefinition(name, folder));
  writeRehearsalPaths(first, shared);
  const before = [first.tabularFile, first.ocrFile].map(file => readFileSync(file, 'hex'));
  assert.deepEqual(writeRehearsalPaths(first, shared), []);
  assert.deepEqual([first.tabularFile, first.ocrFile].map(file => readFileSync(file, 'hex')), before);
  assert.deepEqual(writeRehearsalPaths(second, shared), ['tabular-paths.json', 'ocr-paths.json']);
  const learning = runtime => json(runtime.tabularFile).ULPIN_TABULAR_LEARNING_DIR;
  assert.notEqual(learning(second), learning(first));
  assert.ok(inside(second.dir, json(second.ocrFile).ULPIN_DOCUMENT_OCR_SCRATCH));
  assert.deepEqual([first.tabularFile, first.ocrFile].map(file => readFileSync(file, 'hex')), before);
});

test('a rehearsal has local OCR exactly when the demo does', () => {
  const folder = temporary();
  const runtime = runtimeDefinition('ulpin-reh-01', folder);
  assert.deepEqual(writeRehearsalPaths(runtime, { ...madeUpShared(folder), ocr: {} }), ['tabular-paths.json']);
  assert.deepEqual(readdirSync(runtime.dir).sort(), ['learning', 'tabular-paths.json']);
  assert.deepEqual(readDemoOcrPaths(runtime.ocrFile, runtime.ocrProfileFile), {});
});

test('the writer is refused for the demo and for an unknown name, and then writes nothing', () => {
  const folder = temporary();
  const shared = madeUpShared(folder);
  assert.throws(() => writeRehearsalPaths(runtimeDefinition('ulpin-demo', folder), shared),
    /^Error: Path files are written for a rehearsal only; the demo keeps its own\.$/);
  assert.throws(() => writeRehearsalPaths('ulpin-prod', shared), /Unknown runtime name/);
  assert.deepEqual(readdirSync(folder), ['shared']);
});

test('a path file that fails its reader stops create with the reader\'s message', () => {
  const folder = temporary();
  const shared = madeUpShared(folder);
  writeFileSync(join(shared.tabular.ULPIN_TABULAR_LEARNER_SEED, 'manifest.json'), '{"version":"v42"}');
  const runtime = runtimeDefinition('ulpin-reh-01', folder);
  assert.throws(() => writeRehearsalPaths(runtime, shared), /seed must be the intact A4 v43 model/);
});
