import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { CaseIngestionEventSchema, IntakeConfirmationSchema, IntakeItemSchema, IntakeManifestSchema,
  IntakeTargetPageSchema, LargeUploadStatusSchema, StreamedMappingReceiptSchema, StreamedProfileStatusSchema,
  type IntakeConfirmation, type IntakeTarget, type LargeUploadStatus,
  type StreamedMappingPlan } from '../../../../packages/contracts/src/usp';
import { caseDetail, sourceCase } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { unfinishedIntakePackagesTx } from '../../../../packages/server/src/modules/usp/ingestion/intake-ledger';
import { INTAKE_LARGE_STOPPED } from '../../../../packages/server/src/modules/usp/ingestion/intake-large';
import { featurePropertiesExtract } from '../../../../packages/server/src/modules/usp/packets/feature-extract';
import { readPropertyCard } from '../../../../packages/server/src/modules/usp/packets/card-service';
import { readPacket0 } from '../../../../packages/server/src/modules/usp/packet0';
import { localRequestContext } from '../../../../packages/server/src/modules/usp/principal';
import { httpCalls, intakeHttp, verifyCardLink } from './http';
import { freePort, killProcesses, processLog, startProcesses } from './processes';
import { geometryCallCounts, originalStored, startStorage, stopStorage } from './storage';

type Input = { name: string; path: string; bytes: number; sha256: string;
  issuer: string; originalUrl: string; acquiredAt: string; permissionReference: string };
type Item = ReturnType<typeof IntakeItemSchema.parse>;
type Ledger = { parts: number; unreviewed: number; prepared: number; preparing: number };
type Waiter = { label: string; until: (item: Item, ledger: Ledger) => boolean; resolve: () => void };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const da6 = JSON.parse(readFileSync('docs/evidence/gf1/da6/result.json', 'utf8')).assets[0];
const niagara = JSON.parse(readFileSync('docs/evidence/gf1/da1/result.json', 'utf8')).assets
  .find((value: any) => value.issuer === 'City of Niagara Falls');
const inputs: Input[] = [
  { name: 'DA6', path: da6.retainedPath, bytes: da6.bytes, sha256: da6.sha256,
    issuer: da6.issuer, originalUrl: da6.originalUrl,
    acquiredAt: new Date(da6.acquiredAtIst).toISOString(),
    permissionReference: 'Licence unstated; permission unconfirmed' },
  { name: 'Niagara', path: niagara.path, bytes: niagara.bytes, sha256: niagara.sha256,
    issuer: niagara.issuer, originalUrl: niagara.originalUrl,
    acquiredAt: new Date(niagara.acquiredAtIst).toISOString(), permissionReference: niagara.licence.textUrl },
];
const evidence: Record<string, any> = {};
const failures: unknown[] = [];
const sends: { at: string; route: string }[] = [];
const base = () => `http://127.0.0.1:${process.env.API_PORT}`;
const progressFile = 'docs/evidence/gf1/lp3c/progress.jsonl';

