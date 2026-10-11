import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import type { ImportPackage } from '@ulpin/contracts';
import type { MappingReceipt, SourceProfile } from '@ulpin/contracts/usp';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { getArea, getPackage, ingestArea, reviewPackage, commitPackage }
  from '../../../../packages/server/src/modules/areas/areas';
import { createSourceCase } from '../../../../packages/server/src/modules/cases/source-cases';
import { ManualIngestionService } from '../../../../packages/server/src/modules/usp/ingestion/service';
import { IntakeService } from '../../../../packages/server/src/modules/usp/ingestion/intake-service';
import { runIntakeDraftJob } from '../../../../packages/server/src/modules/usp/ingestion/intake-draft-worker';
import { intakeDestination } from '../../../../packages/server/src/modules/usp/ingestion/intake-draft-worker';
import { runIntakeRunJob } from '../../../../packages/server/src/modules/usp/ingestion/intake-run-worker';
import { confirmIntake, readIntakeConfirmation }
  from '../../../../packages/server/src/modules/usp/ingestion/intake-confirmations';
import { hash, startControls, stopControls } from './controls';

const phase = process.env.ULPIN_LP1_PHASE!;
const nonce = process.env.ULPIN_LP1_NONCE!;
const folder = 'E:/BhuAayam-data/datasets/nyc-10013/files/';
const scratch = `E:/BhuAayam-data/task-data/lp1/${nonce}`;
const originalPath = `${folder}buildings-original.geojson`;
const sourceHashes = new Map<string, string>();
const manual = new ManualIngestionService();
const intake = new IntakeService();
const results: Record<string, any> = {};
const times: { step: string; wallMs: number }[] = [];

