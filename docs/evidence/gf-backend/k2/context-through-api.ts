import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SourceBuildingImportSchema } from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const root = 'docs/evidence/gf-backend/k2';
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const save = (name: string, value: unknown) => {
  writeFileSync(`${root}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
};
async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  const value = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  return value;
}

const manifest = read('fixtures/usp/D4/reference-area-gurugram-59-63a/manifest.json');
const source = manifest.assets.find((asset: { id: string }) => asset.id === 'gmda-sector-boundaries');
const original = 'E:/BhuAayam-data/task-data/ulpin-data-09/gmda-sectors-59-63a.json';
const bytes = readFileSync(original);
assert.equal(createHash('sha256').update(bytes).digest('hex'), source.provenance.original.sha256);
const areaId = 'ed4bc3ae-1b02-412e-a5cc-02accf693a1b';
const privateInput = 'E:/BhuAayam-data/task-data/k2/gmda-context-input.json';
if (!existsSync(privateInput)) {
  const area = (await api(`/areas/${areaId}/context`)).area;
  const input = SourceBuildingImportSchema.parse({
    format: 'administrative_context', requestKey: randomUUID(), namespace: 'gmda-sector-boundary-context',
    name: 'GMDA sector 59 / 63 A administrative boundaries (test_only)', areaId, expectedAreaRevision: area.revision,
    documents: [{ key: 'sectors', filename: 'gmda-sectors-59-63a.json', sourceSha256: source.provenance.original.sha256,
      originalUrl: source.origin.url, issuer: source.attribution, acquiredAt: source.provenance.acquiredAt,
      permission: 'unconfirmed', classification: 'test_only' }],
    buildings: [], administrativeContext: { kind: 'sector', idField: 'FID', nameField: 'Name' },
  });
  writeFileSync(privateInput, JSON.stringify(input, null, 2) + '\n', { flag: 'wx' });
}
const input = SourceBuildingImportSchema.parse(read(privateInput));
const form = new FormData();
form.set('format', 'administrative_context');
form.set('metadata', JSON.stringify(input));
form.set('sectors', new File([bytes], 'gmda-sectors-59-63a.json', { type: 'application/json' }));
let pkg = await api('/import-packages', { method: 'POST', body: form });
save('gmda-context-import', pkg);
if (pkg.state !== 'COMMITTED') {
  pkg = await api(`/import-packages/${pkg.id}/prepare`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: pkg.revision }) });
  save('gmda-context-review', pkg);
  pkg = await api(`/import-packages/${pkg.id}/commit`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: pkg.revision,
      acknowledgement: 'Reviewed native GMDA names and boundary provenance for local administrative context only. '
        + 'Not parcels, public-land, property rights, measured terrain or analytically qualified geometry.' }) });
}
save('gmda-context-commit', pkg);
save('gmda-context-area-canonical', await api(`/areas/${areaId}/canonical`));
assert.equal(pkg.features.length, 0);
console.log(JSON.stringify({ state: pkg.state, administrativeUnits: pkg.administrativeContext.units.length,
  physicalFeaturesCreated: pkg.features.length, sourceId: pkg.sourceRevisionIds[0], areaId }));
