import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import type { ImportPackage, GisInspection } from '../../../../packages/contracts/src';
import type { SourceProfile, MappingReceipt, TargetPin, RequestContext }
  from '../../../../packages/contracts/src/usp';
import { closePool, migrate, pool, query } from '../../../../packages/server/src/infrastructure/db';
import { settings } from '../../../../packages/server/src/infrastructure/config';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { closeStorageClient } from '../../../../packages/server/src/infrastructure/storage';
import { getArea, getPackage, reviewPackage, commitPackage, areaGeo }
  from '../../../../packages/server/src/modules/areas/areas';
import { createSourceCase } from '../../../../packages/server/src/modules/cases/source-cases';
import { inspectGisBytes } from '../../../../packages/server/src/modules/cases/gis-inspection';
import { dispatchTick } from '../../../../packages/server/src/modules/cases/processing';
import { ManualIngestionService } from '../../../../packages/server/src/modules/usp/ingestion/service';
import { IntakeService } from '../../../../packages/server/src/modules/usp/ingestion/intake-service';
import { inspectedProfile } from '../../../../packages/server/src/modules/usp/ingestion/registry';
import { captureRegistrySnapshot, resolveRegistryTarget }
  from '../../../../packages/server/src/modules/usp/snapshots';
import { localRequestContext } from '../../../../packages/server/src/modules/usp/principal';
import { createPacketPlan, confirmPacketPlan, executePacketPlan }
  from '../../../../packages/server/src/modules/usp/packets/plan-service';
import { previewPropertyCard, generatePropertyCard }
  from '../../../../packages/server/src/modules/usp/packets/card-service';

const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const originalName = 'buildings-original.geojson';
const expectedHash = '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e';
const python = 'E:/BhuAayam-data/task-data/lv0/python/Scripts/python.exe';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const round = (value: number) => Math.round(value * 1000) / 1000;
const manual = new ManualIngestionService();
const intake = new IntakeService();
const objects = new Map<string, Buffer>();
const hashes = new Map<string, string>();
const steps: any[] = [];
const processors: any[] = [];
const rejectedSql: any[] = [];
const bindings: any[] = [];
const replayChecks: any[] = [];
const finished = new Map<string, () => void>();
let server: Server | undefined;

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

function sqlFailure(text: string, error: any) {
  if (/^[0-9A-Z]{5}$/.test(error.code ?? '')) rejectedSql.push({ sql: text.split('\n'),
    code: error.code, message: error.message, position: error.position });
}

function traceSql() {
  // CA5's disclosed bounded allowance; same eight connections, no product review replacement.
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  globals.ulpinPool = new Pool({ connectionString: settings.databaseUrl, max: 8, connectionTimeoutMillis: 60000 });
  pool().on('connect', client => {
    const original = client.query.bind(client);
    const committing = new Set<string>();
    client.query = ((...args: any[]) => {
      const [text, values = []] = args;
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        args[args.length - 1] = (error: any, result: unknown) => {
          if (error) sqlFailure(text, error);
          callback(error, result);
        };
        return (original as any)(...args);
      }
      return (original as any)(...args).then((result: any) => {
        if (text.startsWith('UPDATE cases SET site_id=')) bindings.push({ sql: text, values });
        if (text.startsWith('UPDATE jobs SET status=')
          && (text.includes("'succeeded'") || ['failed', 'stale'].includes(values[1]))) committing.add(values[0]);
        if (text === 'COMMIT') {
          for (const jobId of committing) finished.get(jobId)?.();
          committing.clear();
        }
        if (text === 'ROLLBACK') committing.clear();
        return result;
      }, (error: any) => {
        sqlFailure(text, error);
        throw error;
      });
    }) as typeof client.query;
  });
}

