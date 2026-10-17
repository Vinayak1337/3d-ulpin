import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2';
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));
const save = (name: string, value: unknown) => {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
};
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const action = process.argv[2];
if (action === 'retry' || action === 'retry-region') {
  const pkg = read('tower3-source-import');
  const cases = await api('/cases');
  const record = cases.find((entry: { name: string; siteId: string }) => (
    entry.name === pkg.name && entry.siteId === pkg.areaId
  ));
  assert(record);
  const source = pkg.documentPins[0];
  const detail = await api(`/cases/${record.id}`);
  const nativeJob = detail.jobs.find((job: { sourceId: string; operation: string }) => (
    job.sourceId === source.sourceId && job.operation === 'document-extraction'
  ));
  assert(nativeJob);
  const prefix = `/ingestion/cases/${record.id}/sources/${source.sourceId}/documents`;
  if (action === 'retry') save('tower3-installed-native-status', await api(`${prefix}/jobs/${nativeJob.id}`));
  const region = action === 'retry-region' ? [280, 860, 960, 2580] : undefined;
  const path = `E:/BhuAayam-data/task-data/k2/tower3-ocr-${region ? 'region-' : ''}request.json`;
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({
    requestKey: randomUUID(), expectedCaseRevision: record.revision,
    expectedSourceRevision: source.sourceRevision, sourceSha256: source.sourceSha256,
    mode: 'native_only', ocrSelection: { page: 1, ...(region ? { region } : {}) },
  }, null, 2) + '\n', { flag: 'wx' });
  const receipt = await api(`${prefix}/retry`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: readFileSync(path, 'utf8') });
  save(`tower3-installed-ocr-${region ? 'region-' : ''}receipt`, receipt);
  console.log(JSON.stringify(receipt));
} else if (action === 'status' || action === 'region-status') {
  const label = action === 'region-status' ? 'region-' : '';
  const receipt = read(`tower3-installed-ocr-${label}receipt`);
  const status = await api(
    `/ingestion/cases/${receipt.caseId}/sources/${receipt.sourceId}/documents/jobs/${receipt.jobId}`,
  );
  save(`tower3-installed-ocr-${label}status`, status);
  console.log(JSON.stringify({ status: status.status, ocr: status.ocr,
    firstLines: status.ocrItems?.slice(0, 5).map((item: { text: string }) => item.text) }));
} else throw new Error('Use retry|retry-region|status|region-status; no polling or direct database access.');