/** Each recorded row as it happens, so a long walk can be followed from outside. */
function progress(value: Record<string, unknown>) {
  appendFileSync(progressFile, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`);
}

function assertOwnBox() {
  const nonce = process.env.ULPIN_LP3C_NONCE!;
  assert.match(nonce, /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_LP3C_CONTAINER!;
  assert.equal(container, `ulpin-lp3c-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'lp3c_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/lp3c_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LP3c']]) {
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

/** Step 1, as LP3b: a new batch and the upload routes; the stored original is checked byte for byte. */
async function retain(input: Input, bytes: Buffer) {
  const { caseId } = await intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases', sourceCase,
    { requestKey: randomUUID(), name: `LP3c ${input.name} HTTP boundary test_only` }, 201);
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

async function ledger(itemId: string, caseId: string): Promise<Ledger> {
  const client = await pool().connect();
  try {
    const parts = Number((await client.query('SELECT count(*)::int n FROM usp_intake_parts WHERE item_id=$1',
      [itemId])).rows[0].n);
    const unreviewed = await unfinishedIntakePackagesTx(client, itemId);
    const prepare = (await client.query(`SELECT count(*) FILTER (WHERE status='succeeded')::int done,
      count(*) FILTER (WHERE status<>'succeeded')::int open FROM jobs
      WHERE case_id=$1 AND operation='intake-run' AND payload->>'phase'='prepare'`, [caseId])).rows[0];
    return { parts, unreviewed, prepared: prepare.done, preparing: prepare.open };
  } finally {
    client.release();
  }
}

/** One live reader of the case's own event stream; each change reads the manifest row and the ledger once. */
class Watch {
  rows: Record<string, unknown>[] = [];
  events = 0;
  readFailures = 0;
  maxUnreviewedRead = 0;
  item?: Item;
  private last = '';
  private busy = false;
  private dirty = false;
  private waiters: Waiter[] = [];
  private changed: (() => void)[] = [];
  private controller?: AbortController;

  constructor(readonly caseId: string, readonly itemId: string, readonly started: number) {}

  async follow() {
    this.controller = new AbortController();
    const response = await fetch(`${base()}/api/v1/ingestion/cases/${this.caseId}/events`,
      { signal: this.controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    this.consume(response.body!.getReader()).catch(() => { /* A killed API ends the stream; follow() reopens it. */ });
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
        for (const wake of this.changed.splice(0)) wake();
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
    const manifest = await intakeHttp('GET', `/api/v1/ingestion/cases/${this.caseId}/intake`,
      '/api/v1/ingestion/cases/{caseId}/intake', IntakeManifestSchema);
    const item = manifest.items.find(entry => entry.itemId === this.itemId)!;
    const counts = await ledger(this.itemId, this.caseId);
    this.item = item;
    this.maxUnreviewedRead = Math.max(this.maxUnreviewedRead, counts.unreviewed);
    const row = { state: item.state, placement: item.placement, partsPlanned: item.partsPlanned,
      partsDone: item.partsDone, recordsSeen: item.recordsSeen, limitReason: item.limitReason,
      plan: item.plan && { recipeState: item.plan.recipeState, packageId: item.plan.packageId } };
    const key = JSON.stringify(row);
    if (key !== this.last) {
      this.rows.push({ msSinceRegister: Math.round(performance.now() - this.started), ...row, ledger: counts });
      progress({ caseId: this.caseId, ...this.rows.at(-1) });
      this.last = key;
    }
    for (const waiter of [...this.waiters]) {
      if (!waiter.until(item, counts)) continue;
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  }

  /** The next change on the stream, or five seconds, whichever is first. */
  nextChange() {
    return new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5000);
      this.changed.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Events wake the read; a slow tick covers the seconds the API is down during the restart. */
  async until(label: string, until: Waiter['until'], minutes: number) {
    const tick = setInterval(() => this.poke(), 5000);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Not reached in ${minutes} min: ${label}; `
          + JSON.stringify(this.rows.at(-1)))), minutes * 60000);
        this.waiters.push({ label, until, resolve: () => { clearTimeout(timer); resolve(); } });
        this.poke();
      });
    } finally {
      clearInterval(tick);
    }
    return Math.round(performance.now() - this.started);
  }
}

async function register(caseId: string, sourceId: string) {
  const started = performance.now();
  const item = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', IntakeItemSchema,
    { requestKey: randomUUID(), sourceId }, 201);
  sends.push({ at: new Date().toISOString(), route: 'register' });
  progress({ milestone: 'registered', caseId, sourceId });
  return { item, started, registerMs: Math.round(performance.now() - started) };
}

function layout(caseId: string, caseRevision: number,
  profile: NonNullable<ReturnType<typeof StreamedProfileStatusSchema.parse>['latest']>): StreamedMappingPlan {
  return { version: 'streamed-mapping/1', mode: 'streamed_mapping', scope: 'accepted_source_features',
    basis: 'officer_stated', source: profile.source, caseId, caseRevision,
    rawJobId: profile.rawJobId, profileJobId: profile.jobId, profileGeneration: profile.generation,
    profileHash: profile.generationHash, semanticEvidence: [], operations: [
      { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
        conversionId: 'literal_identifier@1' },
      { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
    ] };
}

/** Step 3: the officer's answer, a streamed layout naming doitt_id, no name and no height, then its approval. */
async function answer(caseId: string, sourceId: string, watch: Watch) {
  const profileJob = (await query(`SELECT job_id FROM usp_streamed_profile_imports WHERE source_id=$1`,
    [sourceId])).rows[0].job_id;
  const route = `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/streamed-profile/jobs/${profileJob}`;
  const status = await intakeHttp('GET', route,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}', StreamedProfileStatusSchema);
  assert.equal(status.status, 'sealed');
  assert(status.latest);
  const detail = await intakeHttp('GET', `/api/v1/cases/${caseId}`, '/api/v1/cases/{caseId}', caseDetail);
  const authored = await intakeHttp('POST', `${route}/recipes`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/recipes',
    StreamedMappingReceiptSchema, { requestKey: randomUUID(), expectedRecipeRevision: 0,
      plan: layout(caseId, detail.case.revision, status.latest) }, 201);
  sends.push({ at: new Date().toISOString(), route: 'layout author' });
  assert.equal(authored.state, 'proposed');
  const afterAuthor = await watch.until('plan proposed', item => item.plan?.recipeState === 'proposed', 2);
  const approved = await intakeHttp('POST', `${route}/recipes/${authored.id}/approve`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/streamed-profile/jobs/{jobId}/recipes/{recipeId}/approve',
    StreamedMappingReceiptSchema, { requestKey: randomUUID(), expectedRecipeRevision: authored.revision }, 200);
  const approvedAt = (await query('SELECT clock_timestamp() t')).rows[0].t as Date;
  sends.push({ at: new Date().toISOString(), route: 'layout approve' });
  assert.equal(approved.state, 'approved');
  const afterApprove = await watch.until('plan approved', item => item.plan?.recipeState === 'approved', 2);
  return { profile: { jobId: status.jobId, generation: status.latest.generation, recordsSeen: status.latest.recordsSeen,
    paths: status.latest.paths.length }, recipeId: approved.id, planHash: approved.planHash,
  basis: approved.plan.basis, afterAuthorMs: afterAuthor, afterApproveMs: afterApprove, approvedAt };
}

/** Step 5: both processes stop hard while cuts are being drafted, then start again; the database stays up. */
async function restart(itemId: string, caseId: string, watch: Watch) {
  const before = await ledger(itemId, caseId);
  const jobs = (await query(`SELECT id,status,attempts,next_attempt_at FROM jobs
    WHERE operation='intake-large' AND status IN ('queued','running')`)).rows;
  const killedAt = new Date().toISOString();
  progress({ milestone: 'killing the API and the dispatcher', parts: before.parts });
  watch.close();
  await killProcesses();
  await startProcesses();
  await watch.follow();
  progress({ milestone: 'restarted' });
  return { killedAt, restartedAt: new Date().toISOString(), partsAtKill: before.parts,
    unreviewedAtKill: before.unreviewed, openStepJobsAtKill: jobs };
}

async function partsLedger(itemId: string) {
  const parts = (await query(`SELECT part.part_index,part.locator,part.counts,part.result_ref->>'packageId' package_id,
      part.created_at,p.state,jsonb_array_length(p.body->'features') features,
      (SELECT max(completed_at) FROM jobs j WHERE j.operation='intake-run' AND j.payload->>'phase'='prepare'
        AND j.payload->>'packageId'=part.result_ref->>'packageId' AND j.status='succeeded') reviewed_at
    FROM usp_intake_parts part JOIN import_packages p ON p.id::text=part.result_ref->>'packageId'
    WHERE part.item_id=$1 ORDER BY part.part_index`, [itemId])).rows;
  return parts;
}

/** The highest number of drafted, unreviewed packages at any instant, from the stored times. */
function maxUnreviewed(parts: Awaited<ReturnType<typeof partsLedger>>) {
  return Math.max(0, ...parts.map(at => parts.filter(row => row.created_at <= at.created_at
    && (!row.reviewed_at || row.reviewed_at > at.created_at)).length));
}

/** Every cut once, in order: consecutive indexes, one package each, and no feature in two cuts. */
function disjoint(parts: Awaited<ReturnType<typeof partsLedger>>) {
  const features = parts.flatMap(row => row.locator.featureIndices as number[]);
  return parts.every((row, index) => row.part_index === index && (index === 0
    || row.locator.featureIndices[0] > parts[index - 1].locator.featureIndices.at(-1)))
    && new Set(parts.map(row => row.package_id)).size === parts.length && new Set(features).size === features.length;
}

async function stepJobs(sourceId: string) {
  return (await query(`SELECT count(*)::int jobs,coalesce(sum(attempts),0)::int attempts,
      count(*) FILTER (WHERE status='succeeded')::int succeeded,count(*) FILTER (WHERE attempts>1)::int retried,
      count(*) FILTER (WHERE status NOT IN ('succeeded'))::int open
    FROM jobs WHERE operation='intake-large' AND payload->>'sourceId'=$1`, [sourceId])).rows[0];
}

async function targetPage(caseId: string) {
  return intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
}

/** Step 6's choice: one ready building in the first, the middle and the last package. */
async function chooseThree(caseId: string, parts: Awaited<ReturnType<typeof partsLedger>>) {
  const page = await targetPage(caseId);
  const chosen = [];
  for (const wanted of [0, Math.floor((parts.length - 1) / 2), parts.length - 1]) {
    const pkg = page.packages.find(entry => entry.packageId === parts[wanted].package_id)!;
    const target = (await query(`SELECT target_id FROM usp_intake_targets WHERE package_id=$1 AND readiness='ready'
      ORDER BY locator LIMIT 1`, [pkg.packageId])).rows[0];
    assert(target && pkg.reviewFingerprint, `Package of part ${wanted} has no ready building.`);
    chosen.push({ part: wanted, targetId: target.target_id as string,
      pin: { packageId: pkg.packageId, revision: pkg.revision, reviewFingerprint: pkg.reviewFingerprint } });
  }
  return { page, chosen };
}

async function confirm(caseId: string, chosen: Awaited<ReturnType<typeof chooseThree>>['chosen']) {
  const route = `/api/v1/ingestion/cases/${caseId}/confirmations`;
  const pressed = performance.now();
  const confirmation = await intakeHttp('POST', route, '/api/v1/ingestion/cases/{caseId}/confirmations',
    IntakeConfirmationSchema, { requestKey: randomUUID(), acknowledgement:
      'LP3c test_only: record cited publisher exteriors; heights, floors, units and rights remain unknown.',
    packages: chosen.map(entry => entry.pin), targets: chosen.map(entry => entry.targetId) });
  sends.push({ at: new Date().toISOString(), route: 'confirmation' });
  return { confirmation, pressed };
}

async function carded(caseId: string, confirmationId: string, watch: Watch) {
  let final: IntakeConfirmation | undefined;
  const read = async () => {
    final = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/confirmations/${confirmationId}`,
      '/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}', IntakeConfirmationSchema);
    return final.counts.carded === 3 || final.counts.stopped > 0;
  };
  const deadline = performance.now() + 40 * 60000;
  while (performance.now() < deadline && !(await read())) await watch.nextChange();
  assert(final && final.counts.carded === 3, JSON.stringify(final?.counts));
  return final;
}

/** E1b's card check, then LP2's: the building's own words read back from its byte range in the original. */
async function cardEvidence(target: IntakeTarget, original: Buffer, filename: string) {
  const made = target.artefacts.card!;
  const ctx = localRequestContext(randomUUID());
  const view = await readPropertyCard(ctx, { cardId: made.id, revision: made.revision });
  const citation = view.card.facts.find(fact => fact.key === 'source_citation')?.value;
  assert.equal(citation, `${filename}, ${target.locator}`);
  assert.equal(target.artefacts.verification, 'consistent');
  assert.equal(await verifyCardLink(view.card.resolverUrl), 'consistent');
  const feature = (await query(`SELECT f FROM import_packages p,jsonb_array_elements(p.body->'features') f
    WHERE p.id=$1 AND f->>'id'=$2`, [target.packageId, target.featureId])).rows[0].f;
  const range = feature.sourceReference.sourceRange;
  const span = original.subarray(range.byteStart, range.byteEnd);
  assert.equal(sha256(span), range.rawSha256);
  const words = featurePropertiesExtract(original, range.featureIndex);
  assert(words && span.toString().includes(words));
  assert.equal(String(JSON.parse(span.toString()).properties.doitt_id), feature.sourceKey);
  assert.equal(target.locator, `feature ${feature.sourceKey}`);
  const packet = await readPacket0(ctx, target.artefacts.packet!.id);
  return { targetId: target.targetId, locator: target.locator, cardId: made.id, citation,
    link: view.card.resolverUrl, verification: target.artefacts.verification,
    range: { featureIndex: range.featureIndex, byteStart: range.byteStart, byteEnd: range.byteEnd },
    rangeSha256Matches: true, words,
    packetCarriesWords: packet.bytes.toString().includes(words.replaceAll('"', '""')) };
}

async function drafting(batch: Awaited<ReturnType<typeof retain>>, itemId: string, watch: Watch) {
  const restarted = await watch.until('four cuts drafted', (_item, counts) => counts.parts >= 4, 30)
    .then(() => restart(itemId, batch.caseId, watch));
  const endMs = await watch.until('last cut drafted', item => item.state === 'read'
    || item.placement === 'not_understood', 60);
  const reviewedMs = await watch.until('every package reviewed', (_item, counts) => counts.unreviewed === 0
    && counts.preparing === 0 && counts.prepared === counts.parts, 30);
  return { restarted, endMs, reviewedMs };
}

async function walkDa6(input: Input) {
  const original = readFileSync(input.path);
  assert.equal(original.length, input.bytes);
  assert.equal(sha256(original), input.sha256);
  const batch = await retain(input, original);
  evidence.da6 = { input: { name: input.name, bytes: input.bytes, sha256: input.sha256 }, batch };
  const { item, started, registerMs } = await register(batch.caseId, batch.sourceId);
  const watch = new Watch(batch.caseId, item.itemId, started);
  await watch.follow();
  evidence.da6.watch = watch;
  evidence.da6.registered = { registerMs, row: item };
  evidence.da6.needsAnswerMs = await watch.until('needs_answer', row => row.placement === 'needs_answer', 40);
  evidence.da6.question = watch.item!.limitReason;
  evidence.da6.layout = await answer(batch.caseId, batch.sourceId, watch);
  evidence.da6.drafting = await drafting(batch, item.itemId, watch);
  const parts = await partsLedger(item.itemId);
  const approvedAt = evidence.da6.layout.approvedAt.getTime();
  const reviewed = parts.map(row => row.reviewed_at.getTime());
  evidence.da6.parts = parts.map(row => ({ index: row.part_index, packageId: row.package_id, features: row.features,
    firstFeatureIndex: row.locator.featureIndices[0], lastFeatureIndex: row.locator.featureIndices.at(-1),
    featureIndices: row.locator.featureIndices.length, counts: row.counts, draftedAt: row.created_at,
    reviewedAt: row.reviewed_at }));
  evidence.da6.step4 = { approvalToFirstDraftedMs: parts[0].created_at.getTime() - approvedAt,
    approvalToFirstReviewedMs: Math.min(...reviewed) - approvedAt,
    approvalToLastDraftedMs: parts.at(-1)!.created_at.getTime() - approvedAt,
    approvalToLastReviewedMs: Math.max(...reviewed) - approvedAt, packages: parts.length,
    final: watch.rows.at(-1), maxUnreviewedAtOnce: maxUnreviewed(parts), maxUnreviewedRead: watch.maxUnreviewedRead,
    featuresInPackages: parts.reduce((sum, row) => sum + row.features, 0) };
  evidence.da6.cutsOnceInOrder = disjoint(parts);
  evidence.da6.stepJobs = await stepJobs(batch.sourceId);
  const { page, chosen } = await chooseThree(batch.caseId, parts);
  evidence.da6.targetsBeforeConfirmation = page.counts;
  evidence.da6.packagesOnPage = page.packages.length;
  progress({ milestone: 'confirming three buildings', chosen });
  const { confirmation, pressed } = await confirm(batch.caseId, chosen);
  const final = await carded(batch.caseId, confirmation.confirmationId, watch);
  const cardsMs = Math.round(performance.now() - pressed);
  const filename = input.path.split('/').at(-1)!;
  const cards = [];
  for (const target of final.progress) cards.push(await cardEvidence(target, original, filename));
  evidence.da6.confirmation = { chosen, counts: final.counts, findingCounts: final.findingCounts, cardsMs, cards };
  evidence.da6.targetsAfter = (await targetPage(batch.caseId)).counts;
  watch.close();
}

async function walkNiagara(input: Input) {
  const original = readFileSync(input.path);
  assert.equal(sha256(original), input.sha256);
  const batch = await retain(input, original);
  const { item, started, registerMs } = await register(batch.caseId, batch.sourceId);
  const watch = new Watch(batch.caseId, item.itemId, started);
  await watch.follow();
  evidence.niagara = { input: { name: input.name, bytes: input.bytes, sha256: input.sha256 }, batch, registerMs,
    watch };
  evidence.niagara.restMs = await watch.until('at rest', row => row.placement === 'not_understood'
    || row.state === 'read', 20);
  const packages = (await query('SELECT count(*)::int n FROM import_packages WHERE case_id=$1',
    [batch.caseId])).rows[0].n;
  evidence.niagara.final = { state: watch.item!.state, placement: watch.item!.placement,
    sentence: watch.item!.limitReason, packages, stepJobs: await stepJobs(batch.sourceId) };
  watch.close();
}

function report() {
  const rows = (watch?: Watch) => watch && { rows: watch.rows, events: watch.events, readFailures: watch.readFailures };
  if (evidence.da6?.watch) evidence.da6.watch = rows(evidence.da6.watch);
  if (evidence.niagara?.watch) evidence.niagara.watch = rows(evidence.niagara.watch);
  return { task: 'LP3c', evidence, sends, httpCalls: httpCalls(), processes: processLog(),
    geometryCalls: geometryCallCounts(), stoppedSentence: INTAKE_LARGE_STOPPED, failures, providerCalls: 0,
    originalHashesUnchanged: inputs.every(input => sha256(readFileSync(input.path)) === input.sha256),
    qualification: 'Actual HTTP upload/register/answer/confirm boundary; the product API and dispatcher '
      + 'run as their own processes; in-memory loopback S3 and the product geo Python as stand-ins.' };
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
    await walkDa6(inputs[0]);
    await walkNiagara(inputs[1]);
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n') });
    progress({ milestone: 'failed', message: error.message });
    process.exitCode = 1;
  } finally {
    evidence.da6?.watch?.close?.();
    evidence.niagara?.watch?.close?.();
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
