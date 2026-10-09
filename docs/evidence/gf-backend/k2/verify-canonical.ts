import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NormalizedAreaSchema, NormalizedBuildingSchema } from '../../../../packages/contracts/src/canonical/building';
import { toSceneInputs } from '../../../../packages/contracts/src/canonical/building-scene';

const base = 'http://127.0.0.1:3194/api/v1';
const read = (name: string) => JSON.parse(readFileSync(`docs/evidence/gf-backend/k2/${name}.json`, 'utf8'));
const area = NormalizedAreaSchema.parse(read('area-canonical'));
const building = NormalizedBuildingSchema.parse(read('building-canonical'));
const nyc = NormalizedAreaSchema.parse(read('nyc-area-canonical'));
assert.equal(area.baseFeatures.length, 2);
assert(area.baseFeatures.every(f => f.polygons.value === null && f.polygons.state === 'unknown'));
assert.equal(building.recordState, 'candidate');
assert.equal(building.baseM.value, null);
assert.equal(building.storeyCount.value, null);
assert.equal(building.footprint.state, 'candidate');
assert.equal(building.heightM.state, 'source_supported');
assert(Math.abs(building.heightM.value! - 10.207752) < 1e-12);
assert.equal(nyc.buildings.length, 62);
assert(nyc.buildings.every(b => b.recordState === 'candidate'));
const before = JSON.stringify([nyc, building]);
const scene = toSceneInputs(nyc, [building]);
assert.equal(scene.footprints.length, 62);
assert.equal(scene.styles[building.buildingId].candidate, true);
assert.equal(JSON.stringify([nyc, building]), before);
const exact = await fetch(`${base}/buildings/${building.buildingId}/canonical?revision=${building.revisionId}`);
assert.equal(exact.status, 200);
assert.equal(exact.headers.get('etag'), `"${building.revisionId}"`);
assert.deepEqual(NormalizedBuildingSchema.parse(await exact.json()), building);
const unknown = await fetch(`${base}/buildings/${building.buildingId}/canonical?revision=${'0'.repeat(64)}`);
assert.equal(unknown.status, 404);
const crossSite = await fetch(`${base}/areas/${area.frame.areaId}/canonical`, {
  headers: { 'sec-fetch-site': 'cross-site' },
});
assert.equal(crossSite.status, 403);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const original = await fetch(`${base}/sources/${building.footprint.citations[0].sourceId}/file`);
assert.equal(original.status, 200);
const nycHash = hash(new Uint8Array(await original.arrayBuffer()));
assert.equal(nycHash, building.footprint.citations[0].sourceSha256);
assert.equal(nycHash, hash(readFileSync('fixtures/real-area/original.geojson')));
const towerReceipt = read('tower3-document');
const towerOriginal = await fetch(`${base}/sources/${towerReceipt.sourceId}/file`);
assert.equal(towerOriginal.status, 200);
const towerHash = hash(new Uint8Array(await towerOriginal.arrayBuffer()));
assert.equal(towerHash, towerReceipt.sourceSha256);
const health = await (await fetch(`${base}/health`)).json();
assert.equal(health.ok, true);
const documentStatus = read('tower3-document-status');
const result = {
  schemaVersion: 'k2-runtime-evidence/1',
  gatesPassed: [],
  gateStatus: {
    'GF-CONTRACT': 'focused_contract_verified',
    'GF-SCENE': 'adapter_verified_renderer_unqualified',
    'GF-BACKEND': 'blocked',
    'GF-DATA': 'blocked',
  },
  runtime: { profile: 'demo', worktree: 'E:/Projects/ulpin-wt/k1', leftRunning: true, health: health.ok },
  http: {
    area: 200,
    building: 200,
    exactCurrentRevision: exact.status,
    unavailableRevision: unknown.status,
    crossSite: crossSite.status,
  },
  records: {
    gmdaRoadProposals: area.baseFeatures.length,
    nycBuildingProposals: nyc.buildings.length,
    reviewedOrCommittedBuildings: 0,
    tower3BuildingInstalled: false,
    biharMagnoliaBuildingInstalled: false,
    sourceReceipts: health.databaseReadiness.data.sourceCount,
  },
  sources: { nycSha256: nycHash, tower3Sha256: towerHash, originalHashesUnchanged: true },
  difficultInput: {
    nativeStatus: documentStatus.native.status,
    nativeCode: documentStatus.native.code,
    ocr: read('tower3-ocr-status').ocr,
    storeyConflict: ['G+41', 'G+42'],
    conflictLocation: '../k1/tower3-example.json',
    conflictInstalled: false,
  },
  import: {
    packageId: read('gmda-import').id,
    areaId: area.frame.areaId,
    questionCount: read('gmda-questions').length,
    review: read('gmda-review').error.code,
    prepare: read('gmda-prepare').error.code,
    commit: read('gmda-commit').error.code,
    pdfImport: read('tower3-import').error.code,
    pdfInspection: read('tower3-inspect').error.code,
  },
  sourcePinsRegeneration: 'lead required: docs/api/source-pins.json is outside K1 ownership',
  next: [
    'Resolve fresh-import source review versus geometry-analysis qualification '
      + 'without bypassing analytical safeguards.',
    'Extend the existing import contract to admit source-cited buildings with unknown footprint and placement; '
      + 'no parallel importer or invented polygons.',
    'Admit sector boundaries as administrative context, not parcels or public land; '
      + 'preserve road centrelines without guessed widths.',
    'Configure the existing local OCR runtime; no credentials changed or provider used.',
    'Install Tower 3 and Bihar Magnolia after import support, retain storey conflict, then recurl both routes.',
    'Scene owner to consume styles sidecar for candidate outlines and estimated envelope hatching.',
    'Add exact complete historical projection support using existing retained snapshots; '
      + 'current-only revision reads are honest 404.',
  ],
};
writeFileSync('docs/evidence/gf-backend/k2/result.json', JSON.stringify(result, null, 2) + '\n');
console.log(
  'Canonical curls valid; exact ETag/404/403 and unchanged original hashes verified. '
    + 'Import gates remain blocked.',
);
