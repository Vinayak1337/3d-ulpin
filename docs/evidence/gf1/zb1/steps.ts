import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { closePool, migrate, query } from '../../../../packages/server/src/infrastructure/db';
import { sql } from '../../../../packages/server/src/infrastructure/sql-loader';
import { sha256 } from '../../../../packages/server/src/infrastructure/storage';
import { startHttp, stopHttp } from '../kn2/http';
import { readArea } from './area-read';
import { refusalControl } from './refusal-control';
import { startSandbox, stopSandbox } from '../aq1/sandbox';
import { idle, prepareJobs, reviews, startDispatcher, stopDispatcher } from './jobs';
import { confirm, drop, folder, layers, makeCase, manifest, packageRead, targets } from './http-walk';

const results: Record<string, unknown> = {};
const failures: unknown[] = [];
const hashes = layers.map(layer => ({ name: layer.name, sha256: sha256(readFileSync(folder + layer.name)) }));

function ownBox() {
  const nonce = process.env.ULPIN_ZB1_NONCE;
  const container = process.env.ULPIN_ZB1_CONTAINER!;
  assert.match(nonce ?? '', /^[a-f0-9]{16}$/);
  assert.equal(container, `ulpin-zb1-tmp-${nonce}`);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'zb1_control');
  assert.equal(url.pathname, `/zb1_${nonce}`);
  assert.equal(url.password, '');
  for (const [key, value] of [['io.ulpin.nonce', nonce], ['io.ulpin.task', 'ZB1']]) {
    assert.equal(execFileSync('docker', ['inspect', '--format',
      `{{ index .Config.Labels "${key}" }}`, container], { encoding: 'utf8' }).trim(), value);
  }
}

async function observation(caseId: string, item: Awaited<ReturnType<typeof drop>>) {
  const row = (await manifest(caseId)).items.find(row => row.itemId === item.itemId)!;
  const entry = (await targets(caseId)).packages.find(pkg => pkg.packageId === item.packageId)!;
  const pkg = await packageRead(item.packageId);
  return { observedAt: new Date().toISOString(), row, entry, prepareJobs: await prepareJobs(caseId),
    package: { id: pkg.id, areaId: pkg.areaId, revision: pkg.revision, state: pkg.state, review: pkg.review ?? null,
      features: pkg.features.length }, reviews: reviews.filter(review => review.packageId === item.packageId) };
}

async function buildingFirst() {
  const caseId = await makeCase();
  const buildings = await drop(caseId, layers[0]);
  await idle(caseId);
  const cards = await confirm(caseId, buildings.packageId, 100);
  assert.equal(cards.confirmation.counts.carded, 100);
  results.buildingFirst = { caseId, buildings, cards };
  const parks = await drop(caseId, layers[1]);
  const initial = await observation(caseId, parks);
  await delay(Math.max(0, 120000 - (Date.now() - Date.parse(parks.draftedAt))));
  await idle(caseId);
  const final = await observation(caseId, parks);
  results.buildingFirst = { caseId, buildings, cards, parks, initial, final,
    waitedAfterDraftMs: Date.now() - Date.parse(parks.draftedAt), noManualReviewRequest: true };
  if (process.env.ULPIN_ZB1_ORDER === 'final') await recordLayers(caseId, parks, final);
}

async function recordLayers(caseId: string, parks: Awaited<ReturnType<typeof drop>>,
  final: Awaited<ReturnType<typeof observation>>) {
  if (!final.entry.reviewFingerprint) {
    results.parksRecording = { notConfirmed: true, observation: final };
    return;
  }
  const recorded = await confirm(caseId, parks.packageId, 0);
  const area = await readArea(final.package.areaId);
  assert.equal(area.buildings, 1661);
  assert.equal(area.publicLand, 41);
  results.parksRecording = { recorded, area, targetsListed: 0 };
  const roads = await drop(caseId, layers[2]);
  await idle(caseId);
  const observationRead = await observation(caseId, roads);
  if (!observationRead.entry.reviewFingerprint) {
    results.roadsRecording = { notConfirmed: true, observation: observationRead };
    return;
  }
  results.roadsRecording = { roads, observation: observationRead,
    recorded: await confirm(caseId, roads.packageId, 0), targetsListed: 0 };
  Object.assign(results.roadsRecording!, { area: await readArea(final.package.areaId) });
}

async function parksFirst() {
  const caseId = await makeCase();
  const parks = await drop(caseId, layers[1]);
  await idle(caseId);
  const first = await observation(caseId, parks);
  const buildings = await drop(caseId, layers[0]);
  await idle(caseId);
  const final = await observation(caseId, parks);
  results.parksFirst = { caseId, parks, first, buildings, final, noRecordingInBetween: true,
    noManualReviewRequest: true };
}

async function main() {
  ownBox();
  try {
    await query(sql('bootstrap.postgis'));
    await migrate();
    await startSandbox();
    await startHttp();
    startDispatcher();
    if (process.env.ULPIN_ZB1_ORDER === 'refusal-control') results.refusalControl = await refusalControl();
    else if (process.env.ULPIN_ZB1_ORDER === 'parks-first') await parksFirst();
    else await buildingFirst();
  } catch (error: any) {
    failures.push({ code: error.code, message: error.message, stack: error.stack?.split('\n') });
    process.exitCode = 1;
  } finally {
    await stopDispatcher();
    results.http = await stopHttp();
    await stopSandbox();
    await closePool();
    for (const entry of hashes) assert.equal(sha256(readFileSync(folder + entry.name)), entry.sha256);
    console.log(JSON.stringify({ task: 'ZB1', results, failures, hashes, originalHashesUnchanged: true,
      providers: 0, network: 'Loopback tmpfs SQL, memory object storage, product Python offline' }));
  }
}

main().catch(error => {
  console.log(JSON.stringify({ failed: true, code: error.code, message: error.message }));
  process.exitCode = 1;
});
