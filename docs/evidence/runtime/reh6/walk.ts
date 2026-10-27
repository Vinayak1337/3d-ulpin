import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { IntakeArchiveReceiptSchema, IntakeItemSchema, IntakeManifestSchema }
  from '../../../../packages/contracts/src/usp';
import { zipRoute } from '../../../../apps/studio/src/features/intake/file-route';

// REH4's walk.ts for REH6 Part C on ulpin-reh-02 at 2ddefbbb, in a new case: the NYC pack through the Studio's
// zipRoute, the archive retain and the enrolment. Since ZJ1 the enrolment only queues an intake-zip-layers job and
// returns; the dispatcher takes the layers out. The job is followed through the case read (GET /api/v1/cases/{id}
// lists the case's jobs with status and error; no product route reports attempts) and the manifest, every 2 s until
// the job ends and every item rests, at most 10 minutes. Then the ZIP is enrolled again, and the case's
// intake-zip-layers jobs are counted. No answer is sent; nothing of our own reaches a database, bucket or process.
// The case read is parsed raw (REH4: caseDetail drops each source's inspection, the layer's lineage). Runs once.
const API = 'http://127.0.0.1:21026';
const scratch = 'E:/BhuAayam-data/task-data/reh6';
const input = { path: 'E:/BhuAayam-data/datasets/nyc-10013/nyc-10013-multimodal.zip', bytes: 14621643,
  sha256: 'c231afe4940fed01f67af2c548bb970b6bf0ea30c1795aa71bed9fdf569387da' };
const raw = `${scratch}/part-c.raw.json`;
assert(!existsSync(raw), 'Part C ran already: it is not run twice.');
mkdirSync(`${scratch}/c`, { recursive: true });
const rows: Record<string, unknown>[] = [];
const started = performance.now();
let exchange = 0;
let quietReads = 0;
const OPERATION = 'intake-zip-layers';
const ENDED = ['succeeded', 'failed', 'stale', 'cancelled'];

/** One request: its receipt row (route, status, key, seconds) and its raw body in scratch, never in Git. */
async function call(step: string, method: 'GET' | 'POST', route: string, pattern: string, expected: number | number[],
  options: { json?: unknown; form?: FormData; requestKey?: string } = {}) {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined = options.form;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const begin = performance.now();
  const response = await fetch(`${API}${route}`, { method, headers, body });
  const text = await response.text();
  const seconds = Number(((performance.now() - begin) / 1000).toFixed(3));
  const value = text ? JSON.parse(text) : null;
  writeFileSync(`${scratch}/c/${String(++exchange).padStart(3, '0')}.json`,
    JSON.stringify({ step, method, route, status: response.status, body: value }), { flag: 'wx' });
  const row: Record<string, unknown> = { step, method, route: pattern, status: response.status, seconds,
    requestKey: options.requestKey ?? null };
  rows.push(row);
  if (![expected].flat().includes(response.status)) {
    row.refusal = { code: value?.error?.code ?? null, message: value?.error?.message ?? text.slice(0, 300) };
    throw new Error(`${step}: HTTP ${response.status} ${value?.error?.code ?? ''}`);
  }
  return value;
}

const itemRow = (item: any) => ({ itemId: item.itemId, parentItemId: item.parentItemId, memberPath: item.memberPath,
  name: item.name, sourceId: item.sourceId, family: item.family, format: item.format, state: item.state,
  placement: item.placement, reason: item.limitReason ?? null, existingAreaId: item.existingAreaId ?? null });
const jobRow = (job: any) => ({ id: job.id, sourceId: job.sourceId, operation: job.operation, status: job.status,
  createdAt: job.createdAt, completedAt: job.completedAt, error: job.error });

/** Quiet reads while waiting are counted, not listed one by one. */
async function quiet(route: string) {
  const response = await fetch(`${API}${route}`);
  assert.equal(response.status, 200);
  quietReads++;
  const value = await response.json();
  return value?.data ?? value;
}
const zipJobs = (detail: any) => (detail.jobs as any[]).filter(job => job.operation === OPERATION).map(jobRow);

/** An item at rest: read with a reason, a plan, or a placement the officer acts on or that ends it. */
const atRest = (item: any) => (item.state === 'read' && Boolean(item.limitReason)) || Boolean(item.plan)
  || ['needs_answer', 'not_understood', 'stopped', 'refused', 'on_map'].includes(item.placement);

