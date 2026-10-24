// R1 live driver: propose-only tabular imports and count reads on the pinned demo.
// The A3b/A3d runtime helpers are script-local and write under their own task roots, so this driver repeats their
// request sequence with the same contract schemas and retains every exchange under the R1 root instead.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AnySourceProfileSchema, CaseIngestionEventSchema, ChunkMappingChunkResponseSchema, ChunkMappingStatusSchema,
  TabularSourceProfileSchema, type TabularSourceProfile } from '../../packages/contracts/src/usp';
import { D1C_DERIVATIVES, developmentManifest } from './t1-sources';

const base = 'http://127.0.0.1:3194';
const root = 'E:/BhuAayam-data/task-data/r1';
const selection = { format: 'csv' as const, sheet: 'csv', table: null, headerRows: [1] };
type Exchange = { status: number; body: any };
type Upload = { name: string; bytes: Buffer<ArrayBuffer> };
type RecordedDerivative = { family: string; originalSha256: string; developmentCopy: string; sha256: string;
  bytes: number };

function save(directory: string, name: string, value: unknown) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

async function exchange(directory: string, name: string, path: string, input?: unknown): Promise<Exchange> {
  const init: RequestInit = { signal: AbortSignal.timeout(30000) };
  if (input !== undefined) {
    init.method = 'POST';
    init.body = JSON.stringify(input);
    init.headers = { 'Content-Type': 'application/json' };
  }
  const response = await fetch(base + path, init);
  const result = { status: response.status, body: await response.json() };
  save(directory, `${name}.json`, { request: { method: init.method ?? 'GET', path, body: input ?? null }, ...result });
  return result;
}

function accepted(step: string, result: Exchange) {
  if (result.status >= 200 && result.status < 300) return result.body;
  throw new Error(`R1_STEP_REFUSED ${step}: HTTP ${result.status} ${result.body?.code ?? result.body?.error?.code}`);
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Exact public development original, or a recorded derivative of one; nothing else is read. */
function developmentUpload(id: string): Upload {
  const assets = developmentManifest().assets;
  const original = assets.find(asset => asset.id === id && asset.mediaType === 'text/csv');
  if (original) {
    const bytes = readFileSync(original.original.externalPath);
    assert.equal(sha256(bytes), original.original.sha256, 'R1_SOURCE_HASH_MISMATCH');
    return { name: id, bytes };
  }
  const index = JSON.parse(readFileSync(D1C_DERIVATIVES, 'utf8')) as { derivatives: RecordedDerivative[] };
  const derivative = index.derivatives.find(item => basename(item.developmentCopy) === id);
  assert(derivative && assets.some(asset => asset.family === derivative.family &&
    asset.original.sha256 === derivative.originalSha256), 'R1_PUBLIC_DEVELOPMENT_ASSET_REQUIRED');
  const bytes = readFileSync(derivative.developmentCopy);
  assert.equal(sha256(bytes), derivative.sha256, 'R1_SOURCE_HASH_MISMATCH');
  assert.equal(bytes.length, derivative.bytes, 'R1_SOURCE_BYTES_MISMATCH');
  return { name: id, bytes };
}

async function retain(directory: string, caseId: string, revision: number, upload: Upload) {
  const form = new FormData();
  const requestKey = randomUUID();
  form.set('file', new Blob([upload.bytes]), upload.name);
  form.set('format', selection.format);
  form.set('selection', JSON.stringify(selection));
  form.set('requestKey', requestKey);
  form.set('expectedWorkspaceRevision', String(revision));
  const path = `/api/v1/ingestion/cases/${caseId}/sources`;
  const response = await fetch(base + path, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  const result = { status: response.status, body: await response.json() };
  save(directory, 'profile.json', { request: { method: 'POST', path, form: { file: upload.name,
    sha256: sha256(upload.bytes), bytes: upload.bytes.length, selection, requestKey,
    expectedWorkspaceRevision: revision } }, ...result });
  return TabularSourceProfileSchema.parse(AnySourceProfileSchema.parse(accepted('retain', result)));
}

async function enqueue(directory: string, profile: TabularSourceProfile) {
  const sourcePath = `/api/v1/ingestion/cases/${profile.caseId}/sources/${profile.source.sourceId}`;
  const pins = { expectedCaseRevision: profile.workspaceRevision,
    expectedSourceRevision: profile.source.sourceRevision, sourceSha256: profile.source.sourceSha256,
    tabular: profile.tabular };
  const raw = accepted('raw job', await exchange(directory, 'raw', `${sourcePath}/streaming-vector`,
    { requestKey: randomUUID(), framing: 'tabular', ...pins }));
  const mapped = accepted('mapping job', await exchange(directory, 'mapping', `${sourcePath}/chunk-mapping`,
    { requestKey: randomUUID(), rawJobId: raw.jobId, ...pins }));
  return { sourcePath, rawJobId: raw.jobId as string, jobId: mapped.jobId as string };
}

async function settled(jobPath: string) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const response = await fetch(base + jobPath, { signal: AbortSignal.timeout(30000) });
    const status = ChunkMappingStatusSchema.parse(await response.json());
    if (status.sourceComplete || ['failed', 'stale', 'unavailable', 'disabled'].includes(status.status)) return status;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('R1_RUNTIME_DEADLINE: retained receipts are kept; no request is repeated.');
}

async function mappingFrames(directory: string, caseId: string, jobId: string) {
  const response = await fetch(`${base}/api/v1/ingestion/cases/${caseId}/events?cursor=0`,
    { signal: AbortSignal.timeout(5000) });
  assert(response.ok && response.body, 'R1_SSE_UNAVAILABLE');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      text += decoder.decode(next.value, { stream: true });
    }
  } catch (error) {
    if (!(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) throw error;
  }
  const changes = text.split('\n\n').filter(frame => frame.includes('event: ingestion.change')).map(frame => {
    const data = frame.split('\n').find(line => line.startsWith('data: '));
    assert(data, 'R1_SSE_FRAME_WITHOUT_DATA');
    return CaseIngestionEventSchema.parse(JSON.parse(data.slice(6)));
  });
  save(directory, 'events.json', { text, changes });
  return changes.filter(event => event.change.kind === 'mapping.chunk' && event.change.jobId === jobId).length;
}

