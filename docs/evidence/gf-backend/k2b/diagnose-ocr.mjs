import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readDemoOcrPaths } from '../../../../scripts/platform/demo-config.mjs';

const debug = 'E:/BhuAayam-data/task-data/k2/ocr-debug';
const output = `${debug}/attempt-k2b-1`;
const importsOnly = process.argv[2] === 'imports';
const capture = process.argv[2] === 'capture';
if (!importsOnly && !capture && existsSync(output)) {
  throw new Error('Direct diagnostic already exists; no repeated attempt.');
}
mkdirSync(debug, { recursive: true });
const paths = readDemoOcrPaths();
const env = {};
for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[name]) env[name] = process.env[name];
}
env.PATH = dirname(paths.ULPIN_DOCUMENT_OCR_TESSERACT) + ';' + (env.PATH ?? '');
env.TESSDATA_PREFIX = paths.ULPIN_DOCUMENT_OCR_TESSDATA;
env.HF_HUB_OFFLINE = '1';
env.TRANSFORMERS_OFFLINE = '1';
env.DOCLING_ARTIFACTS_PATH = paths.ULPIN_DOCUMENT_OCR_MODELS;
env.OMP_NUM_THREADS = '2';
env.MKL_NUM_THREADS = '2';
env.OPENBLAS_NUM_THREADS = '2';
env.TOKENIZERS_PARALLELISM = 'false';
const runnerArgs = [resolve('scripts/usp/document-models/run_source_ocr.py'),
  '--source', 'E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-site-plan.pdf',
  '--expected-source-sha256', '26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9',
  '--page', '1', '--region', '280', '860', '960', '2580', '--models', paths.ULPIN_DOCUMENT_OCR_MODELS,
  '--tesseract', paths.ULPIN_DOCUMENT_OCR_TESSERACT, '--tessdata', paths.ULPIN_DOCUMENT_OCR_TESSDATA,
  '--output', output, '--max-seconds', '90', '--max-items', '64'];
let args = runnerArgs;
if (importsOnly) args = [resolve('docs/evidence/gf-backend/k2b/inspect-ocr-imports.py')];
if (capture) {
  args = [resolve('docs/evidence/gf-backend/k2b/capture-ocr-worker.py'), ...runnerArgs.slice(1)];
  args[args.indexOf('--output') + 1] = `${debug}/capture-k2b`;
}
const result = spawnSync(paths.ULPIN_DOCUMENT_OCR_PYTHON, args, {
  cwd: process.cwd(), env, timeout: 110000, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 ** 2,
});
let label = 'supervisor';
if (importsOnly) label = 'imports';
if (capture) label = 'capture';
const logPath = `${debug}/${label}-k2b-${capture ? '2' : '1'}.log`;
writeFileSync(logPath,
  result.stdout + result.stderr, { flag: 'wx' });
console.log(JSON.stringify({ supervisorExit: result.status, output, logsRetained: true,
  receiptAvailable: existsSync(`${output}/receipt.json`), error: result.error?.code ?? null }));
if (existsSync(`${output}/worker.log`)) {
  const log = readFileSync(`${output}/worker.log`, 'utf8');
  console.log(log.slice(-7000));
}
process.exitCode = result.status ?? 1;
