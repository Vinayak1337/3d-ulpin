import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { AnyMappingReceiptSchema, AnySourceProfileSchema, IntakeItemSchema, IntakeManifestSchema,
  IntakeTargetPageSchema, MappingPlanSchema, type MappingReceipt, type SourceProfile } from
  '../../../../packages/contracts/src/usp';
import { sourceCase } from '../../../../apps/api/src/modules/intake/wire-schemas';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { intakeHttp, rejectedHttp, startHttp, stopHttp } from '../kn2/http';
import { assertOwnBox, startSandbox, stopSandbox } from './sandbox';
import { observeJobs, drainJobs, itemJobs } from './jobs';
import { openStream } from './streams';

const path = 'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson';
const original = readFileSync(path);
const originalHash = sha256(original);
const results: Record<string, unknown> = {};
const failures: unknown[] = [];
const streams: Awaited<ReturnType<typeof openStream>>[] = [];

async function retainBatch(name: string, runJobs = true) {
  const { caseId } = await intakeHttp('POST', '/api/v1/source-cases', '/api/v1/source-cases',
    sourceCase, { requestKey: randomUUID(), name }, 201);
  const form = new FormData();
  form.set('file', new File([original], 'buildings-original.geojson', { type: 'application/geo+json' }));
  form.set('format', 'geojson');
  form.set('requestKey', randomUUID());
  form.set('expectedWorkspaceRevision', '0');
  const profile = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/sources`,
    '/api/v1/ingestion/cases/{caseId}/sources', AnySourceProfileSchema, form, 201) as SourceProfile;
  const item = await intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/intake/items`,
    '/api/v1/ingestion/cases/{caseId}/intake/items', IntakeItemSchema,
    { requestKey: randomUUID(), sourceId: profile.source.sourceId }, 201);
  if (runJobs) await drainJobs();
  return { caseId, profile, item };
}

async function row(caseId: string) {
  const manifest = await intakeHttp('GET', `/api/v1/ingestion/cases/${caseId}/intake`,
    '/api/v1/ingestion/cases/{caseId}/intake', IntakeManifestSchema);
  assert.equal(manifest.items.length, 1);
  return manifest.items[0];
}

function planFor(profile: SourceProfile) {
  return MappingPlanSchema.parse({ version: profile.version, mode: 'manual_mapping', source: profile.source,
    caseId: profile.caseId, workspaceRevision: profile.workspaceRevision,
    workspaceFingerprint: profile.workspaceFingerprint, kind: 'building', operations: [
      { target: 'feature.sourceKey', sourcePath: '/features/*/properties/doitt_id',
        conversionId: 'literal_identifier@1' },
      { target: 'feature.geometry', sourcePath: '/features/*/geometry', conversionId: 'geojson_geometry@1' },
    ] });
}

async function author(caseId: string, sourceId: string, input: unknown) {
  return intakeHttp('POST', `/api/v1/ingestion/cases/${caseId}/sources/${sourceId}/recipes`,
    '/api/v1/ingestion/cases/{caseId}/sources/{sourceId}/recipes', AnyMappingReceiptSchema,
    input, 201) as Promise<MappingReceipt>;
}

async function firstAnswer(batch: Awaited<ReturnType<typeof retainBatch>>) {
  const input = { requestKey: randomUUID(), expectedRecipeRevision: 0, plan: planFor(batch.profile) };
  const receipt = await author(batch.caseId, batch.profile.source.sourceId, input);
  const answered = performance.now();
  assert.equal(receipt.revision, 1);
  assert.equal(receipt.state, 'proposed');
  const jobsBeforeReplay = await itemJobs(batch.item.itemId);
  assert.deepEqual(await author(batch.caseId, batch.profile.source.sourceId, input), receipt);
  assert.deepEqual(await itemJobs(batch.item.itemId), jobsBeforeReplay);
  await drainJobs();
  const published = await row(batch.caseId);
  const elapsed = Math.round(performance.now() - answered);
  assert.equal(published.state, 'planned');
  assert.equal(published.placement, 'undecided');
  assert.equal(published.limitReason, null);
  assert.deepEqual(published.plan, { recipeId: receipt.id, recipeRevision: 1,
    recipeState: 'proposed', origin: 'officer', packageId: null });
  results.firstAuthor = { receipt, author201ToFirstNonNullPlanMs: elapsed, row: published,
    jobs: await itemJobs(batch.item.itemId), replayEnrolledNoNewJob: true, executedBeforeApproval: false };
  for (const stream of streams) await stream.wait(() => stream.events.some(event =>
    event.change.kind === 'intake.item' && event.change.itemId === batch.item.itemId));
  return receipt;
}

async function secondAnswer(batch: Awaited<ReturnType<typeof retainBatch>>, first: MappingReceipt) {
  // Change one top-level member (operations order), not any source fact or its meaning.
  const plan = { ...first.plan, operations: [...first.plan.operations].reverse() };
  const receipt = await author(batch.caseId, batch.profile.source.sourceId,
    { requestKey: randomUUID(), expectedRecipeRevision: 1, plan });
  await drainJobs();
  const published = await row(batch.caseId);
  assert.equal(receipt.revision, 2);
  assert.equal(published.plan?.recipeRevision, 2);
  assert.equal(published.plan?.origin, 'officer');
  assert(!published.plan?.packageId);
  results.secondAuthor = { changedMember: 'operations array order reversed; same two mappings and no fact changed',
    receipt, row: published, jobs: await itemJobs(batch.item.itemId) };
  return receipt;
}

