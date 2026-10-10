import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const base = 'http://127.0.0.1:3194/api/v1';
const evidence = 'docs/evidence/gf-backend/k2b';
const save = (name: string, value: unknown) => {
  writeFileSync(`${evidence}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
};
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}
async function retryOnce() {
  assert(!existsSync(`${evidence}/ocr-receipt.json`), 'Region retry already exists; read its status instead.');
  const pkg = JSON.parse(readFileSync('docs/evidence/gf-backend/k2/tower3-source-commit.json', 'utf8'));
  const cases = await api('/cases');
  const record = cases.find((entry: { name: string; siteId: string }) => (
    entry.name === pkg.name && entry.siteId === pkg.areaId
  ));
  assert(record);
  const source = pkg.documentPins[0];
  const request = { requestKey: randomUUID(), expectedCaseRevision: record.revision,
    expectedSourceRevision: source.sourceRevision, sourceSha256: source.sourceSha256,
    mode: 'native_only', ocrSelection: { page: 1, region: [280, 860, 960, 2580] } };
  save('ocr-request', request);
  const receipt = await api(`/ingestion/cases/${record.id}/sources/${source.sourceId}/documents/retry`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  });
  save('ocr-receipt', receipt);
  console.log(JSON.stringify({ jobId: receipt.jobId, status: receipt.status }));
}
async function readStatus() {
  const receipt = JSON.parse(readFileSync(`${evidence}/ocr-receipt.json`, 'utf8'));
  const status = await api(
    `/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/documents/jobs/${receipt.jobId}`,
  );
  // Complete response stays private; only status, bounded observations and worker pins are committed.
  const firstLines = status.ocrItems?.slice(0, 5).map((item: { text: string }) => item.text) ?? [];
  save('ocr-result', { jobId: receipt.jobId, status: status.status, sourceSha256: receipt.sourceSha256,
    ocr: status.ocr, firstLines, nativeStatus: status.native?.status,
    qualification: 'OCR observations only; no reviewed field, accuracy, level schedule or Hindi execution claim' });
  console.log(JSON.stringify({ status: status.status, issues: status.ocr?.issues, firstLines }));
}

if (process.argv[2] === 'retry') await retryOnce();
else if (process.argv[2] === 'status') await readStatus();
else throw new Error('Use retry or status; one API retry and no polling.');
