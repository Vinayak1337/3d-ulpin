import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { AppError } from '../../infrastructure/errors';

function importer() {
  const source = readFileSync('packages/server/src/modules/areas/areas.ts', 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  } }).outputText.replace(/^import \{([^}]+)\} from ["'][^"']+["'];/gm,
    (_, names) => `const {${names.replace(/\s+as\s+/g, ':')}} = controls;`).replaceAll('export ', '');
  let nextId = 0;
  const controls = {
    randomUUID: () => `test_only-${++nextId}`,
    originalAttempt: (_table: string, _id: string, work: any) => work(() => {}),
    assertPackageDocumentAuthority: async () => {}, assertAreaRowLive: () => {}, AppError,
  };
  return new Function('controls', js + '\nreturn persistPreparedAreaImport;')(controls);
}

async function cut(linkedRevision?: number | (number | undefined)[], bad?: 'kind' | 'world' | 'area') {
  const raw = JSON.parse(readFileSync(
    'E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson', 'utf8')).features.slice(0, 3);
  const candidates = raw.map((f: any) => ({ sourceKey: f.properties.doitt_id, kind: 'building',
    worldStatus: 'observed', name: f.properties.doitt_id, properties: f.properties,
    geographicGeometry: f.geometry, height: { value: null, state: 'unknown' } }));
  const linked = linkedRevision === undefined ? [] : candidates.map((candidate: any, i: number) => ({
    id: `linked-${i}`, source_key: candidate.sourceKey, area_id: bad === 'area' ? 'another' : 'area',
    identifier: `site:B00${i + 1}`, record_id: `record-${i}`,
    revision: Array.isArray(linkedRevision) ? linkedRevision[i] : linkedRevision,
    body: { kind: bad === 'kind' ? 'parcel' : 'building', worldStatus: bad === 'world' ? 'synthetic' : 'observed' },
  })).filter((row: any) => row.revision !== undefined);
  const sent: { sql: string; values: any[] }[] = [];
  let nextOrdinal = 8;
  const client = { query: async (sql: string, values: any[] = []) => {
    sent.push({ sql, values });
    if (sql.includes('FROM source_feature_links')) return { rows: sql.includes('ANY(')
      ? linked : linked.filter((row: any) => row.source_key === values[1]) };
    if (sql.includes('MAX(ordinal)')) return { rows: [{ n: nextOrdinal }] };
    if (sql.startsWith('INSERT INTO registry_records')) nextOrdinal++;
    if (sql.includes('FROM map_areas')) return { rows: [{ id: 'area', site_id: 'site', revision: 1 }] };
    if (sql.includes('FROM registry_sites')) return { rows: [{ id: 'site', identifier: 'SITE' }] };
    if (sql.includes('FROM cases')) return { rows: [{ id: 'case', site_id: 'site' }] };
    return { rows: [] };
  } };
  const result = importer()({ namespace: 'test_only', name: 'NYC', mapping: {} }, {
    area: { id: 'area' }, seedKey: 'test_only', digest: 'test_only', operationKey: 'test_only',
    normalized: { features: candidates, warnings: [], reference: {}, extent: [], geographicExtent: [] },
    retained: { id: 'source', case_id: 'case', object_key: 'unchanged' }, sourceRanges: new Map(),
    provedPart: { importSignature: 'test_only' },
  }, client);
  return { sent, result, candidates };
}

test('a cut batches source lookup and draft writes, keeping source order and reserved identities', async () => {
  const { result, sent, candidates } = await cut();
  const pkg = await result;
  assert.deepEqual(pkg.features.map((f: any) => f.sourceKey), candidates.map((f: any) => f.sourceKey));
  assert.deepEqual(pkg.features.map((f: any) => f.identifier), ['SITE:B008', 'SITE:B009', 'SITE:B010']);
  for (const fragment of ['FROM source_feature_links', 'MAX(ordinal)', 'INSERT INTO registry_records',
    'INSERT INTO physical_features', 'INSERT INTO source_feature_links']) {
    assert.equal(sent.filter(s => s.sql.includes(fragment)).length, 1, fragment);
  }
  const physical = sent.find(s => s.sql.includes('INSERT INTO physical_features'))!;
  assert.match(physical.sql, /jsonb_to_recordset/);
  assert.doesNotMatch(physical.sql, /[(,]geometry[,)]/);
  assert.deepEqual(JSON.parse(physical.values[0]).map((row: any) => row.body), pkg.features);
  assert(pkg.features.every((f: any) => f.height.value === null && f.revision === 0));
});

test('redraft keeps source-order locks on revision-zero outlines; recorded rows and identities stay unchanged', async () => {
  for (const revision of [0, 3]) {
    const { result, sent } = await cut(revision);
    const pkg = await result;
    assert.deepEqual(pkg.features.map((f: any) => f.id), ['linked-0', 'linked-1', 'linked-2']);
    assert.equal(sent.filter(s => s.sql.includes('INSERT INTO physical_features')).length, 0);
    const updates = sent.filter(s => s.sql.startsWith('UPDATE physical_features'));
    assert.equal(updates.length, revision === 0 ? 3 : 0);
    if (updates.length) {
      assert.match(updates[0].sql, /revision=0/);
      assert.deepEqual(updates.map(update => update.values[0]), ['linked-0', 'linked-1', 'linked-2']);
    }
    assert.equal(sent.filter(s => s.sql.includes('INSERT INTO registry_records')).length, 0);
  }
});

test('a mixed cut reserves only its new identity and leaves linked bodies and recorded outlines alone', async () => {
  const { result, sent } = await cut([0, undefined, 3]);
  const pkg = await result;
  assert.deepEqual(pkg.features.map((f: any) => f.identifier), ['site:B001', 'SITE:B008', 'site:B003']);
  const insert = sent.find(s => s.sql.startsWith('INSERT INTO physical_features'))!;
  assert.deepEqual(JSON.parse(insert.values[0]).map((row: any) => row.id), [pkg.features[1].id]);
  const update = sent.find(s => s.sql.startsWith('UPDATE physical_features'))!;
  assert.equal(update.values[0], 'linked-0');
  assert.doesNotMatch(update.sql, /SET body/);
});

test('batched lookup still refuses changed kind, world promotion and another area before draft writes', async () => {
  for (const bad of ['kind', 'world', 'area'] as const) {
    const { result, sent } = await cut(0, bad);
    const code = { kind: 'FEATURE_KIND_CHANGED', world: 'WORLD_STATUS_PROMOTION', area: 'FEATURE_ALREADY_MAPPED' };
    await assert.rejects(result, (error: any) => error.code === code[bad]);
    assert.equal(sent.filter(s => /^(INSERT|UPDATE)/.test(s.sql)).length, 0);
  }
});
