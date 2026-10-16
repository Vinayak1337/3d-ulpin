import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AnyMappingReceiptSchema, AnySourceProfileSchema, CaseIngestionEventSchema, IntakeItemSchema,
  IntakeManifestSchema, IntakeTargetPageSchema, LargeUploadStatusSchema, StreamedMappingReceiptSchema,
  StreamedProfileStatusSchema, type LargeUploadStatus } from '../../../../packages/contracts/src/usp';
import { z } from '../../../../apps/api/node_modules/zod/index.js';
import { caseDetail, sourceCase } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { streamedQuestionBody } from '../../../../apps/studio/src/features/intake/streamed-question-model';
import { httpCalls, intakeHttp, refusedHttp } from './http';
import { freePort, killProcesses, processLog, startProcesses } from './processes';
import { geometryCallCounts, originalStored, startStorage, stopStorage } from './storage';

type Input = { name: string; path: string; bytes: number; sha256: string;
  issuer: string; originalUrl: string; acquiredAt: string; permissionReference: string };
type Item = ReturnType<typeof IntakeItemSchema.parse>;
type Waiter = { until: (item: Item) => boolean; resolve: () => void };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const niagara = JSON.parse(readFileSync('docs/evidence/gf1/da1/result.json', 'utf8')).assets
  .find((value: any) => value.issuer === 'City of Niagara Falls');
const input: Input = { name: 'Niagara', path: niagara.path, bytes: niagara.bytes, sha256: niagara.sha256,
  issuer: niagara.issuer, originalUrl: niagara.originalUrl,
  acquiredAt: new Date(niagara.acquiredAtIst).toISOString(), permissionReference: niagara.licence.textUrl };
const smallPath = 'fixtures/real-nyc/original.geojson';
const evidence: Record<string, any> = {};
const steps: { step: string; status: number; ms: number }[] = [];
const failures: unknown[] = [];
const base = () => `http://127.0.0.1:${process.env.API_PORT}`;
const progressFile = 'docs/evidence/gf1/st1c/progress.jsonl';
const authorRoute = (caseId: string, sourceId: string, jobId: string) =>
  `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/streamed-profile/jobs/${jobId}`;
const authorPattern = '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}';
// The recipe history's published answer: manual and tabular receipts, and the streamed receipt.
const HistorySchema = z.array(z.union([...AnyMappingReceiptSchema.options, StreamedMappingReceiptSchema]));

