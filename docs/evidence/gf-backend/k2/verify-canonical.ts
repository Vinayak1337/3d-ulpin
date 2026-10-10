import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  NormalizedAreaSchema, NormalizedBuildingSchema, type NormalizedBuilding,
} from '../../../../packages/contracts/src/canonical/building';
import { toSceneInputs } from '../../../../packages/contracts/src/canonical/building-scene';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2';
const read = (name: string) => JSON.parse(readFileSync(`${root}/${name}.json`, 'utf8'));
const save = (name: string, value: unknown) => {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
};
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function get(path: string) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200, path);
  return response;
}
async function captureBuilding(name: string): Promise<NormalizedBuilding> {
  const pkg = read(`${name}-source-commit`);
  const response = await get(`/buildings/${pkg.features[0].id}/canonical`);
  assert.match(response.headers.get('cache-control')!, /private.*no-store/);
  const building = NormalizedBuildingSchema.parse(await response.json());
  assert.equal(response.headers.get('etag'), `"${building.revisionId}"`);
  assert.equal(building.recordState, 'reviewed');
  for (const value of [building.footprint, building.heightM, building.baseM]) {
    assert.equal(value.value, null);
    assert.equal(value.state, 'unknown');
  }
  assert.equal(building.storeys.value, null);
  assert.equal(building.levels.length, 0);
  assert.equal(building.parcelRefs.length, 0);
  assert(building.inputRevisions.some(pin => pin.namespace === 'registry_record' && pin.revision === 1));
  const exact = await get(`/buildings/${building.buildingId}/canonical?revision=${building.revisionId}`);
  assert.deepEqual(await exact.json(), building);
  const historical = await fetch(`${base}/buildings/${building.buildingId}/canonical?revision=${'0'.repeat(64)}`);
  assert.equal(historical.status, 404);
  save(`${name}-canonical`, building);
  return building;
}
async function captureArea(name: string, areaId: string) {
  const response = await get(`/areas/${areaId}/canonical`);
  const area = NormalizedAreaSchema.parse(await response.json());
  assert.equal(response.headers.get('etag'), `"${area.revisionId}"`);
  save(`${name}-area-canonical`, area);
  return area;
}
async function verifyOriginals(name: string) {
  const pkg = read(name === 'gmda-context' ? 'gmda-context-commit' : `${name}-source-commit`);
  for (const pin of pkg.documentPins) {
    const response = await get(`/sources/${pin.sourceId}/file`);
    assert.match(response.headers.get('cache-control')!, /^private/);
    const digest = hash(new Uint8Array(await response.arrayBuffer()));
    assert.equal(digest, pin.sourceSha256);
  }
  return pkg.documentPins.map((pin: { sourceSha256: string }) => pin.sourceSha256);
}
async function confirmGisGuard() {
  const id = read('gmda-import').id;
  const before = await (await get(`/import-packages/${id}`)).json();
  const statuses: Record<string, { status: number; code: string }> = {};
  for (const action of ['review', 'prepare', 'commit']) {
    const response = await fetch(`${base}/import-packages/${id}/${action}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: before.revision,
        ...(action === 'commit' ? { acknowledgement: 'Unqualified analytical geometry must not be recorded.' } : {}),
      }) });
    const body = await response.json();
    const expected = action === 'commit' ? 'STALE_REVISION' : 'USP_GEOMETRY_PAYLOAD_UNQUALIFIED';
    assert.equal(body.error.code, expected);
    assert([409, 422].includes(response.status));
    statuses[action] = { status: response.status, code: body.error.code };
  }
  const after = await (await get(`/import-packages/${id}`)).json();
  assert.equal(after.revision, before.revision);
  assert.equal(after.state, before.state);
  assert.equal(after.review, undefined);
  save('geometry-safeguards', statuses);
  return statuses;
}

const tower = await captureBuilding('tower3');
const magnolia = await captureBuilding('magnolia');
const area = await captureArea('tower3', tower.areaId);
const local = await captureArea('magnolia', magnolia.areaId);
assert.equal(tower.storeyCount.state, 'conflicting');
assert.equal(tower.storeyCount.value, null);
assert.equal(tower.storeyCount.citations.length, 2);
assert.equal(tower.storeyLabel.state, 'conflicting');
const alternatives = tower.conflicts.find(conflict => conflict.property === 'building.storeyLabel')!.alternatives;
assert.deepEqual(alternatives.map(value => value.value), ['G+41', 'G+42']);
assert(alternatives.every(value => value.method === 'source_literal' && value.citations[0].locator.kind === 'page'));
assert.equal(magnolia.storeyCount.state, 'unknown');
assert.equal(magnolia.frame.placement, 'unknown');
assert.deepEqual(magnolia.frame.origin, { lon: null, lat: null, hEllipsoidal: null });
assert.equal(area.baseFeatures.length, 2);
assert(area.baseFeatures.every(feature => feature.kind === 'road' && feature.polygons.value === null));
assert.equal(area.administrativeContext?.length, 2);
assert(area.administrativeContext!.every(unit => unit.kind === 'sector' && unit.role === 'administrative_context'
  && unit.analyticalEligibility === 'not_assessed' && unit.polygons.state === 'candidate' && unit.polygons.value));
assert.equal(toSceneInputs(area, [tower]).footprints.length, 0);
assert.equal(toSceneInputs(local, [magnolia]).footprints.length, 0);
const originals = {
  tower: await verifyOriginals('tower3'), magnolia: await verifyOriginals('magnolia'),
  sectors: await verifyOriginals('gmda-context'),
};
const guards = await confirmGisGuard();
const crossSite = await fetch(`${base}/areas/${area.frame.areaId}/canonical`, {
  headers: { 'sec-fetch-site': 'cross-site' },
});
assert.equal(crossSite.status, 403);
const baselineNyc = NormalizedAreaSchema.parse(read('nyc-area-canonical'));
const liveNyc = NormalizedAreaSchema.parse(await (await get(`/areas/${baselineNyc.frame.areaId}/canonical`)).json());
assert.deepEqual(liveNyc, baselineNyc);
assert.equal(liveNyc.buildings.length, 62);
assert(liveNyc.buildings.every(building => building.recordState === 'candidate'));
const baselineBuilding = NormalizedBuildingSchema.parse(read('building-canonical'));
const liveBuilding = await (await get(`/buildings/${baselineBuilding.buildingId}/canonical`)).json();
assert.deepEqual(liveBuilding, baselineBuilding);
const spec = JSON.parse(readFileSync('docs/api/openapi.json', 'utf8'));
const withdrawSupported = Object.keys(spec.paths).some(path => (
  path.includes('import-packages') && /withdraw|reject/.test(path)
));
assert.equal(withdrawSupported, false);
save('nyc-cleanup', { action: 'left_unchanged', reason: 'development test import, not demo content',
  withdrawalApiAvailable: false, retainedUncommittedProposals: 62, deletionOrReset: false });
const health = await (await get('/health')).json();
assert.equal(health.ok, true);
save('result', {
  schemaVersion: 'k2-runtime-evidence/2', gatesPassed: [],
  gateStatus: { 'GF-BACKEND': 'source_ingestion_verified_analytical_geometry_unqualified',
    'GF-DATA': 'two_demo_buildings_installed_ocr_incomplete' },
  runtime: { profile: 'demo', worktree: 'E:/Projects/ulpin-wt/k1', leftRunning: true, health: true,
    servedBackendCodeCommit: 'c90a8a3e', restarts: [
      { completedAt: '2026-10-10T04:19:14+05:30', reason: 'geometry-free intake and OCR paths' },
      { completedAt: '2026-10-10T04:22:28+05:30', reason: 'original-only citation authority fix' },
      { completedAt: '2026-10-10T04:49:56+05:30', reason: 'final source citations and administrative context' },
    ], containersAndVolumesPreserved: true },
  checks: {
    backendTypecheck: { exitCode: 0 }, focusedTests: { exitCode: 0, passed: 9, skipped: 0 },
    canonicalRuntime: { exitCode: 0 },
    apiContractLfExport: { exitCode: 0, operations: 290, namedSchemas: 323, reviewedProducers: 34 },
    doctor: { exitCode: 0, scope: 'paths/health/ownership; not OCR execution qualification' },
    diffCheck: { exitCode: 0 },
  },
  records: { reviewedOrCommittedBuildings: 2, tower3BuildingInstalled: true, biharMagnoliaBuildingInstalled: true,
    administrativeSectors: 2, administrativePhysicalFeaturesCreated: 0,
    retainedRoadProposals: 2, retainedNycProposals: 62, sourceReceipts: health.databaseReadiness.data.sourceCount },
  canonical: { tower: { buildingId: tower.buildingId, revisionId: tower.revisionId, areaId: tower.areaId },
    magnolia: { buildingId: magnolia.buildingId, revisionId: magnolia.revisionId, areaId: magnolia.areaId },
    currentEtags: 200, unavailableRevision: 404, crossSite: 403, unknownFootprintsRemainNull: true },
  originals: { ...originals, allRetainedHashesVerified: true },
  difficultInput: { storeyCount: 'conflicting', alternatives: ['G+41', 'G+42'], installedConflictVerified: true,
    native: read('tower3-installed-ocr-region-status').native,
    wholePageOcr: read('tower3-installed-ocr-status').ocr,
    boundedRegionOcr: read('tower3-installed-ocr-region-status').ocr, firstResultLines: [], hindi: 'unavailable' },
  geometrySafeguards: guards, nycUnchanged: true, sourcePinsRegenerated: true,
  remaining: ['OCR runner exception diagnostic; no text or Hindi result claimed.',
    'Geometry-bearing fresh import qualification/review remains blocked; no safeguard bypass.',
    'Scene owner must render administrative context and candidate/hatch sidecar.',
    'Generic GIS/registry corrections for unknown-footprint records require their own explicit source-only contract.',
    'Complete historical projection revisions remain unavailable.'],
});
console.log('Two installed canonical buildings, source hashes, cited conflict, sector role, '
  + 'ETags/404/403 and GIS guards verified.');
