import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { CaseIngestionEventSchema, ChunkMappingChunkResponseSchema, ChunkMappingStatusSchema, AnySourceProfileSchema,
  TabularSourceProfileSchema, AnyMappingReceiptSchema,
  type TabularSourceProfile } from '../../packages/contracts/src/usp';
import { developmentManifest, sourceTables } from './t1-sources';
import { profileTabularChunk } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';

const base = 'http://127.0.0.1:3194';
const root = 'E:/BhuAayam-data/task-data/a3b';
type Receipt = { directory: string; caseId: string; profile: TabularSourceProfile; jobId: string };

async function request(path: string, input?: unknown, form?: FormData) {
  const init: RequestInit = { signal: AbortSignal.timeout(15000) };
  if (input !== undefined || form) {
    init.method = 'POST';
    init.body = form ?? JSON.stringify(input);
    if (!form) init.headers = { 'Content-Type': 'application/json' };
  }
  const response = await fetch(base + path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify({ status: response.status, path, body }));
  return body;
}

function assertArtifactPath(path: string) {
  const withinRoot = relative(resolve(root), resolve(path));
  assert(!isAbsolute(withinRoot) && !withinRoot.startsWith('..'), 'A3B_ARTIFACT_PATH_DENIED');
  assert(!/(?:^|[\\/])(?:demo\.env|\.env(?:\.|$)|(?:key|credential|secret)[^\\/]*)/i.test(path),
    'A3B_ARTIFACT_PATH_DENIED');
}