function geometry(operation: string, data: any) {
  assert(['normalize', 'check', 'inspect-gis'].includes(operation));
  const module = operation === 'inspect-gis' ? 'geo.gis_inspection' : 'geo.area';
  const method = operation === 'inspect-gis' ? 'inspect_gis'
    : operation === 'normalize' ? 'normalize_area' : 'check_area';
  const code = 'import sys,json;sys.path.insert(0,"services/geo");'
    + `from ${module} import ${method};print(json.dumps(${method}(json.load(sys.stdin))))`;
  const start = performance.now();
  const result = spawnSync(python, ['-B', '-c', code], { input: JSON.stringify(data), encoding: 'utf8',
    timeout: 60000, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PROJ_NETWORK: 'OFF', PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.status !== 0) throw new Error(`Product Python ${operation} refused: ${result.stderr.trim()}`);
  const output = JSON.parse(result.stdout);
  processors.push({ operation, ms: round(performance.now() - start), disposition: output.disposition,
    features: output.features?.length, findings: output.findings?.length });
  return output;
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
  server = createServer((request, response) => {
    serve(request, response).catch(error => {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ detail: error.message }));
    });
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_ACCESS_KEY = randomBytes(12).toString('hex');
  process.env.S3_SECRET_KEY = randomBytes(24).toString('hex');
  process.env.S3_BUCKET = 'ca0-memory-originals';
  process.env.GEO_URL = endpoint;
  process.env.GEO_SERVICE_TOKEN = randomBytes(24).toString('hex');
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.hostname, '127.0.0.1', 'Non-loopback fetch is forbidden.');
    return fetch(input, init);
  };
}

async function measured(step: string, person: string, system: string, work: () => Promise<unknown>) {
  const started = performance.now();
  try {
    const result = await work();
    const entry = { step, person, system, result, ms: round(performance.now() - started) };
    steps.push(entry);
    console.log(JSON.stringify({ completed: step, ...entry }));
    return result;
  } catch (error: any) {
    steps.push({ step, person, system, result: { status: error.status, code: error.code, message: error.message },
      ms: round(performance.now() - started) });
    throw error;
  }
}

function bytes(name: string) {
  assert(readdirSync(folder).includes(name));
  assert(!name.includes('/') && !name.includes('\\'));
  const original = readFileSync(`${folder}${name}`);
  const expected = hash(original);
  assert(!hashes.has(name) || hashes.get(name) === expected);
  hashes.set(name, expected);
  return original;
}

async function drainJob(sourceId: string) {
  const job = (await query(`SELECT id FROM jobs WHERE source_id=$1 AND operation='intake-draft'
    AND status='queued' ORDER BY created_at LIMIT 1`, [sourceId])).rows[0];
  assert(job, 'Publication must have enqueued automatically.');
  let timer: ReturnType<typeof setTimeout>;
  const completion = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Automatic draft exceeded its 90-second observation bound.')), 90000);
    finished.set(job.id, resolve);
  });
  try {
    await dispatchTick();
    await completion;
    const result = (await query(`SELECT j.id,j.status,j.error,j.attempts,m.logical_state,m.result_ref
      FROM jobs j JOIN usp_job_metadata m ON m.job_id=j.id WHERE j.id=$1`, [job.id])).rows[0];
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.equal(result.logical_state, 'succeeded');
    return result;
  } finally {
    clearTimeout(timer!);
    finished.delete(job.id);
  }
}

async function replayProbe(caseId: string, sourceId: string) {
  const stateSql = `SELECT state,placement,plan_ref,records_seen,limit_reason
    FROM usp_intake_items WHERE source_id=$1 AND parent_item_id IS NULL`;
  const jobsSql = "SELECT count(*)::int count FROM jobs WHERE source_id=$1 AND operation='intake-draft'";
  const before = (await query(stateSql, [sourceId])).rows[0];
  const jobsBefore = (await query(jobsSql, [sourceId])).rows[0].count;
  await intake.register(caseId, { sourceId, requestKey: randomUUID() });
  const after = (await query(stateSql, [sourceId])).rows[0];
  const jobsAfter = (await query(jobsSql, [sourceId])).rows[0].count;
  assert.deepEqual(after, before);
  assert.equal(jobsAfter, jobsBefore);
  replayChecks.push({ sourceId, state: after.state, placement: after.placement,
    reasonPreserved: after.limit_reason === before.limit_reason, jobsBefore, jobsAfter });
}

