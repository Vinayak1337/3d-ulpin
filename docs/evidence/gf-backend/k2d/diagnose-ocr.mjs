import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readDemoOcrPaths } from '../../../../scripts/platform/demo-config.mjs';

const paths = readDemoOcrPaths();
const output = 'E:/BhuAayam-data/runtime/ulpin-demo/ocr-debug/attempt-k2d-1';
const evidence = 'docs/evidence/gf-backend/k2d/ocr-diagnosis-attempt.json';
assert(!existsSync(output) && !existsSync(evidence), 'One same-region diagnosis only; prior attempt preserved.');
mkdirSync(dirname(output), { recursive: true });
const env = {};
for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[name]) env[name] = process.env[name];
}
env.PATH = dirname(paths.ULPIN_DOCUMENT_OCR_TESSERACT) + ';' + (env.PATH ?? '');
env.TESSDATA_PREFIX = paths.ULPIN_DOCUMENT_OCR_TESSDATA;
env.HF_HUB_OFFLINE = '1';
env.TRANSFORMERS_OFFLINE = '1';
env.DOCLING_ARTIFACTS_PATH = paths.ULPIN_DOCUMENT_OCR_MODELS;
for (const name of ['OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS']) env[name] = '2';
env.TOKENIZERS_PARALLELISM = 'false';
const args = [resolve('scripts/usp/document-models/run_source_ocr.py'),
  '--source', 'E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-site-plan.pdf',
  '--expected-source-sha256', '26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9',
  '--page', '1', '--region', '280', '860', '960', '2580', '--models', paths.ULPIN_DOCUMENT_OCR_MODELS,
  '--tesseract', paths.ULPIN_DOCUMENT_OCR_TESSERACT, '--tessdata', paths.ULPIN_DOCUMENT_OCR_TESSDATA,
  '--output', output, '--max-seconds', '90', '--max-items', '64'];
const result = spawnSync(paths.ULPIN_DOCUMENT_OCR_PYTHON, args, {
  cwd: process.cwd(), env, timeout: 110000, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 ** 2,
});
writeFileSync(`${output}/supervisor.log`, result.stdout + result.stderr, { flag: 'wx' });
const worker = readFileSync(`${output}/worker.log`);
const receipt = JSON.parse(readFileSync(`${output}/receipt.json`, 'utf8'));
writeFileSync(evidence, JSON.stringify({ supervisorExitCode: result.status, hypothesis: 'Runner code/config defect',
  sourceSha256: receipt.source.sha256, page: 1, region: [280, 860, 960, 2580],
  elapsedSeconds: receipt.worker.elapsedSeconds, workerExitCode: receipt.worker.exitCode,
  stopReason: receipt.worker.stopReason, privateTracePreserved: true,
  privateLogSha256: createHash('sha256').update(worker).digest('hex'),
  limits: { seconds: 90, privateBytes: 6 * 1024 ** 3, logBytes: 2 * 1024 ** 2 },
  baseline: 'K2c KeyError and no OCR lines', success: 'Identify failing code key/line, not OCR accuracy' }) + '\n',
{ flag: 'wx' });
console.log('Bounded same-region diagnosis captured privately; traceback not emitted to Git or tool output.');
process.exitCode = result.status ?? 1;
