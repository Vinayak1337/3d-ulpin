import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readDemoOcrPaths } from '../../../../scripts/platform/demo-config.mjs';

const root = 'docs/evidence/gf-backend/k2f';
const debug = 'E:/BhuAayam-data/runtime/ulpin-demo/ocr-debug/k2f';
const prefix = 'E:/BhuAayam-data/runtime/ulpin-demo/tessdata-complete';
const baselineRoot = 'E:/BhuAayam-data/runtime/ulpin-demo/ocr-debug/attempt-k2d-1';
const source = 'E:/BhuAayam-data/datasets/rera-storeys/haryana-2831/haryana-2831-site-plan.pdf';
const sourceHash = '26c2d3101bfe676c8ac66f129439e066b603a555b3c55a35ba509befb707fad9';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));

function save(path, value) {
  writeFileSync(path, JSON.stringify(value) + '\n', { flag: 'wx' });
}

function environment(paths) {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.PATH = dirname(paths.ULPIN_DOCUMENT_OCR_TESSERACT) + ';' + (env.PATH ?? '');
  env.TESSDATA_PREFIX = prefix;
  env.HF_HUB_OFFLINE = '1';
  env.TRANSFORMERS_OFFLINE = '1';
  env.DOCLING_ARTIFACTS_PATH = paths.ULPIN_DOCUMENT_OCR_MODELS;
  for (const name of ['OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS']) env[name] = '2';
  env.TOKENIZERS_PARALLELISM = 'false';
  return env;
}

function verifyCopies() {
  const manifest = json(`${root}/prefix.json`);
  assert.equal(manifest.prefix, prefix);
  for (const entry of manifest.files) {
    assert.equal(hash(readFileSync(`${prefix}/${entry.file}`)), entry.sha256);
    assert.equal(hash(readFileSync(entry.source)), entry.sha256);
  }
}

function nativeCheck(paths) {
  assert(!existsSync(debug) && !existsSync(`${root}/native-tsv-check.json`), 'Native check already reserved.');
  verifyCopies();
  const prior = json(`${baselineRoot}/result.json`);
  const png = `${baselineRoot}/render.png`;
  assert.equal(hash(readFileSync(png)), prior.render.pngSha256);
  mkdirSync(debug);
  const result = spawnSync(paths.ULPIN_DOCUMENT_OCR_TESSERACT,
    [png, '-', '--tessdata-dir', prefix, 'tsv'], {
      env: environment(paths), timeout: 90000, windowsHide: true, maxBuffer: 2 * 1024 ** 2,
    });
  writeFileSync(`${debug}/native.tsv`, result.stdout ?? Buffer.alloc(0), { flag: 'wx' });
  writeFileSync(`${debug}/native.stderr.log`, result.stderr ?? Buffer.alloc(0), { flag: 'wx' });
  const header = (result.stdout ?? Buffer.alloc(0)).toString('utf8').split(/\r?\n/, 1)[0].split('\t');
  const accepted = result.status === 0 && header.includes('text');
  save(`${root}/native-tsv-check.json`, { exitCode: result.status, headerContainsText: header.includes('text'),
    accepted, outputSha256: hash(result.stdout ?? Buffer.alloc(0)), outputBytes: result.stdout?.length ?? 0,
    inputPngSha256: prior.render.pngSha256, documentTextPublished: false, timeoutSeconds: 90 });
  assert(accepted, 'Native TSV prerequisite failed; private diagnostics retained, no runner comparison.');
  console.log('Native TSV check passed; output retained privately, header contains text.');
}

function runnerArgs(paths) {
  return [resolve('scripts/usp/document-models/run_source_ocr.py'), '--source', source,
    '--expected-source-sha256', sourceHash, '--page', '1', '--region', '280', '860', '960', '2580',
    '--models', paths.ULPIN_DOCUMENT_OCR_MODELS, '--tesseract', paths.ULPIN_DOCUMENT_OCR_TESSERACT,
    '--tessdata', prefix, '--output', `${debug}/attempt-1`, '--max-seconds', '90', '--max-items', '64'];
}

function verifyUnchangedRunner(baseline) {
  assert.equal(hash(readFileSync(source)), sourceHash);
  assert.equal(hash(readFileSync('scripts/usp/document-models/run_source_ocr.py')), baseline.code.runnerSha256);
  const adapter = 'services/geo/geo/usp_document_candidates/docling_tesseract.py';
  assert.equal(hash(readFileSync(adapter)), baseline.code.adapterSha256);
}