async function retainAndProbe(name: string) {
  const { caseId } = await createSourceCase({ requestKey: randomUUID(), name: `${name} test_only intake` });
  const profile = await manual.retain(caseId, { requestKey: randomUUID(), expectedWorkspaceRevision: 0,
    format: 'geojson' }, { name, bytes: bytes(name) }) as SourceProfile;
  await intake.register(caseId, { sourceId: profile.source.sourceId, requestKey: randomUUID() });
  const job = await drainJob(profile.source.sourceId);
  const item = (await intake.manifest(caseId)).items[0];
  const recipe = (await query('SELECT body FROM usp_mapping_recipes WHERE source_id=$1',
    [profile.source.sourceId])).rows[0]?.body;
  return { caseId, profile, job, item, recipe };
}

async function inventory() {
  const listing = readdirSync(folder).map(name => ({ name, bytes: statSync(`${folder}${name}`).size }));
  const vectors = listing.filter(entry => entry.name.endsWith('.geojson') && entry.name !== originalName);
  const schemas: any[] = [];
  for (const file of vectors) {
    try {
      const original = bytes(file.name);
      const gis = await inspectGisBytes({ name: file.name, bytes: original }, null,
        input => areaGeo<Omit<GisInspection, 'suggestedTitle' | 'suggestedNamespace'>>('inspect-gis', input));
      const profile = inspectedProfile(original, gis);
      schemas.push({ ...file, sha256: hash(original), schemaFingerprint: profile.schemaFingerprint,
        features: profile.featureCount });
    } catch (error: any) {
      schemas.push({ ...file, refusal: { status: error.status, code: error.code, message: error.message } });
    }
  }
  return { listing, schemas, largestOther: vectors.sort((a, b) => b.bytes - a.bytes)[0] };
}

