import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readDemoOcrPaths } from '../../../../scripts/platform/demo-config.mjs';

const target = 'E:/BhuAayam-data/runtime/ulpin-demo/tessdata';
const paths = readDemoOcrPaths();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(url, maxBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error',
    headers: { 'user-agent': '3d-ulpin-local-runtime-acquisition' } });
  assert(response.ok, `Official asset retrieval failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert(bytes.byteLength <= maxBytes);
  return bytes;
}

assert(!existsSync(target), 'New tessdata directory already exists; do not replace retained assets.');
const api = 'https://api.github.com/repos/tesseract-ocr/tessdata_fast/commits/HEAD';
const commit = JSON.parse(new TextDecoder().decode(await get(api, 1024 * 1024))).sha;
assert.match(commit, /^[a-f0-9]{40}$/);
const origin = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${commit}`;
const hindi = await get(`${origin}/hin.traineddata`, 8 * 1024 * 1024);
const licence = await get(`${origin}/LICENSE`, 100 * 1024);
assert.match(new TextDecoder().decode(licence), /Apache License/);
const english = readFileSync(`${paths.ULPIN_DOCUMENT_OCR_TESSDATA}/eng.traineddata`);
assert.equal(hash(english), '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2');
mkdirSync(target);
for (const [name, bytes] of [['hin.traineddata', hindi], ['eng.traineddata', english], ['LICENSE', licence]]) {
  writeFileSync(`${target}/${name}`, bytes, { flag: 'wx' });
}
const evidence = { issuer: 'tesseract-ocr/tessdata_fast', commit, acquiredAt: new Date().toISOString(),
  licence: 'Apache-2.0', licenceUrl: `${origin}/LICENSE`, licenceSha256: hash(licence), directory: target,
  languages: [
    { language: 'hin', url: `${origin}/hin.traineddata`, sha256: hash(hindi), bytes: hindi.byteLength },
    { language: 'eng', operation: 'unchanged copy of retained pinned asset', sha256: hash(english) },
  ], qualification: 'assets available; runner currently configured for English only, not Hindi execution' };
writeFileSync('docs/evidence/gf-backend/k2b/tessdata-acquisition.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({
  commit, hindiSha256: hash(hindi), languages: 'eng+hin', retainedEnvironmentModified: false,
}));
