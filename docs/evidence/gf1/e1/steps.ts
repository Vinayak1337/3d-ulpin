import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import type { IntakeConfirm, IntakeConfirmation, IntakeTarget,
  MappingReceipt, SourceProfile } from '../../../../packages/contracts/src/usp';
import type { ImportPackage, MapArea } from '../../../../packages/contracts/src';
import { IntakeConfirmationSchema, IntakeTargetPageSchema, IntakeTargetSchema }
  from '../../../../packages/contracts/src/usp';
import { intakeHttp, rejectedHttp, startHttp, stopHttp, verifyCardLink } from './http';
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { getArea, getPackage, ingestArea, reviewPackage, commitPackage }
  from '../../../../packages/server/src/modules/areas/areas';
import { createSourceCase } from '../../../../packages/server/src/modules/cases/source-cases';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { ManualIngestionService } from '../../../../packages/server/src/modules/usp/ingestion/service';
import { IntakeService } from '../../../../packages/server/src/modules/usp/ingestion/intake-service';
import { readIntakeConfirmation }
  from '../../../../packages/server/src/modules/usp/ingestion/intake-confirmations';
import { nextIntakeRunJob, intakeRunKey } from '../../../../packages/server/src/modules/usp/ingestion/intake-run';
import { intakeRunSteps, runIntakeRunJob }
  from '../../../../packages/server/src/modules/usp/ingestion/intake-run-worker';
import { intakeDestination, officerQuestion }
  from '../../../../packages/server/src/modules/usp/ingestion/intake-draft-worker';
import { AppError } from '../../../../packages/server/src/infrastructure/errors';
import { readPropertyCard } from '../../../../packages/server/src/modules/usp/packets/card-service';
import { localRequestContext } from '../../../../packages/server/src/modules/usp/principal';

const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const manual = new ManualIngestionService();
const intake = new IntakeService();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const objects = new Map<string, Buffer>();
const hashes = new Map<string, string>();
const rejectedSql: unknown[] = [];
const results: Record<string, unknown> = {};
const finished = new Map<string, () => void>();
const failures: unknown[] = [];
const server = createServer((request, response) => {
  serve(request, response).catch(error => {
    response.writeHead(422, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ detail: error.message }));
  });
});

function ownedBox() {
  const nonce = process.env.ULPIN_CA0_NONCE;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_CA0_CONTAINER!;
  assert.equal(container, `ulpin-ca0-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'ca0_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/ca0_${nonce}`);
  assert.equal(process.env.ULPIN_MODEL_GATEWAY_ENABLED, '0');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'CA0']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

function traceSql() {
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  globals.ulpinPool = new Pool({ connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 10000 });
  pool().on('connect', client => {
    const original = client.query.bind(client);
    const committing = new Set<string>();
    client.query = ((...args: any[]) => {
      const [text, values = []] = args;
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        args[args.length - 1] = (error: any, result: unknown) => {
          if (error && /^[0-9A-Z]{5}$/.test(error.code ?? '')) {
            rejectedSql.push({ sql: text.split('\n'), code: error.code, message: error.message });
          }
          callback(error, result);
        };
        return (original as any)(...args);
      }
      return (original as any)(...args).then((result: any) => {
      if (text.startsWith('UPDATE jobs SET status=')
        && (text.includes("'succeeded'") || text.includes("'failed'")
          || ['failed', 'stale'].includes(values[1]))) committing.add(String(values[0]));
      if (text === 'COMMIT') {
        for (const jobId of committing) finished.get(jobId)?.();
        committing.clear();
      }
      if (text === 'ROLLBACK') committing.clear();
      return result;
    }, (error: any) => {
      if (/^[0-9A-Z]{5}$/.test(error.code ?? '')) {
        rejectedSql.push({ sql: text.split('\n'), code: error.code, message: error.message, position: error.position });
      }
      throw error;
      });
    }) as typeof client.query;
  });
}