function observations(receipt, result, exitCode) {
  const lines = (result.items ?? []).flatMap(item => item.text.split(/\r?\n/)).filter(line => line.trim());
  const succeeded = exitCode === 0 && ['complete', 'partial'].includes(receipt.status);
  const value = { status: receipt.status, toolStatus: result.toolStatus, outputStatus: result.outputStatus,
    supervisorExitCode: exitCode, workerExitCode: receipt.worker.exitCode, lineCount: lines.length,
    itemCount: result.items?.length ?? 0, elapsedSeconds: receipt.worker.elapsedSeconds,
    peakObservedRssBytes: receipt.worker.peakObservedRssBytes, peakJobPrivateBytes: receipt.worker.peakJobPrivateBytes,
    stopReason: receipt.worker.stopReason, resultSha256: receipt.result.sha256,
    workerLogSha256: receipt.worker.logSha256, renderSha256: result.render?.pngSha256 ?? null };
  if (succeeded) {
    value.recognised = { 'G+41': lines.some(line => line.includes('G+41')),
      'G+42': lines.some(line => line.includes('G+42')), '81': lines.some(line => /\b81\b/.test(line)) };
    value.matchPolicy = 'G+41/G+42 exact case-sensitive literals; 81 standalone word; not verified facts';
  } else {
    const log = readFileSync(`${debug}/attempt-1/worker.log`, 'utf8');
    const allowed = ['KeyError', 'ValueError', 'RuntimeError', 'OSError', 'TypeError', 'CalledProcessError'];
    value.failureSignature = { class: allowed.find(name => log.includes(`${name}:`)) ?? 'UnknownWorkerFailure',
      repeatedTextKey: log.includes("KeyError: 'text'"), message: 'Sensitive details retained privately' };
  }
  return value;
}

function verifyReceipt(receipt, baseline) {
  assert.equal(receipt.source.sha256, sourceHash);
  assert.deepEqual(receipt.source.region, baseline.source.region);
  assert.equal(receipt.source.page, baseline.source.page);
  assert.deepEqual(receipt.code, baseline.code);
  assert.deepEqual(receipt.packages, baseline.packages);
  assert.deepEqual(receipt.limits, baseline.limits);
  assert.deepEqual(receipt.assets.modelFiles, baseline.assets.modelFiles);
  assert.deepEqual(receipt.assets.engTraineddata, baseline.assets.engTraineddata);
  assert.deepEqual(receipt.assets.tesseract, baseline.assets.tesseract);
  verifyCopies();
}

function retainComparison(receipt, result, baseline, exitCode) {
  const knownIssues = ['item_limit_reached', 'text_byte_limit_reached', 'no_ocr_text_emitted'];
  save(`${root}/ocr-comparison.json`, { hypothesis: 'Complete tessdata assets repair the missing TSV text column',
    baseline: { task: 'K2d', status: 'failed', class: 'KeyError', key: 'text', lineCount: 0,
      elapsedSeconds: baseline.worker.elapsedSeconds, peakJobPrivateBytes: baseline.worker.peakJobPrivateBytes },
    changedVariable: 'tessdata prefix only', attempts: 1, sourceSha256: sourceHash, page: 1,
    region: [280, 860, 960, 2580], limits: baseline.limits, codePackagesAndOtherAssetsUnchanged: true,
    osdAvailable: receipt.assets.osdAvailable, ...observations(receipt, result, exitCode),
    limitations: knownIssues.filter(issue => result.issues?.includes(issue)),
    documentTextPublished: false, registryWrites: 0, reviewedFacts: false, globalOcrConfigurationChanged: false });
}

function compare(paths) {
  assert.equal(json(`${root}/native-tsv-check.json`).accepted, true);
  assert(!existsSync(`${debug}/runner-reservation.json`) && !existsSync(`${root}/ocr-comparison.json`),
    'One comparison only; previous reservation/result must not be overwritten.');
  verifyCopies();
  const baseline = json(`${baselineRoot}/receipt.json`);
  verifyUnchangedRunner(baseline);
  save(`${debug}/runner-reservation.json`, { startedAt: new Date().toISOString(), attemptsAllowed: 1 });
  const processResult = spawnSync(paths.ULPIN_DOCUMENT_OCR_PYTHON, runnerArgs(paths), {
    cwd: process.cwd(), env: environment(paths), timeout: 110000, windowsHide: true, maxBuffer: 2 * 1024 ** 2,
  });
  writeFileSync(`${debug}/supervisor.log`, Buffer.concat([
    processResult.stdout ?? Buffer.alloc(0), processResult.stderr ?? Buffer.alloc(0),
  ]), { flag: 'wx' });
  const receipt = json(`${debug}/attempt-1/receipt.json`);
  const result = json(`${debug}/attempt-1/result.json`);
  verifyReceipt(receipt, baseline);
  assert.equal(result.render?.pngSha256, json(`${baselineRoot}/result.json`).render.pngSha256);
  retainComparison(receipt, result, baseline, processResult.status);
  console.log('One bounded Tower comparison finished; sanitized metrics retained, document text remains private.');
  process.exitCode = processResult.status ?? 1;
}

const action = process.argv[2];
assert(process.argv.length === 3 && ['native', 'compare'].includes(action), 'Choose native or compare once.');
const paths = readDemoOcrPaths();
if (action === 'native') nativeCheck(paths);
if (action === 'compare') compare(paths);
