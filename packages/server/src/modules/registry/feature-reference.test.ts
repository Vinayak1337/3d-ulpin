import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { permitsFeatureRecordSource } from './registry-reference-policy';
import { persistRegistryReviewTx } from './registry';
import { sha256 } from '../../infrastructure/storage';

const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const stamp = '2026-10-11T00:00:00.000Z';

// Memory-only detailed draft protocol; original geographic vertices/attributes are unchanged.
// This qualifies admission checks, not normalization, placement or a detailed geometry review.
function reviewFixture() {
  const bytes = readFileSync('E:/BhuAayam-data/datasets/nyc-10013/files/buildings-original.geojson');
  const original = JSON.parse(bytes.toString()).features[0];
  const footprint = (original.geometry.type === 'Polygon'
    ? original.geometry.coordinates[0] : original.geometry.coordinates[0][0]).slice(0, -1);
  const site = { id: uuid(1), identifier: 'MEMORY-SITE', name: 'Memory-only review', revision: 1, synthetic: false,
    frame: { id: 'MEMORY', horizontalUnit: 'm', verticalUnit: 'm', benchmark: 'unknown' } };
  const binding = { sourceId: uuid(2), locator: `feature ${original.properties.doitt_id}` };
  const record: any = { id: uuid(5), siteId: site.id, identifier: 'MEMORY-BUILDING', revision: 0,
    alias: original.properties.doitt_id, name: `Building ${original.properties.doitt_id}`, kind: 'building',
    footprint, synthetic: false, links: [], rights: [], evidence: [binding] };
  const draft: any = { id: uuid(6), siteId: site.id, caseId: uuid(3), revision: 1, status: 'draft',
    records: [record], createdAt: stamp };
  const source: any = { id: binding.sourceId, case_id: uuid(3), family_id: uuid(2), revision: 1,
    name: 'buildings-original.geojson', sha256: sha256(bytes), bytes: bytes.length, created_at: stamp,
    profile: 'geojson-area-v2', status: 'inspected', inspection: { status: 'interpreted' } };
  const state = { committed: true, sameSite: true, featureSite: site.id, featureSource: source.id,
    featureKey: original.properties.doitt_id, featureRevision: 1, queries: [] as string[], saved: false };
  return { site, draft, source, record, state };
}

async function reviewQuery(fixture: ReturnType<typeof reviewFixture>, sql: string, args: any[]) {
  const { site, draft, source, record, state } = fixture;
  state.queries.push(sql);
  let rows: any[] = [];
  if (sql.includes('FROM registry_sites')) rows = [site];
  else if (sql.includes('FROM registry_drafts')) rows = [{ id: draft.id, site_id: site.id,
    case_id: draft.caseId, revision: 1, status: 'draft', records: [record], created_at: stamp }];
  else if (sql.includes('FROM registry_records')) rows = [];
  else if (sql.includes('FROM sources s JOIN cases')) {
    assert.deepEqual(args, [source.id, site.id]);
    rows = state.sameSite ? [source] : [];
  } else if (sql.includes('FROM external_identifiers')) {
    assert(sql.includes("e.scheme='source_feature_id'"));
    assert(sql.includes("e.valid_to IS NULL AND e.verification_state='validated'"));
    assert(sql.includes('f.revision>0 AND a.site_id=$2'));
    assert(sql.includes("f.body->>'sourceRevisionId'=$3 AND f.body->>'sourceKey'=$4"));
    assert.equal(args[0], args[3].toUpperCase());
    if (state.committed && state.featureRevision > 0 && state.featureSite === args[1]
      && state.featureSource === args[2] && state.featureKey === args[3]) rows = [{ '?column?': 1 }];
  } else if (sql.startsWith('INSERT INTO registry_reviews')) state.saved = true;
  else assert(sql.startsWith('SELECT'), sql);
  return { rows, rowCount: rows.length };
}

function control() {
  const fixture = reviewFixture();
  const client = { query: (sql: string, args: any[] = []) => reviewQuery(fixture, sql, args) } as unknown as PoolClient;
  const { draft, site, record } = fixture;
  const run = () => persistRegistryReviewTx(client, { d: draft, site: site as any, combined: [record] },
    { id: uuid(7), records: [record] } as any);
  return { ...fixture, run };
}

