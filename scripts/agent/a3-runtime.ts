import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CaseIngestionControlSchema } from '../../packages/contracts/src/usp/index';
import { developmentManifest, digest, sourceTables } from './t1-sources';
import { saveNew } from './t1-profiles';

const BASE = 'http://127.0.0.1:3194';
const output = `E:/BhuAayam-data/task-data/a3/runtime-${randomUUID()}`;
const requests: { method: string; path: string; status: number; response: unknown }[] = [];

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { text };
  }
  requests.push({ method: init?.method ?? 'GET', path, status: response.status, response: body });
  return { status: response.status, body };
}

async function readFrames(caseId: string) {
  const response = await fetch(`${BASE}/api/v1/ingestion/cases/${caseId}/events?cursor=0`, {
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok || !response.body) return { status: response.status, text: '', controls: 0 };
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      text += decoder.decode(part.value, { stream: true });
    }
  } catch (error) {
    if (!(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) throw error;
  }
  const frames = text.split('\n\n').filter(frame => frame.includes('data: '));
  let controls = 0;
  for (const frame of frames) {
    const event = frame.split('\n').find(line => line.startsWith('event: '));
    if (event !== 'event: ready' && event !== 'event: resync') continue;
    const data = frame.split('\n').find(line => line.startsWith('data: '));
    assert(data);
    CaseIngestionControlSchema.parse(JSON.parse(data.slice(6)));
    controls++;
  }
  return { status: response.status, text, controls };
}

function rawSource() {
  const asset = developmentManifest().assets.find(entry => entry.id === 'mi-d10-01.csv');
  assert(asset);
  sourceTables(asset); // Exact manifest authorization and source integrity before file access.
  return { asset, bytes: readFileSync(asset.original.externalPath) };
}

function retainEvidence(directory: string) {
  assert(directory.startsWith('E:/BhuAayam-data/task-data/a3/runtime-'));
  const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
  const evidence = { output: directory, caseId: receipt.caseId, sourceSha256: receipt.source.sha256,
    httpStatus: receipt.admission.status, receiptSha256: digest(join(directory, 'receipt.json')),
    sseStatus: receipt.sseStatus, framesSha256: digest(join(directory, 'sse-frames.json')),
    validatedControlFrames: receipt.validatedControlFrames, mappingChunkFrames: 0,
    stopReason: receipt.stopReason, unavailableRoute: receipt.unavailableRoute,
    registryWrites: 0, approvals: 0, providerCalls: 0 };
  writeFileSync('docs/evidence/gf-agent/a3/runtime.json', JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(evidence));
}

async function main() {
  if (process.argv[2] === '--receipt') return retainEvidence(process.argv[3]);
  const source = rawSource();
  const health = await request('/api/v1/health');
  assert.equal(health.status, 200);
  const created = await request('/api/v1/cases', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: 'A3 public development tabular intake',
      description: 'Immutable OpenCity aggregate CSV; test_only, permission unconfirmed; no officer approval.',
    }) });
  assert.equal(created.status, 201);
  const caseId = (created.body as { id: string }).id;
  const stream = readFrames(caseId);
  const form = new FormData();
  form.set('file', new Blob([source.bytes]), source.asset.id);
  form.set('format', 'csv');
  form.set('requestKey', randomUUID());
  form.set('expectedWorkspaceRevision', String((created.body as { revision: number }).revision));
  const upload = await request(`/api/v1/ingestion/cases/${caseId}/sources`, { method: 'POST', body: form });
  assert.equal(upload.status, 422, 'Unexpected admission: stop and inspect the public contract before continuing.');
  const frames = await stream;
  saveNew(join(output, 'sse-frames.json'), frames);
  saveNew(join(output, 'http.json'), requests);
  const result = { task: 'A3', baseUrl: BASE, output, caseId,
    source: { id: source.asset.id, sha256: digest(source.asset.original.externalPath), bytes: source.bytes.length },
    admission: upload, sseStatus: frames.status, validatedControlFrames: frames.controls,
    mappingChunkFrames: 0, teacherCallCurve: null,
    stopReason: 'Manual intake accepts GeoJSON only; no generic small tabular receipt and v2 recipe route.',
    unavailableRoute: 'POST /api/v1/ingestion/cases/{caseId}/sources (format csv)',
    registryWrites: 0, approvals: 0, providerCalls: 0,
    limitation: 'Stopped at upload; no chunk job, questions, review/commit or second-file curve was run.' };
  saveNew(join(output, 'receipt.json'), result);
  retainEvidence(output);
}

main();
