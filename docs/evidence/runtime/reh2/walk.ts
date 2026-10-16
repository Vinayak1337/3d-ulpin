import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AnyMappingReceiptSchema, AnySourceProfileSchema, IntakeItemSchema, IntakeManifestSchema,
  IntakeTargetPageSchema, LargeUploadStatusSchema, SourceProfileSchema, StreamedMappingReceiptSchema,
  StreamedProfileStatusSchema, type LargeUploadStatus } from '../../../../packages/contracts/src/usp';
import { caseDetail } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { questionBody, type Choices } from '../../../../apps/studio/src/features/intake/question-model';
import { streamedQuestionBody } from '../../../../apps/studio/src/features/intake/streamed-question-model';
import { approvalBody } from '../../../../apps/studio/src/features/intake/layout-model';

// ST1c's request code (gf1/st1c/http.ts and runtime.ts) aimed at the platform's own API for ulpin-reh-02.
// No database, storage or process of our own: the platform runs them. The Studio's builders are imported as
// ST1c imports them. One phase per input; ids carry over in the scratch state file, outside Git.
const API = 'http://127.0.0.1:21026';
const evidence = 'docs/evidence/runtime/reh2';
const scratch = 'E:/BhuAayam-data/task-data/reh2';
const stateFile = `${scratch}/state.json`;
const require = createRequire(new URL('../../../../apps/api/package.json', import.meta.url));
const { z: runtimeZod } = require('zod');
const published = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
const plan = JSON.parse(readFileSync(`${evidence}/plan-b.json`, 'utf8'));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const state: Record<string, any> = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const phase = process.argv[2];
const rows: Record<string, unknown>[] = [];
const started = performance.now();
let exchange = 0;
mkdirSync(`${scratch}/raw`, { recursive: true });
assert(API.endsWith(':21026'), 'Only the rehearsal API is called.');

class Refusal extends Error {
  constructor(readonly step: string, readonly status: number, readonly body: any) {
    super(`${step}: HTTP ${status} ${body?.error?.code ?? ''} ${body?.error?.message ?? ''}`);
  }
}

/** The published response schema of an operation equals the canonical one the call parses with. */
function contract(pattern: string, method: string, status: number, schema: unknown) {
  const operation = published.paths[pattern]?.[method.toLowerCase()];
  const response = operation?.responses?.[String(status)]?.content?.['application/json']?.schema;
  if (!response || !schema) return null;
  const resolved = response.$ref ? published.components.schemas[response.$ref.split('/').at(-1)] : response;
  try {
    assert.deepEqual(resolved, runtimeZod.toJSONSchema(schema, { target: 'openapi-3.0' }));
    return true;
  } catch {
    return false;
  }
}

type Options = { json?: unknown; form?: FormData; bytes?: Buffer; headers?: Record<string, string>;
  schema?: { parse: (value: unknown) => any }; expected: number; requestKey?: string; ids?: Record<string, unknown> };

/** One request: its receipt row (route, status, ids, key, seconds) and its raw body in scratch, never in Git. */
async function call(step: string, method: 'GET' | 'POST' | 'PUT', route: string, pattern: string, options: Options) {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.bytes) body = options.bytes;
  else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  }
  const at = new Date().toISOString();
  const begin = performance.now();
  const response = await fetch(`${API}${route}`, { method, headers, body });
  const text = await response.text();
  const seconds = Number(((performance.now() - begin) / 1000).toFixed(3));
  const value = text ? JSON.parse(text) : null;
  exchange++;
  const raw = `${scratch}/raw/${phase}-${String(exchange).padStart(3, '0')}.json`;
  writeFileSync(raw, JSON.stringify({ step, method, route, status: response.status, body: value }), { flag: 'wx' });
  const row: Record<string, unknown> = { input: phase, step, method, route: pattern, status: response.status,
    seconds, at, requestKey: options.requestKey ?? null, ...options.ids,
    cacheControl: response.headers.get('cache-control') };
  rows.push(row);
  if (response.status !== options.expected) {
    row.refusal = { code: value?.error?.code ?? null, message: value?.error?.message ?? text.slice(0, 300) };
    progress(row);
    throw new Refusal(step, response.status, value);
  }
  row.contract = contract(pattern, method, response.status, options.schema);
  progress({ step, status: response.status, seconds });
  return options.schema ? options.schema.parse(value) : value;
}