/** Each recorded row as it happens, so a long walk can be followed from outside. */
function progress(value: Record<string, unknown>) {
  appendFileSync(progressFile, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
}

/** One step of the walk: its HTTP status (each call asserts it) and its wall time. */
async function step<T>(name: string, status: number, work: () => Promise<T>) {
  const started = performance.now();
  const value = await work();
  steps.push({ step: name, status, ms: Math.round(performance.now() - started) });
  progress({ milestone: name, status, ms: steps.at(-1)!.ms });
  return value;
}

function assertOwnBox() {
  const nonce = process.env.ULPIN_ST1C_NONCE!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_ST1C_CONTAINER!;
  assert.equal(container, `ulpin-st1c-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'st1c_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/st1c_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'ST1c']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

async function part(upload: LargeUploadStatus, number: number, bytes: Buffer) {
  const route = `/api/v1/ingestion/cases/${upload.caseId}/uploads/${upload.id}/parts/${number}`;
  const response = await fetch(`${base()}${route}`, { method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Request-Key': randomUUID(),
      'X-Upload-Revision': String(upload.revision), 'X-Case-Revision': String(upload.currentCaseRevision),
      'X-Part-Sha256': sha256(bytes) }, body: bytes });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  return LargeUploadStatusSchema.parse(body);
}

/** As LP3b: a new batch and the upload routes; the stored original is checked byte for byte. */
async function retain(bytes: Buffer) {
  const { caseId } = await intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases', sourceCase,
    { requestKey: randomUUID(), name: `ST1c ${input.name} HTTP boundary test_only` }, 201);
  let upload = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/uploads`,
    '/api/v1/ingestion/cases/{caseId}/uploads', LargeUploadStatusSchema, {
      requestKey: randomUUID(), expectedCaseRevision: 0, filename: input.path.split('/').at(-1),
      mediaType: 'application/octet-stream', bytes: input.bytes, sha256: input.sha256,
      provenance: { issuer: input.issuer, originalUrl: input.originalUrl, acquiredAt: input.acquiredAt,
        permissionReference: input.permissionReference, limitations: ['Foreign test_only; no operational claim.'] },
    }, 201);
  for (let number = 1; number <= upload.partCount; number++) {
    const start = (number - 1) * upload.partBytes;
    upload = await part(upload, number, bytes.subarray(start, Math.min(input.bytes, start + upload.partBytes)));
  }
  upload = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/uploads/${upload.id}/finalize`,
    '/api/v1/ingestion/cases/{caseId}/uploads/{uploadId}/finalize', LargeUploadStatusSchema, {
      requestKey: randomUUID(), expectedRevision: upload.revision, expectedCaseRevision: upload.currentCaseRevision,
      sha256: input.sha256,
    }, 200);
  assert.equal(upload.state, 'retained');
  assert.equal(upload.verifiedSha256, input.sha256);
  assert(upload.source);
  assert(originalStored(upload.source.sourceId, input.sha256, input.bytes));
  return { caseId, sourceId: upload.source.sourceId, uploadId: upload.id, parts: upload.partCount };
}

const manifest = (caseId: string) => intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/intake`,
  '/api/v1/ingestion/cases/{caseId}/intake', IntakeManifestSchema);
const caseRevision = async (caseId: string) =>
  (await intakeHttp('GET', `/api/v1/cases/${caseId}`, '/api/v1/cases/{caseId}', caseDetail)).case.revision;
const targetPage = (caseId: string) => intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
  '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);

/** One live reader of the case's own event stream; each change reads the manifest once. */
class Watch {
  rows: Record<string, unknown>[] = [];
  events = 0;
  readFailures = 0;
  item?: Item;
  private last = '';
  private busy = false;
  private dirty = false;
  private waiters: Waiter[] = [];
  private controller?: AbortController;

  constructor(readonly caseId: string, readonly itemId: string, readonly started: number) {}

  async follow() {
    this.controller = new AbortController();
    const response = await fetch(`${base()}/api/v1/ingestion/cases/${this.caseId}/events`,
      { signal: this.controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    this.consume(response.body!.getReader()).catch(() => { /* Closing the walk ends the stream. */ });
    this.poke();
  }

  close() {
    this.controller?.abort();
  }

  private async consume(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const part = await reader.read();
      if (part.done) return;
      pending += decoder.decode(part.value, { stream: true });
      let edge: number;
      while ((edge = pending.indexOf('\n\n')) >= 0) {
        const lines = pending.slice(0, edge).split('\n');
        pending = pending.slice(edge + 2);
        if (!lines.includes('event: ingestion.change')) continue;
        CaseIngestionEventSchema.parse(JSON.parse(lines.find(line => line.startsWith('data: '))!.slice(6)));
        this.events++;
        this.poke();
      }
    }
  }

  poke() {
    if (this.busy) {
      this.dirty = true;
      return;
    }
    this.busy = true;
    this.read().catch(() => { this.readFailures++; }).finally(() => {
      this.busy = false;
      if (!this.dirty) return;
      this.dirty = false;
      this.poke();
    });
  }

  private async read() {
    const item = (await manifest(this.caseId)).items.find(entry => entry.itemId === this.itemId)!;
    this.item = item;
    const row = { state: item.state, placement: item.placement, partsPlanned: item.partsPlanned,
      partsDone: item.partsDone, recordsSeen: item.recordsSeen, limitReason: item.limitReason,
      streamedProfileJobId: item.streamedProfileJobId,
      plan: item.plan && { recipeState: item.plan.recipeState, packageId: item.plan.packageId } };
    const key = JSON.stringify(row);
    if (key !== this.last) {
      this.rows.push({ msSinceRegister: Math.round(performance.now() - this.started), ...row });
      progress({ caseId: this.caseId, ...this.rows.at(-1) });
      this.last = key;
    }
    for (const waiter of [...this.waiters]) {
      if (!waiter.until(item)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  }

  /** Events wake the read; a slow tick covers a missed one. */
  async until(label: string, until: Waiter['until'], minutes: number) {
    const tick = setInterval(() => this.poke(), 5000);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Not reached in ${minutes} min: ${label}; `
          + JSON.stringify(this.rows.at(-1)))), minutes * 60000);
        this.waiters.push({ until, resolve: () => { clearTimeout(timer); resolve(); } });
        this.poke();
      });
    } finally {
      clearInterval(tick);
    }
    return Math.round(performance.now() - this.started);
  }
}

/** The first package is read over the batch's own target page, not the database. */
async function firstPackage(caseId: string, minutes: number) {
  const deadline = performance.now() + minutes * 60000;
  while (performance.now() < deadline) {
    const page = await targetPage(caseId);
    if (page.packages.length >= 1) return page;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw new Error(`No package drafted in ${minutes} min.`);
}

/** Counts that a refused request must leave as they were. */
async function recipeCounts(caseId: string, sourceId: string) {
  const recipe = (await query('SELECT id,revision,state FROM usp_mapping_recipes WHERE case_id=$1 AND source_id=$2',
    [caseId, sourceId])).rows[0];
  return { recipe, revisions: Number((await query(
    'SELECT count(*) n FROM usp_mapping_recipe_revisions WHERE recipe_id=$1', [recipe.id])).rows[0].n),
  operations: Number((await query(`SELECT count(*) n FROM operations WHERE case_id=$1 AND kind='streamed-mapping'`,
    [caseId])).rows[0].n) };
}

async function walk() {
  const original = readFileSync(input.path);
  assert.equal(original.length, input.bytes);
  assert.equal(sha256(original), input.sha256);
  const small = readFileSync(smallPath);
  const e: Record<string, any> = evidence.walk = {
    input: { name: input.name, bytes: input.bytes, sha256: input.sha256 },
    small: { path: smallPath, bytes: small.length, sha256: sha256(small) } };
  try {
    // 1. Register the Niagara file through the intake routes; confirm its card.
    const batch = await step('upload', 200, () => retain(original));
    e.batch = batch;
    const registered = await step('register', 201, async () => {
      const started = performance.now();
      const item = await intakeHttp('POST', `/api/v1/ingestion/cases/${batch.caseId}/intake/items`,
        '/api/v1/ingestion/cases/{caseId}/intake/items', IntakeItemSchema,
        { requestKey: randomUUID(), sourceId: batch.sourceId }, 201);
      return { item, started };
    });
    assert.equal(registered.item.format, 'geojson');
    assert.equal(registered.item.sizeBytes, input.bytes);
    assert(registered.item.card);
    e.registered = { itemId: registered.item.itemId, format: registered.item.format, family: registered.item.family,
      sizeClass: registered.item.sizeClass, sizeBytes: registered.item.sizeBytes, wave: registered.item.wave,
      cardSha256: registered.item.cardSha256, cardFormat: registered.item.card.format,
      streamedProfileJobId: registered.item.streamedProfileJobId };
    const watch = new Watch(batch.caseId, registered.item.itemId, registered.started);
    await watch.follow();
    e.watch = watch;

    // 2. The manifest, over HTTP only, until the item rests on the layout question.
    e.needsAnswerMs = await watch.until('needs_answer',
      row => row.placement === 'needs_answer' || row.placement === 'not_understood', 40);
    const rested = await step('manifest at the question', 200, async () => (await manifest(batch.caseId)).items
      .find(entry => entry.itemId === registered.item.itemId)!);
    assert.equal(rested.placement, 'needs_answer');
    const jobId = rested.streamedProfileJobId;
    assert(jobId, 'The manifest names no streamed inventory for the item.');
    e.question = { placement: rested.placement, limitReason: rested.limitReason,
      manifestStreamedProfileJobId: jobId };
    const status = await step('profile status', 200, () => intakeHttp('GET',
      authorRoute(batch.caseId, batch.sourceId, jobId), authorPattern, StreamedProfileStatusSchema));
    assert.equal(status.status, 'sealed');
    assert(status.latest);

    // 3. Another file in the same case, so the case's revision moves on.
    const before = await step('case revision before', 200, () => caseRevision(batch.caseId));
    const second = await step('second file retained', 201, () => {
      const form = new FormData();
      form.set('file', new File([small], 'original.geojson', { type: 'application/geo+json' }));
      form.set('format', 'geojson');
      form.set('requestKey', randomUUID());
      form.set('expectedWorkspaceRevision', String(before));
      return intakeHttp('POST', `/api/v1/ingestion/cases/${batch.caseId}/sources`,
        '/api/v1/ingestion/cases/{caseId}/sources', AnySourceProfileSchema, form, 201);
    });
    const secondItem = await step('second file registered', 201, () => intakeHttp('POST',
      `/api/v1/ingestion/cases/${batch.caseId}/intake/items`, '/api/v1/ingestion/cases/{caseId}/intake/items',
      IntakeItemSchema, { requestKey: randomUUID(), sourceId: second.source.sourceId }, 201));
    const after = await step('case revision after', 200, () => caseRevision(batch.caseId));
    e.caseMovedOn = { caseRevisionBefore: before, caseRevisionAfter: after, profileCaseRevision: status.caseRevision,
      secondSourceId: second.source.sourceId, secondItemId: secondItem.itemId };
    assert(after > status.caseRevision, JSON.stringify(e.caseMovedOn));

    // 4. The plan as the Studio builds it, pinned to the inventory's own revision; then the current one.
    const choices = { kind: 'building' as const, identifier: '/features/*/properties/OBJECTID', name: '',
      height: '', unit: '' as const, meaning: '' };
    const studioBody = (revision: number, requestKey: string, expectedRecipeRevision: number) => {
      const body = streamedQuestionBody(status.latest as never, choices,
        { caseId: status.caseId, caseRevision: revision } as never, expectedRecipeRevision, requestKey);
      assert(body);
      return body;
    };
    const identifier = status.latest.paths.find(path => path.path === choices.identifier);
    const authored = await step('author at the inventory revision', 201, () => intakeHttp('POST',
      `${authorRoute(batch.caseId, batch.sourceId, jobId)}/recipes`, `${authorPattern}/recipes`,
      StreamedMappingReceiptSchema, studioBody(status.caseRevision, randomUUID(), 0), 201));
    assert.equal(authored.state, 'proposed');
    const operations = authored.plan.operations.map(
      item => `${item.target} <- ${item.sourcePath} via ${item.conversionId}`);
    const current = await caseRevision(batch.caseId);
    assert.notEqual(current, status.caseRevision);
    const countsBefore = await recipeCounts(batch.caseId, batch.sourceId);
    const refusal = await step('author at the current case revision', 409, () => refusedHttp(
      `${authorRoute(batch.caseId, batch.sourceId, jobId)}/recipes`, `${authorPattern}/recipes`,
      studioBody(current, randomUUID(), authored.revision), 409));
    const countsAfter = await recipeCounts(batch.caseId, batch.sourceId);
    e.layout = { kind: 'building', identifier: choices.identifier, identifierPath: identifier,
      operations, plan: { caseRevision: authored.plan.caseRevision, profileJobId: authored.plan.profileJobId,
        profileGeneration: authored.plan.profileGeneration }, recipeId: authored.id,
      refusedAtCaseRevision: current, refusal: refusal.error,
      unchangedAfterRefusal: JSON.stringify(countsBefore) === JSON.stringify(countsAfter)
        && (await caseRevision(batch.caseId)) === current, countsBefore, countsAfter };

    // 5. Approve, then read the history route and parse all of it with the published answer.
    const approved = await step('approve', 200, () => intakeHttp('POST',
      `${authorRoute(batch.caseId, batch.sourceId, jobId)}/recipes/${authored.id}/approve`,
      `${authorPattern}/recipes/{recipeId}/approve`, StreamedMappingReceiptSchema,
      { requestKey: randomUUID(), expectedRecipeRevision: authored.revision }, 200));
    assert.equal(approved.state, 'approved');
    const history = await step('recipe history', 200, () => intakeHttp('GET',
      `/api/v1/ingestion/cases/${batch.caseId}/recipes/${authored.id}`,
      '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}', HistorySchema));
    e.history = { revisions: history.map(entry => ({ revision: entry.revision, state: entry.state })),
      streamed: history.every(entry => 'plan' in entry && entry.plan.version === 'streamed-mapping/1') };

    // 6. The import runs on until the first package is drafted.
    e.firstPackageMs = await step('first package drafted', 200, async () => {
      const started = performance.now();
      const page = await firstPackage(batch.caseId, 30);
      e.firstPackage = { packages: page.packages.length, packageId: page.packages[0].packageId,
        state: page.packages[0].state, targetCounts: page.counts };
      return Math.round(performance.now() - started);
    });
    e.stoppedAt = 'first package drafted';
    e.manifestRows = watch.rows;
  } finally {
    const source = evidence.walk.batch?.sourceId;
    if (source) {
      e.tables = {
        profileImports: (await query(`SELECT job_id,sealed_generation,state FROM usp_streamed_profile_imports
          WHERE source_id=$1 ORDER BY created_at`, [source])).rows,
        parts: (await query(`SELECT part.part_index,part.result_ref->>'packageId' package_id,
            jsonb_array_length(p.body->'features') features
          FROM usp_intake_parts part JOIN import_packages p ON p.id::text=part.result_ref->>'packageId'
          WHERE part.item_id=$1 ORDER BY part.part_index`, [evidence.walk.registered?.itemId])).rows,
      };
    }
    evidence.walk.watch?.close?.();
  }
}

function report() {
  const watch = evidence.walk?.watch as Watch | undefined;
  if (watch) evidence.walk.watch = { events: watch.events, readFailures: watch.readFailures };
  return { task: 'ST1c', evidence, steps, httpCalls: httpCalls(), processes: processLog(),
    geometryCalls: geometryCallCounts(), failures, providerCalls: 0,
    originalHashesUnchanged: sha256(readFileSync(input.path)) === input.sha256,
    qualification: 'Actual HTTP boundary; the product API and dispatcher run as their own processes; '
      + 'in-memory loopback S3 and the product geo Python as stand-ins.' };
}

async function main() {
  assertOwnBox();
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await query(sql('ingestion.intake.targets'));
    await startStorage();
    process.env.API_PORT = String(await freePort());
    await startProcesses();
    await walk();
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n') });
    progress({ milestone: 'failed', message: error.message });
    process.exitCode = 1;
  } finally {
    await killProcesses();
    await stopStorage();
    await closePool();
    console.log(JSON.stringify(report()));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failure: error.message }));
  process.exitCode = 1;
});