async function approveLayout(first: Awaited<ReturnType<typeof retainAndProbe>>) {
  const profile = await manual.inspect(first.caseId, first.profile.source.sourceId) as SourceProfile;
  const source = (await query('SELECT inspection FROM sources WHERE id=$1', [profile.source.sourceId])).rows[0];
  const recipe = await manual.author(first.caseId, profile.source.sourceId, { requestKey: randomUUID(),
    expectedRecipeRevision: 0, plan: { version: profile.version, mode: 'manual_mapping', source: profile.source,
      caseId: profile.caseId, workspaceRevision: profile.workspaceRevision,
      workspaceFingerprint: profile.workspaceFingerprint, operations: [
        { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
          conversionId: 'literal_identifier@1' },
        { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
      ] }, destination: { kind: 'new_area', name: source.inspection.gis.suggestedTitle,
      namespace: source.inspection.gis.suggestedNamespace } }) as MappingReceipt;
  assert.equal(recipe.state, 'proposed');
  const approved = await manual.decide(first.caseId, recipe.id,
    { requestKey: randomUUID(), expectedRecipeRevision: recipe.revision }, 'approve') as MappingReceipt;
  assert.equal(approved.state, 'approved');
  return approved;
}

async function automaticPackage(first: Awaited<ReturnType<typeof retainAndProbe>>) {
  const before = (await query('SELECT site_id,frame,context,revision FROM cases WHERE id=$1',
    [first.caseId])).rows[0];
  assert.equal(before.site_id, null);
  await drainJob(first.profile.source.sourceId);
  const item = (await query('SELECT * FROM usp_intake_items WHERE item_id=$1',
    [first.profile.source.sourceId])).rows[0];
  assert.equal(item.state, 'read');
  assert.equal(item.placement, 'on_map');
  assert.equal(Number(item.records_seen), 1661);
  const pkg = await getPackage(item.plan_ref.packageId);
  const after = (await query('SELECT site_id,frame,context,revision FROM cases WHERE id=$1', [first.caseId])).rows[0];
  assert.equal(after.site_id, pkg.areaId);
  assert.deepEqual(after.frame, before.frame);
  assert.equal(after.frame.id, 'UNASSIGNED');
  assert.deepEqual(after.context, before.context);
  assert.equal(after.revision, before.revision);
  assert.equal(pkg.features.length, 1661);
  const originals = JSON.parse(bytes(originalName).toString()).features;
  const mappings = (await query('SELECT id,record_id FROM physical_features WHERE area_id=$1',
    [pkg.areaId])).rows;
  const checks = [0, 830, originals.length - 1].map(index => {
    const feature = pkg.features.find(value => value.sourceFeatureIndex === index)!;
    assert(feature);
    assert.equal(feature.sourceKey, originals[index].properties.doitt_id);
    assert.equal(feature.sourceRevisionId, first.profile.source.sourceId);
    assert(feature.evidence.some(entry => entry.sourceRevisionId === first.profile.source.sourceId
      && entry.featureId === feature.sourceKey));
    const mapped = mappings.find(row => row.id === feature.id);
    assert(mapped?.record_id);
    return { index, key: feature.sourceKey, recordId: mapped.record_id as string };
  });
  await replayProbe(first.caseId, first.profile.source.sourceId);
  return { pkg, item, binding: after, checks };
}

async function record(pkg: ImportPackage) {
  const reviewed = await reviewPackage(pkg.id, pkg.revision);
  assert.deepEqual(await getPackage(pkg.id), reviewed);
  const committed = await commitPackage(reviewed.id, reviewed.revision,
    'CA0 test_only: recorded publisher exteriors, no analytical geometry, heights or rights qualification.');
  assert.equal(committed.state, 'COMMITTED');
  const history = (await query(`SELECT r.id,r.revision,r.body,h.body history,f.id feature_id FROM registry_records r
    JOIN registry_revisions h ON h.record_id=r.id AND h.revision=1
    JOIN physical_features f ON f.record_id=r.id WHERE r.site_id=$1`, [pkg.areaId])).rows;
  assert.equal(history.length, 1661);
  for (const row of history) {
    const feature = pkg.features.find(value => value.id === row.feature_id)!;
    assert.equal(row.revision, 1);
    assert.deepEqual(row.body.evidence,
      [{ sourceId: feature.sourceRevisionId, locator: `feature ${feature.sourceKey}` }]);
    assert.deepEqual(row.body, row.history);
    assert.deepEqual(row.body.footprint, []);
    assert.deepEqual(row.body.rights, []);
    assert.equal(row.body.geometry, undefined);
  }
  const counts = (await query(`SELECT count(*)::int qualifications,
    (SELECT count(*)::int FROM usp_command_receipts WHERE operation='qualify_geometry') qualification_receipts
    FROM usp_geometry_qualifications`)).rows[0];
  assert.deepEqual(counts, { qualifications: 0, qualification_receipts: 0 });
  return { committed, state: committed.state, citedRevisionOne: history.length,
    findings: reviewed.review?.findings.length, qualificationReceipts: counts.qualification_receipts };
}

async function executeSelectedPlan(ctx: RequestContext, plan: Awaited<ReturnType<typeof createPacketPlan>>) {
  const confirmation = await confirmPacketPlan(ctx, { planId: plan.planId, version: plan.version,
    planSha256: plan.planSha256, reviewed: true, guard: { mode: 'update', requestKey: randomUUID(),
      expectedVersion: plan.version, expectedManifestId: plan.input.scope.manifestId } });
  const execution = await executePacketPlan(ctx, { planId: plan.planId, version: plan.version,
    confirmationId: confirmation.confirmationId, guard: { mode: 'create', requestKey: randomUUID() } });
  assert.equal(execution.packet.status, 'complete');
  const command = { planId: plan.planId, planVersion: plan.version, cardId: null,
    expiresAt: new Date(Date.now() + 3600000).toISOString(), guard: { mode: 'create' } };
  const preview = await previewPropertyCard(ctx, command);
  const card = await generatePropertyCard(ctx, { ...command, guard: { mode: 'create', requestKey: randomUUID() } });
  assert.deepEqual(card.facts, preview.facts);
  return { execution, card };
}

async function packetAndCard(pkg: ImportPackage, checks: { index: number; key: string; recordId: string }[]) {
  const ctx = localRequestContext(randomUUID());
  const pins: TargetPin[] = checks.map(check => ({
    ref: { namespace: 'registry_record', id: check.recordId }, revision: 1,
  }));
  const snapshots = await Promise.all(pins.map(pin =>
    captureRegistrySnapshot(ctx, pkg.areaId, { kind: 'targets', pins: [pin] })));
  const snapshot = snapshots[0];
  const resolved = await Promise.all(pins.map((pin, index) =>
    resolveRegistryTarget(ctx, snapshots[index].scope, pin)));
  for (const [index, result] of resolved.entries()) {
    assert.equal(result.state, 'available');
    assert(result.state === 'available');
    assert.equal(result.data.evidence[0].sourceRevision.ref.id, pkg.sourceRevisionIds[0]);
    assert.equal(result.data.evidence[0].legacyLocator, `feature ${checks[index].key}`);
  }
  const first = resolved[0];
  assert(first.state === 'available');
  const plan = await createPacketPlan(ctx, { input: { target: pins[0], scope: snapshot.scope,
    purpose: 'record_evidence', format: 'csv', recipe: 'pack0-exact-text-csv/1',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), entries: [{ pointer: first.data.evidence[0],
      required: true, inclusionReason: 'Officer-reviewed original feature citation',
      review: { kind: 'direct', reviewed: true } }] }, guard: { mode: 'create', requestKey: randomUUID() } });
  assert.equal(plan.entries[0].state, 'included');
  const { execution, card } = await executeSelectedPlan(ctx, plan);
  assert.equal(card.facts.find(fact => fact.key === 'source_citation')?.value,
    `${originalName}, feature ${checks[0].key}`);
  assert.equal(card.facts.find(fact => fact.key === 'project_identity')?.value,
    'Identity codes are for recorded spaces only');
  const captured = (await query(`SELECT body FROM usp_snapshot_bodies
    WHERE manifest_id=$1 AND namespace='source_revision'`, [snapshot.id])).rows;
  assert.equal(captured.length, 1);
  assert.equal(captured[0].body.status, 'needs_input');
  assert.equal(captured[0].body.profile, 'geojson-manual-v1');
  return { manifestId: snapshot.id, capturedSources: captured.length, sourceStatus: captured[0].body.status,
    planId: plan.planId, included: plan.entries[0].state, packet: execution.packet.status,
    cardId: card.cardId, facts: card.facts, analyticalQualification: 'not granted' };
}