function artifact(directory: string, name: string, value: unknown) {
  assertArtifactPath(directory);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function realAsset(id: string) {
  const asset = developmentManifest().assets.find(item => item.id === id);
  assert(asset?.mediaType === 'text/csv', 'A3B_PUBLIC_CSV_REQUIRED');
  const table = sourceTables(asset)[0]; // Authorization and source hash are checked before file access.
  const profile = profileTabularChunk({ jobId: 'preflight', chunkIndex: 0, headers: table.headers,
    rows: table.rows.slice(0, 100), sourceRef: 'preflight' }).profile;
  return { asset, table, profile, bytes: readFileSync(asset.original.externalPath) };
}

function retained(directory: string): Receipt {
  assertArtifactPath(directory);
  return JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
}

async function completed(caseId: string, sourceId: string, jobId: string) {
  const path = `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/chunk-mapping/jobs/${jobId}`;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const status = ChunkMappingStatusSchema.parse(await request(path));
    if (['failed', 'stale', 'unavailable', 'disabled'].includes(status.status)) throw new Error(JSON.stringify(status));
    if (status.sourceComplete) return status;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('A3B_RUNTIME_DEADLINE: preserve retained receipts; do not repeat mutations.');
}

async function upload(id: string): Promise<Receipt> {
  const input = realAsset(id);
  const directory = join(root, `runtime-${randomUUID()}`);
  const created = await request('/api/v1/cases', { name: 'A3b public tabular development intake',
    description: 'test_only; immutable publisher CSV; permission unconfirmed; no registry execution.' });
  artifact(directory, 'case.json', created);
  const form = new FormData();
  form.set('file', new Blob([input.bytes]), id);
  form.set('format', 'csv');
  form.set('selection', JSON.stringify({ format: 'csv', sheet: 'csv', table: null, headerRows: [1] }));
  form.set('requestKey', randomUUID());
  form.set('expectedWorkspaceRevision', String(created.revision));
  const profile = TabularSourceProfileSchema.parse(AnySourceProfileSchema.parse(
    await request(`/api/v1/ingestion/cases/${created.id}/sources`, undefined, form)));
  artifact(directory, 'profile.json', profile);
  const sourcePath = `/api/v1/ingestion/cases/${created.id}/sources/${profile.source.sourceId}`;
  const raw = await request(`${sourcePath}/streaming-vector`, {
    requestKey: randomUUID(), expectedCaseRevision: profile.workspaceRevision,
    expectedSourceRevision: profile.source.sourceRevision, sourceSha256: profile.source.sourceSha256,
    framing: 'tabular', tabular: profile.tabular,
  });
  artifact(directory, 'raw.json', raw);
  const mapped = await request(`${sourcePath}/chunk-mapping`, {
    requestKey: randomUUID(), rawJobId: raw.jobId, expectedCaseRevision: profile.workspaceRevision,
    expectedSourceRevision: profile.source.sourceRevision, sourceSha256: profile.source.sourceSha256,
    tabular: profile.tabular,
  });
  const receipt = { directory, caseId: created.id, profile, jobId: mapped.jobId };
  artifact(directory, 'receipt.json', receipt);
  return receipt;
}

async function captureEvents(receipt: Receipt) {
  const response = await fetch(`${base}/api/v1/ingestion/cases/${receipt.caseId}/events?cursor=0`, {
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok && response.body, 'A3B_SSE_UNAVAILABLE');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
      assert(Buffer.byteLength(text) < 512 * 1024, 'A3B_SSE_BUDGET');
    }
  } catch (error) {
    if (!(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) throw error;
  }
  const changes = text.split('\n\n').filter(frame => frame.includes('event: ingestion.change')).map(frame => {
    const data = frame.split('\n').find(line => line.startsWith('data: '));
    assert(data);
    return CaseIngestionEventSchema.parse(JSON.parse(data.slice(6)));
  });
  assert(changes.some(event => event.change.kind === 'mapping.chunk' && event.change.jobId === receipt.jobId),
    'A3B_MAPPING_SSE_MISSING');
  artifact(receipt.directory, 'events.json', { text, changes });
}

async function inspectJourney(receipt: Receipt, requireMemory: boolean) {
  const sourceId = receipt.profile.source.sourceId;
  const status = await completed(receipt.caseId, sourceId, receipt.jobId);
  artifact(receipt.directory, 'status.json', status);
  const chunks = [];
  for (let index = 0; index < status.sealedChunks!; index++) {
    const chunk = ChunkMappingChunkResponseSchema.parse(await request(`/api/v1/ingestion/cases/${receipt.caseId}` +
      `/sources/${sourceId}/chunk-mapping/jobs/${receipt.jobId}/chunks/${index}`));
    assert(chunk.payload?.mapping);
    if (requireMemory) {
      assert.equal(chunk.payload.mapping.metrics.layout, 'memory', 'A3B_SECOND_LAYOUT_MISS');
      assert.equal(chunk.payload.mapping.metrics.teacherCalls, 0, 'A3B_SECOND_TEACHER_CALL');
    }
    chunks.push(chunk);
  }
  artifact(receipt.directory, 'chunks.json', chunks);
  await captureEvents(receipt);
  console.log(JSON.stringify(receipt));
}

async function approve(directory: string, path: string) {
  const receipt = retained(directory);
  assertArtifactPath(path);
  assert(path.endsWith('.json'), 'A3B_OFFICER_FILE_REQUIRED');
  // Officer-authored {mapping, decisions}, never generated answers.
  const answers = JSON.parse(readFileSync(path, 'utf8'));
  const profile = TabularSourceProfileSchema.parse(await request(`/api/v1/ingestion/cases/${receipt.caseId}` +
    `/sources/${receipt.profile.source.sourceId}/profile`));
  const authored = AnyMappingReceiptSchema.parse(await request(`/api/v1/ingestion/cases/${receipt.caseId}` +
    `/sources/${profile.source.sourceId}/recipes`, {
      requestKey: randomUUID(), expectedRecipeRevision: 0, destination: null,
      plan: { version: 'manual-tabular/1', mode: 'manual_mapping', caseId: receipt.caseId, source: profile.source,
        workspaceRevision: profile.workspaceRevision, workspaceFingerprint: profile.workspaceFingerprint,
        tabular: profile.tabular, mapping: answers.mapping, decisions: answers.decisions } }));
  artifact(directory, 'authored.json', authored);
  const requestKey = randomUUID();
  const approved = await request(`/api/v1/ingestion/cases/${receipt.caseId}/recipes/${authored.id}/approve`, {
    requestKey, expectedRecipeRevision: authored.revision,
  });
  artifact(directory, 'approved.json', approved);
  await approvedJob(receipt, profile, requestKey);
}

async function approvedJob(receipt: Receipt, profile: TabularSourceProfile, requestKey: string) {
  const raw = JSON.parse(readFileSync(join(receipt.directory, 'raw.json'), 'utf8'));
  // Replay the same existing enqueue command to observe the approval follow-up job, never a new job authority.
  const mapped = await request(`/api/v1/ingestion/cases/${receipt.caseId}` +
    `/sources/${profile.source.sourceId}/chunk-mapping`, { requestKey, rawJobId: raw.jobId,
      expectedCaseRevision: profile.workspaceRevision, expectedSourceRevision: profile.source.sourceRevision,
      sourceSha256: profile.source.sourceSha256, tabular: profile.tabular });
  artifact(receipt.directory, 'approval-job.json', mapped);
  artifact(receipt.directory, 'approval-status.json',
    await completed(receipt.caseId, profile.source.sourceId, mapped.jobId));
  console.log('Approval background job completed; second original may now test accepted memory.');
}

async function main() {
  const [action, first, second] = process.argv.slice(2).filter(value => value !== '--run-after-handover');
  if (action === 'layout') {
    const left = realAsset(first), right = realAsset(second);
    assert.equal(left.profile.layoutFingerprint, right.profile.layoutFingerprint, 'A3B_LAYOUT_MISMATCH');
    console.log('Exact development layouts match; no HTTP requests made.');
    return;
  }
  assert(process.argv.includes('--run-after-handover'), 'A3B_RUNTIME_HANDOVER_REQUIRED');
  if (action === 'approve') return approve(first, second);
  if (action === 'second') {
    const prior = retained(first), candidate = realAsset(second);
    assert.equal(prior.profile.profile.layoutFingerprint, candidate.profile.layoutFingerprint, 'A3B_LAYOUT_MISMATCH');
    return inspectJourney(await upload(second), true);
  }
  assert.equal(action, 'propose', 'Use layout, propose, approve or second.');
  return inspectJourney(await upload(first), false);
}

main();
