import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { IntakeArchiveReceiptSchema, IntakeItemSchema, IntakeManifestSchema }
  from '../../../../packages/contracts/src/usp';
import { caseDetail } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { zipRoute } from '../../../../apps/studio/src/features/intake/file-route';

// REH3's walk.ts (its NYC phase) for REH4 on the rolled ulpin-reh-02, in a new case. The NYC pack goes in whole:
// the Studio's zipRoute, the archive retain, the enrolment that fans out one item per layer. Then the batch is left
// to work and its manifest is read until every item rests: the ZIP's own item (ZF2b) and the buildings layer whose
// bytes already made an area (SA1). No answer is sent, no database, storage or process of our own; runs once.
const API = 'http://127.0.0.1:21026';
const scratch = 'E:/BhuAayam-data/task-data/reh4';
const input = { path: 'E:/BhuAayam-data/datasets/nyc-10013/nyc-10013-multimodal.zip', bytes: 14621643,
  sha256: 'c231afe4940fed01f67af2c548bb970b6bf0ea30c1795aa71bed9fdf569387da' };
const buildingsMember = 'layers/buildings-original.geojson';
const raw = `${scratch}/part-c.raw.json`;
assert(!existsSync(raw), 'Part C ran already: it is not run twice.');
mkdirSync(`${scratch}/c`, { recursive: true });
const rows: Record<string, unknown>[] = [];
const started = performance.now();
let exchange = 0;
let quietReads = 0;

/** One request: its receipt row (route, status, key, seconds) and its raw body in scratch, never in Git. */
async function call(step: string, method: 'GET' | 'POST', route: string, pattern: string, expected: number,
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
  if (response.status !== expected) {
    row.refusal = { code: value?.error?.code ?? null, message: value?.error?.message ?? text.slice(0, 300) };
    throw new Error(`${step}: HTTP ${response.status} ${value?.error?.code ?? ''}`);
  }
  return value;
}

const itemRow = (item: any) => ({ itemId: item.itemId, parentItemId: item.parentItemId, memberPath: item.memberPath,
  name: item.name, sourceId: item.sourceId, family: item.family, format: item.format, state: item.state,
  placement: item.placement, reason: item.limitReason ?? null, existingAreaId: item.existingAreaId ?? null,
  recordsSeen: item.recordsSeen ?? null, plan: item.plan ? { recipeState: item.plan.recipeState,
    origin: item.plan.origin, packageId: item.plan.packageId ?? null } : null });

/** Manifest reads while waiting are counted, not listed one by one. */
async function manifestQuiet(caseId: string) {
  const response = await fetch(`${API}/api/v1/ingestion/cases/${caseId}/intake`);
  assert.equal(response.status, 200);
  quietReads++;
  return IntakeManifestSchema.parse(await response.json());
}

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
    { json: { name: 'REH4 already-in-area and ZIP words test_only' } });
  const caseId = created?.data?.id ?? created?.id;
  out.caseId = caseId;
  const detail = caseDetail.parse(await call('case revision', 'GET', `/api/v1/cases/${caseId}`,
    '/api/v1/cases/{caseId}', 200));
  const form = new FormData();
  const archiveKey = randomUUID();
  form.set('file', new File([bytes], name, { type: 'application/zip' }));
  form.set('requestKey', archiveKey);
  form.set('expectedWorkspaceRevision', String(detail.case.revision));
  const archive = IntakeArchiveReceiptSchema.parse(await call('retain archive', 'POST',
    `/api/v1/ingestion/cases/${caseId}/intake/archives`, '/api/v1/ingestion/cases/{caseId}/intake/archives', 201,
    { form, requestKey: archiveKey }));
  assert.equal(archive.sha256, input.sha256);
  out.archive = { sourceId: archive.sourceId, sha256: archive.sha256 };
  const itemKey = randomUUID();
  const parent = IntakeItemSchema.parse(await call('enrol archive (fan-out)', 'POST',
    `/api/v1/ingestion/cases/${caseId}/intake/items`, '/api/v1/ingestion/cases/{caseId}/intake/items', 201,
    { json: { sourceId: archive.sourceId, requestKey: itemKey }, requestKey: itemKey }));
  out.parentRegistered = itemRow(parent);
  // The manifest every 2 s until the ZIP's own item and every layer item rest, at most 10 minutes.
  const trail: Record<string, unknown>[] = [];
  const begin = performance.now();
  let last = '';
  while (performance.now() - begin < 600000) {
    const manifest = await manifestQuiet(caseId);
    const parentNow = manifest.items.find((item: any) => item.itemId === parent.itemId);
    const layers = manifest.items.filter((item: any) => item.parentItemId === null && item.itemId !== parent.itemId);
    const brief = JSON.stringify([parentNow, ...layers].map((item: any) => [item.name, item.state, item.placement]));
    if (brief !== last) {
      last = brief;
      trail.push({ seconds: Number(((performance.now() - begin) / 1000).toFixed(1)),
        items: [parentNow, ...layers].map((item: any) => `${item.name}: ${item.state}/${item.placement}`) });
    }
    if (layers.length && atRest(parentNow) && layers.every(atRest)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  out.restSeconds = Number(((performance.now() - begin) / 1000).toFixed(1));
  out.trail = trail;
  const final = IntakeManifestSchema.parse(await call('manifest at rest', 'GET',
    `/api/v1/ingestion/cases/${caseId}/intake`, '/api/v1/ingestion/cases/{caseId}/intake', 200));
  const items = final.items.map(itemRow);
  out.parent = items.find(item => item.itemId === parent.itemId);
  out.memberRows = items.filter(item => item.parentItemId === parent.itemId);
  const sources = new Map((caseDetail.parse(await call('case sources and lineage', 'GET', `/api/v1/cases/${caseId}`,
    '/api/v1/cases/{caseId}', 200)).sources as any[]).map(source => [source.id, source]));
  out.layers = items.filter(item => item.parentItemId === null && item.itemId !== parent.itemId).map(item => {
    const lineage = (sources.get(item.sourceId) as any)?.inspection?.archiveMember ?? null;
    return { memberPath: lineage?.memberPath ?? null, memberSha256: lineage?.memberSha256 ?? null, ...item };
  });
  out.buildings = out.layers.find((layer: any) => layer.memberPath === buildingsMember) ?? null;
  if (out.buildings) {
    const parsed = IntakeItemSchema.parse(await call('buildings layer item as the Studio reads it', 'GET',
      `/api/v1/ingestion/cases/${caseId}/intake/items/${out.buildings.itemId}`,
      '/api/v1/ingestion/cases/{caseId}/intake/items/{itemId}', 200));
    out.buildingsItem = { ...itemRow(parsed), cardFeatures: parsed.card?.counts.features ?? null,
      cardCrs: parsed.card?.crs ?? null };
  }
} catch (error: any) {
  stoppedAt = String(error.message).slice(0, 600);
}
const value = { at: new Date().toISOString(), api: API, wallSeconds:
  Number(((performance.now() - started) / 1000).toFixed(1)), stoppedAt, result: out, requests: rows, quietReads };
writeFileSync(raw, JSON.stringify(value, null, 2), { flag: 'wx' });
console.log(JSON.stringify(value, null, 1));
