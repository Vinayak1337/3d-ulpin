// R2 resumes the saved Tower 3 identity journey only. No configuration, SQL, provider or import operations.
// R1's helpers are private and bound to its create-once root; reuse its count routes and exchange shape here.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SourceSpaceRequestSchema, SourceSpaceReceiptSchema,
} from '../../packages/contracts/src/canonical/source-spaces';
import { UspCaptureSnapshotRequestSchema } from '../../packages/contracts/src/usp/ports';
import { UspSnapshotManifestSchema } from '../../packages/contracts/src/usp/domain';

const base = 'http://127.0.0.1:3194';
const root = 'E:/BhuAayam-data/task-data/r2';
const buildingId = '6f95d04e-2067-4ac8-a3c2-6cc21ea46325';
const sourceId = '5293cd72-2377-4deb-a51c-c76d11ccb429';
const sourceHash = '2b9f8803e179c515a694d046ba9c9e5394a79af59e3db75c1748c41fad04c865';
const reason = 'Entered for the selection demo by the project lead from the cited boxed label UNIT-3B '
  + 'on the 2ND FLOOR PLAN sheet. A label citation only: no boundary, geometry, area, use or rights. '
  + "Not a field officer's decision.";
type Exchange = { status: number; body: any };

function save(directory: string, name: string, value: unknown) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), JSON.stringify(value) + '\n', { flag: 'wx' });
}

async function exchange(directory: string, name: string, path: string, input?: unknown,
  headers: Record<string, string> = {}): Promise<Exchange> {
  const method = input === undefined ? 'GET' : 'POST';
  save(directory, `${name}-request.json`, { method, path, body: input ?? null, headers, at: new Date().toISOString() });
  const response = await fetch(base + path, {
    method, body: input === undefined ? undefined : JSON.stringify(input),
    headers: { 'Content-Type': 'application/json', ...headers }, signal: AbortSignal.timeout(60000),
  });
  const result = { status: response.status, body: await response.json() };
  save(directory, `${name}-response.json`, { ...result, headers: Object.fromEntries(response.headers),
    at: new Date().toISOString() });
  console.log(`${name}: HTTP ${result.status}`);
  return result;
}

function accepted(step: string, result: Exchange) {
  if (result.status >= 200 && result.status < 300) return result.body;
  throw new Error(`R2_STEP_REFUSED ${step}: HTTP ${result.status} ${result.body?.code ?? result.body?.error?.code}`);
}

function stored(stage: string, name: string) {
  return JSON.parse(readFileSync(join(root, stage, `${name}-response.json`), 'utf8')).body;
}

async function probes() {
  const directory = join(root, 'step1');
  const query = `revision=1&sha256=${sourceHash}&offset=0&limit=1`;
  const pages = accepted('page probe', await exchange(directory, 'pages',
    `/api/v1/sources/${sourceId}/pages?${query}`));
  assert.equal(pages.pages[0].frame.width, 2586);
  assert.equal(pages.pages[0].frame.height, 1695);
  const canonical = accepted('canonical probe', await exchange(directory, 'canonical',
    `/api/v1/buildings/${buildingId}/canonical`));
  save(directory, 'probe-summary.json', { pagesStatus: 200, frame: pages.pages[0].frame, canonicalStatus: 200,
    canonicalRevision: canonical.revisionId, schedule: canonical.levelSchedule.state });
}

async function counts(stage: string) {
  const directory = join(root, 'invariants');
  const read = async (name: string) => accepted(name, await exchange(directory, `${stage}-${name}`, `/api/v1/${name}`));
  const [areas, registry, sites, cases, health] = [await read('areas'), await read('registry'), await read('sites'),
    await read('cases'), await read('health')];
  const data = health.databaseReadiness.data;
  const learnerPath = '/api/v1/ingestion/cases/1ada7796-4e8f-4a19-9b7f-4414e80114c4/sources/'
    + 'd6dffbcc-7ee0-4467-9ddf-4952bd23c33c/chunk-mapping/jobs/4b48f457-2671-4937-a973-f040b5fc20d5/chunks/0';
  const learner = accepted('retained learner lineage', await exchange(directory, `${stage}-learner`, learnerPath));
  const result = { areas: areas.length, registry: registry.length, sites: sites.length, cases: cases.length,
    sources: data.sourceCount, importPackages: data.importPackageCount, physicalFeatures: data.physicalFeatureCount,
    learnerVersion: learner.payload.mapping.metrics.learnerVersion,
    learnerVersionSource: 'R1 retained last-job chunk metrics; not a new learning event' };
  save(directory, `${stage}-summary.json`, result);
  console.log(JSON.stringify(result));
}