test('native interpreted profiles are record-only, never geometry or right sources', () => {
  const native = { status: 'inspected', inspection: { status: 'interpreted' } };
  for (const profile of ['geojson-area-v2', 'arcgis-area-v2', 'gpkg-area-v2', 'shapefile_zip-area-v2']) {
    assert(permitsFeatureRecordSource({ ...native, profile }, 'record'));
    assert(!permitsFeatureRecordSource({ ...native, profile }, 'right'));
    assert(!permitsFeatureRecordSource({ ...native, profile }, 'geometry'));
  }
  assert(!permitsFeatureRecordSource({ ...native, profile: 'geojson-manual-v1' }, 'record'));
  assert(!permitsFeatureRecordSource({ ...native,
    profile: 'geojson-area-v2', status: 'ready' }, 'record'));
});

test('detailed draft with native binding needs a committed same-site observation', async () => {
  const fixture = control();
  await fixture.run();
  assert(fixture.state.saved);
  assert.equal(fixture.state.queries.filter(sql => sql.includes('FROM external_identifiers')).length, 1);
});

const refused: [string, (fixture: ReturnType<typeof control>) => void][] = [
  ['no committed observation', fixture => { fixture.state.committed = false; }],
  ['revision zero', fixture => { fixture.state.featureRevision = 0; }],
  ['source belongs to another site', fixture => { fixture.state.sameSite = false; }],
  ['observation belongs to another site', fixture => { fixture.state.featureSite = uuid(10); }],
  ['observation names a different source', fixture => { fixture.state.featureSource = uuid(10); }],
  ['uppercase candidate is not an exact key match', fixture => {
    // Deliberate case-collision protocol control, not a key asserted for the NYC feature.
    fixture.record.evidence[0].locator = 'feature Protocol-A';
    fixture.state.featureKey = 'protocol-a';
  }],
  ['right purpose', fixture => {
    fixture.record.rights = [{ type: 'ownership_claim', party: 'Protocol-only claim',
      evidence: fixture.record.evidence[0] }];
  }],
];

for (const [name, change] of refused) {
  test(`${name}: EVIDENCE_UNAVAILABLE, no review stored`, async () => {
    const fixture = control();
    change(fixture);
    await assert.rejects(() => fixture.run(), { status: 422, code: 'EVIDENCE_UNAVAILABLE' });
    assert(!fixture.state.saved);
  });
}

test('geometry purpose remains EVIDENCE_UNAVAILABLE after record-purpose admission', async () => {
  const fixture = control(), record = fixture.record;
  record.kind = 'space';
  record.use = 'apartment';
  record.geometry = { id: record.id, alias: record.alias, name: record.name, kind: 'unit',
    footprint: record.footprint, lower: 0, upper: 3, lowerVerified: false, upperVerified: false,
    bindings: { lower: record.evidence[0] }, revision: 1, levelLabel: 'Protocol-only level' };
  await assert.rejects(() => fixture.run(), { status: 422, code: 'EVIDENCE_UNAVAILABLE' });
  assert(!fixture.state.saved);
});

test('retained map original needs_input admits committed same-site record evidence without rewriting its receipt',
  async () => {
    const fixture = control();
    Object.assign(fixture.source, { profile: 'geojson-manual-v1', status: 'needs_input',
      inspection: { manualProfile: { version: 'manual-geojson/1', format: 'geojson' },
        gis: { sourceSha256: fixture.source.sha256 } } });
    await fixture.run();
    assert(fixture.state.saved);
    assert.equal(fixture.source.status, 'needs_input');
    assert.equal(fixture.state.queries.filter(sql => sql.includes('FROM external_identifiers')).length, 1);
  });

for (const profile of ['large-original-v1', 'document-original-v1']) {
  test(`${profile} needs_input remains unavailable at detailed review`, async () => {
    const fixture = control();
    Object.assign(fixture.source, { profile, status: 'needs_input' });
    await assert.rejects(() => fixture.run(), { status: 422, code: 'EVIDENCE_UNAVAILABLE' });
    assert(!fixture.state.saved);
  });
}

test('admitted native feature still undergoes the unchanged source frame check', async () => {
  const fixture = control();
  fixture.source.inspection.frame = { id: 'OTHER', horizontalUnit: 'm', verticalUnit: 'm', benchmark: 'unknown' };
  await assert.rejects(() => fixture.run(), { status: 422, code: 'EVIDENCE_FRAME' });
  assert(!fixture.state.saved);
});