async function firstJourney() {
  assert.equal(bytes(originalName).length, 1103282);
  assert.equal(hashes.get(originalName), expectedHash);
  let first!: Awaited<ReturnType<typeof retainAndProbe>>;
  await measured('1 retained original is probed', 'Test operator adds original', 'retain, register, probe, dispatcher',
    async () => {
      first = await retainAndProbe(originalName);
      assert.equal(first.item.state, 'probed');
      assert.equal(first.item.placement, 'needs_answer');
      assert.equal(first.recipe, undefined);
      assert.equal(first.item.limitReason,
        'No approved layout matches this file. An officer chooses the identifier field.');
      await replayProbe(first.caseId, first.profile.source.sourceId);
      return { caseId: first.caseId, sourceId: first.profile.source.sourceId,
        schemaFingerprint: first.profile.source.schemaFingerprint, job: first.job,
        state: first.item.state, placement: first.item.placement, reason: first.item.limitReason, recipe: null };
    });
  await measured('2 layout chosen and approved', 'Test operator chooses doitt_id and geometry, no role',
    'author then approve; no execute request', async () => {
      const approved = await approveLayout(first);
      return { recipeId: approved.id, revision: approved.revision, state: approved.state };
    });
  let draft!: Awaited<ReturnType<typeof automaticPackage>>;
  await measured('3 draft appears automatically', 'None', 'dispatcher executes approved recipe and updates tray',
    async () => {
      draft = await automaticPackage(first);
      return { packageId: draft.pkg.id, state: draft.item.state, placement: draft.item.placement,
        accepted: draft.pkg.features.length, quarantine: draft.pkg.quarantine, binding: draft.binding,
        sourceIndices: draft.checks, planRef: draft.item.plan_ref };
    });
  await measured('4 actual review and commit', 'Test operator reviews publisher exteriors',
    'CA5 reviewPackage with 60000ms acquisition; CA1 commitPackage', async () => {
      const result = await record(draft.pkg);
      return { state: result.state, citedRevisionOne: result.citedRevisionOne, findings: result.findings,
        qualificationReceipts: result.qualificationReceipts };
    });
  await measured('5 snapshot, plan, packet and card', 'Test operator confirms selected feature citation',
    'target capture, plan create/confirm/execute, card preview/generate', () => packetAndCard(draft.pkg, draft.checks));
  return { first, draft };
}