async function chunkSummaries(directory: string, jobPath: string, sealed: number) {
  const summaries = [];
  for (let index = 0; index < sealed; index++) {
    const result = await exchange(directory, `chunk-${index}`, `${jobPath}/chunks/${index}`);
    const chunk = ChunkMappingChunkResponseSchema.parse(accepted(`chunk ${index}`, result));
    assert(chunk.payload?.mapping, 'R1_CHUNK_WITHOUT_MAPPING');
    summaries.push({ ...chunk.payload.mapping.metrics, questions: chunk.payload.mapping.questions.length,
      rows: chunk.payload.mapping.rows.length, layoutFingerprint: chunk.payload.mapping.profile.layoutFingerprint });
  }
  return summaries;
}

async function propose(directory: string, caseId: string, revision: number, assetId: string) {
  const profile = await retain(directory, caseId, revision, developmentUpload(assetId));
  const jobs = await enqueue(directory, profile);
  const jobPath = `${jobs.sourcePath}/chunk-mapping/jobs/${jobs.jobId}`;
  const status = await settled(jobPath);
  save(directory, 'status.json', status);
  const chunks = await chunkSummaries(directory, jobPath, status.sealedChunks ?? 0);
  const sseFrames = await mappingFrames(directory, caseId, jobs.jobId);
  const summary = { caseId, sourceId: profile.source.sourceId, rawJobId: jobs.rawJobId, mappingJobId: jobs.jobId,
    assetId, records: profile.records, columns: profile.headers.length, status: status.status,
    sealedChunks: status.sealedChunks, sseFrames, chunks };
  save(directory, 'summary.json', summary);
  console.log(JSON.stringify(summary));
}

async function intoCase(directory: string, caseId: string, assetId: string) {
  const current = accepted('case read', await exchange(directory, 'case', `/api/v1/cases/${caseId}`));
  await propose(directory, caseId, current.case.revision, assetId);
}

async function intoNewCase(directory: string, assetId: string, name: string, description: string) {
  const created = accepted('case create', await exchange(directory, 'case', '/api/v1/cases', { name, description }));
  await propose(directory, created.id, created.revision, assetId);
}

async function counts(directory: string, stage: string) {
  const read = async (name: string) => accepted(name, await exchange(directory, `${stage}-${name}`,
    `/api/v1/${name}`));
  const [areas, registry, sites, cases, health] = [await read('areas'), await read('registry'), await read('sites'),
    await read('cases'), await read('health')];
  const data = health.databaseReadiness.data;
  console.log(JSON.stringify({ stage, areas: areas.length, registry: registry.length, sites: sites.length,
    cases: cases.length, sources: data.sourceCount, importPackages: data.importPackageCount,
    physicalFeatures: data.physicalFeatureCount }));
}

async function main() {
  const [action, step, ...rest] = process.argv.slice(2);
  assert(/^[a-z0-9-]+$/.test(step ?? ''), 'Use: counts|into-case|new-case <step-folder> ...');
  const directory = join(root, step);
  if (action === 'counts') return counts(directory, rest[0]);
  if (action === 'into-case') return intoCase(directory, rest[0], rest[1]);
  assert.equal(action, 'new-case', 'Use: counts|into-case|new-case <step-folder> ...');
  return intoNewCase(directory, rest[0], rest[1], rest[2]);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