function geometry(operation: string, data: unknown) {
  assert(['normalize', 'check', 'inspect-gis'].includes(operation));
  const module = operation === 'inspect-gis' ? 'geo.gis_inspection' : 'geo.area';
  const method = operation === 'inspect-gis' ? 'inspect_gis'
    : operation === 'normalize' ? 'normalize_area' : 'check_area';
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + `from ${module} import ${method};print(json.dumps(${method}(json.load(sys.stdin))))`;
  const result = spawnSync(python, ['-B', '-c', code], { input: JSON.stringify(data), encoding: 'utf8',
    timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.status !== 0) throw new Error(`Product Python ${operation} refused: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

async function serve(request: IncomingMessage, response: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const value of request) chunks.push(Buffer.from(value));
  const bytes = Buffer.concat(chunks);
  const path = request.url!.split('?')[0];
  if (path.startsWith('/internal/area/')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(geometry(path.split('/').at(-1)!, JSON.parse(bytes.toString()))));
  } else if (request.method === 'PUT') {
    assert(!objects.has(path), 'Original byte map is immutable.');
    objects.set(path, bytes);
    response.writeHead(200, { ETag: `"${hash(bytes)}"` });
    response.end();
  } else if (request.method === 'GET' && objects.has(path)) {
    const object = objects.get(path)!;
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    const body = range ? object.subarray(Number(range[1]), Number(range[2]) + 1) : object;
    response.writeHead(range ? 206 : 200, { 'Content-Length': body.length, ETag: `"${hash(object)}"`,
      ...(range ? { 'Content-Range': `bytes ${range[1]}-${Number(range[1]) + body.length - 1}/${object.length}` }
        : {}) });
    response.end(body);
  } else if (request.method === 'HEAD' && objects.has(path)) {
    response.writeHead(200, { 'Content-Length': objects.get(path)!.length, ETag: `"${hash(objects.get(path)!)}"` });
    response.end();
  } else if (request.method === 'DELETE') {
    objects.delete(path);
    response.writeHead(204);
    response.end();
  } else {
    response.writeHead(404);
    response.end();
  }
}

async function standIns() {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'e1-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Non-loopback fetch is forbidden.');
    return fetch(input, init);
  };
}

function bytes(name: string) {
  assert(['buildings-original.geojson', 'hydrography.geojson'].includes(name));
  const original = readFileSync(`${folder}${name}`);
  const digest = hash(original);
  assert(!hashes.has(name) || hashes.get(name) === digest);
  hashes.set(name, digest);
  return original;
}

async function tickJob(jobId: string) {
  let timer: ReturnType<typeof setTimeout>;
  const completion = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Dispatcher exceeded the 90-second observation bound.')), 90000);
    finished.set(jobId, resolve);
  });
  try {
    await dispatchTick();
    await completion;
    const job = (await query('SELECT operation,status,error,payload FROM jobs WHERE id=$1', [jobId])).rows[0];
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
  } catch (error) {
    const jobs = (await query(`SELECT j.id,j.operation,j.status,j.error,j.payload,m.logical_state
      FROM jobs j LEFT JOIN usp_job_metadata m ON m.job_id=j.id
      WHERE j.status IN ('queued','running','failed','stale') ORDER BY j.created_at`)).rows;
    results.dispatcherFailure = { awaitingJob: jobId, jobs };
    throw error;
  } finally {
    clearTimeout(timer!);
    finished.delete(jobId);
  }
}

async function draftTick(sourceId: string) {
  const job = (await query(`SELECT id FROM jobs WHERE source_id=$1 AND operation='intake-draft'
    AND status='queued' ORDER BY created_at LIMIT 1`, [sourceId])).rows[0];
  assert(job);
  await tickJob(job.id);
}

async function chooseLayout(caseId: string, profile: SourceProfile) {
  const inspected = await manual.inspect(caseId, profile.source.sourceId);
  const source = (await query('SELECT inspection FROM sources WHERE id=$1', [profile.source.sourceId])).rows[0];
  const authored = await manual.author(caseId, profile.source.sourceId, { requestKey: randomUUID(),
    expectedRecipeRevision: 0, plan: { version: inspected.version, mode: 'manual_mapping', source: inspected.source,
      caseId, workspaceRevision: inspected.workspaceRevision, workspaceFingerprint: inspected.workspaceFingerprint,
      operations: [
        { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
          conversionId: 'literal_identifier@1' },
        { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
      ] }, destination: { kind: 'new_area', name: source.inspection.gis.suggestedTitle,
      namespace: source.inspection.gis.suggestedNamespace } }) as MappingReceipt;
  await manual.decide(caseId, authored.id,
    { requestKey: randomUUID(), expectedRecipeRevision: authored.revision }, 'approve');
}

async function buildings() {
  const { caseId } = await createSourceCase({ requestKey: randomUUID(), name: 'E1 NYC test_only intake' });
  const profile = await manual.retain(caseId, { requestKey: randomUUID(), expectedWorkspaceRevision: 0,
    format: 'geojson' }, { name: 'buildings-original.geojson',
    bytes: bytes('buildings-original.geojson') }) as SourceProfile;
  assert.equal(hashes.get('buildings-original.geojson'),
    '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e');
  await intake.register(caseId, { sourceId: profile.source.sourceId, requestKey: randomUUID() });
  await draftTick(profile.source.sourceId);
  await chooseLayout(caseId, profile);
  await draftTick(profile.source.sourceId);
  const prepare = await nextIntakeRunJob();
  assert(prepare);
  await tickJob(prepare);
  const item = (await query('SELECT * FROM usp_intake_items WHERE item_id=$1', [profile.source.sourceId])).rows[0];
  assert.equal(item.state, 'read');
  assert.equal(item.placement, 'on_map');
  const pkg = await getPackage(item.plan_ref.packageId);
  const page = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
  assert.equal(page.counts.ready, 1661);
  assert.equal(pkg.review?.packageRevision, pkg.revision);
  const rows = (await query('SELECT * FROM usp_intake_targets WHERE case_id=$1 ORDER BY target_id', [caseId])).rows;
  assert.equal(rows.length, 1661);
  assert(rows.every(row => row.reason && row.readiness === 'ready'));
  results.prepared = { counts: page.counts, reasonsPresent: rows.length, findings: pkg.review!.findings.length,
    officerCallsAfterLayoutApproval: 0 };
  return { caseId, profile, pkg, rows };
}

async function commandCounts(target: any) {
  const keys = ['plan', 'confirm', 'execute', 'card'].map(step =>
    intakeRunKey(target.confirmationId, target.targetId, step));
  const receipts = (await query(`SELECT operation,count(*)::int count FROM usp_command_receipts
    WHERE request_key=ANY($1::text[]) GROUP BY operation ORDER BY operation`, [keys])).rows;
  const snapshots = (await query(`SELECT count(*)::int count FROM usp_snapshots
    WHERE body->'selection'->'pins'->0->'ref'->>'id'=$1`, [target.artefacts.record.id])).rows[0].count;
  return { snapshots, receipts };
}

async function faultAndRetry(caseId: string, confirmationId: string, job: any) {
  const before = (await readIntakeConfirmation(caseId, confirmationId)).progress
    .find(target => target.targetId === job.target_id)!;
  const steps = { ...intakeRunSteps, confirmPlan: (async (ctx, command: any) =>
    intakeRunSteps.confirmPlan(ctx, { ...command,
      guard: { ...command.guard, expectedVersion: command.guard.expectedVersion + 1 } })) as
      typeof intakeRunSteps.confirmPlan };
  await assert.rejects(runIntakeRunJob(job.id, steps), { status: 409 });
  const stopped = (await readIntakeConfirmation(caseId, confirmationId)).progress
    .find(target => target.targetId === job.target_id)!;
  assert.equal(stopped.readiness, 'stopped');
  assert(stopped.artefacts.plan && !stopped.artefacts.planConfirmation);
  const countsBefore = await commandCounts(stopped);
  await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/confirmations/${confirmationId}/retry`,
    '/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}/retry', IntakeConfirmationSchema, {});
  // Opening the retried target takes it ahead of the third target, through the product's queue order.
  await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/targets/${job.target_id}/priority`,
    '/api/v1/ingestion/cases/{caseId}/targets/{targetId}/priority', IntakeTargetSchema, {}, 200);
  const next = await nextIntakeRunJob();
  assert(next);
  await tickJob(next);
  const carded = (await readIntakeConfirmation(caseId, confirmationId)).progress
    .find(target => target.targetId === job.target_id)!;
  assert.equal(carded.readiness, 'carded');
  assert.deepEqual(carded.artefacts.snapshot, stopped.artefacts.snapshot);
  assert.deepEqual(carded.artefacts.plan, stopped.artefacts.plan);
  const countsAfter = await commandCounts(carded);
  assert.equal(countsAfter.snapshots, countsBefore.snapshots);
  assert.equal(countsAfter.receipts.find(row => row.operation === 'packet_plan_create').count, 1);
  results.retry = { targetId: job.target_id, before: before.readiness, code: stopped.blockedBy,
    stoppedStage: stopped.stage, countsBefore, countsAfter,
    snapshotAndPlanUnchanged: true, sameKeys: true };
}

async function secondLayer(areaId: string) {
  const pkg = await ingestArea({ bytes: bytes('hydrography.geojson'), filename: 'hydrography.geojson',
    format: 'geojson', areaId, namespace: 'e1-nyc-hydrography', name: 'NYC hydrography original test_only',
    mapping: { kind: 'public_land' }, worldStatus: 'observed' });
  const reviewed = await reviewPackage(pkg.id, pkg.revision);
  await commitPackage(reviewed.id, reviewed.revision,
    'E1 test_only: publisher hydrography, no building, height or rights assertion.');
  return { packageId: pkg.id, kind: pkg.features[0].kind, features: pkg.features.length };
}

function selectThree(pkg: ImportPackage, rows: any[]) {
  const overlap = pkg.review!.findings.find(finding => finding.code === 'BUILDING_FOOTPRINT_OVERLAP');
  assert(overlap);
  const participating = rows.find(row => overlap.featureIds.includes(row.feature_id));
  assert(participating);
  const selected = [participating, ...rows.filter(row => row.target_id !== participating.target_id).slice(0, 2)];
  const input = { requestKey: randomUUID(), acknowledgement:
    'E1 test_only: record cited publisher exteriors; heights, floors, units and rights remain unknown.',
  packages: [{ packageId: pkg.id, revision: pkg.revision, reviewFingerprint: pkg.review!.inputFingerprint }],
  targets: selected.map(row => row.target_id) };
  return { input, participating };
}

async function assertRefusals(caseId: string, input: IntakeConfirm) {
  const route = `/api/v1/ingestion/cases/${caseId}/confirmations`;
  const before = (await query('SELECT count(*)::int count FROM usp_intake_confirmations')).rows[0].count;
  const moved = { ...input.packages[0], revision: input.packages[0].revision + 1 };
  await rejectedHttp(route, { ...input, packages: [moved] }, 409);
  await rejectedHttp(route, { ...input, packages: [{ ...input.packages[0], reviewFingerprint: 'b'.repeat(64) }] }, 409);
  await rejectedHttp(route, { ...input, targets: [randomUUID()] }, 409);
  assert.equal((await query('SELECT count(*)::int count FROM usp_intake_confirmations')).rows[0].count, before);
  results.atomicRefusals = { changedRevision: 409, changedFingerprint: 409,
    unlistedTarget: 409, nothingStored: true };
}

async function press(caseId: string, input: IntakeConfirm) {
  const route = `/api/v1/ingestion/cases/${caseId}/confirmations`;
  const pattern = '/api/v1/ingestion/cases/{caseId}/confirmations';
  const pressed = performance.now();
  const confirmation = await intakeHttp('POST', route, pattern, IntakeConfirmationSchema, input);
  assert(confirmation.findingCounts && Object.keys(confirmation.findingCounts).length > 0);
  return { confirmation, pressed };
}

async function assertReplays(caseId: string, input: IntakeConfirm, confirmation: IntakeConfirmation) {
  const route = `/api/v1/ingestion/cases/${caseId}/confirmations`;
  const pattern = '/api/v1/ingestion/cases/{caseId}/confirmations';
  const jobsBefore = (await query('SELECT count(*)::int count FROM jobs')).rows[0].count;
  const repeated = await intakeHttp('POST', route, pattern, IntakeConfirmationSchema, input);
  assert.equal(repeated.confirmationId, confirmation.confirmationId);
  assert.equal(repeated.createdAt, confirmation.createdAt);
  assert.equal(repeated.reason, confirmation.reason);
  assert.equal((await query('SELECT count(*)::int count FROM jobs')).rows[0].count, jobsBefore);
  await rejectedHttp(route, { ...input, targets: input.targets.slice(1) }, 409);
  results.idempotency = { sameRecord: true, noNewJob: true, changedListStatus: 409 };
}

async function targetJobs(caseId: string, areaId: string, input: IntakeConfirm,
  confirmation: IntakeConfirmation, pressed: number, controls: boolean) {
  await tickJob((await nextIntakeRunJob())!);
  const recorded = await readIntakeConfirmation(caseId, confirmation.confirmationId);
  assert.equal(recorded.counts.recorded, 1661);
  const targetJobs = (await query(`SELECT id,payload->>'targetId' target_id FROM jobs
    WHERE operation='intake-run' AND payload->>'phase'='target' AND payload->>'confirmationId'=$1
    ORDER BY created_at,id`, [confirmation.confirmationId])).rows;
  assert.equal(targetJobs.length, 3);
  assert(targetJobs.every(job => input.targets.includes(job.target_id)));
  await tickJob((await nextIntakeRunJob())!);
  results.firstCardMs = Math.round(performance.now() - pressed);
  if (!controls) {
    await tickJob((await nextIntakeRunJob())!);
    await tickJob((await nextIntakeRunJob())!);
    results.thirdCardMs = Math.round(performance.now() - pressed);
    return;
  }
  const remaining = (await query(`SELECT id,payload->>'targetId' target_id FROM jobs
    WHERE operation='intake-run' AND payload->>'phase'='target' AND status='queued' ORDER BY created_at,id`)).rows;
  await faultAndRetry(caseId, confirmation.confirmationId, remaining[0]);
  results.secondLayer = await secondLayer(areaId);
  await tickJob((await nextIntakeRunJob())!);
  results.thirdCardMs = Math.round(performance.now() - pressed);
}

async function completed(caseId: string, confirmationId: string, input: IntakeConfirm,
  rows: any[], overlapId: string, controls: boolean) {
  const final = await intakeHttp('GET',
    `/api/v1/ingestion/cases/${caseId}/confirmations/${confirmationId}`,
    '/api/v1/ingestion/cases/{caseId}/confirmations/{confirmationId}', IntakeConfirmationSchema);
  assert.equal(final.counts.recorded, 1661);
  assert.equal(final.counts.carded, 3);
  assert.equal(final.counts.stopped, 0);
  const evidence = [];
  for (const target of final.progress) evidence.push(await cardEvidence(target));
  const unlisted = (await query(`SELECT count(*)::int count FROM usp_intake_targets
    WHERE case_id=$1 AND NOT (target_id=ANY($2::uuid[])) AND artefacts ? 'card'`,
  [caseId, input.targets])).rows[0].count;
  assert.equal(unlisted, 0);
  const notListed = rows.find(row => !input.targets.includes(row.target_id));
  await rejectedHttp(`/api/v1/ingestion/cases/${caseId}/targets/${notListed.target_id}/priority`, {}, 409);
  results.completed = { counts: final.counts, findingCounts: final.findingCounts,
    cards: evidence, unlistedCards: unlisted,
    overlapIncluded: overlapId, thirdAfterAreaMoved: controls ? 'carded' : 'not exercised in the baseline' };
}

async function cardEvidence(target: IntakeTarget) {
  const made = target.artefacts.card!;
  const view = await readPropertyCard(localRequestContext(randomUUID()), { cardId: made.id, revision: made.revision });
  const citation = view.card.facts.find(fact => fact.key === 'source_citation')?.value;
  assert.equal(citation, `buildings-original.geojson, ${target.locator}`);
  assert.equal(target.artefacts.verification, 'consistent');
  assert.equal(await verifyCardLink(view.card.resolverUrl), 'consistent');
  return { targetId: target.targetId, locator: target.locator, cardId: made.id, citation,
    link: view.card.resolverUrl, verification: target.artefacts.verification };
}

async function retainedHydrography(caseId: string, area: MapArea) {
  const revision = (await query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0].revision;
  const profile = await manual.retain(caseId, { requestKey: randomUUID(), expectedWorkspaceRevision: revision,
    format: 'geojson' }, { name: 'hydrography.geojson', bytes: bytes('hydrography.geojson') }) as SourceProfile;
  await intake.register(caseId, { sourceId: profile.source.sourceId, requestKey: randomUUID() });
  await draftTick(profile.source.sourceId);
  const item = (await intake.manifest(caseId)).items.find(value => value.sourceId === profile.source.sourceId)!;
  assert.equal(item.placement, 'needs_answer');
  results.retainedHydrography = { sameCase: true, state: item.state, placement: item.placement,
    reason: item.limitReason, automaticDraft: false };
  results.boundDestination = intakeDestination(
    { suggestedTitle: 'Hydrography', suggestedNamespace: 'hydrography' }, area);
  results.d6Gap = 'The existing manual profile has building conversions only; hydrography is public_land. '
    + 'Do not author a building layout for water. Direct public_land import tests same-area movement; '
    + 'D6 destination and normalizer refusals are tested, but a retained hydrography layout '
    + 'needs an unowned conversion.';
}

function normalizerRefusals(area: MapArea) {
  const real = { format: 'geojson', data: JSON.parse(bytes('hydrography.geojson').toString()),
    mapping: { kind: 'public_land' }, worldStatus: 'observed' };
  const controls = [
    { reference: { ...area.reference, analysisCrs: 'EPSG:32643' },
      message: 'The selected analysis CRS does not cover this area; use its appropriate UTM zone and hemisphere.' },
    { reference: { ...area.reference, origin: [area.reference!.origin[0] + 100000, area.reference!.origin[1]] },
      message: 'Features exceed 50 km from the retained area origin; select the matching map area.' },
  ];
  const outcomes = [];
  for (const control of controls) {
    assert.throws(() => geometry('normalize', { ...real, reference: control.reference }),
      (error: Error) => error.message.includes(control.message));
    const question = officerQuestion(new AppError(422, 'AREA_PROCESSING', control.message));
    assert.equal(question, control.message);
    outcomes.push({ code: 'AREA_PROCESSING', officerQuestion: question });
  }
  results.normalizerRefusals = { negativeControlsOnly: true, noReferenceOrGeometryStored: true, outcomes };
}

async function cards(controls: boolean) {
  const { caseId, pkg, rows } = await buildings();
  const { input, participating } = selectThree(pkg, rows);
  await assertRefusals(caseId, input);
  const { confirmation, pressed } = await press(caseId, input);
  await targetJobs(caseId, pkg.areaId, input, confirmation, pressed, controls);
  await completed(caseId, confirmation.confirmationId, input, rows, participating.target_id, controls);
  await assertReplays(caseId, input, confirmation);
  const area = await getArea(pkg.areaId);
  normalizerRefusals(area);
  await retainedHydrography(caseId, area);
}

async function main() {
  ownedBox();
  try {
    traceSql();
    await query(sql('bootstrap.postgis'));
    await migrate();
    await query(sql('ingestion.intake.targets'));
    await query(sql('ingestion.intake.targets'));
    results.migrationAppliedTwice = true;
    console.log(JSON.stringify({ completed: 'migrations', appliedTwice: true }));
    await standIns();
    await startHttp();
    const controls = process.env.ULPIN_E1_SCENARIO === 'controls';
    await cards(controls);
    results.scenario = controls ? 'controls' : 'baseline';
    if (!controls) results.writeCallsBetweenPressAndThirdCard = 0;
  } catch (error: any) {
    failures.push({ status: error.status, code: error.code, message: error.message, stack: error.stack?.split('\n') });
    process.exitCode = 1;
  } finally {
    results.http = await stopHttp();
    closeStorageClient();
    server.closeIdleConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await closePool();
    for (const [name, expected] of hashes) assert.equal(hash(readFileSync(`${folder}${name}`)), expected);
    console.log(JSON.stringify({ task: 'E1', results, rejectedSql, failures, hashes: Object.fromEntries(hashes),
      originalHashesUnchanged: true, providers: 0, gpu: false, pool: { max: 8, connectionTimeoutMillis: 10000 },
      network: 'Loopback SQL/storage/product Python; PROJ_NETWORK=OFF; gateway disabled' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