async function record() {
  const directory = join(root, 'step2');
  const canonical = accepted('canonical before record', await exchange(directory, '01-canonical',
    `/api/v1/buildings/${buildingId}/canonical`));
  assert.equal(canonical.levelSchedule.state, 'conflicting');
  assert.equal(canonical.levels.filter((level: any) => level.registryFloorId).length, 0, 'A floor is already recorded');
  assert.equal(canonical.levels.flatMap((level: any) => level.spaces).length, 0, 'A space is already recorded');
  const draft = JSON.parse(readFileSync('docs/evidence/gf1/k4c/source-space-request.json', 'utf8'));
  const input = SourceSpaceRequestSchema.parse({ ...draft, expectedCanonicalRevision: canonical.revisionId, reason });
  const headers = { 'Idempotency-Key': input.requestKey };
  const path = `/api/v1/buildings/${buildingId}/source-spaces`;
  const receipt = SourceSpaceReceiptSchema.parse(accepted('record', await exchange(directory, '02-record',
    path, input, headers)));
  const replay = SourceSpaceReceiptSchema.parse(accepted('record replay', await exchange(directory, '02-replay',
    path, input, headers)));
  assert.deepEqual(replay, receipt);
  save(directory, '02-summary.json', { receipt, replaySame: true });
}

async function snapshot() {
  const receipt = stored('step2', '02-record');
  const scopeId = stored('step2', '01-canonical').areaId;
  const input = UspCaptureSnapshotRequestSchema.parse({
    scopeId, world: { namespace: 'world', id: `registry-site/${scopeId}` }, stage: 'recorded',
    selection: { kind: 'targets', pins: [{ ref: { namespace: 'registry_record', id: receipt.spaceId },
      revision: receipt.spaceRevision }] },
  });
  const result = accepted('snapshot', await exchange(join(root, 'step2'), '03-snapshot',
    '/api/v1/usp/snapshots', input));
  UspSnapshotManifestSchema.parse(result.data);
}

async function readRecorded(stage: string) {
  const directory = join(root, stage);
  const receipt = stored('step2', '02-record');
  const canonical = accepted('recorded canonical read', await exchange(directory, 'recorded-canonical',
    `/api/v1/buildings/${buildingId}/canonical`));
  const floor = canonical.levels.find((level: any) => level.registryFloorId === receipt.floorId);
  const space = floor?.spaces.find((unit: any) => unit.spaceId === receipt.spaceId);
  assert(floor && space, 'Recorded hierarchy is missing');
  assert.equal(floor.label.value, '2ND FLOOR PLAN');
  assert.equal(space.label.value, 'UNIT-3B');
  assert.equal(floor.polygons.state, 'absent');
  assert.equal(space.polygons.state, 'absent');
  assert.equal(floor.lowerM.state, 'unknown');
  assert.equal(floor.upperM.state, 'unknown');
  assert.equal(space.areaM2.state, 'unknown');
  assert.equal(space.kind.state, 'unknown');
  assert.equal(space.proposedCode.value, null, 'No assignment has run');
  assert.deepEqual(canonical.parcelRefs, []);
  assert.equal(canonical.levelSchedule.state, 'conflicting');
  const citations = [...floor.label.citations, ...space.label.citations];
  assert.equal(citations.length, 2);
  assert(citations.every((citation: any) => citation.sourceId === sourceId
    && citation.sourceSha256 === sourceHash && citation.sourceRevision === 1 && citation.locator.page === 1));
  save(directory, 'recorded-summary.json', { canonicalRevision: canonical.revisionId,
    floorId: floor.registryFloorId, floorLabel: floor.label.value, spaceId: space.spaceId,
    spaceLabel: space.label.value, proposedCode: space.proposedCode, citations,
    lowerM: floor.lowerM, upperM: floor.upperM, areaM2: space.areaM2, kind: space.kind,
    floorGeometry: floor.polygons.state, spaceGeometry: space.polygons.state,
    schedule: canonical.levelSchedule.state, parcelRefs: canonical.parcelRefs });
}

async function studio() {
  await readRecorded('step3');
  const query = `revision=1&sha256=${sourceHash}&offset=0&limit=1`;
  accepted('Studio cited-page read', await exchange(join(root, 'step3'), 'cited-page',
    `/api/v1/sources/${sourceId}/pages?${query}`));
}

async function main() {
  const [action, stage] = process.argv.slice(2);
  if (action === 'counts') {
    assert(stage && /^[a-z0-9-]+$/.test(stage));
    return counts(stage);
  }
  const actions: Record<string, () => Promise<void>> = { probes, record, snapshot, studio,
    'record-read': () => readRecorded('step2') };
  assert(actions[action], 'Use probes | counts <stage> | record | snapshot | record-read | studio');
  await actions[action]();
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