const out: Record<string, any> = {};
let stoppedAt: unknown = null;
try {
  const bytes = readFileSync(input.path);
  assert.equal(bytes.length, input.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256);
  out.input = { ...input, verifiedBeforeUpload: true };
  const name = input.path.split('/').at(-1)!;
  out.zipRoute = await zipRoute(new File([bytes], name, { type: 'application/zip' }));
  assert.equal(out.zipRoute, 'intake');
  const created = await call('create batch case', 'POST', '/api/v1/cases', '/api/v1/cases', 201,
    { json: { name: 'REH6 ZIP layers by dispatcher job test_only' } });
  const caseId = created?.data?.id ?? created?.id;
  out.caseId = caseId;
  const detail = await call('case revision', 'GET', `/api/v1/cases/${caseId}`, '/api/v1/cases/{caseId}', 200);
  const form = new FormData();
  const archiveKey = randomUUID();
  form.set('file', new File([bytes], name, { type: 'application/zip' }));
  form.set('requestKey', archiveKey);
  form.set('expectedWorkspaceRevision', String((detail?.data ?? detail).case.revision));
  const archive = IntakeArchiveReceiptSchema.parse(await call('retain archive', 'POST',
    `/api/v1/ingestion/cases/${caseId}/intake/archives`, '/api/v1/ingestion/cases/{caseId}/intake/archives', 201,
    { form, requestKey: archiveKey }));
  assert.equal(archive.sha256, input.sha256);
  out.archive = { sourceId: archive.sourceId, sha256: archive.sha256 };
  const itemKey = randomUUID();
  const parent = IntakeItemSchema.parse(await call('enrol archive', 'POST',
    `/api/v1/ingestion/cases/${caseId}/intake/items`, '/api/v1/ingestion/cases/{caseId}/intake/items', 201,
    { json: { sourceId: archive.sourceId, requestKey: itemKey }, requestKey: itemKey }));
  out.enrol = { seconds: rows.at(-1)!.seconds, item: itemRow(parent) };
  const casePath = `/api/v1/cases/${caseId}`, manifestPath = `/api/v1/ingestion/cases/${caseId}/intake`;
  out.jobsRightAfterEnrol = zipJobs(await quiet(casePath));
  // The job and the manifest every 2 s until the job ends and every item rests, at most 10 minutes.
  const trail: Record<string, unknown>[] = [];
  const begin = performance.now();
  let last = '';
  while (performance.now() - begin < 600000) {
    const jobs = zipJobs(await quiet(casePath));
    const manifest = IntakeManifestSchema.parse(await quiet(manifestPath));
    const parentNow = manifest.items.find((item: any) => item.itemId === parent.itemId);
    const layers = manifest.items.filter((item: any) => item.parentItemId === null && item.itemId !== parent.itemId);
    const brief = JSON.stringify([jobs.map(job => job.status), [parentNow, ...layers]
      .map((item: any) => [item.name, item.state, item.placement])]);
    if (brief !== last) {
      last = brief;
      trail.push({ seconds: Number(((performance.now() - begin) / 1000).toFixed(1)),
        jobs: jobs.map(job => `${job.id}: ${job.status}${job.error ? ` ${job.error}` : ''}`),
        items: [parentNow, ...layers].map((item: any) => `${item.name}: ${item.state}/${item.placement}`) });
    }
    if (jobs.length && jobs.every(job => ENDED.includes(job.status)) && atRest(parentNow)
      && layers.every(atRest)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  out.restSeconds = Number(((performance.now() - begin) / 1000).toFixed(1));
  out.trail = trail;
  const final = IntakeManifestSchema.parse(await call('manifest at rest', 'GET', manifestPath,
    '/api/v1/ingestion/cases/{caseId}/intake', 200));
  const after = await call('case jobs and lineage', 'GET', casePath, '/api/v1/cases/{caseId}', 200);
  const caseNow = after?.data ?? after;
  out.jobs = zipJobs(caseNow);
  out.otherJobs = (caseNow.jobs as any[]).filter(job => job.operation !== OPERATION)
    .map(job => `${job.operation}: ${job.status}`);
  const items = final.items.map(itemRow);
  out.parent = items.find(item => item.itemId === parent.itemId);
  out.memberRows = items.filter(item => item.parentItemId === parent.itemId)
    .map(item => ({ memberPath: item.memberPath, state: item.state, placement: item.placement }));
  const sources = new Map((caseNow.sources as any[]).map(source => [source.id, source]));
  out.layers = items.filter(item => item.parentItemId === null && item.itemId !== parent.itemId).map(item => {
    const lineage = sources.get(item.sourceId)?.inspection?.archiveMember ?? null;
    return { member: lineage?.memberPath ?? null, memberSha256: lineage?.memberSha256 ?? null, ...item };
  });
  // The ZIP enrolled again: a second job is expected only when a layer was not kept.
  const againKey = randomUUID();
  const again = IntakeItemSchema.parse(await call('enrol archive again', 'POST',
    `/api/v1/ingestion/cases/${caseId}/intake/items`, '/api/v1/ingestion/cases/{caseId}/intake/items', [200, 201],
    { json: { sourceId: archive.sourceId, requestKey: againKey }, requestKey: againKey }));
  await new Promise(resolve => setTimeout(resolve, 5000));
  const later = await call('case jobs after the second enrolment', 'GET', casePath, '/api/v1/cases/{caseId}', 200);
  out.again = { seconds: rows.at(-2)!.seconds, item: itemRow(again), sameItem: again.itemId === parent.itemId,
    jobsAfter: zipJobs(later?.data ?? later),
    secondJobQueued: zipJobs(later?.data ?? later).length > out.jobs.length };
} catch (error: any) {
  stoppedAt = String(error.message).slice(0, 600);
}
const value = { at: new Date().toISOString(), api: API, wallSeconds:
  Number(((performance.now() - started) / 1000).toFixed(1)), stoppedAt, result: out, requests: rows, quietReads };
writeFileSync(raw, JSON.stringify(value, null, 2), { flag: 'wx' });
console.log(JSON.stringify(value, null, 1));