function progress(value: Record<string, unknown>) {
  appendFileSync(`${scratch}/progress.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), phase, ...value })}\n`);
}

function saveState() {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

/** Each input's original is read and checked against plan-b.json before any byte is sent. */
function original(name: string) {
  // A long string is kept in plan-b.json as its 90-character pieces (audit.mjs fit); they are joined here.
  const input = Object.fromEntries(Object.entries(plan.inputs.find((entry: any) => entry.name === name))
    .map(([key, value]) => [key, key !== 'recordedIn' && Array.isArray(value) ? value.join('') : value])) as any;
  const bytes = readFileSync(input.path);
  assert.equal(bytes.length, input.bytes, `${name}: bytes differ from plan-b.json`);
  assert.equal(sha256(bytes), input.sha256, `${name}: SHA-256 differs from plan-b.json`);
  return { input, bytes };
}

const caseRevision = async (caseId: string) => (await call('case revision', 'GET', `/api/v1/cases/${caseId}`,
  '/api/v1/cases/{caseId}', { schema: caseDetail, expected: 200 })).case.revision as number;
const manifest = (caseId: string, step = 'manifest') => call(step, 'GET', `/api/v1/ingestion/cases/${caseId}/intake`,
  '/api/v1/ingestion/cases/{caseId}/intake', { schema: IntakeManifestSchema, expected: 200 });
const targets = (caseId: string, step = 'targets') => call(step, 'GET', `/api/v1/ingestion/cases/${caseId}/targets`,
  '/api/v1/ingestion/cases/{caseId}/targets', { schema: IntakeTargetPageSchema, expected: 200 });

/** The manifest's rows for one item, read every two seconds until a condition holds (the Studio reads on events). */
async function until(caseId: string, itemId: string, label: string, done: (item: any) => boolean, minutes: number) {
  const trail: Record<string, unknown>[] = [];
  const begin = performance.now();
  let last = '';
  while (performance.now() - begin < minutes * 60000) {
    const item = (await manifestQuiet(caseId)).items.find((entry: any) => entry.itemId === itemId);
    const row = { state: item.state, placement: item.placement, partsPlanned: item.partsPlanned,
      partsDone: item.partsDone, recordsSeen: item.recordsSeen, limitReason: item.limitReason,
      streamedProfileJobId: item.streamedProfileJobId ?? null,
      plan: item.plan ? { recipeState: item.plan.recipeState, packageId: item.plan.packageId ?? null } : null };
    if (JSON.stringify(row) !== last) {
      last = JSON.stringify(row);
      trail.push({ seconds: Number(((performance.now() - begin) / 1000).toFixed(1)), ...row });
      progress({ watch: label, ...row });
    }
    if (done(item)) return { item, trail, seconds: Number(((performance.now() - begin) / 1000).toFixed(1)) };
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return { item: null, trail, seconds: minutes * 60, timedOut: label };
}

/** Manifest reads while waiting are counted, not listed one by one. */
let quietReads = 0;
async function manifestQuiet(caseId: string) {
  const response = await fetch(`${API}/api/v1/ingestion/cases/${caseId}/intake`);
  assert.equal(response.status, 200);
  quietReads++;
  return IntakeManifestSchema.parse(await response.json());
}

/** Packages drafted and reviewed, read from the batch's own target page. */
async function packagesSettled(caseId: string, minutes: number, packageIds?: Set<string>) {
  const begin = performance.now();
  let page: any = null;
  while (performance.now() - begin < minutes * 60000) {
    const response = await fetch(`${API}/api/v1/ingestion/cases/${caseId}/targets`);
    page = IntakeTargetPageSchema.parse(await response.json());
    quietReads++;
    const mine = page.packages.filter((entry: any) => !packageIds || !packageIds.has(entry.packageId));
    if (mine.length && mine.every((entry: any) => entry.reviewFingerprint || entry.reviewRefusal)) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return { page, seconds: Number(((performance.now() - begin) / 1000).toFixed(1)) };
}

/** What the Studio's map reads for an area: its display features, in local metres from the area's anchor. A
 * position is placed back on the globe from the anchor by a flat-earth step (metres per degree at that latitude):
 * close enough to say the feature lies in the input's place, not a survey coordinate. */
async function areaFeatures(areaId: string, box: [number, number, number, number]) {
  const value = await call('area context', 'GET', `/api/v1/areas/${areaId}/context`,
    '/api/v1/areas/{areaId}/context', { expected: 200, ids: { areaId } });
  const data = value?.data ?? value;
  const features = (data?.displayFeatures ?? []) as any[];
  const anchor = data?.area?.reference?.anchor as [number, number] | undefined;
  const first = (geometry: any): number[] | null => {
    let c = geometry?.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    return Array.isArray(c) ? c : null;
  };
  const place = (local: number[] | null) => anchor && local ? [
    Number((anchor[0] + local[0] / (111320 * Math.cos(anchor[1] * Math.PI / 180))).toFixed(6)),
    Number((anchor[1] + local[1] / 110574).toFixed(6))] : null;
  const placed = features.map(feature => ({ feature, lonLat: place(first(feature.geometry)) }));
  const inside = placed.filter(({ lonLat }) => lonLat && lonLat[0] >= box[0] && lonLat[0] <= box[2]
    && lonLat[1] >= box[1] && lonLat[1] <= box[3]);
  return { area: { name: data?.area?.name ?? null, anchor: anchor ?? null,
    sourceCrs: data?.area?.reference?.sourceCrs ?? null, analysisCrs: data?.area?.reference?.analysisCrs ?? null },
  count: features.length, inside: inside.length, box,
  packages: (data?.packages ?? []).map((entry: any) => ({ id: entry.id, state: entry.state,
    quarantine: entry.quarantine?.message ?? null })),
  samples: [0, Math.floor(inside.length / 2), inside.length - 1].filter(index => index >= 0)
    .map(index => inside[index]).filter(Boolean).map(({ feature, lonLat }) => ({ id: feature.id, kind: feature.kind,
      name: feature.name, height: feature.height ? { state: feature.height.state, value: feature.height.value } : null,
      evidence: feature.evidence?.[0]?.featureId ?? null, geometryType: feature.geometry?.type ?? null,
      firstLocalMetres: first(feature.geometry), approxLonLat: lonLat })) };
}

function packageSummary(page: any) {
  return { counts: page.counts, packages: page.packages.map((entry: any) => ({ packageId: entry.packageId,
    areaId: entry.areaId, state: entry.state, revision: entry.revision, counts: entry.counts,
    reviewed: Boolean(entry.reviewFingerprint), reviewRefusal: entry.reviewRefusal ?? null })) };
}

async function batchView(caseId: string, box: [number, number, number, number]) {
  const items = (await manifest(caseId, 'batch manifest')).items.map((item: any) => ({ itemId: item.itemId,
    format: item.format, state: item.state, placement: item.placement, reason: item.limitReason ?? null,
    sizeBytes: item.sizeBytes, recordsSeen: item.recordsSeen ?? null }));
  const page = await targets(caseId, 'batch packages');
  const areas = [...new Set(page.packages.map((entry: any) => entry.areaId))] as string[];
  const map: Record<string, unknown> = {};
  for (const areaId of areas) map[areaId] = await areaFeatures(areaId, box);
  return { manifest: items, ...packageSummary(page), areaFeatures: map };
}

const nycBox: [number, number, number, number] = [-74.03, 40.70, -73.98, 40.74];
const niagaraBox: [number, number, number, number] = [-79.2, 42.95, -78.9, 43.2];

async function createCase() {
  if (state.caseId) return state.caseId;
  const created = await call('create batch case', 'POST', '/api/v1/cases', '/api/v1/cases', { expected: 201,
    json: { name: 'REH2 presentation rehearsal test_only' } });
  state.caseId = created?.data?.id ?? created?.id;
  assert(state.caseId, 'The case route gave no id.');
  saveState();
  return state.caseId;
}

/** 1a. The officer picks the whole ZIP; the Add files dialog routes a .zip to direct inspection. */
async function zip() {
  const { input, bytes } = original('nyc-zip');
  await createCase();
  const form = new FormData();
  form.set('file', new File([bytes], 'nyc-10013-multimodal.zip', { type: 'application/zip' }));
  try {
    const value = await call('inspect zip (Add files, direct route)', 'POST', '/api/v1/import-packages/inspect',
      '/api/v1/import-packages/inspect', { form, expected: 200 });
    const data = value?.data ?? value;
    return { accepted: true, input: input.name, inspection: { format: data.format, layer: data.layer ?? null,
      sourceCrs: data.sourceCrs ?? null, fields: data.fields?.map((field: any) => field.name),
      quarantine: data.quarantine ?? null, suggestedIdField: data.suggestedIdField ?? null } };
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return { accepted: false, input: input.name, refusal: { status: error.status, code: error.body?.error?.code,
      message: error.body?.error?.message } };
  }
}

/** 1b. The buildings member through intake, as the Studio's retainMap and layout question send it. */
async function nyc() {
  const { input, bytes } = original('nyc-buildings-member');
  const caseId = await createCase();
  const out: Record<string, any> = {};
  const before = await caseRevision(caseId);
  const form = new FormData();
  const requestKey = randomUUID();
  form.set('file', new File([bytes], 'buildings-original.geojson', { type: 'application/geo+json' }));
  form.set('format', 'geojson');
  form.set('requestKey', requestKey);
  form.set('expectedWorkspaceRevision', String(before));
  const profile = await call('retain map file', 'POST', `/api/v1/ingestion/cases/${caseId}/sources`,
    '/api/v1/ingestion/cases/{caseId}/sources', { form, schema: AnySourceProfileSchema, expected: 201, requestKey,
      ids: { caseId } });
  assert.equal(profile.version, 'manual-geojson/1');
  const sourceId = profile.source.sourceId;
  state.nycSourceId = sourceId;
  saveState();
  const itemKey = randomUUID();
  const item = await call('register item', 'POST', `/api/v1/ingestion/cases/${caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', { json: { sourceId, requestKey: itemKey },
      schema: IntakeItemSchema, expected: 201, requestKey: itemKey, ids: { caseId, sourceId } });
  out.registered = { itemId: item.itemId, format: item.format, family: item.family, sizeClass: item.sizeClass,
    sizeBytes: item.sizeBytes, wave: item.wave, cardSha256: item.cardSha256, cardFormat: item.card?.format ?? null,
    cardPresent: Boolean(item.card), placement: item.placement };
  assert(item.card, 'The registered item carries no card.');
  state.nycItemId = item.itemId;
  saveState();
  out.toQuestion = await until(caseId, item.itemId, 'nyc question', entry => Boolean(entry.plan)
    || ['needs_answer', 'not_understood', 'stopped', 'refused'].includes(entry.placement), 10);
  const rested = out.toQuestion.item;
  if (!rested || rested.placement !== 'needs_answer') return out;
  const read = await call('read profile', 'GET', `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/profile`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/profile', { schema: SourceProfileSchema, expected: 200 });
  out.profile = { featureCount: read.featureCount, crs: read.crs, geometryTypes: read.geometryTypes,
    identifierCandidates: read.paths.filter((path: any) => path.literalIdEligible || path.integerIdEligible)
      .map((path: any) => path.path), limitations: read.limitations };
  // The officer's own choices: buildings, identified by the issuer's building identification number. No height.
  const choices: Choices = { kind: 'building', identifier: '/features/*/properties/bin', name: '', height: '',
    unit: '', meaning: '' };
  const authorKey = randomUUID();
  const body = questionBody(read as never, choices, 0, authorKey);
  assert(body, 'The Studio builder gave no body for these choices.');
  const authored = await call('author layout', 'POST', `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/recipes`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', { json: body, schema: AnyMappingReceiptSchema,
      expected: 201, requestKey: authorKey, ids: { caseId, sourceId } });
  const approveBody = approvalBody(authored, randomUUID());
  const approved = await call('approve layout', 'POST',
    `/api/v1/ingestion/cases/${caseId}/recipes/${authored.id}/approve`,
    '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', { json: approveBody,
      schema: AnyMappingReceiptSchema, expected: 200, requestKey: approveBody.requestKey,
      ids: { caseId, recipeId: authored.id } });
  out.layout = { choices, recipeId: authored.id, authoredState: authored.state, approvedState: approved.state,
    destination: approved.destination ?? null, operations: authored.plan.operations
      .map((op: any) => `${op.target} <- ${op.sourcePath} via ${op.conversionId}`) };
  state.nycRecipeId = authored.id;
  saveState();
  out.toPackage = await until(caseId, item.itemId, 'nyc package', entry => Boolean(entry.plan?.packageId)
    || ['stopped', 'refused', 'not_understood'].includes(entry.placement), 15);
  const settled = await packagesSettled(caseId, 10);
  out.packagesSettledSeconds = settled.seconds;
  state.nycPackages = settled.page.packages.map((entry: any) => entry.packageId);
  saveState();
  out.view = await batchView(caseId, nycBox);
  return out;
}

async function part(upload: LargeUploadStatus, number: number, bytes: Buffer) {
  const requestKey = randomUUID();
  return call(`upload part ${number}`, 'PUT',
    `/api/v1/ingestion/cases/${upload.caseId}/uploads/${upload.id}/parts/${number}`,
    '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/parts/{partNumber}', { bytes, requestKey,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Request-Key': requestKey,
        'X-Upload-Revision': String(upload.revision), 'X-Case-Revision': String(upload.currentCaseRevision),
        'X-Part-Sha256': sha256(bytes) }, schema: LargeUploadStatusSchema, expected: 200,
      ids: { uploadId: upload.id } });
}

/** 2. The unseen large file, in the same case, through the large path exactly as ST1c. */
async function niagara() {
  const { input, bytes } = original('niagara');
  const caseId = await createCase();
  const out: Record<string, any> = {};
  const createKey = randomUUID();
  let upload = await call('create upload', 'POST', `/api/v1/ingestion/cases/${caseId}/uploads`,
    '/api/v1/ingestion/cases/{caseId}/uploads', { json: {
      requestKey: createKey, expectedCaseRevision: await caseRevision(caseId), filename: input.path.split('/').at(-1),
      mediaType: 'application/octet-stream', bytes: input.bytes, sha256: input.sha256,
      provenance: { issuer: input.issuer, originalUrl: input.originalUrl, acquiredAt: input.acquiredAt,
        permissionReference: input.permissionReference, limitations: ['Foreign test_only; no operational claim.'] },
    }, schema: LargeUploadStatusSchema, expected: 201, requestKey: createKey, ids: { caseId } });
  for (let number = 1; number <= upload.partCount; number++) {
    const start = (number - 1) * upload.partBytes;
    upload = await part(upload, number, bytes.subarray(start, Math.min(input.bytes, start + upload.partBytes)));
  }
  const finalizeKey = randomUUID();
  upload = await call('finalize upload', 'POST', `/api/v1/ingestion/cases/${caseId}/uploads/${upload.id}/finalize`,
    '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/finalize', { json: { requestKey: finalizeKey,
      expectedRevision: upload.revision, expectedCaseRevision: upload.currentCaseRevision, sha256: input.sha256 },
    schema: LargeUploadStatusSchema, expected: 200, requestKey: finalizeKey, ids: { uploadId: upload.id } });
  assert.equal(upload.state, 'retained');
  assert.equal(upload.verifiedSha256, input.sha256);
  const sourceId = upload.source!.sourceId;
  out.retained = { uploadId: upload.id, parts: upload.partCount, partBytes: upload.partBytes, sourceId,
    verifiedSha256: upload.verifiedSha256 };
  state.niagaraSourceId = sourceId;
  saveState();
  const itemKey = randomUUID();
  const item = await call('register item', 'POST', `/api/v1/ingestion/cases/${caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', { json: { requestKey: itemKey, sourceId },
      schema: IntakeItemSchema, expected: 201, requestKey: itemKey, ids: { caseId, sourceId } });
  out.registered = { itemId: item.itemId, format: item.format, family: item.family, sizeClass: item.sizeClass,
    sizeBytes: item.sizeBytes, wave: item.wave, cardSha256: item.cardSha256, cardFormat: item.card?.format ?? null,
    cardPresent: Boolean(item.card), placement: item.placement };
  assert(item.card, 'The registered item carries no card.');
  state.niagaraItemId = item.itemId;
  saveState();
  out.toQuestion = await until(caseId, item.itemId, 'niagara question', entry => Boolean(entry.plan)
    || ['needs_answer', 'not_understood', 'stopped', 'refused'].includes(entry.placement), 40);
  const rested = out.toQuestion.item;
  if (!rested || rested.placement !== 'needs_answer' || !rested.streamedProfileJobId) return out;
  const jobId = rested.streamedProfileJobId;
  const route = `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/streamed-profile/jobs/${jobId}`;
  const pattern = '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}';
  const status = await call('profile status', 'GET', route, pattern, { schema: StreamedProfileStatusSchema,
    expected: 200, ids: { jobId } });
  out.inventory = { status: status.status, caseRevision: status.caseRevision, generation: status.latest?.generation,
    geometryTypes: status.latest?.geometryTypes, paths: status.latest?.paths.length };
  if (status.status !== 'sealed' || !status.latest) return out;
  const choices: Choices = { kind: 'building', identifier: '/features/*/properties/OBJECTID', name: '', height: '',
    unit: '', meaning: '' };
  const authorKey = randomUUID();
  const body = streamedQuestionBody(status.latest as never, choices,
    { caseId: status.caseId, caseRevision: status.caseRevision } as never, 0, authorKey);
  assert(body, 'The Studio builder gave no body for these choices.');
  const authored = await call('author layout at the inventory revision', 'POST', `${route}/recipes`,
    `${pattern}/recipes`, { json: body, schema: StreamedMappingReceiptSchema, expected: 201, requestKey: authorKey,
      ids: { jobId } });
  const approveBody = approvalBody(authored, randomUUID());
  const approved = await call('approve layout', 'POST', `${route}/recipes/${authored.id}/approve`,
    `${pattern}/recipes/{recipeId}/approve`, { json: approveBody, schema: StreamedMappingReceiptSchema,
      expected: 200, requestKey: approveBody.requestKey, ids: { recipeId: authored.id } });
  out.layout = { choices, recipeId: authored.id, authoredState: authored.state, approvedState: approved.state,
    plan: { caseRevision: authored.plan.caseRevision, profileJobId: authored.plan.profileJobId,
      profileGeneration: authored.plan.profileGeneration }, operations: authored.plan.operations
      .map((op: any) => `${op.target} <- ${op.sourcePath} via ${op.conversionId}`) };
  out.toPackages = await until(caseId, item.itemId, 'niagara packages', entry =>
    (entry.partsPlanned && entry.partsDone === entry.partsPlanned)
    || ['stopped', 'refused', 'not_understood'].includes(entry.placement), 40);
  const settled = await packagesSettled(caseId, 15, new Set(state.nycPackages ?? []));
  out.packagesSettledSeconds = settled.seconds;
  out.view = await batchView(caseId, niagaraBox);
  return out;
}

/** Reads only: what the Studio shows for the batch now. */
async function view() {
  return batchView(state.caseId, phase === 'view-niagara' ? niagaraBox : nycBox);
}

async function main() {
  const work = { zip, nyc, niagara, 'view-nyc': view, 'view-niagara': view }[phase as 'zip'];
  assert(work, 'Phase is zip, nyc, niagara, view-nyc or view-niagara.');
  const name = `${evidence}/part-b-${phase}.json`;
  assert(!existsSync(name), `${name} exists: a phase is not run twice.`);
  let result: unknown = null;
  let stoppedAt: unknown = null;
  try {
    result = await work();
  } catch (error: any) {
    stoppedAt = error instanceof Refusal ? { step: error.step, status: error.status,
      code: error.body?.error?.code ?? null, message: error.body?.error?.message ?? null }
      : { error: String(error.message).slice(0, 600) };
    progress({ stoppedAt });
  }
  const value = { phase, at: new Date().toISOString(), api: API, caseId: state.caseId ?? null,
    wallSeconds: Number(((performance.now() - started) / 1000).toFixed(1)), stoppedAt, result,
    requests: rows, quietReads };
  writeFileSync(`${scratch}/part-b-${phase}.raw.json`, JSON.stringify(value, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ phase, stoppedAt, wallSeconds: value.wallSeconds, requests: rows.length }));
}

await main();