async function difficultVector(largest: string) {
  try {
    const difficult = await retainAndProbe(largest);
    assert.equal(difficult.item.state, 'probed');
    assert.equal(difficult.item.placement, 'needs_answer');
    assert.equal(difficult.recipe, undefined);
    return { file: largest, bytes: bytes(largest).length, sha256: hashes.get(largest),
      state: difficult.item.state, placement: difficult.item.placement, reason: difficult.item.limitReason };
  } catch (error: any) {
    assert(['RECORD_LIMIT', 'UNSUPPORTED_GEOMETRY', 'SOURCE_PROFILE'].includes(error.code));
    return { file: largest, bytes: bytes(largest).length, sha256: hashes.get(largest),
      refusedBeforeReceipt: true, status: error.status, code: error.code, message: error.message };
  }
}

async function journey() {
  const { first, draft } = await firstJourney();
  await measured('6 allowed folder and second layout', 'None', 'real immutable-file inventory and existing GIS profile',
    async () => {
      const files = await inventory();
      const same = files.schemas.find(row => row.schemaFingerprint === first.profile.source.schemaFingerprint);
      if (same) {
        const second = await retainAndProbe(same.name);
        assert.equal(second.recipe.state, 'proposed');
        assert.equal(second.item.state, 'planned');
        assert.equal(second.item.placement, 'undecided');
        return { ...files, sameLayout: same.name, state: second.item.state, recipeState: second.recipe.state,
          perRecipeApprovalStillRequired: true };
      }
      return { ...files, sameLayout: null,
        gap: 'No second file matches the first file\'s exact schema fingerprint; memory reuse is unit-tested.' };
    });
  const largest = readdirSync(folder).filter(name => name.endsWith('.geojson') && name !== originalName)
    .sort((a, b) => statSync(`${folder}${b}`).size - statSync(`${folder}${a}`).size)[0];
  await measured('7 largest other real vector', 'Test operator adds original', 'same retained/probed draft path',
    () => difficultVector(largest));
  const area = await getArea(draft.pkg.areaId);
  const site = (await query('SELECT frame FROM registry_sites WHERE id=$1', [area.siteId])).rows[0];
  assert.notEqual(site.frame.id, 'UNASSIGNED');
}

async function finish() {
  closeStorageClient();
  if (server) {
    server.closeIdleConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  await closePool();
  for (const [name, expected] of hashes) assert.equal(hash(readFileSync(`${folder}${name}`)), expected);
}

async function main() {
  ownedBox();
  let failure: unknown;
  try {
    traceSql();
    await measured('migrations', 'None', 'nonce-owned PostGIS only', async () => {
      await query(sql('bootstrap.postgis'));
      await migrate();
      return { bootstrap: 'bootstrap.postgis then infrastructure/db.migrate()' };
    });
    await standIns();
    await journey();
  } catch (error: any) {
    failure = { status: error.status, code: error.code, message: error.message, stack: error.stack?.split('\n') };
    process.exitCode = 1;
  } finally {
    await finish();
    console.log(JSON.stringify({ task: 'CA0', steps, processors, rejectedSql, bindings, replayChecks,
      hashes: Object.fromEntries(hashes), originalHashesUnchanged: true, failure,
      reviewScaffolding: [], providers: 0, gpu: false,
      pool: { max: 8, connectionTimeoutMillis: 60000, allowance: 'CA5 long-acquisition; CA6 owns default repair' },
      network: 'Loopback SQL/storage/unchanged Python; PROJ_NETWORK=OFF; gateway disabled' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
