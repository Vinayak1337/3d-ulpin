import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { CaseIngestionEventSchema, ChunkMappingChunkResponseSchema, ChunkMappingStatusSchema, AnySourceProfileSchema,
  TabularSourceProfileSchema, AnyMappingReceiptSchema,
  type TabularSourceProfile } from '../../packages/contracts/src/usp';
import { developmentManifest, sourceTables } from './t1-sources';
import { profileTabularChunk } from '../../packages/server/src/modules/usp/ingestion/chunk-mapping-agent';
import { t1OfficerAnswers } from './a3c-officer-answers';

const base = 'http://127.0.0.1:3194';
const task = ['a3d', 'a3c'].find(name => process.argv.includes(`--${name}`)) ?? 'a3b';
const a3c = task !== 'a3b';
const root = `E:/BhuAayam-data/task-data/${task}`;
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
  assert(asset && ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    .includes(asset.mediaType), 'A3C_PUBLIC_TABULAR_REQUIRED');
  const table = sourceTables(asset)[0]; // Authorization and source hash are checked before file access.
  const profile = profileTabularChunk({ jobId: 'preflight', chunkIndex: 0, headers: table.headers,
    rows: table.rows.slice(0, 100), sourceRef: 'preflight' }).profile;
  const format = asset.mediaType === 'text/csv' ? 'csv' as const : 'xlsx' as const;
  const selection = { format, sheet: table.name, table: null, headerRows: table.headerRows };
  return { asset, table, profile, selection, bytes: readFileSync(asset.original.externalPath) };
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

async function upload(id: string, prior?: Receipt): Promise<Receipt> {
  const input = realAsset(id);
  const directory = join(root, `runtime-${randomUUID()}`);
  const created = prior ? (await request(`/api/v1/cases/${prior.caseId}`)).case : await request('/api/v1/cases', {
    name: `${a3c ? 'A3c live check' : 'A3b'} — public tabular development intake`,
    description: 'test_only; immutable publisher CSV; permission unconfirmed; no registry execution.' });
  artifact(directory, 'case.json', created);
  const form = new FormData();
  form.set('file', new Blob([input.bytes]), id);
  form.set('format', input.selection.format);
  form.set('selection', JSON.stringify(input.selection));
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
      assert.equal(chunk.payload.mapping.metrics.memoryHits, 1, 'A3C_SECOND_MEMORY_HIT');
      assert.equal(chunk.payload.mapping.questions.length, 0, 'A3C_SECOND_QUESTIONS');
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
  artifact(directory, 'recipe-revisions.json', await request(`/api/v1/ingestion/cases/${receipt.caseId}` +
    `/recipes/${authored.id}`));
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

async function readback(directory: string, stage: string) {
  assertArtifactPath(directory);
  const receipt = retained(directory);
  const sourcePath = `/api/v1/ingestion/cases/${receipt.caseId}/sources/${receipt.profile.source.sourceId}`;
  const raw = JSON.parse(readFileSync(join(directory, 'raw.json'), 'utf8'));
  const result: Record<string, unknown> = { case: await request(`/api/v1/cases/${receipt.caseId}`),
    profile: await request(`${sourcePath}/profile`) };
  const reads = { rawStatus: `${sourcePath}/streaming-vector/jobs/${raw.jobId}`,
    mappingStatus: `${sourcePath}/chunk-mapping/jobs/${receipt.jobId}`,
    mappedChunk: `${sourcePath}/chunk-mapping/jobs/${receipt.jobId}/chunks/0` };
  for (const [name, path] of Object.entries(reads)) {
    try { result[name] = await request(path); }
    catch (error) { result[name] = { unavailable: error instanceof Error ? error.message : String(error) }; }
  }
  artifact(directory, `readback-${stage}.json`, result);
}

async function counts(directory: string, stage: string) {
  assert(['before', 'after'].includes(stage), 'A3C_COUNT_STAGE_REQUIRED');
  const areas = await request('/api/v1/areas');
  const registry = await request('/api/v1/registry');
  const sites = await request('/api/v1/sites');
  const health = await request('/api/v1/health');
  const result = { areas, registry, sites, importPackages: health.databaseReadiness.data.importPackageCount,
    physicalFeatures: health.databaseReadiness.data.physicalFeatureCount,
    sources: health.databaseReadiness.data.sourceCount };
  artifact(directory, `${stage}-counts.json`, result);
  console.log(JSON.stringify({ stage, areas: areas.length, registry: registry.length,
    importPackages: result.importPackages, physicalFeatures: result.physicalFeatures }));
}

async function main() {
  const [action, first, second] = process.argv.slice(2)
    .filter(value => !['--run-after-handover', '--a3c', '--a3d'].includes(value));
  if (action === 'layout') {
    const left = realAsset(first), right = realAsset(second);
    assert.equal(left.profile.layoutFingerprint, right.profile.layoutFingerprint, 'A3B_LAYOUT_MISMATCH');
    console.log('Exact development layouts match; no HTTP requests made.');
    return;
  }
  assert(process.argv.includes('--run-after-handover'), 'A3B_RUNTIME_HANDOVER_REQUIRED');
  if (action === 'counts') return counts(first, second);
  if (action === 'readback') return readback(first, second);
  if (action === 'answers') {
    const receipt = retained(first);
    return artifact(first, 'officer-answers.json', t1OfficerAnswers(receipt.profile));
  }
  if (action === 'inspect') return inspectJourney(retained(first), Boolean(second));
  if (action === 'inspect-approved') {
    const prior = retained(first);
    const mapped = JSON.parse(readFileSync(join(first, 'approval-job.json'), 'utf8'));
    return inspectJourney({ ...prior, jobId: mapped.jobId, directory: join(first, 'approval-readback') }, false);
  }
  if (action === 'approve') return approve(first, second);
  if (action === 'propose-into') {
    const receipt = await upload(second, retained(first));
    return inspectJourney(receipt, false);
  }
  if (action === 'second') {
    const prior = retained(first), candidate = realAsset(second);
    assert.equal(prior.profile.profile.layoutFingerprint, candidate.profile.layoutFingerprint, 'A3B_LAYOUT_MISMATCH');
    const receipt = await upload(second, a3c ? prior : undefined);
    return inspectJourney(receipt, true);
  }
  assert.equal(action, 'propose', 'Use layout, propose, approve or second.');
  const receipt = await upload(first);
  return inspectJourney(receipt, false);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