async function checkStreams(itemId: string, recipeId: string) {
  for (const stream of streams) {
    await stream.wait(() => stream.events.some(event => event.change.kind === 'recipe.changed'
      && event.change.recipeId === recipeId && event.change.recipeRevision === 2));
    const changes = stream.events.map(event => event.change);
    const recipe = changes.findIndex(change => change.kind === 'recipe.changed'
      && change.recipeId === recipeId && change.recipeRevision === 1);
    const item = changes.findIndex(change => change.kind === 'intake.item' && change.itemId === itemId);
    assert(recipe >= 0 && item > recipe, JSON.stringify(changes));
  }
  results.streams = streams.map(stream => ({ status: stream.status,
    recipeChangedThenIntakeItem: true, events: stream.events }));
  for (const stream of streams) await stream.close();
}

async function approveAndPrepare(batch: Awaited<ReturnType<typeof retainBatch>>, current: MappingReceipt) {
  const approved = await intakeHttp('POST', `/api/v1/ingestion/cases/${batch.caseId}/recipes/${current.id}/approve`,
    '/api/v1/ingestion/cases/{caseId}/recipes/{recipeId}/approve', AnyMappingReceiptSchema,
    { requestKey: randomUUID(), expectedRecipeRevision: current.revision }, 200);
  const pressed = performance.now();
  await drainJobs();
  const published = await row(batch.caseId);
  const targets = await intakeHttp('GET', `/api/v1/ingestion/cases/${batch.caseId}/targets`,
    '/api/v1/ingestion/cases/{caseId}/targets', IntakeTargetPageSchema);
  assert.equal(targets.packages.length, 1);
  assert.equal(targets.packages[0].state, 'REVIEWED');
  assert(targets.packages[0].reviewFingerprint);
  assert.equal(targets.counts.ready, 1661);
  results.approval = { receipt: approved, approve200ToPreparedMs: Math.round(performance.now() - pressed),
    row: published, readyBuildings: targets.counts.ready, packages: targets.packages,
    jobs: await itemJobs(batch.item.itemId), noRecordingOrCardRequest: true };
}

async function memoryControl() {
  const batch = await retainBatch('AQ1 same original layout-memory control test_only', false);
  let stopped: unknown;
  try { await drainJobs(); }
  catch (error) { stopped = error; }
  const published = await row(batch.caseId);
  const jobs = await itemJobs(batch.item.itemId);
  assert.equal(jobs.length, 1);
  if (stopped) {
    assert.equal(jobs[0].status, 'stale');
    const refusal = await rejectedHttp(
      `/api/v1/ingestion/cases/${batch.caseId}/sources/${batch.profile.source.sourceId}/recipes`,
      { requestKey: randomUUID(), expectedRecipeRevision: 0, plan: planFor(batch.profile) }, 409);
    assert.equal(refusal.code, 'STALE_REVISION');
    assert.equal(refusal.message, 'This destination already exists; pin its current area and reference explicitly.');
    results.memory = { qualified: false, row: published, jobs, refusal, stopRule: 'a',
      location: 'packages/server/src/modules/usp/ingestion/service.ts:109-110 (destination, outside owned edit)',
      oneInitialJob: true, originReadBackQualified: false, noRetryOrDestinationOverride: true };
    return;
  }
  assert.equal(jobs[0].status, 'succeeded');
  assert.equal(published.plan?.origin, 'memory');
  assert.equal(published.plan?.recipeState, 'proposed');
  assert(!published.plan?.packageId);
  results.memory = { qualified: true, row: published, jobs,
    oneJobForWorkerAuthoring: true, approvalNotTransferred: true };
}

async function walk() {
  const batch = await retainBatch('AQ1 officer layout publication test_only');
  const waiting = await row(batch.caseId);
  assert.equal(waiting.placement, 'needs_answer');
  assert.equal(waiting.plan, null);
  results.waiting = { row: waiting, jobs: await itemJobs(batch.item.itemId) };
  streams.push(await openStream(batch.caseId));
  streams.push(await openStream(batch.caseId));
  const first = await firstAnswer(batch);
  const current = await secondAnswer(batch, first);
  await checkStreams(batch.item.itemId, first.id);
  await approveAndPrepare(batch, current);
  await memoryControl();
  results.harnessChoices = { kind: 'building', identifier: 'doitt_id', retainedFeatureGeometry: true,
    noName: true, noHeight: true, destinationOmitted: true };
}

async function main() {
  assertOwnBox();
  try {
    observeJobs();
    await query(sql('bootstrap.postgis'));
    await migrate();
    await query(sql('ingestion.intake.targets'));
    await startSandbox();
    await startHttp();
    await walk();
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n') });
    process.exitCode = 1;
  } finally {
    for (const stream of streams) await stream.close();
    results.http = await stopHttp();
    await stopSandbox();
    await closePool();
    assert.equal(sha256(readFileSync(path)), originalHash);
    console.log(JSON.stringify({ task: 'AQ1', results, failures, originalSha256: originalHash,
      originalHashesUnchanged: true, providers: 0, gpu: false,
      network: 'Loopback SQL/storage/product Python; PROJ_NETWORK=OFF; gateway disabled' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
