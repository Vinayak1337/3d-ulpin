import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { SourceBuildingImportSchema, type SourceBuildingImport } from '../../../../packages/contracts/src/index';

const base = 'http://127.0.0.1:3194/api/v1';
const evidence = 'docs/evidence/gf-backend/k2';
const privateRoot = 'E:/BhuAayam-data/task-data/k2';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Original = { externalPath: string; sha256: string; url: string; retrievedAt: string };
type StoreyTruth = {
  split: string; projectSourceId: string; buildingLiteral: string; sources: Original[];
  documentStatements: { kind: string; value: string; citation: { page: number; locator: string; quote: string } }[];
};
type AreaPin = { id: string; revision: number };
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const save = (name: string, body: unknown) => {
  writeFileSync(`${evidence}/${name}.json`, JSON.stringify(body, null, 2) + '\n');
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function towerInput(
  truth: StoreyTruth, documents: SourceBuildingImport['documents'], area: AreaPin,
): SourceBuildingImport {
  const expressions = truth.documentStatements.filter(statement => statement.kind === 'floor_expression');
  return SourceBuildingImportSchema.parse({
    format: 'document_buildings', requestKey: randomUUID(), namespace: 'haryana-rera-2831-document-buildings',
    name: 'Haryana RERA 2831 — TOWER 3 source records (test_only)', areaId: area.id,
    expectedAreaRevision: area.revision, documents,
    buildings: [{ sourceKey: truth.buildingLiteral, name: truth.buildingLiteral,
      geometry: null, footprint: null, placement: 'unknown', worldStatus: 'planned',
      citations: [{ documentKey: 'document0', page: 1, locator: expressions[0].citation.locator }],
      claims: expressions.map(statement => ({ property: 'building.storeyLabel', value: statement.value,
        method: 'source_literal', citations: [{ documentKey: 'document0', page: statement.citation.page,
          locator: statement.citation.locator, quote: statement.citation.quote }] })),
    }],
  });
}

function magnoliaInput(truth: StoreyTruth, documents: SourceBuildingImport['documents']): SourceBuildingImport {
  return SourceBuildingImportSchema.parse({
    format: 'document_buildings', requestKey: randomUUID(), namespace: 'bihar-magnolia-document-buildings',
    name: 'Magnolia Residency — drawing-local, placement unknown (test_only)', documents,
    buildings: [{ sourceKey: truth.projectSourceId, name: truth.buildingLiteral,
      geometry: null, footprint: null, placement: 'unknown', worldStatus: 'planned',
      citations: [{ documentKey: 'document0', page: 1, locator: 'Sanctioned layout original; placement unknown' }],
      claims: [],
    }],
  });
}

async function importBuilding(which: string) {
  const filename = which === 'tower3' ? 'haryana-2831-tower3' : 'bihar-magnolia';
  const truth: StoreyTruth = read(`docs/evidence/usp/finale/GF-DATA/storey-truth/demo/${filename}.json`);
  assert.equal(truth.split, 'demo');
  const originals: Original[] = truth.sources.filter((source: Original) => source.externalPath.endsWith('.pdf'));
  const documents = originals.map((source, index) => ({
    key: `document${index}`, filename: basename(source.externalPath), sourceSha256: source.sha256,
    originalUrl: source.url, issuer: which === 'tower3' ? 'Haryana RERA' : 'Bihar RERA',
    acquiredAt: source.retrievedAt, permission: 'unconfirmed' as const, classification: 'test_only' as const,
  }));
  const path = `${privateRoot}/${which}-import-input.json`;
  if (!existsSync(path)) {
    const area = which === 'tower3' ? await api('/areas/ed4bc3ae-1b02-412e-a5cc-02accf693a1b/context') : null;
    const input = which === 'tower3' ? towerInput(truth, documents, area.area) : magnoliaInput(truth, documents);
    writeFileSync(path, JSON.stringify(input, null, 2) + '\n', { flag: 'wx' });
  }
  const input = SourceBuildingImportSchema.parse(read(path));
  const form = new FormData();
  form.set('format', 'document_buildings');
  form.set('metadata', JSON.stringify(input));
  for (const [index, original] of originals.entries()) {
    const bytes = readFileSync(original.externalPath);
    assert.equal(hash(bytes), original.sha256);
    form.set(`document${index}`, new File([bytes], basename(original.externalPath), { type: 'application/pdf' }));
  }
  const pkg = await api('/import-packages', { method: 'POST', body: form });
  save(`${which}-source-import`, pkg);
  console.log(JSON.stringify({ state: pkg.state, id: pkg.id, areaId: pkg.areaId, buildingId: pkg.features[0].id }));
}

async function recordBuilding(which: string) {
  const imported = read(`${evidence}/${which}-source-import.json`);
  const current = await api(`/import-packages/${imported.id}`);
  if (current.state === 'COMMITTED') {
    save(`${which}-canonical`, await api(`/buildings/${current.features[0].id}/canonical`));
    save(`${which}-area-canonical`, await api(`/areas/${current.areaId}/canonical`));
    console.log(`Retained committed ${which}; no second review or write.`);
    return;
  }
  const review = await api(`/import-packages/${current.id}/prepare`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: current.revision }) });
  save(`${which}-source-review`, review);
  const acknowledgement = 'Local development source review only. Unknown footprint, placement, height, rights and '
    + 'approved/as-built revision remain unknown. Conflicting G+41/G+42 source literals are not selected.';
  const committed = await api(`/import-packages/${current.id}/commit`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: review.revision, acknowledgement }) });
  save(`${which}-source-commit`, committed);
  save(`${which}-canonical`, await api(`/buildings/${committed.features[0].id}/canonical`));
  save(`${which}-area-canonical`, await api(`/areas/${committed.areaId}/canonical`));
  console.log(JSON.stringify({
    state: committed.state, buildingId: committed.features[0].id, areaId: committed.areaId,
  }));
}

const [action, which] = process.argv.slice(2);
assert(['tower3', 'magnolia'].includes(which));
if (action === 'import') await importBuilding(which);
else if (action === 'record') await recordBuilding(which);
else throw new Error('Use import|record tower3|magnolia; all writes use the existing product API.');