function ownedBox() {
  assert.match(nonce, /^[a-f0-9]{16}$/);
  const container = process.env.ULPIN_LP1_CONTAINER!;
  assert.equal(container, `ulpin-lp1-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'lp1_control');
  assert.equal(url.password, '');
  assert.equal(url.pathname, `/lp1_${nonce}`);
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'LP1']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
  const globals = globalThis as unknown as { ulpinPool?: Pool };
  globals.ulpinPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8,
    connectionTimeoutMillis: 10000 });
}

function original(name: string) {
  const path = `${folder}${name}`;
  const bytes = readFileSync(path);
  sourceHashes.set(path, hash(bytes));
  return bytes;
}

async function measured<T>(step: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await work();
  const entry = { step, wallMs: Math.round((performance.now() - started) * 1000) / 1000 };
  times.push(entry);
  console.log(JSON.stringify({ completed: step, wallMs: entry.wallMs }));
  return result;
}

function halves() {
  const bytes = original('buildings-original.geojson');
  assert.equal(hash(bytes), '107561166456f2c3aa4d6c6510c46e3b9a7c9eb91824762fbf7ba47b0d05ac8e');
  const document = JSON.parse(bytes.toString());
  const split = Math.floor(document.features.length / 2);
  mkdirSync(scratch, { recursive: true });
  const parts = [document.features.slice(0, split), document.features.slice(split)];
  results.derivatives = parts.map((features, index) => {
    const name = `buildings-half-${index + 1}.geojson`;
    const path = `${scratch}/${name}`;
    const derivative = Buffer.from(JSON.stringify({ ...document, features }));
    writeFileSync(path, derivative, { flag: 'wx' });
    return { path, name, features: features.length, sha256: hash(derivative),
      originalPath, originalSha256: hash(bytes), firstFeatureIndex: index === 0 ? 0 : split,
      qualification: 'test_only derivative by feature order; never replaces original' };
  });
  return results.derivatives as { path: string; name: string }[];
}

async function draft(sourceId: string) {
  const job = (await query(`SELECT id FROM jobs WHERE source_id=$1 AND operation='intake-draft'
    AND status='queued' ORDER BY created_at LIMIT 1`, [sourceId])).rows[0];
  assert(job, 'Expected a queued draft job.');
  await runIntakeDraftJob(job.id);
  const result = (await query('SELECT status,error FROM jobs WHERE id=$1', [job.id])).rows[0];
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
}

async function chooseLayout(caseId: string, profile: SourceProfile) {
  const prior = (await query('SELECT body FROM usp_mapping_recipes WHERE source_id=$1',
    [profile.source.sourceId])).rows[0]?.body as MappingReceipt | undefined;
  if (prior) {
    assert.equal(prior.state, 'proposed');
    await manual.decide(caseId, prior.id,
      { requestKey: randomUUID(), expectedRecipeRevision: prior.revision }, 'approve');
    return;
  }
  const inspected = await manual.inspect(caseId, profile.source.sourceId);
  const source = (await query('SELECT inspection FROM sources WHERE id=$1', [profile.source.sourceId])).rows[0];
  const areaId = (await query('SELECT a.id FROM map_areas a JOIN cases c ON c.site_id=a.site_id WHERE c.id=$1',
    [caseId])).rows[0]?.id;
  const destination = intakeDestination(source.inspection.gis, areaId ? await getArea(areaId) : null);
  const authored = await manual.author(caseId, profile.source.sourceId, { requestKey: randomUUID(),
    expectedRecipeRevision: 0, plan: { version: inspected.version, mode: 'manual_mapping', source: inspected.source,
      caseId, workspaceRevision: inspected.workspaceRevision, workspaceFingerprint: inspected.workspaceFingerprint,
      operations: [
        { target: 'building.sourceKey', sourcePath: '/features/*/properties/doitt_id',
          conversionId: 'literal_identifier@1' },
        { target: 'building.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_polygon@1' },
      ] }, destination }) as MappingReceipt;
  await manual.decide(caseId, authored.id,
    { requestKey: randomUUID(), expectedRecipeRevision: authored.revision }, 'approve');
}

async function prepareFile(caseId: string, profile: SourceProfile) {
  await measured('initial draft', () => draft(profile.source.sourceId));
  const initial = (await query('SELECT plan_ref FROM usp_intake_items WHERE source_id=$1',
    [profile.source.sourceId])).rows[0];
  if (!initial.plan_ref?.packageId) {
    await chooseLayout(caseId, profile);
    await measured('approved draft', () => draft(profile.source.sourceId));
  }
  const item = (await query('SELECT plan_ref FROM usp_intake_items WHERE source_id=$1',
    [profile.source.sourceId])).rows[0];
  const job = (await query(`SELECT id FROM jobs WHERE operation='intake-run' AND status='queued'
    AND payload->>'packageId'=$1`, [item.plan_ref.packageId])).rows[0];
  assert(job);
  await measured('prepare package', () => runIntakeRunJob(job.id));
  return getPackage(item.plan_ref.packageId);
}

async function retainBoth(caseId: string) {
  const profiles: SourceProfile[] = [];
  for (const part of halves()) {
    const revision = (await query('SELECT revision FROM cases WHERE id=$1', [caseId])).rows[0].revision;
    const profile = await manual.retain(caseId, { requestKey: randomUUID(), expectedWorkspaceRevision: revision,
      format: 'geojson' }, { name: part.name, bytes: readFileSync(part.path) }) as SourceProfile;
    await intake.register(caseId, { sourceId: profile.source.sourceId, requestKey: randomUUID() });
    profiles.push(profile);
  }
  return profiles;
}

async function confirmationWalk() {
  const { caseId } = await createSourceCase({ requestKey: randomUUID(), name: 'LP1 NYC split test_only' });
  const packages: ImportPackage[] = [];
  for (const profile of await retainBoth(caseId)) packages.push(await prepareFile(caseId, profile));
  assert.equal(packages[0].areaId, packages[1].areaId);
  assert.equal(packages[0].review!.areaRevision, packages[1].review!.areaRevision);
  const targets = [];
  for (const pkg of packages) targets.push(...(await query(`SELECT target_id FROM usp_intake_targets
    WHERE package_id=$1 AND readiness='ready' ORDER BY target_id LIMIT 2`, [pkg.id])).rows.map(row => row.target_id));
  assert.equal(targets.length, 4);
  const confirmation = await confirmIntake(caseId, { requestKey: randomUUID(), acknowledgement:
    'LP1 test_only: record cited publisher exteriors; unknown heights, floors, units and rights remain unknown.',
  packages: packages.map(pkg => ({ packageId: pkg.id, revision: pkg.revision,
    reviewFingerprint: pkg.review!.inputFingerprint })), targets });
  const job = (await query(`SELECT id FROM jobs WHERE operation='intake-run' AND payload->>'phase'='commit'
    AND payload->>'confirmationId'=$1`, [confirmation.confirmationId])).rows[0];
  let refusal: any = null;
  try { await measured('confirmation commit', () => runIntakeRunJob(job.id)); }
  catch (error: any) { refusal = { status: error.status, code: error.code, message: error.message }; }
  const recorded = await readIntakeConfirmation(caseId, confirmation.confirmationId);
  const states = await Promise.all(packages.map(pkg => getPackage(pkg.id).then(value => value.state)));
  results.batch = { caseId, areaId: packages[0].areaId, packageIds: packages.map(pkg => pkg.id),
    reviewedAreaRevisions: packages.map(pkg => pkg.review!.areaRevision), states, refusal,
    counts: recorded.counts, selectedTargets: recorded.progress.map(target => ({ targetId: target.targetId,
      readiness: target.readiness, blockedBy: target.blockedBy, reason: target.reason })) };
  if (phase === 'before') {
    assert.deepEqual(refusal, { status: 409, code: 'STALE_REVISION',
      message: 'Area neighbours changed; review the proposed update again.' });
    assert.deepEqual(states, ['COMMITTED', 'REVIEWED']);
    assert.equal(recorded.counts.stopped, 2);
    const second = await getPackage(packages[1].id);
    const reviewed = await reviewPackage(second.id, second.revision);
    await commitPackage(reviewed.id, reviewed.revision, 'LP1 baseline only: refreshed after measured refusal.');
  } else {
    assert.equal(refusal, null);
    assert.deepEqual(states, ['COMMITTED', 'COMMITTED']);
    await cardTargets(caseId, confirmation.confirmationId);
  }
  return getPackage(packages[0].id);
}

async function cardTargets(caseId: string, confirmationId: string) {
  const jobs = (await query(`SELECT id FROM jobs WHERE operation='intake-run' AND payload->>'phase'='target'
    AND payload->>'confirmationId'=$1 ORDER BY created_at,id`, [confirmationId])).rows;
  assert.equal(jobs.length, 4);
  for (const job of jobs) await measured('target to card', () => runIntakeRunJob(job.id));
  const completed = await readIntakeConfirmation(caseId, confirmationId);
  assert.equal(completed.counts.carded, 4);
  assert.equal(completed.counts.stopped, 0);
  results.batch.cards = completed.progress.map(target => ({ targetId: target.targetId, locator: target.locator,
    card: target.artefacts.card, verification: target.artefacts.verification }));
  results.batch.finalCounts = completed.counts;
}

async function contextPlan(pkg: ImportPackage) {
  const area = await getArea(pkg.areaId);
  const extent = (pkg as any).extent;
  const box = [extent[0] - 255, extent[1] - 255, extent[2] + 255, extent[3] + 255];
  const statement = readFileSync('docs/evidence/gf1/lp1/context.sql', 'utf8');
  const params = [area.id, ...box, ...(pkg as any).geographicExtent,
    Number(area.reference!.analysisCrs.split(':')[1]), ...area.reference!.origin,
    pkg.features.map(feature => feature.id), true];
  await query('ANALYZE physical_features');
  const indexes = (await query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE tablename IN ('physical_features','usp_geometry_qualifications') ORDER BY tablename,indexname`)).rows;
  const plan = (await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`, params)).rows[0]['QUERY PLAN'];
  const planPath = `${scratch}/context-plan.json`;
  writeFileSync(planPath, JSON.stringify(plan), { flag: 'wx' });
  const nodes: any[] = [];
  const visit = (node: any) => {
    nodes.push({ type: node['Node Type'], relation: node['Relation Name'], index: node['Index Name'],
      actualRows: node['Actual Rows'], loops: node['Actual Loops'] });
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan[0].Plan);
  results.context = { indexes, statementSha256: hash(Buffer.from(statement)), widenedExtent: box,
    recordedBuildings: (await query('SELECT count(*)::int count FROM physical_features WHERE revision>0')).rows[0].count,
    qualifications: (await query('SELECT count(*)::int count FROM usp_geometry_qualifications')).rows[0].count,
    planPath, planNodes: nodes, executionMs: plan[0]['Execution Time'], planningMs: plan[0]['Planning Time'],
    qualification: 'NYC rows remain unqualified; view yields no context; no qualification manufactured.' };
}

async function vectorLayers() {
  const names = phase === 'before' ? ['buildings-original.geojson']
    : ['buildings-original.geojson', 'hydrography.geojson', 'parks.geojson', 'roadbed.geojson', 'sidewalk.geojson'];
  const reviewed: ImportPackage[] = [];
  for (const name of names) {
    const bytes = original(name);
    const document = JSON.parse(bytes.toString());
    const key = name === 'buildings-original.geojson' ? 'doitt_id'
      : Object.keys(document.features[0].properties).find(field => /^(objectid|object_id|id)$/i.test(field));
    const kind = name === 'buildings-original.geojson' ? 'building'
      : ['roadbed.geojson', 'sidewalk.geojson'].includes(name) ? 'road' : 'public_land';
    const pkg = await ingestArea({ bytes, filename: name, format: 'geojson', areaId: reviewed[0]?.areaId,
      namespace: `lp1-${nonce}-${name}`, name: `LP1 NYC vector test_only ${name}`,
      mapping: { kind, ...(key ? { idField: key } : {}) }, worldStatus: 'observed' });
    reviewed.push(await measured(`review ${name}`, () => reviewPackage(pkg.id, pkg.revision)));
  }
  results.layers = [];
  for (let index = 0; index < reviewed.length; index++) {
    const pkg = reviewed[index];
    const committed = await measured(`commit ${names[index]}`, () => commitPackage(pkg.id, pkg.revision,
      'LP1 test_only: publisher vectors, physical observations only; no qualification or rights assertion.'));
    results.layers.push({ name: names[index], features: pkg.features.length, kind: pkg.features[0].kind,
      reviewAreaRevision: pkg.review!.areaRevision, state: committed.state, scope: pkg.review!.scope });
  }
  assert(reviewed.every(pkg => pkg.review!.areaRevision === 0));
}

async function main() {
  ownedBox();
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await query(sql('ingestion.intake.targets'));
    await startControls();
    const first = await confirmationWalk();
    await contextPlan(first);
    if (phase === 'after') await vectorLayers();
  } catch (error: any) {
    results.failure = { status: error.status, code: error.code, message: error.message,
      stack: error.stack?.split('\n') };
    process.exitCode = 1;
  } finally {
    await stopControls();
    await closePool();
    for (const [path, expected] of sourceHashes) assert.equal(hash(readFileSync(path)), expected);
    console.log(JSON.stringify({ task: 'LP1', phase, results, times,
      originalHashes: Object.fromEntries(sourceHashes), originalHashesUnchanged: true,
      network: 'Own loopback PostgreSQL, in-memory storage and unchanged product Python; providers disabled' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ task: 'LP1', fatal: error.message }));
  process.exitCode = 1;
});
